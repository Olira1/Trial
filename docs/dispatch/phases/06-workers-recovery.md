# Phase 6 - Durable Workers, Notifications, and Recovery

## Goal

Make matching progress and side effects survive crashes, retries, and provider failures.

## Tasks

### `D6.1` Outbox-to-Queue Publication

- [x] Claim/publish events safely across multiple publishers.
- [x] Use deterministic job IDs.
- [x] Mark publication without losing committed intent.
- [x] Test crashes before/after queue publication.

### `D6.2` Match Worker

- [x] Load approved config and invoke orchestration idempotently.
- [x] Classify retryable/non-retryable errors.
- [x] Add bounded retries/backoff and correlation logging.

### `D6.3` Delayed Offer Expiration

- [x] Schedule deterministic delayed jobs from committed offer events.
- [x] Make duplicate/late jobs harmless.
- [x] Recover missing jobs through reconciliation.

### `D6.4` FCM Dispatch Notifications

- [x] Reuse existing notification delivery behind a dispatch port.
- [x] Keep notification outside state-change transactions.
- [x] Retry safely and record delivery outcome/metrics.

### `D6.5` Rematch and Exhaustion

- [x] Apply approved total deadline/candidate exhaustion policy.
- [x] Avoid tight retry loops and repeated offers to the same driver.
- [x] Produce approved terminal outcome.

### `D6.6` Reconciliation Worker

- [x] Detect all mismatches listed in `operations.md`.
- [x] Repair only unambiguous cases.
- [x] Alert on ambiguous corruption.
- [x] Test idempotency and multi-instance locking.

### `D6.7` Failed-Job Operations

- [x] Expose safe inspection/retry/cancel procedures.
- [x] Document dead-letter handling and alerts.

## Exit Gate

Crash/retry/restart exercises prove requests and offers continue or terminate correctly without manual database edits.
