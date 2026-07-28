# Phase 10 - Client API Completion

## Goal

Close the remaining rider/driver API gaps discovered during endpoint review without
expanding Instant Ride into Shared Ride, payments, or full trip execution unless a task
is explicitly approved.

## Tasks

### `D10.1` Authenticated Fare Estimate Endpoint

- [x] Add a rider-authenticated fare estimate resource.
- [x] Use the existing routing provider boundary for distance/duration.
- [x] Persist estimate inputs, route metrics, temporary fare policy, and expiry.
- [x] Keep vehicle type limited to `standard` until product pricing is approved.
- [x] Document the temporary hardcoded fare policy and follow-up pricing decision.

### `D10.2` Request Fare and Vehicle Binding

- [x] Define whether request creation accepts a `fareEstimateId`, inline fare snapshot, or
      both.
- [x] Preserve Instant Ride as the only request type; Shared Ride remains out of scope.
- [x] Persist the chosen vehicle type and estimate snapshot needed by rider/driver clients.
- [x] Test expiry, ownership, stale quote, and idempotency interactions.

### `D10.3` Assignment Detail Snapshots

- [x] Define the accepted-assignment response fields for riders: vehicle make, model, plate,
      color, driver full name, rating, and phone.
- [x] Define the accepted-assignment response fields for drivers: pickup, dropoff, fare
      estimate, and ride type.
- [x] Ensure snapshots are only visible after authorized assignment.

### `D10.4` Pickup Arrival, Trip-Start Warning, and No-Show Controls

- [x] Add a driver arrival command for pickup.
- [x] Add the rider warning contract when arrival has occurred but the trip has not started.
- [x] Add the driver no-show cancellation control after the approved wait threshold.
- [x] Keep future automatic radius-based arrival as a later replacement for the manual
      command.

### `D10.5` Structured Cancellation Request/Reason APIs

- [x] Define generic cancellation requests that notify the other party.
- [x] Define specific cancellation reasons plus optional notes.
- [x] Define allowed states, actor authority, notification behavior, and conflict handling.

### `D10.6` Bounded Ride History APIs

- [x] Add rider and driver history endpoints with explicit pagination/limit rules.
- [x] Keep active/current ride endpoints separate from historical results.
- [x] Define retention and redaction rules before exposing post-trip data.

### `D10.7` Active Assignment and Offer Detail Reads

- [x] Add driver `GET /dispatch-assignments/active` recovery endpoint.
- [x] Add driver-owned `GET /dispatch-offers/:offerId` detail endpoint.
- [x] Keep active assignment separate from history and keep not-owned offer reads private.

### `D10.8` Minimal Trip Start and Completion Controls

- [x] Add driver `POST /dispatch-assignments/:id/start-trip` command.
- [x] Add driver `POST /dispatch-assignments/:id/complete-trip` command.
- [x] Store mutable trip state beside pickup control instead of mutating the immutable
      assignment snapshot.
- [x] Mark completed trips history-only and release the driver to `online`.
- [x] Publish assignment trip-start and trip-completed realtime events from durable outbox.

## Exit Gate

The reviewed client-facing endpoint list has either implemented APIs, documented
non-goals, or approved follow-up tasks with acceptance criteria.
