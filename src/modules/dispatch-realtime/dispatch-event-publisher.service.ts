import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_METRICS,
  NOOP_DISPATCH_METRICS,
  type DispatchMetrics,
} from '../dispatch-candidate';
import type { DispatchOutboxEvent } from '../dispatch-outbox/schema/dispatch-outbox.schema';
import { DispatchEventsGateway } from './dispatch-events.gateway';
import {
  DISPATCH_EVENTS,
  DISPATCH_EVENT_VERSION,
  DISPATCH_ROOMS,
  type AssignmentCreatedEnvelope,
  type AssignmentSnapshot,
  type DispatchEnvelope,
  type OfferSnapshot,
} from './dispatch-events';
import { DispatchSnapshotService } from './dispatch-snapshot.service';

type RequestRow = {
  id: string;
  rider_id: string;
};

@Injectable()
export class DispatchEventPublisher {
  private readonly logger = new Logger(DispatchEventPublisher.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(forwardRef(() => DispatchEventsGateway))
    private readonly gateway: DispatchEventsGateway,
    private readonly snapshot: DispatchSnapshotService,
    @Optional()
    @Inject(DISPATCH_METRICS)
    private readonly metrics: DispatchMetrics = NOOP_DISPATCH_METRICS,
  ) {}

  async publishFromOutboxEvent(event: DispatchOutboxEvent): Promise<void> {
    switch (event.eventType) {
      case 'ride_request.created.v1':
      case 'ride_request.cancelled.v1':
      case 'ride_request.expired.v1':
      case 'ride_request.no_driver_found.v1':
      case 'ride_request.system_failed.v1':
        await this.publishRideRequestSnapshot(event);
        return;
      case 'dispatch_offer.created.v1':
      case 'dispatch_offer.accepted.v1':
      case 'dispatch_offer.rejected.v1':
      case 'dispatch_offer.expired.v1':
      case 'dispatch_offer.cancelled.v1':
        await this.publishOfferSnapshot(event);
        return;
      case 'dispatch_assignment.created.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_CREATED,
        );
        return;
      case 'dispatch_assignment.cancelled.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_CANCELLED,
        );
        return;
      case 'dispatch_assignment.pickup_arrived.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_PICKUP_ARRIVED,
        );
        return;
      case 'dispatch_assignment.trip_start_warning.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_TRIP_START_WARNING,
        );
        return;
      case 'dispatch_assignment.trip_started.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_TRIP_STARTED,
        );
        return;
      case 'dispatch_assignment.trip_completed.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_TRIP_COMPLETED,
        );
        return;
      case 'dispatch_assignment.rider_no_show_cancelled.v1':
        await this.publishAssignmentSnapshot(
          event,
          DISPATCH_EVENTS.ASSIGNMENT_RIDER_NO_SHOW_CANCELLED,
        );
        return;
      default:
        this.logger.debug(
          `No realtime mapping for outbox eventType=${event.eventType}`,
        );
        return;
    }
  }

  private async publishRideRequestSnapshot(
    event: DispatchOutboxEvent,
  ): Promise<void> {
    const start = performance.now();
    const row = await this.loadRequest(event.aggregateId);
    if (!row) return;

    const snapshot = await this.snapshot.generateSnapshot(row.rider_id, row.id);
    const payload: DispatchEnvelope<typeof snapshot> = {
      schemaVersion: DISPATCH_EVENT_VERSION,
      eventId: event.eventId,
      occurredAt: event.occurredAt.toISOString(),
      userId: row.rider_id,
      snapshot,
    };

    this.gateway.server
      .to(DISPATCH_ROOMS.user(row.rider_id))
      .to(DISPATCH_ROOMS.request(row.id))
      .emit(DISPATCH_EVENTS.REQUEST_SNAPSHOT, payload);
    this.metrics.recordSocketEventLatency(
      DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      performance.now() - start,
    );
  }

  private async publishOfferSnapshot(
    event: DispatchOutboxEvent,
  ): Promise<void> {
    const start = performance.now();
    const snapshot = await this.loadOfferSnapshot(event.aggregateId);
    if (!snapshot) {
      this.logger.debug(
        `Offer snapshot missing for realtime publication eventType=${event.eventType} eventId=${event.eventId} offerId=${event.aggregateId}`,
      );
      return;
    }

    this.logger.debug(
      `Publishing offer snapshot eventType=${event.eventType} eventId=${event.eventId} offerId=${snapshot.offerId} requestId=${snapshot.requestId} driverId=${snapshot.driverId} state=${snapshot.state}`,
    );

    const payload: DispatchEnvelope<OfferSnapshot> = {
      schemaVersion: DISPATCH_EVENT_VERSION,
      eventId: event.eventId,
      occurredAt: event.occurredAt.toISOString(),
      userId: snapshot.driverId,
      snapshot,
    };

    this.gateway.server
      .to(DISPATCH_ROOMS.user(snapshot.driverId))
      .to(DISPATCH_ROOMS.request(snapshot.requestId))
      .to(DISPATCH_ROOMS.offer(snapshot.offerId))
      .emit(DISPATCH_EVENTS.OFFER_SNAPSHOT, payload);
    this.metrics.recordSocketEventLatency(
      DISPATCH_EVENTS.OFFER_SNAPSHOT,
      performance.now() - start,
    );
  }

  private async publishAssignmentSnapshot(
    event: DispatchOutboxEvent,
    eventName: string,
  ): Promise<void> {
    const start = performance.now();
    const offerId =
      typeof event.payload.offerId === 'string' ? event.payload.offerId : null;
    if (!offerId) {
      this.logger.warn(
        `${event.eventType} ${event.eventId} missing payload.offerId`,
      );
      return;
    }

    const snapshot: AssignmentSnapshot | null =
      await this.snapshot.findAssignmentByOffer(offerId);
    if (!snapshot) return;

    const payload: AssignmentCreatedEnvelope = {
      schemaVersion: DISPATCH_EVENT_VERSION,
      eventId: event.eventId,
      occurredAt: event.occurredAt.toISOString(),
      requestId: snapshot.requestId,
      offerId: snapshot.offerId,
      riderId: snapshot.riderId,
      driverId: snapshot.driverId,
      snapshot,
    };

    this.gateway.server
      .to(DISPATCH_ROOMS.user(snapshot.riderId))
      .to(DISPATCH_ROOMS.user(snapshot.driverId))
      .to(DISPATCH_ROOMS.request(snapshot.requestId))
      .to(DISPATCH_ROOMS.offer(offerId))
      .emit(eventName, payload);
    this.metrics.recordSocketEventLatency(eventName, performance.now() - start);
  }

  private async loadRequest(requestId: string): Promise<RequestRow | null> {
    const result = await this.db.execute<RequestRow>(sql`
      SELECT
        "id",
        "rider_id"
      FROM "ride_request"
      WHERE "id" = ${requestId}
      LIMIT 1
    `);

    return result.rows[0] ?? null;
  }

  private async loadOfferSnapshot(
    offerId: string,
  ): Promise<OfferSnapshot | null> {
    const result = await this.db.execute<{
      id: string;
      request_id: string;
      driver_id: string;
      state: string;
      eta_seconds: number | null;
      distance_meters: number | null;
      expires_at: string;
      offered_at: string;
      responded_at: string | null;
    }>(sql`
      SELECT
        "id",
        "request_id",
        "driver_id",
        "state",
        "eta_seconds",
        "distance_meters",
        "expires_at",
        "offered_at",
        "responded_at"
      FROM "dispatch_offer"
      WHERE "id" = ${offerId}
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      offerId: row.id,
      requestId: row.request_id,
      driverId: row.driver_id,
      state: row.state,
      etaSeconds: row.eta_seconds ?? 0,
      distanceMeters: row.distance_meters ?? 0,
      expiresAt: row.expires_at,
      offeredAt: row.offered_at,
    };
  }
}
