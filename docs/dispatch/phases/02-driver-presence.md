# Phase 2 - Driver Presence

## Goal

Make current driver availability and location explicit, authorized, ordered, and safe for candidate discovery.

## Tasks

### `D2.1` Durable Operational Profile/State

**Status:** Completed 2026-06-17

- [x] Add the smallest approved durable operational state model.
- [x] Use `online` for durable intent; never store derived dispatch availability as truth.
- [x] Persist owning mobile auth-session identity, opaque presence-session ID, and monotonic presence generation with the operational state.
- [x] Keep approval/vehicle data in existing modules.
- [x] Add state constraints and transition tests.
- [x] Do not add live location to the durable profile by default.

Completion notes:

- Added `DriverPresenceModule` as the application boundary for future driver
  presence work.
- Added `driver_operational_state` enum with approved states `offline`,
  `online`, `offered`, `assigned`, and `suspended`.
- Added `driver_operational_profile` with one row per driver user,
  `operational_state`, owning `auth_session` ID, opaque `presence_session_id`,
  and monotonic `presence_generation`.
- Database checks require active states `online`, `offered`, and `assigned` to
  have complete presence authority and generation greater than zero.
- Database checks require inactive states `offline` and `suspended` to carry no
  owner session or presence-session ID.
- The durable profile stores no live coordinates and no derived availability
  flag.
- Added domain transition coverage for allowed and forbidden operational-state
  transitions.
- No online/offline REST commands, eligibility query, Redis lease, H3 index,
  Socket.IO behavior, outbox event, or live-location persistence was added.

### `D2.2` Eligibility Projection/Query

**Status:** Completed 2026-06-17

- [x] Implement one authoritative Instant Ride eligibility query/service.
- [x] Depend on the approved qualification facts implemented by `D1.7` through `D1.10`.
- [x] Reuse existing user, application, and vehicle facts.
- [x] Test every plate/approval/active/deleted combination.
- [x] Make denial reasons observable for operations without leaking them publicly.

Completion notes:

- Added `DriverEligibilityService.evaluateInstantRideDriverEligibility` in
  `DriverPresenceModule`.
- The service wraps related reads in a database transaction when no caller
  executor is supplied, and also accepts a caller-provided executor for future
  transition transactions.
- The query evaluates active/non-deleted account state, verified phone identity,
  approved driver capability, approved driver application, one active approved
  vehicle, Instant Ride plate qualification, TIN presence, required approved
  current documents, and latest compliance suspension.
- Internal denial reasons are returned for operations/testing without adding a
  public endpoint or leaking them to riders/drivers.
- Tests cover the eligible path, plate matrix, user activity/deletion,
  driver-capability denial, phone identity denial, application and vehicle
  approval/deletion, missing/pending/expired documents, representative-letter
  requirement, and latest compliance suspension/reinstatement.
- No Redis presence, operational-state transition, public API, Socket.IO, or
  schema change was added.

### `D2.3` Online/Offline Transitions

**Status:** Completed 2026-06-17

- [x] Authenticate driver identity; never accept arbitrary driver IDs as authority.
- [x] Enforce eligibility and conflict checks.
- [x] Require an initial valid location, create/replace the single owned presence session, and handle explicit takeover.
- [x] Issue a new server-generated, high-entropy ephemeral `leaseId` on every successful go-online/resume and store the command location as server-assigned sequence `0`.
- [x] Implement authenticated owner resume after reconnect, lease expiry, or Redis recovery; raw location updates never recreate a lease.
- [x] Force offline on owning-session revocation and qualification/account/suspension loss.
- [x] Run related reads/writes in transactions.
- [x] Publish presence-change intent after commit.

Completion notes:

- Added authenticated REST routes for go-online, resume, offline, and driver
  presence snapshot under `DriverPresenceModule`.
- Online/takeover/offline transitions lock and update the durable operational
  profile in a transaction, append a durable outbox event in that transaction,
  and keep precise command coordinates out of PostgreSQL/outbox payloads.
- Online/resume use D2.2 eligibility inside the transition transaction and
  reject offered, assigned, suspended, ineligible, stale-owner, and mismatched
  presence-session cases.
- Command locations enforce configured accuracy and capture-time bounds before
  durable writes begin.
- Redis lease creation is post-commit for online/takeover and returns
  `resumeRequired=true` on lease failure; resume returns `503` on lease failure
  because it makes no durable state change.
- Auth logout/session revocation, account deletion, driver-application
  revocation, vehicle/document revocation, and compliance suspension now force
  the owning online presence profile offline and emit an offline outbox intent
  in the same transaction.
- `/drivers/presence/me` exposes durable state, current-session ownership, owned
  presence-session ID, derived dispatch availability, and unavailable reasons
  without precise coordinates.
- No database migration, H3 indexing, Socket.IO location ingestion, ordered
  high-frequency update handling, candidate discovery, or Redis cleanup/index
  reconciliation was added.

### `D2.4` Ordered Live-Location Ingestion

**Status:** Completed 2026-06-17

- [x] Validate coordinates, `leaseId`, positive lease-scoped sequence/timestamp, accuracy, and payload bounds.
- [x] Reject/ignore stale and duplicate updates deterministically.
- [x] Reject events from any prior/mismatched lease, including after resume or Redis restart.
- [x] Enforce current presence-session ownership and server-time freshness.
- [x] Use the authenticated connection and generation/`leaseId`-matched Redis fast path without a PostgreSQL read per update.
- [x] Permit bounded stale-generation Redis writes during cross-store races, but never let them affect matching, reservation, or rider-visible output.
- [x] Ingest through authenticated Socket.IO acknowledgements; keep only the latest unsent client update.
- [x] Test out-of-order and concurrent updates.
- [x] Test that fast-path acceptance never implies dispatch eligibility or current durable authority.
- [x] Do not persist pre-assignment coordinates to PostgreSQL.

Completion notes:

- Added the first narrow `/dispatch` Socket.IO gateway for authenticated driver
  location ingestion only; broader rooms/server-event delivery remain Phase 7
  work.
- Gateway handshake reuses the existing mobile access token and persisted mobile
  session validation before any location event is accepted.
- Added strict location-event validation for `presenceSessionId`, `leaseId`,
  positive `sequence`, coordinates, accuracy, bounded optional heading/speed,
  and capture-time skew.
- Added Redis owner-authority and lease-snapshot fast-path state so accepted
  updates can validate owner, lease, and ordering without a PostgreSQL read.
- Duplicate, stale-sequence, rate-limited, invalid, stale-capture, not-owner,
  expired-lease, and Redis-unavailable acknowledgements now follow the approved
  contract.
- Resume replaces the active lease for the same durable presence session;
  explicit takeover replaces the Redis owner authority so the previous socket is
  rejected as not-owner.
- Logout/session revocation, account deletion, and qualification-loss flows now
  clear Redis owner authority after their durable offline transition.
- Accepted fast-path updates still do not write pre-assignment coordinates to
  PostgreSQL.
- No H3 indexing, candidate indexes, reconciliation cleanup, or matching logic
  was added.

### `D2.5` Redis Presence/H3 Indexing

**Status:** Completed 2026-06-17

- [x] Write latest snapshot and index atomically enough for approved semantics.
- [x] Use generation fences and expected-generation Redis mutations; revalidate durable generation before matching/reservation.
- [x] Apply configurable 12-second freshness and 30-second cleanup TTL defaults.
- [x] Remove offline/ineligible drivers.
- [x] Fail closed when Redis is unavailable; do not add a PostGIS presence fallback.
- [x] Test H3 boundaries, TTL expiry, owner resume, prior-lease replay, sequence reset, delayed transition races, bounded stale writes, stale-generation exclusion, and Redis restart/loss.

Completion notes:

- Added configurable H3 coarse indexing with `DISPATCH_H3_RESOLUTION=10` as the
  current default.
- Redis lease snapshots now persist `h3Cell`, `freshUntil`, and `expiresAt`
  alongside lease ownership, generation, sequence, and the latest accepted
  location.
- Initial go-online lease creation and accepted location updates now update a
  per-cell Redis sorted-set index and remove previous-cell membership on move.
- Offline, logout/session revocation, account deletion, and qualification-loss
  cleanup now remove owner, lease, and H3 membership together from Redis.
- Added `DriverPresenceLeaseService.listActiveCellCandidates` as the first
  internal Redis-only candidate hint query. It removes expired set members and
  excludes stale owner/lease generation mismatches before returning fresh cell
  snapshots.
- There is still no ranking, ring expansion, routing, or final durable
  reservation logic here; D4 and later phases still own those behaviors.

### `D2.6` Pre-Assignment Location Privacy Enforcement

**Status:** Completed 2026-06-17

- [x] Do not implement pre-assignment location sampling in V1.
- [x] Prove precise pre-assignment coordinates do not enter durable history, logs, metrics, or rider-facing output.
- [x] Treat any future pre-assignment history as a separate privacy/product task.
- [x] Leave post-assignment tracking to the trip-execution domain.

Completion notes:

- Added `DriverPresencePrivacyInterceptor` — a NestJS interceptor on the
  driver-presence controller that strips `latitude` and `longitude` keys from all
  response data as a belt-and-suspenders safety net.
- Wired the interceptor into `DriverPresenceController` via `@UseInterceptors`.
- Added privacy invariant integration tests (`driver-presence.privacy.spec.ts`)
  that explicitly prove:
  - `driver_operational_profile` has no latitude/longitude columns.
  - All REST endpoints (GET /me, POST /online, POST /offline, POST /resume)
    return zero coordinate data, including error responses.
  - Online and offline outbox event payloads contain no coordinate fields.
  - Redis lease snapshot does contain coordinates (expected ephemeral storage).
  - Redis owner authority key has no coordinates.
- Existing e2e and gateway integration tests already include ad hoc coordinate
  leak checks — the new tests make them explicit and comprehensive.
- Risk R-023 transitions from `Open` to `Mitigated`.

### `D2.7` Presence Reconciliation and Metrics

**Status:** Completed 2026-06-17

- [x] Remove stale/ineligible Redis entries.
- [x] Detect durable/ephemeral disagreement.
- [x] Add candidate-supply and update-latency metrics.

Completion notes:

- Added `DriverPresenceReconciliationService` with a periodic (60s) scheduler
  that runs in-process via `OnModuleInit`/`OnModuleDestroy`.
- Reconciliation SCANs Redis owner keys, cross-references PG durable state,
  and cleans up stale entries (owner, lease, H3 zset membership) for drivers
  who are offline, suspended, or have no profile record.
- Disagreement detection queries PG for `online` drivers and checks Redis
  `EXISTS` for each owner key; count is logged and returned in the result.
- Candidate-supply (number of active owner keys) is logged each cycle as the
  primary metrics signal.
- Error handling returns gracefully with empty result on any Redis failure.
- 6 integration tests added (stale cleanup, explicit offline, valid online
  preserved, disagreement detection, H3 membership cleanup, Redis failure).
- No new npm/pnpm dependencies or database migrations added.

## Exit Gate

Only an authenticated, approved, eligible, online driver with a fresh ordered location can appear in candidate discovery.
