import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import {
  databaseConfig,
  dispatchConfig,
  redisConfig,
  validateEnv,
} from '../../config';
import {
  DRIZZLE,
  DatabaseModule,
  type Database,
} from '../../database/database.module';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueModule,
  DispatchQueueService,
  dispatchJobIds,
} from '../dispatch-queue';
import { user } from '../user';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';
import { MatchOrchestrator } from './match-orchestrator.service';
import {
  DISPATCH_MATCH_JOB_NAME,
  MatchWorkerService,
  type DispatchMatchJobData,
} from './match-worker.service';

const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;

const waitFor = async (
  assertion: () => void,
  timeoutMs = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw lastError;
};

describe('MatchWorkerService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let queues: DispatchQueueService;
  let workerService: MatchWorkerService;
  let orchestrator: jest.Mocked<MatchOrchestrator>;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
      DISPATCH_QUEUE_BACKOFF_DELAY_MS: '100',
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, redisConfig, dispatchConfig],
        }),
        DatabaseModule,
        DispatchQueueModule,
      ],
      providers: [
        MatchWorkerService,
        {
          provide: MatchOrchestrator,
          useValue: {
            attemptMatch: jest.fn(),
          },
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    queues = moduleRef.get(DispatchQueueService);
    workerService = moduleRef.get(MatchWorkerService);
    orchestrator = moduleRef.get(MatchOrchestrator);

    await workerService.start();
  });

  afterEach(async () => {
    jest.resetAllMocks();
    if (!db || !queues) return;
    for (const requestId of requestIds) {
      await db
        .delete(dispatchOffer)
        .where(eq(dispatchOffer.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId))
        .catch(() => undefined);
      await db.execute(
        sql`DELETE FROM "ride_request" WHERE "id" = ${requestId}`,
      );
    }
    for (const userId of userIds) {
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
    requestIds.clear();
    await db.execute(sql`DELETE FROM "dispatch_outbox_event"`);
    await queues.drain(DISPATCH_QUEUE_NAMES.match).catch(() => undefined);
  });

  afterAll(async () => {
    await workerService?.close();
    await queues?.close();
    await moduleRef?.close();
    await harness?.cleanupRedisNamespace();
    await harness?.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  const createUser = async () => {
    const [created] = await db
      .insert(user)
      .values({ firstName: 'Test', lastName: 'User', roles: ['rider'] })
      .returning();
    if (!created) throw new Error('failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createRequest = async (riderId: string) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "state", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        'searching',
        ${createPoint(9.02, 38.75)},
        ${createPoint(9.03, 38.76)},
        ${randomUUID()},
        15,
        90,
        ${new Date(Date.now() + 90_000)}
      )
      RETURNING "id"
    `);
    const requestId = result.rows[0]!.id;
    requestIds.add(requestId);
    return requestId;
  };

  const enqueueMatch = async (requestId: string, attemptId = 'a1') => {
    return queues.enqueue<DispatchMatchJobData>({
      queueName: DISPATCH_QUEUE_NAMES.match,
      jobName: DISPATCH_MATCH_JOB_NAME,
      jobId: dispatchJobIds.match({ requestId, attemptId }),
      data: { requestId, attemptId },
    });
  };

  it('processes a match job and returns the orchestrator result', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'noop' });

    await enqueueMatch(requestId);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );
  });

  it('makes duplicate jobs idempotent via deterministic job IDs', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'noop' });

    await enqueueMatch(requestId, 'dup');
    await enqueueMatch(requestId, 'dup');

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(orchestrator.attemptMatch).toHaveBeenCalledTimes(1);
  });

  it('returns system_failed as a terminal result without throwing', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'system_failed' });

    await enqueueMatch(requestId);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(orchestrator.attemptMatch).toHaveBeenCalledTimes(1);
  });

  it('throws on transient errors to trigger BullMQ retry', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ status: 'noop' });

    await queues.enqueue<DispatchMatchJobData>({
      queueName: DISPATCH_QUEUE_NAMES.match,
      jobName: DISPATCH_MATCH_JOB_NAME,
      jobId: dispatchJobIds.match({ requestId, attemptId: 'retry' }),
      data: { requestId, attemptId: 'retry' },
      attempts: 3,
    });

    await waitFor(
      () =>
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(orchestrator.attemptMatch).toHaveBeenCalledTimes(3),
      10_000,
    );
  });

  it('processes an already-queued match job after the worker restarts', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'noop' });

    await workerService.close();
    await enqueueMatch(requestId, 'restart');

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(orchestrator.attemptMatch).not.toHaveBeenCalled();

    await workerService.start();

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );
  });

  it('exposes enqueueMatchJob for external callers', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'noop' });

    const result = await workerService.enqueueMatchJob(requestId, 'ext-1');

    expect(result.id).toBe(
      dispatchJobIds.match({ requestId, attemptId: 'ext-1' }),
    );

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );
  });

  it('rematch enqueues a new match job for a searching request', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    orchestrator.attemptMatch.mockResolvedValue({ status: 'noop' });

    const result = await workerService.rematch(requestId);

    expect(result).toEqual({ enqueued: true });

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(orchestrator.attemptMatch).toHaveBeenCalledWith(requestId),
    );
  });

  it('rematch returns not_searching for a non-searching request', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    await db.execute(
      sql`UPDATE "ride_request" SET "state" = 'cancelled' WHERE "id" = ${requestId}`,
    );

    const result = await workerService.rematch(requestId);

    expect(result).toEqual({ enqueued: false, reason: 'not_searching' });
  });

  it('rematch returns deadline_passed for an expired deadline', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    const createdAt = new Date(Date.now() - 120_000);
    const matchingDeadlineAt = new Date(Date.now() - 1_000);
    await db.execute(
      sql`UPDATE "ride_request" SET "created_at" = ${createdAt}, "matching_deadline_at" = ${matchingDeadlineAt} WHERE "id" = ${requestId}`,
    );

    const result = await workerService.rematch(requestId);

    expect(result).toEqual({ enqueued: false, reason: 'deadline_passed' });
  });
});
