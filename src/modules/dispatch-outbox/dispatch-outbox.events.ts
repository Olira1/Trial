export const DISPATCH_OUTBOX_EVENT_TYPES = [
  'driver_presence.online.v1',
  'driver_presence.offline.v1',
  'driver_presence.takeover.v1',
  'ride_request.created.v1',
  'ride_request.cancelled.v1',
  'ride_request.expired.v1',
  'ride_request.no_driver_found.v1',
  'ride_request.system_failed.v1',
  'dispatch_offer.created.v1',
  'dispatch_offer.accepted.v1',
  'dispatch_offer.rejected.v1',
  'dispatch_offer.expired.v1',
  'dispatch_offer.cancelled.v1',
  'dispatch_assignment.created.v1',
  'dispatch_assignment.cancelled.v1',
  'dispatch_assignment.pickup_arrived.v1',
  'dispatch_assignment.trip_start_warning.v1',
  'dispatch_assignment.trip_started.v1',
  'dispatch_assignment.trip_completed.v1',
  'dispatch_assignment.rider_no_show_cancelled.v1',
] as const;

export type DispatchOutboxEventType =
  (typeof DISPATCH_OUTBOX_EVENT_TYPES)[number];
