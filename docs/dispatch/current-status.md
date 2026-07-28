# Current Dispatch Project Status

**Last updated:** 2026-06-29

**Project state:** Phase 9 in progress; client/API completion corrective track started

**Active phase:** Phase 9 - Controlled Rollout (in progress)

**Active corrective track:** Phase 10 - Client API Completion (in progress)

**Runtime implementation approved:** `D10.8` response follow-up verified

## Completed

- [x] Deep review of the `UbelMatching` experiment
- [x] Decision to build production dispatch from scratch in `UbelBackend`
- [x] Initial scope limited to Instant Ride/ride-hailing
- [x] Sequential offer strategy selected for V1
- [x] Redis live presence plus PostgreSQL/PostGIS durable data selected
- [x] H3 plus PostGIS selected
- [x] Gebeta Maps identified as intended routing provider behind an interface
- [x] Socket.IO selected for live delivery
- [x] Docker on AWS selected as deployment direction
- [x] Strict clarification, TDD, review, and commit protocol established
- [x] Backend implementation handbook and product ADR created
- [x] `D0.1` Instant Ride V1 product behavior approved and documented
- [x] `D0.2` durable driver eligibility and existing-domain mapping approved
- [x] `D0.3` Gebeta engineering contract and failure policy approved; production-provider gate remains open
- [x] `D0.4` live location and presence policy approved
- [x] `D0.5` AWS/Docker deployment topology approved
- [x] `D0.6` state machines, module boundaries, and initial API/event contracts approved
- [x] `D1.1` PostGIS-capable local/test infrastructure implemented and verified
- [x] `D1.2` spatial schema conventions and PostGIS smoke tests implemented and verified
- [x] `D1.3` dispatch integration-test harness implemented and verified
- [x] `D1.4` typed dispatch configuration implemented and verified
- [x] `D1.5` queue and worker foundation implemented and verified
- [x] `D1.6` transactional outbox foundation implemented and verified
- [x] `D1.7` account activity and driver-capability authorization implemented and verified
- [x] `D1.8` audited driver qualification approval and suspension implemented and verified
- [x] `D1.9` document qualification model implemented and verified
- [x] `D1.10` active vehicle and vehicle qualification invariants implemented and verified
- [x] `D1.11` mobile session device binding implemented and verified
- [x] `D1.12` Redis readiness and failure signaling implemented and verified
- [x] Persistent task completion checklist established in `task-completion-checklist.md`
- [x] `D2.1` durable driver operational profile/state implemented and verified
- [x] `D2.2` authoritative Instant Ride eligibility projection/query implemented and verified
- [x] `D2.3` online/offline/resume transitions implemented and verified
- [x] `D2.4` ordered live-location ingestion implemented and verified
- [x] `D2.5` Redis presence/H3 indexing implemented and verified
- [x] `D3.1` ride-request schema and creation endpoint implemented and verified
- [x] `D3.2` dispatch-outbox request-created event implemented and verified
- [x] `D3.3` idempotency key comparison and transaction wrapping implemented and verified
- [x] `D3.4` rider cancellation endpoint implemented and verified
- [x] `D3.5` durable dispatch intent verification implemented and verified
- [x] `D3.6` rider-scoped ride request query endpoint implemented and verified
- [x] `D4.1` candidate policy (ring/radius/tiebreaker/exclusion) implemented and verified
- [x] `D4.2` coarse Redis/H3 expanding-ring discovery implemented and verified
- [x] `D4.3` candidate revalidation with batch eligibility and PostGIS distance filter implemented and verified
- [x] `D4.4` routing provider interface and fake implemented and verified
- [x] `D4.5` Gebeta Maps routing adapter implemented and verified
- [x] `D4.6` route-based candidate ranking implemented and verified
- [x] `D4.7` discovery/routing metrics, bounded concurrency, rate limit, and failure policy implemented and verified
- [x] `D5.1` dispatch attempt and offer schemas/invariants implemented and verified
- [x] `D5.2` request-safe match orchestration implemented and verified
- [x] `D5.3` atomic reservation and offer creation implemented and verified
- [x] `D5.4` offer acceptance implemented and verified
- [x] `D5.5` offer rejection implemented and verified
- [x] `D5.6` offer expiration implemented and verified
- [x] `D5.7` cancellation interaction implemented and verified
- [x] `D5.8` mandatory concurrency suite implemented and verified
- [x] `D6.1` outbox-to-queue publication implemented and verified
- [x] `D6.2` match worker retries/backoff implemented and verified
- [x] `D6.3` delayed offer expiration jobs implemented and verified
- [x] `D6.4` dispatch FCM notifications implemented and verified
- [x] `D6.5` rematch/exhaustion policy implemented and verified
- [x] `D6.6` reconciliation worker implemented and verified
- [x] `D6.7` failed-job/dead-letter operations implemented and verified
- [x] `D7.1` Socket.IO authentication and event contracts implemented and verified
- [x] `D7.2` authenticated gateway/room behavior implemented and verified
- [x] `D7.3` durable outbox-driven realtime publication implemented and verified
- [x] `D7.4` reconnect snapshot recovery implemented and verified
- [x] `D7.5` multi-instance Socket.IO delivery implemented and verified
- [x] `D10.1` authenticated fare estimate endpoint implemented and verified
- [x] `D10.2` request fare and vehicle binding implemented and verified
- [x] `D10.3` assignment detail snapshots implemented and verified
- [x] `D10.4` pickup arrival, trip-start warning, and no-show controls implemented and verified
- [x] `D10.5` structured cancellation request/reason APIs implemented and verified
- [x] `D10.6` bounded ride history APIs implemented and verified
- [x] `D10.7` active assignment and offer detail reads implemented and verified
- [x] `D10.8` minimal trip start and completion controls implemented and verified
- [x] `D7.3 corrective` automatic dispatch outbox relay implemented and verified

## Active Playbook

[Phase 10 - Client API Completion](phases/10-client-api-completion.md)

## Latest Completed Task

`D10.8 - Minimal Trip Start and Completion Controls`

Phase 10 now closes the missing driver trip start/completion API gap requested by
client integration while keeping payments, ratings, and full trip execution out of
scope.

`D10.8` delivered:

- `POST /api/v1/dispatch-assignments/:id/start-trip` starts an assigned trip for the
  owning assigned driver and emits `dispatch_assignment.trip_started.v1`.
- `POST /api/v1/dispatch-assignments/:id/complete-trip` completes a started trip,
  marks the request `completed`, releases the driver to `online`, leaves the accepted
  offer unchanged, and emits `dispatch_assignment.trip_completed.v1`.
- Assignment snapshots now include nullable `trip` state alongside nullable `pickup`
  state for REST history/active reads and Socket.IO assignment events.
- Active/current assignment and offer reads hide completed trips; rider and driver
  history includes completed requests.
- Delayed pickup warnings no-op when the trip has already started.

`D10.8` response follow-up delivered:

- Trip start responses now include rider phone, rider full name, temporary rider rating,
  pickup coordinates, and destination coordinates.
- Trip completion responses include the same rider/location details plus a completion
  summary with request-snapshot price, currency, request-snapshot distance, and elapsed
  trip time.
- No schema migration, request body, payment settlement, GPS-measured trip distance, or
  ratings aggregate was added.

Verification:

- RED service/controller/DTO tests were added before implementation.
- `pnpm db:migrate` - passed.
- Focused D10.8 suites: 76 passed across 9 suites.
- Response follow-up RED service/DTO tests were added before implementation.
- Response follow-up focused suites: 11 passed across 3 suites.
- `pnpm exec tsc --noEmit --pretty false` - passed.
- Focused lint for touched dispatch/realtime/ride-request TypeScript files - passed.
- Response follow-up focused lint for touched trip TypeScript files - passed.
- `npm run build` - passed.
- `git diff --check` - passed.

Transaction review:

- Trip start and completion both run in database transactions and append durable outbox
  events in the same transaction as state changes.
- Trip response enrichment reads rider identity, request route coordinates, and
  request-snapshot totals inside the existing trip transaction.
- Trip completion updates trip, request, and driver operational state in one
  transaction; the accepted offer is intentionally left unchanged per `DD-105`.
- Completion totals intentionally reuse the persisted request snapshot per `DD-106`; no
  new trip-tracking or payment writes were added.
- Read paths that join assignment/pickup/trip state remain transactional where the
  service already used transaction-capable reads.

## Previous Completed Task

`D10.7 - Active Assignment and Offer Detail Reads`

Phase 10 closed the driver recovery gap for active assignments and offer detail
lookups requested by client integration.

`D10.7` delivered:

- `GET /api/v1/dispatch-assignments/active` returns the authenticated driver's active
  assignment snapshot, including `assignmentId`, `status`, assignment timestamps,
  nullable pickup-control state, or `null`.
- `GET /api/v1/dispatch-offers/:offerId` returns an authenticated-driver-owned offer
  by ID across pending, accepted, and terminal offer states.
- Missing or not-owned offer detail reads return `404 Not Found`.
- Active assignment reads require request state `assigned` and offer state `accepted`,
  so terminal assignments remain history-only.
- No schema migration, dependency, queue, outbox, realtime, fare, Shared Ride, or trip
  lifecycle behavior was added.

Verification:

- RED service/controller/DTO tests were added before implementation.
- Focused dispatch offer/assignment suites: 21 passed across 4 suites.
- `pnpm exec tsc --noEmit --pretty false` - passed.
- Focused lint for touched dispatch TypeScript files - passed.
- `npm run build` - passed.
- `git diff --check` - passed.

Transaction review:

- Offer-by-ID and active-assignment reads use explicit database transactions around
  their joined authorization/snapshot reads.
- Existing `GET /dispatch-offers/current` remains a single atomic joined read and was
  not changed.

## Earlier Completed Task

`D7.3 corrective - Automatic Dispatch Outbox Relay`

Production debugging on 2026-06-26 showed dispatch outbox rows accumulating with
`published_at=NULL` and `publish_attempts=0`, while offer rows were still visible
through REST. The dispatch reconciliation worker was running but no reconciliation
jobs were being enqueued, so outbox publication was not happening.

The corrective task delivered:

- `DispatchOutboxRelayService` drains up to 100 unpublished outbox events on
  startup and every second.
- Relay runs are non-overlapping and log published and remaining counts.
- `DispatchOutboxWorkerService` consumes deterministic outbox jobs so queue
  entries do not remain waiting indefinitely.
- `DispatchOutboxPublisherService` exposes an idempotent queued-event publish
  path and unpublished-event count for relay diagnostics.
- The outbox-to-realtime module import cycle is resolved with direct imports and
  `forwardRef` where the existing provider graph is circular.

Verification:

- Focused outbox/realtime suites: 32 passed across 4 suites.
- `pnpm exec tsc --noEmit --pretty false` - passed.
- Focused lint for touched outbox/realtime files - passed.
- `npm run build` - passed.
- `git diff --check` - passed.

Transaction review:

- Publication claims still use the existing `markPublished` transaction with an
  `IS NULL` predicate.
- The relay's batch selection and remaining-count reads are single-statement
  reads with no consistency dependency beyond the existing idempotent claim.

## Earlier Completed Task

`D10.6 - Bounded Ride History APIs`

Phase 10 now closes the remaining bounded-history gap after the cancellation work
in `D10.5`.

`D10.6` delivered:

- `GET /api/v1/ride-requests/history` returns bounded terminal rider history with
  `limit`/`offset` pagination.
- `GET /api/v1/dispatch-assignments/history` returns bounded terminal driver
  history from accepted assignments using the same durable request snapshot shape.
- Both endpoints default `limit` to `20`, cap it at `50`, and keep active/current
  endpoints separate from history.
- History is terminal-state only: `cancelled`, `expired`, `no_driver_found`, and
  `system_failed`.
- The rider history endpoint reuses the existing rider request snapshot shape; the
  driver history endpoint is sourced from `dispatch_assignment` rows.

Verification:

- Focused controller/DTO tests: 14 passed across 6 suites.
- Focused service history tests: 36 passed across 2 suites.
- `pnpm exec tsc --noEmit --pretty false` - passed.
- `pnpm exec eslint <touched D10.6 TypeScript files>` - passed.
- `npm run build` - passed.
- `git diff --check` - passed.
- No new npm/pnpm dependencies added.

Transaction review:

- Rider history executes its count and page reads inside one transaction.
- Driver history uses the same bounded pattern with an explicit joined terminal
  request projection inside one transaction.
- No schema migration or write-path side effect was added for history reads.

## Previous Corrective Follow-up

`D3.6/D5.4/D5.5 REST Contract Completion`

An explicitly approved corrective slice completed the missing client-facing
REST surface for already-implemented request and offer behavior:

- `GET /api/v1/ride-requests/current` returns the authenticated rider's
  current `searching`, `offered`, or `assigned` request, or `null`.
- `GET /api/v1/dispatch-offers/current` returns the authenticated driver's
  current `pending` or `accepted` offer with pickup, destination, ETA,
  distance, and expiry data, or `null`.
- `POST /api/v1/dispatch-offers/:id/accept` and
  `POST /api/v1/dispatch-offers/:id/reject` expose the existing authorized,
  idempotent, transaction-safe state transitions.
- The API contract now matches the mounted route names and request-body
  idempotency-key convention.
- No schema, migration, dependency, fare, Shared Ride, or trip-lifecycle
  behavior was added.

Verification:

- Focused endpoint, response-contract, query, and regression tests: 46 passed
  across 8 suites.
- `pnpm exec tsc --noEmit --pretty false` - passed.
- `npm run build` - passed.
- `npm run lint` - passed.
- Full `pnpm test --runInBand` result: 92 suites and 643 tests passed; 5
  suites and 31 tests failed in pre-existing isolated gateway/outbox/metrics
  test-harness setup, and Jest retained open handles after reporting results.
  The process was interrupted after the final summary.

Transaction review:

- Accept/reject commands continue to use their existing database transactions.
- Current request/offer reads intentionally use one atomic SQL statement each,
  so no read transaction is required.

## Next Task Candidate

`D9.5 - Evaluate metrics, incidents, and rollback readiness`

This rollout task is the next incomplete roadmap item. It is not ready for new
implementation approval until the rollout evidence review is refreshed.

## Blockers Before Phase 2 Runtime Implementation

- [x] Phase 0 architecture/product blockers resolved.
- [x] Phase 1 foundation exit gate resolved.
- [x] Phase 4 exit gate resolved.
- [x] Phase 5 exit gate resolved.

Later runtime work still requires task-level approval and verification before implementation.

## Pre-Production Blockers

- [ ] Written Gebeta production-provider answers: units/schema/limits/failures/rate limiting/pricing/SLA/privacy/traffic/versioning/key rotation
- [ ] Production-region Gebeta latency/capacity validation
- [ ] Production IaC, task sizing, alarms, and restore drills

## Required Update After Every Task

- Mark the task complete in its phase playbook.
- Update `task-completion-checklist.md`.
- Record decisions and unresolved questions.
- Record new risks and existing-system findings.
- Note commands/tests run and their results.
- Select one next task candidate.
- State whether the next task is ready for approval.
