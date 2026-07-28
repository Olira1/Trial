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
} from '../dispatch-queue';
import { DISPATCH_METRICS } from '../dispatch-candidate';
import { DispatchOutboxPublisherService } from '../dispatch-outbox';
import { user } from '../user';
import { authSession } from '../auth/schema/session.schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';
import { MatchWorkerService } from './match-worker.service';
import { MatchOrchestrator } from './match-orchestrator.service';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';
import { OfferExpirationService } from './offer-expiration.service';
import { ReconciliationWorkerService } from './reconciliation-worker.service';
import {
  createDispatchMetricsMock,
  type DispatchMetricsMock,
} from './dispatch-metrics.test-double';

describe('ReconciliationWorkerService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let queues: DispatchQueueService;
  let reconciliation: ReconciliationWorkerService;
  let matchWorker: MatchWorkerService;
  let metrics: DispatchMetricsMock;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();
  const offerIds = new Set<string>();
  const sessionIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
      DISPATCH_QUEUE_BACKOFF_DELAY_MS: '100',
    });

    metrics = createDispatchMetricsMock();

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
        ReconciliationWorkerService,
        MatchWorkerService,
        OfferExpirationWorkerService,
        {
          provide: DISPATCH_METRICS,
          useValue: metrics,
        },
        {
          provide: DispatchOutboxPublisherService,
          useValue: {
            enqueuePendingPublishJobs: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: MatchOrchestrator,
          useValue: {
            attemptMatch: jest.fn().mockResolvedValue({ status: 'noop' }),
          },
        },
        {
          provide: OfferExpirationService,
          useValue: { expire: jest.fn() },
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    queues = moduleRef.get(DispatchQueueService);
    reconciliation = moduleRef.get(ReconciliationWorkerService);
    matchWorker = moduleRef.get(MatchWorkerService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    if (!db || !queues) return;
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
        .delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    for (const sessionId of sessionIds) {
      await db
        .delete(authSession)
        .where(eq(authSession.id, sessionId))
        .catch(() => undefined);
    }
    offerIds.clear();
    requestIds.clear();
    userIds.clear();
    sessionIds.clear();
    await db.execute(sql`DELETE FROM "dispatch_outbox_event"`);
    await queues
      .drain(DISPATCH_QUEUE_NAMES.reconciliation)
      .catch(() => undefined);
    await queues
      .drain(DISPATCH_QUEUE_NAMES.offerExpiration)
      .catch(() => undefined);
    await queues.drain(DISPATCH_QUEUE_NAMES.match).catch(() => undefined);
    await queues.drain(DISPATCH_QUEUE_NAMES.outbox).catch(() => undefined);
  });

  afterAll(async () => {
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

  const createRequest = async (
    riderId: string,
    state: string = 'searching',
  ) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "state", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        ${state},
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

  it('repairs offered requests that have no pending offer', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id, 'offered');

    const result = await reconciliation.runChecks();

    expect(result.checks.staleOfferedRequests).toBe(1);
    const [request] = await db
      .select({ state: rideRequest.state })
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId));
    expect(request?.state).toBe('searching');
  });

  it('leaves offered requests that have a pending offer untouched', async () => {
    const rider = await createUser();
    const driver = await createUser();
    const requestId = await createRequest(rider.id, 'offered');
    const attemptId = await createAttempt(requestId);

    const offeredAt = new Date();
    const expiresAt = new Date(offeredAt.getTime() + 15_000);
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
    if (offer) offerIds.add(offer.id);

    const result = await reconciliation.runChecks();

    expect(result.checks.staleOfferedRequests).toBe(0);
    const [request] = await db
      .select({ state: rideRequest.state })
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId));
    expect(request?.state).toBe('offered');
  });

  it('repairs offered drivers that have no pending offer', async () => {
    const driver = await createUser();
    const [session] = await db
      .insert(authSession)
      .values({
        userId: driver.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    if (!session) throw new Error('failed to create session');
    sessionIds.add(session.id);

    await db.insert(driverOperationalProfile).values({
      userId: driver.id,
      operationalState: 'offered',
      ownerSessionId: session.id,
      presenceSessionId: randomUUID(),
      presenceGeneration: 1,
    });

    const result = await reconciliation.runChecks();

    expect(result.checks.staleOfferedDrivers).toBe(1);
    const [profile] = await db
      .select({ operationalState: driverOperationalProfile.operationalState })
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.id));
    expect(profile?.operationalState).toBe('online');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordStuckDriver).toHaveBeenCalledWith(
      driver.id,
      'offered',
      expect.any(Number),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordStuckOffer).not.toHaveBeenCalled();
  });

  it('is idempotent when run multiple times', async () => {
    const rider = await createUser();
    await createRequest(rider.id, 'offered');

    const first = await reconciliation.runChecks();
    const second = await reconciliation.runChecks();

    expect(first.checks.staleOfferedRequests).toBe(1);
    expect(second.checks.staleOfferedRequests).toBe(0);
  });

  it('requeues searching requests that have no attempts or offers', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id, 'searching');
    const enqueueSpy = jest.spyOn(matchWorker, 'enqueueMatchJob');

    const result = await reconciliation.runChecks();

    expect(result.checks.searchingRequestsRequeued).toBeGreaterThanOrEqual(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      requestId,
      expect.stringMatching(/^recovery-/),
    );
  });

  it('requeues expired-deadline searching requests so the match worker can resolve them', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id, 'searching');
    await db
      .update(rideRequest)
      .set({ matchingDeadlineAt: new Date(Date.now() + 1_000) })
      .where(eq(rideRequest.id, requestId));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const enqueueSpy = jest.spyOn(matchWorker, 'enqueueMatchJob');

    const result = await reconciliation.runChecks();

    expect(result.checks.searchingRequestsRequeued).toBeGreaterThanOrEqual(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      requestId,
      expect.stringMatching(/^recovery-/),
    );
  });

  it('does not requeue searching requests that already have an attempt', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id, 'searching');
    await createAttempt(requestId);
    const enqueueSpy = jest.spyOn(matchWorker, 'enqueueMatchJob');

    await reconciliation.runChecks();

    expect(enqueueSpy).not.toHaveBeenCalledWith(requestId, expect.any(String));
  });
});
