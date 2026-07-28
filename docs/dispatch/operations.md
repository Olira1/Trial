# Dispatch Operations, Reliability, and Rollout

## Reliability Model

Dispatch must assume:

- API and worker processes restart.
- Jobs are delivered more than once.
- External providers time out.
- Socket clients disconnect.
- Redis data can be lost.
- Notifications can fail.
- Multiple instances execute concurrently.

Correctness depends on durable database state and idempotent transitions, not process memory.

## Required Operational Components

- Transactional outbox publisher
- Match worker
- Offer-expiration worker/delayed jobs
- Notification delivery worker
- Realtime event publisher
- Reconciliation worker
- Dead-letter or failed-job inspection
- Secured operational/debug endpoints or admin views

## Core Metrics

Product/dispatch:

- Requests created, assigned, cancelled, expired, and no-driver-found
- Time to first offer
- Time to assignment
- Offers per assignment
- Offer accept/reject/timeout rates
- Candidate counts before/after eligibility filtering
- Routing source and fallback usage

Reliability:

- Outbox unpublished count and oldest age
- Queue depth, delayed depth, failed count, and oldest job age
- Requests/offers stuck beyond expected state duration
- Duplicate/idempotent command counts
- Reconciliation repairs
- Redis and routing provider errors/timeouts
- Online drivers with fresh, stale, or missing presence
- Rejected stale-owner updates, presence takeovers, and reconciliation cleanup
- Presence resume failures and rejected stale-generation operations
- Bounded stale-generation writes and durable-generation dispatch exclusions
- Lease creation/resume counts and rejected prior/mismatched lease events

Performance:

- Candidate discovery latency
- Routing provider latency
- Reservation transaction latency
- Acceptance transaction latency
- Location update throughput and latency
- Location acknowledgement latency, accepted/throttled/invalid update rate, age, and accuracy distributions
- Socket event delivery latency

## Structured Logging

Every dispatch log should include relevant correlation fields:

- `requestId`
- `offerId`
- `driverId`
- `riderId`
- `jobId`
- `outboxEventId`
- transition name
- prior/new state where safe

Never log access tokens, location histories in bulk, provider secrets, or full sensitive payloads.

## D8.1 Dashboard and Alert Baseline

Phase 8 starts with log-backed application metrics and a documented CloudWatch
dashboard/alarm contract before any later IaC automation.

Required dashboard groups:

- Request lifecycle: requests created/assigned/cancelled/expired/no-driver, time
  to first offer, time to assignment, offers per assignment
- Offer lifecycle: offers created/accepted/rejected/expired
- Discovery and routing: candidate counts, discovery latency, routing latency,
  routing outcomes, provider errors
- Reliability and recovery: outbox unpublished count/age, reconciliation repair
  counts, stuck requests, stuck offers, stuck drivers
- Realtime: socket event delivery latency

Required alarms:

- `DispatchStuckRequestsAlarm`: any `stuck_request` events above baseline in a
  five-minute window
- `DispatchStuckOffersAlarm`: any `stuck_offer` events above baseline in a
  five-minute window
- `DispatchProviderErrorsAlarm`: sustained `provider_error` events for routing
  operations
- `DispatchQueueFailuresAlarm`: sustained `queue_error` or queue failed-depth
  growth once queue-depth polling lands
- `DispatchOutboxBacklogAlarm`: unpublished outbox count or oldest age above the
  approved threshold

Alarm implementation may begin with CloudWatch metric filters derived from the
structured log event names emitted by the application. Later IaC work may
replace manual setup without changing the application metric vocabulary.

## Reconciliation Responsibilities

Reconciliation must detect and repair or alert on:

- Pending offers past expiry
- Offered requests without a pending offer
- Offered drivers without a pending offer
- Pending offers whose request/driver state disagrees
- Searching requests without an active/recent match job
- Unpublished outbox events
- Assignments missing required handoff records/events

Repair behavior must be idempotent and tested. Ambiguous corruption should alert rather than guess.

## D8.2 Secured Operational Tooling Baseline

The V1 backend exposes a guarded admin-only dispatch operations surface:

- queue inspection via `GET /api/v1/admin/dispatch/queues`
- request inspection via `GET /api/v1/admin/dispatch/requests/:id`
- offer inspection via `GET /api/v1/admin/dispatch/offers/:id`
- driver inspection via `GET /api/v1/admin/dispatch/drivers/:id`
- manual reconciliation enqueue via `POST /api/v1/admin/dispatch/reconciliation`

Security rules:

- every endpoint is protected by `AdminSessionGuard` plus role checks
- inspection endpoints are read-only and return durable dispatch state snapshots
  with least-privilege redaction
- manual actions require an explicit operator `reason`
- manual actions must emit audit logs including admin actor, action name, queue/job
  identity when applicable, and no secrets or bulk location payloads

Out of scope for D8.2:

- arbitrary row editing
- direct state overrides
- retry/repair actions beyond approved reconciliation enqueue

Least-privilege redaction rules:

- do not expose request creation idempotency keys
- do not expose live presence authority/session identifiers unless a later task
  proves they are strictly required for approved operations
- do not expose precise pre-assignment coordinates through admin inspection

## D8.4 Local Load Baseline

Phase 8 load evidence currently uses deterministic local simulations to verify
that configured limits behave as intended before broader environment-scale tests.

Current local baseline:

- Candidate-ranking routing concurrency:
  `src/modules/dispatch-candidate/candidate-ranking.load.spec.ts`
  proves `DISPATCH_ROUTING_MAX_CONCURRENCY=3` bounds nine concurrent ranking
  requests to at most three in-flight routing calls, with a local completion
  budget under 400 ms for the simulated provider delay.
- Match worker backlog drain:
  `src/modules/dispatch-offer/match-worker.load.integration.spec.ts`
  proves a burst of 24 queued match jobs drains within a 3-second local budget
  while preserving deterministic queue identities.

Interpreting this baseline:

- These results are safe local guardrails, not production capacity claims.
- Production rollout still requires environment-specific load tests for Redis,
  PostgreSQL, Gebeta latency, Socket.IO backplane behavior, and multi-worker
  scaling.
- Until those tests exist, keep the current config defaults as the approved
  starting point:
  `routingMaxConcurrency=3`, `routingMaxCallsPerSecond=0` (disabled local rate
  cap), `maxCandidates=9`, and queue retry/backoff defaults from
  `dispatchConfig`.

## Docker/AWS Direction

Approved V1 deployment topology is defined in
[deployment-topology.md](deployment-topology.md).

Expected production components:

- ECR backend image repository
- ECS Fargate API service behind an HTTPS Application Load Balancer
- ECS Fargate worker service, split by workload later only after evidence
- one-off ECS migration tasks before service rollout
- RDS PostgreSQL with PostGIS as durable truth
- ElastiCache Redis OSS 7.x as ephemeral presence, queue, and Socket.IO acceleration
- Secrets Manager for secrets and task environment/SSM for non-secret config
- CloudWatch Logs, metrics, dashboards, and alarms

Operational constraints:

- API and worker tasks do not run migrations on startup.
- Redis restore is not a correctness mechanism.
- More than one realtime API task requires a proven Redis Socket.IO adapter/backplane and reconnect snapshot contract.
- Local Docker must remain capable of running the complete integration test stack, including PostGIS.

## Rollout Controls

Required before production:

- Feature flag/kill switch for new Instant Ride request creation
- Ability to stop matching while preserving/cancelling existing requests safely
- Configurable offer TTL, matching deadline, search policy, and worker concurrency
- Dark/shadow candidate-ranking mode before real offers
- Internal allowlist or limited geography rollout
- Clear rollback and data-reconciliation procedure

Current Phase 9 rollout-control baseline:

- `DISPATCH_ENABLE_NEW_REQUESTS=false` rejects new Instant Ride request creation
  at the service boundary.
- `DISPATCH_ENABLE_NEW_MATCHING=false` prevents new match orchestration from
  claiming attempts or issuing new offers.
- `DISPATCH_ENABLE_SHADOW_RANKING=true` keeps match jobs on the real request
  load plus candidate discovery/ranking path, but stops before attempt claim,
  offer reservation, or terminal request mutation; operators should compare the
  emitted `shadow_ranking_result` logs with routing/discovery metrics before
  enabling live offers.
- `DISPATCH_INTERNAL_RIDER_ALLOWLIST` and
  `DISPATCH_INTERNAL_DRIVER_ALLOWLIST` accept comma-separated user IDs for the
  internal rollout phase. Riders outside the configured rider allowlist are
  rejected before request creation transactions begin; drivers outside the
  configured driver allowlist are excluded before lease lookup and reservation.
- `DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE`,
  `DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE`,
  `DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE`, and
  `DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE` optionally define an all-or-none
  pickup bounding box for limited rollout demand.
- `DISPATCH_ROLLOUT_START_HOUR_LOCAL`, `DISPATCH_ROLLOUT_END_HOUR_LOCAL`, and
  `DISPATCH_ROLLOUT_TIMEZONE` optionally define the local request-creation
  window; the configured hour window gates only new demand and does not abort
  in-flight requests/offers.
- These controls are process-config flags today; geography, allowlist, and time
  window rollout scope are now available for later-stage limited rollout.

## Rollout Stages

1. Local deterministic simulation
2. Integration environment with fake routing provider
3. Integration environment with Gebeta Maps
4. Shadow candidate discovery/ranking without offers
5. Internal test drivers/riders
6. Limited geography and limited hours
7. Gradual capacity increase
8. General beta after metrics and failure rates meet approved thresholds

## Rollout Evaluation Checklist

Use this checklist for `D9.5` after internal allowlist and limited
geography/hour rollout have produced real observations.

- Compare request creation availability, dispatch lifecycle completion, routing
  provider success, and realtime delivery against the documented SLOs.
- Review p95 latency for time to first offer, time to assignment, discovery,
  routing, reservation, acceptance, and socket delivery.
- Review every `system_failed`, stuck-state alarm, manual reconciliation
  enqueue, queue failure spike, and provider-error burst during the rollout
  window.
- Summarize provider cost, queue backlog behavior, outbox lag, and Redis
  readiness incidents for the same window.
- Summarize support burden: rider complaints, driver confusion, operational
  pages, and any manual intervention count.
- Decide whether the observed error budget supports expansion, narrowing, or
  rollback.

## Beta Expansion Approval Checklist

Use this checklist for `D9.6` once `D9.5` has a written evaluation.

- Product reviews the rollout outcomes and confirms customer/support impact is
  acceptable.
- Engineering reviews incidents, rollback readiness, alert noise, and
  reconciliation volume.
- Routing/provider cost and capacity remain acceptable for the proposed wider
  rollout.
- Remaining open risks have either accepted mitigations or an explicit owner.
- `current-status.md`, `operations.md`, and the phase playbook are updated with
  the approval date, scope change, and any new rollback threshold.

## D8.7 Production SLO Baseline

These are the initial production SLO targets for Instant Ride dispatch V1. They
are approval gates for controlled rollout, not promises for every future phase.

### Service Indicators

- Request creation success rate
- Match completion rate to a terminal request outcome
- Time to first offer
- Time to assignment
- Realtime snapshot delivery success for active participants
- Redis readiness for presence/matching paths
- Routing provider success rate for dispatch ranking
- Queue backlog and outbox publish lag

### Initial Objectives

Over a rolling 30-day window:

- Request creation availability: `>= 99.9%`
- Dispatch lifecycle completion to a terminal request outcome
  (`assigned`, `cancelled`, `expired`, `no_driver_found`, `system_failed`)
  within the matching deadline: `>= 99.5%`
- Realtime snapshot delivery for connected authorized participants:
  `>= 99.0%`
- Redis-backed presence/matching readiness: `>= 99.9%`
- Routing provider successful batch completion when dispatch attempts routing:
  `>= 99.0%`

P95 targets during approved rollout windows:

- Time to first offer: `<= 30s`
- Time to assignment for successfully assigned requests: `<= 90s`
- Candidate discovery latency: `<= 250ms`
- Routing provider latency: `<= 3000ms`
- Reservation transaction latency: `<= 250ms`
- Acceptance transaction latency: `<= 250ms`
- Socket event delivery latency: `<= 1000ms`

Error-budget guidance:

- Breaching any availability SLO freezes rollout expansion until reviewed.
- Breaching any latency target for two consecutive rollout checkpoints requires
  explicit tuning or narrower rollout limits.
- `system_failed` request outcomes count against dispatch lifecycle SLOs and
  may not be reclassified as `no_driver_found`.

## Alert-to-Runbook Map

| Alert                         | Primary signal                       | First response                                          |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `DispatchStuckRequestsAlarm`  | `stuck_request` events               | Run stuck-request inspection and reconciliation runbook |
| `DispatchStuckOffersAlarm`    | `stuck_offer` / stuck-driver signals | Run offer/driver inspection and reconciliation runbook  |
| `DispatchProviderErrorsAlarm` | `provider_error` routing events      | Run routing-provider outage runbook                     |
| `DispatchQueueFailuresAlarm`  | queue failures/backlog growth        | Run queue backlog / worker degradation runbook          |
| `DispatchOutboxBacklogAlarm`  | unpublished outbox count/age         | Run outbox backlog runbook                              |
| Redis readiness alarm         | health/readiness failure             | Run Redis outage runbook                                |
| Realtime delivery alarm       | socket delivery degradation          | Run realtime degradation runbook                        |

## Runbooks

### 1. Stuck Request / Offer Investigation

Use when:

- stuck request/offer alarms fire
- support reports a rider or driver is frozen in dispatch state

Steps:

1. Inspect queue health with `GET /api/v1/admin/dispatch/queues`.
2. Inspect the request with `GET /api/v1/admin/dispatch/requests/:id`.
3. Inspect any related offer and driver state with the corresponding admin
   endpoints.
4. Confirm whether the request has an active pending offer, active attempt, or
   contradictory driver operational state.
5. If the issue matches approved reconciliation scope, enqueue
   `POST /api/v1/admin/dispatch/reconciliation` with an explicit operator
   reason.
6. Re-check request/offer/driver state after reconciliation completes.
7. If state remains contradictory, stop at escalation and do not manually edit
   durable rows as an unapproved workaround.

### 2. Routing Provider Outage

Use when:

- routing provider errors spike
- time to first offer rises with provider failures
- `system_failed` request outcomes increase

Steps:

1. Confirm `provider_error` rate and routing latency metrics.
2. Confirm Redis and queue health are otherwise normal.
3. Narrow rollout if active production rollout controls exist; do not relabel
   failures as `no_driver_found`.
4. Keep matching fail-closed while provider failures persist.
5. Use admin inspection on sample failed requests to confirm the failures are
   provider-driven rather than eligibility or queue issues.
6. Escalate vendor/provider incident handling before resuming broader rollout.

### 3. Queue Backlog / Worker Degradation

Use when:

- queue waiting/delayed/failed counts grow unexpectedly
- outbox jobs or match jobs stop draining

Steps:

1. Inspect `GET /api/v1/admin/dispatch/queues`.
2. Verify ECS worker task health and restart status.
3. Compare backlog growth with outbox unpublished age/count metrics.
4. For reconciliation-safe issues, enqueue manual reconciliation after worker
   recovery.
5. If worker restart is required, preserve deterministic job IDs and allow the
   queue to redeliver rather than manually duplicating work.
6. After recovery, confirm backlog returns to baseline and inspect one affected
   request end to end.

### 4. Outbox Backlog / Realtime Publish Lag

Use when:

- unpublished outbox age/count breaches threshold
- committed request/offer transitions are not surfacing in realtime

Steps:

1. Confirm queue health for `dispatch.outbox`.
2. Inspect backlog age/count versus worker health.
3. Confirm the issue is downstream of durable commit by inspecting sample
   request/offer state through admin endpoints.
4. Recover worker capacity first; allow deterministic outbox jobs to replay.
5. Use reconciliation if published intent appears stranded after worker
   recovery.
6. Treat reconnect snapshots as the correctness fallback for clients during
   realtime lag.

### 5. Redis Outage / Presence Failure

Use when:

- `/api/v1/health` reports Redis down
- drivers report `resumeRequired` or `503` resume failures
- fresh-driver counts collapse abruptly

Steps:

1. Confirm Redis readiness and infrastructure status.
2. Assume matching must fail closed while Redis is unavailable.
3. Do not attempt a degraded PostGIS presence fallback.
4. After Redis recovery, require drivers to resume and publish fresh current
   location before treating them as dispatch-available.
5. Re-run reconciliation to clean stale leases and disagreement.
6. Verify that active request handling remains consistent from durable
   PostgreSQL state before expanding traffic.

### 6. Realtime Degradation

Use when:

- socket event delivery latency rises
- users miss live updates but API state is correct

Steps:

1. Confirm API task health and Redis backplane health.
2. Confirm committed durable state via admin inspection.
3. Treat `dispatch:snapshot:request` reconnect recovery as the correctness path
   while live delivery is degraded.
4. If multi-instance delivery is affected, validate Redis adapter/backplane
   connectivity before adding API capacity.
5. Escalate only after durable state and reconnect snapshots fail to recover
   client state.

### 7. Rollback / Matching Stop

Use when:

- an SLO breach or incident requires stopping expansion immediately

Steps:

1. Disable new-request or new-offer rollout controls once Phase 9 controls
   exist.
2. Preserve durable truth and do not manually rewrite request or offer history.
3. Allow existing in-flight requests to resolve or move through approved
   cancellation/reconciliation paths.
4. Inspect sample requests and queues until the system returns to a stable idle
   state.
5. Record incident timeline, affected metrics, operator actions, and any
   follow-up roadmap task before re-enabling rollout.
