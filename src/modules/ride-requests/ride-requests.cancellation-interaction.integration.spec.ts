import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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
import {
  DispatchOfferModule,
  OfferAcceptanceService,
  OfferReservationService,
} from '../dispatch-offer';
import { DispatchMetricsModule } from '../dispatch-candidate/dispatch-metrics.module';
import { dispatchOffer } from '../dispatch-offer/schema/dispatch-offer.schema';
import { dispatchAttempt } from '../dispatch-offer/schema/dispatch-attempt.schema';
import { dispatchAssignment } from '../dispatch-offer/schema/dispatch-assignment.schema';
import { dispatchCancellation } from '../dispatch-offer/schema/dispatch-cancellation.schema';
import { fareEstimate } from '../fare-estimates/schema';
import { DriverEligibilityService } from '../driver-presence';
import { DriverPresenceLeaseService } from '../driver-presence/driver-presence-lease.service';
import { driverOperationalProfile } from '../driver-presence/schema';
import { DispatchOutboxModule } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { REDIS_CLIENT, RedisModule } from '../redis';
import { RideRequestsService } from './ride-requests.service';
import { rideRequest } from './schema';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';

type DocumentType = typeof documentTable.$inferInsert.documentType;

describe('RideRequestsService cancellation interaction (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let service: RideRequestsService;
  let reservation: OfferReservationService;
  let acceptance: OfferAcceptanceService;
  let db: Database;
  let redis: Redis;
  let leaseService: DriverPresenceLeaseService;
  let pool: Pool;
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  const requestIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();
    process.env.DISPATCH_QUEUE_PREFIX = harness.namespace;
    validateEnv({ ...process.env, DISPATCH_QUEUE_PREFIX: harness.namespace });

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
        DispatchOutboxModule,
        DispatchMetricsModule,
        DispatchOfferModule,
      ],
      providers: [
        RideRequestsService,
        DriverEligibilityService,
        DriverPresenceLeaseService,
      ],
    }).compile();

    service = moduleRef.get(RideRequestsService);
    reservation = moduleRef.get(OfferReservationService);
    acceptance = moduleRef.get(OfferAcceptanceService);
    db = moduleRef.get(DRIZZLE);
    redis = moduleRef.get(REDIS_CLIENT);
    leaseService = moduleRef.get(DriverPresenceLeaseService);
    pool = moduleRef.get<Pool>(PG_POOL);
  });

  afterEach(async () => {
    await harness.cleanupRedisNamespace();
    for (const requestId of requestIds) {
      await db
        .delete(dispatchCancellation)
        .where(eq(dispatchCancellation.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchAssignment)
        .where(eq(dispatchAssignment.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchOffer)
        .where(eq(dispatchOffer.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(rideRequest)
        .where(eq(rideRequest.id, requestId))
        .catch(() => undefined);
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
    await redis?.quit().catch(() => undefined);
    await pool?.end();
    await harness.close();
  });

  const createUser = async (roles: UserRole[] = ['rider']) => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Ride',
        lastName: 'Tester',
        roles,
      })
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
    if (application === undefined)
      throw new Error('failed to create application');
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
    if (activeVehicle === undefined)
      throw new Error('failed to create vehicle');
    const session = await createSession(driver.id);
    await db.insert(driverOperationalProfile).values({
      userId: driver.id,
      operationalState: 'online',
      ownerSessionId: session.id,
      presenceSessionId: `ps-${driver.id}`,
      presenceGeneration: 1,
    });
    const requiredDocuments: readonly DocumentType[] = [
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
    const vehicleDocuments = new Set<DocumentType>([
      'vehicle_ownership',
      'vehicle_photo_front',
      'vehicle_photo_side',
      'vehicle_photo_back',
      'bolo',
      'third_party_insurance',
    ]);
    const expiryTrackedDocuments = new Set<DocumentType>([
      'driver_license_front',
      'driver_license_back',
      'bolo',
      'third_party_insurance',
      'trade_license',
    ]);
    for (const documentType of requiredDocuments) {
      const isVehicleDocument = vehicleDocuments.has(documentType);
      await db.insert(documentTable).values({
        userId: driver.id,
        driverApplicationId: isVehicleDocument ? null : application.id,
        vehicleId: isVehicleDocument ? activeVehicle.id : null,
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

  const createFareEstimate = async (riderId: string) => {
    const [created] = await db
      .insert(fareEstimate)
      .values({
        riderId,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        vehicleType: 'standard',
        currency: 'ETB',
        distanceMeters: 1_250,
        durationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
        expiresAt: new Date(Date.now() + 300_000),
      })
      .returning();

    if (!created) throw new Error('failed to create fare estimate');
    return created;
  };

  const createPendingOffer = async () => {
    const rider = await createUser();
    const { driver } = await createEligibleOnlineDriver();
    const estimate = await createFareEstimate(rider.id);
    const request = await service.create({
      riderId: rider.id,
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: estimate.id,
      idempotencyKey: randomUUID(),
    });
    requestIds.add(request.id);
    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId: request.id, attemptNumber: 1 })
      .returning();
    if (attempt === undefined) throw new Error('failed to create attempt');
    const reserved = await reservation.tryReserve(request.id, attempt.id, {
      driverId: driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });
    if (reserved.status !== 'reserved') {
      throw new Error(`expected reserve success, got ${reserved.status}`);
    }
    return { rider, driver, request, offer: reserved.offer };
  };

  it('cancels an offered request and atomically cancels the pending offer and releases the driver', async () => {
    const { rider, driver, request, offer } = await createPendingOffer();

    const result = await service.cancel(rider.id, request.id);

    expect(result.state).toBe('cancelled');
    const [offerRow] = await db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offer.id));
    expect(offerRow?.state).toBe('cancelled');
    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.id));
    expect(profile?.operationalState).toBe('online');

    const events = await db.select().from(dispatchOutboxEvent);
    expect(
      events.some(
        (e) =>
          e.eventType === 'ride_request.cancelled.v1' &&
          e.aggregateId === request.id,
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.eventType === 'dispatch_offer.cancelled.v1' &&
          e.aggregateId === offer.id,
      ),
    ).toBe(true);
  });

  it('makes accept-versus-cancel produce exactly one valid winner', async () => {
    const { rider, driver, request, offer } = await createPendingOffer();

    const results = await Promise.allSettled([
      service.cancel(rider.id, request.id),
      acceptance.accept(driver.id, offer.id),
    ]);

    const [requestRow] = await db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, request.id));
    const [offerRow] = await db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offer.id));
    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.id));

    const assignedPath =
      requestRow?.state === 'assigned' &&
      offerRow?.state === 'accepted' &&
      profile?.operationalState === 'assigned';
    const cancelledPath =
      requestRow?.state === 'cancelled' &&
      offerRow?.state === 'cancelled' &&
      profile?.operationalState === 'online';

    expect(assignedPath || cancelledPath).toBe(true);
    expect(assignedPath && cancelledPath).toBe(false);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBeGreaterThanOrEqual(1);
  });

  it('keeps duplicate cancellation of an offered request idempotent without duplicate offer-cancel events', async () => {
    const { rider, request, offer } = await createPendingOffer();

    const first = await service.cancel(rider.id, request.id);
    const second = await service.cancel(rider.id, request.id);

    expect(first.state).toBe('cancelled');
    expect(second.state).toBe('cancelled');

    const events = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, offer.id));
    const offerCancelEvents = events.filter(
      (event) => event.eventType === 'dispatch_offer.cancelled.v1',
    );
    expect(offerCancelEvents).toHaveLength(1);
  });

  it('lets the rider cancel after assignment and notifies the assigned driver', async () => {
    const { rider, driver, request, offer } = await createPendingOffer();
    await acceptance.accept(driver.id, offer.id);

    const result = await service.cancel(rider.id, request.id, {
      reasonCode: 'driver_delay',
      notes: 'Driver did not move toward pickup',
    });

    expect(result.state).toBe('cancelled');

    const [offerRow] = await db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offer.id));
    expect(offerRow?.state).toBe('cancelled');

    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.id));
    expect(profile?.operationalState).toBe('online');

    const [assignment] = await db
      .select()
      .from(dispatchAssignment)
      .where(eq(dispatchAssignment.requestId, request.id));
    expect(assignment).toBeDefined();

    const [cancellation] = await db
      .select()
      .from(dispatchCancellation)
      .where(eq(dispatchCancellation.requestId, request.id));
    expect(cancellation).toMatchObject({
      requestId: request.id,
      offerId: offer.id,
      assignmentId: assignment?.id,
      actorUserId: rider.id,
      actorRole: 'rider',
      reasonCode: 'driver_delay',
      notes: 'Driver did not move toward pickup',
    });

    const events = await db.select().from(dispatchOutboxEvent);
    expect(
      events.some(
        (event) =>
          event.eventType === 'dispatch_assignment.cancelled.v1' &&
          event.aggregateId === assignment?.id,
      ),
    ).toBe(true);
  });
});
