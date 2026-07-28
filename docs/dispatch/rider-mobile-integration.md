# Rider Mobile Dispatch Integration

This guide describes the rider-side mobile integration for Instant Ride dispatch.
It uses placeholder backend addresses and intentionally avoids mobile package
recommendations.

## Scope

This document covers only the rider app:

- connecting to dispatch realtime
- creating fare estimates
- creating Instant Ride requests
- observing matching/request progress
- receiving assignment details
- cancelling active requests
- recovering state after reconnect or app foreground
- reading rider ride history

The rider app does not choose drivers and does not create matches directly.
Matching is backend-owned after a ride request is created.

## Base Addresses

Use these placeholders in client configuration:

```text
REST base URL: https://<backend-host>/api/v1
Socket.IO namespace: wss://<backend-host>/dispatch
```

The `/dispatch` endpoint is a Socket.IO namespace, not a raw WebSocket protocol.
The app sends authentication in the socket handshake, then sends and receives
named socket events over that connection.

## Authentication

All REST calls require:

```text
Authorization: Bearer <riderAccessToken>
```

For Socket.IO, prefer the authorization header in the handshake:

```text
Authorization: Bearer <riderAccessToken>
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
```

## Top-Level Rider Flow

1. Rider logs in and receives a rider access token.
2. App connects to the `/dispatch` Socket.IO namespace.
3. App gets pickup and destination coordinates from the user.
4. App calls `POST /fare-estimates`.
5. App shows the fare estimate and waits for rider confirmation.
6. Rider confirms.
7. App calls `POST /ride-requests` with the `fareEstimateId` and a stable
   `idempotencyKey`.
8. App stores the returned `requestId`.
9. App joins the request room with `dispatch:request:join`.
10. App listens for `dispatch:request:snapshot`.
11. While state is `searching` or `offered`, app shows finding-driver UI.
12. When `activeAssignment` appears, app shows assigned-driver UI.
13. If request becomes terminal, app shows the terminal result.
14. On reconnect or app foreground, app calls `GET /ride-requests/current` and
    requests a socket snapshot.
15. If rider cancels, app calls `POST /ride-requests/{requestId}/cancel`.

## Rider States the App Should Model

| App state                 | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `idle`                    | Rider has no active dispatch request.                         |
| `estimating_fare`         | App is creating or refreshing a fare estimate.                |
| `confirming_request`      | Rider is viewing fare/pickup/dropoff before request creation. |
| `creating_request`        | App is calling `/ride-requests`.                              |
| `finding_driver`          | Backend request is `searching` or internally `offered`.       |
| `driver_assigned`         | Backend snapshot includes `activeAssignment`.                 |
| `cancelled`               | Request was cancelled.                                        |
| `no_driver_found`         | Matching ended with no driver.                                |
| `expired`                 | Matching deadline expired.                                    |
| `temporarily_unavailable` | Request ended as `system_failed`.                             |

For riders, `searching` and `offered` should both normally render as
`finding_driver`. Individual sequential offers are internal dispatch behavior.

## REST API Type Reference

### `POST /fare-estimates`

Purpose: create a fare estimate before creating a ride request.

Input:

```ts
type CreateFareEstimateInput = {
  pickup: Point;
  destination: Point;
  vehicleType?: 'standard';
};
```

Output:

```ts
type FareEstimateResponse = {
  id: UUID;
  pickup: Point;
  destination: Point;
  vehicleType: 'standard';
  currency: 'ETB';
  distanceMeters: number;
  durationSeconds: number;
  rateMinorPerKm: number;
  estimatedFareMinor: number;
  expiresAt: ISODateTime;
  createdAt: ISODateTime;
};
```

Notes:

- `vehicleType` currently supports only `standard`.
- The estimate expires. Create the ride request before `expiresAt`.
- Request creation requires a valid, rider-owned, unexpired `fareEstimateId`.

### `POST /ride-requests`

Purpose: create the rider's Instant Ride dispatch request.

Input:

```ts
type CreateRideRequestInput = {
  pickup: Point;
  destination: Point;
  fareEstimateId: UUID;
  idempotencyKey: string;
};
```

Output:

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

type DispatchCancellationActorRole = 'rider' | 'driver' | 'system';

type AssignmentPickupSnapshot = {
  id: UUID;
  state: 'arrived' | 'warning_sent' | 'rider_no_show_cancelled';
  arrivedAt: ISODateTime;
  warningDueAt: ISODateTime;
  warningSentAt: ISODateTime | null;
  noShowCancellableAt: ISODateTime;
  noShowCancelledAt: ISODateTime | null;
};

type AssignmentTripSnapshot = {
  id: UUID;
  state: 'started' | 'completed';
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
};

type AssignmentSnapshot = {
  id: UUID;
  offerId: UUID;
  requestId: UUID;
  riderId: UUID;
  driverId: UUID;
  state: 'assigned';
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
  pickup: AssignmentPickupSnapshot | null;
  trip: AssignmentTripSnapshot | null;
};

type DispatchCancellationSnapshot = {
  id: UUID;
  requestId: UUID;
  offerId: UUID | null;
  assignmentId: UUID | null;
  actorUserId: UUID;
  actorRole: DispatchCancellationActorRole;
  reasonCode: DispatchCancellationReasonCode;
  notes: string | null;
  createdAt: ISODateTime;
};

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
  cancellation: DispatchCancellationSnapshot | null;
  idempotencyKey: string;
  offerTtlSeconds: number;
  matchingDeadlineSeconds: number;
  matchingDeadlineAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

Idempotency rule:

- Generate one stable `idempotencyKey` for one rider confirmation action.
- Reuse the same key when retrying the same request after a network failure.
- Do not reuse the same key for a different pickup, destination, or fare
  estimate.

Common errors:

| Status | Meaning                                                                                   | App action                               |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `404`  | Fare estimate not found for this rider.                                                   | Create a new estimate.                   |
| `409`  | Active request exists, fare estimate expired/reused, route mismatch, or rollout disabled. | Refresh state and show specific failure. |

### `GET /ride-requests/current`

Purpose: recover the rider's active request after reconnect, app foreground, or
missed realtime event.

Input:

```ts
type GetCurrentRideRequestInput = null;
```

Output:

```ts
type CurrentRideRequestResponse = RideRequestResponse | null;
```

If output is `null`, the rider has no active `searching`, `offered`, or
`assigned` request.

### `GET /ride-requests/{requestId}`

Purpose: load one rider-owned request by ID.

Path input:

```ts
type GetRideRequestPathInput = {
  requestId: UUID;
};
```

Output:

```ts
type GetRideRequestResponse = RideRequestResponse;
```

### `POST /ride-requests/{requestId}/cancel`

Purpose: cancel an active rider request.

Path input:

```ts
type CancelRideRequestPathInput = {
  requestId: UUID;
};
```

Body input:

```ts
type CancelRideRequestInput = {
  reasonCode?: DispatchCancellationReasonCode;
  notes?: string;
};
```

Output:

```ts
type CancelRideRequestResponse = RideRequestResponse;
```

Notes:

- Cancellation is allowed for `searching`, `offered`, and `assigned` states.
- Cancelling after assignment is terminal in V1 and does not rematch
  automatically.

### `GET /ride-requests/history`

Purpose: load bounded rider history for terminal requests.

Query input:

```ts
type RideRequestsHistoryQueryInput = {
  limit?: number;
  offset?: number;
};
```

Output:

```ts
type RideRequestsHistoryResponse = {
  items: RideRequestResponse[];
  total: number;
  limit: number;
  offset: number;
};
```

Rules:

- Default `limit` is `20`.
- Maximum `limit` is `50`.
- `offset` defaults to `0`.
- History returns terminal states only: `completed`, `cancelled`, `expired`,
  `no_driver_found`, and `system_failed`.

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

### App Sends: `dispatch:request:join`

Purpose: join the realtime room for a rider-owned request.

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

The rider can join their own request room. If the backend returns
`unauthorized`, refresh current request state and avoid retry loops.

### App Sends: `dispatch:offer:join`

Purpose: join an offer room after an offer exists for the rider's request.

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

The rider app usually does not need this for basic request tracking. The main
source of truth should be `dispatch:request:snapshot`.

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

### App Receives: `dispatch:request:snapshot`

Purpose: receive current rider dispatch state.

Payload:

```ts
type DispatchEnvelope<TSnapshot> = {
  schemaVersion: 'v1';
  eventId: UUID;
  occurredAt: ISODateTime;
  userId: UUID;
  snapshot: TSnapshot;
};

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

type OfferSnapshot = {
  offerId: UUID;
  requestId: UUID;
  driverId: UUID;
  state: string;
  etaSeconds: number;
  distanceMeters: number;
  expiresAt: ISODateTime;
  offeredAt: ISODateTime;
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

Rendering rules:

- `activeRequest == null`: no active request; show idle state.
- `activeRequest.state == 'searching'`: show finding-driver.
- `activeRequest.state == 'offered'`: still show finding-driver to rider.
- `activeAssignment != null`: show assigned-driver UI.
- `activeRequest.state == 'completed'`: show completed state or route to receipt/history.
- `activeRequest.state == 'cancelled'`: show cancelled.
- `activeRequest.state == 'expired'`: show expired/no longer searching.
- `activeRequest.state == 'no_driver_found'`: show no driver found.
- `activeRequest.state == 'system_failed'`: show temporarily unavailable.

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

Rendering rules:

- `dispatch:assignment:created`: show assigned-driver UI.
- `dispatch:assignment:cancelled`: show cancelled/ended state and refresh
  current request.
- `dispatch:assignment:pickup_arrived`: show driver-arrived UI.
- `dispatch:assignment:trip_start_warning`: warn rider to start/meet driver.
- `dispatch:assignment:trip_started`: show in-trip state.
- `dispatch:assignment:trip_completed`: show completed state and refresh current/history.
- `dispatch:assignment:rider_no_show_cancelled`: show no-show cancellation
  result.

### App May Receive: `dispatch:offer:snapshot`

The backend can emit offer snapshots to request rooms. Rider UI should normally
ignore individual offer details and continue showing finding-driver until an
assignment or terminal request state is received.

Payload:

```ts
type DispatchOfferSnapshotEvent = DispatchEnvelope<OfferSnapshot>;
```

## Step 1: Connect to Dispatch Socket

Open a Socket.IO connection to:

```text
wss://<backend-host>/dispatch
```

Handshake authentication:

```text
Authorization: Bearer <riderAccessToken>
```

After socket connection, recover current state through REST:

```text
GET https://<backend-host>/api/v1/ride-requests/current
```

If the response contains an active request, join its request room.

## Step 2: Create a Fare Estimate

Request:

```text
POST https://<backend-host>/api/v1/fare-estimates
Authorization: Bearer <riderAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "pickup": {
    "latitude": 9.01,
    "longitude": 38.76
  },
  "destination": {
    "latitude": 9.03,
    "longitude": 38.78
  },
  "vehicleType": "standard"
}
```

Successful response:

```json
{
  "id": "51c83717-8bdc-478f-8752-f3f6d0f7026a",
  "pickup": {
    "latitude": 9.01,
    "longitude": 38.76
  },
  "destination": {
    "latitude": 9.03,
    "longitude": 38.78
  },
  "vehicleType": "standard",
  "currency": "ETB",
  "distanceMeters": 4000,
  "durationSeconds": 900,
  "rateMinorPerKm": 900,
  "estimatedFareMinor": 3600,
  "expiresAt": "2026-06-24T12:05:00.000Z",
  "createdAt": "2026-06-24T12:00:00.000Z"
}
```

App actions:

1. Show fare estimate to rider.
2. Store `fareEstimateId`.
3. Make rider confirm before `expiresAt`.

## Step 3: Create a Ride Request

Request:

```text
POST https://<backend-host>/api/v1/ride-requests
Authorization: Bearer <riderAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "pickup": {
    "latitude": 9.01,
    "longitude": 38.76
  },
  "destination": {
    "latitude": 9.03,
    "longitude": 38.78
  },
  "fareEstimateId": "51c83717-8bdc-478f-8752-f3f6d0f7026a",
  "idempotencyKey": "0a9651d9-9f99-43fd-9d42-91eb0dfebc67"
}
```

Successful response has `state: "searching"`.

App actions:

1. Store `requestId`.
2. Show finding-driver UI.
3. Join request room with `dispatch:request:join`.
4. Start listening for `dispatch:request:snapshot`.

## Step 4: Join Request Room

Socket event:

```text
dispatch:request:join
```

Payload:

```json
{
  "requestId": "<requestId>"
}
```

Expected ack:

```json
{
  "success": true,
  "room": "request:<requestId>"
}
```

If ack is unauthorized, call `GET /ride-requests/current` and use that response
to decide whether the request is still active.

## Step 5: Listen for Request Snapshots

Socket event:

```text
dispatch:request:snapshot
```

Use `payload.snapshot` as the rider UI source of truth.

Important fields:

```text
payload.snapshot.activeRequest
payload.snapshot.activeOffer
payload.snapshot.activeAssignment
```

Recommended UI behavior:

| Snapshot condition                      | UI                       |
| --------------------------------------- | ------------------------ |
| `activeRequest.state = searching`       | Finding driver.          |
| `activeRequest.state = offered`         | Finding driver.          |
| `activeAssignment != null`              | Driver assigned.         |
| `activeRequest.state = no_driver_found` | No driver found.         |
| `activeRequest.state = system_failed`   | Temporarily unavailable. |
| `activeRequest.state = cancelled`       | Cancelled.               |
| `activeRequest = null`                  | No active ride.          |

## Step 6: Recover State on Foreground or Reconnect

Run this sequence whenever the app foregrounds, socket reconnects, or token
refreshes:

1. Reconnect `/dispatch` socket with the current token.
2. Call `GET /ride-requests/current`.
3. If response is `null`, show idle state.
4. If response has request ID, join request room.
5. Emit `dispatch:snapshot:request` with the request ID.
6. Render from the snapshot ack or the REST response, whichever arrives first.

Snapshot request:

```text
Socket event: dispatch:snapshot:request
```

Payload:

```json
{
  "requestId": "<requestId>"
}
```

Successful ack:

```json
{
  "event": "dispatch:request:snapshot",
  "data": {
    "schemaVersion": "v1",
    "eventId": "<eventId>",
    "occurredAt": "2026-06-24T12:00:00.000Z",
    "userId": "<riderId>",
    "snapshot": {
      "version": "v1",
      "userId": "<riderId>",
      "activeRequest": {},
      "activeOffer": null,
      "activeAssignment": null,
      "generatedAt": "2026-06-24T12:00:00.000Z"
    }
  }
}
```

## Step 7: Cancel an Active Request

Request:

```text
POST https://<backend-host>/api/v1/ride-requests/<requestId>/cancel
Authorization: Bearer <riderAccessToken>
Content-Type: application/json
```

Body:

```json
{
  "reasonCode": "generic",
  "notes": "optional note"
}
```

After success:

1. Show cancelled state.
2. Stop finding-driver UI.
3. Keep listening briefly for final realtime snapshot, or refresh current
   request.

## Step 8: Load History

Request:

```text
GET https://<backend-host>/api/v1/ride-requests/history?limit=20&offset=0
Authorization: Bearer <riderAccessToken>
```

Use this only for historical ride screens. Do not use history to recover the
active ride; use `GET /ride-requests/current` for active recovery.

## Reconnect and Failure Rules

Network failure while creating fare estimate:

- Retry `POST /fare-estimates` if no response was received.
- A new fare estimate is acceptable.

Network failure while creating ride request:

- Retry `POST /ride-requests` with the same `idempotencyKey` and identical
  payload.
- Do not generate a new idempotency key for the same rider confirmation action.

Fare estimate expired:

- Create a new fare estimate.
- Ask rider to confirm again.

Active request conflict:

- Call `GET /ride-requests/current`.
- Show the existing active request instead of creating a new one.

Socket disconnected:

- Keep the current REST-backed UI.
- Reconnect socket.
- Join request room again.
- Request snapshot.

No assignment after request creation:

- Keep showing finding-driver until backend sends terminal state or assignment.
- The rider app cannot force matching.

## Local Data to Store

Store these while a request is active:

| Value                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `fareEstimateId`     | Used to create request after rider confirms.       |
| `requestId`          | Used for room join, cancellation, and recovery.    |
| `idempotencyKey`     | Used to safely retry request creation.             |
| `matchingDeadlineAt` | Optional local countdown/display.                  |
| `activeAssignmentId` | Optional UI/recovery convenience after assignment. |

Do not reuse an old `fareEstimateId` for a new ride after it has been bound to a
request.

## QA Checklist

Use this checklist for rider mobile QA:

- Rider can connect to `/dispatch` with a valid token.
- Rider can create a fare estimate.
- App prevents confirmation after estimate expiry or refreshes estimate.
- Rider can create a ride request with `fareEstimateId`.
- Retrying request creation with same `idempotencyKey` returns the same request.
- App joins request room after request creation.
- App receives or requests `dispatch:request:snapshot`.
- `searching` renders as finding-driver.
- `offered` still renders as finding-driver.
- Assignment snapshot renders assigned-driver UI.
- Driver-arrived assignment event updates rider UI.
- Trip-start warning assignment event updates rider UI.
- No-driver-found terminal state renders correctly.
- System-failed terminal state renders as temporarily unavailable.
- Rider can cancel active request.
- Reconnect/foreground flow recovers current request.
- History endpoint loads terminal requests separately from current request.

## Backend Boundary

The rider app creates demand and observes state. It does not:

- choose candidate drivers
- decide which driver receives an offer
- enqueue match jobs
- assign drivers
- mutate dispatch attempts

If a request is created and remains `searching` without becoming assigned or
terminal, backend should inspect matching jobs, workers, candidate discovery,
and offer creation.
