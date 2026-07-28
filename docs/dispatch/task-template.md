# Dispatch Task Template

Copy this structure into the active phase playbook or a temporary approved-task document when a roadmap item needs more detail.

## Task Metadata

- **Task ID:**
- **Name:**
- **Phase:**
- **Status:** Proposed / Clarifying / Approved / In progress / Verification / Complete / Blocked
- **Depends on:**
- **Blocks:**

## Problem

What concrete problem does this task solve?

## Desired Behavior

Describe externally observable behavior and domain invariants.

## Clarifying Questions

- [ ]

Do not implement while a material question remains unanswered.

## Assumptions Requiring Approval

- [ ]

## Scope

### In Scope

-

### Explicitly Out of Scope

-

## Expected Changes

### Runtime/Modules

-

### Schema/Migrations

-

### API/Events/Jobs

-

### Infrastructure/Configuration

-

### Compatibility/Rollout

-

## Transaction and Concurrency Design

- Transaction boundary:
- Locks/atomic predicates:
- Idempotency:
- Relevant races:
- Database invariants:
- External calls outside transactions:

## Failure and Recovery Behavior

-

## TDD Plan

### First Failing Test

- Test:
- Expected failure reason:

### Required Test Cases

- [ ] Happy path
- [ ] Validation/authorization
- [ ] Domain conflict/invalid state
- [ ] Idempotency/duplicate command or job
- [ ] Concurrency races
- [ ] External/provider failure
- [ ] Recovery/reconciliation, when applicable

## Acceptance Criteria

- [ ]

## Approval Gate

- [ ] Requirements presented
- [ ] Assumptions presented
- [ ] Schema/API/event/infrastructure effects presented
- [ ] Transaction/concurrency design presented
- [ ] Test plan presented
- [ ] Acceptance criteria presented
- [ ] User explicitly approved implementation

## Implementation Checklist

- [ ] Add and demonstrate failing test
- [ ] Add smallest passing implementation
- [ ] Refactor while green
- [ ] Add required edge/failure/concurrency tests
- [ ] Update documentation/registers/status
- [ ] Run focused tests
- [ ] Run relevant integration/e2e tests
- [ ] Run typecheck, lint, and build

## Completion Review

- **Acceptance criteria result:**
- **Tests/checks run:**
- **Transaction/concurrency review:**
- **Security/authorization review:**
- **Operational effects:**
- **New decisions:**
- **New risks:**
- **New existing-system findings:**
- **Plan deviations:**
- **Recommended next task:**

## Commit Proposal

- **Files to stage:**
- **Conventional Commit message:**
- **User commit approval:** Pending / Approved
