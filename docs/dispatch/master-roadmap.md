# Instant Ride Dispatch Master Roadmap

The roadmap is dependency-ordered, not calendar-based. Each task is intentionally small enough to approve, implement, verify, and review independently.

## Phase Gates

| Phase | Outcome                                            | Exit gate                                                          |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Approved behavior and architecture contracts       | No blocking product/architecture ambiguity for Phase 1             |
| 1     | Infrastructure, test, and qualification foundation | Clean migrations, integration tests, and trusted eligibility facts |
| 2     | Correct driver eligibility and live presence       | Only eligible/fresh drivers can become candidates                  |
| 3     | Durable rider request lifecycle                    | Authorized/idempotent request create/cancel behavior               |
| 4     | Deterministic candidate discovery and routing      | Ranked candidates with measured provider/failure behavior          |
| 5     | Transaction-safe sequential offer lifecycle        | Required concurrency suite passes                                  |
| 6     | Durable workers, notification, and recovery        | Crash/retry/reconciliation exercises pass                          |
| 7     | Authenticated Socket.IO contracts                  | Reconnect and multi-instance delivery behavior proven              |
| 8     | Operational hardening and simulation               | Capacity/failure targets and runbooks approved                     |
| 9     | Controlled rollout                                 | Kill switch, shadow mode, and staged production validation         |
| 10    | Client API completion                              | Fare, trip, cancellation, and history gaps have approved contracts |

## Project Checklist

### Phase 0 - Discovery and Contracts

Playbook: [phases/00-discovery-and-contracts.md](phases/00-discovery-and-contracts.md)

- [x] `D0.1` Define Instant Ride V1 product behavior
- [x] `D0.2` Define driver eligibility and existing-domain mapping
- [x] `D0.3` Complete Gebeta Maps capability spike and routing decision
- [x] `D0.4` Define live location/presence policy
- [x] `D0.5` Define AWS/Docker deployment topology
- [x] `D0.6` Approve state machines, module boundaries, and API/event contracts

### Phase 1 - Foundation

Playbook: [phases/01-foundation.md](phases/01-foundation.md)

- [x] `D1.1` Add PostGIS-capable local/test infrastructure
- [x] `D1.2` Add spatial schema conventions and migration smoke tests
- [x] `D1.3` Establish dispatch integration-test harness
- [x] `D1.4` Add typed dispatch configuration
- [x] `D1.5` Introduce queue abstraction and worker lifecycle foundation
- [x] `D1.6` Implement transactional outbox foundation
- [x] `D1.7` Correct account activity and driver-capability authorization
- [x] `D1.8` Implement audited driver qualification approval and suspension
- [x] `D1.9` Model document ownership, approval, expiry, and revocation
- [x] `D1.10` Enforce active-vehicle and vehicle-qualification invariants
- [x] `D1.11` Bind mobile sessions to device identity
- [x] `D1.12` Add Redis readiness and failure signaling

### Phase 2 - Driver Presence

Playbook: [phases/02-driver-presence.md](phases/02-driver-presence.md)

- [x] `D2.1` Add durable driver operational profile/state
- [x] `D2.2` Implement eligibility projection/query
- [x] `D2.3` Implement online/offline transitions
- [x] `D2.4` Implement ordered live-location ingestion
- [x] `D2.5` Implement Redis presence/H3 indexing
- [x] `D2.6` Enforce pre-assignment location privacy policy
- [x] `D2.7` Add presence reconciliation and metrics

### Phase 3 - Ride Requests

Playbook: [phases/03-ride-requests.md](phases/03-ride-requests.md)

- [x] `D3.1` Add Instant Ride request schema and invariants
- [x] `D3.2` Implement authenticated request creation
- [x] `D3.3` Add idempotency and active-request protection
- [x] `D3.4` Implement rider cancellation
- [x] `D3.5` Publish durable dispatch-start/cancel intent
- [x] `D3.6` Add rider request query/snapshot contract

### Phase 4 - Candidate Discovery and Routing

Playbook: [phases/04-candidate-routing.md](phases/04-candidate-routing.md)

- [x] `D4.1` Define and test candidate policy
- [x] `D4.2` Implement Redis/H3 coarse discovery
- [x] `D4.3` Implement durable eligibility/exact-distance filtering
- [x] `D4.4` Define `RoutingProvider` and fake adapter
- [x] `D4.5` Implement Gebeta Maps adapter
- [x] `D4.6` Implement deterministic route-based ranking
- [x] `D4.7` Add discovery/routing metrics and failure policy

### Phase 5 - Sequential Offer Lifecycle

Playbook: [phases/05-offer-lifecycle.md](phases/05-offer-lifecycle.md)

- [x] `D5.1` Add dispatch attempt and offer schemas/invariants
- [x] `D5.2` Implement request-safe match orchestration
- [x] `D5.3` Implement atomic driver reservation and offer creation
- [x] `D5.4` Implement authorized/idempotent offer acceptance
- [x] `D5.5` Implement authorized/idempotent offer rejection
- [x] `D5.6` Implement expiration transition
- [x] `D5.7` Implement cancellation interaction
- [x] `D5.8` Complete mandatory concurrency suite

### Phase 6 - Durable Workers and Recovery

Playbook: [phases/06-workers-recovery.md](phases/06-workers-recovery.md)

- [x] `D6.1` Publish outbox events to queues idempotently
- [x] `D6.2` Implement match worker retries/backoff
- [x] `D6.3` Implement delayed offer-expiration jobs
- [x] `D6.4` Integrate dispatch FCM notifications
- [x] `D6.5` Implement rematch/exhaustion policy
- [x] `D6.6` Implement reconciliation worker
- [x] `D6.7` Add failed-job/dead-letter operations

### Phase 7 - Realtime

Playbook: [phases/07-realtime.md](phases/07-realtime.md)

- [x] `D7.1` Define Socket.IO authentication and event contracts
- [x] `D7.2` Implement authenticated gateway/rooms
- [x] `D7.3` Publish dispatch events from durable outbox
- [x] `D7.4` Implement reconnect/snapshot behavior
- [x] `D7.5` Prove multi-instance Socket.IO delivery

### Phase 8 - Hardening

Playbook: [phases/08-hardening.md](phases/08-hardening.md)

- [x] `D8.1` Add dispatch metrics and structured correlation logging
- [x] `D8.2` Add secured operational inspection tooling
- [x] `D8.3` Execute failure/recovery exercises
- [x] `D8.4` Execute location/discovery/dispatch load tests
- [x] `D8.5` Complete security and abuse review
- [x] `D8.6` Complete data retention/privacy review
- [x] `D8.7` Approve production SLOs and runbooks

### Phase 9 - Controlled Rollout

Playbook: [phases/09-rollout.md](phases/09-rollout.md)

- [x] `D9.1` Implement feature flags and kill switches
- [x] `D9.2` Run shadow candidate-ranking mode
- [x] `D9.3` Run internal allowlisted dispatch
- [x] `D9.4` Run limited geography/hours rollout
- [ ] `D9.5` Evaluate metrics, incidents, and rollback readiness
- [ ] `D9.6` Approve beta expansion

### Phase 10 - Client API Completion

Playbook: [phases/10-client-api-completion.md](phases/10-client-api-completion.md)

Note: Phase 10 is a corrective client/API completion track from the endpoint audit.
It does not imply `D9.5` rollout evidence or `D9.6` beta expansion approval are
complete.

- [x] `D10.1` Add authenticated fare estimate endpoint
- [x] `D10.2` Bind fare estimate and vehicle type into request creation
- [x] `D10.3` Complete assignment detail snapshots for rider and driver
- [x] `D10.4` Add pickup arrival, trip-start warning, and no-show controls
- [x] `D10.5` Add structured cancellation request/reason APIs
- [x] `D10.6` Add bounded ride history APIs
- [x] `D10.7` Add active assignment and offer detail reads
- [x] `D10.8` Add minimal trip start and completion controls

## Cross-Phase Rule

No phase may exit with an untested critical invariant, an undocumented accepted decision, or a known unrecoverable stuck-state path.
