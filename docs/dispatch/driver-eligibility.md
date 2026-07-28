# Instant Ride V1 Driver Eligibility

**Status:** Approved

**Approved:** 2026-06-11

**Roadmap task:** `D0.2`

This document defines the durable qualification facts required before a driver may participate in Instant Ride dispatch. Live online intent and fresh location are additional requirements owned by driver presence.

## Eligibility Rule

A driver is durably eligible for Instant Ride only when every condition is true:

- The user exists, `isActive=true`, `deletedAt=null`, and has a verified phone identity.
- Ubel has granted the identity driver capability through an approved driver application. Driver capability is not self-granted during signup.
- The driver application is approved and has not been revoked.
- Exactly one active vehicle is selected for V1.
- The active vehicle is approved and not deleted.
- The vehicle plate qualification permits Instant Ride.
- Every required qualification document is approved, current, and not revoked.
- No compliance suspension blocks driving.

Operational eligibility additionally requires the driver not to be operationally suspended, not to have a conflicting offer/assignment, to be online, and to have fresh accepted location data.

## Plate Qualification

Ubel independently verifies every driver and vehicle. Registration with another ride provider has no effect on Ubel eligibility.

| Plate code | Subtype             | Instant Ride V1              |
| ---------- | ------------------- | ---------------------------- |
| `01`       | Not applicable      | Eligible after Ubel approval |
| `02`       | Not applicable      | Ineligible                   |
| `03`       | `transport_service` | Eligible after Ubel approval |
| `03`       | `other`             | Ineligible                   |

## V1 Qualification Requirements

Code `01` and Code `03` Transport Service require:

- Vehicle ownership document
- Representative letter when ownership type is `representative`
- Driver license front and back
- Vehicle photos: front, side, and back
- Vehicle inspection certificate/Bolo
- Third-party insurance
- TIN
- Trade license

All required evidence is manually reviewed by Ubel. Driver license, Bolo, third-party insurance, and trade license require expiry tracking. Expiry, rejection, or revocation of any required qualification makes the driver ineligible and removes them from future dispatch availability.

This evidence is sufficient for V1. No separate transport-service permit is required for V1.

Shared Ride requirements for Code `02` and Code `03` Other remain outside this Instant Ride project.

## Ownership Boundaries

- Account deactivation/deletion is global identity access control.
- Driver application, vehicle, document approval, and compliance suspension belong to driver qualification/onboarding.
- Online/offline intent, live location, offer reservation, assignment, and operational suspension belong to driver presence/dispatch.
- Qualification loss must prevent future offers and force the driver offline.
- If qualification is lost during an assigned ride, trip execution explicitly handles the active ride; dispatch does not silently cancel or rematch it.

## Approval and Audit Rules

- One identity may act as both rider and driver.
- Signup may express intent to become a driver, but approval grants driver capability.
- Driver application, vehicle, and document approval/rejection/revocation actions require actor, timestamp, reason, and auditable history.
- Mutable approval booleans without history are insufficient as the sole source of truth.
- V1 permits exactly one active vehicle per driver.

## Existing-Domain Mapping

| Required fact                                | Existing source                                               | Current reliability                                                                                           | Required work                              |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| User exists/not deleted                      | `user.deletedAt`                                              | Available                                                                                                     | Include in authoritative eligibility query |
| User active                                  | `user.isActive`                                               | Available and enforced by authentication/session paths since `D1.7`                                           | Include in `D2.2` eligibility query        |
| Verified phone                               | `user.phoneVerified` and verified phone identity              | Available through verified auth identity records                                                              | Include in `D2.2` eligibility query        |
| Driver capability                            | `user.roles`                                                  | Multi-role capability preserved; approved grant/revoke workflow implemented in `D1.8`                         | Include in `D2.2` eligibility query        |
| Signup intent                                | `user.signupIntent`                                           | Stored separately from capability since `D1.7`; not eligibility                                               | No dispatch eligibility use                |
| Approved application                         | `driver_application.status`                                   | Submit/review/approve/reject/revoke workflow implemented in `D1.8`                                            | Include in `D2.2` eligibility query        |
| Application/document/vehicle audited history | `driver_application_audit`, `document_audit`, `vehicle_audit` | Application history written by `D1.8`; document history written by `D1.9`; vehicle history written by `D1.10` | Include in `D2.2` eligibility query        |
| One active selected vehicle                  | `vehicle.deletedAt` plus `vehicle_uq_active_user_id`          | One non-deleted active vehicle per driver is database-enforced since `D1.10`                                  | Include in `D2.2` eligibility query        |
| Vehicle approved                             | `vehicle.isApproved`, `vehicle_audit`                         | Admin approve/reject/revoke workflow and audit history implemented in `D1.10`                                 | Include in `D2.2` eligibility query        |
| Plate qualification                          | `plateCode`, `plateCodeSubtype`                               | Subtype rules and normalized composite plate identity are database-enforced since `D1.10`                     | Include in `D2.2` eligibility query        |
| TIN requirement                              | `vehicle.tinNumber`                                           | Code `01` and code `03` transport-service non-blank TIN is enforced since `D1.10`                             | Include in `D2.2` eligibility query        |
| Required document exists                     | `document.documentType`                                       | Upload is stored with application/vehicle ownership since `D1.9`                                              | Include in `D2.2` eligibility query        |
| Document approved/current/not revoked        | `document.reviewStatus`, `expiresAt`, `revokedAt`             | Manual review, expiry tracking, and revocation implemented in `D1.9`                                          | Include in `D2.2` eligibility query        |
| Document belongs to vehicle/application      | `document.driverApplicationId`, `document.vehicleId`          | Available since `D1.9`                                                                                        | Include in `D2.2` eligibility query        |
| Compliance suspension                        | `driver_compliance_event`                                     | Available and written by `D1.8`                                                                               | Include in `D2.2` eligibility query        |
| Operational suspension                       | None                                                          | Missing; intentionally separate                                                                               | `D2.1`                                     |

## Approved Foundation Tasks

These tasks repair qualification facts before `D2.2` implements the authoritative Instant Ride eligibility query:

- `D1.7` Correct account activity and driver-capability authorization. Completed
  2026-06-17.
- `D1.8` Implement audited driver application, approval, revocation, and
  compliance suspension. Completed 2026-06-17.
- `D1.9` Model document ownership, review status, expiry, and revocation.
  Completed 2026-06-17.
- `D1.10` Enforce active-vehicle, plate identity, plate-subtype, TIN, and
  vehicle-approval invariants. Completed 2026-06-17.

## Implementation Status

`D2.2` implements the authoritative durable Instant Ride eligibility projection
in `DriverEligibilityService.evaluateInstantRideDriverEligibility`.

The service evaluates the approved account, phone identity, driver capability,
application, vehicle, plate, TIN, document, and compliance-suspension facts and
returns internal denial reasons for operations/testing. It does not expose a
public endpoint or include operational online/fresh-location availability,
which remain driver-presence responsibilities.

Each task requires its own approval brief and strict TDD before implementation.
