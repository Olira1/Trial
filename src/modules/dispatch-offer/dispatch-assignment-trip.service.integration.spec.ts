import { randomUUID } from 'node:crypto';
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
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { fareEstimate } from '../fare-estimates/schema';
import { rideRequest } from '../ride-requests/schema';
import { user } from '../user';
import { DispatchAssignmentTripService } from './dispatch-assignment-trip.service';
import { dispatchAssignment, dispatchAttempt, dispatchOffer } from './schema';

describe('DispatchAssignmentTripService (integration)', () => {
  let moduleRef: TestingModule;
  let service: DispatchAssignmentTripService;
  let db: Database;
  let pool: Pool;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();
  const sessionIds = new Set<string>();

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
      providers: [DispatchAssignmentTripService, DispatchOutboxService],
    }).compile();

    service = moduleRef.get(DispatchAssignmentTripService);
    db = moduleRef.get(DRIZZLE);
    pool = moduleRef.get(PG_POOL);
  });

  afterEach(async () => {
    for (const requestId of requestIds) {
      await db
        .execute(
          sql`
          DELETE FROM "dispatch_assignment_trip"
          WHERE "request_id" = ${requestId}
        `,
        )
        .catch(() => undefined);
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, requestId))
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
        firstName: roles.includes('driver') ? 'Trip' : 'Ride',
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
    await db.insert(authIdentity).values({
      userId: rider.id,
      type: 'phone',
      identifier: '+251911000555',
      verifiedAt: new Date(),
    });

    const [estimate] = await db
      .insert(fareEstimate)
      .values({
        riderId: rider.id,
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        vehicleType: 'standard',
        currency: 'ETB',
        distanceMeters: 4_321,
        durationSeconds: 600,
        rateMinorPerKm: 900,
        estimatedFareMinor: 3_889,
        expiresAt: new Date(Date.now() + 300_000),
      })
      .returning();
    if (!estimate) throw new Error('failed to create fare estimate');

    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: rider.id,
        state: 'assigned',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: estimate.id,
        vehicleType: 'standard',
        rideType: 'instant',
        currency: 'ETB',
        distanceMeters: estimate.distanceMeters,
        durationSeconds: estimate.durationSeconds,
        rateMinorPerKm: estimate.rateMinorPerKm,
        estimatedFareMinor: estimate.estimatedFareMinor,
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
        driverFullName: 'Trip Driver',
        driverPhone: '+251911000444',
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

    const [session] = await db
      .insert(authSession)
      .values({
        userId: driver.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    if (!session) throw new Error('failed to create session');
    sessionIds.add(session.id);

    await db.insert(driverOperationalProfile).values({
      userId: driver.id,
      operationalState: 'assigned',
      ownerSessionId: session.id,
      presenceSessionId: `trip-${driver.id}`,
      presenceGeneration: 1,
    });

    return { rider, driver, request, offer, assignment };
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

  it('starts a trip for the owning assigned driver and records one durable event', async () => {
    const { rider, driver, request, offer, assignment } =
      await createAssignedAssignment();

    const result = await service.startTrip(driver.id, assignment.id);
    const duplicate = await service.startTrip(driver.id, assignment.id);

    expect(result).toMatchObject({
      assignmentId: assignment.id,
      requestId: request.id,
      offerId: offer.id,
      riderId: rider.id,
      driverId: driver.id,
      state: 'started',
      completedAt: null,
      rider: {
        id: rider.id,
        fullName: 'Ride Rider',
        phone: '+251911000555',
        rating: 5,
      },
      pickup: {
        latitude: 9.0192,
        longitude: 38.7525,
      },
      destination: {
        latitude: 9.0301,
        longitude: 38.7612,
      },
      completion: null,
    });
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(duplicate.id).toBe(result.id);
    expect(duplicate.startedAt).toEqual(result.startedAt);
    expect(
      await countEventType(
        assignment.id,
        'dispatch_assignment.trip_started.v1',
      ),
    ).toBe(1);
  });

  it('completes a started trip and releases the driver without cancelling the accepted offer', async () => {
    const { driver, request, offer, assignment } =
      await createAssignedAssignment();
    const started = await service.startTrip(driver.id, assignment.id);

    const completed = await service.completeTrip(driver.id, assignment.id);
    const duplicate = await service.completeTrip(driver.id, assignment.id);

    expect(completed).toMatchObject({
      id: started.id,
      assignmentId: assignment.id,
      requestId: request.id,
      offerId: offer.id,
      driverId: driver.id,
      state: 'completed',
      startedAt: started.startedAt,
    });
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(duplicate.id).toBe(completed.id);
    expect(duplicate.completedAt).toEqual(completed.completedAt);
    expect(completed.completion).toMatchObject({
      totalPriceMinor: 3_889,
      currency: 'ETB',
      totalDistanceMeters: 4_321,
    });
    expect(completed.completion?.totalTimeTakenSeconds).toBeGreaterThanOrEqual(
      0,
    );
    expect(duplicate.completion).toEqual(completed.completion);

    const [requestRow] = await db
      .select()
      .from(rideRequest)
      .where(eq(rideRequest.id, request.id));
    expect(requestRow?.state).toBe('completed');

    const [offerRow] = await db
      .select()
      .from(dispatchOffer)
      .where(eq(dispatchOffer.id, offer.id));
    expect(offerRow?.state).toBe('accepted');

    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, driver.id));
    expect(profile?.operationalState).toBe('online');

    expect(
      await countEventType(
        assignment.id,
        'dispatch_assignment.trip_completed.v1',
      ),
    ).toBe(1);
  });
});
