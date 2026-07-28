import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
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
  CandidateRankingService,
  type RankedCandidate,
} from '../dispatch-candidate';
import { DriverEligibilityService } from '../driver-presence';
import { DriverPresenceLeaseService } from '../driver-presence/driver-presence-lease.service';
import { driverOperationalProfile } from '../driver-presence/schema';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { fareEstimate } from '../fare-estimates/schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { REDIS_CLIENT, RedisModule } from '../redis';
import { RideRequestsService } from '../ride-requests';
import { rideRequest } from '../ride-requests/schema';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { MatchOrchestrator } from './match-orchestrator.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { OfferCancellationService } from './offer-cancellation.service';
import { OfferExpirationService } from './offer-expiration.service';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';
import { OfferRejectionService } from './offer-rejection.service';
import { OfferReservationService } from './offer-reservation.service';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

const MATCH_RACE_REPEATS = 5;
const COMMAND_RACE_REPEATS = 5;
type DocumentType = typeof documentTable.$inferInsert.documentType;

describe('Dispatch concurrency suite (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let redis: Redis;
  let leaseService: DriverPresenceLeaseService;
  let reservation: OfferReservationService;
  let acceptance: OfferAcceptanceService;
  let rejection: OfferRejectionService;
  let expiration: OfferExpirationService;
  let rideRequests: RideRequestsService;
  let matchOrchestrator: MatchOrchestrator;
  let ranking: jest.Mocked<CandidateRankingService>;
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
      ],
      providers: [
        MatchOrchestrator,
        RideRequestsService,
        OfferReservationService,
        OfferAcceptanceService,
        OfferCancellationService,
        OfferRejectionService,
        OfferExpirationService,
        DispatchOutboxService,
        DriverEligibilityService,
        DriverPresenceLeaseService,
        {
          provide: CandidateRankingService,
          useValue: {
            rankForRequest: jest.fn(),
          },
        },
        {
          provide: OfferExpirationWorkerService,
          useValue: {
            scheduleExpiration: jest.fn().mockResolvedValue({ id: 'mock-job' }),
          },
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    redis = moduleRef.get(REDIS_CLIENT);
    leaseService = moduleRef.get(DriverPresenceLeaseService);
    reservation = moduleRef.get(OfferReservationService);
    acceptance = moduleRef.get(OfferAcceptanceService);
    rejection = moduleRef.get(OfferRejectionService);
    expiration = moduleRef.get(OfferExpirationService);
    rideRequests = moduleRef.get(RideRequestsService);
    matchOrchestrator = moduleRef.get(MatchOrchestrator);
    ranking = moduleRef.get(CandidateRankingService);
  });

  beforeEach(() => {
    jest.resetAllMocks();
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
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, requestId))
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

  const createRequest = async (riderId: string) => {
    const estimate = await createFareEstimate(riderId);
    const result = await rideRequests.create({
      riderId,
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: estimate.id,
      idempotencyKey: randomUUID(),
    });
    requestIds.add(result.id);
    return result;
  };

  const createAttempt = async (requestId: string, attemptNumber = 1) => {
    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({ requestId, attemptNumber })
      .returning();
    if (!attempt) throw new Error('failed to create attempt');
    return attempt;
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

  const createPendingOffer = async () => {
    const rider = await createUser();
    const { driver } = await createEligibleOnlineDriver();
    const request = await createRequest(rider.id);
    const attempt = await createAttempt(request.id);
    const result = await reservation.tryReserve(request.id, attempt.id, {
      driverId: driver.id,
      etaSeconds: 120,
      distanceMeters: 1500,
    });
    if (result.status !== 'reserved') {
      throw new Error(`expected reserve success, got ${result.status}`);
    }
    return { rider, driver, request, offer: result.offer };
  };

  const makeOfferOverdue = async (offerId: string) => {
    const offeredAt = new Date(Date.now() - 30_000);
    await db
      .update(dispatchOffer)
      .set({
        offeredAt,
        expiresAt: new Date(offeredAt.getTime() + 15_000),
        updatedAt: new Date(),
      })
      .where(eq(dispatchOffer.id, offerId));
  };

  const createManualPendingOffer = async (input: {
    requestId: string;
    driverId: string;
    attemptId: string;
  }) => {
    const now = new Date();
    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: input.requestId,
        driverId: input.driverId,
        attemptId: input.attemptId,
        state: 'pending',
        offeredAt: now,
        expiresAt: new Date(now.getTime() + 15_000),
        etaSeconds: 100,
        distanceMeters: 1000,
      })
      .returning();
    if (!offer) throw new Error('failed to create manual pending offer');
    return offer;
  };

  it('keeps duplicate match jobs harmless across repeated runs', async () => {
    const rider = await createUser();
    const request = await createRequest(rider.id);
    const candidate: RankedCandidate = {
      driverId: randomUUID(),
      etaSeconds: 120,
      distanceMeters: 1500,
    };

    for (let i = 0; i < MATCH_RACE_REPEATS; i += 1) {
      const gate = (() => {
        let resolve: (() => void) | undefined;
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        if (resolve === undefined) throw new Error('failed to create gate');
        return { promise, resolve };
      })();
      let rankingCalls = 0;
      ranking.rankForRequest.mockImplementation(async () => {
        rankingCalls += 1;
        if (rankingCalls === 2) gate.resolve();
        await gate.promise;
        return [candidate];
      });
      const results = await Promise.all([
        matchOrchestrator.attemptMatch(request.id),
        matchOrchestrator.attemptMatch(request.id),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'no_driver_found',
        'noop',
      ]);
      await db
        .update(rideRequest)
        .set({ state: 'searching', updatedAt: new Date() })
        .where(eq(rideRequest.id, request.id));
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, request.id));
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, request.id));
      ranking.rankForRequest.mockReset();
    }
  });

  it('prevents one request from ending with two accepted drivers', async () => {
    const first = await createPendingOffer();
    await acceptance.accept(first.driver.id, first.offer.id);

    const { driver: secondDriver, session: secondDriverSession } =
      await createEligibleOnlineDriver();
    await db
      .update(driverOperationalProfile)
      .set({
        operationalState: 'offered',
        ownerSessionId: secondDriverSession.id,
        presenceSessionId: `manual-${secondDriver.id}`,
        presenceGeneration: 1,
        updatedAt: new Date(),
      })
      .where(eq(driverOperationalProfile.userId, secondDriver.id));
    const attempt = await createAttempt(first.request.id, 2);
    const conflictingOffer = await createManualPendingOffer({
      requestId: first.request.id,
      driverId: secondDriver.id,
      attemptId: attempt.id,
    });

    await expect(
      acceptance.accept(secondDriver.id, conflictingOffer.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents one driver from ending with two accepted requests', async () => {
    const first = await createPendingOffer();
    await acceptance.accept(first.driver.id, first.offer.id);

    const rider2 = await createUser();
    const request2 = await createRequest(rider2.id);
    await db
      .update(rideRequest)
      .set({ state: 'offered', updatedAt: new Date() })
      .where(eq(rideRequest.id, request2.id));
    const attempt2 = await createAttempt(request2.id, 1);
    const conflictingOffer = await createManualPendingOffer({
      requestId: request2.id,
      driverId: first.driver.id,
      attemptId: attempt2.id,
    });

    await expect(
      acceptance.accept(first.driver.id, conflictingOffer.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('produces one valid winner for accept versus expiration across repeated runs', async () => {
    for (let i = 0; i < COMMAND_RACE_REPEATS; i += 1) {
      const { driver, request, offer } = await createPendingOffer();
      await makeOfferOverdue(offer.id);

      const results = await Promise.allSettled([
        acceptance.accept(driver.id, offer.id),
        expiration.expire(offer.id),
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

      expect(offerRow?.state).toBe('expired');
      expect(requestRow?.state).toBe('searching');
      expect(profile?.operationalState).toBe('online');
      expect(
        results.filter((result) => result.status === 'fulfilled').length,
      ).toBe(1);
    }
  });

  it('produces one valid winner for accept versus cancellation across repeated runs', async () => {
    for (let i = 0; i < COMMAND_RACE_REPEATS; i += 1) {
      const { rider, driver, request, offer } = await createPendingOffer();

      await Promise.allSettled([
        rideRequests.cancel(rider.id, request.id),
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
    }
  });

  it('produces one valid winner for reject versus expiration across repeated runs', async () => {
    for (let i = 0; i < COMMAND_RACE_REPEATS; i += 1) {
      const { driver, request, offer } = await createPendingOffer();
      await makeOfferOverdue(offer.id);

      await Promise.allSettled([
        rejection.reject(driver.id, offer.id),
        expiration.expire(offer.id),
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

      const rejectedPath =
        requestRow?.state === 'searching' &&
        offerRow?.state === 'rejected' &&
        profile?.operationalState === 'online';
      const expiredPath =
        requestRow?.state === 'searching' &&
        offerRow?.state === 'expired' &&
        profile?.operationalState === 'online';

      expect(rejectedPath || expiredPath).toBe(true);
      expect(rejectedPath && expiredPath).toBe(false);
    }
  });

  it('keeps duplicate commands idempotent across repeated accept/reject/expire races', async () => {
    for (let i = 0; i < COMMAND_RACE_REPEATS; i += 1) {
      const accepted = await createPendingOffer();
      const acceptedResults = await Promise.all([
        acceptance.accept(accepted.driver.id, accepted.offer.id),
        acceptance.accept(accepted.driver.id, accepted.offer.id),
      ]);
      expect(acceptedResults.map((result) => result.state)).toEqual([
        'accepted',
        'accepted',
      ]);

      const rejected = await createPendingOffer();
      const rejectedResults = await Promise.all([
        rejection.reject(rejected.driver.id, rejected.offer.id),
        rejection.reject(rejected.driver.id, rejected.offer.id),
      ]);
      expect(rejectedResults.map((result) => result.state)).toEqual([
        'rejected',
        'rejected',
      ]);

      const expired = await createPendingOffer();
      await makeOfferOverdue(expired.offer.id);
      const expiredResults = await Promise.all([
        expiration.expire(expired.offer.id),
        expiration.expire(expired.offer.id),
      ]);
      expect(expiredResults.map((result) => result.state)).toEqual([
        'expired',
        'expired',
      ]);
    }
  });
});
