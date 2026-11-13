# Implementation Plan

The milestones below are intentionally sequential. Each should leave the repository in a coherent, reviewable state and be represented by one meaningful commit (or a small number only if review requires it). Application code should begin only after `ARCHITECTURE.md` is approved.

## 0. Agree on architecture and contract

**Work**

- Review `ARCHITECTURE.md`.
- Confirm state transitions, required idempotency key, status-override semantics, JSON persistence, authentication mode, and documented limitations.
- Adjust the design before implementation begins.

**Acceptance criteria**

- The API request/response shapes and status codes are unambiguous.
- Failure, retry, restart, and concurrency behavior are explicitly agreed.
- Scope exclusions are visible.
- No Node.js project or application code has been generated yet.

**Suggested commit:** `docs: define payment service architecture and delivery plan`

## 1. Bootstrap TypeScript quality tooling

**Work**

- Initialize the Node.js project after architecture approval.
- Add TypeScript, Express, Zod, Pino, Vitest, Supertest, linting, and formatting dependencies.
- Add strict TypeScript configuration and scripts for development, build, start, type-check, lint, format-check, and test.
- Add `.gitignore`, `.env.example`, and minimal source/test directory structure.

**Acceptance criteria**

- The project installs from its lockfile.
- `build`, `typecheck`, `lint`, and `test` commands run successfully on the empty scaffold.
- Runtime and package-manager versions are documented or pinned.
- No domain behavior is implemented yet.

**Suggested commit:** `chore: bootstrap strict TypeScript service tooling`

## 2. Define configuration, domain types, and state rules

**Work**

- Parse environment configuration once with Zod.
- Define payment, status, failure, and idempotency types.
- Implement the pure state-transition policy and public representation mapping.
- Introduce injectable clock and ID-generator interfaces where determinism matters.

**Acceptance criteria**

- Invalid configuration fails fast with an actionable error.
- Unit tests cover every allowed and forbidden state transition.
- Terminal states cannot be reopened.
- Domain code has no Express or filesystem dependency.

**Suggested commit:** `feat: define payment domain and lifecycle rules`

## 3. Implement and harden persistence

**Work**

- Define the payment repository contract, including atomic create-with-idempotency, due-work claim, and versioned updates.
- Add an in-memory repository for focused tests.
- Add the versioned JSON-file repository with startup validation, serialized mutations, temporary-file write, flush, and atomic rename.
- Handle unsupported/corrupt storage without destroying it.

**Acceptance criteria**

- Payments and idempotency records survive repository re-instantiation.
- Concurrent mutations do not lose updates in one process.
- Stale version updates are rejected.
- An interrupted/failed write never replaces the last valid snapshot.
- Corrupt or incompatible data makes startup fail clearly and preserves the file.
- Tests use isolated temporary directories and leave no repository artifacts.

**Suggested commit:** `feat: add atomic JSON payment repository`

## 4. Add payment application use cases

**Work**

- Implement create, retrieve, and operator status-update use cases using integer minor-unit `amount` values.
- Normalize and hash create requests for idempotency.
- Define typed application errors for validation-independent cases such as not found, conflict, invalid transition, and stale version.

**Acceptance criteria**

- A new request atomically creates one `pending` payment and idempotency record.
- Repeating a key with the same payload returns the original payment.
- Repeating a key with a different payload conflicts.
- Status updates enforce source-state, target-state, failure-code, and version rules.
- Use cases are covered without starting an HTTP server.

**Suggested commit:** `feat: implement idempotent payment use cases`

## 5. Expose the REST API and error handling

**Work**

- Add an application factory and Express routes for create, retrieve, and status update.
- Validate params, headers, and strict JSON bodies with Zod.
- Add request IDs, body limits, baseline security headers, authentication, general and mutation-specific rate limiting, 404 handling, and centralized error mapping.
- Add liveness and readiness endpoints.

**Acceptance criteria**

- `POST /payments` returns `202` and `Location` for a new request and `200` for a replay.
- `GET /payments/:id` and `PATCH /payments/:id/status` match the documented contract.
- Error status codes and envelopes match `ARCHITECTURE.md`.
- Unknown exceptions produce a sanitized `500`.
- Auth secrets and framework-identifying headers are not exposed.
- General traffic and mutation endpoints have configurable limits; excess requests return the standard `429` error envelope and rate-limit headers.
- Health checks are not rate-limited, and forwarded client IPs are trusted only when proxy configuration explicitly allows them.
- Supertest covers success, validation, authentication, not-found, conflict, stale version, and unexpected-error paths.

**Suggested commit:** `feat: expose validated payment REST API`

## 6. Implement the asynchronous worker and simulator

**Work**

- Define the gateway interface and deterministic simulated provider.
- Implement polling, atomic claims, attempt timeout, error classification, bounded exponential retry, and terminal completion.
- Use the payment ID as the downstream idempotency key.
- Ensure timers and dependencies can be controlled in tests.

**Acceptance criteria**

- Creation responds before delayed processing completes.
- Due payments are claimed once per active state/version and eventually reach a terminal state.
- Permanent failures do not retry; transient failures retry only to the configured maximum.
- Timeouts and unknown errors cannot leave work permanently stuck.
- A late result cannot overwrite an operator status update.
- Tests are deterministic and do not rely on random outcomes or wall-clock sleeps.

**Suggested commit:** `feat: process payments asynchronously with bounded retries`

## 7. Add restart recovery and graceful lifecycle

**Work**

- Recover expired `processing` leases on startup.
- Process persisted `pending` work after restart.
- Define startup/readiness ordering.
- Handle `SIGTERM` and `SIGINT` with bounded HTTP and worker shutdown.

**Acceptance criteria**

- The service is not ready before configuration and persistence initialization succeed.
- Pending payments resume after a simulated restart.
- Only expired processing leases are requeued.
- Shutdown stops new claims and allows active work a bounded completion period.
- Lifecycle tests leave no open handles.

**Suggested commit:** `feat: recover payment work across service restarts`

## 8. Add structured, redacted logging

**Work**

- Configure Pino and HTTP request logging.
- Add structured lifecycle and worker events with request/payment correlation.
- Redact secrets, idempotency keys, authorization values, and request bodies.
- Choose sensible log levels for expected versus unexpected failures.

**Acceptance criteria**

- Request completion and every worker attempt/outcome can be correlated.
- Captured-log tests prove sensitive headers and request bodies are absent.
- Internal exceptions are logged with context while client responses remain sanitized.
- Tests can silence or capture logs without global mutation.

**Suggested commit:** `feat: add correlated and redacted service logging`

## 9. Publish API and operator documentation

**Status:** complete. The contract is checked in as `openapi.json` and served at `/openapi.json`; `/doc` provides Swagger UI using pinned CDN assets. The README includes configuration and runnable operating scenarios, `tests/unit/openapi-contract.test.ts` checks key contract/schema drift, and documentation-route tests cover the UI/spec endpoints and security behavior.

**Work**

- Add the OpenAPI 3.1 contract with schemas, examples, authentication, rate-limit headers, and all error responses.
- Serve `/openapi.json` and Swagger UI at `/doc` using pinned CDN assets.
- Add a README with setup, configuration, commands, `curl` examples, architecture summary, state diagram, and limitations.
- Document how to observe successful, failed, retried, replayed, and manually finalized payments.

**Acceptance criteria**

- A reviewer can run and exercise the service from the README alone.
- OpenAPI documents all implemented responses and required headers.
- OpenAPI and README state that `amount` is an integer minor-unit count and show that `2500 NGN` is 2,500 kobo (₦25.00).
- A contract test or schema test detects drift between key runtime schemas and documentation.
- Limitations and the single-process deployment constraint remain prominent.

**Suggested commit:** `docs: publish payment API and operating guide`

## 10. Complete end-to-end verification and delivery polish

**Status:** implementation and regression coverage complete; unrestricted release verification pending. See [VERIFICATION.md](./VERIFICATION.md): 143 non-socket tests pass, while the 14 Supertest scenarios are blocked by socket permissions and registry access prevents the audit/clean-install checks. A CI workflow runs the full verification commands without exclusions.

**Work**

- Add remaining integration tests for races, disk failures, retries, recovery, and shutdown.
- Run formatting, linting, type-checking, unit/integration tests, build, and dependency audit.
- Review dependency necessity, public error messages, logs, generated artifacts, and repository cleanliness.
- Add a small CI workflow if permitted by the assessment.

**Acceptance criteria**

- All documented quality commands pass from a clean checkout.
- Tests cover the highest-risk failure and concurrency paths, not only happy paths.
- No secrets, runtime data, coverage output, or build output are committed.
- There are no flaky sleeps, random assertions, unhandled rejections, or open handles.
- The implementation matches the approved architecture, or deviations are documented with rationale.

**Suggested commit:** `test: verify payment lifecycle failure and recovery paths`

## Final review checklist

- [x] Key API schemas, examples, and response codes agree with OpenAPI in contract tests.
- [x] Idempotent create is atomic and tested.
- [x] Invalid transitions and stale writes cannot corrupt terminal state.
- [x] HTTP response is independent from asynchronous processing completion.
- [x] Retries are bounded, classified, and observable.
- [x] Pending and abandoned work recover after restart.
- [x] JSON writes are serialized and atomically replace valid storage.
- [x] Startup/shutdown ordering, deadlines, and failures have deterministic tests.
- [x] Errors are useful to clients without leaking internals.
- [x] Logs are structured, correlated, and redact sensitive values.
- [x] Authentication and input/resource bounds are implemented with tests.
- [x] Executed unit and integration tests are deterministic and isolated.
- [x] Scope limitations and production migration path are candidly documented.
- [ ] Full Supertest suite passes in an environment that permits socket binding.
- [ ] Clean installation and registry-backed dependency audit pass.
- [ ] Real process startup/shutdown and browser documentation smoke checks pass locally or in CI.
