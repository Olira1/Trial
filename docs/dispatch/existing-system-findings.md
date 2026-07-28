# Existing-System Findings Related to Dispatch

These findings are not automatically authorized changes. Each must be debated, scoped, and approved as its own task or incorporated explicitly into a dispatch roadmap task.

## Resolved Findings

### ESF-001 - PostgreSQL Docker Image Lacks PostGIS

**Observation:** `docker-compose.yml` used `postgres:18-alpine`, while product architecture and dispatch spatial work require PostGIS.

**Impact:** PostGIS migrations and integration tests cannot run on the current local database image.

**Recommended handling:** Resolve during `D1.1` with a production-compatible PostGIS image/version and migration verification.

**Decision/status:** Resolved in `D1.1`. Local/test PostgreSQL now uses
`postgis/postgis:18-3.6`, PostGIS is enabled through migration
`0016_enable_postgis`, health readiness checks PostGIS, and clean migration plus
spatial smoke tests passed.

### ESF-009 - Inactive Accounts Can Retain Authenticated Access

**Observation:** Authentication and session checks consistently excluded deleted
users but did not consistently require `user.isActive=true`.

**Impact:** Administratively deactivated users could retain or refresh access
and attempt dispatch actions.

**Recommended handling:** Resolve through `D1.7` before dispatch authorization
depends on account activity.

**Decision/status:** Resolved in `D1.7`. Login identity lookup, credential
authentication, refresh, mobile session validation, session guard, admin login,
and admin session guard paths now require active, non-deleted users.

### ESF-010 - Driver Role Is Self-Declared and Overwrites Other Capability

**Observation:** Signup/profile logic stored exactly one selected role even
though the schema supports multiple roles. Driver role selection was not tied to
approval.

**Impact:** Role data could not safely represent dual rider/driver capability
or approved driver qualification.

**Recommended handling:** Separate signup intent from approved capability in
`D1.7`.

**Decision/status:** Resolved in `D1.7` for signup intent and role preservation.
New and restarted signups store rider/driver intent in `user.signup_intent`,
keep signup capability as rider, and profile role updates preserve existing
dual rider/driver capability. Approved driver grant/revoke workflows remain
assigned to `D1.8`.

### ESF-007 - Uploaded Documents Are Misrepresented as Verified

**Observation:** Documents had no application/vehicle ownership, review status,
reviewer, expiry, rejection, or revocation. Existing profile flags labelled
upload presence as verification.

**Impact:** A stale, rejected, unrelated, or expired upload could be treated as
qualification evidence.

**Recommended handling:** Implement `D1.9`; rename or correct misleading
verification behavior through an explicitly approved compatibility plan.

**Decision/status:** Resolved in `D1.9`. Documents now store application/vehicle
ownership, manual review status, reviewer metadata, expiry, revocation, and
audited review history. Profile verification flags count only approved,
unexpired, non-revoked documents.

### ESF-011 - Initial Document Registration Does Not Validate Storage-Key Ownership

**Observation:** Document replacement validated that a storage key belonged to
the authenticated user and document type, but initial document registration did
not.

**Impact:** A user who obtained another object's key could register it as their
own qualification document.

**Recommended handling:** Include ownership validation and security regression
tests in `D1.9`.

**Decision/status:** Resolved in `D1.9`. Initial document registration and
replacement both require storage keys scoped to
`documents/{authenticatedUserId}/{documentType}/`.

### ESF-003 - Vehicle Schema May Not Fully Encode Ride-Hailing Eligibility

**Observation:** Product eligibility depends on Ubel approval and plate
qualification. The vehicle model lacked database-enforced active selection,
normalized composite plate identity, audited approval, and conditional
subtype/TIN constraints.

**Impact:** A driver might be approved for onboarding but not deterministically
eligible for Instant Ride.

**Recommended handling:** Resolve through approved task `D1.10`.

**Decision/status:** Resolved in `D1.10`. Non-deleted vehicles are limited to
one active row per driver, plate identity is normalized and unique by region,
code, and number, subtype/TIN rules are database-enforced, and vehicle
approval/rejection/revocation is audited in `vehicle_audit`.

### ESF-006 - Driver Application and Vehicle Approval Fields Are Inert

**Observation:** `driver_application` and `vehicle.isApproved` existed, but
there was no application submission/review/revocation workflow and no audited
vehicle approval workflow.

**Impact:** Approval could not be trusted or audited and required direct
database mutation.

**Recommended handling:** Implement approved qualification workflows through
`D1.8` and `D1.10`.

**Decision/status:** Resolved across `D1.8` and `D1.10`. Driver application
approval/rejection/revocation and compliance suspension were implemented in
`D1.8`; vehicle approval/rejection/revocation was implemented in `D1.10`.

### ESF-008 - Active Vehicle Limit Is Race-Prone

**Observation:** Vehicle registration checked for an existing active vehicle
and then inserted without a database uniqueness invariant.

**Impact:** Concurrent requests could create multiple active vehicles for one
driver.

**Recommended handling:** Resolve with a database invariant and concurrency
test in `D1.10`.

**Decision/status:** Resolved in `D1.10`. `vehicle_uq_active_user_id` enforces
one non-deleted active vehicle per driver, and integration coverage proves the
database rejects a second active row while allowing replacement after soft
deletion.

### ESF-012 - Mobile Sessions Are Not Bound to Device Identity

**Observation:** `AuthenticatedRequest` declared `deviceId`, but
`SessionGuard` did not set it. `auth_session` stored no device identity, while
`user.deviceId` represented only the most recently logged-in device.

**Impact:** Driver presence could not securely prove which authenticated
device/session owns the single live-location publication lease. Device
takeover, logout, revocation, and rejected-owner behavior would be unreliable.

**Recommended handling:** Implement approved foundation task `D1.11` before
presence ownership implementation.

**Decision/status:** Resolved in `D1.11`. Mobile signup, OTP login, and
password login sessions persist `auth_session.device_id`; refresh remains bound
to the same session; logout/revocation target one session; and `SessionGuard`
attaches `sessionId` and `deviceId` only after token, persisted-session, and
active-user validation pass.

### ESF-013 - Health Checks Do Not Cover Redis

**Observation:** The existing health endpoint checked PostgreSQL but not Redis.

**Impact:** Instances could remain ready while location ingestion and matching
must fail closed, causing avoidable request failures and unclear operational
diagnosis.

**Recommended handling:** Implement approved foundation task `D1.12` before
presence rollout.

**Decision/status:** Resolved in `D1.12`. `/api/v1/health` now checks
PostgreSQL/PostGIS and Redis readiness. Redis readiness requires `PONG`,
reports non-ready startup states, failed pings, unexpected ping responses, and
shutdown clients as `down`, and returns bounded messages without Redis
connection details or live-location data.

### ESF-002 - Existing Driver Domain Does Not Represent Operational Driver State

**Observation:** Existing `DriverModule` owned onboarding, applications,
documents, and vehicles. There was no operational driver/presence model.

**Impact:** Dispatch must not overload application approval or vehicle tables
with live operational state.

**Recommended handling:** Preserve current module ownership and introduce a
separate presence/operational projection.

**Decision/status:** Resolved in `D2.1` for the durable operational state
foundation. `DriverPresenceModule` now owns `driver_operational_profile`, which
stores approved operational state, owning auth-session identity, opaque
presence-session ID, and presence generation without live coordinates or
derived availability. Eligibility projection, online/offline transitions, and
Redis-backed live presence remain separate D2 tasks.

### ESF-015 - Approved Dispatch REST Contracts Were Not Mounted

**Observation:** Request creation/query/cancellation had a mounted
`ride-requests` controller, but the current-request route was absent. Offer
acceptance and rejection existed only as internal services, and the approved
offer REST routes had no controller. The API contract also named
`instant-rides` paths that did not match the repository's mounted route style.

**Impact:** Mobile clients could receive realtime offer/request events but
could not recover current state or submit accept/reject commands through the
documented REST surface.

**Recommended handling:** Expose the existing ownership-scoped query and
transaction-safe command services through authenticated, strictly serialized
REST controllers without expanding into fare or trip execution.

**Decision/status:** Resolved in the approved `D3.6/D5.4/D5.5` corrective
follow-up. Current rider request and driver offer endpoints are mounted, offer
accept/reject delegate to the existing transactional services, and the API
contract now uses the actual mounted paths.

### ESF-016 - Document Uploads Did Not Submit Driver Qualification

**Observation:** Driver onboarding document uploads persisted `document` rows,
but the live driver/mobile flow never created or reopened `driver_application`
rows. Vehicle-scoped uploads that arrived before vehicle registration could
also remain detached with `vehicle_id=NULL`.

**Impact:** Admin surfaces could show `not_submitted` despite visible uploaded
documents, qualification review required direct SQL intervention, and
eligibility facts were incomplete until repaired manually.

**Recommended handling:** Keep the existing mobile document-upload flow, but
make upload/replacement implicitly submit qualification and relink deferred
vehicle-scoped uploads when the vehicle is later registered.

**Decision/status:** Resolved in the approved onboarding corrective task on
2026-06-24. `POST /drivers/documents` and `PUT /drivers/documents/:documentType`
now create a pending driver application on first upload, reopen
rejected/revoked applications to `pending`, leave pending/approved
applications stable, and keep the current frontend contract unchanged.
`registerVehicle` now relinks previously uploaded vehicle-scoped documents with
`vehicle_id=NULL` to the newly created active vehicle in the same transaction.

### ESF-017 - Ride Request Creation Did Not Start Matching

**Observation:** Creating an Instant Ride request inserted `ride_request` and
`dispatch_outbox_event` rows, but no code path enqueued the initial
`dispatch.match.request` job.

**Impact:** Requests could remain in `searching` indefinitely with empty
`dispatch_attempt` and `dispatch_offer` tables even when an eligible online
driver existed.

**Recommended handling:** Enqueue the initial match job immediately after the
ride-request transaction commits, and add reconciliation recovery for
pre-existing searching requests that have no attempts or offers.

**Decision/status:** Resolved in the approved dispatch debugging corrective task
on 2026-06-24. `RideRequestsService.create` now enqueues the post-commit
`initial` match job, idempotent replay of a still-searching request retries the
same deterministic enqueue path, and dispatch reconciliation requeues
still-searching requests with no match work using recovery attempt IDs.

### ESF-018 - Dispatch Outbox Events Were Not Automatically Published

**Observation:** Production `dispatch_outbox_event` rows for ride requests,
offers, assignments, and driver presence accumulated with `published_at=NULL`
and `publish_attempts=0`. `ReconciliationWorkerService` started, but no
dispatch reconciliation jobs were enqueued, so the existing
`DispatchOutboxPublisherService.enqueuePendingPublishJobs` path did not run.

**Impact:** Durable offer rows were created and remained visible through REST,
but committed `dispatch_offer.created.v1` events did not reach
`DispatchEventPublisher`, so drivers did not receive `dispatch:offer:snapshot`
over Socket.IO.

**Recommended handling:** Run an automatic bounded outbox relay in the
application process, keep publication idempotent by existing event/job identity,
and keep manual reconciliation as recovery rather than the only publishing path.

**Decision/status:** Resolved in the approved dispatch outbox relay corrective
task on 2026-06-26. `DispatchOutboxRelayService` drains a bounded batch on
startup and every second, logs published and remaining counts, and
`DispatchOutboxWorkerService` consumes deterministic outbox jobs so queue
entries do not remain waiting indefinitely.

## Open Findings

### ESF-004 - Notification Delivery Is Not Yet a Durable Dispatch Side Effect

**Observation:** Existing notification service can send FCM, but dispatch requires durable intent, retries, correlation, and idempotency.

**Impact:** Direct synchronous notification calls can lose offers or delay transactions.

**Recommended handling:** Reuse the delivery capability behind a dispatch notification port and outbox-driven worker; do not rewrite unrelated notification features.

### ESF-005 - Repository Instruction Conflict Was Present

**Observation:** Root instructions required transactions for related reads, while `CLAUDE.md` previously exempted all read-only multi-statement flows. `CLAUDE.md` also previously required unrelated `console.*` cleanup.

**Impact:** Agents could make inconsistent transaction or scope decisions.

**Recommended handling:** Corrected during planning documentation setup; continue monitoring for stale instructions.

### ESF-014 - Auth Session Environment Example Drifts from Validated Env Schema

**Observation:** `.env.example` lists `OTP_MAX_ATTEMPTS` and `OTP_MOCK_CODE`,
but `src/config/env.schema.ts` does not validate those variables. The schema
validates `COOKIE_SESSION_TTL_SECONDS`, but the example file does not list it.

**Impact:** Local and deployment configuration can appear complete while runtime
uses defaults or direct `process.env` reads. This makes auth/session behavior
harder to audit before dispatch depends on mobile-session ownership.

**Recommended handling:** Resolve as an explicit auth/config hygiene task or as
part of `D1.11` if mobile-session ownership requires touching auth session
configuration.

### ESF-019 - Drizzle Migration Metadata Drift Can Generate Duplicate DDL

**Observation:** Generating the D10.8 migration initially repeated an enum
alteration that already existed in `0040_late_ironclad.sql`, and the generated
journal timestamp sorted the new migration before `0040`. This required manual
cleanup before applying `0041_closed_magik.sql`.

**Impact:** Future migration generation can produce duplicate or out-of-order
DDL unless the migration metadata chain is audited.

**Recommended handling:** Add a dedicated migration-metadata hygiene task that
reconstructs or verifies Drizzle snapshot/journal continuity before the next
schema-changing dispatch task.

## Finding Template

```markdown
### ESF-??? - Title

**Observation:**

**Impact:**

**Recommended handling:**

**Decision/status:**
```
