import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
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
import { authSession } from '../auth/schema/session.schema';
import { DispatchQueueService } from '../dispatch-queue';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { user } from '../user';
import { DispatchAssignmentPickupService } from './dispatch-assignment-pickup.service';
import {
  dispatchAssignment,
  dispatchAssignmentTrip,
  dispatchAttempt,
  dispatchCancellation,
  dispatchOffer,
} from './schema';

type EnqueueInput = {
  queueName: string;
  jobName: string;
  jobId: string;
  data: unknown;
  delayMs?: number;
};

describe('DispatchAssignmentPickupService (integration)', () => {
  let moduleRef: TestingModule;
  let service: DispatchAssignmentPickupService;
  let db: Database;
  let pool: Pool;
  let enqueue: jest.Mock<
    Promise<{ id: string | undefined; name: string }>,
    [EnqueueInput]
  >;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();
  const sessionIds = new Set<string>();

  beforeAll(async () => {
    enqueue = jest
      .fn<Promise<{ id: string | undefined; name: string }>, [EnqueueInput]>()
      .mockResolvedValue({
        id: 'pickup-reminder-job',
        name: 'dispatch.pickup-reminder.warn',
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
      ],
      providers: [
        DispatchAssignmentPickupService,
        DispatchOutboxService,
        {
          provide: DispatchQueueService,
          useValue: { enqueue },
        },
      ],
    }).compile();

    service = moduleRef.get(DispatchAssignmentPickupService);
    db = moduleRef.get(DRIZZLE);
    pool = moduleRef.get(PG_POOL);
  });

  afterEach(async () => {
    enqueue.mockClear();

    for (const requestId of requestIds) {
      await db.execute(sql`
        DELETE FROM "dispatch_assignment_pickup"
        WHERE "request_id" = ${requestId}
      `);
      await db
        .delete(dispatchCancellation)
        .where(eq(dispatchCancellation.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, requestId))
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

    requestIds.clear();
    userIds.clear();
    sessionIds.clear();
  });

  afterAll(async () => {
    await pool?.end();
  });

  const createUser = async (roles: Array<'rider' | 'driver'>) => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: roles.includes('driver') ? 'Pickup' : 'Ride',
        lastName: roles.includes('driver') ? 'Driver' : 'Rider',
        roles,
      })
      .returning();
    if (!created) throw new Error('failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createAssignedAssignment = async () => {
    const rider = await createUser(['rider']);
    const driver = await createUser(['driver']);
    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: 'assigned',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(Date.now() + 90_000),
      })
      .returning();
    if (!request) throw new Error('failed to create request');
    requestIds.add(request.id);

    const [attempt] = await db
      .insert(dispatchAttempt)
      .values({
        requestId: request.id,
        attemptNumber: 1,
        state: 'completed',
        startedAt: new Date(Date.now() - 2_000),
        finishedAt: new Date(Date.now() - 1_000),
      })
      .returning();
    if (!attempt) throw new Error('failed to create attempt');

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
    if (!offer) throw new Error('failed to create offer');

    const [assignment] = await db
      .insert(dispatchAssignment)
      .values({
        requestId: request.id,
        offerId: offer.id,
        riderId: rider.id,
        driverId: driver.id,
        assignedAt: new Date(),
        driverFullName: 'Pickup Driver',
        driverPhone: '+251911000222',
        driverRating: 5,
        vehicleMake: 'Toyota',
        vehicleModel: 'Vitz',
        vehicleColor: 'white',
        vehiclePlateRegion: 'aa',
        vehiclePlateCode: '01',
        vehiclePlateNumber: 'ABC123',
      })
      .returning();
    if (!assignment) throw new Error('failed to create assignment');

    return { rider, driver, request, offer, assignment };
  };

  const createAssignedDriverProfile = async (driverId: string) => {
    const [session] = await db
      .insert(authSession)
      .values({
        userId: driverId,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    if (!session) throw new Error('failed to create auth session');
    sessionIds.add(session.id);

    await db.insert(driverOperationalProfile).values({
      userId: driverId,
      operationalState: 'assigned',
      ownerSessionId: session.id,
      presenceSessionId: `pickup-${driverId}`,
      presenceGeneration: 1,
    });
  };

  const makePickupDue = async (pickupId: string) => {
    await db.execute(sql`
      UPDATE "dispatch_assignment_pickup"
      SET
        "arrived_at" = NOW() - INTERVAL '2 minutes',
        "warning_due_at" = NOW() - INTERVAL '1 second',
        "no_show_cancellable_at" = NOW() - INTERVAL '1 second',
        "updated_at" = NOW()
      WHERE "id" = ${pickupId}
    `);
  };

  const countPickupRows = async (assignmentId: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_assignment_pickup"
      WHERE "assignment_id" = ${assignmentId}
    `);
    return Number(result.rows[0]?.count ?? 0);
  };

  const countArrivalEvents = async (assignmentId: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_outbox_event"
      WHERE "aggregate_id" = ${assignmentId}
        AND "event_type" = 'dispatch_assignment.pickup_arrived.v1'
    `);
    return Number(result.rows[0]?.count ?? 0);
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

  it('marks an accepted assignment as arrived at pickup and records one durable event', async () => {
    const { rider, driver, request, offer, assignment } =
      await createAssignedAssignment();

    const result = await service.arriveAtPickup(driver.id, assignment.id);

    expect(result).toMatchObject({
      assignmentId: assignment.id,
      requestId: request.id,
      offerId: offer.id,
      riderId: rider.id,
      driverId: driver.id,
      state: 'arrived',
      warningSentAt: null,
      noShowCancelledAt: null,
    });
    expect(result.arrivedAt).toBeInstanceOf(Date);
    expect(result.warningDueAt.getTime() - result.arrivedAt.getTime()).toBe(
      60_000,
    );
    expect(
      result.noShowCancellableAt.getTime() - result.arrivedAt.getTime(),
    ).toBe(60_000);
    expect(await countPickupRows(assignment.id)).toBe(1);
    expect(await countArrivalEvents(assignment.id)).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'dispatch.pickup-reminder',
        jobName: 'dispatch.pickup-reminder.warn',
        data: {
          pickupId: result.id,
          warningDueAt: result.warningDueAt.toISOString(),
        },
      }),
    );
    const delayMs = enqueue.mock.calls[0]?.[0]?.delayMs;
    expect(delayMs).toBeGreaterThanOrEqual(0);
    expect(delayMs).toBeLessThanOrEqual(60_000);
  });

  it('returns the same pickup control and event count for duplicate arrival', async () => {
    const { driver, assignment } = await createAssignedAssignment();

    const first = await service.arriveAtPickup(driver.id, assignment.id);
    const second = await service.arriveAtPickup(driver.id, assignment.id);

    expect(second.id).toBe(first.id);
    expect(second.arrivedAt).toEqual(first.arrivedAt);
    expect(await countPickupRows(assignment.id)).toBe(1);
    expect(await countArrivalEvents(assignment.id)).toBe(1);
  });

  it('rejects arrival for a non-owning driver', async () => {
    const { assignment } = await createAssignedAssignment();
    const otherDriver = await createUser(['driver']);

    await expect(
      service.arriveAtPickup(otherDriver.id, assignment.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records one trip-start warning after the pickup wait is due', async () => {
    const { driver, assignment } = await createAssignedAssignment();
    const pickup = await service.arriveAtPickup(driver.id, assignment.id);
    await makePickupDue(pickup.id);

    const warned = await service.sendTripStartWarning(pickup.id);
    const duplicate = await service.sendTripStartWarning(pickup.id);

    expect(warned.state).toBe('warning_sent');
    expect(warned.warningSentAt).toBeInstanceOf(Date);
    expect(duplicate.id).toBe(warned.id);
    expect(duplicate.warningSentAt).toEqual(warned.warningSentAt);
    expect(
      await countEventType(
        assignment.id,
        'dispatch_assignment.trip_start_warning.v1',
      ),
    ).toBe(1);
  });

  it('does not send a trip-start warning once the trip has started', async () => {
    const { rider, driver, request, offer, assignment } =
      await createAssignedAssignment();
    const pickup = await service.arriveAtPickup(driver.id, assignment.id);
    await makePickupDue(pickup.id);
    await db.insert(dispatchAssignmentTrip).values({
      assignmentId: assignment.id,
      requestId: request.id,
      offerId: offer.id,
      riderId: rider.id,
      driverId: driver.id,
      state: 'started',
      startedAt: new Date(),
    });

    const result = await service.sendTripStartWarning(pickup.id);

    expect(result.id).toBe(pickup.id);
    expect(result.state).toBe('arrived');
    expect(result.warningSentAt).toBeNull();
    expect(
      await countEventType(
        assignment.id,
        'dispatch_assignment.trip_start_warning.v1',
      ),
    ).toBe(0);
  });

  it('rejects rider no-show cancellation before the pickup wait expires', async () => {
    const { driver, assignment } = await createAssignedAssignment();
    await createAssignedDriverProfile(driver.id);
    await service.arriveAtPickup(driver.id, assignment.id);

    await expect(
      service.cancelRiderNoShow(driver.id, assignment.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels a rider no-show after the pickup wait without rematching', async () => {
    const { driver, request, offer, assignment } =
      await createAssignedAssignment();
    await createAssignedDriverProfile(driver.id);
    const pickup = await service.arriveAtPickup(driver.id, assignment.id);
    await makePickupDue(pickup.id);

    const cancelled = await service.cancelRiderNoShow(driver.id, assignment.id);
    const duplicate = await service.cancelRiderNoShow(driver.id, assignment.id);

    expect(cancelled.state).toBe('rider_no_show_cancelled');
    expect(cancelled.noShowCancelledAt).toBeInstanceOf(Date);
    expect(duplicate.id).toBe(cancelled.id);
    expect(duplicate.noShowCancelledAt).toEqual(cancelled.noShowCancelledAt);

    const [requestRow] = await db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, request.id));
    expect(requestRow?.state).toBe('cancelled');

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

    expect(
      await countEventType(
        assignment.id,
        'dispatch_assignment.rider_no_show_cancelled.v1',
      ),
    ).toBe(1);
    expect(await countEventType(request.id, 'ride_request.cancelled.v1')).toBe(
      1,
    );
    expect(await countEventType(offer.id, 'dispatch_offer.cancelled.v1')).toBe(
      1,
    );

    const [cancellation] = await db
      .select()
      .from(dispatchCancellation)
      .where(eq(dispatchCancellation.requestId, request.id));
    expect(cancellation).toMatchObject({
      requestId: request.id,
      offerId: offer.id,
      assignmentId: assignment.id,
      actorUserId: driver.id,
      actorRole: 'driver',
      reasonCode: 'rider_no_show',
      notes: null,
    });
  });
});
