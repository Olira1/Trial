import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { driverOperationalProfile } from '../driver-presence/schema';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { REDIS_CLIENT, RedisModule } from '../redis';
import { rideRequest } from '../ride-requests/schema';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { OfferRejectionService } from './offer-rejection.service';
import { OfferReservationService } from './offer-reservation.service';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;

describe('OfferRejectionService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let redis: Redis;
  let leaseService: DriverPresenceLeaseService;
  let reservation: OfferReservationService;
  let service: OfferRejectionService;
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
        OfferRejectionService,
        OfferReservationService,
        DispatchOutboxService,
        DriverEligibilityService,
        DriverPresenceLeaseService,
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    redis = moduleRef.get(REDIS_CLIENT);
    leaseService = moduleRef.get(DriverPresenceLeaseService);
    reservation = moduleRef.get(OfferReservationService);
    service = moduleRef.get(OfferRejectionService);
  });

  afterEach(async () => {
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
    await db.insert(driverOperationalProfile).values({
      userId: driver.id,
      operationalState: 'online',
      ownerSessionId: session.id,
      presenceSessionId: `ps-${driver.id}`,
      presenceGeneration: 1,
    });

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

    await leaseService.createInitialLease({
      userId: driver.id,
      ownerSessionId: session.id,
      presenceSessionId: `ps-${driver.id}`,
      presenceGeneration: 1,
      location: {
        latitude: 9.021,
        longitude: 38.751,
        accuracyMeters: 10,
        capturedAt: new Date(),
      },
    });

    return { driver, session };
  };

  const createPendingOffer = async () => {
    const rider = await createUser();
    const { driver } = await createEligibleOnlineDriver();
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    const result = await reservation.tryReserve(requestId, attemptId, {
      driverId: driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });
    if (result.status !== 'reserved') {
      throw new Error(`expected reserve success, received ${result.status}`);
    }

    return {
      riderId: rider.id,
      driverId: driver.id,
      requestId,
      offer: result.offer,
    };
  };

  const countEventType = async (aggregateId: string, eventType: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_outbox_event"
      WHERE "aggregate_id" = ${aggregateId}
        AND "event_type" = ${eventType}
    `);
    return Number(result.rows[0]?.count ?? 0);
  };

  it('rejects a valid pending offer and atomically releases driver and request', async () => {
    const { driverId, requestId, offer } = await createPendingOffer();

    const rejected = await service.reject(driverId, offer.id);

    expect(rejected.state).toBe('rejected');
    expect(rejected.respondedAt).toBeInstanceOf(Date);

    const [request] = await db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, requestId));
    expect(request?.state).toBe('searching');

    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driverId));
    expect(profile?.operationalState).toBe('online');

    expect(await countEventType(offer.id, 'dispatch_offer.rejected.v1')).toBe(
      1,
    );
  });

  it('returns the rejected snapshot for duplicate reject by the owning driver', async () => {
    const { driverId, offer } = await createPendingOffer();

    const first = await service.reject(driverId, offer.id);
    const second = await service.reject(driverId, offer.id);

    expect(first.state).toBe('rejected');
    expect(second.state).toBe('rejected');
    expect(first.id).toBe(second.id);
    expect(await countEventType(offer.id, 'dispatch_offer.rejected.v1')).toBe(
      1,
    );
  });

  it('rejects a wrong driver', async () => {
    const { offer } = await createPendingOffer();
    const wrongDriver = await createUser(['driver']);

    await expect(
      service.reject(wrongDriver.id, offer.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when acceptance already committed first', async () => {
    const { driverId, offer, requestId } = await createPendingOffer();
    const now = new Date();
    await db
      .update(dispatchOffer)
      .set({ state: 'accepted', respondedAt: now, updatedAt: now })
      .where(eq(dispatchOffer.id, offer.id));
    await db
      .update(rideRequest)
      .set({ state: 'assigned', updatedAt: now })
      .where(eq(rideRequest.id, requestId));
    await db
      .update(driverOperationalProfile)
      .set({ operationalState: 'assigned', updatedAt: now })
      .where(eq(driverOperationalProfile.userId, driverId));

    await expect(service.reject(driverId, offer.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects when the request is no longer offered', async () => {
    const { driverId, requestId, offer } = await createPendingOffer();
    await db
      .update(rideRequest)
      .set({ state: 'cancelled', updatedAt: new Date() })
      .where(eq(rideRequest.id, requestId));

    await expect(service.reject(driverId, offer.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects when the driver is no longer offered', async () => {
    const { driverId, offer } = await createPendingOffer();
    await db
      .update(driverOperationalProfile)
      .set({ operationalState: 'online', updatedAt: new Date() })
      .where(eq(driverOperationalProfile.userId, driverId));

    await expect(service.reject(driverId, offer.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('makes concurrent duplicate rejects idempotent for the owning driver', async () => {
    const { driverId, offer } = await createPendingOffer();

    const results = await Promise.all([
      service.reject(driverId, offer.id),
      service.reject(driverId, offer.id),
    ]);

    expect(results.map((result) => result.state)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(await countEventType(offer.id, 'dispatch_offer.rejected.v1')).toBe(
      1,
    );
  });
});
