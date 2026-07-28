# Instant Ride V1 API and Event Contracts

**Status:** Approved

**Approved:** 2026-06-14

**Roadmap task:** `D0.6`

This document defines the initial REST, Socket.IO, outbox, idempotency, and
error/conflict contracts for Instant Ride dispatch. It is a reference contract for later
implementation tasks. It does not authorize runtime code, schemas, dependencies, or
infrastructure changes by itself.

## Contract Principles

- All REST routes are versioned under `/api/v1`.
- Authenticated REST commands use the existing mobile `SessionGuard` pattern.
- Controllers derive rider/driver identity from the authenticated session. Clients do
  not pass arbitrary rider IDs or driver IDs for authority.
- DTOs and response payloads use strict Zod validation/serialization.
- Timestamps are ISO 8601 UTC strings.
- Coordinates are latitude/longitude fields, never ambiguous arrays.
- Mutating commands return a current canonical snapshot of the affected aggregate.
- Socket.IO events are delivery hints. Clients recover correctness from REST snapshot
  queries after reconnect.
- Domain side effects are emitted only from committed durable outbox events.

## REST Conventions

| Concern                                               | Contract                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Authentication                                        | `Authorization: Bearer <accessToken>`                                  |
| Request creation                                      | Requires `idempotencyKey` in the strict request body                   |
| Validation failure                                    | `400 Bad Request` using the existing API error envelope                |
| Missing/invalid auth                                  | `401 Unauthorized`                                                     |
| Authenticated but not allowed                         | `403 Forbidden` when the resource existence is not sensitive           |
| Not found or not owned                                | `404 Not Found` when exposing ownership would leak another user's data |
| Domain conflict                                       | `409 Conflict`                                                         |
| Unavailable dependency with no committed state change | `503 Service Unavailable`                                              |

The existing API error envelope remains:

```json
{
  "statusCode": 409,
  "error": "ConflictException",
  "message": "idempotency key was reused with a different payload",
  "path": "/api/v1/ride-requests",
  "timestamp": "2026-06-14T00:00:00.000Z"
}
```

Future implementation may add stable machine-readable error codes, but D0.6 does not
require changing the global error envelope.

## Shared Location Input

Presence commands and Socket.IO location ingestion share the same coordinate semantics:

| Field                  | Required | Contract                                                    |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `latitude`             | yes      | finite number in `[-90, 90]`                                |
| `longitude`            | yes      | finite number in `[-180, 180]`                              |
| `accuracyMeters`       | yes      | finite non-negative number no greater than configured limit |
| `capturedAt`           | yes      | client capture timestamp for replay/skew checks             |
| `headingDegrees`       | no       | finite number when provided                                 |
| `speedMetersPerSecond` | no       | finite non-negative number when provided                    |

The server computes server receipt time, H3 cell, freshness, and expiry metadata.
Freshness is based on server receipt time, not client capture time.

## Fare Estimate REST Contract

Fare estimate routes are owned by `FareEstimatesModule`.

### `POST /api/v1/fare-estimates`

Creates a temporary rider-owned fare estimate for the given route.

Headers:

- `Authorization: Bearer <accessToken>`

Actor:

- authenticated active rider-capable user.

Request body:

```json
{
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "vehicleType": "standard"
}
```

Behavior:

- `vehicleType` defaults to `standard`; any other vehicle type is rejected until product
  pricing is approved.
- The service calls the routing provider boundary outside the database transaction, then
  persists the committed estimate in a transaction.
- The temporary fare policy is `ETB`, `9 ETB/km`, rounded to the nearest whole ETB, with a
  five-minute estimate expiry.
- Routing provider failure returns `503 Service Unavailable`.
- Unreachable or non-positive routes return `422 Unprocessable Entity`.
- Request creation requires a rider-owned, unexpired estimate and stores an immutable
  fare/vehicle snapshot on the ride request.

Successful response:

```json
{
  "id": "019ee375-7bd7-70d8-9bb4-3dc3ed66c004",
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "vehicleType": "standard",
  "currency": "ETB",
  "distanceMeters": 1250,
  "durationSeconds": 180,
  "rateMinorPerKm": 900,
  "estimatedFareMinor": 1100,
  "expiresAt": "2026-06-21T12:05:00.000Z",
  "createdAt": "2026-06-21T12:00:00.000Z"
}
```

## Driver Presence REST Contract

Driver presence routes are owned by `DriverPresenceModule`.

### `POST /api/v1/drivers/presence/online`

Starts online intent or performs an explicit second-device takeover.

Actor:

- authenticated user with approved Instant Ride driver capability;
- user must be active, not deleted, durably eligible, and not operationally suspended.

Request body:

```json
{
  "initialLocation": {
    "latitude": 9.0192,
    "longitude": 38.7525,
    "accuracyMeters": 12,
    "capturedAt": "2026-06-14T09:00:00.000Z"
  },
  "takeoverConfirmed": false
}
```

Behavior:

- Allowed from durable driver state `offline`.
- Allowed from durable driver state `online` only when another mobile session owns the
  current presence authority and `takeoverConfirmed=true`.
- Rejected while driver state is `offered` or `assigned`.
- Rejected from `suspended`.
- Creates or replaces durable owner session, `presenceSessionId`, and generation in one
  PostgreSQL transaction.
- Attempts post-commit Redis lease creation with the command location at server-assigned
  sequence `0`.

Successful response when Redis lease is established:

```json
{
  "operationalState": "online",
  "presenceSessionId": "ps_opaque",
  "leaseId": "lease_opaque",
  "leaseSequence": 0,
  "resumeRequired": false
}
```

Successful response when PostgreSQL commits but Redis lease creation fails:

```json
{
  "operationalState": "online",
  "presenceSessionId": "ps_opaque",
  "leaseId": null,
  "leaseSequence": null,
  "resumeRequired": true
}
```

In the second case, the driver is durably online but not dispatch-available until
`resume` establishes a fresh Redis lease.

### `POST /api/v1/drivers/presence/resume`

Recreates an ephemeral Redis lease after reconnect, Redis lease expiry, or Redis loss.

Actor:

- authenticated mobile session that currently owns durable presence authority.

Request body:

```json
{
  "presenceSessionId": "ps_opaque",
  "currentLocation": {
    "latitude": 9.0192,
    "longitude": 38.7525,
    "accuracyMeters": 12,
    "capturedAt": "2026-06-14T09:00:03.000Z"
  }
}
```

Behavior:

- Does not change durable state, owner, presence session ID, or generation.
- Validates durable `online` state, owning auth session, `presenceSessionId`, generation,
  and eligibility.
- Creates a new server-generated `leaseId` and stores the current location at sequence
  `0`.
- Fails with `503` if Redis cannot create the lease because no durable state change is
  committed by resume.

Successful response:

```json
{
  "operationalState": "online",
  "presenceSessionId": "ps_opaque",
  "leaseId": "lease_opaque",
  "leaseSequence": 0,
  "resumeRequired": false
}
```

### `POST /api/v1/drivers/presence/offline`

Ends online intent for the current driver when dispatch state allows it.

Behavior:

- Idempotently returns offline state if already offline.
- Allowed while `online`.
- Rejected with `409 Conflict` while `offered` or `assigned`; the offer/trip lifecycle
  must resolve first.
- Advances durable generation and invalidates owner authority in PostgreSQL.
- Post-commit Redis invalidation may lag; durable state immediately wins for matching.

Response:

```json
{
  "operationalState": "offline",
  "presenceSessionId": null,
  "leaseId": null,
  "resumeRequired": false
}
```

### `GET /api/v1/drivers/presence/me`

Returns the current authenticated driver's operational/presence snapshot.

Response fields:

- durable `operationalState`;
- whether the authenticated session owns the current presence authority;
- `presenceSessionId` only when the current session is the owner;
- derived dispatch availability;
- unavailable reasons such as `not_eligible`, `stale_presence`, `redis_unavailable`,
  `offered`, `assigned`, or `suspended`;
- no precise pre-assignment coordinate history.

## Ride Request REST Contract

Ride request routes are owned by `RideRequestsModule`.

### `POST /api/v1/ride-requests`

Creates an Instant Ride request.

Headers:

- `Authorization: Bearer <accessToken>`

Actor:

- authenticated active rider-capable user.

Request body:

```json
{
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "fareEstimateId": "019ee375-7bd7-70d8-9bb4-3dc3ed66c004",
  "idempotencyKey": "client-generated-key"
}
```

Behavior:

- `fareEstimateId` is required and must reference an authenticated-rider-owned fare
  estimate for the same pickup/destination coordinates.
- Expired, already-bound, or route-mismatched estimates return `409 Conflict`.
- Missing or other-rider estimates return `404 Not Found`.
- Successful first creation stores an immutable snapshot of the estimate on the request:
  `fareEstimateId`, `vehicleType`, `rideType`, `currency`, `distanceMeters`,
  `durationSeconds`, `rateMinorPerKm`, and `estimatedFareMinor`.
- `rideType` is always `instant` in this V1 contract; Shared Ride is out of scope.
- Repeating the same rider, idempotency key, and payload returns the original request
  snapshot even if the bound estimate later expires.
- Reusing the same rider and idempotency key with a different payload returns
  `409 Conflict`.
- A rider with an existing non-terminal Instant Ride request receives `409 Conflict`.
- Request creation, fare estimate binding, fare/vehicle snapshot storage, and
  dispatch-start outbox intent commit in the same transaction.

Response status:

- `201 Created` for first creation.
- `200 OK` for an idempotent replay of the same creation.

Successful response includes the canonical request plus the bound fare snapshot:

```json
{
  "id": "019ee376-4f73-7240-85d5-41f724f5f03a",
  "riderId": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
  "state": "searching",
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "fareEstimateId": "019ee375-7bd7-70d8-9bb4-3dc3ed66c004",
  "vehicleType": "standard",
  "rideType": "instant",
  "currency": "ETB",
  "distanceMeters": 1250,
  "durationSeconds": 180,
  "rateMinorPerKm": 900,
  "estimatedFareMinor": 1100,
  "assignment": null,
  "cancellation": null,
  "idempotencyKey": "client-generated-key",
  "offerTtlSeconds": 10,
  "matchingDeadlineSeconds": 120,
  "matchingDeadlineAt": "2026-06-21T12:02:00.000Z",
  "createdAt": "2026-06-21T12:00:00.000Z",
  "updatedAt": "2026-06-21T12:00:00.000Z"
}
```

`assignment` is `null` until a driver accepts. After assignment commits, rider request
responses include the durable assignment snapshot:

```json
{
  "assignment": {
    "id": "019ee377-d6d1-7d1d-91a6-d82f6eeaf2dd",
    "offerId": "019ee377-8d35-7854-a48d-d426f90e8581",
    "requestId": "019ee376-4f73-7240-85d5-41f724f5f03a",
    "riderId": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
    "driverId": "019ee377-c45b-7963-a00f-7e3d2a089816",
    "state": "assigned",
    "assignedAt": "2026-06-21T12:01:00.000Z",
    "driver": {
      "id": "019ee377-c45b-7963-a00f-7e3d2a089816",
      "fullName": "Aster Bekele",
      "phone": "+251911111111",
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

### `GET /api/v1/ride-requests/current`

Returns the authenticated rider's current non-terminal request, or `null` when none
exists.

### `GET /api/v1/ride-requests/:id`

Returns the authenticated rider's request snapshot. Requests owned by another rider are
reported as `404 Not Found`.

### `POST /api/v1/ride-requests/:id/cancel`

Cancels the authenticated rider's request with optional structured cancellation
details.

Request body:

```json
{
  "reasonCode": "rider_changed_mind",
  "notes": "Optional rider-provided note, maximum 500 characters"
}
```

`reasonCode` is optional and defaults to `generic`. Allowed V1 values are
`generic`, `wrong_pickup`, `rider_changed_mind`, `driver_delay`,
`driver_requested`, `driver_emergency`, `driver_no_show`, `rider_no_show`, and
`other`. `notes` is optional and omitted/null when absent.

Behavior:

- Allowed while request is `searching`, `offered`, or `assigned`.
- Cancels any pending offer in the same transaction.
- If assignment already committed, terminally cancels the assigned request and
  accepted offer, releases the assigned driver to `online`, persists the
  cancellation reason/notes, and emits assignment/request/offer cancellation
  outbox events.
- Repeating cancellation of an already-cancelled request returns the cancelled snapshot.
- If another terminal state already committed, returns `409 Conflict` and the current
  snapshot can be obtained with `GET`.

### `GET /api/v1/ride-requests/history`

Returns bounded terminal ride history for the authenticated rider.

Query parameters:

- `limit` defaults to `20` and is capped at `50`;
- `offset` defaults to `0`.

Behavior:

- Results are ordered newest-first by terminal update time.
- Only terminal request states are returned: `completed`, `cancelled`, `expired`,
  `no_driver_found`, and `system_failed`.
- The response uses the same request snapshot shape as current rider request
  responses, including assignment and cancellation data when present.
- Active/current request endpoints remain separate and never mix with history.

## Driver Offer REST Contract

Offer routes are owned by `DispatchModule`.

### `GET /api/v1/dispatch-offers/current`

Returns the authenticated driver's current pending or accepted offer, or `null` when
none exists. The response includes pickup/dropoff plus the request fare and ride
snapshot needed by driver clients:

Accepted offers whose request is no longer active, including completed trip requests,
are excluded from the current-offer response.

```json
{
  "id": "019ee377-8d35-7854-a48d-d426f90e8581",
  "assignmentId": null,
  "requestId": "019ee376-4f73-7240-85d5-41f724f5f03a",
  "driverId": "019ee377-c45b-7963-a00f-7e3d2a089816",
  "state": "pending",
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "fareEstimateId": "019ee375-7bd7-70d8-9bb4-3dc3ed66c004",
  "vehicleType": "standard",
  "rideType": "instant",
  "currency": "ETB",
  "tripDistanceMeters": 1250,
  "tripDurationSeconds": 180,
  "rateMinorPerKm": 900,
  "estimatedFareMinor": 1100,
  "etaSeconds": 180,
  "distanceMeters": 1250,
  "expiresAt": "2026-06-21T12:00:15.000Z",
  "offeredAt": "2026-06-21T12:00:00.000Z",
  "respondedAt": null,
  "createdAt": "2026-06-21T12:00:00.000Z",
  "updatedAt": "2026-06-21T12:00:00.000Z"
}
```

### `GET /api/v1/dispatch-offers/:id`

Returns one authenticated-driver-owned offer by ID using the same rich offer shape as
`GET /dispatch-offers/current`.

Behavior:

- Only the owning driver may read the offer.
- Pending, accepted, rejected, expired, and cancelled offers can be read.
- Missing or not-owned offers return `404 Not Found`.

### `POST /api/v1/dispatch-offers/:id/accept`

Accepts the authenticated driver's pending offer.

Behavior:

- Only the owning driver may accept.
- Acceptance is valid only while the offer is pending, before expiry, and while request
  and driver state are still compatible.
- Offer acceptance, request assignment, driver assignment, and handoff outbox intent
  commit atomically.
- Duplicate accept by the same owning driver returns the accepted/assigned snapshot.
- If cancellation committed first, returns `409 Conflict`.
- If expiration/rejection committed first, returns `409 Conflict`.

### `POST /api/v1/dispatch-offers/:id/reject`

Rejects the authenticated driver's pending offer.

Behavior:

- Only the owning driver may reject.
- Rejection, driver release, request transition/rematch intent, and outbox events commit
  atomically.
- Duplicate reject by the same owning driver returns the rejected offer snapshot.
- If acceptance committed first, returns `409 Conflict`.
- If expiration/cancellation committed first, returns the current terminal offer snapshot
  only when it represents the same non-accepted outcome; otherwise returns
  `409 Conflict`.

## Driver Assignment REST Contract

Assignment routes are owned by `DispatchModule`.

### `GET /api/v1/dispatch-assignments/active`

Returns the authenticated driver's active assignment snapshot, or `null` when no active
assignment exists.

Behavior:

- Active means the assignment's offer is `accepted` and request is `assigned`.
- The response uses the durable assignment snapshot shape used by assignment realtime
  events, including nullable pickup-control and trip-control state.
- The REST response includes `assignmentId` as an alias for `id`, `status` as an
  alias for `state`, and `assignedAt`, `createdAt`, and `updatedAt` timestamps.
- Terminal or cancelled assignments are excluded; use history for terminal assigned
  rides.

### `POST /api/v1/dispatch-assignments/:id/arrive-at-pickup`

Marks the authenticated assigned driver as arrived at pickup.

Behavior:

- Only the owning assigned driver may mark arrival.
- The command is valid only while the offer is `accepted` and the request is
  `assigned`.
- Duplicate arrival returns the existing pickup-control snapshot.
- Arrival commits a `dispatch_assignment_pickup` row and durable outbox event in
  one transaction, then schedules a delayed pickup reminder job after commit.
- The pickup wait is temporarily hardcoded to 60 seconds until the product/config
  policy is approved.
- Future automatic radius-based arrival may replace this manual command without
  changing the pickup-control response shape.

### `POST /api/v1/dispatch-assignments/:id/cancel-rider-no-show`

Cancels an assigned ride when the authenticated assigned driver has arrived and
the rider no-show wait has elapsed.

Behavior:

- Only the owning assigned driver may cancel rider no-show.
- The command requires an existing pickup-arrival control row.
- Before the configured wait expires, returns `409 Conflict`.
- On success, pickup state becomes `rider_no_show_cancelled`, the request becomes
  `cancelled`, the accepted offer becomes `cancelled`, and the driver operational
  profile returns to `online`.
- No rematch is attempted after this terminal cancellation.
- Duplicate no-show cancellation returns the existing pickup-control snapshot.

### `POST /api/v1/dispatch-assignments/:id/start-trip`

Starts the trip for the authenticated assigned driver.

Behavior:

- Only the owning assigned driver may start the trip.
- The command is valid only while the request is `assigned`, the offer is `accepted`,
  and the driver operational profile is `assigned`.
- Duplicate start returns the existing trip-control snapshot.
- Starting the trip stores one `dispatch_assignment_trip` row and emits
  `dispatch_assignment.trip_started.v1`.
- A delayed pickup warning job becomes a no-op when a trip row already exists.

Successful response:

```json
{
  "id": "019ee378-3c40-78e1-a31b-31dfb3f6e137",
  "assignmentId": "019ee377-d6d1-7d1d-91a6-d82f6eeaf2dd",
  "requestId": "019ee376-4f73-7240-85d5-41f724f5f03a",
  "offerId": "019ee377-8d35-7854-a48d-d426f90e8581",
  "riderId": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
  "driverId": "019ee377-c45b-7963-a00f-7e3d2a089816",
  "state": "started",
  "startedAt": "2026-06-21T12:04:00.000Z",
  "completedAt": null,
  "createdAt": "2026-06-21T12:04:00.000Z",
  "updatedAt": "2026-06-21T12:04:00.000Z",
  "rider": {
    "id": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
    "fullName": "Ride Rider",
    "phone": "+251911000555",
    "rating": 5
  },
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "completion": null
}
```

### `POST /api/v1/dispatch-assignments/:id/complete-trip`

Completes a started trip for the authenticated assigned driver.

Behavior:

- Only the owning assigned driver may complete the trip.
- Completing before start returns `409 Conflict`.
- Duplicate completion returns the existing completed trip-control snapshot.
- Completion marks the trip `completed`, marks the request `completed`, returns the
  driver operational profile to `online`, leaves the accepted offer unchanged, and emits
  `dispatch_assignment.trip_completed.v1` in one transaction.
- Completed trips are excluded from active/current endpoints and included in history.
- The successful response includes the same rider, pickup, and destination details as
  start-trip plus a `completion` summary. Price, currency, and distance are sourced from
  the immutable request fare/route snapshot; elapsed time is measured from trip
  timestamps.

Successful response:

```json
{
  "id": "019ee378-3c40-78e1-a31b-31dfb3f6e137",
  "assignmentId": "019ee377-d6d1-7d1d-91a6-d82f6eeaf2dd",
  "requestId": "019ee376-4f73-7240-85d5-41f724f5f03a",
  "offerId": "019ee377-8d35-7854-a48d-d426f90e8581",
  "riderId": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
  "driverId": "019ee377-c45b-7963-a00f-7e3d2a089816",
  "state": "completed",
  "startedAt": "2026-06-21T12:04:00.000Z",
  "completedAt": "2026-06-21T12:18:30.000Z",
  "createdAt": "2026-06-21T12:04:00.000Z",
  "updatedAt": "2026-06-21T12:18:30.000Z",
  "rider": {
    "id": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
    "fullName": "Ride Rider",
    "phone": "+251911000555",
    "rating": 5
  },
  "pickup": {
    "latitude": 9.0192,
    "longitude": 38.7525
  },
  "destination": {
    "latitude": 9.0301,
    "longitude": 38.7612
  },
  "completion": {
    "totalPriceMinor": 3889,
    "currency": "ETB",
    "totalDistanceMeters": 4321,
    "totalTimeTakenSeconds": 870
  }
}
```

### `POST /api/v1/dispatch-assignments/:id/cancel`

Cancels an assigned ride for the authenticated assigned driver with optional
structured cancellation details.

Request body:

```json
{
  "reasonCode": "driver_emergency",
  "notes": "Optional driver-provided note, maximum 500 characters"
}
```

Behavior:

- Only the owning assigned driver may cancel the assignment.
- Allowed only while the request is `assigned`, the offer is `accepted`, and the
  driver operational profile is `assigned`.
- On success, persists one `dispatch_cancellation` row, marks the request and
  accepted offer `cancelled`, returns the driver to `online`, and emits
  assignment/request/offer cancellation outbox events.
- No rematch is attempted after this terminal post-assignment cancellation.
- Duplicate cancellation returns the existing cancellation record.

### `GET /api/v1/dispatch-assignments/history`

Returns bounded terminal ride history for the authenticated assigned driver.

Query parameters:

- `limit` defaults to `20` and is capped at `50`;
- `offset` defaults to `0`.

Behavior:

- Results are ordered newest-first by terminal update time.
- Only terminal request states are returned: `completed`, `cancelled`, `expired`,
  `no_driver_found`, and `system_failed`.
- Each item uses the same durable request snapshot shape already exposed to the
  rider, including assignment and cancellation details when present.
- Driver history is sourced from accepted assignment rows; active/current offer
  endpoints remain separate and are not mixed into history.

## Request and Offer Snapshots

Request snapshots include:

- `requestId`;
- internal request state;
- rider-visible state;
- pickup and destination;
- created/updated timestamps;
- matching deadline;
- assignment details only after assignment commits: driver full name, phone, rating,
  vehicle make/model/color, and plate fields;
- pickup-control state after arrival: `arrived`, `warning_sent`, or
  `rider_no_show_cancelled`, with the relevant timestamps;
- trip-control state after trip start: `started` or `completed`, with the relevant
  timestamps;
- nullable `cancellation` details when terminal: cancellation id, actor role,
  reason code, optional notes, linked offer/assignment ids, and created time.

Offer snapshots include:

- `offerId`;
- `requestId`;
- internal offer state;
- precise pickup and destination;
- route estimate when available;
- request fare/ride snapshot for current driver offers;
- offer expiry time and remaining response window;
- terminal reason when terminal.

Pre-assignment rider snapshots never include precise driver location or the offered
driver's identity.

## Request Terminal States

The approved request terminal states are:

- `cancelled`
- `completed`
- `expired`
- `no_driver_found`
- `system_failed`

History endpoints only return these states. Current rider and driver endpoints
continue to expose `searching`, `offered`, and `assigned` state separately.

| State             | Meaning                                                           | Rider-visible state       |
| ----------------- | ----------------------------------------------------------------- | ------------------------- |
| `assigned`        | Driver accepted and dispatch handoff intent committed             | `driver_assigned`         |
| `completed`       | Started trip was completed and driver released                    | `completed`               |
| `cancelled`       | Rider/system cancelled before assignment                          | `cancelled`               |
| `expired`         | Total matching deadline elapsed                                   | `no_driver_found`         |
| `no_driver_found` | Search policy exhausted eligible candidates before the deadline   | `no_driver_found`         |
| `system_failed`   | Provider/system failure prevented a trustworthy matching decision | `temporarily_unavailable` |

`system_failed` is not `no_driver_found`. It is used when dispatch cannot safely decide
that no eligible driver exists, for example routing contract failure, unavailable
required queue infrastructure, or an internal invariant failure. It is terminal for the
request; retry requires a new request and idempotency key.

## Idempotency and Duplicate Commands

### Request Creation

The idempotency identity is:

- authenticated rider ID;
- `Idempotency-Key`;
- canonical request payload hash.

Same rider + same key + same canonical payload returns the original request result.
Same rider + same key + different canonical payload returns `409 Conflict`.

### State Transition Commands

Accept, reject, cancel, expiration, and worker-driven transitions are idempotent by
state predicates and transition identity.

- Duplicate command after the same transition returns the committed result when the same
  actor and same action are repeated.
- Competing terminal commands return `409 Conflict` unless the command is explicitly a
  safe replay of the already-committed transition.
- Worker jobs use deterministic job identity and durable state predicates so duplicate
  delivery cannot create duplicate offers, assignments, notifications, or realtime
  events.

## Socket.IO Contract

### Namespace and Authentication

The dispatch namespace is:

```text
/dispatch
```

Clients authenticate during the Socket.IO handshake with a mobile access token:

```json
{
  "auth": {
    "token": "Bearer <accessToken>"
  }
}
```

The server validates the token and active mobile session using the same authority as
REST. `auth.token` must include the `Bearer ` prefix; raw token strings are rejected.
An equivalent `Authorization: Bearer <accessToken>` header may be accepted as a
compatibility fallback, but query-string tokens are prohibited.

### Server-Managed Rooms

Rooms are server-managed only:

- authenticated user room;
- current rider request room;
- current driver offer room;
- current presence-session/lease room where needed.

Clients cannot request arbitrary room names or subscribe to another user's request,
offer, or presence stream.

### Client Event: `dispatch:snapshot:request`

Reconnect/bootstrap snapshot request.

Payload:

```json
{
  "requestId": "optional_request_id"
}
```

The authenticated socket may omit `requestId` to request its current dispatch snapshot.
If `requestId` is present, the snapshot is limited to the authenticated rider's own
request; unauthorized request IDs do not return another user's state.
Without `requestId`, the snapshot is the canonical reconnect recovery path: riders
recover their current request/assignment state, while drivers recover their current
pending or accepted offer state even if they missed prior realtime events.

Acknowledgement payload:

```json
{
  "event": "dispatch:request:snapshot",
  "data": {
    "schemaVersion": "v1",
    "eventId": "evt_opaque",
    "occurredAt": "2026-06-18T00:00:00.000Z",
    "userId": "user_opaque",
    "snapshot": {
      "version": "v1",
      "userId": "user_opaque",
      "activeRequest": null,
      "activeOffer": null,
      "activeAssignment": null,
      "generatedAt": "2026-06-18T00:00:00.000Z"
    }
  }
}
```

When `activeAssignment` is present, it has the same durable assignment snapshot shape
used by rider REST responses:

```json
{
  "activeAssignment": {
    "id": "019ee377-d6d1-7d1d-91a6-d82f6eeaf2dd",
    "offerId": "019ee377-8d35-7854-a48d-d426f90e8581",
    "requestId": "019ee376-4f73-7240-85d5-41f724f5f03a",
    "riderId": "019ee374-df03-7b9b-a81a-b1c2db54a6b2",
    "driverId": "019ee377-c45b-7963-a00f-7e3d2a089816",
    "state": "assigned",
    "assignedAt": "2026-06-21T12:01:00.000Z",
    "driver": {
      "id": "019ee377-c45b-7963-a00f-7e3d2a089816",
      "fullName": "Aster Bekele",
      "phone": "+251911111111",
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

If snapshot generation fails, the acknowledgement returns an explicit error:

```json
{
  "error": "snapshot_failed"
}
```

Repeated snapshot requests are allowed and must be harmless. Clients treat the returned
snapshot as canonical state and may replace stale local realtime state with it.

### Client Event: `presence:location:update`

Driver-to-server location ingestion event.

Payload:

```json
{
  "presenceSessionId": "ps_opaque",
  "leaseId": "lease_opaque",
  "sequence": 1,
  "latitude": 9.0192,
  "longitude": 38.7525,
  "accuracyMeters": 12,
  "capturedAt": "2026-06-14T09:00:06.000Z"
}
```

Acknowledgement statuses:

| Status                   | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `accepted`               | Stored in Redis fast path                                     |
| `ignored_duplicate`      | Sequence was already accepted                                 |
| `ignored_stale_sequence` | Sequence is lower than current lease sequence                 |
| `ignored_rate_limited`   | Update exceeded accepted frequency                            |
| `rejected_invalid`       | Payload failed validation                                     |
| `rejected_unauthorized`  | Socket auth/session is invalid                                |
| `rejected_not_owner`     | Session does not own this presence authority                  |
| `rejected_expired_lease` | Lease is missing, expired, or not current                     |
| `rejected_stale_capture` | Capture time is too old or too far in the future              |
| `unavailable_redis`      | Redis cannot accept updates; driver is not dispatch-available |

An `accepted` acknowledgement confirms only ephemeral fast-path acceptance. It does not
prove durable ownership, dispatch availability, matching inclusion, or rider visibility.

### Server Events

All server events include:

- `schemaVersion`;
- `eventId`;
- `occurredAt`;
- aggregate IDs needed by the recipient;
- a current snapshot or enough information for the client to fetch a snapshot.

Initial event names:

| Event name                                    | Recipient     | Purpose                                            |
| --------------------------------------------- | ------------- | -------------------------------------------------- |
| `presence:state:changed`                      | driver        | Online/offline/resume-required state changed       |
| `presence:lease:revoked`                      | driver        | Current lease invalidated by offline/takeover/loss |
| `dispatch:request:snapshot`                   | rider         | Request state changed                              |
| `dispatch:offer:snapshot`                     | driver        | Offer created or resolved                          |
| `dispatch:assignment:created`                 | rider, driver | Driver accepted and assignment handoff committed   |
| `dispatch:assignment:cancelled`               | rider, driver | Post-assignment cancellation committed             |
| `dispatch:assignment:pickup_arrived`          | rider, driver | Driver marked arrival at pickup                    |
| `dispatch:assignment:trip_start_warning`      | rider, driver | Trip still not started after pickup wait           |
| `dispatch:assignment:trip_started`            | rider, driver | Driver started the trip                            |
| `dispatch:assignment:trip_completed`          | rider, driver | Driver completed the trip                          |
| `dispatch:assignment:rider_no_show_cancelled` | rider, driver | Rider no-show cancellation committed               |

Socket events may be duplicated or missed during reconnect. Clients must use REST
snapshot endpoints for recovery and must tolerate duplicate `eventId` values.

`D7.3` binds these Socket.IO deliveries to committed durable outbox publication.
Realtime emission occurs only after the corresponding outbox event has been marked
published from committed database state; rolled-back transitions emit nothing.
`dispatch:assignment:created` includes the durable assignment snapshot details in its
`snapshot` field for both rider and driver recipients.
The pickup and trip lifecycle events use the same assignment snapshot envelope and
include the latest nullable `pickup` and `trip` control objects in
`snapshot.pickup` and `snapshot.trip`.

## Outbox and Domain Event Contract

Durable outbox events are versioned with `.v1` suffixes. Provider-specific response
shapes, precise pre-assignment coordinates, access tokens, and secrets are prohibited in
outbox payloads.

### Event Envelope

Every outbox event includes:

- `eventId`;
- `eventType`;
- `schemaVersion`;
- `aggregateType`;
- `aggregateId`;
- `occurredAt`;
- `correlationId`;
- optional `causationId`;
- optional `actorUserId`;
- payload.

### Initial Event Types

| Event type                                       | Produced when                                           |
| ------------------------------------------------ | ------------------------------------------------------- |
| `driver_presence.online.v1`                      | Driver durable online intent commits                    |
| `driver_presence.offline.v1`                     | Driver durable offline transition commits               |
| `driver_presence.takeover.v1`                    | Presence authority takeover commits                     |
| `ride_request.created.v1`                        | Rider request creation commits                          |
| `ride_request.cancelled.v1`                      | Request cancellation commits                            |
| `ride_request.expired.v1`                        | Total matching deadline commits as terminal             |
| `ride_request.no_driver_found.v1`                | Search policy exhaustion commits as terminal            |
| `ride_request.system_failed.v1`                  | Safe matching cannot continue because of system failure |
| `dispatch_offer.created.v1`                      | Driver reservation and pending offer commit             |
| `dispatch_offer.accepted.v1`                     | Offer acceptance commits                                |
| `dispatch_offer.rejected.v1`                     | Offer rejection commits                                 |
| `dispatch_offer.expired.v1`                      | Offer expiration commits                                |
| `dispatch_offer.cancelled.v1`                    | Offer cancellation commits                              |
| `dispatch_assignment.created.v1`                 | Request/driver assignment and handoff intent commit     |
| `dispatch_assignment.cancelled.v1`               | Post-assignment cancellation commits                    |
| `dispatch_assignment.pickup_arrived.v1`          | Driver arrival at pickup commits                        |
| `dispatch_assignment.trip_start_warning.v1`      | Pickup wait elapsed and rider warning commits           |
| `dispatch_assignment.trip_started.v1`            | Trip start commits                                      |
| `dispatch_assignment.trip_completed.v1`          | Trip completion commits                                 |
| `dispatch_assignment.rider_no_show_cancelled.v1` | Driver no-show cancellation commits                     |

`ride_request.created.v1` includes the committed request state, route coordinates,
idempotency key, matching timers, and the immutable fare snapshot fields from request
creation: `fareEstimateId`, `vehicleType`, `rideType`, `currency`, `distanceMeters`,
`durationSeconds`, `rateMinorPerKm`, and `estimatedFareMinor`.

`dispatch_assignment.created.v1` carries assignment IDs and timing in the durable
outbox payload. The realtime publisher expands those IDs from `dispatch_assignment` so
Socket.IO assignment-created events contain driver and vehicle detail snapshots without
embedding mutable profile data directly in the outbox payload.
`dispatch_assignment.cancelled.v1`, `dispatch_assignment.pickup_arrived.v1`,
`dispatch_assignment.trip_start_warning.v1`, and
`dispatch_assignment.rider_no_show_cancelled.v1`,
`dispatch_assignment.trip_started.v1`, and
`dispatch_assignment.trip_completed.v1` carry assignment IDs and timing. The realtime
publisher expands them to the latest durable assignment snapshot, including pickup and
trip-control state when present.

### Job Identity Requirements

Queue jobs are introduced later, but D0.6 fixes their correctness rules:

- match jobs are deterministic per request/attempt;
- offer-expiration jobs are deterministic per offer and expiry time;
- outbox-publish jobs are deterministic per outbox event;
- reconciliation jobs are idempotent and safe to run concurrently;
- job handlers re-check durable state before side effects.

## Compatibility Rules

Later tasks may add optional response fields, optional event fields, and new event types.
They may not silently rename states, routes, required fields, or event names approved in
D0.6 without a new decision.

D7.1 may refine Socket.IO transport mechanics, but it must preserve the state meanings,
authorization rules, ack outcomes, and reconnect/snapshot requirements in this document.
