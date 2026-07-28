# Repository Instructions

- Use database transactions whenever the code path has access to a transaction-capable database executor. Any flow that performs writes, read-modify-write work, multiple related reads, or cross-table persistence must run inside a transaction and pass the transaction object through service calls. Only omit a transaction when the repository API genuinely does not support one or the operation is a single atomic read with no consistency dependency; leave a short note in code or the final report when omitting one intentionally.

## Instant Ride Dispatch Project

- Before any Instant Ride dispatch implementation or related existing-system change, read `docs/dispatch/README.md`, `docs/dispatch/current-status.md`, and the active phase playbook.
- Do not implement an Instant Ride dispatch task until its requirements, assumptions, schema/API effects, acceptance criteria, and test plan have been presented to and explicitly approved by the user. Documentation and investigation may proceed without separate implementation approval.
- Follow strict TDD for approved dispatch tasks: first add a meaningful failing test, then the smallest passing implementation, then refactor while green.
- Keep each dispatch task and proposed commit small, independently testable, and aligned with one roadmap task ID. After every task, evaluate roadmap status, risks, decisions, and existing-system findings before proposing the commit.
- Record newly discovered architectural/product decisions in `docs/dispatch/decision-register.md`, risks in `docs/dispatch/risk-register.md`, and unrelated existing-system concerns in `docs/dispatch/existing-system-findings.md`. Debate and approve related changes before implementing them.
- Never copy production architecture or domain models directly from the sibling `UbelMatching` experiment. It may be used only as a research reference, visualization harness, or source of selectively reviewed algorithm ideas.
