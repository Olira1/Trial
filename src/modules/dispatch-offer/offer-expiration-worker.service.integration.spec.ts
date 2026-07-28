import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
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
import { DispatchOutboxModule } from '../dispatch-outbox';
import { user } from '../user';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';
import { OfferExpirationService } from './offer-expiration.service';
import {
  DISPATCH_OFFER_EXPIRATION_JOB_NAME,
  OfferExpirationWorkerService,
  type DispatchOfferExpirationJobData,
} from './offer-expiration-worker.service';

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

describe('OfferExpirationWorkerService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let queues: DispatchQueueService;
  let workerService: OfferExpirationWorkerService;
  let expirationService: jest.Mocked<OfferExpirationService>;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();
  const offerIds = new Set<string>();

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
        DispatchOutboxModule,
      ],
      providers: [
        OfferExpirationWorkerService,
        {
          provide: OfferExpirationService,
          useValue: {
            expire: jest.fn(),
          },
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    queues = moduleRef.get(DispatchQueueService);
    workerService = moduleRef.get(OfferExpirationWorkerService);
    expirationService = moduleRef.get(OfferExpirationService);

    await workerService.start();
  });

  afterEach(async () => {
    jest.resetAllMocks();
    for (const offerId of offerIds) {
      await db
        .delete(dispatchOffer)
        .where(eq(dispatchOffer.id, offerId))
        .catch(() => undefined);
    }
    for (const requestId of requestIds) {
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
    offerIds.clear();
    requestIds.clear();
    userIds.clear();
    await db.execute(sql`DELETE FROM "dispatch_outbox_event"`);
    await queues
      .drain(DISPATCH_QUEUE_NAMES.offerExpiration)
      .catch(() => undefined);
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
        ST_SetSRID(ST_MakePoint(38.75, 9.02), 4326)::geography,
        ST_SetSRID(ST_MakePoint(38.76, 9.03), 4326)::geography,
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

  const createAttempt = async (requestId: string) => {
    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId, attemptNumber: 1 })
      .returning();
    if (!attempt) throw new Error('failed to create attempt');
    return attempt.id;
  };

  const createPendingOffer = async (expiresAt: Date) => {
    const rider = await createUser();
    const driver = await createUser();
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);
    const offeredAt = new Date(expiresAt.getTime() - 15_000);

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId,
        attemptId,
        driverId: driver.id,
        state: 'pending',
        offeredAt,
        expiresAt,
        etaSeconds: 120,
        distanceMeters: 1500,
      })
      .returning();

    if (!offer) throw new Error('failed to create offer');
    offerIds.add(offer.id);
    return offer;
  };

  const enqueueExpiration = async (
    offerId: string,
    expiresAt: Date,
    delayMs = 0,
  ) => {
    return queues.enqueue<DispatchOfferExpirationJobData>({
      queueName: DISPATCH_QUEUE_NAMES.offerExpiration,
      jobName: DISPATCH_OFFER_EXPIRATION_JOB_NAME,
      jobId: dispatchJobIds.offerExpiration({ offerId, expiresAt }),
      data: { offerId, expiresAt: expiresAt.toISOString() },
      delayMs,
    });
  };

  it('processes an expiration job and calls the expiration service', async () => {
    const expiresAt = new Date(Date.now() - 1_000);
    const offer = await createPendingOffer(expiresAt);
    expirationService.expire.mockResolvedValue({
      ...offer,
      state: 'expired',
    });

    await enqueueExpiration(offer.id, expiresAt);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(expirationService.expire).toHaveBeenCalledWith(offer.id),
    );
  });

  it('makes duplicate expiration jobs harmless via deterministic IDs', async () => {
    const expiresAt = new Date(Date.now() - 1_000);
    const offer = await createPendingOffer(expiresAt);
    expirationService.expire.mockResolvedValue({
      ...offer,
      state: 'expired',
    });

    await enqueueExpiration(offer.id, expiresAt);
    await enqueueExpiration(offer.id, expiresAt);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(expirationService.expire).toHaveBeenCalledWith(offer.id),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(expirationService.expire).toHaveBeenCalledTimes(1);
  });

  it('handles already-resolved offers gracefully', async () => {
    const expiresAt = new Date(Date.now() - 1_000);
    const offer = await createPendingOffer(expiresAt);
    expirationService.expire.mockRejectedValue(
      new ConflictException('cannot expire offer in state accepted'),
    );

    await enqueueExpiration(offer.id, expiresAt);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(expirationService.expire).toHaveBeenCalledWith(offer.id),
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(expirationService.expire).toHaveBeenCalledTimes(1);
  });

  it('schedules delayed expiration jobs from scheduleExpiration', async () => {
    const expiresAt = new Date(Date.now() + 1_000);
    const offer = await createPendingOffer(expiresAt);
    expirationService.expire.mockResolvedValue({
      ...offer,
      state: 'expired',
    });

    const result = await workerService.scheduleExpiration(offer.id, expiresAt);

    expect(result.id).toBe(
      dispatchJobIds.offerExpiration({ offerId: offer.id, expiresAt }),
    );

    await waitFor(
      () =>
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(expirationService.expire).toHaveBeenCalledWith(offer.id),
      5_000,
    );
  });

  it('recovers missing expiration jobs for overdue pending offers', async () => {
    const expiresAt = new Date(Date.now() - 5_000);
    const offer = await createPendingOffer(expiresAt);
    expirationService.expire.mockResolvedValue({
      ...offer,
      state: 'expired',
    });

    const recovered = await workerService.recoverMissingJobs();

    expect(recovered).toBe(1);

    await waitFor(() =>
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(expirationService.expire).toHaveBeenCalledWith(offer.id),
    );
  });
});
