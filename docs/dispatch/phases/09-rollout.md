# Phase 9 - Controlled Rollout

## Goal

Introduce Instant Ride dispatch gradually with immediate stop/recovery capability.

## Tasks

### `D9.1` Feature Flags and Kill Switches

- [x] Disable new requests independently from workers.
- [x] Stop new offers while safely resolving existing state.
- [ ] Configure geography/allowlist/hours.
- [x] Test kill-switch behavior.

Note:

- Geography, allowlist, and time-window rollout scope moves to `D9.3` and
  `D9.4`, which own the actual staged rollout boundaries.

### `D9.2` Shadow Ranking

- [x] Run discovery/ranking without driver offers.
- [x] Compare supply, latency, route quality, and exclusions.
- [x] Resolve anomalies before live offers.

### `D9.3` Internal Allowlisted Dispatch

- [x] Use controlled riders/drivers.
- [x] Exercise full lifecycle and operations.
- [x] Review every failure and reconciliation action.

### `D9.4` Limited Geography/Hours

- [x] Restrict rollout and monitor metrics/alerts.
- [x] Maintain explicit rollback threshold.

### `D9.5` Rollout Evaluation

- Compare SLOs and product outcomes against approval thresholds.
- Review incidents, provider costs, queue behavior, and support burden.

Note:

- This task requires real controlled-rollout observations; it is not satisfiable
  from local implementation work alone.

### `D9.6` Beta Expansion Approval

- Require explicit product/engineering approval.
- Update product docs, runbooks, and status.

Note:

- This task requires human approval after `D9.5` evidence exists.

## Exit Gate

The system has demonstrated stable controlled operation and has an approved beta-expansion decision.
