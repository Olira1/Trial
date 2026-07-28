# Phase 3 - Instant Ride Requests

## Goal

Create an authorized, durable rider request lifecycle without implementing driver matching yet.

## Tasks

### `D3.1` Request Schema and Invariants

- [x] Add approved request states and spatial fields.
- [x] Add request deadline/search policy snapshot.
- [x] Add constraints/indexes for active requests and queries.
- [x] Test migration and invariants.

### `D3.2` Authenticated Request Creation

- [x] Strict DTO and response serialization.
- [x] Derive rider identity from session, never request body.
- [x] Validate pickup/dropoff/service area according to approved behavior.
- [x] Transactionally create request and outbox intent.

### `D3.3` Idempotency and Active-Request Protection

- [x] Define client idempotency key contract.
- [x] Prevent duplicate active requests.
- [x] Test concurrent duplicate creation.

### `D3.4` Rider Cancellation

- [x] Enforce ownership.
- [x] Make cancellation idempotent.
- [x] Resolve only states approved in D0.1.
- [x] Publish durable cancellation intent.

### `D3.5` Durable Dispatch Intent

- [x] Confirm dispatch-start/cancel outbox records commit with request transition.
- [x] Test publisher delay/failure does not lose intent.

### `D3.6` Request Snapshot/Query Contract

- [x] Return rider-safe state and timestamps.
- [x] Do not leak driver/candidate internals.
- [x] Define polling/reconnect compatibility for later Socket.IO work.

## Exit Gate

Request create/query/cancel is authorized, idempotent, transaction-safe, and emits durable dispatch intent.
