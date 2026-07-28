# Instant Ride Dispatch Project Charter

## Objective

Build a production-ready Instant Ride dispatch capability inside `UbelBackend` that safely matches one rider request to one eligible driver, remains correct under concurrency and failure, and can be operated and recovered in a Docker-on-AWS deployment.

## Why This Is a Separate Project

Dispatch is not merely a distance query. It coordinates live location, driver eligibility, rider requests, route estimation, offer timers, notifications, concurrency, recovery, and operational state. Treating it as one feature or copying the `UbelMatching` prototype would hide critical state-machine and reliability work.

## In Scope

- Instant Ride driver eligibility projection
- Driver online/offline and live-location presence
- Durable Instant Ride requests
- Candidate discovery with Redis/H3/PostGIS
- Route-based candidate ranking through a routing provider interface
- Sequential dispatch offers
- Offer acceptance, rejection, expiration, cancellation, and rematching
- Transactional outbox and durable background processing
- Socket.IO events and FCM dispatch notifications
- Reconciliation, metrics, logging, alerts, dashboards, and rollout controls
- Internal debugging/observability endpoints where justified and secured

## Explicitly Out of Scope

- Shared Ride/carpooling route-overlap matching
- Simultaneous multi-driver offers for Instant Ride V1
- Fare calculation and surge pricing
- Payment collection and driver wallet
- Ratings
- Full trip execution after a driver is assigned, except the minimum handoff contract
- Mobile/client UI implementation
- Rebuilding onboarding, authentication, vehicle registration, or notifications unrelated to dispatch
- Migrating code wholesale from `UbelMatching`

## Success Criteria

The project is ready for controlled production rollout only when:

- Exactly one driver can win a request under all tested races.
- A driver cannot have conflicting active assignments/offers.
- Every offer reaches a terminal state or is recovered automatically.
- Every request reaches a documented terminal or active state.
- Process crashes and duplicate jobs do not corrupt state.
- Dispatch remains correct with multiple API and worker instances.
- Ineligible, stale, inactive, or already-busy drivers cannot be offered rides.
- Routing provider failures degrade according to an approved policy.
- Operational staff can identify and reconcile stuck requests/offers.
- Load tests meet approved latency and capacity targets.
- Rollout can be disabled or reduced without a deployment rollback.

## Engineering Principles

1. **Database invariants over application hope.** Use unique constraints, foreign keys, checks, atomic predicates, and row locks where possible.
2. **Short transactions.** Never call routing, notification, Socket.IO, or Redis network operations while holding database locks.
3. **Durable intent before side effects.** Persist outbox events/jobs in the same transaction as state changes.
4. **Idempotency everywhere.** Assume requests, jobs, notifications, and client commands are duplicated.
5. **Explicit state machines.** Every transition has a precondition, transaction boundary, and test.
6. **Separate durable truth from live presence.** PostgreSQL owns durable business state; Redis owns ephemeral availability/location acceleration.
7. **Provider isolation.** Gebeta Maps, Socket.IO, FCM, Redis, and queues are adapters behind owned interfaces.
8. **Operate what we build.** Metrics, structured logs, reconciliation, and recovery are required behavior.
9. **No hidden scope expansion.** New concerns become findings or roadmap tasks before implementation.
10. **Small approved changes.** One roadmap task per implementation cycle and proposed commit.

## Working Agreement

- The user approves each implementation task before runtime changes begin.
- TDD is mandatory for approved implementation work.
- Every completed task triggers an alignment review before a commit is proposed.
- Every commit remains explicitly user-approved.
- New decisions are written down; memory and chat history are not treated as durable sources.
