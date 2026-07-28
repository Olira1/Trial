# Instant Ride Dispatch Project

This directory is the implementation handbook for building production-grade Instant Ride matching and dispatch inside `UbelBackend`.

The sibling `UbelMatching` project is a research prototype. It is not the implementation base and must not be copied wholesale.

## Start Every Dispatch Session Here

1. Read [current-status.md](current-status.md).
2. Read the active phase playbook linked from the status file.
3. Read [decision-register.md](decision-register.md) for accepted and unresolved decisions.
4. Confirm the next task is small, has no unresolved blockers, and satisfies the Definition of Ready in [delivery-workflow.md](delivery-workflow.md).
5. Present the task's requirements, assumptions, schema/API effects, acceptance criteria, and test plan.
6. Wait for explicit user approval before changing runtime code, schemas, infrastructure, dependencies, or public contracts.
7. Implement with TDD and complete the post-task review before proposing a commit.

## Project Scope

The first production slice covers **Instant Ride ride-hailing dispatch only**:

- Driver operational eligibility and live presence
- Rider Instant Ride requests
- Candidate discovery and route-based ranking
- Sequential dispatch offers
- Offer acceptance, rejection, expiration, and rematching
- Durable jobs and recovery
- Socket.IO live events and FCM background notifications
- Operational observability, reconciliation, and rollout

Shared Ride/carpooling matching, fares, payments, trip execution after acceptance, and general mobile UI are separate projects unless a task explicitly adds a minimal contract needed by dispatch.

## Accepted Direction

- Build from scratch inside `UbelBackend`.
- Keep existing onboarding `DriverModule` focused on applications, documents, and vehicles.
- Add separate `DriverPresenceModule`, `RideRequestsModule`, and `DispatchModule`.
- Use sequential offers for Instant Ride V1.
- Use Redis for live driver location/presence and PostgreSQL/PostGIS for durable spatial data.
- Use H3 plus PostGIS, with distinct responsibilities.
- Integrate routing through a provider interface; Gebeta Maps is the intended production provider.
- Use Socket.IO for live state and location delivery; use FCM for background notification.
- Deploy with Docker on AWS using ECS Fargate, ECR, an Application Load Balancer,
  RDS PostgreSQL/PostGIS, ElastiCache Redis OSS, Secrets Manager, and CloudWatch.
- Use strict TDD and review progress after every approved task/commit.

## Documentation Map

| Document                                                       | Purpose                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [current-status.md](current-status.md)                         | The single implementation checkpoint and next approved-task candidate       |
| [project-charter.md](project-charter.md)                       | Scope, goals, non-goals, principles, and success criteria                   |
| [product-behavior.md](product-behavior.md)                     | Approved Instant Ride V1 product behavior and user-visible meanings         |
| [driver-eligibility.md](driver-eligibility.md)                 | Approved durable Instant Ride driver qualification contract                 |
| [gebeta-maps-capability.md](gebeta-maps-capability.md)         | Measured Gebeta Maps behavior, V1 routing contract, and production gates    |
| [live-location-presence.md](live-location-presence.md)         | Approved V1 online intent, live presence, freshness, and privacy contract   |
| [spatial-schema-conventions.md](spatial-schema-conventions.md) | Approved PostGIS type, SRID, coordinate-order, index, and smoke-test rules  |
| [deployment-topology.md](deployment-topology.md)               | Approved AWS/Docker runtime, data, secrets, observability, and backup plan  |
| [api-event-contracts.md](api-event-contracts.md)               | Approved initial REST, Socket.IO, outbox, idempotency, and error contracts  |
| [master-roadmap.md](master-roadmap.md)                         | Phase ordering, dependencies, gates, and project-level checklist            |
| [architecture.md](architecture.md)                             | Target module boundaries, data ownership, and critical flows                |
| [state-machines.md](state-machines.md)                         | Allowed states, transitions, invariants, and race expectations              |
| [delivery-workflow.md](delivery-workflow.md)                   | Clarification, TDD, review, and commit protocol                             |
| [task-completion-checklist.md](task-completion-checklist.md)   | Persistent checklist of files, docs, registers, tests, and commits per task |
| [task-template.md](task-template.md)                           | Reusable approval, implementation, and completion checklist for one task    |
| [testing-strategy.md](testing-strategy.md)                     | Test layers, concurrency suites, fixtures, and quality gates                |
| [operations.md](operations.md)                                 | Reliability, observability, recovery, deployment, and rollout               |
| [decision-register.md](decision-register.md)                   | Accepted decisions and open questions                                       |
| [risk-register.md](risk-register.md)                           | Risks, mitigations, triggers, and ownership                                 |
| [existing-system-findings.md](existing-system-findings.md)     | Concerns discovered outside the active task                                 |
| [phases/](phases/)                                             | Small, executable phase playbooks                                           |

## Source-of-Truth Rules

- Product decisions and cross-repository architecture decisions belong in `../UbelDocs/`.
- Implementation plans, task tracking, testing detail, and backend-specific findings belong here.
- `current-status.md` must be updated after every completed task.
- A newly discovered blocker must stop implementation until it is resolved or explicitly deferred.
- A roadmap checkbox is complete only when its acceptance criteria and required tests pass.

## Status

Planning and governance documentation is established. Phase 0 through Phase 8 implementation work is complete, Phase 9 controlled rollout is partially complete through `D9.4`, and Phase 10 client/API completion has started with `D10.1` verified. `D9.5` still requires real rollout evidence, and Gebeta production-provider approval remains a rollout gate. Runtime work still requires per-task approval before implementation.
