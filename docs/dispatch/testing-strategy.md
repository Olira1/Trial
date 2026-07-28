# Instant Ride Dispatch Testing Strategy

## Testing Goals

Tests must prove domain invariants, transaction behavior, retry safety, authorization, and operational recovery. Passing helper tests alone is not evidence that dispatch is safe.

## Test Layers

### Pure Unit Tests

Use for:

- State transition policy
- Candidate scoring/ranking
- H3/search-policy calculations
- Routing response validation
- Configuration validation
- Event payload construction

Avoid testing trivial property assignment or framework behavior.

### Service Tests with Controlled Fakes

Use for:

- Provider timeout/error mapping
- Queue/realtime/notification port behavior
- Worker retry decisions
- Deterministic ranking with fake routing data
- Presence-session ownership, lease-scoped ordering, capture-time, freshness, and acknowledgement policy

Fakes must model failure and duplication, not only success.

### PostgreSQL/Redis Integration Tests

Use real Docker-backed PostgreSQL/PostGIS and Redis for:

- Schema constraints and indexes
- Transaction propagation
- Row locks and atomic predicates
- Concurrent matching and offer transitions
- Outbox idempotency
- Presence/location ordering
- Presence lease takeover, owner resume, prior-lease replay rejection, sequence reset, bounded stale writes, stale-generation dispatch exclusion, TTL expiry, and Redis restart/loss
- Redis loss/rebuild behavior
- Spatial query correctness

Do not mock the database for invariants that depend on the database.

Dispatch-specific PostgreSQL/Redis tests should use
`test/dispatch-integration-harness.ts` unless a task explicitly approves another
fixture. The harness provides:

- explicit PostgreSQL/PostGIS and Redis dependency checks;
- independent PostgreSQL clients for concurrency tests;
- rollback-scoped database work for deterministic cleanup;
- namespace-scoped Redis keys and cleanup without `FLUSHDB`.

### HTTP/WebSocket End-to-End Tests

Cover:

- Authentication and ownership
- Strict input validation
- Response serialization
- Rider request lifecycle
- Driver presence commands
- Offer accept/reject
- Socket authorization, reconnect, and event delivery contract
- Error status and idempotency behavior

### Simulation and Load Tests

Model:

- Sparse, normal, and dense driver supply
- Many riders competing for a small driver pool
- Driver location update throughput
- Routing provider latency/failure
- Queue backlog and worker restarts
- Multi-instance API/worker concurrency

## TDD Requirement Per Task

The task approval brief names the first failing test. Implementation does not begin until:

- The test describes approved behavior.
- The test would fail against a realistic regression.
- The test layer matches the risk.

## Mandatory Concurrency Suite

Before offer lifecycle is considered complete:

- [ ] One request cannot get two accepted drivers.
- [ ] One driver cannot accept two requests.
- [ ] Duplicate match jobs do not corrupt request state.
- [ ] Accept versus expiration produces one valid winner.
- [ ] Accept versus cancellation produces one valid winner.
- [ ] Duplicate jobs/commands remain idempotent.
- [ ] Deadlock/serialization failures are handled according to policy.

## Provider Contract Tests

Gebeta Maps adapter tests must cover:

- Bearer authentication and proof that credentials never enter URLs/logs/metrics
- Coordinate order and validation
- Maximum-nine-candidate batching and multi-batch ordering
- Successful response mapping
- Kilometer-to-meter conversion and integer-second validation
- Duplicate, missing, out-of-range, and malformed matrix pairs
- Unreachable routes and opaque `500` responses
- `200 null`, partial results, and ignored/unexpected fields
- Rate limiting
- Timeout
- Malformed response
- Provider 4xx/5xx classification
- No adapter-level retry
- No silent fallback or conversion to `no_driver_found`
- Metrics/logging without secret leakage

## Quality Gates

Per task:

- Focused red/green tests
- Relevant integration/e2e tests
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`

Per phase:

- Entire relevant module suite
- Migration test from a clean database
- Migration test against the prior project schema where applicable
- Documented manual verification if automation is not yet feasible
- Phase exit review against risk register and state-machine invariants

Before rollout:

- Full test suite
- Concurrency suite repeatedly
- Load/simulation results
- Worker restart/recovery exercise
- Redis and routing-provider failure exercise
- Rollback/kill-switch exercise

## D8.3 Failure Exercise Baseline

Phase 8 failure exercises may combine new tests with reruns of earlier recovery
contracts when those earlier tasks already proved the required behavior.

Current exercised baseline:

- Match worker restart recovery:
  `src/modules/dispatch-offer/match-worker.service.integration.spec.ts`
- Notification transient failure retry:
  `src/modules/dispatch-offer/dispatch-notification-worker.service.integration.spec.ts`
- Redis lease-creation outage fail-closed behavior:
  `test/driver-presence.e2e-spec.ts`
- Crash-after-enqueue outbox recovery:
  `src/modules/dispatch-outbox/dispatch-outbox.integration.spec.ts`

Any failure exercise that exposes a correctness gap must either:

- add the smallest fix plus regression test inside the same approved task; or
- stop implementation and record the blocker explicitly before continuing.

## Test Data Principles

- Use deterministic coordinates around Addis Ababa.
- Include H3 boundary cases and drivers just inside/outside exact radius.
- Include stale, out-of-order, and duplicate location updates.
- Include capture-time replay/skew, poor accuracy, rate limiting, ownership takeover, owner resume, prior-lease replay, lease-scoped sequence reset, delayed old-generation writes, durable-generation dispatch exclusion, disconnect, and revoked-session cases.
- Include all eligibility combinations from plate code and approval rules.
- Keep fixtures small and purpose-specific.
- Never use future timestamps to fake freshness.
