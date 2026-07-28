# Phase 4 - Candidate Discovery and Routing

## Goal

Produce a deterministic ranked candidate list without reserving drivers or creating offers.

## Tasks

### `D4.1` Candidate Policy

- [x] Encode approved eligibility, freshness, radius/ring, exclusion, and limit rules.
- [x] Define deterministic tie breakers.
- [x] Define fairness inputs, if any.
- [x] Add pure policy tests.

### `D4.2` Redis/H3 Coarse Discovery

- [x] Query only fresh online candidates.
- [x] Expand rings according to validated search policy.
- [x] Never let ring configuration silently contradict radius.
- [x] Add boundary and sparse/dense supply tests.

### `D4.3` Durable/Exact Revalidation

- [x] Batch-load durable eligibility/state.
- [x] Apply exact PostGIS distance/service-area checks.
- [x] Exclude previously offered drivers for the request where approved.
- [x] Test stale Redis entries and concurrent state changes.

### `D4.4` Routing Provider Interface and Fake

- [x] Define application-owned batch estimate contract.
- [x] Represent routed, unreachable, and provider-failure outcomes explicitly.
- [x] Prevent provider failure from becoming `no_driver_found`.
- [x] Add deterministic fake for unit/integration tests.

### `D4.5` Gebeta Maps Adapter

- [x] Implement only against approved D0.3 findings.
- [x] Use Matrix only; enforce at most nine candidate origins plus pickup per request.
- [x] Use Bearer authentication, strict response validation, configurable 3-second timeout, and no adapter-level retry.
- [x] Add contract tests for all provider outcomes.
- [ ] Add bounded concurrency, timeout, rate-limit, and metrics behavior.

### `D4.6` Route-Based Ranking

- [x] Rank by approved ETA/distance/fairness rules.
- [x] Preserve deterministic ordering.
- [x] Do not reserve or mutate drivers.
- [x] Test provider partial results and fallback policy.
- [x] Never rank candidates using a synthetic or silently degraded route estimate.

### `D4.7` Metrics and Failure Policy

- [x] Candidate counts at each filter stage.
- [x] Discovery/routing latency.
- [x] Provider source/failure/fallback metrics.
- [x] Bounded concurrency, timeout, and rate-limit behavior for routing provider calls.
- [x] Clear retry/defer/no-driver behavior.

## Exit Gate

Given a request and controlled presence/provider data, candidate ranking is deterministic, measured, and side-effect-free.
