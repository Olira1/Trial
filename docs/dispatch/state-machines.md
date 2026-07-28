# Instant Ride Dispatch State Machines

These are the approved baseline internal state machines. `D0.1` approved their required rider/driver-visible meanings; `D0.6` approved the internal names, transitions, and API/event contract before schema implementation.

The approved product behavior is defined in [product-behavior.md](product-behavior.md).
The approved API/event contract is defined in [api-event-contracts.md](api-event-contracts.md).

## Driver Operational State

Administrative approval and operational availability are separate concepts.

Approved durable operational states:

- `offline`: not accepting Instant Ride work
- `online`: explicitly intends to receive Instant Ride work
- `offered`: reserved for one pending dispatch offer
- `assigned`: accepted an Instant Ride and handed off to trip execution
- `suspended`: operationally blocked by system/admin policy

Live location freshness is not a durable state transition by itself. An `online` driver with stale/missing presence remains online but is not dispatch-available. Dispatch availability is derived from durable eligibility/state, fresh owned Redis presence, and absence of conflicts.

Allowed transitions:

| From       | To        | Trigger                          | Required checks                                                                               |
| ---------- | --------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| offline    | online    | Driver goes online               | User active, durably eligible, initial valid location, durable presence authority established |
| online     | offline   | Driver goes offline              | No pending offer/assignment                                                                   |
| online     | offered   | Dispatch reserves driver         | Atomic state predicate, eligibility recheck, and fresh owned presence                         |
| offered    | online    | Offer rejected/expired/cancelled | Transition belongs to current offer and no assignment exists                                  |
| offered    | assigned  | Driver accepts offer             | Atomic with request assignment                                                                |
| assigned   | online    | Trip completion                  | Owning assigned driver completes a started trip                                               |
| any active | suspended | Admin/system enforcement         | Cancels/releases dependent dispatch state through explicit workflow                           |

Forbidden examples:

- `assigned -> online` through a generic "go online" endpoint
- `offered -> offline` without resolving the offer
- `suspended -> online` without an explicit reinstatement workflow

An authenticated owner resume after reconnect, Redis lease expiry, or Redis recovery does not change durable operational state or presence generation. It creates a new ephemeral `leaseId` after validating the current durable authority and stores the command location as server-assigned sequence `0`. Client sequence numbering restarts above `0` within that lease, and prior-lease events are rejected once the new lease is established. A raw location update cannot perform this resume implicitly.

An explicit device takeover replaces durable presence authority and advances its generation without inherently changing operational state. D0.6 allows takeover only while the driver is `online`. Takeover while `offered` or `assigned` returns a domain conflict and must never silently resolve an offer or assignment.

After a takeover/offline/suspension commit, the new durable state and generation are immediately authoritative for matching and reservation even if Redis invalidation lags. A stale device update may briefly enter Redis, but its old generation cannot affect dispatch or rider-visible output.

If a go-online/takeover command commits durable `online` state but post-commit Redis
lease creation fails, the command returns `resumeRequired=true` and no `leaseId`. The
driver is not dispatch-available until authenticated resume creates a fresh Redis lease.

## Ride Request State

Approved states:

- `searching`: eligible for matching
- `offered`: one pending sequential offer exists
- `assigned`: a driver accepted
- `completed`: started trip completed
- `cancelled`: rider/driver/system cancelled before trip lifecycle starts
- `expired`: matching window ended
- `no_driver_found`: search policy exhausted
- `system_failed`: provider/system failure prevented a trustworthy matching decision

Allowed transitions:

| From      | To              | Trigger                                                                                                              |
| --------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| searching | offered         | Offer created                                                                                                        |
| searching | cancelled       | Rider/system cancellation                                                                                            |
| searching | expired         | Request deadline reached                                                                                             |
| searching | no_driver_found | Search policy exhausted                                                                                              |
| searching | system_failed   | Provider/system failure prevents safe matching                                                                       |
| offered   | searching       | Offer rejected/expired/cancelled and retry remains                                                                   |
| offered   | no_driver_found | Pending offer resolves and search policy is exhausted                                                                |
| offered   | assigned        | Driver accepts                                                                                                       |
| offered   | cancelled       | Rider/system cancellation resolves pending offer                                                                     |
| assigned  | completed       | Owning assigned driver completes the started trip                                                                    |
| assigned  | cancelled       | Rider cancels assigned ride, assigned driver cancels, or driver cancels rider no-show after committed pickup arrival |
| offered   | expired         | Request deadline reached and pending offer resolved                                                                  |
| offered   | system_failed   | Pending offer resolves and system failure prevents safe rematch                                                      |

Terminal states must not re-enter matching. "Try again" creates a new request with a new idempotency key.

Riders see both `searching` and `offered` as `finding_driver`. They see both `expired` and `no_driver_found` as the same no-driver outcome in V1, while the internal states remain distinct for measurement and operations. They see `system_failed` as a rider-safe temporary-unavailable outcome, not as no-driver-found.

## Dispatch Offer State

Approved states:

- `pending`
- `accepted`
- `rejected`
- `expired`
- `cancelled`

Allowed transitions:

| From     | To        | Trigger                                                                                                 |
| -------- | --------- | ------------------------------------------------------------------------------------------------------- |
| pending  | accepted  | Owning driver accepts before expiry                                                                     |
| pending  | rejected  | Owning driver rejects                                                                                   |
| pending  | expired   | Delayed job/reconciliation confirms deadline passed                                                     |
| pending  | cancelled | Request/system cancellation                                                                             |
| accepted | cancelled | Rider cancels assigned ride, assigned driver cancels, or driver cancels rider no-show after pickup wait |

Every terminal transition is idempotent. Conflicting terminal transitions must produce a clear domain conflict or return the already-completed result according to the approved API contract.

Trip completion does not mutate the accepted offer. Current/active offer reads require
the linked request to remain `offered` or `assigned`, so a completed request makes the
accepted offer history-only.

Pending offers default to a configurable 15-second TTL. Drivers see precise pickup, precise destination, estimated route information when available, and remaining response time. Rejection or timeout excludes the driver from receiving that same request again.

## Assignment Pickup Control State

Pickup control state is stored separately from the immutable assignment snapshot.

Approved states:

- `arrived`: the assigned driver marked pickup arrival.
- `warning_sent`: the pickup wait elapsed and the rider trip-start warning committed.
- `rider_no_show_cancelled`: the driver cancelled for rider no-show after the pickup wait.

Allowed transitions:

| From         | To                      | Trigger                                      |
| ------------ | ----------------------- | -------------------------------------------- |
| none         | arrived                 | Owning assigned driver marks pickup arrival  |
| arrived      | warning_sent            | Delayed pickup reminder confirms warning due |
| arrived      | rider_no_show_cancelled | Owning assigned driver cancels no-show       |
| warning_sent | rider_no_show_cancelled | Owning assigned driver cancels no-show       |

The pickup wait is temporarily hardcoded to 60 seconds. Future trip-start and
automatic radius arrival work must integrate with this control without mutating
the immutable `dispatch_assignment` detail snapshot.

## Assignment Trip Control State

Trip control state is stored separately from the immutable assignment snapshot and the
pickup control row.

Approved states:

- `started`: the owning assigned driver started the trip.
- `completed`: the owning assigned driver completed the started trip.

Allowed transitions:

| From    | To        | Trigger                               |
| ------- | --------- | ------------------------------------- |
| none    | started   | Owning assigned driver starts trip    |
| started | completed | Owning assigned driver completes trip |

Completing before start is a conflict. Duplicate start returns the existing started or
completed trip row; duplicate completion returns the existing completed trip row.
Completion marks the request `completed` and returns the driver operational profile to
`online`, while the accepted offer remains unchanged.

## Required Cross-Aggregate Invariants

- `request=offered` implies exactly one pending offer.
- `driver=offered` implies exactly one pending offer for that driver.
- Pending offer references the same offered request and offered driver.
- An active `offer=accepted` assignment implies `request=assigned` and
  `driver=assigned`; after trip completion the accepted offer remains as history while
  the request is `completed` and the driver is `online`.
- `request=completed` implies exactly one completed assignment-trip row and
  `driver=online`.
- A terminal non-accepted offer must not leave request/driver in `offered`.
- `request=system_failed` implies no pending offer remains.
- Request cancellation wins over any later offer acceptance.
- Acceptance wins over any later expiration attempt.
- Expiration/rejection must not release a driver already assigned through an accepted offer.
- The total request matching deadline defaults to a configurable 90 seconds.
- Post-acceptance rider/driver cancellation does not automatically rematch the request in V1.

## Mandatory Race Tests

- Two match jobs for one request
- Two requests competing for one driver
- Accept versus expire
- Accept versus rider cancel
- Reject versus expire
- Duplicate accept
- Duplicate reject
- Duplicate expiration job
- Worker crash after transaction commit but before job acknowledgement
- Notification failure after offer creation
- Stale location update arriving after a newer update
- Routing provider/system failure versus no-driver exhaustion
