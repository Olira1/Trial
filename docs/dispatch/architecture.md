# Instant Ride Dispatch Target Architecture

This is the target direction, not an authorization to create all components at once. Each component is introduced only through an approved roadmap task.

The approved AWS/Docker runtime and managed-service topology is defined in
[deployment-topology.md](deployment-topology.md).

The approved initial REST, Socket.IO, outbox, idempotency, and error contracts are
defined in [api-event-contracts.md](api-event-contracts.md).

## Module Boundaries

### Existing `DriverModule`

Owns:

- Driver application and manual approval
- Vehicle registration and approval
- Driver documents

Does not own:

- Online/offline presence
- Live location
- Dispatch availability
- Ride offers
- Active ride assignment

### New `DriverPresenceModule`

Owns:

- Driver operational online/offline intent
- Latest accepted location update
- Location freshness and ordering
- H3 cell computation
- Redis live-presence representation
- Durable sampled location/history policy
- Querying current dispatch presence
- REST presence commands and current presence snapshot

It consumes driver/vehicle approval facts but does not change approval data.

The durable qualification contract it consumes is defined in [driver-eligibility.md](driver-eligibility.md).
The online-intent and live-presence contract it implements is defined in
[live-location-presence.md](live-location-presence.md).

### New `RideRequestsModule`

Owns:

- Rider Instant Ride request creation
- Request cancellation
- Request lifecycle and terminal outcome
- Rider ownership/authorization
- Request pickup/dropoff and search policy snapshot
- Handoff to the assigned-ride/trip domain
- REST request commands and rider request snapshots

It does not choose drivers or manage offers.

### New `DispatchModule`

Owns:

- Match job orchestration
- Candidate eligibility query
- Candidate discovery and ranking
- Driver reservation
- Dispatch offers
- Acceptance/rejection/expiration
- Rematching policy
- Dispatch reconciliation
- Driver offer commands and current offer snapshots

It consumes driver presence, durable eligibility, ride requests, routing, notification, and event-delivery interfaces.

### New `RoutingModule`

Owns:

- An application-owned routing interface
- Gebeta Maps adapter
- Test/fake adapter
- Timeouts, validation, error classification, and metrics

It does not decide matching policy.

### New `RealtimeModule`

Owns:

- Socket.IO gateway
- Authenticated connection/user mapping
- Event delivery adapter
- Reconnect/snapshot contract
- `/dispatch` Socket.IO namespace and server-managed dispatch rooms

It does not own durable state.

### Worker/Queue Infrastructure

Owns:

- Durable matching jobs
- Delayed offer-expiration jobs
- Outbox publication
- Retries/backoff/dead-letter behavior
- Reconciliation schedules

Business transitions remain in domain services; workers call those services.

## Data Ownership

### PostgreSQL/PostGIS: Durable Truth

Expected durable concepts:

- Driver operational state/profile projection, including presence owner/session/generation authority
- Instant Ride request
- Dispatch attempt
- Dispatch offer
- Assignment/accepted ride handoff
- Transactional outbox
- Idempotency records where required

PostgreSQL owns all business-state decisions. Redis data must be rebuildable or safely treated as absent.

### Redis: Ephemeral Acceleration

Expected ephemeral concepts:

- Active presence lease ID derived from durable owner/session/generation authority
- Presence generation fence/invalidation marker
- Latest location snapshot and lease-scoped timestamp/sequence
- Fresh online driver membership
- H3/geospatial candidate indexes
- Socket connection mapping/presence
- Queue backend

Redis loss may reduce availability but must not create conflicting assignments or corrupt durable state.

### H3 and PostGIS Responsibilities

- H3: fast coarse candidate partitioning and expanding-ring lookup.
- PostGIS: durable spatial types, exact distance checks, spatial analysis, and fallback/reconciliation queries.
- Routing provider: road-network travel time/distance ranking.

H3 ring limits must be derived from or validated against the configured search policy. A fixed ring count must never silently contradict the search radius.

## Primary Flow

1. Rider creates an Instant Ride request.
2. One database transaction:
   - Validates rider/request constraints.
   - Creates the request.
   - Creates a dispatch-start outbox event.
3. Outbox publisher enqueues a match job.
4. Match worker:
   - Loads current request state.
   - Discovers eligible live candidates from Redis/H3.
   - Applies durable eligibility and exact-distance filters.
   - Requests route estimates from the routing provider outside a database transaction.
   - Ranks candidates.
5. Short database transaction:
   - Locks/revalidates the request.
   - Revalidates selected driver eligibility and availability.
   - Atomically reserves the driver.
   - Creates one pending offer.
   - Moves request state.
   - Writes notification, realtime, and expiry outbox events.
6. Side-effect workers deliver the offer and schedule expiration.
7. Driver accepts, rejects, or times out.
8. A short transaction performs the corresponding state transition and writes follow-up outbox events.

## Critical Transaction Rules

- Never hold database locks while calling Gebeta Maps, Redis, Socket.IO, or FCM.
- Request state and offer creation must change atomically.
- Offer acceptance, request assignment, and driver assignment must change atomically.
- Rejection/expiration, driver release, request transition, and rematch intent must change atomically.
- Every transition must use predicates or locks that reject stale state.
- Every method participating in a transaction accepts and uses `DBExecutor`/`DBTransaction`.

## Database Invariants to Design

- At most one active/pending offer per request for sequential dispatch.
- At most one active/pending offer or active assignment per driver.
- At most one accepted assignment per request.
- At most one active Instant Ride request per rider, if product-approved.
- Offer acceptance is valid only before expiry and while request/driver remain compatible.
- Request and driver terminal states cannot return to active states except through an explicit new aggregate/action.
- Outbox event identity is unique and publish processing is idempotent.

## Provider Interfaces

Interfaces must be application-owned and minimal:

- `RoutingProvider`: batch travel estimates from candidate origins to pickup.
- `DispatchNotificationPort`: background push notification.
- `DispatchRealtimePort`: live rider/driver events.
- `DriverPresenceStore`: write/read live location and candidate IDs.
- `DispatchQueuePort`: enqueue match and delayed-expiry jobs.

Provider-specific response shapes must not leak into domain schemas or controllers.

The approved V1 Gebeta integration contract is defined in
[gebeta-maps-capability.md](gebeta-maps-capability.md). V1 candidate ranking uses Matrix
only, with at most nine candidate origins plus the pickup per provider request. The
adapter validates the complete all-pairs response before extracting candidate-to-pickup
estimates.

## Failure Strategy

- Routing provider unavailable or contract-invalid: report an explicit internal/system routing failure; never silently remove candidates, return `no_driver_found`, or pretend synthetic/straight-line quality equals a routed estimate.
- Required queue/infrastructure unavailable before safe matching can continue: commit a
  `system_failed` terminal outcome rather than pretending no driver exists.
- Redis unavailable: V1 fails closed for location ingestion and new matching; no PostGIS presence fallback is approved.
- Queue unavailable: outbox remains durable and retries later.
- Socket/FCM failure: durable offer remains valid; delivery retries/reconciliation expose the issue.
- Worker crash: jobs retry idempotently; reconciliation detects stuck state.
- Duplicate commands/jobs: state predicates and idempotency prevent duplicate transitions.
