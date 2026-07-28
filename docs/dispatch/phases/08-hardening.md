# Phase 8 - Operational Hardening and Simulation

## Goal

Prove the system can be operated safely at expected beta load and under realistic failures.

## Tasks

### `D8.1` Metrics and Correlation Logging

- [x] Implement metrics listed in `operations.md`.
- [x] Add dashboards/alerts for stuck state and provider/queue health.
- [x] Verify sensitive data is not logged.

### `D8.2` Secured Operational Tooling

- [x] Inspect request/offer/driver dispatch state.
- [x] Trigger only approved reconciliation/retry actions.
- [x] Protect with admin authorization and audit logging.

### `D8.3` Failure Exercises

- [x] Kill workers during each critical transition.
- [x] Disable Redis, routing, queue access, Socket.IO backplane, and FCM.
- [x] Verify recovery and alerts.

### `D8.4` Load and Simulation

- [x] Measure location throughput, candidate discovery, routing, and offer transitions.
- [x] Simulate sparse/dense supply and contention.
- [x] Establish safe worker concurrency and rate limits.

### `D8.5` Security and Abuse Review

- [x] Review authorization, IDOR, replay, spoofed location, rate limits, and denial-of-service surfaces.
- [x] Add adversarial tests.

### `D8.6` Data Retention and Privacy Review

- [x] Approve location retention and access.
- [x] Verify deletion/retention jobs.
- [x] Document operational access controls.

### `D8.7` SLOs and Runbooks

- [x] Define service indicators/objectives.
- [x] Write incident, reconciliation, provider outage, queue backlog, and rollback runbooks.

## Exit Gate

Approved load, failure, security, privacy, alerting, and runbook evidence exists.
