# Dispatch Lab Plan

**Status:** Proposed

**Type:** Internal QA/testing tool plan

**Last updated:** 2026-06-23

## Goal

Build an internal frontend called `Dispatch Lab` that tests dispatch, ride request,
offer, assignment, arrival, cancellation, realtime, and history behavior against the
real backend APIs.

The tool must support:

- fully automated scripted dispatch scenarios with no human interaction;
- manual human-driven testing of the same flows;
- realtime inspection of REST calls, Socket.IO events, and final backend state;
- deterministic setup/reset for repeatable local and staging verification.

## Non-Goals

- This is not a rider app.
- This is not a driver app.
- This is not production customer UX.
- This must not duplicate backend dispatch business logic.
- This must not bypass backend authorization, transactions, or state machines.
- This must not mutate the database directly from the browser.
- This must not be publicly deployed without explicit internal-tool controls.

## Agent Execution Rules

Any agent implementing this plan should follow these rules:

- Treat each `DL-*` task as a separate reviewable unit.
- Do not implement backend test-support endpoints until `DL-9` is explicitly
  approved after the `DL-8` fixture-bottleneck review.
- Prefer frontend-only work until an automated scenario proves fixture setup is the
  bottleneck.
- Do not weaken existing auth guards, session logic, dispatch state machines, or
  transaction boundaries.
- Do not add direct database access to the frontend.
- Keep scenario assertions based on public REST responses, Socket.IO events, and
  approved dev/test harness responses.
- Keep scenario runner logic generic; scenario definitions should be data/functions
  layered on top of the runner.
- After each task, update this plan with status, discovered blockers, and any
  accepted implementation decisions.

## Assumptions

- The backend API is served from a configurable base URL, defaulting to
  `http://localhost:3000/api/v1`.
- The dispatch Socket.IO namespace or path remains `/dispatch`.
- The app can initially use manually supplied access tokens.
- Test users and dispatch-ready driver state can initially be created outside the
  tool.
- A later dev/test harness can seed users, sessions, driver presence, and fixture
  rides if manual setup is too slow.

## Recommended Architecture

### Frontend

- Location: `tools/dispatch-lab`.
- Framework: Vite, React, TypeScript.
- UI style: dense internal operations console.
- API client: calls real backend REST endpoints.
- Realtime client: connects to the real `/dispatch` Socket.IO gateway.
- Scenario runner: executes scripted flows and records assertions.

### Backend Test Support

Phase 1 should run against existing real APIs and pre-created test users.

Phase 2 may add dev/test-only support endpoints:

- `POST /api/v1/dev/dispatch-test/reset`
- `POST /api/v1/dev/dispatch-test/seed`
- `POST /api/v1/dev/dispatch-test/login-rider`
- `POST /api/v1/dev/dispatch-test/login-driver`

Guardrails:

- enabled only when `NODE_ENV !== 'production'`;
- gated behind `ENABLE_DISPATCH_TEST_HARNESS=true`;
- protected by internal auth or local-only access;
- never deployed publicly;
- limited to deterministic fixture setup/reset and test-session creation.

## Core Screens

### Scenario Runner

Purpose: run scripted test flows without manual input.

Capabilities:

- list available scenarios;
- run one scenario;
- run all scenarios;
- stop the current run;
- reset known test data;
- show pass/fail status, duration, failed step, request ids, offer ids, and
  assignment ids;
- export or copy a run report.

### Manual Test Console

Purpose: let a human reproduce and inspect the same flows.

Rider controls:

- estimate fare;
- request ride;
- cancel current request;
- fetch current request;
- fetch ride history.

Driver controls:

- fetch current offer;
- accept offer;
- reject offer;
- mark arrival at pickup;
- cancel rider no-show;
- cancel assigned ride;
- fetch assignment history.

### State Inspector

Purpose: show the backend truth for the current run.

Panels:

- active rider request;
- current driver offer;
- assignment snapshot;
- pickup state;
- cancellation details;
- rider history;
- driver history;
- raw JSON for each response.

### Realtime Monitor

Purpose: make Socket.IO delivery observable.

Capabilities:

- show connection state;
- show authenticated user events;
- show request, offer, assignment, and cancellation events;
- issue reconnect snapshot requests;
- display event order, payload, timestamp, and related entity ids.

### Fixture Panel

Purpose: choose deterministic test inputs.

Controls:

- rider identity;
- driver identity;
- pickup/dropoff preset;
- scenario speed: `instant`, `normal`, or `slow`;
- reset fixture state;
- seed known users and dispatch-ready driver state.

## Automated Scenario Catalog

Initial scenarios:

- fare estimate succeeds;
- ride request creates with fare estimate;
- duplicate request idempotency returns the original request;
- driver receives current offer;
- driver accepts offer;
- rider sees assignment details;
- driver sees assigned ride details;
- driver rejects offer and request continues safely;
- offer expires and driver is excluded from the request;
- rider cancels while searching;
- rider cancels while offered;
- rider cancels after assignment;
- driver cancels after assignment;
- driver arrives at pickup;
- rider warning appears after pickup wait;
- driver cancels rider no-show after wait;
- rider current endpoint excludes terminal rides;
- driver current endpoint excludes terminal offers;
- rider history returns bounded terminal rides;
- driver history returns bounded assigned terminal rides;
- realtime reconnect snapshot recovers active rider request;
- realtime reconnect snapshot recovers active driver offer.

## Scenario Runner Contract

Suggested local model:

```ts
type ScenarioStatus = 'idle' | 'running' | 'passed' | 'failed' | 'cancelled';

type ScenarioStep = {
  name: string;
  action: (context: ScenarioContext) => Promise<unknown>;
  assert?: (result: unknown, context: ScenarioContext) => void | Promise<void>;
  timeoutMs?: number;
};

type ScenarioDefinition = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  steps: ScenarioStep[];
};

type ScenarioRun = {
  runId: string;
  scenarioId: string;
  status: ScenarioStatus;
  startedAt: string;
  finishedAt: string | null;
  steps: ScenarioStepResult[];
  entities: ScenarioEntities;
};
```

The frontend stores run state locally. The backend remains the source of truth for
dispatch state.

## Required Assertions

Each automated scenario should assert:

- expected REST status and response shape;
- expected durable state transition;
- expected current endpoint output;
- expected history endpoint output when terminal;
- expected realtime event or snapshot when relevant;
- absence of forbidden states, such as terminal rides still appearing as current.

## Data and State Model

The frontend should keep a local run state with these concepts:

- `LabConfig`: backend URL, socket URL, rider token, driver token, selected fixture,
  scenario speed, and timeout defaults.
- `ScenarioDefinition`: immutable scenario metadata and ordered step definitions.
- `ScenarioRun`: one execution instance, status, timings, step results, entity ids,
  REST transcripts, and realtime transcripts.
- `ScenarioEntities`: known ids captured during a run: `fareEstimateId`,
  `requestId`, `offerId`, `assignmentId`, `pickupControlId`, `cancellationId`.
- `HttpTranscript`: method, URL, request body, response status, response body,
  duration, and timestamp.
- `RealtimeTranscript`: event name, payload, timestamp, socket id if available, and
  related entity ids.

The browser may persist `LabConfig` in local storage. Scenario run state should stay
in memory for V1 unless export/report persistence is explicitly approved.

## Security and Environment Rules

- Dispatch Lab is internal-only.
- Test support endpoints are disabled by default.
- Production must fail closed if test-harness configuration is accidentally set.
- Tokens and fixture credentials must not be committed.
- Logs must avoid secrets and reusable auth tokens.
- Browser-accessible controls must call backend APIs, not database clients.

## Implementation Phases

### `DL-0` Confirm Workspace and Tooling

**Goal:** decide where the app lives and how it is run.

**Depends on:** none.

**Default decision:** create the app under `tools/dispatch-lab`.

**Tasks:**

- Inspect repo package manager, workspace config, TS config, lint config, and test
  conventions.
- Choose whether `tools/dispatch-lab` becomes a workspace package.
- Add or update package scripts only if they match existing repo conventions.
- Decide whether UI dependencies are acceptable now or should be deferred to
  `DL-1`.

**Expected files:**

- `package.json` if workspace scripts are added.
- workspace config file if this repo already uses one.
- `tools/dispatch-lab/package.json` once the app is introduced.

**Acceptance criteria:**

- The selected app location is documented.
- The app can be installed and run by a deterministic command.
- No unrelated repo scripts are changed.

**Verification:**

- `pnpm install` if workspace/package metadata changes.
- `pnpm --dir tools/dispatch-lab build` once the app exists.

### `DL-1` Create Static App Shell

**Goal:** create a working internal-console shell with no backend dependency.

**Depends on:** `DL-0`.

**Tasks:**

- Scaffold Vite, React, and TypeScript in `tools/dispatch-lab`.
- Create a restrained operations layout with five top-level views:
  `Scenarios`, `Manual`, `State`, `Realtime`, and `Fixtures`.
- Add local navigation and responsive layout for desktop and tablet-width screens.
- Add placeholder data for scenario rows, run status, entity ids, and event timeline.
- Add a configuration panel for backend URL, socket URL, rider token, and driver
  token.

**Expected files:**

- `tools/dispatch-lab/src/main.tsx`
- `tools/dispatch-lab/src/App.tsx`
- `tools/dispatch-lab/src/styles.css`
- `tools/dispatch-lab/src/config/lab-config.ts`
- `tools/dispatch-lab/src/components/*`

**Acceptance criteria:**

- The app opens to the actual QA console, not a landing page.
- All five views are reachable.
- Placeholder content has stable dimensions and no overlapping UI.
- Tokens are visually redacted except when explicitly revealed.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Browser smoke check at the local dev URL.

### `DL-2` Add Typed REST Client and Manual Read Controls

**Goal:** wire safe read-only manual controls to real backend APIs.

**Depends on:** `DL-1`.

**Tasks:**

- Add a small fetch wrapper that accepts base URL, bearer token, method, path, and
  body.
- Capture every request/response as an `HttpTranscript`.
- Add typed client methods for:
  - `GET /api/v1/ride-requests/current`
  - `GET /api/v1/ride-requests/history`
  - `GET /api/v1/dispatch-offers/current`
  - `GET /api/v1/dispatch-assignments/history`
- Add manual buttons for those read endpoints.
- Render success, empty, and error states consistently.

**Expected files:**

- `tools/dispatch-lab/src/api/http-client.ts`
- `tools/dispatch-lab/src/api/dispatch-api.ts`
- `tools/dispatch-lab/src/types/api.ts`
- `tools/dispatch-lab/src/components/ManualConsole.tsx`
- `tools/dispatch-lab/src/components/StateInspector.tsx`

**Acceptance criteria:**

- A human can paste rider and driver tokens and fetch current/history state.
- All responses appear in the state inspector and transcript log.
- Failed requests show status, response body, and duration.
- No write endpoint is wired in this task.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Manual smoke with backend running and known tokens.

### `DL-3` Add Manual Write Controls

**Goal:** allow a human to drive dispatch flows through real backend write APIs.

**Depends on:** `DL-2`.

**Tasks:**

- Add typed client methods for:
  - `POST /api/v1/fare-estimates`
  - `POST /api/v1/ride-requests`
  - `POST /api/v1/ride-requests/:id/cancel`
  - `POST /api/v1/dispatch-offers/:id/accept`
  - `POST /api/v1/dispatch-offers/:id/reject`
  - `POST /api/v1/dispatch-assignments/:id/arrive-at-pickup`
  - `POST /api/v1/dispatch-assignments/:id/cancel-rider-no-show`
  - `POST /api/v1/dispatch-assignments/:id/cancel`
- Add pickup/dropoff preset selector.
- Add idempotency key generation for ride request creation.
- After each successful write, refresh relevant current/history read panels.
- Store returned entity ids in `ScenarioEntities`.

**Expected files:**

- `tools/dispatch-lab/src/api/dispatch-api.ts`
- `tools/dispatch-lab/src/fixtures/location-presets.ts`
- `tools/dispatch-lab/src/state/lab-store.ts`
- `tools/dispatch-lab/src/components/ManualConsole.tsx`
- `tools/dispatch-lab/src/components/EntityBar.tsx`

**Acceptance criteria:**

- A human can create a fare estimate and ride request from the UI.
- A human can accept, reject, arrive, no-show cancel, rider cancel, and driver
  cancel when the backend state allows it.
- Disabled buttons explain missing prerequisites using local UI state, not backend
  logic duplication.
- Backend conflicts are displayed as backend conflicts, not hidden.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Manual smoke through at least one successful request-to-assignment flow.

### `DL-4` Add Realtime Monitor

**Goal:** observe real Socket.IO dispatch events and reconnect snapshots.

**Depends on:** `DL-2`.

**Tasks:**

- Add Socket.IO client dependency if not already present.
- Connect to `/dispatch` using `auth.token` with the `Bearer ` prefix.
- Support rider socket and driver socket independently.
- Display connection state, connect errors, disconnect reasons, and event payloads.
- Add a button to emit `dispatch:snapshot:request` with optional `requestId`.
- Correlate realtime events to known `ScenarioEntities` where possible.

**Expected files:**

- `tools/dispatch-lab/src/realtime/dispatch-socket.ts`
- `tools/dispatch-lab/src/types/realtime.ts`
- `tools/dispatch-lab/src/components/RealtimeMonitor.tsx`
- `tools/dispatch-lab/src/state/realtime-store.ts`

**Acceptance criteria:**

- Rider and driver sockets can connect independently.
- Event timeline shows event name, timestamp, payload, actor side, and related ids.
- Reconnect snapshot responses are visible.
- Socket errors are visible without crashing the app.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Manual smoke: connect rider and driver sockets, request a snapshot, observe at
  least one dispatch event.

### `DL-5` Implement Scenario Runner Core

**Goal:** execute scenario steps, record results, and stop on failures.

**Depends on:** `DL-3`.

**Tasks:**

- Implement `ScenarioDefinition`, `ScenarioStep`, `ScenarioRun`, and
  `ScenarioStepResult` types.
- Implement runner states: `idle`, `running`, `passed`, `failed`, `cancelled`.
- Add per-step timeout handling.
- Capture REST and realtime transcripts during each run.
- Add run controls: run selected, run all, stop current, clear results.
- Add assertion helpers for response status, required fields, entity ids, current
  state, history state, and realtime event presence.

**Expected files:**

- `tools/dispatch-lab/src/scenarios/types.ts`
- `tools/dispatch-lab/src/scenarios/runner.ts`
- `tools/dispatch-lab/src/scenarios/assertions.ts`
- `tools/dispatch-lab/src/scenarios/report.ts`
- `tools/dispatch-lab/src/components/ScenarioRunner.tsx`

**Acceptance criteria:**

- A static no-op scenario can pass.
- A deliberately failing scenario reports the failed step and error reason.
- Cancelling a run stops pending steps and marks the run `cancelled`.
- Run output includes timings and transcripts.

**Verification:**

- Unit tests for runner success, failure, timeout, and cancellation if the app test
  stack exists.
- `pnpm --dir tools/dispatch-lab build`

### `DL-6` Add Read-Only and Single-Actor Scenarios

**Goal:** add automated scenarios that do not require deterministic driver matching.

**Depends on:** `DL-5`.

**Tasks:**

- Add scenario: current rider request returns null or expected active request.
- Add scenario: rider history returns bounded terminal rides.
- Add scenario: current driver offer returns null or expected active offer.
- Add scenario: driver assignment history returns bounded terminal rides.
- Add scenario: fare estimate succeeds.
- Add scenario: ride request idempotency returns the original request when the same
  payload and idempotency key are reused.

**Expected files:**

- `tools/dispatch-lab/src/scenarios/catalog.ts`
- `tools/dispatch-lab/src/scenarios/read-scenarios.ts`
- `tools/dispatch-lab/src/scenarios/rider-request-scenarios.ts`

**Acceptance criteria:**

- Each scenario can run independently.
- Each scenario declares prerequisites in metadata.
- Scenarios fail with clear messages when required tokens or fixture state are
  missing.
- No scenario assumes a successful driver match unless it explicitly requires one.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Run each scenario manually from the UI.

### `DL-7` Add Full Dispatch Lifecycle Scenarios

**Goal:** automate core rider-driver lifecycle flows.

**Depends on:** `DL-5`, `DL-4`.

**Tasks:**

- Add scenario: request ride, driver receives offer, driver accepts, rider sees
  assignment details.
- Add scenario: driver rejects offer and current offer becomes null or moves safely.
- Add scenario: rider cancels while searching.
- Add scenario: rider cancels while offered.
- Add scenario: rider cancels after assignment.
- Add scenario: driver cancels after assignment.
- Add scenario: driver arrives at pickup.
- Add scenario: driver cancels rider no-show after the approved wait.
- Add scenario: reconnect snapshot recovers active rider request.
- Add scenario: reconnect snapshot recovers active driver offer.

**Expected files:**

- `tools/dispatch-lab/src/scenarios/dispatch-lifecycle-scenarios.ts`
- `tools/dispatch-lab/src/scenarios/cancellation-scenarios.ts`
- `tools/dispatch-lab/src/scenarios/realtime-scenarios.ts`

**Acceptance criteria:**

- Every scenario records created ids and final state.
- Every terminal scenario verifies current endpoints exclude terminal records.
- Every terminal scenario verifies history endpoints include terminal records.
- Realtime scenarios assert either expected live events or expected reconnect
  snapshot state.
- Timing-sensitive scenarios use explicit waits with visible countdown state.

**Verification:**

- `pnpm --dir tools/dispatch-lab build`
- Run each lifecycle scenario against a local backend with known test users.

### `DL-8` Evaluate Fixture Bottlenecks

**Goal:** decide whether dev/test backend support endpoints are needed.

**Depends on:** `DL-7`.

**Tasks:**

- Record which scenarios require manual database/admin setup.
- Record average setup time and failure rate.
- Identify missing public API controls needed to make scenarios deterministic.
- Decide whether to add backend support endpoints or keep fixture setup external.

**Expected files:**

- Update `docs/dispatch/dispatch-lab-plan.md`.
- Optional: `tools/dispatch-lab/src/fixtures/fixture-readiness.ts`.

**Acceptance criteria:**

- There is a written decision on whether backend fixture endpoints are needed.
- If needed, the exact endpoint contract is documented before implementation.
- If not needed, external fixture setup steps are documented.

**Verification:**

- Documentation review.

### `DL-9` Add Dev/Test Fixture Harness

**Goal:** provide deterministic setup/reset only if `DL-8` proves it is needed.

**Depends on:** `DL-8` and explicit approval.

**Backend tasks:**

- Add config flag `ENABLE_DISPATCH_TEST_HARNESS`.
- Add a guarded dev/test module, for example `DispatchTestHarnessModule`.
- Add endpoint `POST /api/v1/dev/dispatch-test/seed`.
- Add endpoint `POST /api/v1/dev/dispatch-test/reset`.
- Add endpoint `POST /api/v1/dev/dispatch-test/login-rider`.
- Add endpoint `POST /api/v1/dev/dispatch-test/login-driver`.
- Ensure the module fails closed in production.
- Ensure all writes use transactions.
- Ensure reset only touches fixture-owned users/data.

**Frontend tasks:**

- Add fixture panel controls for seed, reset, rider login, and driver login.
- Store returned access tokens only in browser local storage or memory.
- Add transcript entries for harness calls.

**Expected backend files:**

- `src/config/env.schema.ts`
- `src/config/dispatch-test-harness.config.ts` if a new config namespace is needed.
- `src/modules/dispatch-test-harness/*`
- focused controller/service specs.

**Expected frontend files:**

- `tools/dispatch-lab/src/api/test-harness-api.ts`
- `tools/dispatch-lab/src/components/FixturePanel.tsx`
- `tools/dispatch-lab/src/fixtures/default-fixture.ts`

**Acceptance criteria:**

- Harness endpoints are unavailable unless explicitly enabled.
- Harness endpoints cannot run in production.
- Seed creates deterministic rider, driver, vehicle, documents, presence, and
  session facts needed by scenarios.
- Reset removes only fixture-owned data.
- Scenario runner can start from a clean fixture state.

**Verification:**

- Backend focused tests for disabled, production fail-closed, seed, reset, and
  transaction behavior.
- `pnpm exec tsc --noEmit --pretty false`
- `npm run build`
- `pnpm --dir tools/dispatch-lab build`

### `DL-10` Add Headless Scenario Execution

**Goal:** allow the same scenario catalog to run without manual UI interaction.

**Depends on:** `DL-5`, preferably `DL-9`.

**Tasks:**

- Move scenario definitions and runner core into UI-independent modules.
- Add a Node or Playwright entrypoint that loads lab config from environment
  variables.
- Add report output as JSON.
- Add nonzero exit code on failed scenario.
- Keep the browser UI using the same scenario definitions.

**Expected files:**

- `tools/dispatch-lab/src/scenarios/index.ts`
- `tools/dispatch-lab/scripts/run-scenarios.ts`
- `tools/dispatch-lab/reports/.gitkeep` if reports are ignored.

**Acceptance criteria:**

- One command can run all scenarios headlessly.
- Reports include scenario status, failed step, transcripts, and entity ids.
- UI and headless runner share scenario definitions.

**Verification:**

- `pnpm --dir tools/dispatch-lab run scenarios`
- `pnpm --dir tools/dispatch-lab build`

### `DL-11` Polish, Documentation, and Operator Handoff

**Goal:** make the tool usable by developers and testers without chat context.

**Depends on:** `DL-7` or later.

**Tasks:**

- Add a README for local setup.
- Document required backend env vars and fixture prerequisites.
- Document how to run manual flows.
- Document how to run automated scenarios.
- Add troubleshooting notes for common auth, CORS, Socket.IO, and fixture failures.
- Add a final scenario coverage matrix.

**Expected files:**

- `tools/dispatch-lab/README.md`
- `docs/dispatch/dispatch-lab-plan.md`

**Acceptance criteria:**

- A new agent or developer can run the app from documented commands.
- A tester can run the scenario catalog and interpret failures.
- The coverage matrix maps scenarios to backend endpoints/events.

**Verification:**

- Follow the README from a clean checkout.
- `pnpm --dir tools/dispatch-lab build`

## Scenario Coverage Matrix

| Scenario ID | Flow                                      | Required APIs/events                                                                             | Primary assertions                                         |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `SC-001`    | Fare estimate succeeds                    | `POST /fare-estimates`                                                                           | Fare estimate id, route, fare, expiry                      |
| `SC-002`    | Ride request creates                      | `POST /ride-requests`, `GET /ride-requests/current`                                              | Request state `searching`, fare snapshot                   |
| `SC-003`    | Request idempotency                       | `POST /ride-requests` twice                                                                      | Same request id returned                                   |
| `SC-004`    | Driver receives offer                     | `GET /dispatch-offers/current`, `dispatch_offer.created.v1` realtime                             | Pending offer visible to driver                            |
| `SC-005`    | Driver accepts offer                      | `POST /dispatch-offers/:id/accept`, `GET /ride-requests/current`, `GET /dispatch-offers/current` | Request assigned, offer accepted, assignment snapshot      |
| `SC-006`    | Driver rejects offer                      | `POST /dispatch-offers/:id/reject`, `GET /dispatch-offers/current`                               | Offer rejected, driver has no current rejected offer       |
| `SC-007`    | Offer expires                             | offer expiry worker/event, `GET /dispatch-offers/current`                                        | Offer expired, driver excluded from current offer          |
| `SC-008`    | Rider cancels while searching             | `POST /ride-requests/:id/cancel`, `GET /ride-requests/current`, `GET /ride-requests/history`     | Request terminal, current null, history includes request   |
| `SC-009`    | Rider cancels while offered               | `POST /ride-requests/:id/cancel`, offer cancellation event                                       | Request and pending offer cancelled                        |
| `SC-010`    | Rider cancels after assignment            | `POST /ride-requests/:id/cancel`, assignment/request/offer cancellation events                   | Driver released, no rematch, history includes cancellation |
| `SC-011`    | Driver cancels after assignment           | `POST /dispatch-assignments/:id/cancel`                                                          | Request/offer cancelled, cancellation actor is driver      |
| `SC-012`    | Driver arrives at pickup                  | `POST /dispatch-assignments/:id/arrive-at-pickup`                                                | Pickup state `arrived`, timestamps present                 |
| `SC-013`    | Rider warning after arrival wait          | pickup reminder event or snapshot                                                                | Pickup state `warning_sent`                                |
| `SC-014`    | Driver cancels rider no-show              | `POST /dispatch-assignments/:id/cancel-rider-no-show`                                            | Request cancelled, reason `rider_no_show`, driver released |
| `SC-015`    | Rider history is bounded                  | `GET /ride-requests/history?limit=&offset=`                                                      | Terminal only, ordered newest first                        |
| `SC-016`    | Driver history is bounded                 | `GET /dispatch-assignments/history?limit=&offset=`                                               | Assigned terminal rides only, ordered newest first         |
| `SC-017`    | Rider reconnect snapshot                  | Socket `dispatch:snapshot:request`                                                               | Active rider request recovered                             |
| `SC-018`    | Driver reconnect snapshot                 | Socket `dispatch:snapshot:request`                                                               | Active driver offer recovered                              |
| `SC-019`    | Terminal records excluded from current    | current and history endpoints                                                                    | Current null, history populated                            |
| `SC-020`    | Cancellation details include reason/notes | cancellation endpoints plus current/history snapshots                                            | Reason code and notes preserved                            |

## Endpoint Client Checklist

The REST client should include wrappers for:

- `POST /api/v1/fare-estimates`
- `POST /api/v1/ride-requests`
- `GET /api/v1/ride-requests/current`
- `GET /api/v1/ride-requests/:id`
- `POST /api/v1/ride-requests/:id/cancel`
- `GET /api/v1/ride-requests/history`
- `GET /api/v1/dispatch-offers/current`
- `POST /api/v1/dispatch-offers/:id/accept`
- `POST /api/v1/dispatch-offers/:id/reject`
- `POST /api/v1/dispatch-assignments/:id/arrive-at-pickup`
- `POST /api/v1/dispatch-assignments/:id/cancel-rider-no-show`
- `POST /api/v1/dispatch-assignments/:id/cancel`
- `GET /api/v1/dispatch-assignments/history`

The realtime client should support:

- connect to `/dispatch`;
- authenticate with `auth.token: "Bearer <token>"`;
- record all server events;
- emit `dispatch:snapshot:request`;
- correlate events to known request, offer, and assignment ids.

## Acceptance Criteria

- A developer can run all core dispatch scenarios without Postman.
- A tester can manually reproduce any automated scenario through the UI.
- Every run records REST calls, realtime events, entity ids, and final state.
- Failures identify the exact failed step and relevant backend response.
- The tool does not weaken backend authorization or create production-only paths.
- The tool can be disabled completely outside local/dev/staging environments.

## Open Decisions

- Final app location: `tools/dispatch-lab` vs `apps/dispatch-lab`.
- Whether fixture seed/reset is implemented in the backend or handled through
  existing admin/test flows.
- Whether scenario definitions should be shared with Playwright from day one.
- Whether staging deployment should require VPN, admin auth, or both.
