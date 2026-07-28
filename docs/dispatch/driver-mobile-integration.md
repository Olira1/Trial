# Driver Mobile Dispatch Integration

This guide describes the driver-side mobile integration for Instant Ride dispatch.
It uses placeholder backend addresses and intentionally avoids Flutter package
recommendations.

## Scope

This document covers only the driver app:

- connecting to dispatch realtime
- going online
- keeping live presence fresh
- receiving ride offers
- accepting or rejecting offers
- handling assignment controls
- going offline

The driver app does not create matches directly. Matching is backend-owned. The
driver app makes the driver matchable by keeping authenticated presence and live
location fresh.

## Base Addresses

Use these placeholders in client configuration:

```text
REST base URL: https://<backend-host>/api/v1
Socket.IO namespace: wss://<backend-host>/dispatch
```

The `/dispatch` endpoint is a Socket.IO namespace, not a raw WebSocket protocol.
The app sends authentication in the socket handshake, then sends and receives
named socket events over that connection.

Use the same authenticated mobile session for REST and Socket.IO. Driver
presence ownership is tied to the backend session ID behind the access token.

## Authentication

All REST calls require:

```text
Authorization: Bearer <driverAccessToken>
```

For Socket.IO, prefer the authorization header in the handshake:

```text
Authorization: Bearer <driverAccessToken>
```

If the mobile networking layer cannot send headers during the Socket.IO
handshake, coordinate with backend before using an alternate auth field. The
current safest contract is the `Authorization` header.

## Type Notation

The type snippets below use TypeScript-style notation for readability. Flutter
models should use equivalent fields and nullable handling.

```ts
type UUID = string;
type ISODateTime = string;

type Point = {
  latitude: number;
  longitude: number;
};

type TimestampFields = {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

## REST API Type Reference

### `GET /drivers/presence/me`

Purpose: load current driver presence and matchability for this session.

Input:

```ts
type GetPresenceMeInput = null;
```

Output:

```ts
type DriverOperationalState =
  | 'offline'
  | 'online'
  | 'offered'
  | 'assigned'
  | 'suspended';

type DriverPresenceUnavailableReason =
  | 'offline'
  | 'not_eligible'
  | 'not_owner'
  | 'stale_presence'
  | 'redis_unavailable'
  | 'offered'
  | 'assigned'
  | 'suspended';

type DriverPresenceSnapshotResponse = {
  operationalState: DriverOperationalState;
  isCurrentSessionOwner: boolean;
  presenceSessionId: UUID | null;
  dispatchAvailable: boolean;
  unavailableReasons: DriverPresenceUnavailableReason[];
};
```

### `POST /drivers/presence/online`

Purpose: put the driver online and create the first live-location lease.

Input:

```ts
type DriverLocationCommand = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: ISODateTime;
};

type GoOnlineInput = {
  initialLocation: DriverLocationCommand;
  takeoverConfirmed: boolean;
};
```

Output:

```ts
type DriverPresenceCommandResponse = {
  operationalState: 'online' | 'offline';
  presenceSessionId: UUID | null;
  leaseId: UUID | null;
  leaseSequence: number | null;
  resumeRequired: boolean;
};
```

### `POST /drivers/presence/resume`

Purpose: recreate the Redis live-location lease for an already-online driver.

Input:

```ts
type ResumePresenceInput = {
  presenceSessionId: UUID;
  currentLocation: DriverLocationCommand;
};
```

Output:

```ts
type ResumePresenceResponse = DriverPresenceCommandResponse;
```

### `POST /drivers/presence/offline`

Purpose: put the driver offline and clear live presence authority.

Input:

```ts
type GoOfflineInput = null;
```

Output:

```ts
type GoOfflineResponse = DriverPresenceCommandResponse;
```

Expected successful offline response:

```json
{
  "operationalState": "offline",
  "presenceSessionId": null,
  "leaseId": null,
  "leaseSequence": null,
  "resumeRequired": false
}
```

### `GET /dispatch-offers/current`

Purpose: recover the current pending or accepted offer after reconnect,
foreground, or missed realtime event.

Input:

```ts
type GetCurrentDispatchOfferInput = null;
```

Output:

```ts
type DispatchOfferState =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

type CurrentDispatchOfferResponse = {
  id: UUID;
  assignmentId: UUID | null;
  requestId: UUID;
  driverId: UUID;
  state: DispatchOfferState;
  pickup: Point;
  destination: Point;
  fareEstimateId: UUID | null;
  vehicleType: 'standard' | null;
  rideType: 'instant' | null;
  currency: 'ETB' | null;
  tripDistanceMeters: number | null;
  tripDurationSeconds: number | null;
  rateMinorPerKm: number | null;
  estimatedFareMinor: number | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  expiresAt: ISODateTime;
  offeredAt: ISODateTime;
  respondedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
} | null;
```

### `GET /dispatch-offers/{offerId}`

Purpose: load one owned offer by ID, including terminal offers that are no
longer returned by `/dispatch-offers/current`.

Path input:

```ts
type GetDispatchOfferPathInput = {
  offerId: UUID;
};
```

Output:

```ts
type DispatchOfferDetailResponse = NonNullable<CurrentDispatchOfferResponse>;
```

Missing or not-owned offers return `404`.

### `GET /dispatch-assignments/active`

Purpose: recover the active assignment after reconnect, foreground, or missed
assignment realtime event.

Input:

```ts
type GetActiveDispatchAssignmentInput = null;
```

Output:

```ts
type ActiveDispatchAssignmentResponse =
  | (AssignmentSnapshot & {
      assignmentId: UUID;
      status: string;
      createdAt: ISODateTime;
      updatedAt: ISODateTime;
    })
  | null;
```

If output is `null`, the driver has no active accepted assignment. Terminal
assigned rides belong in `/dispatch-assignments/history`.

### `POST /dispatch-offers/{offerId}/accept`

Purpose: accept a pending offer.

Path input:

```ts
type AcceptOfferPathInput = {
  offerId: UUID;
};
```

Body input:

```ts
type AcceptOfferBodyInput = null;
```

Output:

```ts
type DispatchOfferResponse = {
  id: UUID;
  requestId: UUID;
  driverId: UUID;
  state: DispatchOfferState;
  etaSeconds: number | null;
  distanceMeters: number | null;
  expiresAt: ISODateTime;
  offeredAt: ISODateTime;
  respondedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

### `POST /dispatch-offers/{offerId}/reject`

Purpose: reject a pending offer.

Path input:

```ts
type RejectOfferPathInput = {
  offerId: UUID;
};
```

Body input:

```ts
type RejectOfferBodyInput = null;
```

Output:

```ts
type RejectOfferResponse = DispatchOfferResponse;
```

### `POST /dispatch-assignments/{assignmentId}/arrive-at-pickup`

Purpose: mark the driver as arrived at pickup.

Path input:

```ts
type ArriveAtPickupPathInput = {
  assignmentId: UUID;
};
```

Body input:

```ts
type ArriveAtPickupBodyInput = null;
```

Output:

```ts
type DispatchAssignmentPickupState =
  | 'arrived'
  | 'warning_sent'
  | 'rider_no_show_cancelled';

type DispatchAssignmentPickupResponse = {
  id: UUID;
  assignmentId: UUID;
  requestId: UUID;
  offerId: UUID;
  riderId: UUID;
  driverId: UUID;
  state: DispatchAssignmentPickupState;
  arrivedAt: ISODateTime;
  warningDueAt: ISODateTime;
  warningSentAt: ISODateTime | null;
  noShowCancellableAt: ISODateTime;
  noShowCancelledAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

### `POST /dispatch-assignments/{assignmentId}/start-trip`

Purpose: start the assigned trip.

Path input:

```ts
type StartTripPathInput = {
  assignmentId: UUID;
};
```

Body input:

```ts
type StartTripBodyInput = null;
```

Output:

```ts
type DispatchAssignmentTripState = 'started' | 'completed';

type DispatchAssignmentTripResponse = {
  id: UUID;
  assignmentId: UUID;
  requestId: UUID;
  offerId: UUID;
  riderId: UUID;
  driverId: UUID;
  state: DispatchAssignmentTripState;
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  rider: {
    id: UUID;
    fullName: string;
    phone: string;
    rating: number;
  };
  pickup: {
    latitude: number;
    longitude: number;
  };
  destination: {
    latitude: number;
    longitude: number;
  };
  completion: null | {
    totalPriceMinor: number | null;
    currency: 'ETB' | null;
    totalDistanceMeters: number | null;
    totalTimeTakenSeconds: number;
  };
};

type StartTripResponse = DispatchAssignmentTripResponse;
```

### `POST /dispatch-assignments/{assignmentId}/complete-trip`

Purpose: complete a started trip and release the driver back to online.

Path input:

```ts
type CompleteTripPathInput = {
  assignmentId: UUID;
};
```

Body input:

```ts
type CompleteTripBodyInput = null;
```

Output:

```ts
type CompleteTripResponse = DispatchAssignmentTripResponse;
```

For completed trips, `completion.totalPriceMinor`, `completion.currency`, and
`completion.totalDistanceMeters` come from the immutable ride request fare/route
snapshot. `completion.totalTimeTakenSeconds` is measured from stored trip start and
completion timestamps. GPS-measured trip distance and payment settlement remain out
of scope for this contract.

### `POST /dispatch-assignments/{assignmentId}/cancel-rider-no-show`

Purpose: cancel the assignment/request because the rider did not show after the
allowed wait period.

Path input:

```ts
type CancelRiderNoShowPathInput = {
  assignmentId: UUID;
};
```

Body input:

```ts
type CancelRiderNoShowBodyInput = null;
```

Output:

```ts
type CancelRiderNoShowResponse = DispatchAssignmentPickupResponse;
```

### `POST /dispatch-assignments/{assignmentId}/cancel`

Purpose: driver cancels an assigned ride.

Path input:

```ts
type CancelAssignedRidePathInput = {
  assignmentId: UUID;
};
```

Body input:

```ts
type DispatchCancellationReasonCode =
  | 'generic'
  | 'wrong_pickup'
  | 'rider_changed_mind'
  | 'driver_delay'
  | 'driver_requested'
  | 'driver_emergency'
  | 'driver_no_show'
  | 'rider_no_show'
  | 'other';

type CancelAssignedRideBodyInput = {
  reasonCode?: DispatchCancellationReasonCode;
  notes?: string;
};
```

Output:

```ts
type DispatchCancellationActorRole = 'rider' | 'driver' | 'system';

type DispatchCancellationResponse = {
  id: UUID;
  requestId: UUID;
  offerId: UUID | null;
  assignmentId: UUID | null;
  actorUserId: UUID;
  actorRole: DispatchCancellationActorRole;
  reasonCode: DispatchCancellationReasonCode;
  notes: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

### `GET /dispatch-assignments/history`

Purpose: load bounded driver history for terminal assigned rides.

Query input:

```ts
type DispatchAssignmentHistoryQueryInput = {
  limit?: number;
  offset?: number;
};
```

Output summary:

```ts
type RideRequestState =
  | 'searching'
  | 'offered'
  | 'assigned'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'no_driver_found'
  | 'system_failed';

type RideRequestResponse = {
  id: UUID;
  riderId: UUID;
  state: RideRequestState;
  pickup: Point;
  destination: Point;
  fareEstimateId: UUID | null;
  vehicleType: 'standard' | null;
  rideType: 'instant' | null;
  currency: 'ETB' | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  rateMinorPerKm: number | null;
  estimatedFareMinor: number | null;
  assignment: AssignmentSnapshot | null;
  cancellation: {
    id: UUID;
    requestId: UUID;
    offerId: UUID | null;
    assignmentId: UUID | null;
    actorUserId: UUID;
    actorRole: DispatchCancellationActorRole;
    reasonCode: DispatchCancellationReasonCode;
    notes: string | null;
    createdAt: ISODateTime;
  } | null;
  idempotencyKey: string;
  offerTtlSeconds: number;
  matchingDeadlineSeconds: number;
  matchingDeadlineAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};

type DispatchAssignmentHistoryResponse = {
  items: RideRequestResponse[];
  total: number;
  limit: number;
  offset: number;
};
```

History is not required for online presence or live dispatch offer handling.

## Socket API Type Reference

### Connection Handshake

Endpoint:

```text
wss://<backend-host>/dispatch
```

Input:

```ts
type DispatchSocketHandshakeInput = {
  headers: {
    Authorization: `Bearer ${string}`;
  };
};
```

Output:

```ts
type DispatchSocketConnectionResult =
  | { connected: true }
  | { connected: false; error: 'rejected_unauthorized' | string };
```

### App Sends: `presence:location:update`

Purpose: refresh the live Redis lease and H3 candidate index.

Input:

```ts
type DriverLocationUpdateEvent = {
  presenceSessionId: UUID;
  leaseId: UUID;
  sequence: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: ISODateTime;
  headingDegrees?: number;
  speedMetersPerSecond?: number;
};
```

Output ack:

```ts
type DriverPresenceLocationUpdateStatus =
  | 'accepted'
  | 'ignored_duplicate'
  | 'ignored_stale_sequence'
  | 'ignored_rate_limited'
  | 'rejected_invalid'
  | 'rejected_unauthorized'
  | 'rejected_not_owner'
  | 'rejected_expired_lease'
  | 'rejected_stale_capture'
  | 'unavailable_redis';

type DriverPresenceLocationUpdateAck = {
  status: DriverPresenceLocationUpdateStatus;
};
```

### App Sends: `dispatch:offer:join`

Purpose: join an authorized offer-specific realtime room.

Input:

```ts
type DispatchOfferJoinInput = {
  offerId: UUID;
};
```

Output ack:

```ts
type DispatchOfferJoinAck =
  | { success: true; room: `offer:${string}` }
  | { error: 'unauthorized' };
```

### App Sends: `dispatch:request:join`

Purpose: join an authorized request-specific realtime room after the driver has
an active offer for that request.

Input:

```ts
type DispatchRequestJoinInput = {
  requestId: UUID;
};
```

Output ack:

```ts
type DispatchRequestJoinAck =
  | { success: true; room: `request:${string}` }
  | { error: 'unauthorized' };
```

### App Sends: `dispatch:snapshot:request`

Purpose: request a reconnect snapshot from durable backend state.

Input:

```ts
type DispatchSnapshotRequestInput = {
  requestId?: UUID;
};
```

Output ack:

```ts
type DispatchSnapshotRequestAck =
  | {
      event: 'dispatch:request:snapshot';
      data: DispatchEnvelope<DispatchSnapshot>;
    }
  | { error: 'unauthorized' | 'snapshot_failed' };
```

### App Receives: `dispatch:offer:snapshot`

Purpose: notify the driver of a pending/accepted/rejected/expired/cancelled
offer snapshot.

Payload:

```ts
type DispatchEnvelope<TSnapshot> = {
  schemaVersion: 'v1';
  eventId: UUID;
  occurredAt: ISODateTime;
  userId: UUID;
  snapshot: TSnapshot;
};

type OfferSnapshot = {
  offerId: UUID;
  requestId: UUID;
  driverId: UUID;
  state: DispatchOfferState;
  etaSeconds: number;
  distanceMeters: number;
  expiresAt: ISODateTime;
  offeredAt: ISODateTime;
};

type DispatchOfferSnapshotEvent = DispatchEnvelope<OfferSnapshot>;
```

### App Receives: Assignment Events

Event names:

```text
dispatch:assignment:created
dispatch:assignment:cancelled
dispatch:assignment:pickup_arrived
dispatch:assignment:trip_start_warning
dispatch:assignment:trip_started
dispatch:assignment:trip_completed
dispatch:assignment:rider_no_show_cancelled
```

Payload:

```ts
type AssignmentSnapshot = {
  id: UUID;
  offerId: UUID;
  requestId: UUID;
  riderId: UUID;
  driverId: UUID;
  state: string;
  assignedAt: ISODateTime;
  driver: {
    id: UUID;
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
    id: UUID;
    state: DispatchAssignmentPickupState;
    arrivedAt: ISODateTime;
    warningDueAt: ISODateTime;
    warningSentAt: ISODateTime | null;
    noShowCancellableAt: ISODateTime;
    noShowCancelledAt: ISODateTime | null;
  } | null;
  trip: {
    id: UUID;
    state: DispatchAssignmentTripState;
    startedAt: ISODateTime;
    completedAt: ISODateTime | null;
  } | null;
};

type AssignmentEventPayload = {
  schemaVersion: 'v1';
  eventId: UUID;
  occurredAt: ISODateTime;
  requestId: UUID;
  offerId: UUID;
  riderId: UUID;
  driverId: UUID;
  snapshot: AssignmentSnapshot;
};
```

### App May Receive: `dispatch:request:snapshot`

The driver app may receive this after joining a request room or requesting a
snapshot. It is mainly useful for reconnect recovery.

Payload:

```ts
type RideRequestSnapshot = {
  requestId: UUID;
  state: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  matchingDeadlineAt: ISODateTime;
  createdAt: ISODateTime;
};

type DispatchSnapshot = {
  version: 'v1';
  userId: UUID;
  activeRequest: RideRequestSnapshot | null;
  activeOffer: OfferSnapshot | null;
  activeAssignment: AssignmentSnapshot | null;
  generatedAt: ISODateTime;
};

type DispatchRequestSnapshotEvent = DispatchEnvelope<DispatchSnapshot>;
```

## Top-Level Driver Flow

1. Driver logs in and receives a driver access token.
2. App connects to the `/dispatch` Socket.IO namespace.
3. App calls `GET /drivers/presence/me`.
4. If the driver is offline, app calls `POST /drivers/presence/online`.
5. App stores `presenceSessionId` and `leaseId` from the online response.
6. App starts sending `presence:location:update` socket events every few
   seconds.
7. App listens for `dispatch:offer:snapshot`.
8. When a pending offer arrives, app shows the incoming ride screen.
9. Driver accepts with `POST /dispatch-offers/{offerId}/accept` or rejects with
   `POST /dispatch-offers/{offerId}/reject`.
10. After acceptance, app listens for assignment events and may call assignment
    control endpoints.
11. On reconnect or app foreground, app refreshes presence and current offer.
12. When the driver goes offline, app calls `POST /drivers/presence/offline`
    and stops location updates.

## Presence States the App Should Model

The app should model these driver dispatch states:

| App state          | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `offline`          | Driver is not available for dispatch.                            |
| `going_online`     | App is calling `/drivers/presence/online` or `/resume`.          |
| `online_matchable` | Backend presence is online and live Redis lease is fresh.        |
| `online_stale`     | Durable profile says online, but live lease is missing or stale. |
| `incoming_offer`   | Driver has a pending dispatch offer.                             |
| `assigned`         | Driver accepted an offer and has an assignment.                  |
| `offline_blocked`  | Backend rejects offline because driver is offered or assigned.   |

`online` in Postgres is not enough by itself. The driver is only matchable while
the Redis lease and H3 live-location index are fresh.

## Step 1: Connect to Dispatch Socket

Open a Socket.IO connection to:

```text
wss://<backend-host>/dispatch
```

Handshake authentication:

```text
Authorization: Bearer <driverAccessToken>
```

After the socket connects, the app may immediately request current server state
through REST:

```text
GET https://<backend-host>/api/v1/drivers/presence/me
GET https://<backend-host>/api/v1/dispatch-offers/current
```

The socket is used for:

- sending live driver location
- receiving offer snapshots
- receiving assignment updates
- joining offer/request rooms after an offer is known

## Step 2: Check Current Presence

Request:

```text
GET https://<backend-host>/api/v1/drivers/presence/me
Authorization: Bearer <driverAccessToken>
```

Response shape:

```json
{
  "operationalState": "offline",
  "isCurrentSessionOwner": false,
  "presenceSessionId": null,
  "dispatchAvailable": false,
  "unavailableReasons": ["offline"]
}
```

Important fields:

| Field                   | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `operationalState`      | Durable state: `offline`, `online`, `offered`, `assigned`, or `suspended`.         |
| `isCurrentSessionOwner` | Whether this mobile session owns the online presence.                              |
| `presenceSessionId`     | Only returned to the owning session.                                               |
| `dispatchAvailable`     | True only when the driver is eligible, online, owner, and has fresh live presence. |
| `unavailableReasons`    | Reasons the driver is not matchable.                                               |

Common unavailable reasons:

| Reason              | App action                                                    |
| ------------------- | ------------------------------------------------------------- |
| `offline`           | Show offline UI or call go-online when driver toggles online. |
| `not_eligible`      | Show account/approval unavailable state.                      |
| `not_owner`         | Another session owns presence; require takeover or logout.    |
| `stale_presence`    | Call `/drivers/presence/resume` with current GPS.             |
| `redis_unavailable` | Show temporarily unavailable; retry resume later.             |
| `offered`           | Driver has active offer; fetch current offer.                 |
| `assigned`          | Driver has active assignment; fetch current offer/assignment. |
| `suspended`         | Show suspended/unavailable state.                             |

## Step 3: Go Online

Call this when the driver toggles online and presence is currently offline.

Request:

```text
POST https://<backend-host>/api/v1/drivers/presence/online
Authorization: Bearer <driverAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "initialLocation": {
    "latitude": 9.01,
    "longitude": 38.76,
    "accuracyMeters": 20,
    "capturedAt": "2026-06-24T12:00:00+03:00"
  },
  "takeoverConfirmed": false
}
```

Location requirements:

- `latitude`: `-90` to `90`
- `longitude`: `-180` to `180`
- `accuracyMeters`: non-negative; initial/resume location must satisfy backend
  dispatch accuracy policy
- `capturedAt`: ISO datetime with offset, close to server time

Successful response:

```json
{
  "operationalState": "online",
  "presenceSessionId": "0f8703ae-4920-43a4-9b5d-a57863dfb420",
  "leaseId": "f600d076-ce7f-4cef-bc0c-7bf69f817f5b",
  "leaseSequence": 0,
  "resumeRequired": false
}
```

App actions:

1. Store `presenceSessionId`.
2. Store `leaseId`.
3. Set next location `sequence` to `1`.
4. Start live location updates.

If `resumeRequired` is `true`, durable online state committed but Redis lease
creation failed. The app must call `/drivers/presence/resume` before treating the
driver as matchable.

Common errors:

| Status | Meaning                                                                       | App action                                                              |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `400`  | Bad/stale/too-inaccurate location.                                            | Request fresh GPS and retry.                                            |
| `403`  | Driver is not eligible for Instant Ride.                                      | Show unavailable/approval state.                                        |
| `409`  | Active offer, active assignment, suspended, or another session owns presence. | Show matching state; for another session ask for takeover confirmation. |

If backend returns a conflict saying the driver is online in another session, the
app may ask the user to confirm takeover. If confirmed, retry the same endpoint
with:

```json
{
  "takeoverConfirmed": true
}
```

## Step 4: Resume Presence

Use resume when:

- `/drivers/presence/me` returns `stale_presence`
- go-online response has `resumeRequired: true`
- socket location ack returns `rejected_expired_lease`
- app reconnects after being backgrounded long enough for Redis lease expiry

Request:

```text
POST https://<backend-host>/api/v1/drivers/presence/resume
Authorization: Bearer <driverAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "presenceSessionId": "0f8703ae-4920-43a4-9b5d-a57863dfb420",
  "currentLocation": {
    "latitude": 9.01,
    "longitude": 38.76,
    "accuracyMeters": 20,
    "capturedAt": "2026-06-24T12:00:02+03:00"
  }
}
```

Successful response:

```json
{
  "operationalState": "online",
  "presenceSessionId": "0f8703ae-4920-43a4-9b5d-a57863dfb420",
  "leaseId": "807f8dc1-71a7-40c0-8f41-776b8efad85d",
  "leaseSequence": 0,
  "resumeRequired": false
}
```

App actions:

1. Replace the old `leaseId` with the new `leaseId`.
2. Reset location sequence to `1`.
3. Continue live location updates.

## Step 5: Send Live Location Updates

After online/resume succeeds, emit this Socket.IO event:

```text
presence:location:update
```

Direction:

```text
Driver app -> backend
```

Default timing:

- expected update interval: about 3 seconds
- minimum accepted interval: about 1 second
- freshness window: about 12 seconds
- cleanup TTL: about 30 seconds

These are backend defaults and may be changed by environment configuration. The
app should send every few seconds while the driver is online.

Payload:

```json
{
  "presenceSessionId": "0f8703ae-4920-43a4-9b5d-a57863dfb420",
  "leaseId": "807f8dc1-71a7-40c0-8f41-776b8efad85d",
  "sequence": 1,
  "latitude": 9.01,
  "longitude": 38.76,
  "accuracyMeters": 20,
  "capturedAt": "2026-06-24T12:00:03+03:00",
  "headingDegrees": 90,
  "speedMetersPerSecond": 4.2
}
```

Required fields:

| Field               | Requirement                              |
| ------------------- | ---------------------------------------- |
| `presenceSessionId` | UUID from online/resume response.        |
| `leaseId`           | UUID from latest online/resume response. |
| `sequence`          | Positive integer, increasing per lease.  |
| `latitude`          | `-90` to `90`.                           |
| `longitude`         | `-180` to `180`.                         |
| `accuracyMeters`    | Non-negative.                            |
| `capturedAt`        | ISO datetime with offset.                |

Optional fields:

| Field                  | Requirement   |
| ---------------------- | ------------- |
| `headingDegrees`       | `0` to `360`. |
| `speedMetersPerSecond` | Non-negative. |

Ack response:

```json
{
  "status": "accepted"
}
```

Ack handling:

| Ack status               | Meaning                                        | App action                                        |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------- |
| `accepted`               | Location accepted and live presence refreshed. | Continue; increment sequence.                     |
| `ignored_duplicate`      | Same sequence already processed.               | Continue with next sequence.                      |
| `ignored_stale_sequence` | Sequence is lower than stored sequence.        | Continue with higher sequence.                    |
| `ignored_rate_limited`   | Update sent too soon.                          | Slow down; continue.                              |
| `rejected_invalid`       | Payload shape invalid.                         | Fix payload before retrying.                      |
| `rejected_unauthorized`  | Socket has no valid authenticated identity.    | Reconnect or refresh auth.                        |
| `rejected_not_owner`     | This session no longer owns presence.          | Stop updates; show takeover/session state.        |
| `rejected_expired_lease` | Redis lease expired or lease ID is stale.      | Call `/drivers/presence/resume`.                  |
| `rejected_stale_capture` | GPS capture time too old or too far future.    | Request fresh GPS and retry.                      |
| `unavailable_redis`      | Redis/live presence unavailable.               | Show temporarily unavailable; retry resume later. |

## Step 6: Listen for Offers

Listen for:

```text
dispatch:offer:snapshot
```

Direction:

```text
Backend -> driver app
```

Payload envelope:

```json
{
  "schemaVersion": "v1",
  "eventId": "1f2b93cd-1f9b-4d8d-9885-37ef647b5c58",
  "occurredAt": "2026-06-24T12:00:10.000Z",
  "userId": "<driverId>",
  "snapshot": {
    "offerId": "<offerId>",
    "requestId": "<requestId>",
    "driverId": "<driverId>",
    "state": "pending",
    "etaSeconds": 120,
    "distanceMeters": 1500,
    "expiresAt": "2026-06-24T12:00:25.000Z",
    "offeredAt": "2026-06-24T12:00:10.000Z"
  }
}
```

When `snapshot.state` is `pending`, show the incoming ride offer UI. Use
`expiresAt` for the response countdown.

The driver app should also fetch the current offer after reconnect or app
foreground:

```text
GET https://<backend-host>/api/v1/dispatch-offers/current
Authorization: Bearer <driverAccessToken>
```

If this endpoint returns a pending offer, show it even if no socket event was
received.

## Step 7: Join Offer and Request Rooms

After receiving an offer, the app may join scoped realtime rooms.

Join offer room:

```text
Socket event: dispatch:offer:join
```

Payload:

```json
{
  "offerId": "<offerId>"
}
```

Expected success ack:

```json
{
  "success": true,
  "room": "offer:<offerId>"
}
```

Join request room:

```text
Socket event: dispatch:request:join
```

Payload:

```json
{
  "requestId": "<requestId>"
}
```

Expected success ack:

```json
{
  "success": true,
  "room": "request:<requestId>"
}
```

If the backend returns `{ "error": "unauthorized" }`, do not retry in a loop.
Fetch current offer and reconnect if needed.

## Step 8: Accept an Offer

Request:

```text
POST https://<backend-host>/api/v1/dispatch-offers/<offerId>/accept
Authorization: Bearer <driverAccessToken>
```

No request body is required.

Successful response:

```json
{
  "id": "<offerId>",
  "requestId": "<requestId>",
  "driverId": "<driverId>",
  "state": "accepted",
  "etaSeconds": 120,
  "distanceMeters": 1500,
  "expiresAt": "2026-06-24T12:00:25.000Z",
  "offeredAt": "2026-06-24T12:00:10.000Z",
  "respondedAt": "2026-06-24T12:00:15.000Z",
  "createdAt": "2026-06-24T12:00:10.000Z",
  "updatedAt": "2026-06-24T12:00:15.000Z"
}
```

After accept succeeds:

1. Stop showing the incoming offer countdown.
2. Fetch `GET /dispatch-offers/current`.
3. Fetch `GET /dispatch-assignments/active`.
4. Listen for `dispatch:assignment:created`.
5. Show the assignment/pickup UI once assignment details are available.

## Step 9: Reject an Offer

Request:

```text
POST https://<backend-host>/api/v1/dispatch-offers/<offerId>/reject
Authorization: Bearer <driverAccessToken>
```

No request body is required.

Successful response has `state: "rejected"`.

After reject succeeds:

1. Dismiss the incoming offer UI.
2. Continue location updates if the driver remains online.
3. Return driver UI to online/searching-for-rides state.

## Step 10: Assignment Events

After an accepted offer, listen for:

```text
dispatch:assignment:created
dispatch:assignment:cancelled
dispatch:assignment:pickup_arrived
dispatch:assignment:trip_start_warning
dispatch:assignment:trip_started
dispatch:assignment:trip_completed
dispatch:assignment:rider_no_show_cancelled
```

Assignment-created payload:

```json
{
  "schemaVersion": "v1",
  "eventId": "<eventId>",
  "occurredAt": "2026-06-24T12:00:16.000Z",
  "requestId": "<requestId>",
  "offerId": "<offerId>",
  "riderId": "<riderId>",
  "driverId": "<driverId>",
  "snapshot": {
    "id": "<assignmentId>",
    "offerId": "<offerId>",
    "requestId": "<requestId>",
    "riderId": "<riderId>",
    "driverId": "<driverId>",
    "state": "assigned",
    "assignedAt": "2026-06-24T12:00:16.000Z",
    "driver": {
      "id": "<driverId>",
      "fullName": "Driver Name",
      "phone": "+251900000000",
      "rating": 5
    },
    "vehicle": {
      "make": "Toyota",
      "model": "Vitz",
      "color": "Blue",
      "plateRegion": "aa",
      "plateCode": "03",
      "plateCodeSubtype": "transport_service",
      "plateNumber": "12345"
    },
    "pickup": null,
    "trip": null
  }
}
```

The assignment ID is:

```text
payload.snapshot.id
```

Use that ID for assignment control endpoints.

## Step 11: Mark Arrival at Pickup

Request:

```text
POST https://<backend-host>/api/v1/dispatch-assignments/<assignmentId>/arrive-at-pickup
Authorization: Bearer <driverAccessToken>
```

No request body is required.

After this succeeds, the backend stores pickup-arrival state and may later allow
no-show cancellation after the configured wait period.

## Step 12: Start And Complete Trip

Start the trip:

```text
POST https://<backend-host>/api/v1/dispatch-assignments/<assignmentId>/start-trip
Authorization: Bearer <driverAccessToken>
```

Complete the trip:

```text
POST https://<backend-host>/api/v1/dispatch-assignments/<assignmentId>/complete-trip
Authorization: Bearer <driverAccessToken>
```

After completion, `GET /dispatch-assignments/active` and
`GET /dispatch-offers/current` return `null` for that ride. Use
`GET /dispatch-assignments/history` for the completed record.

## Step 13: Cancel Rider No-Show

Request:

```text
POST https://<backend-host>/api/v1/dispatch-assignments/<assignmentId>/cancel-rider-no-show
Authorization: Bearer <driverAccessToken>
```

No request body is required.

Only show this action after arrival and after the backend-provided/no-show wait
period has elapsed.

## Step 14: Cancel Assigned Ride

Request:

```text
POST https://<backend-host>/api/v1/dispatch-assignments/<assignmentId>/cancel
Authorization: Bearer <driverAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "reasonCode": "driver_requested",
  "notes": "optional note"
}
```

Allowed reason codes are backend-defined. Common driver-side values include:

```text
driver_requested
driver_emergency
driver_no_show
other
```

## Step 15: Go Offline

Only call offline when the driver is not in an active pending offer or active
assignment.

Request:

```text
POST https://<backend-host>/api/v1/drivers/presence/offline
Authorization: Bearer <driverAccessToken>
```

No request body is required.

Successful response:

```json
{
  "operationalState": "offline",
  "presenceSessionId": null,
  "leaseId": null,
  "leaseSequence": null,
  "resumeRequired": false
}
```

App actions:

1. Stop live location timer.
2. Clear local `presenceSessionId`, `leaseId`, and sequence.
3. Show offline UI.

If backend returns conflict because the driver has an active offer or assignment,
keep the current dispatch UI and do not clear local state.

## Reconnect and App Lifecycle Rules

Run this recovery sequence whenever:

- app comes to foreground
- socket reconnects
- access token refreshes
- location updates fail repeatedly
- location permission changes

Recovery sequence:

1. Reconnect `/dispatch` socket with current token.
2. Call `GET /drivers/presence/me`.
3. If `dispatchAvailable` is true, continue location updates.
4. If `stale_presence`, call `/drivers/presence/resume`.
5. If `not_owner`, stop updates and show ownership/takeover state.
6. Call `GET /dispatch-offers/current`.
7. Call `GET /dispatch-assignments/active`.
8. If a pending offer exists, show offer UI.
9. If an active assignment exists, show assignment/current ride UI.

If the OS prevents background location updates, assume the driver may become
stale while backgrounded. On foreground, call `/drivers/presence/me` and resume
if needed.

## Local Data to Store

Store these while the driver is online:

| Value                    | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `presenceSessionId`      | Identifies the durable online presence session.           |
| `leaseId`                | Identifies the current Redis live-location lease.         |
| `sequence`               | Monotonic location update sequence for the current lease. |
| `lastAcceptedLocationAt` | Optional local debug/health display.                      |
| `currentOfferId`         | Optional recovery/UI convenience.                         |
| `currentAssignmentId`    | Optional recovery/UI convenience.                         |

Do not reuse an old `leaseId` after `/resume`. Resume returns a new lease and
the app must reset sequence to `1`.

## QA Checklist

Use this checklist for driver mobile QA:

- Driver can connect to `/dispatch` with a valid token.
- `GET /drivers/presence/me` works after login.
- Offline driver can call `/drivers/presence/online`.
- App stores `presenceSessionId` and `leaseId`.
- First `presence:location:update` uses sequence `1`.
- Location update ack returns `accepted`.
- Location updates continue every few seconds while online.
- If app waits beyond lease TTL, next update returns expired/stale and app calls
  `/resume`.
- `/resume` returns a new `leaseId` and app resets sequence.
- Pending offer appears through `dispatch:offer:snapshot`.
- Pending offer also appears through `GET /dispatch-offers/current`.
- Accept endpoint changes offer state to `accepted`.
- Reject endpoint changes offer state to `rejected`.
- Assignment-created event exposes `assignmentId`.
- Arrive-at-pickup endpoint works after assignment.
- Offline endpoint works only when no active offer/assignment blocks it.
- App stops location updates after successful offline.
- Reconnect/foreground flow recovers presence and current offer.

## Troubleshooting

Driver online but no offers:

- Confirm `/drivers/presence/me` returns `dispatchAvailable: true`.
- Confirm location ack is `accepted`.
- Confirm app is still sending location updates within the freshness window.
- Confirm GPS accuracy and capture time are valid.
- Confirm `GET /dispatch-offers/current` is checked on foreground/reconnect.
- If all driver-side checks pass, matching is backend-side; frontend cannot
  create a match job.

Offer event missed:

- Call `GET /dispatch-offers/current`.
- Reconnect `/dispatch`.
- Join offer room after offer is known.

Lease expired:

- Call `/drivers/presence/resume`.
- Replace `leaseId`.
- Reset sequence to `1`.

Another device owns presence:

- Stop sending location updates.
- Show takeover/session message.
- If product allows takeover, call `/drivers/presence/online` with
  `takeoverConfirmed: true`.

Redis unavailable:

- Driver is not reliably matchable.
- Keep UI in temporarily unavailable state.
- Retry `/drivers/presence/resume` later.

## Backend Boundary

The driver app only maintains availability and responds to offers. It does not:

- create ride requests
- choose candidates
- enqueue match jobs
- assign riders
- mutate dispatch attempts

If the driver is online and sending accepted location updates but no offer is
created for a rider request, backend should inspect matching jobs, request state,
candidate discovery, and `dispatch_offer` creation.
