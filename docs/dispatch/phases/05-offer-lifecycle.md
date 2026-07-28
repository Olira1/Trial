# Phase 5 - Sequential Offer Lifecycle

## Goal

Safely coordinate one request, one selected driver, and one pending offer under concurrency.

## Tasks

### `D5.1` Dispatch Attempt and Offer Schemas

- [x] Add attempt/offer identity, state, ranking snapshot, deadlines, and audit fields.
- [x] Add partial unique indexes/constraints for sequential pending offers.
- [x] Prove invariants with integration tests.

### `D5.2` Request-Safe Match Orchestration

- [x] Make duplicate match jobs harmless.
- [x] Separate candidate/routing work from reservation transaction.
- [x] Recheck request before and during final transaction.

### `D5.3` Atomic Reservation and Offer Creation

- [x] Lock/predicate request and driver state.
- [x] Revalidate eligibility/freshness according to approved policy.
- [x] Reserve driver, create offer, transition request, and write outbox events atomically.
- [x] Continue to next candidate safely when reservation loses a race.

### `D5.4` Offer Acceptance

- [x] Authenticate owning driver.
- [x] Reject expired, cancelled, wrong-driver, or stale offers.
- [x] Atomically accept offer, assign request/driver, and write handoff/events.
- [x] Make duplicate acceptance behavior explicit and tested.

### `D5.5` Offer Rejection

- [x] Authenticate owning driver.
- [x] Atomically reject, release driver, transition request, and write rematch intent.
- [x] Define duplicate/conflicting response behavior.

### `D5.6` Offer Expiration

- [x] Atomically expire only still-pending past-deadline offers.
- [x] Release only the driver reserved by that offer.
- [x] Transition/rematch only the same request state.

### `D5.7` Cancellation Interaction

- [x] Resolve pending offer and driver reservation atomically with request cancellation.
- [x] Prove accept-versus-cancel winner semantics.

### `D5.8` Mandatory Concurrency Suite

- [x] Execute every race listed in `state-machines.md`.
- [x] Repeat races enough to catch non-deterministic failures.
- [x] Review query plans/locks and document deadlock handling.

## Exit Gate

The concurrency suite passes and no documented path can leave request, driver, and offer states inconsistent.
