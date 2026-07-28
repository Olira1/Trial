import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DispatchOutboxEvent } from '../dispatch-outbox';
import {
  DISPATCH_EVENTS,
  DISPATCH_ROOMS,
  type AssignmentSnapshot,
} from './dispatch-events';
import { DispatchEventPublisher } from './dispatch-event-publisher.service';

describe('DispatchEventPublisher', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs offer snapshot publication details for dispatch offer events', async () => {
    const requestId = randomUUID();
    const offerId = randomUUID();
    const driverId = randomUUID();
    const eventId = randomUUID();
    const occurredAt = new Date('2026-06-26T12:00:00.000Z');
    const debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    type FakeServer = {
      to: jest.Mock<FakeServer, [string]>;
      emit: jest.Mock<boolean, [string, unknown]>;
    };
    const fakeServer: FakeServer = {
      to: jest.fn<FakeServer, [string]>(() => fakeServer),
      emit: jest.fn<boolean, [string, unknown]>(() => true),
    };
    const db = {
      execute: jest.fn().mockResolvedValue({
        rows: [
          {
            id: offerId,
            request_id: requestId,
            driver_id: driverId,
            state: 'pending',
            eta_seconds: 240,
            distance_meters: 1800,
            expires_at: '2026-06-26T12:00:15.000Z',
            offered_at: '2026-06-26T12:00:00.000Z',
            responded_at: null,
          },
        ],
      }),
    };
    const metrics = {
      recordSocketEventLatency: jest.fn(),
    };
    const publisher = new DispatchEventPublisher(
      db as never,
      { server: fakeServer } as never,
      {} as never,
      metrics as never,
    );

    await publisher.publishFromOutboxEvent({
      eventId,
      eventKey: `dispatch_offer:${offerId}:created`,
      eventType: 'dispatch_offer.created.v1',
      schemaVersion: 1,
      aggregateType: 'dispatch_offer',
      aggregateId: offerId,
      occurredAt,
      correlationId: randomUUID(),
      causationId: null,
      actorUserId: driverId,
      payload: {},
      publishedAt: null,
      publishAttempts: 0,
      lastPublishError: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    } satisfies DispatchOutboxEvent);

    const emittedPayload = fakeServer.emit.mock.calls[0]?.[1] as
      | {
          eventId: string;
          userId: string;
          snapshot: {
            offerId: string;
            requestId: string;
            driverId: string;
            state: string;
          };
        }
      | undefined;

    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.OFFER_SNAPSHOT,
      expect.any(Object),
    );
    expect(emittedPayload).toBeDefined();
    expect(emittedPayload?.eventId).toBe(eventId);
    expect(emittedPayload?.userId).toBe(driverId);
    expect(emittedPayload?.snapshot).toMatchObject({
      offerId,
      requestId,
      driverId,
      state: 'pending',
    });
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Publishing offer snapshot eventType=dispatch_offer.created.v1 eventId=${eventId} offerId=${offerId} requestId=${requestId} driverId=${driverId} state=pending`,
      ),
    );
  });

  it('publishes assignment-created events with durable assignment details', async () => {
    const requestId = randomUUID();
    const offerId = randomUUID();
    const riderId = randomUUID();
    const driverId = randomUUID();
    const eventId = randomUUID();
    const assignmentId = randomUUID();
    const occurredAt = new Date('2026-06-21T12:00:00.000Z');
    type FakeServer = {
      to: jest.Mock<FakeServer, [string]>;
      emit: jest.Mock<boolean, [string, unknown]>;
    };
    const fakeServer: FakeServer = {
      to: jest.fn<FakeServer, [string]>(() => fakeServer),
      emit: jest.fn<boolean, [string, unknown]>(() => true),
    };
    const snapshot: AssignmentSnapshot = {
      id: assignmentId,
      offerId,
      requestId,
      riderId,
      driverId,
      state: 'assigned',
      assignedAt: '2026-06-21T12:00:00.000Z',
      driver: {
        id: driverId,
        fullName: 'Realtime Driver',
        phone: '+251922222222',
        rating: 5,
      },
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'Blue',
        plateRegion: 'aa' as const,
        plateCode: '03' as const,
        plateCodeSubtype: 'transport_service' as const,
        plateNumber: '12345',
      },
      pickup: null,
      trip: null,
    };
    const snapshotService = {
      findAssignmentByOffer: jest
        .fn<Promise<AssignmentSnapshot | null>, [string]>()
        .mockResolvedValue(snapshot),
    };
    const metrics = {
      recordSocketEventLatency: jest.fn(),
    };
    const publisher = new DispatchEventPublisher(
      {} as never,
      { server: fakeServer } as never,
      snapshotService as never,
      metrics as never,
    );

    await publisher.publishFromOutboxEvent({
      eventId,
      eventKey: `dispatch_assignment:${requestId}:created`,
      eventType: 'dispatch_assignment.created.v1',
      schemaVersion: 1,
      aggregateType: 'ride_request',
      aggregateId: requestId,
      occurredAt,
      correlationId: randomUUID(),
      causationId: null,
      actorUserId: driverId,
      payload: { offerId },
      publishedAt: null,
      publishAttempts: 0,
      lastPublishError: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    } satisfies DispatchOutboxEvent);

    expect(snapshotService.findAssignmentByOffer).toHaveBeenCalledWith(offerId);
    expect(fakeServer.to).toHaveBeenCalledWith(DISPATCH_ROOMS.user(riderId));
    expect(fakeServer.to).toHaveBeenCalledWith(DISPATCH_ROOMS.user(driverId));
    expect(fakeServer.to).toHaveBeenCalledWith(
      DISPATCH_ROOMS.request(requestId),
    );
    expect(fakeServer.to).toHaveBeenCalledWith(DISPATCH_ROOMS.offer(offerId));
    expect(fakeServer.emit).toHaveBeenCalledWith(
      DISPATCH_EVENTS.ASSIGNMENT_CREATED,
      expect.objectContaining({
        schemaVersion: 'v1',
        eventId,
        occurredAt: '2026-06-21T12:00:00.000Z',
        requestId,
        offerId,
        riderId,
        driverId,
        snapshot,
      }),
    );
  });

  it.each([
    ['dispatch_assignment.cancelled.v1', 'dispatch:assignment:cancelled'],
    [
      'dispatch_assignment.pickup_arrived.v1',
      'dispatch:assignment:pickup_arrived',
    ],
    [
      'dispatch_assignment.trip_start_warning.v1',
      'dispatch:assignment:trip_start_warning',
    ],
    ['dispatch_assignment.trip_started.v1', 'dispatch:assignment:trip_started'],
    [
      'dispatch_assignment.trip_completed.v1',
      'dispatch:assignment:trip_completed',
    ],
    [
      'dispatch_assignment.rider_no_show_cancelled.v1',
      'dispatch:assignment:rider_no_show_cancelled',
    ],
  ] as const)(
    'publishes %s events with the latest durable assignment snapshot',
    async (eventType, eventName) => {
      const requestId = randomUUID();
      const offerId = randomUUID();
      const riderId = randomUUID();
      const driverId = randomUUID();
      const eventId = randomUUID();
      const assignmentId = randomUUID();
      const pickupId = randomUUID();
      const occurredAt = new Date('2026-06-21T12:01:00.000Z');
      type FakeServer = {
        to: jest.Mock<FakeServer, [string]>;
        emit: jest.Mock<boolean, [string, unknown]>;
      };
      const fakeServer: FakeServer = {
        to: jest.fn<FakeServer, [string]>(() => fakeServer),
        emit: jest.fn<boolean, [string, unknown]>(() => true),
      };
      const snapshot: AssignmentSnapshot = {
        id: assignmentId,
        offerId,
        requestId,
        riderId,
        driverId,
        state: 'assigned',
        assignedAt: '2026-06-21T12:00:00.000Z',
        driver: {
          id: driverId,
          fullName: 'Realtime Driver',
          phone: '+251922222222',
          rating: 5,
        },
        vehicle: {
          make: 'Toyota',
          model: 'Vitz',
          color: 'Blue',
          plateRegion: 'aa' as const,
          plateCode: '03' as const,
          plateCodeSubtype: 'transport_service' as const,
          plateNumber: '12345',
        },
        pickup: {
          id: pickupId,
          state:
            eventType === 'dispatch_assignment.rider_no_show_cancelled.v1'
              ? 'rider_no_show_cancelled'
              : eventType === 'dispatch_assignment.trip_start_warning.v1'
                ? 'warning_sent'
                : 'arrived',
          arrivedAt: '2026-06-21T12:00:00.000Z',
          warningDueAt: '2026-06-21T12:01:00.000Z',
          warningSentAt:
            eventType === 'dispatch_assignment.trip_start_warning.v1'
              ? '2026-06-21T12:01:00.000Z'
              : null,
          noShowCancellableAt: '2026-06-21T12:01:00.000Z',
          noShowCancelledAt:
            eventType === 'dispatch_assignment.rider_no_show_cancelled.v1'
              ? '2026-06-21T12:01:00.000Z'
              : null,
        },
        trip:
          eventType === 'dispatch_assignment.trip_started.v1' ||
          eventType === 'dispatch_assignment.trip_completed.v1'
            ? {
                id: randomUUID(),
                state:
                  eventType === 'dispatch_assignment.trip_completed.v1'
                    ? 'completed'
                    : 'started',
                startedAt: '2026-06-21T12:02:00.000Z',
                completedAt:
                  eventType === 'dispatch_assignment.trip_completed.v1'
                    ? '2026-06-21T12:20:00.000Z'
                    : null,
              }
            : null,
      };
      const snapshotService = {
        findAssignmentByOffer: jest
          .fn<Promise<AssignmentSnapshot | null>, [string]>()
          .mockResolvedValue(snapshot),
      };
      const metrics = {
        recordSocketEventLatency: jest.fn(),
      };
      const publisher = new DispatchEventPublisher(
        {} as never,
        { server: fakeServer } as never,
        snapshotService as never,
        metrics as never,
      );

      await publisher.publishFromOutboxEvent({
        eventId,
        eventKey: `dispatch_assignment:${assignmentId}:${eventType}`,
        eventType,
        schemaVersion: 1,
        aggregateType: 'dispatch_assignment',
        aggregateId: assignmentId,
        occurredAt,
        correlationId: randomUUID(),
        causationId: null,
        actorUserId: driverId,
        payload: { offerId },
        publishedAt: null,
        publishAttempts: 0,
        lastPublishError: null,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      } satisfies DispatchOutboxEvent);

      expect(snapshotService.findAssignmentByOffer).toHaveBeenCalledWith(
        offerId,
      );
      expect(fakeServer.emit).toHaveBeenCalledWith(
        eventName,
        expect.objectContaining({
          schemaVersion: 'v1',
          eventId,
          requestId,
          offerId,
          riderId,
          driverId,
          snapshot,
        }),
      );
    },
  );
});
