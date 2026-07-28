import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
import {
  DISPATCH_MATCH_JOB_NAME,
  MatchWorkerService,
  type DispatchMatchJobData,
} from './match-worker.service';
import { MatchOrchestrator } from './match-orchestrator.service';

const waitFor = async (
  assertion: () => void,
  timeoutMs = 10_000,
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

const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;

describe('MatchWorker load simulation (integration)', () => {
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
            attemptMatch: jest.fn().mockImplementation(async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return { status: 'noop' as const };
            }),
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
      .values({ firstName: 'Load', lastName: 'Rider', roles: ['rider'] })
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

  it('drains a burst of queued match jobs within the local simulation budget', async () => {
    const batchSize = 24;
    const requestIdsBatch: string[] = [];
    for (let i = 0; i < batchSize; i += 1) {
      const rider = await createUser();
      requestIdsBatch.push(await createRequest(rider.id));
    }

    const startedAt = performance.now();

    await Promise.all(
      requestIdsBatch.map((requestId, index) =>
        queues.enqueue<DispatchMatchJobData>({
          queueName: DISPATCH_QUEUE_NAMES.match,
          jobName: DISPATCH_MATCH_JOB_NAME,
          jobId: dispatchJobIds.match({
            requestId,
            attemptId: `load-${index}`,
          }),
          data: { requestId, attemptId: `load-${index}` },
        }),
      ),
    );

    await waitFor(
      () =>
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(orchestrator.attemptMatch).toHaveBeenCalledTimes(batchSize),
      10_000,
    );

    const durationMs = performance.now() - startedAt;

    expect(durationMs).toBeLessThan(3_000);
  });
});
