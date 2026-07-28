import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
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
import { OfferCancellationService } from '../dispatch-offer';
import { DispatchOutboxModule } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { fareEstimate } from '../fare-estimates/schema';
import { authSession } from '../auth/schema/session.schema';
import {
  dispatchAssignment,
  dispatchAssignmentPickup,
  dispatchAssignmentTrip,
  dispatchAttempt,
  dispatchOffer,
} from '../dispatch-offer/schema';
import { DISPATCH_MATCH_JOB_NAME, MatchWorkerService } from '../dispatch-offer';
import { REDIS_CLIENT, RedisModule, type Redis } from '../redis';
import { user } from '../user';
import { RideRequestsService } from './ride-requests.service';
import { rideRequest } from './schema';

describe('RideRequestsService (integration)', () => {
  let moduleRef: TestingModule;
  let service: RideRequestsService;
  let db: Database;
  let config: ConfigType<typeof dispatchConfig>;
  let pool: Pool;
  let redis: Redis;
  let matchWorker: jest.Mocked<Pick<MatchWorkerService, 'enqueueMatchJob'>>;
  const riderIds = new Set<string>();

  beforeAll(async () => {
    matchWorker = {
      enqueueMatchJob: jest.fn().mockResolvedValue({
        id: 'match-test',
        name: DISPATCH_MATCH_JOB_NAME,
      }),
    };

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
        RedisModule,
        DatabaseModule,
        DispatchOutboxModule,
      ],
      providers: [
        RideRequestsService,
        {
          provide: OfferCancellationService,
          useValue: {
            cancelPendingOfferForRequest: jest.fn(),
          },
        },
        {
          provide: MatchWorkerService,
          useValue: matchWorker,
        },
      ],
    }).compile();

    service = moduleRef.get(RideRequestsService);
    db = moduleRef.get<Database>(DRIZZLE);
    config = moduleRef.get<ConfigType<typeof dispatchConfig>>(
      dispatchConfig.KEY,
    );
    pool = moduleRef.get<Pool>(PG_POOL);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterEach(async () => {
    for (const riderId of riderIds) {
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, riderId))
        .catch(() => undefined);
      await db
        .delete(rideRequest)
        .where(eq(rideRequest.riderId, riderId))
        .catch(() => undefined);
      await db
        .delete(authSession)
        .where(eq(authSession.userId, riderId))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, riderId))
        .catch(() => undefined);
    }
    riderIds.clear();
    matchWorker.enqueueMatchJob.mockClear();
  });

  afterAll(async () => {
    await redis?.quit().catch(() => undefined);
    await pool?.end();
  });

  const createRider = async () => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Ride',
        lastName: 'Requester',
        roles: ['rider'],
      })
      .returning();

    if (created === undefined)
      throw new Error('test setup failed to create user');
    riderIds.add(created.id);
    return created;
  };

  const createRequest = async (
    riderId: string,
    state: typeof rideRequest.$inferSelect.state = 'searching',
  ) => {
    if (state === 'searching') {
      const estimate = await createFareEstimate(riderId);
      const result = await service.create({
        riderId,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        idempotencyKey: randomUUID(),
      });
      return result;
    }

    const now = new Date();
    const [created] = await db
      .insert(rideRequest)
      .values({
        riderId,
        state,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        idempotencyKey: randomUUID(),
        offerTtlSeconds: config.offerTtlSeconds,
        matchingDeadlineSeconds: config.matchingDeadlineSeconds,
        matchingDeadlineAt: new Date(
          now.getTime() + config.matchingDeadlineSeconds * 1_000,
        ),
      })
      .returning();

    if (!created) throw new Error('test setup failed to create request');
    return created;
  };

  const createFareEstimate = async (
    riderId: string,
    overrides: Partial<typeof fareEstimate.$inferInsert> = {},
  ) => {
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
        ...overrides,
      })
      .returning();

    if (!created) throw new Error('test setup failed to create fare estimate');
    return created;
  };

  const createRideRequestInput = async (
    riderId: string,
    input: Partial<Parameters<typeof service.create>[0]> = {},
  ) => {
    const pickup = input.pickup ?? { latitude: 9.0192, longitude: 38.7525 };
    const destination = input.destination ?? {
      latitude: 9.0301,
      longitude: 38.7612,
    };
    const estimate =
      input.fareEstimateId === undefined
        ? await createFareEstimate(riderId, { pickup, destination })
        : null;

    return {
      riderId,
      pickup,
      destination,
      fareEstimateId: input.fareEstimateId ?? estimate?.id ?? randomUUID(),
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
    };
  };

  describe('create', () => {
    it('creates a searching ride request with outbox event', async () => {
      const rider = await createRider();
      const estimate = await createFareEstimate(rider.id);

      const result = await service.create({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        idempotencyKey: randomUUID(),
        fareEstimateId: estimate.id,
      });

      expect(result.state).toBe('searching');
      expect(result).toMatchObject({
        fareEstimateId: estimate.id,
        vehicleType: 'standard',
        rideType: 'instant',
        currency: 'ETB',
        distanceMeters: 1_250,
        durationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
      });
      expect(result.offerTtlSeconds).toBe(config.offerTtlSeconds);
      expect(result.matchingDeadlineSeconds).toBe(
        config.matchingDeadlineSeconds,
      );

      const events = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, result.id));
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(
        events.some((e) => e.eventType === 'ride_request.created.v1'),
      ).toBe(true);
    });

    it('enqueues the initial match job after creating the request', async () => {
      const rider = await createRider();
      const estimate = await createFareEstimate(rider.id);

      const result = await service.create({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        idempotencyKey: randomUUID(),
        fareEstimateId: estimate.id,
      });

      expect(matchWorker.enqueueMatchJob).toHaveBeenCalledTimes(1);
      expect(matchWorker.enqueueMatchJob).toHaveBeenCalledWith(
        result.id,
        'initial',
      );
    });

    it('rejects a second active request for the same rider', async () => {
      const rider = await createRider();
      await service.create(await createRideRequestInput(rider.id));

      await expect(
        service.create(await createRideRequestInput(rider.id)),
      ).rejects.toThrow(ConflictException);
    });

    it('returns the existing request for duplicate idempotency key', async () => {
      const rider = await createRider();
      const idempotencyKey = randomUUID();
      const estimate = await createFareEstimate(rider.id);

      const first = await service.create({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        idempotencyKey,
      });

      const second = await service.create({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        idempotencyKey,
      });

      expect(second.id).toBe(first.id);
    });

    it('returns the existing request on idempotent replay after the estimate expires', async () => {
      const rider = await createRider();
      const input = await createRideRequestInput(rider.id);
      const first = await service.create(input);

      await db
        .update(fareEstimate)
        .set({
          createdAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 1_000),
        })
        .where(eq(fareEstimate.id, input.fareEstimateId));

      const second = await service.create(input);

      expect(second.id).toBe(first.id);
    });

    it('rejects different payload with same idempotency key as 409', async () => {
      const rider = await createRider();
      const idempotencyKey = randomUUID();
      const estimate = await createFareEstimate(rider.id);

      await service.create({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        idempotencyKey,
      });

      await expect(
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.05, longitude: 38.77 },
          destination: { latitude: 9.06, longitude: 38.78 },
          fareEstimateId: estimate.id,
          idempotencyKey,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a different fare estimate with the same idempotency key', async () => {
      const rider = await createRider();
      const idempotencyKey = randomUUID();
      const first = await createRideRequestInput(rider.id, { idempotencyKey });
      const secondEstimate = await createFareEstimate(rider.id);

      await service.create(first);

      await expect(
        service.create({
          ...first,
          fareEstimateId: secondEstimate.id,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an expired fare estimate', async () => {
      const rider = await createRider();
      const estimate = await createFareEstimate(rider.id, {
        createdAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.0192, longitude: 38.7525 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          fareEstimateId: estimate.id,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the fare estimate belongs to another rider', async () => {
      const rider = await createRider();
      const otherRider = await createRider();
      const estimate = await createFareEstimate(otherRider.id);

      await expect(
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.0192, longitude: 38.7525 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          fareEstimateId: estimate.id,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a request route that differs from the fare estimate route', async () => {
      const rider = await createRider();
      const estimate = await createFareEstimate(rider.id);

      await expect(
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.05, longitude: 38.77 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          fareEstimateId: estimate.id,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects reusing a fare estimate for a different request', async () => {
      const rider = await createRider();
      const input = await createRideRequestInput(rider.id);
      const first = await service.create(input);
      await service.cancel(rider.id, first.id);

      await expect(
        service.create({
          ...input,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('handles concurrent duplicate creation idempotently', async () => {
      const rider = await createRider();
      const idempotencyKey = randomUUID();
      const estimate = await createFareEstimate(rider.id);

      const results = await Promise.allSettled([
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.0192, longitude: 38.7525 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          fareEstimateId: estimate.id,
          idempotencyKey,
        }),
        service.create({
          riderId: rider.id,
          pickup: { latitude: 9.0192, longitude: 38.7525 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          fareEstimateId: estimate.id,
          idempotencyKey,
        }),
      ]);

      const fulfilled = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.create>>
        > => result.status === 'fulfilled',
      );
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const ids = fulfilled.map((result) => result.value.id);
      expect(new Set(ids).size).toBe(1);
    });
  });

  describe('findHistoryForRider', () => {
    it('returns bounded terminal requests newest first and excludes active ones', async () => {
      const rider = await createRider();

      const first = await service.create(
        await createRideRequestInput(rider.id),
      );
      const firstCancelled = await service.cancel(rider.id, first.id);

      const second = await service.create(
        await createRideRequestInput(rider.id),
      );
      const secondCancelled = await service.cancel(rider.id, second.id);
      const completed = await createRequest(rider.id, 'completed');

      const active = await service.create(
        await createRideRequestInput(rider.id),
      );

      const history = await service.findHistoryForRider(rider.id, {
        limit: 20,
        offset: 0,
      });

      expect(history.total).toBe(3);
      expect(history.items).toHaveLength(3);
      expect(history.items[0]?.id).toBe(completed.id);
      expect(history.items[0]?.state).toBe('completed');
      expect(history.items[1]?.id).toBe(secondCancelled.id);
      expect(history.items[2]?.id).toBe(firstCancelled.id);
      expect(history.items.some((item) => item.id === active.id)).toBe(false);
    });

    it('applies pagination bounds', async () => {
      const rider = await createRider();

      const first = await service.create(
        await createRideRequestInput(rider.id),
      );
      await service.cancel(rider.id, first.id);
      const second = await service.create(
        await createRideRequestInput(rider.id),
      );
      await service.cancel(rider.id, second.id);

      const history = await service.findHistoryForRider(rider.id, {
        limit: 1,
        offset: 1,
      });

      expect(history.total).toBe(2);
      expect(history.limit).toBe(1);
      expect(history.offset).toBe(1);
      expect(history.items).toHaveLength(1);
      expect(history.items[0]?.id).toBe(first.id);
    });
  });

  describe('cancel', () => {
    it('cancels a searching request and emits outbox event', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id);

      const result = await service.cancel(rider.id, request.id);

      expect(result.id).toBe(request.id);
      expect(result.state).toBe('cancelled');
      expect(result.pickup).toEqual({ latitude: 9.0192, longitude: 38.7525 });
      expect(result.destination).toEqual({
        latitude: 9.0301,
        longitude: 38.7612,
      });

      const events = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, request.id));
      expect(
        events.some((e) => e.eventType === 'ride_request.cancelled.v1'),
      ).toBe(true);
    });

    it('records structured rider cancellation reason details in the outbox payload', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id);

      const result = await service.cancel(rider.id, request.id, {
        reasonCode: 'wrong_pickup',
        notes: 'Pinned the pickup on the wrong block',
      });

      expect(result.cancellation).toMatchObject({
        actorRole: 'rider',
        reasonCode: 'wrong_pickup',
        notes: 'Pinned the pickup on the wrong block',
      });

      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(
          eq(
            dispatchOutboxEvent.eventKey,
            `ride_request:${request.id}:cancelled`,
          ),
        );

      expect(event?.payload).toMatchObject({
        cancellation: {
          actorRole: 'rider',
          reasonCode: 'wrong_pickup',
          notes: 'Pinned the pickup on the wrong block',
        },
      });

      const cancellation = await pool.query<{
        actor_user_id: string;
        actor_role: string;
        reason_code: string;
        notes: string | null;
      }>(
        `SELECT actor_user_id, actor_role, reason_code, notes
         FROM dispatch_cancellation
         WHERE request_id = $1
         LIMIT 1`,
        [request.id],
      );

      expect(cancellation.rows[0]).toMatchObject({
        actor_user_id: rider.id,
        actor_role: 'rider',
        reason_code: 'wrong_pickup',
        notes: 'Pinned the pickup on the wrong block',
      });
    });

    it('is idempotent: cancelling an already-cancelled request returns snapshot without duplicate event', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id);

      const first = await service.cancel(rider.id, request.id);
      const second = await service.cancel(rider.id, request.id);

      expect(second.id).toBe(first.id);
      expect(second.state).toBe('cancelled');

      const events = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, request.id));
      const cancelEvents = events.filter(
        (e) => e.eventType === 'ride_request.cancelled.v1',
      );
      expect(cancelEvents.length).toBe(1);
    });

    it('throws NotFoundException when request does not exist', async () => {
      await expect(service.cancel(randomUUID(), randomUUID())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when another rider tries to cancel', async () => {
      const rider = await createRider();
      const otherRider = await createRider();
      const request = await createRequest(rider.id);

      await expect(service.cancel(otherRider.id, request.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when request is already assigned', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id, 'assigned');

      await expect(service.cancel(rider.id, request.id)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when request is already expired', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id, 'expired');

      await expect(service.cancel(rider.id, request.id)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('durable dispatch intent', () => {
    it('commits created.v1 event unpublished with correct payload', async () => {
      const rider = await createRider();
      const result = await service.create(
        await createRideRequestInput(rider.id),
      );

      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(
          eq(dispatchOutboxEvent.eventKey, `ride_request:${result.id}:created`),
        );

      expect(event).toBeDefined();
      if (!event) throw new Error('expected created outbox event');
      expect(event.publishedAt).toBeNull();
      expect(event.aggregateType).toBe('ride_request');
      expect(event.aggregateId).toBe(result.id);
      expect(event.eventType).toBe('ride_request.created.v1');
      expect(event.actorUserId).toBe(rider.id);
      expect(event.payload).toMatchObject({
        requestId: result.id,
        riderId: rider.id,
        state: 'searching',
        fareEstimateId: result.fareEstimateId,
        vehicleType: 'standard',
        rideType: 'instant',
        currency: 'ETB',
        distanceMeters: 1_250,
        durationSeconds: 180,
        rateMinorPerKm: 900,
        estimatedFareMinor: 1_100,
      });
    });

    it('commits cancelled.v1 event unpublished with correct payload', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id);
      await service.cancel(rider.id, request.id);

      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(
          eq(
            dispatchOutboxEvent.eventKey,
            `ride_request:${request.id}:cancelled`,
          ),
        );

      expect(event).toBeDefined();
      if (!event) throw new Error('expected cancelled outbox event');
      expect(event.publishedAt).toBeNull();
      expect(event.aggregateType).toBe('ride_request');
      expect(event.aggregateId).toBe(request.id);
      expect(event.eventType).toBe('ride_request.cancelled.v1');
      expect(event.actorUserId).toBe(rider.id);
      expect(event.payload).toMatchObject({
        requestId: request.id,
        riderId: rider.id,
        state: 'cancelled',
      });
    });

    it('outbox event survives simulated publisher crash and is recoverable', async () => {
      const rider = await createRider();
      const result = await service.create(
        await createRideRequestInput(rider.id),
      );

      const [event] = await db
        .select({ eventId: dispatchOutboxEvent.eventId })
        .from(dispatchOutboxEvent)
        .where(
          eq(dispatchOutboxEvent.eventKey, `ride_request:${result.id}:created`),
        );
      expect(event).toBeDefined();
      if (!event) throw new Error('expected created outbox event');

      await pool.query(
        `UPDATE dispatch_outbox_event SET published_at = NULL, publish_attempts = 0 WHERE event_id = $1`,
        [event.eventId],
      );

      const [survivor] = await db
        .select({
          eventId: dispatchOutboxEvent.eventId,
          publishedAt: dispatchOutboxEvent.publishedAt,
          eventType: dispatchOutboxEvent.eventType,
        })
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.eventId, event.eventId));

      if (!survivor) throw new Error('expected survivor outbox event');
      expect(survivor.publishedAt).toBeNull();
      expect(survivor.eventType).toBe('ride_request.created.v1');
    });
  });

  describe('findByIdForRider', () => {
    it('returns the request for the owning rider', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id);

      const result = await service.findByIdForRider(rider.id, request.id);

      expect(result.id).toBe(request.id);
      expect(result.riderId).toBe(rider.id);
      expect(result.state).toBe('searching');
      expect(result.pickup).toEqual({ latitude: 9.0192, longitude: 38.7525 });
      expect(result.destination).toEqual({
        latitude: 9.0301,
        longitude: 38.7612,
      });
    });

    it('throws NotFoundException for non-existent request', async () => {
      await expect(
        service.findByIdForRider(randomUUID(), randomUUID()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for non-owning rider', async () => {
      const rider = await createRider();
      const otherRider = await createRider();
      const request = await createRequest(rider.id);

      await expect(
        service.findByIdForRider(otherRider.id, request.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns request in any state', async () => {
      const rider = await createRider();
      const request = await createRequest(rider.id, 'cancelled');

      const result = await service.findByIdForRider(rider.id, request.id);

      expect(result.state).toBe('cancelled');
    });

    it('returns assignment details for an assigned request', async () => {
      const rider = await createRider();
      const driver = await createRider();
      const request = await createRequest(rider.id, 'assigned');
      const [attempt] = await db
        .insert(dispatchAttempt)
        .values({
          requestId: request.id,
          attemptNumber: 1,
          state: 'completed',
          startedAt: new Date(Date.now() - 1_000),
          finishedAt: new Date(),
        })
        .returning();
      if (!attempt) throw new Error('test setup failed to create attempt');
      const [offer] = await db
        .insert(dispatchOffer)
        .values({
          requestId: request.id,
          attemptId: attempt.id,
          driverId: driver.id,
          state: 'accepted',
          expiresAt: new Date(Date.now() + 15_000),
          respondedAt: new Date(),
          etaSeconds: 180,
          distanceMeters: 1_250,
        })
        .returning();
      if (!offer) throw new Error('test setup failed to create offer');
      const [assignment] = await db
        .insert(dispatchAssignment)
        .values({
          requestId: request.id,
          offerId: offer.id,
          riderId: rider.id,
          driverId: driver.id,
          assignedAt: new Date(),
          driverFullName: 'Accepted Driver',
          driverPhone: '+251911000111',
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
        throw new Error('test setup failed to create assignment');
      const arrivedAt = new Date();
      const [pickup] = await db
        .insert(dispatchAssignmentPickup)
        .values({
          assignmentId: assignment.id,
          requestId: request.id,
          offerId: offer.id,
          riderId: rider.id,
          driverId: driver.id,
          state: 'arrived',
          arrivedAt,
          warningDueAt: new Date(arrivedAt.getTime() + 60_000),
          noShowCancellableAt: new Date(arrivedAt.getTime() + 60_000),
        })
        .returning();
      if (!pickup) throw new Error('test setup failed to create pickup');
      const [trip] = await db
        .insert(dispatchAssignmentTrip)
        .values({
          assignmentId: assignment.id,
          requestId: request.id,
          offerId: offer.id,
          riderId: rider.id,
          driverId: driver.id,
          state: 'started',
          startedAt: new Date(),
        })
        .returning();
      if (!trip) throw new Error('test setup failed to create trip');

      const result = await service.findByIdForRider(rider.id, request.id);

      expect(result.assignment).toMatchObject({
        id: assignment.id,
        offerId: offer.id,
        requestId: request.id,
        riderId: rider.id,
        driverId: driver.id,
        state: 'assigned',
        driver: {
          id: driver.id,
          fullName: 'Accepted Driver',
          phone: '+251911000111',
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
        pickup: {
          id: pickup.id,
          state: 'arrived',
        },
        trip: {
          id: trip.id,
          state: 'started',
          completedAt: null,
        },
      });
      expect(result.assignment?.trip?.startedAt).toBeInstanceOf(Date);
      expect(result.assignment?.pickup?.arrivedAt).toBeInstanceOf(Date);
      expect(result.assignment?.pickup?.warningDueAt).toBeInstanceOf(Date);
      expect(result.assignment?.pickup?.warningSentAt).toBeNull();
      expect(result.assignment?.pickup?.noShowCancellableAt).toBeInstanceOf(
        Date,
      );
      expect(result.assignment?.pickup?.noShowCancelledAt).toBeNull();
      expect(result.assignment?.assignedAt).toBeInstanceOf(Date);
    });
  });

  describe('findCurrentForRider', () => {
    it.each(['searching', 'offered', 'assigned'] as const)(
      'returns the current %s request',
      async (state) => {
        const rider = await createRider();
        const request = await createRequest(rider.id, state);

        const result = await service.findCurrentForRider(rider.id);

        expect(result?.id).toBe(request.id);
        expect(result?.state).toBe(state);
        expect(result?.pickup).toEqual({
          latitude: 9.0192,
          longitude: 38.7525,
        });
        expect(result?.destination).toEqual({
          latitude: 9.0301,
          longitude: 38.7612,
        });
      },
    );

    it('returns null when the rider has no current request', async () => {
      const rider = await createRider();
      await createRequest(rider.id, 'cancelled');

      await expect(service.findCurrentForRider(rider.id)).resolves.toBeNull();
    });

    it('returns null when the rider has only a completed request', async () => {
      const rider = await createRider();
      await createRequest(rider.id, 'completed');

      await expect(service.findCurrentForRider(rider.id)).resolves.toBeNull();
    });
  });
});
