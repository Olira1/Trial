import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import {
  DISPATCH_EVENT_VERSION,
  type DispatchSnapshot,
  type RideRequestSnapshot,
  type OfferSnapshot,
  type AssignmentSnapshot,
} from './dispatch-events';

type RequestRow = {
  id: string;
  rider_id: string;
  state: string;
  pickup_lat: number;
  pickup_lon: number;
  dest_lat: number;
  dest_lon: number;
  matching_deadline_at: string;
  created_at: string;
};

type OfferRow = {
  id: string;
  request_id: string;
  driver_id: string;
  state: string;
  eta_seconds: number | null;
  distance_meters: number | null;
  expires_at: string;
  offered_at: string;
  responded_at: string | null;
};

type AssignmentRow = {
  id: string;
  offer_id: string;
  request_id: string;
  rider_id: string;
  driver_id: string;
  assigned_at: Date | string;
  driver_full_name: string;
  driver_phone: string;
  driver_rating: number;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_plate_region: 'aa' | 'or' | 'ah' | 'dr' | 'tg';
  vehicle_plate_code: '01' | '02' | '03';
  vehicle_plate_code_subtype: 'transport_service' | 'other' | null;
  vehicle_plate_number: string;
  pickup_id: string | null;
  pickup_state: 'arrived' | 'warning_sent' | 'rider_no_show_cancelled' | null;
  pickup_arrived_at: Date | string | null;
  pickup_warning_due_at: Date | string | null;
  pickup_warning_sent_at: Date | string | null;
  pickup_no_show_cancellable_at: Date | string | null;
  pickup_no_show_cancelled_at: Date | string | null;
  trip_id: string | null;
  trip_state: 'started' | 'completed' | null;
  trip_started_at: Date | string | null;
  trip_completed_at: Date | string | null;
};

@Injectable()
export class DispatchSnapshotService {
  private readonly logger = new Logger(DispatchSnapshotService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async generateSnapshot(
    userId: string,
    requestId?: string,
  ): Promise<DispatchSnapshot> {
    const activeRequest = await this.getActiveRequest(userId, requestId);
    const activeOffer = activeRequest
      ? await this.getActiveOfferByRequest(activeRequest.requestId)
      : await this.getActiveOfferByDriver(userId);
    const activeAssignment = activeOffer
      ? await this.getActiveAssignment(activeOffer.offerId)
      : null;

    const snapshot = {
      version: DISPATCH_EVENT_VERSION,
      userId,
      activeRequest,
      activeOffer,
      activeAssignment,
      generatedAt: new Date().toISOString(),
    };

    this.logger.debug(
      `Generated dispatch snapshot userId=${userId} requestId=${activeRequest?.requestId ?? 'none'} requestState=${activeRequest?.state ?? 'none'} offerId=${activeOffer?.offerId ?? 'none'} offerState=${activeOffer?.state ?? 'none'} assignmentId=${activeAssignment?.id ?? 'none'}`,
    );

    return snapshot;
  }

  async findAssignmentByOffer(
    offerId: string,
  ): Promise<AssignmentSnapshot | null> {
    const result = await this.db.execute<AssignmentRow>(sql`
      SELECT
        a."id",
        a."offer_id",
        a."request_id",
        a."rider_id",
        a."driver_id",
        a."assigned_at",
        a."driver_full_name",
        a."driver_phone",
        a."driver_rating",
        a."vehicle_make",
        a."vehicle_model",
        a."vehicle_color",
        a."vehicle_plate_region",
        a."vehicle_plate_code",
        a."vehicle_plate_code_subtype",
        a."vehicle_plate_number",
        p."id" AS pickup_id,
        p."state" AS pickup_state,
        p."arrived_at" AS pickup_arrived_at,
        p."warning_due_at" AS pickup_warning_due_at,
        p."warning_sent_at" AS pickup_warning_sent_at,
        p."no_show_cancellable_at" AS pickup_no_show_cancellable_at,
        p."no_show_cancelled_at" AS pickup_no_show_cancelled_at,
        t."id" AS trip_id,
        t."state" AS trip_state,
        t."started_at" AS trip_started_at,
        t."completed_at" AS trip_completed_at
      FROM "dispatch_assignment" a
      LEFT JOIN "dispatch_assignment_pickup" p
        ON p."assignment_id" = a."id"
      LEFT JOIN "dispatch_assignment_trip" t
        ON t."assignment_id" = a."id"
      WHERE a."offer_id" = ${offerId}
      LIMIT 1
    `);

    const row = result.rows[0];
    return row ? this.toAssignmentSnapshot(row) : null;
  }

  async isRequestParticipant(
    userId: string,
    requestId: string,
  ): Promise<boolean> {
    const result = await this.db.execute<{ rider_id: string }>(sql`
      SELECT "rider_id" FROM "ride_request" WHERE "id" = ${requestId} LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) return false;
    if (row.rider_id === userId) return true;

    const offerResult = await this.db.execute<{ driver_id: string }>(sql`
      SELECT "driver_id" FROM "dispatch_offer"
      WHERE "request_id" = ${requestId}
        AND "driver_id" = ${userId}
        AND "state" IN ('pending', 'accepted')
      LIMIT 1
    `);

    return offerResult.rows.length > 0;
  }

  async isOfferParticipant(userId: string, offerId: string): Promise<boolean> {
    const result = await this.db.execute<{
      request_id: string;
      driver_id: string;
    }>(sql`
      SELECT "request_id", "driver_id" FROM "dispatch_offer"
      WHERE "id" = ${offerId} LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) return false;
    if (row.driver_id === userId) return true;

    const requestResult = await this.db.execute<{ rider_id: string }>(sql`
      SELECT "rider_id" FROM "ride_request"
      WHERE "id" = ${row.request_id} LIMIT 1
    `);

    return requestResult.rows[0]?.rider_id === userId;
  }

  private async getActiveRequest(
    userId: string,
    requestId?: string,
  ): Promise<RideRequestSnapshot | null> {
    if (requestId) {
      const row = await this.loadRequestById(requestId, userId);
      return row ? this.toRequestSnapshot(row) : null;
    }

    for (const state of ['searching', 'offered', 'assigned'] as const) {
      const row = await this.loadRequestByState(userId, state);
      if (row) return this.toRequestSnapshot(row);
    }

    return null;
  }

  private async getActiveOfferByRequest(
    requestId: string,
  ): Promise<OfferSnapshot | null> {
    for (const state of ['pending', 'accepted'] as const) {
      const result = await this.db.execute<OfferRow>(sql`
        SELECT
          o."id", o."request_id", o."driver_id", o."state",
          o."eta_seconds", o."distance_meters",
          o."expires_at", o."offered_at", o."responded_at"
        FROM "dispatch_offer" o
        INNER JOIN "ride_request" r
          ON r."id" = o."request_id"
        WHERE o."request_id" = ${requestId}
          AND o."state" = ${state}
          AND r."state" IN ('offered', 'assigned')
        LIMIT 1
      `);

      const row = result.rows[0];
      if (row) return this.toOfferSnapshot(row);
    }

    return null;
  }

  private async getActiveOfferByDriver(
    driverId: string,
  ): Promise<OfferSnapshot | null> {
    for (const state of ['pending', 'accepted'] as const) {
      const result = await this.db.execute<OfferRow>(sql`
        SELECT
          o."id", o."request_id", o."driver_id", o."state",
          o."eta_seconds", o."distance_meters",
          o."expires_at", o."offered_at", o."responded_at"
        FROM "dispatch_offer" o
        INNER JOIN "ride_request" r
          ON r."id" = o."request_id"
        WHERE o."driver_id" = ${driverId}
          AND o."state" = ${state}
          AND r."state" IN ('offered', 'assigned')
        LIMIT 1
      `);

      const row = result.rows[0];
      if (row) {
        return this.toOfferSnapshot(row);
      }
    }

    return null;
  }

  private async getActiveAssignment(
    offerId: string,
  ): Promise<AssignmentSnapshot | null> {
    return this.findAssignmentByOffer(offerId);
  }

  private async loadRequestById(
    requestId: string,
    userId: string,
  ): Promise<RequestRow | null> {
    const result = await this.db.execute<RequestRow>(sql`
      SELECT
        "id", "rider_id", "state",
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("pickup"::geometry)::float8 AS pickup_lon,
        ST_Y("destination"::geometry)::float8 AS dest_lat,
        ST_X("destination"::geometry)::float8 AS dest_lon,
        "matching_deadline_at", "created_at"
      FROM "ride_request"
      WHERE "id" = ${requestId}
        AND (
          "rider_id" = ${userId}
          OR EXISTS (
            SELECT 1
            FROM "dispatch_offer" o
            WHERE o."request_id" = "ride_request"."id"
              AND o."driver_id" = ${userId}
              AND o."state" IN ('pending', 'accepted')
          )
        )
      LIMIT 1
    `);

    return result.rows[0] ?? null;
  }

  private async loadRequestByState(
    riderId: string,
    state: string,
  ): Promise<RequestRow | null> {
    const result = await this.db.execute<RequestRow>(sql`
      SELECT
        "id", "rider_id", "state",
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("pickup"::geometry)::float8 AS pickup_lon,
        ST_Y("destination"::geometry)::float8 AS dest_lat,
        ST_X("destination"::geometry)::float8 AS dest_lon,
        "matching_deadline_at", "created_at"
      FROM "ride_request"
      WHERE "rider_id" = ${riderId} AND "state" = ${state}
      LIMIT 1
    `);

    return result.rows[0] ?? null;
  }

  private toRequestSnapshot(row: RequestRow): RideRequestSnapshot {
    return {
      requestId: row.id,
      state: row.state,
      pickupLatitude: row.pickup_lat,
      pickupLongitude: row.pickup_lon,
      destinationLatitude: row.dest_lat,
      destinationLongitude: row.dest_lon,
      matchingDeadlineAt: row.matching_deadline_at,
      createdAt: row.created_at,
    };
  }

  private toOfferSnapshot(row: OfferRow): OfferSnapshot {
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

  private toAssignmentSnapshot(row: AssignmentRow): AssignmentSnapshot {
    return {
      id: row.id,
      offerId: row.offer_id,
      requestId: row.request_id,
      riderId: row.rider_id,
      driverId: row.driver_id,
      state: 'assigned',
      assignedAt:
        row.assigned_at instanceof Date
          ? row.assigned_at.toISOString()
          : row.assigned_at,
      driver: {
        id: row.driver_id,
        fullName: row.driver_full_name,
        phone: row.driver_phone,
        rating: row.driver_rating,
      },
      vehicle: {
        make: row.vehicle_make,
        model: row.vehicle_model,
        color: row.vehicle_color,
        plateRegion: row.vehicle_plate_region,
        plateCode: row.vehicle_plate_code,
        plateCodeSubtype: row.vehicle_plate_code_subtype,
        plateNumber: row.vehicle_plate_number,
      },
      pickup:
        row.pickup_id && row.pickup_state && row.pickup_arrived_at
          ? {
              id: row.pickup_id,
              state: row.pickup_state,
              arrivedAt: this.toIso(row.pickup_arrived_at),
              warningDueAt: this.toIso(row.pickup_warning_due_at),
              warningSentAt: row.pickup_warning_sent_at
                ? this.toIso(row.pickup_warning_sent_at)
                : null,
              noShowCancellableAt: this.toIso(
                row.pickup_no_show_cancellable_at,
              ),
              noShowCancelledAt: row.pickup_no_show_cancelled_at
                ? this.toIso(row.pickup_no_show_cancelled_at)
                : null,
            }
          : null,
      trip:
        row.trip_id && row.trip_state && row.trip_started_at
          ? {
              id: row.trip_id,
              state: row.trip_state,
              startedAt: this.toIso(row.trip_started_at),
              completedAt: row.trip_completed_at
                ? this.toIso(row.trip_completed_at)
                : null,
            }
          : null,
    };
  }

  private toIso(value: Date | string | null): string {
    if (!value) throw new Error('expected timestamp value');
    return value instanceof Date ? value.toISOString() : value;
  }
}
