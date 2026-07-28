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
import { authSession } from '../auth/schema/session.schema';
import { DispatchOutboxService } from '../dispatch-outbox';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { user } from '../user';
import { DispatchAssignmentCancellationService } from './dispatch-assignment-cancellation.service';
import {
  dispatchAssignment,
  dispatchAttempt,
  dispatchCancellation,
  dispatchOffer,
} from './schema';

describe('DispatchAssignmentCancellationService (integration)', () => {
  let moduleRef: TestingModule;
  let service: DispatchAssignmentCancellationService;
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
      providers: [DispatchAssignmentCancellationService, DispatchOutboxService],
    }).compile();

    service = moduleRef.get(DispatchAssignmentCancellationService);
    db = moduleRef.get(DRIZZLE);
    pool = moduleRef.get(PG_POOL);
  });

  afterEach(async () => {
    for (const requestId of requestIds) {
      await db
        .delete(dispatchCancellation)
        .where(eq(dispatchCancellation.requestId, requestId))
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
        firstName: roles.includes('driver') ? 'Cancel' : 'Ride',
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
        driverFullName: 'Cancel Driver',
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
      presenceSessionId: `cancel-${driver.id}`,
      presenceGeneration: 1,
    });

    return { rider, driver, request, offer, assignment };
  };

  it('cancels an assigned ride for the owning driver with structured reason details', async () => {
    const { driver, request, offer, assignment } =
      await createAssignedAssignment();

    const result = await service.cancelAssignedRide(driver.id, assignment.id, {
      reasonCode: 'driver_emergency',
      notes: 'Flat tire',
    });

    expect(result).toMatchObject({
      requestId: request.id,
      offerId: offer.id,
      assignmentId: assignment.id,
      actorUserId: driver.id,
      actorRole: 'driver',
      reasonCode: 'driver_emergency',
      notes: 'Flat tire',
    });

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

    const events = await db.execute<{ event_type: string }>(sql`
      SELECT "event_type"
      FROM "dispatch_outbox_event"
      WHERE "aggregate_id" IN (${request.id}, ${offer.id}, ${assignment.id})
    `);
    expect(events.rows.map((event) => event.event_type).sort()).toEqual([
      'dispatch_assignment.cancelled.v1',
      'dispatch_offer.cancelled.v1',
      'ride_request.cancelled.v1',
    ]);
  });
});
