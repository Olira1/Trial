export const DISPATCH_EVENT_VERSION = 'v1' as const;

export const DISPATCH_EVENTS = {
  REQUEST_SNAPSHOT: 'dispatch:request:snapshot',
  OFFER_SNAPSHOT: 'dispatch:offer:snapshot',
  PRESENCE_STATE_CHANGED: 'presence:state:changed',
  PRESENCE_LEASE_REVOKED: 'presence:lease:revoked',
  RIDE_REQUEST_CREATED: 'dispatch:ride_request:created',
  RIDE_REQUEST_UPDATED: 'dispatch:ride_request:updated',
  RIDE_REQUEST_CANCELLED: 'dispatch:ride_request:cancelled',
  RIDE_REQUEST_EXPIRED: 'dispatch:ride_request:expired',
  RIDE_REQUEST_NO_DRIVER_FOUND: 'dispatch:ride_request:no_driver_found',
  RIDE_REQUEST_SYSTEM_FAILED: 'dispatch:ride_request:system_failed',

  OFFER_CREATED: 'dispatch:offer:created',
  OFFER_ACCEPTED: 'dispatch:offer:accepted',
  OFFER_REJECTED: 'dispatch:offer:rejected',
  OFFER_EXPIRED: 'dispatch:offer:expired',
  OFFER_CANCELLED: 'dispatch:offer:cancelled',

  ASSIGNMENT_CREATED: 'dispatch:assignment:created',
  ASSIGNMENT_CANCELLED: 'dispatch:assignment:cancelled',
  ASSIGNMENT_PICKUP_ARRIVED: 'dispatch:assignment:pickup_arrived',
  ASSIGNMENT_TRIP_START_WARNING: 'dispatch:assignment:trip_start_warning',
  ASSIGNMENT_TRIP_STARTED: 'dispatch:assignment:trip_started',
  ASSIGNMENT_TRIP_COMPLETED: 'dispatch:assignment:trip_completed',
  ASSIGNMENT_RIDER_NO_SHOW_CANCELLED:
    'dispatch:assignment:rider_no_show_cancelled',
} as const;

export type DispatchEventName =
  (typeof DISPATCH_EVENTS)[keyof typeof DISPATCH_EVENTS];

export type DispatchEnvelope<TSnapshot> = {
  schemaVersion: typeof DISPATCH_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  userId: string;
  snapshot: TSnapshot;
};

export type AssignmentCreatedEnvelope = {
  schemaVersion: typeof DISPATCH_EVENT_VERSION;
  eventId: string;
  occurredAt: string;
  requestId: string;
  offerId: string;
  riderId: string;
  driverId: string;
  snapshot: AssignmentSnapshot;
};

export type RideRequestCreatedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  riderId: string;
  state: 'searching';
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  matchingDeadlineAt: string;
  createdAt: string;
};

export type RideRequestUpdatedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  state: string;
  updatedAt: string;
};

export type RideRequestCancelledEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  riderId: string;
  state: 'cancelled';
  cancelledAt: string;
};

export type RideRequestExpiredEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  state: 'expired';
  expiredAt: string;
};

export type RideRequestNoDriverFoundEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  state: 'no_driver_found';
  resolvedAt: string;
};

export type RideRequestSystemFailedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  requestId: string;
  state: 'system_failed';
  failedAt: string;
};

export type OfferCreatedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  driverId: string;
  state: 'pending';
  etaSeconds: number;
  distanceMeters: number;
  expiresAt: string;
  offeredAt: string;
};

export type OfferAcceptedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  driverId: string;
  state: 'accepted';
  acceptedAt: string;
};

export type OfferRejectedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  driverId: string;
  state: 'rejected';
  rejectedAt: string;
};

export type OfferExpiredEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  driverId: string;
  state: 'expired';
  expiredAt: string;
};

export type OfferCancelledEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  driverId: string;
  state: 'cancelled';
  cancelledAt: string;
};

export type AssignmentCreatedEvent = {
  version: typeof DISPATCH_EVENT_VERSION;
  offerId: string;
  requestId: string;
  riderId: string;
  driverId: string;
  state: 'assigned';
  assignedAt: string;
};

export type DispatchSnapshot = {
  version: typeof DISPATCH_EVENT_VERSION;
  userId: string;
  activeRequest: RideRequestSnapshot | null;
  activeOffer: OfferSnapshot | null;
  activeAssignment: AssignmentSnapshot | null;
  generatedAt: string;
};

export type RideRequestSnapshot = {
  requestId: string;
  state: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  matchingDeadlineAt: string;
  createdAt: string;
};

export type OfferSnapshot = {
  offerId: string;
  requestId: string;
  driverId: string;
  state: string;
  etaSeconds: number;
  distanceMeters: number;
  expiresAt: string;
  offeredAt: string;
};

export type AssignmentSnapshot = {
  id: string;
  offerId: string;
  requestId: string;
  riderId: string;
  driverId: string;
  state: string;
  assignedAt: string;
  driver: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
  };
  vehicle: {
    make: string;
    model: string;
    color: string;
    plateRegion: 'aa' | 'or' | 'ah' | 'dr' | 'tg';
    plateCode: '01' | '02' | '03';
    plateCodeSubtype: 'transport_service' | 'other' | null;
    plateNumber: string;
  };
  pickup: {
    id: string;
    state: 'arrived' | 'warning_sent' | 'rider_no_show_cancelled';
    arrivedAt: string;
    warningDueAt: string;
    warningSentAt: string | null;
    noShowCancellableAt: string;
    noShowCancelledAt: string | null;
  } | null;
  trip: {
    id: string;
    state: 'started' | 'completed';
    startedAt: string;
    completedAt: string | null;
  } | null;
};

export const DISPATCH_ROOMS = {
  user: (userId: string) => `user:${userId}`,
  request: (requestId: string) => `request:${requestId}`,
  offer: (offerId: string) => `offer:${offerId}`,
} as const;
