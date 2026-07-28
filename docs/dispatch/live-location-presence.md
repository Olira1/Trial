# Instant Ride V1 Live Location and Presence

**Status:** Approved

**Approved:** 2026-06-12

**Roadmap task:** `D0.4`

This document defines the V1 contract for driver online intent, live-location ingestion, Redis presence, freshness, privacy, and failure behavior before assignment.

## Core Model

Driver presence separates three concepts:

- **Durable presence authority:** the driver's online intent, owning mobile authentication session, opaque presence-session ID, and monotonically increasing presence generation stored in PostgreSQL.
- **Ephemeral live presence:** the active server-generated lease ID, latest accepted location, lease-scoped sequence, and candidate indexes stored in Redis.
- **Derived dispatch availability:** the driver is durably eligible, operationally `online`, has fresh valid presence, and has no pending offer, assignment, or suspension.

`online` does not promise that a driver is currently dispatch-available. It records intent. Dispatch availability is always derived and revalidated.

The proposed durable state name `available` is replaced by `online` because freshness, Redis availability, eligibility, and conflicts can make an online driver unavailable without a durable state transition.

## Authorization and Ownership

- Only an authenticated, durably eligible driver may go online or establish current location-publication authority.
- REST online/offline commands derive driver identity from the authenticated user. They never accept an arbitrary driver ID as authority.
- Going online requires an initial valid location and transactionally records the owning mobile authentication session, a new opaque `presenceSessionId`, and an incremented presence generation.
- Exactly one durably recorded mobile authentication session and presence generation may own a driver's online location publication authority.
- Going online also creates a new opaque ephemeral `leaseId` for the initial uninterrupted location-publication epoch.
- `presenceSessionId` and `leaseId` are server-generated, high-entropy, unguessable identifiers and must never be accepted from the client during creation.
- Location events enter the fast path only through an authenticated Socket.IO connection associated with the presented presence session and current Redis `leaseId`. Current durable authority is revalidated before any dispatch use, not on every event.
- A second authenticated device may take over only through an explicit online/takeover command and visible confirmation.
- Successful takeover atomically replaces the durable owner/session/generation. Post-commit Redis work advances the generation fence and invalidates the previous lease, but dispatch correctness does not depend on that work completing immediately.
- Logout or revocation forces the driver offline only when it affects the owning mobile authentication session. Account deactivation, qualification loss, compliance suspension, or operational suspension also invalidates the durable presence authority and forces the driver offline for future dispatch.
- Ordinary Socket.IO disconnect does not immediately change durable online intent or ownership. Presence naturally becomes stale unless the owning client reconnects, completes an authenticated resume handshake, and resumes valid updates.
- Raw location updates never create or recreate a missing Redis lease.

D1.11 binds persisted mobile authentication sessions to device identity. Presence-session ownership must use the authenticated session ID and `auth_session.device_id`; it must not infer the current owner from `user.deviceId`.

## Commands and Transport

### REST Commands

- Explicit go-online command with the initial location.
- Explicit go-offline command.
- Explicit takeover is represented by go-online while another presence session owns the lease and requires client confirmation.

Online/offline/takeover commands change durable operational state or ownership and therefore use database transactions for related reads/writes and durable outbox intent. The PostgreSQL commit is immediately authoritative for matching and reservation. Redis/network work occurs after commit, may lag or fail, and is conditional on the expected generation so it cannot overwrite a higher generation fence.

A successful lease-establishing go-online/takeover command creates a new `leaseId`, stores the command's valid current location as the lease's initial snapshot with server-assigned sequence `0`, and returns the identifiers required for subsequent Socket.IO events. If post-commit Redis lease creation fails, durable state may already be committed, but no lease is returned, `resumeRequired=true`, and the driver remains unavailable until a successful resume. Command status/error semantics are defined in [api-event-contracts.md](api-event-contracts.md).

### Authenticated Resume Handshake

After reconnect, Redis lease expiry, or Redis recovery, the owning mobile authentication session must complete an authenticated resume handshake before publishing location.

The resume handshake:

- validates durable `online` state, owning authentication session, `presenceSessionId`, and presence generation;
- never changes durable owner, session ID, generation, or online intent;
- creates a new server-generated ephemeral `leaseId` and Redis lease using generation-aware compare-and-set behavior;
- cannot overwrite a higher generation fence;
- requires and stores a new current valid location as the lease's server-assigned sequence `0` snapshot before the driver becomes dispatch-available.

Every successful go-online or resume returns a new `leaseId`. Client-published sequence numbering starts above `0` for the new lease. REST/Socket.IO command and event names are defined in [api-event-contracts.md](api-event-contracts.md). Raw location updates cannot act as an implicit resume handshake.

### Socket.IO Location Updates

Authenticated Socket.IO is the V1 driver-to-server location-ingestion transport. It provides low-overhead acknowledgements and connection ownership without forcing every high-frequency update through the generic HTTP authentication/database path.

The server acknowledges whether an update was:

- accepted into the ephemeral fast path;
- ignored as duplicate or stale;
- rejected as invalid, unauthorized, expired, or not owned by the current presence session;
- unavailable because Redis cannot accept the update.

An `accepted` location acknowledgement does not assert current durable ownership, dispatch availability, matching inclusion, or rider visibility. A cross-store race may allow an old-generation event to enter Redis until fencing/reconciliation removes it; every dispatch use still requires durable state/generation revalidation.

The client keeps only the newest unsent update. It must not replay an offline queue of historical locations after reconnect.

## Location Payload

Required fields:

| Field               | Contract                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `presenceSessionId` | Opaque server-generated identifier for the current durable presence authority  |
| `leaseId`           | Opaque server-generated identifier for the current ephemeral publication epoch |
| `sequence`          | Positive integer increasing monotonically within the current lease             |
| `latitude`          | Finite number in `[-90, 90]`                                                   |
| `longitude`         | Finite number in `[-180, 180]`                                                 |
| `accuracyMeters`    | Finite non-negative number no greater than 50 meters                           |
| `capturedAt`        | Client capture timestamp used for replay/skew validation                       |

Optional bounded fields:

- `headingDegrees`
- `speedMetersPerSecond`

The server computes:

- server receipt timestamp;
- H3 cell;
- freshness/expiry timestamps;
- operational metadata required for metrics and reconciliation.

## Ordering and Validation

- The tuple (`leaseId`, `sequence`) is the authoritative ephemeral ordering key.
- The lease-establishing command location is stored with server-assigned sequence `0`; Socket.IO client events must use positive sequences.
- Client-published `sequence` is monotonic only within one `leaseId` and restarts above `0` for every successful go-online/resume lease.
- Reject an event whose `leaseId` does not equal the current Redis lease, even when its `presenceSessionId`, generation, and sequence otherwise appear valid.
- Once a new lease is established in Redis, events from every previous lease ID are rejected. Before post-commit takeover replacement reaches Redis, the bounded stale-generation race still applies; durable generation revalidation prevents dispatch use.
- Server receipt time is authoritative for freshness.
- `capturedAt` is not trusted for freshness; it detects replayed cached locations and unreasonable clock skew.
- Reject updates captured more than 30 seconds before server receipt.
- Reject updates captured more than 10 seconds after server receipt.
- Ignore duplicate or lower sequences deterministically without moving expiry/freshness forward.
- Accept at most one update per driver per second. Faster updates are ignored or rejected according to the later API/event contract.
- The expected client update interval is configurable and defaults to 3 seconds.
- Coordinates, accuracy, timestamps, sequence, optional heading/speed, payload size, and field count require strict validation.
- V1 rejects accuracy worse than 50 meters. The threshold is configurable and must be measured during rollout.
- Impossible-speed, teleportation, mock-location, and fraud policies are deferred, but metrics must preserve enough aggregate signals to design them without storing a full pre-assignment trail.

## Freshness and Expiry

- Candidate freshness threshold defaults to a configurable 12 seconds.
- Redis snapshot/index cleanup TTL defaults to a configurable 30 seconds.
- An online driver with missing or stale presence is not dispatch-available.
- Freshness expiry is not itself a durable state transition and does not change online intent.
- A reconnecting online driver becomes dispatch-available only after a new valid location update is accepted.
- A driver must have fresh presence during durable reservation revalidation, not only during coarse discovery.

The 3-second update interval, 12-second candidate freshness, 30-second cleanup TTL, 50-meter accuracy limit, and timestamp-skew limits are initial V1 defaults. They require configuration validation, metrics, and rollout measurement.

## Redis Ownership

Redis owns only ephemeral acceleration data:

- active presence lease derived from durable owner/session/generation authority;
- generation fence/invalidation marker;
- latest accepted location snapshot, `leaseId`, and lease-scoped sequence;
- freshness and expiry metadata;
- H3 cell membership/indexes;
- optional connection mapping needed to enforce ownership.

Requirements:

- Snapshot and index membership must be updated atomically enough that stale cells cannot make a driver matchable.
- Lease creation, invalidation, snapshot updates, and index updates are conditional on the expected generation. Location/snapshot updates also require the exact current `leaseId` and must not overwrite a higher generation fence.
- Candidate discovery treats H3 membership as a hint and revalidates the latest snapshot, freshness, presence generation, durable online state, and durable eligibility.
- Explicit offline, takeover, suspension, qualification loss, and owning-session invalidation advance/invalidate durable presence authority, then advance the Redis generation fence and remove/invalidate the prior lease/index after commit.
- Redis keys are namespaced and versioned. Exact key shapes are an implementation detail approved during `D2.5`.
- Redis persistence is not a source of business truth.

## Cross-Store Consistency

PostgreSQL and Redis are not updated in one distributed transaction.

- PostgreSQL commits the authoritative online/owner/session/generation transition first.
- Post-commit Redis work advances the generation fence and creates, replaces, or invalidates ephemeral data.
- Redis may temporarily lag PostgreSQL or lose all generation fences after restart.
- Therefore every candidate-selection and durable-reservation path must compare the Redis snapshot generation with the current durable generation and state.
- High-frequency location ingestion uses the authenticated connection and generation/`leaseId`-matched Redis lease fast path; it does not read PostgreSQL for every update.
- A stale device update may briefly enter Redis during a cross-store race, but its old generation must never authorize publication for a new connection, make a driver matchable, reach rider-visible output, or survive reconciliation as current presence.
- Exact command responses when PostgreSQL commits but post-commit Redis work fails are approved during `D0.6`; the driver remains unavailable until current-generation presence is established.

## Redis Failure and Recovery

- Redis failure makes new location ingestion unavailable and matching fails closed.
- V1 has no degraded PostgreSQL/PostGIS matching fallback during Redis failure.
- Redis loss or restart must never create an assignment conflict or make stale drivers matchable.
- Durable online intent and ownership may remain after Redis loss, but no driver is dispatch-available until the owning session completes an authenticated resume handshake and publishes a fresh valid update.
- A raw location update cannot repopulate missing presence after lease expiry or Redis loss.
- A delayed event from a pre-expiry/pre-restart lease is rejected because resume creates a new `leaseId`; sequence state is never continued across Redis loss.
- Reconciliation removes stale/ineligible entries and reports durable-online drivers that lack fresh presence.
- D1.12 includes Redis in health/readiness behavior before presence rollout.

## Disconnect and Offline Behavior

| Event                                 | Durable online intent | Redis presence                                  | Dispatch result                                                    |
| ------------------------------------- | --------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Explicit offline                      | Set to `offline`      | Post-commit invalidation may lag/fail           | Matching/reservation rejects durable offline state immediately     |
| Ordinary Socket.IO disconnect         | Remains `online`      | Existing snapshot expires naturally             | Owner must resume; driver stops matching after freshness threshold |
| Owning session logout/revocation      | Set to `offline`      | Post-commit invalidation may lag/fail           | Matching/reservation rejects durable offline state immediately     |
| Device takeover                       | Remains/set `online`  | Post-commit replace/invalidation may lag/fail   | Only current durable generation can match or reserve               |
| Qualification/account/suspension loss | Set/force offline     | Post-commit invalidation may lag/fail           | Future dispatch blocked immediately by durable state               |
| Redis restart/loss                    | Remains as stored     | Presence absent until owner resumes and updates | Matching fails closed                                              |

Pending offers and assigned rides are not silently resolved by presence expiry or ordinary disconnect. Their explicit offer/trip state machines own those outcomes.

## Durable Storage and Privacy

- V1 stores no durable pre-assignment coordinate history.
- PostgreSQL stores durable online intent, owning authentication-session identity, opaque presence-session ID, monotonic presence generation, and operational/audit transitions, not every live coordinate.
- Location-update logs and metrics must not contain precise coordinates or bulk histories.
- Pre-assignment location is used only for current dispatch eligibility, discovery, ranking, security, and operational debugging within the approved ephemeral window.
- Precise driver location is never exposed to riders before assignment.
- Post-assignment rider-visible tracking and any durable trip-location retention belong to the later trip-execution domain and require a separate policy.
- Access to live location and operational inspection is authorized, auditable, and least-privilege.

## Metrics and Operational Signals

Measure without recording precise coordinate histories:

- accepted, duplicate, stale, invalid, unauthorized, and throttled updates;
- update and acknowledgement latency;
- age and accuracy distributions;
- online drivers with fresh, stale, or missing presence;
- lease takeover and rejected-owner attempts;
- resume success/failure and generation-conflict attempts;
- rejected old/mismatched lease IDs and lease-scoped sequence conflicts;
- Redis errors, expiry, restart recovery, and reconciliation cleanup;
- H3 snapshot/index disagreement;
- candidate exclusions caused by stale/missing presence.

## Existing-System Dependencies

Before presence ownership and rollout:

- Use the D1.11 persisted mobile session/device identity from validated requests as the presence owner authority.
- Use the D2.1 durable operational profile for state and presence authority, and enforce generation-aware transitions in D2.3+.
- Use the D1.12 Redis readiness signal for fail-closed presence rollout checks.
- Complete durable driver qualification and operational-state foundation tasks.
- Implement the approved Socket.IO authentication/reconnect event contract from
  [api-event-contracts.md](api-event-contracts.md) during `D7.1`.
- Define exact Redis key/atomic-update implementation during `D2.5`.

## Explicitly Deferred

- Durable pre-assignment location history.
- Post-assignment/trip location tracking and retention.
- A Redis-outage PostGIS fallback.
- Automatic offline on ordinary socket disconnect.
- Fraud enforcement from impossible speed or mock-location signals.
- Multi-device simultaneous presence publication.
- Exact Redis key names and H3 resolution.
- Redis key names and lower-level Lua/transaction mechanics.
