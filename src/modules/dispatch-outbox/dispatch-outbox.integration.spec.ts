import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
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
  DRIZZLE,
  DatabaseModule,
  type Database,
} from '../../database/database.module';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  DISPATCH_QUEUE_NAMES,
  DispatchQueueModule,
  DispatchQueueService,
  dispatchJobIds,
} from '../dispatch-queue';
import { DispatchEventsGateway } from '../dispatch-realtime';
import { DISPATCH_EVENTS } from '../dispatch-realtime';
import { RedisModule } from '../redis';
import { user } from '../user';
import {
  DISPATCH_OUTBOX_PUBLISH_JOB_NAME,
  DispatchOutboxModule,
  DispatchOutboxPublisherService,
  DispatchOutboxRelayService,
  DispatchOutboxService,
} from './';

describe('DispatchOutboxModule (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let outbox: DispatchOutboxService;
  let publisher: DispatchOutboxPublisherService;
  let relay: DispatchOutboxRelayService;
  let queues: DispatchQueueService;
  let gateway: DispatchEventsGateway;
  let fakeServer: {
    to: jest.Mock;
    emit: jest.Mock;
  };
  const cleanupCorrelationIds = new Set<string>();
  const cleanupUserIds = new Set<string>();
  const cleanupRequestIds = new Set<string>();
  const cleanupOfferIds = new Set<string>();
  const cleanupAttemptIds = new Set<string>();

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
          load: [
            authConfig,
            databaseConfig,
            dispatchConfig,
            notificationsConfig,
            redisConfig,
            storageConfig,
          ],
        }),
        DatabaseModule,
        RedisModule,
        DispatchQueueModule,
        DispatchOutboxModule,
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    outbox = moduleRef.get(DispatchOutboxService);
    publisher = moduleRef.get(DispatchOutboxPublisherService);
    relay = moduleRef.get(DispatchOutboxRelayService);
    queues = moduleRef.get(DispatchQueueService);
    gateway = moduleRef.get(DispatchEventsGateway);
    fakeServer = {
      to: jest.fn((_: string) => fakeServer),
      emit: jest.fn(() => true),
    };
    gateway.server = fakeServer as unknown as DispatchEventsGateway['server'];
  });

  afterEach(async () => {
    fakeServer.to.mockClear();
    fakeServer.emit.mockClear();

    for (const correlationId of cleanupCorrelationIds) {
      await db
        ?.execute(
          sql`delete from dispatch_outbox_event where correlation_id = ${correlationId}`,
        )
        .catch(() => undefined);
    }
    for (const offerId of cleanupOfferIds) {
      await db
        ?.execute(sql`delete from dispatch_offer where id = ${offerId}`)
        .catch(() => undefined);
    }
    for (const attemptId of cleanupAttemptIds) {
      await db
        ?.execute(sql`delete from dispatch_attempt where id = ${attemptId}`)
        .catch(() => undefined);
    }
    for (const requestId of cleanupRequestIds) {
      await db
        ?.execute(sql`delete from ride_request where id = ${requestId}`)
        .catch(() => undefined);
    }
    for (const userId of cleanupUserIds) {
      await db
        .delete(user)
        .where(sql`${user.id} = ${userId}`)
        .catch(() => undefined);
    }
    cleanupCorrelationIds.clear();
    cleanupOfferIds.clear();
    cleanupAttemptIds.clear();
    cleanupRequestIds.clear();
    cleanupUserIds.clear();
    await queues?.drain(DISPATCH_QUEUE_NAMES.outbox).catch(() => undefined);
  });

  afterAll(async () => {
    for (const correlationId of cleanupCorrelationIds) {
      await db
        ?.execute(
          sql`delete from dispatch_outbox_event where correlation_id = ${correlationId}`,
        )
        .catch(() => undefined);
    }
    await queues?.close();
    await harness?.cleanupRedisNamespace();
    await moduleRef?.close();
    await harness?.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  it('persists appended events only when the surrounding transaction commits', async () => {
    const correlationId = randomUUID();
    cleanupCorrelationIds.add(correlationId);
    const aggregateId = randomUUID();
    const committedInput = {
      eventKey: `test:${correlationId}:commit`,
      eventType: 'ride_request.created.v1' as const,
      aggregateType: 'ride_request',
      aggregateId,
      correlationId,
      actorUserId: randomUUID(),
      payload: {
        requestId: aggregateId,
        source: 'dispatch-outbox-integration-test',
      },
    };

    const committedEvent = await db.transaction((tx) =>
      outbox.append(tx, committedInput),
    );

    await expect(
      outbox.findByEventId(committedEvent.eventId),
    ).resolves.toMatchObject({
      eventKey: committedInput.eventKey,
      eventType: committedInput.eventType,
      aggregateType: committedInput.aggregateType,
      aggregateId: committedInput.aggregateId,
      correlationId,
      payload: committedInput.payload,
    });

    const rolledBackEventId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await outbox.append(tx, {
          ...committedInput,
          eventId: rolledBackEventId,
          eventKey: `test:${correlationId}:rollback`,
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    await expect(outbox.findByEventId(rolledBackEventId)).resolves.toBeNull();
  });

  it('publishes duplicate requests as one deterministic outbox queue job', async () => {
    await queues.drain(DISPATCH_QUEUE_NAMES.outbox);
    const fixture = await createRideRequestFixture();
    const event = await appendRideRequestCreatedEvent(fixture.requestId);

    const first = await publisher.enqueuePublishJob(event.eventId);
    const second = await publisher.enqueuePublishJob(event.eventId);

    expect(first).toEqual({
      status: 'enqueued',
      eventId: event.eventId,
      jobId: `outbox-${event.eventId}`,
    });
    expect(second).toEqual({
      status: 'already_published',
      eventId: event.eventId,
      jobId: `outbox-${event.eventId}`,
    });
    await expect(
      queues.getWaitingCount(DISPATCH_QUEUE_NAMES.outbox),
    ).resolves.toBe(1);

    const publishedEvent = await outbox.findByEventId(event.eventId);
    expect(publishedEvent).toMatchObject({
      eventId: event.eventId,
      publishAttempts: 1,
    });
    expect(publishedEvent?.publishedAt).toBeInstanceOf(Date);
    expect(fakeServer.emit).toHaveBeenCalledTimes(1);
  });

  it('emits a request snapshot only for a committed ride_request.created.v1 event', async () => {
    const fixture = await createRideRequestFixture();
    const event = await appendRideRequestCreatedEvent(fixture.requestId);

    await publisher.enqueuePublishJob(event.eventId);

    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      expect.objectContaining({
        schemaVersion: 'v1',
        eventId: event.eventId,
        userId: fixture.riderId,
      }),
    );
  });

  it('emits an offer snapshot for a committed dispatch_offer.created.v1 event', async () => {
    const fixture = await createOfferFixture();
    const event = await appendOfferCreatedEvent(
      fixture.offerId,
      fixture.driverId,
      fixture.requestId,
    );

    await publisher.enqueuePublishJob(event.eventId);

    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.OFFER_SNAPSHOT,
      expect.objectContaining({
        schemaVersion: 'v1',
        eventId: event.eventId,
        userId: fixture.driverId,
      }),
    );
  });

  it('relays pending dispatch_offer.created events without manual reconciliation', async () => {
    await queues.drain(DISPATCH_QUEUE_NAMES.outbox);
    const fixture = await createOfferFixture();
    const event = await appendOfferCreatedEvent(
      fixture.offerId,
      fixture.driverId,
      fixture.requestId,
    );

    await relay.drainOnce('test');

    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.OFFER_SNAPSHOT,
      expect.objectContaining({
        schemaVersion: 'v1',
        eventId: event.eventId,
        userId: fixture.driverId,
      }),
    );
    const publishedEvent = await outbox.findByEventId(event.eventId);
    expect(publishedEvent?.publishedAt).toBeInstanceOf(Date);
    expect(publishedEvent?.publishAttempts).toBe(1);
  });

  it('emits assignment-created for a committed dispatch_assignment.created.v1 event', async () => {
    const fixture = await createOfferFixture({ offerState: 'accepted' });
    const event = await appendAssignmentCreatedEvent(fixture);
    const expectedSnapshot: unknown = expect.objectContaining({
      offerId: fixture.offerId,
      requestId: fixture.requestId,
      riderId: fixture.riderId,
      driverId: fixture.driverId,
      state: 'assigned',
      driver: {
        id: fixture.driverId,
        fullName: 'Realtime Driver',
        phone: '+251922222222',
        rating: 5,
      },
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'Blue',
        plateRegion: 'aa',
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
        plateNumber: '12345',
      },
    });

    await publisher.enqueuePublishJob(event.eventId);

    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.ASSIGNMENT_CREATED,
      expect.objectContaining({
        schemaVersion: 'v1',
        eventId: event.eventId,
        requestId: fixture.requestId,
        offerId: fixture.offerId,
        riderId: fixture.riderId,
        driverId: fixture.driverId,
        snapshot: expectedSnapshot,
      }),
    );
  });

  it('does not emit realtime for a rolled-back outbox append', async () => {
    const fixture = await createRideRequestFixture();
    const correlationId = randomUUID();
    const rolledBackEventId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await outbox.append(tx, {
          eventId: rolledBackEventId,
          eventKey: `test:${correlationId}:rollback-realtime`,
          eventType: 'ride_request.created.v1',
          aggregateType: 'ride_request',
          aggregateId: fixture.requestId,
          correlationId,
          payload: {
            requestId: fixture.requestId,
          },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    await publisher.enqueuePendingPublishJobs({ limit: 1000 });

    expect(await outbox.findByEventId(rolledBackEventId)).toBeNull();
    expect(fakeServer.emit).not.toHaveBeenCalled();
  });

  it('recovers when a process crashes after enqueueing but before marking published', async () => {
    await queues.drain(DISPATCH_QUEUE_NAMES.outbox);
    const event = await appendTestEvent('crash-after-publish');
    const jobId = dispatchJobIds.outboxPublish({
      outboxEventId: event.eventId,
    });

    await queues.enqueue({
      queueName: DISPATCH_QUEUE_NAMES.outbox,
      jobName: DISPATCH_OUTBOX_PUBLISH_JOB_NAME,
      jobId,
      data: { outboxEventId: event.eventId },
    });
    await expect(outbox.findByEventId(event.eventId)).resolves.toMatchObject({
      publishedAt: null,
    });

    await expect(
      publisher.enqueuePendingPublishJobs({ limit: 1000 }),
    ).resolves.toContainEqual({
      status: 'enqueued',
      eventId: event.eventId,
      jobId,
    });

    await expect(
      queues.getWaitingCount(DISPATCH_QUEUE_NAMES.outbox),
    ).resolves.toBe(1);
    const recoveredEvent = await outbox.findByEventId(event.eventId);
    expect(recoveredEvent).toMatchObject({
      eventId: event.eventId,
      publishAttempts: 1,
    });
    expect(recoveredEvent?.publishedAt).toBeInstanceOf(Date);
  });

  it('lets concurrent publishers claim one unpublished event without duplicating queue work', async () => {
    await queues.drain(DISPATCH_QUEUE_NAMES.outbox);
    const event = await appendTestEvent('concurrent-publishers');
    const before = await queues.getWaitingCount(DISPATCH_QUEUE_NAMES.outbox);

    const results = await Promise.all([
      publisher.enqueuePendingPublishJobs({ limit: 1000 }),
      publisher.enqueuePendingPublishJobs({ limit: 1000 }),
    ]);

    const flattened = results.flat();
    const forEvent = flattened.filter(
      (result) => result.eventId === event.eventId,
    );
    expect(forEvent.length).toBeGreaterThanOrEqual(1);
    expect(forEvent.some((result) => result.status === 'enqueued')).toBe(true);
    const after = await queues.getWaitingCount(DISPATCH_QUEUE_NAMES.outbox);
    expect(after - before).toBe(1);

    const publishedEvent = await outbox.findByEventId(event.eventId);
    expect(publishedEvent).toMatchObject({
      eventId: event.eventId,
      publishAttempts: 1,
    });
    expect(publishedEvent?.publishedAt).toBeInstanceOf(Date);
  });

  const appendTestEvent = async (suffix: string) => {
    const correlationId = randomUUID();
    cleanupCorrelationIds.add(correlationId);
    const aggregateId = randomUUID();

    return db.transaction((tx) =>
      outbox.append(tx, {
        eventKey: `test:${correlationId}:${suffix}`,
        eventType: 'ride_request.created.v1',
        aggregateType: 'ride_request',
        aggregateId,
        correlationId,
        payload: {
          requestId: aggregateId,
          source: 'dispatch-outbox-integration-test',
        },
      }),
    );
  };

  const createUserRecord = async (roles: ('rider' | 'driver')[]) => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Realtime',
        lastName: 'User',
        roles,
      })
      .returning();

    if (!created) {
      throw new Error('failed to create test user');
    }

    cleanupUserIds.add(created.id);
    return created.id;
  };

  const createRideRequestFixture = async () => {
    const riderId = await createUserRecord(['rider']);
    const requestId = randomUUID();
    cleanupRequestIds.add(requestId);

    await db.execute(sql`
      INSERT INTO "ride_request" (
        "id",
        "rider_id",
        "state",
        "pickup",
        "destination",
        "idempotency_key",
        "offer_ttl_seconds",
        "matching_deadline_seconds",
        "matching_deadline_at"
      ) VALUES (
        ${requestId},
        ${riderId},
        'searching',
        ST_SetSRID(ST_MakePoint(38.7525, 9.0192), 4326)::geography,
        ST_SetSRID(ST_MakePoint(38.7612, 9.0301), 4326)::geography,
        ${`idem-${requestId}`},
        15,
        90,
        NOW() + INTERVAL '90 seconds'
      )
    `);

    return { riderId, requestId };
  };

  const createOfferFixture = async (options?: {
    offerState?: 'pending' | 'accepted';
  }) => {
    const { riderId, requestId } = await createRideRequestFixture();
    const driverId = await createUserRecord(['driver']);
    const attemptId = randomUUID();
    const offerId = randomUUID();
    cleanupAttemptIds.add(attemptId);
    cleanupOfferIds.add(offerId);
    const offerState = options?.offerState ?? 'pending';

    await db.execute(sql`
      INSERT INTO "dispatch_attempt" (
        "id",
        "request_id",
        "attempt_number",
        "state"
      ) VALUES (
        ${attemptId},
        ${requestId},
        1,
        'in_progress'
      )
    `);

    await db.execute(sql`
      INSERT INTO "dispatch_offer" (
        "id",
        "request_id",
        "attempt_id",
        "driver_id",
        "state",
        "offered_at",
        "expires_at",
        "responded_at",
        "eta_seconds",
        "distance_meters"
      ) VALUES (
        ${offerId},
        ${requestId},
        ${attemptId},
        ${driverId},
        ${offerState},
        NOW(),
        NOW() + INTERVAL '15 seconds',
        ${offerState === 'accepted' ? sql`NOW()` : null},
        240,
        1800
      )
    `);

    if (offerState === 'accepted') {
      await db.execute(sql`
        UPDATE "ride_request"
        SET "state" = 'assigned', "updated_at" = NOW()
        WHERE "id" = ${requestId}
      `);
      await db.execute(sql`
        INSERT INTO "dispatch_assignment" (
          "request_id",
          "offer_id",
          "rider_id",
          "driver_id",
          "assigned_at",
          "driver_full_name",
          "driver_phone",
          "driver_rating",
          "vehicle_make",
          "vehicle_model",
          "vehicle_color",
          "vehicle_plate_region",
          "vehicle_plate_code",
          "vehicle_plate_code_subtype",
          "vehicle_plate_number"
        ) VALUES (
          ${requestId},
          ${offerId},
          ${riderId},
          ${driverId},
          NOW(),
          'Realtime Driver',
          '+251922222222',
          5,
          'Toyota',
          'Vitz',
          'Blue',
          'aa',
          '03',
          'transport_service',
          '12345'
        )
      `);
    }

    return { riderId, driverId, requestId, offerId, attemptId };
  };

  const appendRideRequestCreatedEvent = async (requestId: string) => {
    const correlationId = randomUUID();
    cleanupCorrelationIds.add(correlationId);

    return db.transaction((tx) =>
      outbox.append(tx, {
        eventKey: `test:${correlationId}:ride-request-created`,
        eventType: 'ride_request.created.v1',
        aggregateType: 'ride_request',
        aggregateId: requestId,
        correlationId,
        payload: { requestId },
      }),
    );
  };

  const appendOfferCreatedEvent = async (
    offerId: string,
    driverId: string,
    requestId: string,
  ) => {
    const correlationId = randomUUID();
    cleanupCorrelationIds.add(correlationId);

    return db.transaction((tx) =>
      outbox.append(tx, {
        eventKey: `test:${correlationId}:offer-created`,
        eventType: 'dispatch_offer.created.v1',
        aggregateType: 'dispatch_offer',
        aggregateId: offerId,
        correlationId,
        actorUserId: driverId,
        payload: { offerId, driverId, requestId },
      }),
    );
  };

  const appendAssignmentCreatedEvent = async (fixture: {
    riderId: string;
    driverId: string;
    requestId: string;
    offerId: string;
    attemptId: string;
  }) => {
    const correlationId = randomUUID();
    cleanupCorrelationIds.add(correlationId);

    return db.transaction((tx) =>
      outbox.append(tx, {
        eventKey: `test:${correlationId}:assignment-created`,
        eventType: 'dispatch_assignment.created.v1',
        aggregateType: 'ride_request',
        aggregateId: fixture.requestId,
        correlationId,
        actorUserId: fixture.driverId,
        payload: {
          requestId: fixture.requestId,
          offerId: fixture.offerId,
          attemptId: fixture.attemptId,
          riderId: fixture.riderId,
          driverId: fixture.driverId,
          assignedAt: new Date().toISOString(),
        },
      }),
    );
  };
});
