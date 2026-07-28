import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  databaseConfig,
  dispatchConfig,
  redisConfig,
  validateEnv,
} from '../../config';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueModule,
  DispatchQueueService,
} from '../dispatch-queue';
import {
  DRIZZLE,
  DatabaseModule,
  type Database,
} from '../../database/database.module';
import { user } from '../user';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { DispatchJobOperationsService } from './dispatch-job-operations.service';
import { dispatchAttempt, dispatchOffer } from './schema';

describe('DispatchJobOperationsService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let queues: DispatchQueueService;
  let operations: DispatchJobOperationsService;
  let db: Database;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();
  const offerIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
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
      providers: [DispatchJobOperationsService],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    queues = moduleRef.get(DispatchQueueService);
    operations = moduleRef.get(DispatchJobOperationsService);
  });

  afterEach(async () => {
    for (const offerId of offerIds) {
      await db.delete(dispatchOffer).where(eq(dispatchOffer.id, offerId));
    }
    for (const requestId of requestIds) {
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId));
      await db.delete(rideRequest).where(eq(rideRequest.id, requestId));
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
    offerIds.clear();
    requestIds.clear();
    userIds.clear();
    for (const queueName of Object.values(DISPATCH_QUEUE_NAMES)) {
      await queues.drain(queueName).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await queues?.close();
    await moduleRef?.close();
    await harness?.cleanupRedisNamespace();
    await harness?.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  it('returns statuses for all dispatch queues', async () => {
    const statuses = await operations.getAllQueueStatuses();

    const queueNames = Object.values(DISPATCH_QUEUE_NAMES);
    expect(statuses).toHaveLength(queueNames.length);
    for (const status of statuses) {
      expect(queueNames).toContain(status.queueName);
      expect(status.counts).toEqual({
        waiting: 0,
        delayed: 0,
        active: 0,
        completed: 0,
        failed: 0,
        paused: 0,
      });
    }
  });

  it('returns status for a specific queue', async () => {
    const status = await operations.getQueueStatus(DISPATCH_QUEUE_NAMES.match);

    expect(status.queueName).toBe(DISPATCH_QUEUE_NAMES.match);
    expect(status.counts.waiting).toBe(0);
  });

  it('reflects enqueued jobs in queue counts', async () => {
    await queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.match,
      jobName: 'test.job',
      jobId: 'test-job-1',
      data: { test: true },
    });

    const status = await operations.getQueueStatus(DISPATCH_QUEUE_NAMES.match);

    expect(status.counts.waiting).toBe(1);
  });

  it('inspects request state with related attempts, offers, and driver profiles', async () => {
    const [rider] = await db
      .insert(user)
      .values({ firstName: 'Rider', lastName: 'Inspect', roles: ['rider'] })
      .returning();
    const [driver] = await db
      .insert(user)
      .values({ firstName: 'Driver', lastName: 'Inspect', roles: ['driver'] })
      .returning();
    if (!rider || !driver) throw new Error('test setup failed');
    userIds.add(rider.id);
    userIds.add(driver.id);

    const [profile] = await db
      .insert(driverOperationalProfile)
      .values({
        userId: driver.id,
        operationalState: 'offline',
        ownerSessionId: null,
        presenceSessionId: null,
        presenceGeneration: 0,
      })
      .returning();
    if (!profile) throw new Error('profile setup failed');

    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: 'offered',
        pickup: createPoint(9.02, 38.75),
        destination: createPoint(9.03, 38.76),
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(Date.now() + 90_000),
      })
      .returning();
    if (!request) throw new Error('request setup failed');
    requestIds.add(request.id);

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId: request.id, attemptNumber: 1 })
      .returning();
    if (!attempt) throw new Error('attempt setup failed');

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: request.id,
        attemptId: attempt.id,
        driverId: driver.id,
        state: 'pending',
        offeredAt: new Date(),
        expiresAt: new Date(Date.now() + 15_000),
      })
      .returning();
    if (!offer) throw new Error('offer setup failed');
    offerIds.add(offer.id);

    const inspection = await operations.inspectRequest(request.id);

    expect(inspection?.request.id).toBe(request.id);
    expect(inspection?.attempts).toHaveLength(1);
    expect(inspection?.offers).toHaveLength(1);
    expect(inspection?.driverProfiles).toHaveLength(1);
    expect(inspection?.driverProfiles[0]?.userId).toBe(driver.id);
  });

  it('inspects offer state with related request, attempt, and driver profile', async () => {
    const [rider] = await db
      .insert(user)
      .values({ firstName: 'Rider', lastName: 'Offer', roles: ['rider'] })
      .returning();
    const [driver] = await db
      .insert(user)
      .values({ firstName: 'Driver', lastName: 'Offer', roles: ['driver'] })
      .returning();
    if (!rider || !driver) throw new Error('test setup failed');
    userIds.add(rider.id);
    userIds.add(driver.id);

    await db.insert(driverOperationalProfile).values({
      userId: driver.id,
      operationalState: 'offline',
      ownerSessionId: null,
      presenceSessionId: null,
      presenceGeneration: 0,
    });

    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: 'offered',
        pickup: createPoint(9.02, 38.75),
        destination: createPoint(9.03, 38.76),
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(Date.now() + 90_000),
      })
      .returning();
    if (!request) throw new Error('request setup failed');
    requestIds.add(request.id);

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId: request.id, attemptNumber: 1 })
      .returning();
    if (!attempt) throw new Error('attempt setup failed');

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: request.id,
        attemptId: attempt.id,
        driverId: driver.id,
        state: 'pending',
        offeredAt: new Date(),
        expiresAt: new Date(Date.now() + 15_000),
      })
      .returning();
    if (!offer) throw new Error('offer setup failed');
    offerIds.add(offer.id);

    const inspection = await operations.inspectOffer(offer.id);

    expect(inspection?.offer.id).toBe(offer.id);
    expect(inspection?.request?.id).toBe(request.id);
    expect(inspection?.attempt?.id).toBe(attempt.id);
    expect(inspection?.driverProfile?.userId).toBe(driver.id);
  });

  it('inspects driver state with related offers and requests', async () => {
    const [rider] = await db
      .insert(user)
      .values({ firstName: 'Rider', lastName: 'DriverView', roles: ['rider'] })
      .returning();
    const [driver] = await db
      .insert(user)
      .values({
        firstName: 'Driver',
        lastName: 'DriverView',
        roles: ['driver'],
      })
      .returning();
    if (!rider || !driver) throw new Error('test setup failed');
    userIds.add(rider.id);
    userIds.add(driver.id);

    const [profile] = await db
      .insert(driverOperationalProfile)
      .values({
        userId: driver.id,
        operationalState: 'offline',
        ownerSessionId: null,
        presenceSessionId: null,
        presenceGeneration: 0,
      })
      .returning();
    if (!profile) throw new Error('profile setup failed');

    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: 'offered',
        pickup: createPoint(9.02, 38.75),
        destination: createPoint(9.03, 38.76),
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(Date.now() + 90_000),
      })
      .returning();
    if (!request) throw new Error('request setup failed');
    requestIds.add(request.id);

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId: request.id, attemptNumber: 1 })
      .returning();
    if (!attempt) throw new Error('attempt setup failed');

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: request.id,
        attemptId: attempt.id,
        driverId: driver.id,
        state: 'pending',
        offeredAt: new Date(),
        expiresAt: new Date(Date.now() + 15_000),
      })
      .returning();
    if (!offer) throw new Error('offer setup failed');
    offerIds.add(offer.id);

    const inspection = await operations.inspectDriver(driver.id);

    expect(inspection.driverProfile?.id).toBe(profile.id);
    expect(inspection.offers).toHaveLength(1);
    expect(inspection.requests).toHaveLength(1);
    expect(inspection.requests[0]?.id).toBe(request.id);
  });

  it('enqueues a reconciliation job and writes an audit log entry', async () => {
    const logger = (
      operations as unknown as {
        logger: { log: (message: unknown) => void };
      }
    ).logger;
    const logSpy = jest.spyOn(logger, 'log');

    const result = await operations.enqueueReconciliation(
      'admin-1',
      'repair stuck offered state',
    );

    expect(result).toMatchObject({
      success: true,
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
    });

    const status = await operations.getQueueStatus(
      DISPATCH_QUEUE_NAMES.reconciliation,
    );
    expect(status.counts.waiting).toBe(1);
    expect(logSpy).toHaveBeenCalledWith({
      msg: 'dispatch_admin_reconciliation_enqueued',
      actorUserId: 'admin-1',
      reason: 'repair stuck offered state',
      jobId: result.jobId,
      queueName: DISPATCH_QUEUE_NAMES.reconciliation,
    });

    logSpy.mockRestore();
  });
});
const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;
