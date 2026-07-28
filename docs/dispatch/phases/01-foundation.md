# Phase 1 - Foundation

## Goal

Create the infrastructure, test foundations, and trustworthy durable eligibility facts needed for later dispatch work.

## `D1.1` PostGIS-Capable Local/Test Infrastructure

**Status:** Completed 2026-06-14

- [x] First test: clean integration environment can execute a PostGIS function.
- [x] Change Docker database image/version only after production compatibility is approved.
- [x] Add health/readiness verification for PostGIS.
- [x] Prove existing migrations still apply.
- [x] Do not add dispatch schemas yet.

Completion notes:

- Local/test database image is `postgis/postgis:18-3.6`.
- PostGIS is enabled by migration `0016_enable_postgis`.
- `DatabaseHealthIndicator` checks `PostGIS_Version()` so readiness fails closed when the extension is unavailable.
- Clean migration was verified against temporary database `ubel_d1_1_clean_migration`, then the temporary database was removed.
- The selected image has no local ARM64 manifest in this environment; compose pins `platform: linux/amd64` for local compatibility.

## `D1.2` Spatial Schema Conventions

**Status:** Completed 2026-06-14

- [x] Decide `geometry` versus `geography` per durable field.
- [x] Require SRID 4326.
- [x] Define index conventions and exact query/index compatibility.
- [x] Add migration smoke tests.
- [x] Document coordinate order.

Completion notes:

- Dispatch database points use PostGIS `longitude, latitude` order and SRID `4326`.
- Durable rider pickup/destination points default to `geography(Point,4326)`.
- `geometry(Point,4326)` requires explicit task-level justification.
- Spatial predicate indexes default to GiST and must match the query expression.
- Baseline PostGIS convention smoke coverage lives in `src/database/spatial-conventions.integration.spec.ts`.
- No dispatch production tables were added.

## `D1.3` Dispatch Integration-Test Harness

**Status:** Completed 2026-06-14

- [x] Add isolated database/Redis fixture strategy.
- [x] Support concurrency tests with independent connections.
- [x] Add deterministic cleanup.
- [x] Ensure tests fail clearly when infrastructure is unavailable.

Completion notes:

- Dispatch integration harness lives in `test/dispatch-integration-harness.ts` and is excluded from production build output.
- Harness verifies PostgreSQL/PostGIS and Redis readiness with explicit dependency failure messages.
- Harness exposes independent PostgreSQL clients for future concurrency tests.
- Harness supports rollback-scoped database work for deterministic cleanup.
- Harness creates namespaced Redis keys and cleans only keys in its own namespace.
- Existing non-dispatch tests were not refactored.

## `D1.4` Typed Dispatch Configuration

**Status:** Completed 2026-06-15

- [x] Add validated configuration namespace.
- [x] Include only approved parameters.
- [x] Test defaults, bounds, and invalid combinations.
- [x] Services must not read raw `process.env`.

Completion notes:

- Typed dispatch configuration lives in `src/config/dispatch.config.ts` under
  the `dispatch` namespace.
- `validateEnv` now owns approved V1 dispatch defaults and rejects invalid
  bounds or unsafe cross-field combinations at startup.
- Approved dispatch environment variables are documented in `.env.example`.
- No dispatch service, schema, API, event, queue, or worker implementation was
  added.

## `D1.5` Queue and Worker Foundation

**Status:** Completed 2026-06-16

- [x] Select/configure BullMQ or approved equivalent.
- [x] Add Nest lifecycle-managed queue connections.
- [x] Define queue names, job identity, retries, backoff, and shutdown.
- [x] Add integration tests for duplicate job identity and worker restart.

Completion notes:

- D1.5 uses BullMQ directly behind the application-owned
  `DispatchQueueModule`; dispatch domain code should depend on this module's
  small service surface rather than BullMQ types where possible.
- Queue resources are created lazily and closed explicitly through Nest
  lifecycle hooks.
- Dispatch queue names and deterministic job ID helpers are covered by unit
  tests.
- Redis-backed integration tests prove duplicate job identity and worker restart
  behavior.
- No outbox schema, outbox publisher, match orchestration, offer-expiration
  handler, notification worker, reconciliation worker, or worker bootstrap
  command was added.

## `D1.6` Transactional Outbox Foundation

**Status:** Completed 2026-06-16

- [x] Add minimal outbox schema and unique identity.
- [x] Add service API that requires a transaction.
- [x] Add publisher skeleton and idempotency behavior.
- [x] Test commit/rollback, duplicate publish, and crash-after-publish scenarios.

Completion notes:

- Added `dispatch_outbox_event` with `event_id` primary identity and
  `event_key` unique idempotency identity.
- `DispatchOutboxService.append` requires a `DBTransaction` and is covered by
  commit/rollback integration tests.
- `DispatchOutboxPublisherService` enqueues deterministic outbox-publish jobs
  through `DispatchQueueService`, marks publication with an atomic update after
  enqueue, and can scan unpublished events for restart recovery.
- Integration tests cover duplicate publish and crash-after-enqueue before
  marking publication.
- No domain event producer, match orchestration, notification worker, realtime
  publisher, multi-publisher claiming, or reconciliation worker was added.

## `D1.7` Account Activity and Driver-Capability Authorization

**Status:** Completed 2026-06-17

- [x] Make active/deleted account predicates consistent across authentication and authorization.
- [x] Preserve dual rider/driver capability without self-granting approved driver capability.
- [x] Define signup intent separately from approved driver capability.
- [x] Add authorization and inactive-account tests.

Completion notes:

- Authentication start/verify, refresh, mobile session validation, session guard,
  and admin session guard paths now require active, non-deleted users.
- New and restarted signups store rider/driver signup intent in
  `user.signup_intent` while keeping effective signup capability as rider.
- `UserService.updateProfile` preserves existing rider/driver capability arrays
  when the legacy role input is supplied.
- Migration `0018_strong_master_chief.sql` adds the signup-intent enum/column
  and backfills existing rider/driver rows without changing roles.
- No dispatch APIs, presence state, driver qualification workflows, or driver
  capability grants were added.

## `D1.8` Audited Driver Qualification Approval and Suspension

**Status:** Completed 2026-06-17

- [x] Implement driver application submit/review/approve/reject/revoke workflows.
- [x] Add auditable actor, timestamp, reason, and history.
- [x] Model compliance suspension separately from account and operational state.
- [x] Add authorization, transition, idempotency, and concurrency tests.

Completion notes:

- `DriverService` now owns transaction-scoped submit, approve, reject, revoke,
  suspend, and reinstate qualification methods.
- Approved applications grant `driver` capability; revocation removes it; rejection
  leaves capability unchanged.
- Application review history is written to `driver_application_audit`.
- Compliance suspension is recorded independently in `driver_compliance_event`
  and does not mutate account activity.
- `driver_application.status` now includes `revoked`.
- No dispatch APIs, ride-request workflows, or vehicle approval workflow were added.

## `D1.9` Document Qualification Model

**Status:** Completed 2026-06-17

- [x] Associate qualification documents with the relevant driver application/vehicle.
- [x] Add manual review status, reviewer, timestamps, reason, expiry, and revocation.
- [x] Enforce the approved Instant Ride qualification document requirements.
- [x] Ensure replacement cannot silently inherit approval from the prior document.

Completion notes:

- `document` rows now store `driver_application_id`, `vehicle_id`,
  `review_status`, reviewer metadata, `expires_at`, and `revoked_at`.
- `document_audit` records approved, rejected, and revoked decisions with actor,
  timestamp, reason, and expiry context.
- Document review methods lock the document row and run in one transaction.
- Driver license, Bolo, third-party insurance, and trade license approvals
  require expiry.
- Initial registration and replacement validate authenticated-user storage-key
  ownership and always insert a new pending row.
- Admin document review endpoints are exposed under the existing guarded admin
  controller.
- Existing profile verification flags now ignore pending, expired, and revoked
  documents.

## `D1.10` Active Vehicle and Vehicle Qualification Invariants

**Status:** Completed 2026-06-17

- [x] Enforce one active selected vehicle per driver in V1 at the database level.
- [x] Normalize and uniquely identify plates using region, code, and number.
- [x] Add database constraints for plate subtype and conditional TIN requirements.
- [x] Add audited vehicle approval/revocation and concurrency tests.

Completion notes:

- Non-deleted vehicles are limited to one active selected row per driver by
  `vehicle_uq_active_user_id`.
- Vehicle plate numbers are normalized before persistence by trimming,
  uppercasing, and removing spaces/hyphens.
- Active plate identity is unique by `plate_region`, `plate_code`, and
  normalized `plate_number`.
- Database checks enforce code `03` subtype presence, disallow subtype for
  other plate codes, and require non-blank TIN for code `01` and code `03`
  `transport_service`.
- Vehicle approval, rejection, and revocation run in transactions, lock the
  vehicle row, require an active admin, and write `vehicle_audit` rows.
- Admin vehicle review endpoints are exposed under the existing guarded admin
  controller.
- No dispatch runtime, Redis, queue, Socket.IO, or outbox behavior was added.

## `D1.11` Mobile Session Device Binding

**Status:** Completed 2026-06-17

- [x] Persist the relevant device identity on each mobile authentication session.
- [x] Expose session/device identity only after successful session validation.
- [x] Preserve multiple legitimate user sessions without relying on `user.deviceId` as the current-session owner.
- [x] Add login, refresh, logout, revocation, and authorization tests.

Completion notes:

- `auth_session.device_id` stores the validated mobile device identity for
  signup, OTP login, and password login sessions.
- Admin cookie sessions keep `device_id=null`; the mobile `SessionGuard` is the
  path that exposes persisted session/device identity.
- `SessionGuard` validates the access token, active persisted session, and active
  user before attaching `sessionId` and `deviceId` to the request.
- Access-token refresh keeps the same persisted session ID and device binding.
- Logout/revocation invalidates the targeted refresh-token session without
  invalidating other legitimate sessions for the same user.
- `user.deviceId` may still be updated for existing compatibility, but dispatch
  presence ownership must use the authenticated session ID and
  `auth_session.device_id` instead.
- No presence tables, Redis behavior, Socket.IO gateway, or offline-on-logout
  transition was added.

## `D1.12` Redis Readiness and Failure Signaling

**Status:** Completed 2026-06-17

- [x] Add Redis health/readiness behavior suitable for fail-closed presence and matching.
- [x] Distinguish startup/readiness failure from runtime dependency degradation.
- [x] Add integration tests for unavailable, recovered, and shutdown Redis connections.
- [x] Define operational signals without logging secrets or live coordinates.

Completion notes:

- `RedisHealthIndicator` uses the existing application `REDIS_CLIENT` and
  requires a `PONG` response before reporting `up`.
- The health indicator reports Redis as `down` when the client is not ready,
  when ping fails, when ping returns an unexpected response, or after shutdown.
- Failure messages are bounded operational signals and do not include Redis host,
  port, password, coordinates, or raw exception text.
- `/api/v1/health` now checks both PostgreSQL/PostGIS and Redis readiness.
- Tests cover healthy, unavailable, connecting, recovered, unexpected-response,
  shutdown, and HTTP readiness response cases.
- No presence keys, H3 indexes, Socket.IO behavior, queues, or database schema
  changes were added.

## Exit Gate

- Clean schema migration succeeds with PostGIS.
- Existing test suite remains green.
- Real PostgreSQL/Redis integration harness works.
- Queue and outbox foundations have failure/retry tests.
- Durable driver qualification facts satisfy [driver-eligibility.md](../driver-eligibility.md).
- Mobile sessions can securely own presence sessions, and Redis failure is observable before presence implementation.
