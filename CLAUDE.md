# UbelBackend

## Knowledge Base

All product docs live in `../UbelDocs/`. Always read `../UbelDocs/CONTEXT.md` first before any work in this repo — it's the living 3-page summary of the current product state.

Full docs structure:

- `../UbelDocs/CONTEXT.md` — start here
- `../UbelDocs/flows/user-flows.md` — auth, registration, ride flows
- `../UbelDocs/architecture/system-overview.md` — tech stack, DB schema, APIs
- `../UbelDocs/decisions/` — ADRs for major decisions
- `../UbelDocs/meeting-notes/` — daily meeting notes

## Coding Rules

### Test-Driven Development (strict)

Always follow TDD via the `/tdd` skill. Workflow per change: write a failing test, make it pass with the smallest change, refactor.

- **Minimum bar for every new module/service/controller:** unit tests covering the public API and the error/edge cases that matter
- **Then:** integration tests for cross-module flows (controller → service → DB / Redis / storage). Use a real Postgres + Redis from `docker-compose.yml`, not mocks, when the test exercises infra it depends on
- **Coverage tests:** only when the user explicitly asks
- **Meaningful only.** Tests must assert real behavior. Do not write tests that only re-check what TypeScript already proves, exercise no logic, or pad coverage. If a test wouldn't fail on a realistic regression, delete it
- A task is not "done" until its tests pass and the suite is green

### NestJS best practices (strict)

Always follow the `/nestjs-best-practices` skill — feature modules, dependency injection, exception filters, validation pipes, scope awareness, repository pattern, etc. Reference the rule prefixes (`arch-`, `di-`, `error-`, `security-`, `perf-`, `test-`, `db-`, `api-`, `micro-`, `devops-`) when explaining design choices.

### Logging

Always use NestJS's `Logger` class with the level that matches the use case. **Never** use `console.log`, `console.warn`, `console.error`, or any other `console.*` method anywhere in the project.

- `logger.log(...)` — informational events (startup, business milestones)
- `logger.debug(...)` — fine-grained diagnostics
- `logger.verbose(...)` — extra detail beyond debug
- `logger.warn(...)` — recoverable issues, suspicious states
- `logger.error(message, stack?, context?)` — exceptions and failures (always pass the stack)
- `logger.fatal(...)` — unrecoverable conditions

Inside classes: `private readonly logger = new Logger(MyClass.name)`. Outside classes (e.g. `main.ts`): `const logger = new Logger('Bootstrap')`.

Treat any `console.*` call in the repo as a defect. Replace it when it is in the approved task's scope; otherwise record it as an existing-system finding rather than making an unrelated change.

### API Versioning

The API is mounted under a global `api` prefix, and URI versioning is enabled with prefix `v` and default `1`, so every route is reachable under `/api/v1/...`. Every controller must opt into a version explicitly — never expose an un-versioned route.

- Default new endpoints to v1: `@Controller({ path: 'auth', version: '1' })` → resolves to `/api/v1/auth/...`
- When introducing a breaking change, ship the new version alongside the old one (`version: '2'`) — don't mutate v1's contract
- Keep the version on the controller, not on individual `@Get`/`@Post` decorators, unless a single endpoint genuinely diverges from its peers
- Per-version docs live at `/api/v1/docs` (Scalar), `/api/v1/swagger` (Swagger UI), and `/api/v1/api-json` (OpenAPI JSON). The OpenAPI server URL is `/api/v1`; per-path keys are stripped of the prefix so Scalar's `server.url + path` doesn't double up.

### Input validation (strict whitelisting)

Every incoming DTO must reject unknown / extra keys — only fields declared in the schema may pass. Treat the schema as the only allow-list for the request body / query / params; never silently strip.

- **Use `createStrictDto` from `src/common/dto`, never `createZodDto` directly.** The helper auto-applies `.strict()` so the outer object always rejects extras.
- Apply `.strict()` to nested objects yourself — the helper only strict-locks the outer shape.
- Don't rely on the validation pipe to strip extras — be loud about garbage input.

### Response serialization

Every controller method that returns a body must declare its response shape via `@ZodSerializerDto(SomeDto)` from `nestjs-zod`. The global `ZodSerializerInterceptor` is wired in `app.module.ts`; without the decorator on a route, the response is returned untouched, which leaks internal fields. No `@ZodSerializerDto` → assume the route is unsafe to ship.

### Database transactions

Follow the stricter transaction rule in `AGENTS.md`: writes, read-modify-write flows, multiple related reads, and cross-table persistence must use a transaction whenever a transaction-capable executor exists. Pass the `tx` handle down — never let nested service calls open their own connection inside a logical transaction.

### Instant Ride dispatch project

Before any Instant Ride dispatch implementation or related existing-system change, read:

1. `docs/dispatch/README.md`
2. `docs/dispatch/current-status.md`
3. The active phase playbook linked from the status file

Do not implement until the user explicitly approves the current task's requirements, assumptions, schema/API effects, acceptance criteria, and test plan. Investigation and documentation can proceed without separate implementation approval. Follow strict TDD and keep each task aligned to one roadmap task ID.

### File uploads

When `multer` is wired for file uploads, set explicit `limits` (`fileSize`, `files`) on the `MulterModule` registration and an `accept` allow-list on `FileInterceptor` / `FileFieldsInterceptor`. Body-parser limits live in `JSON_BODY_LIMIT`; multipart caps are separate.

### Commits

After each completed task, make a **tiny, surgical, atomic commit** — one logical change per commit. Workflow:

1. Confirm the task is genuinely done.
2. Verify the project still builds and type-checks cleanly: `pnpm exec tsc --noEmit && pnpm build`. If tests exist for the touched area, run them too.
3. Stage **only** the files for that one logical change. No drive-by edits, no bundling unrelated changes.
4. Show the proposed Conventional Commit message to the user and wait for explicit confirmation before committing.
5. Each commit must stand on its own — build/typecheck must pass at every commit, so the history is bisectable.

Never commit without confirmation. Never include AI attribution / `Co-Authored-By` trailers.
