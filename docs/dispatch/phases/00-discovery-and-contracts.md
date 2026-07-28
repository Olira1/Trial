# Phase 0 - Discovery, Contracts, and Architecture Approval

## Goal

Resolve the behavior and architecture decisions that would make later schemas or APIs expensive to reverse.

## Exit Gate

- All Phase 1 blockers are resolved.
- State machines and module boundaries are approved.
- Gebeta Maps and AWS assumptions are verified enough to design against.
- No runtime code has been introduced prematurely.

## `D0.1` Define Instant Ride V1 Product Behavior

**Deliverable:** Approved product behavior document/ADR.

- [x] Define who may create an Instant Ride request.
- [x] Define whether a rider may have more than one active request.
- [x] Define request creation idempotency expectations.
- [x] Define rider-visible states and messages.
- [x] Define sequential offer TTL.
- [x] Define total matching deadline.
- [x] Define search expansion/retry behavior.
- [x] Define terminal `no_driver_found` behavior and whether retry creates a new request.
- [x] Define rider cancellation behavior during searching/offered.
- [x] Define what dispatch owns after driver acceptance.
- [x] Define driver rejection/timeout/cooldown behavior.
- [x] Define whether driver cancellation after acceptance is in this project.

**Acceptance:** Every proposed request/offer state has an agreed rider/driver-visible meaning and terminal behavior.

**Status:** Complete on 2026-06-11. See [product-behavior.md](../product-behavior.md).

**Completion review:**

- Acceptance criteria met: every proposed request/offer state has an approved rider/driver-visible meaning and terminal behavior.
- Runtime, schema, API, infrastructure, and transaction effects: none; this task changed documentation only.
- New accepted decisions: `DD-011` through `DD-018`.
- New deferred contract question: `OQ-013`, idempotency-key reuse with a different
  payload. Resolved by `D0.6` as `409 Conflict`.
- New risks or existing-system findings: none.
- Verification: repository diff checks, documentation link scan, and stale-decision search passed.
- Recommended next task: `D0.2`.

## `D0.2` Define Driver Eligibility and Existing-Domain Mapping

**Deliverable:** Eligibility reference and approved schema-gap findings.

- [x] Map user active/deleted/role state.
- [x] Map driver application approval.
- [x] Map approved/non-deleted vehicle requirements.
- [x] Map plate code/subtype rules for Instant Ride eligibility.
- [x] Define document-expiry/suspension interaction.
- [x] Define whether multiple approved vehicles are possible and how active vehicle is selected.
- [x] Define manual/system suspension ownership.
- [x] Identify exact existing schema gaps.

**Acceptance:** Given existing durable records, eligibility is deterministic or every missing fact has an approved schema task.

**Status:** Complete on 2026-06-11. See [driver-eligibility.md](../driver-eligibility.md).

**Completion review:**

- Acceptance criteria met: the durable eligibility contract is approved and every missing fact maps to `D1.7` through `D1.10`.
- Runtime, schema, API, infrastructure, and transaction effects: none; this task changed documentation only.
- New accepted decisions: `DD-019` through `DD-026`.
- New existing-system findings: `ESF-006` through `ESF-011`.
- New/updated risks: `R-005`, `R-016`, and `R-017`.
- Verification: repository diff checks, documentation link scan, and stale-decision search passed.
- Recommended next task: `D0.3`.

## `D0.3` Gebeta Maps Capability Spike

**Deliverable:** Routing provider capability report and ADR.

- [x] Obtain official/current Gebeta Maps API documentation and credentials strategy.
- [x] Verify route directions API.
- [x] Verify matrix/table or multi-origin capability.
- [ ] Measure response latency from expected AWS region. Explicitly deferred by user; required before production rollout.
- [ ] Document quotas, rate limits, pricing, and SLA. Public claims recorded; written vendor confirmation pending.
- [ ] Verify coordinate order, traffic support, route restrictions, and unreachable-route behavior. Coordinate/error behavior measured; traffic semantics pending vendor confirmation.
- [x] Test malformed/partial/error responses.
- [x] Decide batching/caching/fallback policy.
- [ ] Define secret rotation and timeout policy. Timeout and Bearer auth approved; zero-downtime rotation pending vendor confirmation.

**Acceptance:** Routing interface and failure policy can be designed without guessing.

**Status:** Complete for engineering design on 2026-06-11; production-provider approval remains a rollout gate. See [gebeta-maps-capability.md](../gebeta-maps-capability.md).

**Interim review:**

- Acceptance criteria met for application interface and failure-policy design.
- Live spike made 188 authenticated requests within the approved 200-call limit.
- V1 uses Matrix only, Bearer authentication, at most nine candidates per batch, a configurable 3-second timeout, no adapter-level retries, no cross-request cache, and no silent fallback.
- AWS Milan latency measurement was explicitly deferred until pre-production validation.
- Written Gebeta answers remain required for units, stable schema, limits, failures, rate limiting, pricing, SLA, privacy, traffic semantics, versioning, and key rotation.
- Remaining written-vendor items are production rollout gates tracked through `D9`; they do not block unrelated foundation implementation.
- New accepted decisions: `DD-027` through `DD-030`.
- New/updated risks: `R-004`, `R-018`, `R-019`, and `R-020`.
- Runtime, schema, API, infrastructure, and dependency effects: none; this task remains documentation and investigation only.

## `D0.4` Define Live Location and Presence Policy

**Deliverable:** Presence/location contract.

- [x] Define client update frequency and payload.
- [x] Define server ordering key: sequence, client timestamp, or both.
- [x] Define freshness threshold.
- [x] Define online/offline and disconnect behavior.
- [x] Define Redis key/index ownership and TTL.
- [x] Define whether/how often durable samples are stored.
- [x] Define retention/privacy policy.
- [x] Define behavior when Redis is unavailable or data is lost.

**Acceptance:** Stale/out-of-order updates and Redis loss have explicit behavior.

**Status:** Complete on 2026-06-12. See [live-location-presence.md](../live-location-presence.md).

**Completion review:**

- Acceptance criteria met: stale/duplicate/out-of-order updates, durable session ownership, lease-scoped ordering, reconnect/resume, takeover, expiry, Redis loss, and privacy behavior are explicit.
- V1 uses authenticated Socket.IO location ingestion and REST online/offline commands.
- PostgreSQL stores online intent plus owning auth-session/session/generation authority; dispatch availability is derived from fresh owned Redis presence, eligibility, and conflict state.
- Defaults are configurable 3-second updates, 12-second freshness, 30-second Redis cleanup TTL, 50-meter maximum accuracy, and capture-time replay/skew limits.
- V1 stores no durable pre-assignment coordinate history and has no Redis-outage PostGIS fallback.
- New accepted decisions: `DD-031` through `DD-039`.
- New existing-system findings: `ESF-012` and `ESF-013`, mapped to foundation tasks `D1.11` and `D1.12`.
- New/updated risks: `R-003`, `R-007`, `R-021`, `R-022`, and `R-023`.
- Implementation effects: none; this task changed documentation only. Approved future effects include durable presence-authority fields, authenticated resume behavior, ephemeral lease IDs with lease-scoped ordering, transactional ownership transitions, generation-aware Redis operations, and durable-generation revalidation before matching/reservation.
- Verification: repository diff checks, documentation formatting/link scan, and stale-decision search.
- Recommended next task: `D0.5`.

## `D0.5` Define AWS/Docker Deployment Topology

**Deliverable:** Approved deployment diagram/ADR.

- [x] Choose container runtime and deployment service.
- [x] Choose managed/self-hosted PostgreSQL with confirmed PostGIS support.
- [x] Choose managed/self-hosted Redis compatible with queues and Socket.IO scaling.
- [x] Define API and worker deployment units.
- [x] Define secrets/config distribution.
- [x] Define logs, metrics, alerting, and tracing services.
- [x] Define local/integration parity.
- [x] Define backup, restore, and migration execution.

**Acceptance:** Foundation tasks target a known production-compatible topology.

**Status:** Complete on 2026-06-14. See [deployment-topology.md](../deployment-topology.md).

**Completion review:**

- Acceptance criteria met: foundation tasks now target a specific AWS/Docker topology.
- V1 deploys to AWS `eu-south-1` with ECR, ECS Fargate, an Application Load Balancer,
  RDS PostgreSQL/PostGIS, ElastiCache Redis OSS 7.x, Secrets Manager, and CloudWatch.
- API, worker, and migration deployment units are separate ECS tasks/services from the
  same image artifact.
- Production migrations run as one-off ECS tasks before API/worker rollout; app startup
  migrations are not approved.
- Redis remains ephemeral and fail-closed. RDS PostgreSQL/PostGIS remains durable truth.
- Local/integration parity requires a PostGIS-capable database image in `D1.1`.
- New accepted decisions: `DD-040` through `DD-047`.
- Updated risks: `R-006`, `R-008`, `R-022`, and new risks `R-024` and `R-025`.
- Runtime, schema, API, infrastructure file, and dependency effects: none; this task
  changed documentation only.
- Verification: documentation formatting/link checks and stale-decision search.
- Recommended next task: `D0.6`.

## `D0.6` Approve State Machines, Boundaries, and Contracts

**Deliverable:** Approved revisions to architecture/state-machine docs and initial API/event contract.

- [x] Review `architecture.md`.
- [x] Review `state-machines.md`.
- [x] Define initial REST commands/queries and authorization.
- [x] Define initial Socket.IO events.
- [x] Define initial outbox/domain events.
- [x] Define idempotency behavior.
- [x] Define error/conflict semantics.

**Acceptance:** Phase 1 can begin without inventing product behavior in code.

**Status:** Complete on 2026-06-14. See [api-event-contracts.md](../api-event-contracts.md).

**Completion review:**

- Acceptance criteria met: Phase 1 can target approved state names, module boundaries,
  REST routes, Socket.IO events, outbox event names, idempotency behavior, and conflict
  semantics.
- D0.6 approved `system_failed` as a terminal request state for provider/system failures
  that must not be reported as `no_driver_found`.
- D0.6 approved the initial REST routes for driver presence, rider requests, and driver
  offers, all deriving authority from the authenticated session.
- D0.6 approved the `/dispatch` Socket.IO namespace, Bearer handshake authentication,
  `presence:location:update` acknowledgement outcomes, and baseline server events.
- D0.6 approved versioned durable outbox event names and event-envelope requirements.
- D0.6 approved idempotency-key mismatch behavior as `409 Conflict`.
- D0.6 approved device takeover only while the driver is `online`; takeover while
  `offered` or `assigned` is a conflict.
- D0.6 approved go-online Redis failure semantics: durable online may commit, no
  `leaseId` is returned, `resumeRequired=true`, and the driver is not dispatch-available
  until resume succeeds.
- New accepted decisions: `DD-048` through `DD-055`.
- New/updated risks: `R-026`.
- Runtime, schema, API implementation, infrastructure, and dependency effects: none;
  this task changed documentation only.
- Verification: documentation formatting/link checks and stale-decision search.
- Recommended next task: `D1.1`.
