# Dispatch Delivery Workflow

This workflow applies to every Instant Ride dispatch task and any existing-system change discovered through the project.

## Definition of Ready

A task is ready for implementation only when all items are true:

- [ ] It has exactly one roadmap task ID.
- [ ] Its problem and desired behavior are stated.
- [ ] Its in-scope and out-of-scope boundaries are stated.
- [ ] Product assumptions are explicit.
- [ ] Schema, API, event, infrastructure, and compatibility effects are explicit.
- [ ] Transaction boundaries and consistency requirements are explicit.
- [ ] Failure modes and concurrency races are listed.
- [ ] Test plan is explicit and includes the first failing test.
- [ ] Acceptance criteria are observable.
- [ ] Dependencies and open decisions are resolved.
- [ ] The user explicitly approves implementation.

If any item is missing, stop at investigation/documentation and ask clarifying questions.

## Task Approval Brief

Before implementation, present:

```markdown
Task: D?.? - Name

Goal:

Behavior:

Assumptions:

Schema/API/events/infrastructure affected:

Transaction and concurrency design:

Failure behavior:

Tests to write first:

Acceptance criteria:

Explicitly out of scope:
```

Implementation begins only after approval.

## TDD Cycle

1. **Red**
   - Add the smallest meaningful failing test.
   - Demonstrate that it fails for the expected reason.
   - Prefer behavior and invariant tests over implementation-detail tests.
2. **Green**
   - Add the smallest production change that passes the test.
   - Preserve transaction propagation and module boundaries.
3. **Refactor**
   - Improve naming/design while keeping tests green.
   - Do not expand scope.
4. **Broaden**
   - Add edge, failure, authorization, idempotency, and concurrency cases proportional to risk.
5. **Verify**
   - Run focused tests, relevant integration tests, typecheck, lint, and build.

## Post-Task Alignment Review

Before proposing a commit, report:

- Task ID and acceptance criteria satisfied
- Files changed and why
- Tests/checks run and results
- Transaction and concurrency review
- Security and authorization review
- Operational/observability effects
- New decisions, risks, or findings
- Deviations from the plan
- Recommended next task candidate

Update `current-status.md`, `task-completion-checklist.md`, and relevant
registers before proposing the commit.

## Commit Gate

- [ ] Task is genuinely complete.
- [ ] Required tests pass.
- [ ] Typecheck and build pass.
- [ ] No unrelated files are staged.
- [ ] Documentation/status reflects reality.
- [ ] Task completion checklist reflects the task.
- [ ] Proposed Conventional Commit message is shown to the user.
- [ ] User explicitly approves the commit.

## Change-Control Rules

- A task that discovers a major new decision pauses and returns to approval.
- A task that requires changing an accepted ADR pauses and creates a superseding proposal.
- Unrelated defects are recorded in `existing-system-findings.md`; they are not fixed opportunistically.
- Emergency correctness/security defects may be proposed immediately, but still require explicit approval before implementation.
- Never combine schema, worker, API, and client-contract changes into one task unless they cannot be independently safe.

## Review Questions Used After Every Commit

1. Are we still solving Instant Ride dispatch rather than adjacent product scope?
2. Did the change deepen or blur module ownership?
3. Are database invariants sufficient under concurrent instances?
4. Can retries duplicate or reorder the operation safely?
5. Can operations detect and repair failure?
6. Did we introduce an assumption that needs product approval?
7. Is the next task still the correct next task?

## Operating Cadence

### Start of Every Work Session

- Read `current-status.md`.
- Confirm no user/agent changes have altered the active task's assumptions.
- Review open blockers, decisions, risks, and findings relevant to the task.
- Prepare or update the task approval brief.
- Do not begin runtime changes without explicit approval.

### End of Every Approved Task

- Run the post-task alignment review.
- Update status, roadmap checkbox, task completion checklist, decisions, risks, and findings.
- Propose one small commit and wait for approval.

### Project Checkpoint

At least once per phase, and whenever scope/architecture changes:

- Review the full master roadmap and phase exit gate.
- Reassess accepted decisions and open blockers.
- Reassess the risk register.
- Review whether existing modules need approved improvements.
- Check whether UbelDocs product context remains accurate.
- Decide whether the next planned task is still the highest-value safe step.
