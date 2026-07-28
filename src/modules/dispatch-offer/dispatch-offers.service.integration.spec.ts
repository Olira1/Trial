import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  authConfig,
  databaseConfig,
  dispatchConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
} from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { user } from '../user';
import { fareEstimate } from '../fare-estimates/schema';
import { rideRequest } from '../ride-requests/schema';
import { DispatchOffersService } from './dispatch-offers.service';
import {
  dispatchAssignment,
  dispatchAssignmentPickup,
  dispatchAssignmentTrip,
  dispatchAttempt,
  dispatchCancellation,
  dispatchOffer,
} from './schema';

describe('DispatchOffersService (integration)', () => {
  let moduleRef: TestingModule;
  let service: DispatchOffersService;
  let db: Database;
  let pool: Pool;
  const userIds = new Set<string>();

  beforeAll(async () => {
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
      ],
      providers: [DispatchOffersService],
    }).compile();

    service = moduleRef.get(DispatchOffersService);
    db = moduleRef.get<Database>(DRIZZLE);
    pool = moduleRef.get<Pool>(PG_POOL);
  });

  afterEach(async () => {
    for (const userId of userIds) {
      await db
        .delete(dispatchOffer)
        .where(eq(dispatchOffer.driverId, userId))
        .catch(() => undefined);
      await db
        .delete(rideRequest)
        .where(eq(rideRequest.riderId, userId))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
  });

  afterAll(async () => {
    await pool?.end();
  });

  const createUser = async (role: 'rider' | 'driver') => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: role === 'driver' ? 'Offer' : 'Ride',
        lastName: role === 'driver' ? 'Driver' : 'Rider',
        roles: [role],
      })
      .returning();

    if (!created) throw new Error('test setup failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createOffer = async (
    state: typeof dispatchOffer.$inferSelect.state,
  ) => {
    const rider = await createUser('rider');
    const driver = await createUser('driver');
    const now = new Date();
    const [estimate] = await db
      .insert(fareEstimate)
      .values({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        vehicleType: 'standard',
        currency: 'ETB',
        distanceMeters: 1_250,
        durationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
        expiresAt: new Date(now.getTime() + 300_000),
      })
      .returning();
    if (!estimate) throw new Error('test setup failed to create estimate');

    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: state === 'accepted' ? 'assigned' : 'offered',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        vehicleType: 'standard',
        rideType: 'instant',
        currency: 'ETB',
        distanceMeters: 1_250,
        durationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(now.getTime() + 90_000),
      })
      .returning();
    if (!request) throw new Error('test setup failed to create request');

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({
        requestId: request.id,
        attemptNumber: 1,
        state: 'completed',
        startedAt: new Date(now.getTime() - 1_000),
        finishedAt: now,
      })
      .returning();
    if (!attempt) throw new Error('test setup failed to create attempt');

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: request.id,
        attemptId: attempt.id,
        driverId: driver.id,
        state,
        expiresAt: new Date(now.getTime() + 15_000),
        respondedAt: state === 'pending' ? null : now,
        etaSeconds: 180,
        distanceMeters: 1_250,
      })
      .returning();
    if (!offer) throw new Error('test setup failed to create offer');

    const [assignment] =
      state === 'accepted'
        ? await db
            .insert(dispatchAssignment)
            .values({
              requestId: request.id,
              offerId: offer.id,
              riderId: rider.id,
              driverId: driver.id,
              assignedAt: now,
              driverFullName: 'Offer Driver',
              driverPhone: '+251911000333',
              driverRating: 5,
              vehicleMake: 'Toyota',
              vehicleModel: 'Vitz',
              vehicleColor: 'white',
              vehiclePlateRegion: 'aa',
              vehiclePlateCode: '01',
              vehiclePlateNumber: 'ABC123',
            })
            .returning()
        : [null];

    return { driver, offer, request, assignment };
  };

  const seedHistoryRequest = async (params: {
    riderId: string;
    driverId: string;
    state: 'cancelled' | 'assigned' | 'completed';
    withCancellation: boolean;
    updatedAt: Date;
  }) => {
    const now = params.updatedAt;
    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: params.riderId,
        state: params.state,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: null,
        vehicleType: null,
        rideType: null,
        currency: null,
        distanceMeters: null,
        durationSeconds: null,
        rateMinorPerKm: null,
        estimatedFareMinor: null,
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(now.getTime() + 90_000),
        updatedAt: now,
      })
      .returning();
    if (!request)
      throw new Error('test setup failed to create history request');

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({
        requestId: request.id,
        attemptNumber: 1,
        state: 'completed',
        startedAt: new Date(now.getTime() - 1_000),
        finishedAt: now,
      })
      .returning();
    if (!attempt)
      throw new Error('test setup failed to create history attempt');

    const [offer] = await db
      .insert(dispatchOffer)
      .values({
        requestId: request.id,
        attemptId: attempt.id,
        driverId: params.driverId,
        state: params.state === 'cancelled' ? 'cancelled' : 'accepted',
        offeredAt: now,
        expiresAt: new Date(now.getTime() + 15_000),
        respondedAt: now,
        etaSeconds: 180,
        distanceMeters: 1_250,
      })
      .returning();
    if (!offer) throw new Error('test setup failed to create history offer');

    const [assignment] = await db
      .insert(dispatchAssignment)
      .values({
        requestId: request.id,
        offerId: offer.id,
        riderId: params.riderId,
        driverId: params.driverId,
        assignedAt: now,
        driverFullName: 'History Driver',
        driverPhone: '+251911000333',
        driverRating: 5,
        vehicleMake: 'Toyota',
        vehicleModel: 'Vitz',
        vehicleColor: 'white',
        vehiclePlateRegion: 'aa',
        vehiclePlateCode: '01',
        vehiclePlateNumber: 'ABC123',
      })
      .returning();
    if (!assignment)
      throw new Error('test setup failed to create history assignment');

    if (params.withCancellation) {
      const [cancellation] = await db
        .insert(dispatchCancellation)
        .values({
          requestId: request.id,
          offerId: offer.id,
          assignmentId: assignment.id,
          actorUserId: params.driverId,
          actorRole: 'driver',
          reasonCode: 'driver_requested',
          notes: 'vehicle issue',
        })
        .returning();
      if (!cancellation)
        throw new Error('test setup failed to create history cancellation');
    }

    if (params.state === 'completed') {
      await db.insert(dispatchAssignmentTrip).values({
        assignmentId: assignment.id,
        requestId: request.id,
        offerId: offer.id,
        riderId: params.riderId,
        driverId: params.driverId,
        state: 'completed',
        startedAt: new Date(now.getTime() - 120_000),
        completedAt: now,
      });
    }

    await db
      .update(rideRequest)
      .set({ state: params.state, updatedAt: now })
      .where(eq(rideRequest.id, request.id));

    return { request, offer, assignment };
  };

  it.each(['pending', 'accepted'] as const)(
    'returns the current %s offer with route endpoints',
    async (state) => {
      const { driver, offer, request, assignment } = await createOffer(state);

      const result = await service.findCurrentForDriver(driver.id);

      expect(result).toMatchObject({
        id: offer.id,
        assignmentId: assignment?.id ?? null,
        driverId: driver.id,
        state,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: request.fareEstimateId,
        vehicleType: 'standard',
        rideType: 'instant',
        currency: 'ETB',
        tripDistanceMeters: 1_250,
        tripDurationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
        etaSeconds: 180,
        distanceMeters: 1_250,
      });
    },
  );

  it('returns an owned offer by id with route endpoints', async () => {
    const { driver, offer, request, assignment } = await createOffer('pending');

    const result = await service.findOfferByIdForDriver(driver.id, offer.id);

    expect(result).toMatchObject({
      id: offer.id,
      assignmentId: assignment?.id ?? null,
      driverId: driver.id,
      state: 'pending',
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: request.fareEstimateId,
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      tripDistanceMeters: 1_250,
      tripDurationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      etaSeconds: 180,
      distanceMeters: 1_250,
    });
  });

  it('returns an owned terminal offer by id', async () => {
    const { driver, offer } = await createOffer('rejected');

    const result = await service.findOfferByIdForDriver(driver.id, offer.id);

    expect(result).toMatchObject({
      id: offer.id,
      driverId: driver.id,
      state: 'rejected',
      assignmentId: null,
    });
  });

  it('does not expose another driver offer by id', async () => {
    const { offer } = await createOffer('pending');
    const otherDriver = await createUser('driver');

    await expect(
      service.findOfferByIdForDriver(otherDriver.id, offer.id),
    ).rejects.toThrow('dispatch offer not found');
  });

  it('returns the authenticated driver active assignment', async () => {
    const { driver, offer, request, assignment } =
      await createOffer('accepted');
    if (!assignment) throw new Error('test setup expected assignment');

    const result = await service.findActiveAssignmentForDriver(driver.id);

    expect(result).toMatchObject({
      id: assignment.id,
      assignmentId: assignment.id,
      offerId: offer.id,
      requestId: request.id,
      riderId: request.riderId,
      driverId: driver.id,
      state: 'assigned',
      status: 'assigned',
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      driver: {
        id: driver.id,
        fullName: 'Offer Driver',
        phone: '+251911000333',
        rating: 5,
      },
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        plateRegion: 'aa',
        plateCode: '01',
        plateCodeSubtype: null,
        plateNumber: 'ABC123',
      },
      pickup: null,
    });
  });

  it('includes pickup state in the active assignment', async () => {
    const { driver, assignment } = await createOffer('accepted');
    if (!assignment) throw new Error('test setup expected assignment');
    const arrivedAt = new Date();
    const dueAt = new Date(arrivedAt.getTime() + 60_000);

    const [pickup] = await db
      .insert(dispatchAssignmentPickup)
      .values({
        assignmentId: assignment.id,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId: assignment.driverId,
        state: 'arrived',
        arrivedAt,
        warningDueAt: dueAt,
        noShowCancellableAt: dueAt,
      })
      .returning();
    if (!pickup) throw new Error('test setup failed to create pickup');

    const result = await service.findActiveAssignmentForDriver(driver.id);

    expect(result?.pickup).toMatchObject({
      id: pickup.id,
      state: 'arrived',
      arrivedAt: pickup.arrivedAt,
      warningDueAt: pickup.warningDueAt,
      noShowCancellableAt: pickup.noShowCancellableAt,
      warningSentAt: null,
      noShowCancelledAt: null,
    });
  });

  it('includes trip state in the active assignment', async () => {
    const { driver, assignment } = await createOffer('accepted');
    if (!assignment) throw new Error('test setup expected assignment');
    const startedAt = new Date();

    const [trip] = await db
      .insert(dispatchAssignmentTrip)
      .values({
        assignmentId: assignment.id,
        requestId: assignment.requestId,
        offerId: assignment.offerId,
        riderId: assignment.riderId,
        driverId: assignment.driverId,
        state: 'started',
        startedAt,
      })
      .returning();
    if (!trip) throw new Error('test setup failed to create trip');

    const result = await service.findActiveAssignmentForDriver(driver.id);

    expect(result?.trip).toMatchObject({
      id: trip.id,
      state: 'started',
      startedAt: trip.startedAt,
      completedAt: null,
    });
  });

  it('returns null when the driver has no active assignment', async () => {
    const { driver } = await createOffer('rejected');

    await expect(
      service.findActiveAssignmentForDriver(driver.id),
    ).resolves.toBeNull();
  });

  it('returns null when an assignment is no longer active', async () => {
    const { driver, offer, request } = await createOffer('accepted');

    await db
      .update(dispatchOffer)
      .set({ state: 'cancelled', updatedAt: new Date() })
      .where(eq(dispatchOffer.id, offer.id));
    await db
      .update(rideRequest)
      .set({ state: 'cancelled', updatedAt: new Date() })
      .where(eq(rideRequest.id, request.id));

    await expect(
      service.findActiveAssignmentForDriver(driver.id),
    ).resolves.toBeNull();
  });

  it('does not return an accepted offer whose request completed', async () => {
    const { driver, request } = await createOffer('accepted');

    await db
      .update(rideRequest)
      .set({ state: 'completed', updatedAt: new Date() })
      .where(eq(rideRequest.id, request.id));

    await expect(service.findCurrentForDriver(driver.id)).resolves.toBeNull();
  });

  it('returns null when the driver has only a terminal non-accepted offer', async () => {
    const { driver } = await createOffer('rejected');

    await expect(service.findCurrentForDriver(driver.id)).resolves.toBeNull();
  });

  it('returns bounded terminal ride history newest first', async () => {
    const rider = await createUser('rider');
    const driver = await createUser('driver');
    const older = await seedHistoryRequest({
      riderId: rider.id,
      driverId: driver.id,
      state: 'cancelled',
      withCancellation: true,
      updatedAt: new Date(Date.now() - 60_000),
    });
    const newer = await seedHistoryRequest({
      riderId: rider.id,
      driverId: driver.id,
      state: 'cancelled',
      withCancellation: false,
      updatedAt: new Date(),
    });
    const completed = await seedHistoryRequest({
      riderId: rider.id,
      driverId: driver.id,
      state: 'completed',
      withCancellation: false,
      updatedAt: new Date(Date.now() + 120_000),
    });
    await seedHistoryRequest({
      riderId: rider.id,
      driverId: driver.id,
      state: 'assigned',
      withCancellation: false,
      updatedAt: new Date(Date.now() + 60_000),
    });

    const history = await service.findHistoryForDriver(driver.id, {
      limit: 20,
      offset: 0,
    });

    expect(history.total).toBe(3);
    expect(history.items).toHaveLength(3);
    expect(history.items[0]?.id).toBe(completed.request.id);
    expect(history.items[1]?.id).toBe(newer.request.id);
    expect(history.items[2]?.id).toBe(older.request.id);
    expect(history.items[0]?.state).toBe('completed');
    expect(history.items[0]?.assignment?.trip).toMatchObject({
      state: 'completed',
    });
    expect(history.items[1]?.cancellation).toBeNull();
  });
});
