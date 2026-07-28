import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Redis } from '../redis';
import {
  authConfig,
  databaseConfig,
  dispatchConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
  validateEnv,
} from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { DriverEligibilityService } from '../driver-presence';
import { DriverPresenceLeaseService } from '../driver-presence/driver-presence-lease.service';
import { DISPATCH_METRICS } from '../dispatch-candidate';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { REDIS_CLIENT, RedisModule } from '../redis';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { rideRequest } from '../ride-requests/schema';
import { OfferReservationService } from './offer-reservation.service';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';
import {
  createDispatchMetricsMock,
  type DispatchMetricsMock,
} from './dispatch-metrics.test-double';

const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;

describe('OfferReservationService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let redis: Redis;
  let leaseService: DriverPresenceLeaseService;
  let service: OfferReservationService;
  let metrics: DispatchMetricsMock;
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  const requestIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();
    process.env.DISPATCH_QUEUE_PREFIX = harness.namespace;

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    metrics = createDispatchMetricsMock();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            authConfig,
            redisConfig,
            databaseConfig,
            dispatchConfig,
            storageConfig,
            notificationsConfig,
          ],
        }),
        DatabaseModule,
        RedisModule,
      ],
      providers: [
        OfferReservationService,
        DispatchOutboxService,
        DriverEligibilityService,
        DriverPresenceLeaseService,
        {
          provide: DISPATCH_METRICS,
          useValue: metrics,
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    redis = moduleRef.get(REDIS_CLIENT);
    leaseService = moduleRef.get(DriverPresenceLeaseService);
    service = moduleRef.get(OfferReservationService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await harness.cleanupRedisNamespace();
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
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.actorUserId, userId))
        .catch(() => undefined);
      await db
        .delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .catch(() => undefined);
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, userId))
        .catch(() => undefined);
      await db
        .delete(vehicle)
        .where(eq(vehicle.userId, userId))
        .catch(() => undefined);
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, userId))
        .catch(() => undefined);
      await db
        .delete(authIdentity)
        .where(eq(authIdentity.userId, userId))
        .catch(() => undefined);
    }
    for (const sessionId of sessionIds) {
      await db
        .delete(authSession)
        .where(eq(authSession.id, sessionId))
        .catch(() => undefined);
    }
    for (const userId of userIds) {
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
    sessionIds.clear();
    requestIds.clear();
  });

  afterAll(async () => {
    await redis.quit().catch(() => undefined);
    await moduleRef?.get<Pool>(PG_POOL).end();
    await harness.close();
  });

  const createUser = async (roles: UserRole[] = ['rider']) => {
    const [created] = await db
      .insert(user)
      .values({ firstName: 'Test', lastName: 'User', roles })
      .returning();
    if (!created) throw new Error('failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createSession = async (userId: string) => {
    const [created] = await db
      .insert(authSession)
      .values({
        userId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    if (!created) throw new Error('failed to create session');
    sessionIds.add(created.id);
    return created;
  };

  const createDriverOnline = async (driverId: string, sessionId: string) => {
    await db.insert(driverOperationalProfile).values({
      userId: driverId,
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId: `ps-${driverId}`,
      presenceGeneration: 1,
    });
  };

  const createRequest = async (riderId: string) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        ${createPoint(9.02, 38.75)},
        ${createPoint(9.03, 38.76)},
        ${randomUUID()},
        15,
        90,
        ${new Date(Date.now() + 90_000)}
      )
      RETURNING "id"
    `);
    const request = result.rows[0];
    if (request === undefined) throw new Error('failed to create request');
    const requestId = request.id;
    requestIds.add(requestId);
    return requestId;
  };

  const expireRequest = async (requestId: string) => {
    const createdAt = new Date(Date.now() - 120_000);
    const matchingDeadlineAt = new Date(Date.now() - 60_000);

    await db.execute(sql`
      UPDATE "ride_request"
      SET
        "created_at" = ${createdAt},
        "matching_deadline_at" = ${matchingDeadlineAt},
        "updated_at" = ${new Date()}
      WHERE "id" = ${requestId}
    `);
  };

  const createAttempt = async (requestId: string) => {
    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId, attemptNumber: 1 })
      .returning();
    if (!attempt) throw new Error('failed to create attempt');
    return attempt.id;
  };

  const createEligibleOnlineDriver = async () => {
    const driver = await createUser(['driver']);
    await db
      .update(user)
      .set({ phoneVerified: true, updatedAt: new Date() })
      .where(eq(user.id, driver.id));

    await db.insert(authIdentity).values({
      userId: driver.id,
      type: 'phone',
      identifier: `+2519${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      verifiedAt: new Date(),
    });

    const [application] = await db
      .insert(driverApplication)
      .values({ userId: driver.id, status: 'approved' })
      .returning();
    if (!application) throw new Error('failed to create application');

    const [activeVehicle] = await db
      .insert(vehicle)
      .values({
        userId: driver.id,
        ownershipType: 'owner',
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        year: 2022,
        plateRegion: 'aa',
        plateCode: '01',
        plateNumber: `P${randomUUID().replaceAll('-', '').slice(0, 6)}`,
        tinNumber: 'TIN-123',
        isApproved: true,
      })
      .returning();
    if (!activeVehicle) throw new Error('failed to create vehicle');

    const session = await createSession(driver.id);
    await createDriverOnline(driver.id, session.id);

    const requiredDocuments: Array<
      | 'vehicle_ownership'
      | 'driver_license_front'
      | 'driver_license_back'
      | 'vehicle_photo_front'
      | 'vehicle_photo_side'
      | 'vehicle_photo_back'
      | 'bolo'
      | 'third_party_insurance'
      | 'trade_license'
    > = [
      'vehicle_ownership',
      'driver_license_front',
      'driver_license_back',
      'vehicle_photo_front',
      'vehicle_photo_side',
      'vehicle_photo_back',
      'bolo',
      'third_party_insurance',
      'trade_license',
    ];
    const vehicleDocuments = new Set([
      'vehicle_ownership',
      'vehicle_photo_front',
      'vehicle_photo_side',
      'vehicle_photo_back',
      'bolo',
      'third_party_insurance',
    ]);
    const expiryTrackedDocuments = new Set([
      'driver_license_front',
      'driver_license_back',
      'bolo',
      'third_party_insurance',
      'trade_license',
    ]);

    for (const documentType of requiredDocuments) {
      await db.insert(documentTable).values({
        userId: driver.id,
        driverApplicationId: vehicleDocuments.has(documentType)
          ? null
          : application.id,
        vehicleId: vehicleDocuments.has(documentType) ? activeVehicle.id : null,
        documentType,
        storageKey: `documents/${driver.id}/${documentType}/${randomUUID()}.jpg`,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        expiresAt: expiryTrackedDocuments.has(documentType)
          ? new Date(Date.now() + 86_400_000)
          : null,
      });
    }

    return {
      driver,
      session,
      vehicle: activeVehicle,
      presenceSessionId: `ps-${driver.id}`,
      presenceGeneration: 1,
    };
  };

  const createFreshLease = async (driver: {
    driver: { id: string };
    session: { id: string };
    presenceSessionId: string;
    presenceGeneration: number;
  }) => {
    return leaseService.createInitialLease({
      userId: driver.driver.id,
      ownerSessionId: driver.session.id,
      presenceSessionId: driver.presenceSessionId,
      presenceGeneration: driver.presenceGeneration,
      location: {
        latitude: 9.021,
        longitude: 38.751,
        accuracyMeters: 10,
        capturedAt: new Date(),
      },
    });
  };

  const countPendingOffersForDriver = async (driverId: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_offer"
      WHERE "driver_id" = ${driverId}
        AND "state" = 'pending'
    `);
    return Number(result.rows[0]?.count ?? 0);
  };

  it('requires a fresh current lease before reserving an online driver', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('lost_race');
    expect(await countPendingOffersForDriver(driver.driver.id)).toBe(0);
  });

  it('reserves an eligible online driver with a fresh lease and creates a pending offer', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('reserved');
    if (result.status !== 'reserved') return;

    expect(result.offer.state).toBe('pending');
    expect(result.offer.driverId).toBe(driver.driver.id);

    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.driver.id));
    expect(profile?.operationalState).toBe('offered');

    const [request] = await db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId));
    expect(request?.state).toBe('offered');

    const events = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, result.offer.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'dispatch_offer.created.v1',
      actorUserId: driver.driver.id,
    });
  });

  it('records time to first offer only for the first successful reservation on a request', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const firstAttemptId = await createAttempt(requestId);

    const firstResult = await service.tryReserve(requestId, firstAttemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(firstResult.status).toBe('reserved');
    if (firstResult.status !== 'reserved') return;

    const secondAttemptId = await db
      .insert(dispatchAttempt)
      .values({ requestId, attemptNumber: 2 })
      .returning()
      .then(([attempt]) => {
        if (!attempt) throw new Error('failed to create second attempt');
        return attempt.id;
      });

    await db
      .update(dispatchOffer)
      .set({ state: 'rejected', updatedAt: new Date() })
      .where(eq(dispatchOffer.id, firstResult.offer.id));

    await db
      .update(rideRequest)
      .set({ state: 'searching', updatedAt: new Date() })
      .where(eq(rideRequest.id, requestId));

    await db
      .update(driverOperationalProfile)
      .set({ operationalState: 'online', updatedAt: new Date() })
      .where(eq(driverOperationalProfile.userId, driver.driver.id));

    const secondResult = await service.tryReserve(requestId, secondAttemptId, {
      driverId: driver.driver.id,
      etaSeconds: 90,
      distanceMeters: 1000,
    });

    expect(secondResult.status).toBe('reserved');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(metrics.recordTimeToFirstOffer).toHaveBeenCalledTimes(1);
  });

  it('loses the race when the driver is not online', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await db
      .update(driverOperationalProfile)
      .set({
        operationalState: 'offline',
        ownerSessionId: null,
        presenceSessionId: null,
        presenceGeneration: 0,
      })
      .where(eq(driverOperationalProfile.userId, driver.driver.id));

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('lost_race');
  });

  it('loses the race when the request is no longer searching', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await db
      .update(rideRequest)
      .set({ state: 'offered' })
      .where(eq(rideRequest.id, requestId));

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('lost_race');
  });

  it('loses the race when durable presence generation no longer matches the fresh lease', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await db
      .update(driverOperationalProfile)
      .set({ presenceGeneration: 2, updatedAt: new Date() })
      .where(eq(driverOperationalProfile.userId, driver.driver.id));

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('lost_race');
  });

  it('loses the race when the driver is no longer durably eligible', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await db
      .update(vehicle)
      .set({ isApproved: false, updatedAt: new Date() })
      .where(eq(vehicle.id, driver.vehicle.id));

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('lost_race');
  });

  it('returns expired without partial state changes when the request deadline already passed', async () => {
    const rider = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestId = await createRequest(rider.id);
    await expireRequest(requestId);
    const attemptId = await createAttempt(requestId);

    const result = await service.tryReserve(requestId, attemptId, {
      driverId: driver.driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });

    expect(result.status).toBe('expired');
    expect(await countPendingOffersForDriver(driver.driver.id)).toBe(0);
    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.driver.id));
    expect(profile?.operationalState).toBe('online');
  });

  it('allows only one of two requests competing for the same driver to reserve successfully', async () => {
    const riderA = await createUser();
    const riderB = await createUser();
    const driver = await createEligibleOnlineDriver();
    await createFreshLease(driver);
    const requestA = await createRequest(riderA.id);
    const requestB = await createRequest(riderB.id);
    const attemptA = await createAttempt(requestA);
    const attemptB = await createAttempt(requestB);

    const results = await Promise.all([
      service.tryReserve(requestA, attemptA, {
        driverId: driver.driver.id,
        etaSeconds: 120,
        distanceMeters: 1500,
      }),
      service.tryReserve(requestB, attemptB, {
        driverId: driver.driver.id,
        etaSeconds: 120,
        distanceMeters: 1500,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'lost_race',
      'reserved',
    ]);
    expect(await countPendingOffersForDriver(driver.driver.id)).toBe(1);
  });
});
