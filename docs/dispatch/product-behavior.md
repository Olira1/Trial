# Instant Ride V1 Product Behavior

**Status:** Approved

**Approved:** 2026-06-11

**Roadmap task:** `D0.1`

This document defines the product behavior that later Instant Ride schemas, APIs, events, and user interfaces must preserve. Internal state names and technical contracts were approved in `D0.6` and must represent the behavior defined here.

## Request Creation

- Any authenticated, active user permitted to act as a rider may create an Instant Ride request.
- A rider may have at most one non-terminal Instant Ride request.
- Request creation requires a client-generated idempotency key.
- Repeating the same creation operation with the same rider and idempotency key returns the original request result rather than creating another request.
- Pickup and destination are required.
- Pickup and destination cannot be edited after request creation. The rider must cancel the request and create a new one with a new idempotency key.

## Matching and Timing

- Instant Ride V1 sends an offer to one driver at a time.
- The default driver offer TTL is 15 seconds.
- The default total matching deadline is 90 seconds.
- Offer TTL and total matching deadline are typed, validated configuration rather than hard-coded policy.
- Candidate search expands gradually when eligible candidates are exhausted, while remaining within the total matching deadline.
- Exact expansion distances, H3 rings, and candidate limits are deferred to `D4.1`.
- A driver who rejects or times out is excluded from receiving the same request again.
- V1 does not apply a global cooldown to a driver after rejection or timeout. Operational metrics will determine whether a later global cooldown is justified.

## Rider-Visible Behavior

Internal sequential offers and retries remain hidden from the rider.

| Internal request state | Rider-visible state       | Rider-visible meaning                                                                  |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `searching`            | `finding_driver`          | Ubel is searching for an eligible driver.                                              |
| `offered`              | `finding_driver`          | Search is still in progress; the current driver's identity and offer timer are hidden. |
| `assigned`             | `driver_assigned`         | A driver accepted. The rider may now receive the assigned driver's details.            |
| `completed`            | `completed`               | The driver completed the trip.                                                         |
| `cancelled`            | `cancelled`               | The request ended because the rider or system cancelled before assignment.             |
| `expired`              | `no_driver_found`         | The total matching deadline elapsed before assignment.                                 |
| `no_driver_found`      | `no_driver_found`         | The search policy exhausted all eligible candidates before the deadline.               |
| `system_failed`        | `temporarily_unavailable` | A provider/system failure prevented a trustworthy matching decision.                   |

`expired` and `no_driver_found` remain distinct internal outcomes for operations and measurement, but V1 presents the same no-driver message to the rider.

After either no-driver outcome, the request is terminal. Trying again creates a new request with a new idempotency key. There is no hidden or indefinite automatic retry.

`system_failed` is also terminal, but it is not a no-driver outcome. It means dispatch
could not safely determine whether an eligible driver was available. Trying again creates
a new request with a new idempotency key.

## Driver-Visible Behavior

A pending offer shows the driver:

- Precise pickup
- Precise destination
- Estimated route information when available
- The remaining offer response time

| Internal offer state | Driver-visible meaning                                                               |
| -------------------- | ------------------------------------------------------------------------------------ |
| `pending`            | The driver may accept or reject until the offer expires or is cancelled.             |
| `accepted`           | The driver won the assignment and dispatch hands the ride to trip execution.         |
| `rejected`           | The driver declined; the offer is terminal and will not be re-sent for this request. |
| `expired`            | The response window ended; the offer is terminal and will not be re-sent.            |
| `cancelled`          | The request/system ended the offer before acceptance; the offer is no longer valid.  |

The rider receives driver identity/details only after the driver's acceptance commits.

## Cancellation and Race Outcomes

- The rider may cancel while the request is `searching` or while an offer is pending.
- Cancellation resolves any pending offer and ends dispatch for that request.
- Cancellation wins unless driver acceptance has already committed.
- If acceptance commits first, the ride is assigned and later cancellation belongs to the trip lifecycle, not dispatch.
- Acceptance wins over a later offer-expiration attempt.
- A driver cancellation after acceptance does not trigger automatic rematching in V1. The trip lifecycle ends/cancels the assigned ride, and the rider must explicitly create a new request.

## Dispatch Handoff Boundary

After driver acceptance, dispatch must atomically persist the accepted offer, assigned request, and assigned driver state. It must also durably record the intent to publish a handoff event.

After the assignment and handoff intent commit, Phase 10 owns only the minimal
client-facing controls needed to recover and finish an assigned Instant Ride: pickup
arrival, trip start, trip completion, no-show cancellation, and assigned-ride
cancellation. Completing a trip makes the request history-only and returns the driver to
online. Payment, rating/review, audited fare settlement, post-trip support flows, and
automatic rematching remain outside this minimal trip-control slice.

## Explicitly Deferred

- Exact candidate expansion distances and limits
- Global driver rejection/timeout cooldown policy beyond V1
- Fare and pricing information shown in offers
- Full trip execution beyond manual start/completion
- Payment, rating/review, and fare settlement after completion
- Automatic rematching after an assigned ride is cancelled
- Client UI copy and visual design beyond the meanings defined here
