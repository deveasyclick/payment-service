# Payment Service Architecture

## Table of contents

- [1. Goals and scope](#1-goals-and-scope)
- [2. Proposed runtime structure](#2-proposed-runtime-structure)
- [3. Domain model](#3-domain-model)
- [4. Payment state machine](#4-payment-state-machine)
- [5. HTTP API contract](#5-http-api-contract)
- [6. Validation and bounds](#6-validation-and-bounds)
- [7. Persistence and consistency](#7-persistence-and-consistency)
- [8. Asynchronous processing, retries, and recovery](#8-asynchronous-processing-retries-and-recovery)
- [9. Concurrency model](#9-concurrency-model)
- [10. Security](#10-security)
- [11. Logging and observability](#11-logging-and-observability)
- [12. Configuration and lifecycle](#12-configuration-and-lifecycle)
- [13. Testing strategy](#13-testing-strategy)
- [14. API documentation](#14-api-documentation)
- [15. Explicit tradeoffs and limitations](#15-explicit-tradeoffs-and-limitations)

## 1. Goals and scope

This service accepts payment intents, exposes their current state, permits an explicit status update, and processes new payments asynchronously. It is intentionally a **single Node.js process** with JSON-file persistence and an in-process worker. The design still gives clear answers for duplicate requests, restarts, retries, concurrent updates, invalid state transitions, and corrupt storage.

The service does **not** collect or store card numbers, bank credentials, or other payment instruments. A payment represents a request to a simulated provider, not a complete real-world money movement system.

### Design priorities

1. Correct and observable behavior is more important than throughput.
2. HTTP requests must not wait for simulated provider processing.
3. State changes must survive a normal process restart.
4. Duplicate client requests and worker retries must not create duplicate payments.
5. Infrastructure should remain appropriate for a short take-home exercise.

## 2. Proposed runtime structure

```text
HTTP client
    |
    v
Express routes -> Zod validation -> Payment service -> Payment repository
                                      |                    |
                                      |                    v
                                      |             JSON file (atomic replace)
                                      v
                              in-process worker
                                      |
                                      v
                           simulated payment gateway
```

The application will be separated into small layers:

- **HTTP layer:** Express routes, validation, authentication, request IDs, and error mapping.
- **Application layer:** use cases and payment state-transition rules.
- **Repository:** persistence interface plus a JSON-file implementation.
- **Worker:** claims due payments, invokes the gateway, and schedules retries.
- **Gateway:** injectable interface with a simulated implementation.

**Why:** these boundaries keep Express and file I/O out of domain logic, make failure behavior unit-testable, and allow the JSON repository or simulator to be replaced without redesigning the service. A message broker, ORM, and dependency-injection framework would add more setup than value at this scale, so they are deliberately excluded.

### Source layout

```text
payment-service/
├── src/
│   ├── app.ts
│   ├── main.ts
│   ├── server.ts
│   ├── server.types.ts
│   ├── config/
│   │   ├── config.const.ts
│   │   ├── config.schema.ts
│   │   └── index.ts
│   ├── modules/
│   │   └── payments/
│   │       ├── payment.const.ts
│   │       ├── payment.controller.ts
│   │       ├── payment.errors.ts
│   │       ├── payment-idempotency.ts
│   │       ├── payment.schemas.ts
│   │       ├── payment.state-machine.ts
│   │       ├── payment.mapper.ts
│   │       ├── payment.service.ts
│   │       ├── payment.worker.ts
│   │       ├── payment.routes.ts
│   │       ├── repositories/
│   │       │   └── json-payment.repository.ts
│   │       └── types/
│   │           ├── payment-gateway.types.ts
│   │           ├── payment-http.types.ts
│   │           ├── payment-repository.types.ts
│   │           ├── payment-service.types.ts
│   │           ├── payment-worker.types.ts
│   │           └── payment.types.ts
│   ├── infrastructure/
│   │   ├── documentation/
│   │   │   ├── documentation.const.ts
│   │   │   └── documentation.routes.ts
│   │   ├── storage/
│   │   │   ├── atomic-file-writer.ts
│   │   │   ├── payment-storage-state.ts
│   │   │   ├── storage.const.ts
│   │   │   ├── storage.errors.ts
│   │   │   ├── storage.schemas.ts
│   │   │   └── storage.types.ts
│   │   ├── gateway/
│   │   │   └── simulated-payment.gateway.ts
│   │   └── logging/
│   │       ├── logging.const.ts
│   │       └── logger.ts
│   ├── middleware/
│   │   ├── authenticate.ts
│   │   ├── error-handler.ts
│   │   ├── rate-limit.ts
│   │   ├── request-id.ts
│   │   └── request-logging.ts
│   └── shared/
│       ├── errors/
│       │   ├── configuration.errors.ts
│       │   └── http.errors.ts
│       ├── helpers/
│       │   ├── clock.ts
│       │   ├── id-generator.ts
│       │   └── mutation-queue.ts
│       └── types/
│           ├── clock.types.ts
│           ├── config.types.ts
│           ├── http.types.ts
│           ├── id-generator.types.ts
│           └── logger.types.ts
├── tests/
│   ├── unit/
│   │   ├── modules/
│   │   │   └── payments/
│   │   │       ├── payment-idempotency.test.ts
│   │   │       ├── payment-mapper.test.ts
│   │   │       └── payment-state-machine.test.ts
│   │   ├── infrastructure/
│   │   │   ├── logger.test.ts
│   │   │   └── simulated-payment-gateway.test.ts
│   │   ├── shared/
│   │   │   └── helpers.test.ts
│   │   ├── server.test.ts
│   │   ├── request-logging.test.ts
│   │   ├── openapi-contract.test.ts
│   │   ├── documentation-routes.test.ts
│   │   ├── health-and-errors.test.ts
│   │   └── config.test.ts
│   ├── integration/
│   │   ├── atomic-file-writer.test.ts
│   │   ├── payment-lifecycle.test.ts
│   │   ├── payment-repository.test.ts
│   │   ├── payment-service.test.ts
│   │   ├── payment-worker.test.ts
│   │   ├── startup-logging.test.ts
│   │   ├── payments-api.test.ts
│   │   └── json-payment-repository.test.ts
│   └── helpers/
│       ├── capture-logs.ts
│       ├── create-test-payment-repository.ts
│       ├── payment-fixtures.ts
│       ├── request-app.ts
│       └── scripted-payment-gateway.ts
├── openapi.json
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── TASKS.md
│   └── VERIFICATION.md
├── .github/
│   └── workflows/
│       └── ci.yml
└── README.md
```

Responsibilities and dependency rules:

- `app.ts` creates the Express application without opening a port; `main.ts` loads configuration, wires concrete dependencies, starts the server, and registers signal handlers.
- `server.ts` contains the `PaymentServer` class, which owns readiness, startup/shutdown ordering, worker lifecycle, HTTP shutdown deadlines, and signal handling. Types are in `server.types.ts`. The class accepts injected dependencies and can be imported without side effects; `main.ts` is the executable entry point.
- `modules/payments` owns payment-specific types, state rules, use cases, repository contracts and implementations, worker orchestration, and routes.
- `infrastructure/storage` owns file-database mechanics, serialization schemas, the versioned storage document, and atomic file replacement. This mirrors the boundary between database infrastructure and feature repositories in a database-backed service.
- Other `infrastructure` folders contain cross-module technical adapters such as the simulated gateway and Pino. Domain rules do not import these implementations.
- `middleware` contains cross-cutting Express behavior rather than payment business logic.
- `shared` contains only reusable cross-module concerns. Every file is grouped by purpose: errors, helpers, or types. Payment-specific type files live in `modules/payments/types/`. Payment domain, repository, and gateway/worker error classes are consolidated in `modules/payments/payment.errors.ts`.
- Tests are separated by scope. Unit tests mirror the payment module; integration tests cover API, persistence, and worker boundaries; test doubles stay under `tests/helpers`.
- The runtime JSON data directory is not part of the committed source tree. The repository creates the parent directory for the configured path (for example, `./data/payments.json`), and generated data is ignored by Git.

The intended dependency direction is:

```text
routes -> payment service -> repository/gateway interfaces
                                  ^
                                  |
       module repositories / infrastructure adapters
```

**Why:** a module-first layout keeps the only business capability cohesive while leaving room for future modules. Interfaces stay near the payment use cases that consume them, concrete adapters remain replaceable, and the structure avoids unnecessary controller/DTO/mapper layers for three endpoints.

## 3. Domain model

### Payment

| Field                 | Type                          | Purpose                                                                                   |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                  | UUID                          | Stable public identifier generated by the server.                                         |
| `amount`              | positive integer              | Amount in the currency's minor unit; using an integer avoids floating-point money errors. |
| `currency`            | three-letter uppercase string | ISO 4217-style currency code. A small supported-currency allowlist may be configured.     |
| `reference`           | string, optional              | Client-visible business reference; not assumed unique.                                    |
| `status`              | enum                          | `pending`, `processing`, `succeeded`, or `failed`.                                        |
| `attemptCount`        | non-negative integer          | Number of gateway attempts started.                                                       |
| `nextAttemptAt`       | timestamp, optional           | Earliest time the worker may retry.                                                       |
| `processingStartedAt` | timestamp, optional           | Enables recovery of abandoned work after restart.                                         |
| `failureCode`         | string, optional              | Stable, non-sensitive terminal failure category.                                          |
| `createdAt`           | timestamp                     | UTC ISO-8601 creation time.                                                               |
| `updatedAt`           | timestamp                     | UTC ISO-8601 last-change time.                                                            |
| `version`             | positive integer              | Incremented on mutation for optimistic concurrency checks.                                |

Internal retry details are retained for processing and diagnostics. The public representation exposes `attemptCount`, timestamps, and a terminal `failureCode`, but never raw exception messages or credentials.

### Idempotency record

| Field         | Type      | Purpose                                                          |
| ------------- | --------- | ---------------------------------------------------------------- |
| `key`         | string    | Value supplied in `Idempotency-Key`; unique within this service. |
| `requestHash` | string    | SHA-256 of the normalized create payload.                        |
| `paymentId`   | UUID      | Payment created for this key.                                    |
| `createdAt`   | timestamp | Supports auditing and a future retention policy.                 |

The payment and its idempotency record are written in one repository mutation. The key is not returned in API responses or logs.

**Why:** integer minor units, server-generated IDs, and explicit timestamps eliminate common ambiguity. Keeping idempotency alongside payments makes the create operation atomic even with a very small persistence layer.

## 4. Payment state machine

```text
                 worker claim
pending ----------------------------> processing
   ^                                      |   |
   | transient failure, retry scheduled   |   | provider success
   +--------------------------------------+   v
                                          succeeded

                              permanent/exhausted failure
                         processing ----------------------> failed

Operator status update: pending|processing -> succeeded|failed
Terminal states: succeeded and failed (no further transitions)
```

Rules:

- A new payment starts as `pending`.
- Only the worker claims `pending` work as `processing`.
- A transient gateway error returns it to `pending` with `nextAttemptAt` set.
- A permanent error, or exhaustion of retry attempts, produces `failed`.
- Success produces `succeeded`.
- The status-update API is an operator override. It may move `pending` or `processing` directly to `succeeded` or `failed`; it cannot reopen or reverse a terminal payment.
- Every transition checks the expected current `version`. A race has one winner; the loser reloads the payment and either accepts the already-achieved outcome or reports a conflict.

**Why:** terminal states are immutable, which makes client reasoning and audit history simpler. The override endpoint satisfies the assessment's update requirement without allowing arbitrary or backward transitions. Optimistic checks prevent a late worker result from overwriting an operator decision.

## 5. HTTP API contract

All request and response bodies use JSON. Times are UTC ISO-8601 strings. Successful responses include `X-Request-Id`; clients may supply a valid `X-Request-Id`, otherwise the server creates one.

### `POST /payments`

Creates and queues a payment.

Headers:

- `Content-Type: application/json`
- `Idempotency-Key: <1-128 printable characters>` (required)
- `X-API-Key: <secret>` when authentication is configured

Request:

```json
{
  "amount": 2500,
  "currency": "NGN",
  "reference": "order-123"
}
```

`amount` is always an integer count of the selected currency's minor unit. For NGN, the minor unit is kobo, so `2500` means 2,500 kobo, or ₦25.00—not ₦2,500. The OpenAPI field description, README examples, and a supported-currency table will state each currency's minor-unit exponent. Clients never send decimal major-unit amounts.

Response for a new payment: `202 Accepted`

- `Location: /payments/{id}`
- Body contains the public payment representation in `pending` state.

Idempotent replay with the same normalized payload: `200 OK` with the same payment and `Idempotent-Replayed: true`. Reusing the key with a different payload returns `409 Conflict`.

**Why:** `202` reflects that provider work is unfinished. Requiring an idempotency key makes retry behavior explicit instead of silently risking two charges. The body is normalized before hashing so property ordering does not change identity.

### `GET /payments/:id`

Returns `200 OK` and the public payment, or `404 Not Found`. An invalid UUID is a `400 Bad Request` rather than a repository lookup.

### `PATCH /payments/:id/status`

Applies an operator override.

Request:

```json
{
  "status": "failed",
  "failureCode": "cancelled_by_operator",
  "expectedVersion": 2
}
```

- Allowed requested statuses are `succeeded` and `failed` only.
- `failureCode` is required for `failed` and forbidden for `succeeded`.
- `expectedVersion` is required and must equal the current version.
- Returns `200 OK` with the updated payment.
- Returns `409 Conflict` for an invalid transition.
- Returns `412 Precondition Failed` when `expectedVersion` is stale.
- Returns `404 Not Found` when the payment does not exist.

**Why:** including the expected version is simpler to demonstrate and test than hiding last-write-wins behavior. A body field is used instead of an HTTP ETag to keep the take-home API approachable; an ETag/`If-Match` contract would be the natural production evolution.

### Health endpoints

- `GET /health` and `GET /health/live`: process is running; `/health` is a liveness alias. Neither touches storage or depends on readiness.
- `GET /health/ready`: storage initialized and worker able to run.

These endpoints are intentionally small and return no configuration or sensitive diagnostics.

### Error format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "path": "/payments",
    "details": [{ "path": "amount", "message": "Must be a positive integer" }],
    "requestId": "..."
  }
}
```

Expected errors have stable machine-readable codes. Unknown errors return a generic `500 Internal Server Error`; stack traces and internal file paths are logged, never sent to clients. Unknown routes return the same envelope with `404`.

All errors include `error.path`, derived from the original request pathname so mounted route prefixes are retained. Query strings are excluded to avoid echoing query credentials. Validation `details[].path` continues to identify the invalid field rather than the request URL.

## 6. Validation and bounds

Zod schemas will validate route parameters, headers, and bodies. Objects are strict so misspelled fields are rejected. Initial bounds will be documented in the generated OpenAPI description:

- `amount`: integer from `1` through `999_999_999_999` minor units. For NGN this is kobo; for a typical two-decimal currency, divide by 100 for display only.
- `currency`: exactly three uppercase ASCII letters and, optionally, a configured allowlist.
- `reference`: 1-100 printable characters when present.
- JSON body limit: 16 KiB.

**Why:** integer minor units avoid rounding errors such as those introduced by binary floating-point values. The API documentation makes the unit explicit because the shorter field name alone does not. Explicit bounds prevent nonsensical values and reduce memory-abuse risk. The service stores no payment method, so PCI-sensitive fields are outside both schema and storage.

## 7. Persistence and consistency

The default repository stores a versioned document such as:

```json
{
  "schemaVersion": 1,
  "payments": {},
  "idempotencyRecords": {}
}
```

Persistence behavior:

1. Load and validate the complete file at startup.
2. Refuse readiness/startup on malformed JSON or an unsupported schema version; do not silently erase it.
3. Serialize all mutations through one in-process write queue.
4. Apply a mutation to an in-memory snapshot, write the complete next snapshot to a temporary file in the same directory, flush it, then atomically rename it over the data file.
5. Publish the new in-memory snapshot only after the durable write succeeds.
6. Surface write failures to the request/worker and log them with context.

The file is excluded from Git. The data directory is created on startup. JSON is the only payment persistence implementation. Repository, service, worker, and API tests use isolated temporary JSON files with automatic cleanup. Pure domain tests remain independent of storage. Keeping one implementation reduces maintenance and exercises the production persistence behavior throughout integration tests.

Startup validation checks state-specific requirements: processing payments require a lease timestamp and a started attempt, failed payments require a failure code, and retry timestamps are allowed only for pending payments. Idempotency keys use own-property lookups and entry-based validation so printable keys such as `constructor` and `__proto__` cannot collide with object prototypes or disappear during parsing.

**Why:** writing directly to the destination risks truncated JSON after a crash. Atomic replacement plus serialized mutations is compact and adequate for one process. A repository boundary preserves a clean migration path to PostgreSQL, where unique idempotency keys and row versions would enforce the same invariants.

## 8. Asynchronous processing, retries, and recovery

The worker starts after repository initialization and stops accepting work during graceful shutdown.

- It polls for due `pending` payments at a modest configurable interval (for example, 250 ms).
- It claims a payment by changing `pending` to `processing`, incrementing `attemptCount`, recording `processingStartedAt`, and incrementing `version` in one serialized mutation.
- Worker concurrency defaults to `1`. This is enough to demonstrate background processing and avoids pretending a JSON file is a high-throughput queue.
- The simulated gateway is asynchronous and configurable for latency. Tests inject a scripted gateway, so no test depends on randomness or real time.
- Transient failures retry up to 3 total attempts with exponential backoff (for example, 250 ms then 500 ms) plus bounded jitter in runtime. Tests inject the clock/backoff or disable jitter.
- Permanent failures fail immediately. Unknown gateway exceptions are treated as transient until attempts are exhausted, while only a sanitized failure code is persisted.
- A per-attempt timeout prevents the worker from waiting forever.
- On startup and before each claim, a `processing` payment with an expired lease is requeued if attempts remain, or failed with `attempts_exhausted`. Still-active leases are rechecked on later polls, covering quick restarts and completion write failures without requiring another restart. Interrupted claims consume attempts.
- Graceful shutdown stops polling and waits for an active attempt only up to a bounded deadline. At the deadline the attempt is aborted and its persisted claim retained for recovery; no retry is written during the abort path. The gateway must release its own resources on cancellation. Already-running native filesystem operations cannot be cancelled by this deadline.

The worker's completion update includes the version it claimed. If an operator changed the payment meanwhile, the completion becomes a no-op and is logged rather than overwriting the newer state.

**Why:** processing after the HTTP response proves genuine asynchronous behavior. Bounded retries address temporary failure without an infinite loop. Lease recovery acknowledges that a process can die between claim and completion. An injected gateway and clock keep tests fast and deterministic.

### Worker process boundary

The API and worker deliberately run in the same Node.js process. `main.ts` injects the same repository instance into the API and worker, then starts them through `PaymentServer`, so all HTTP and worker mutations pass through one write queue and read the latest published snapshot. No separate worker command is provided.

The JSON repository loads its document into memory at initialization. A separate worker process would have its own cached document and mutation queue. It would not observe payments created by the API after initialization, and writes from either process could replace the other's newer document. For example, an API write adding payment B could be lost when the worker saves payment A using an older snapshot that does not contain B. Atomic rename protects file integrity, but provides no cross-process locking or transaction isolation. Likewise, `version` comparisons against separate cached snapshots cannot prevent these lost updates.

**Why:** sharing one process provides the consistency required here with minimal setup. Separate worker deployment would first require shared transactional storage, such as SQLite or PostgreSQL, with atomic claims and database-enforced version checks. An independent worker entry point can then reuse the existing worker and gateway boundaries. File watching or periodic reloads alone would not make concurrent read-modify-write operations safe. Multiple API or worker processes must never share the current JSON file.

### Delivery semantics

Processing is **at least once**, not exactly once. A crash can occur after the simulated provider accepts a request but before local success is saved. The worker therefore passes the payment ID as the provider idempotency key on every attempt. The simulator will model idempotent provider behavior.

**Why:** claiming exactly-once delivery would be misleading without transactional integration with a provider. Stable downstream idempotency is the standard practical defense.

## 9. Concurrency model

All repository writes are serialized inside the process, and each update is compare-and-set against `version` and allowed source state. Reads use immutable snapshots. This covers overlapping HTTP requests, worker completion, and retry scheduling in one process.

Multiple service processes must **not** share the JSON file: in-process queues cannot coordinate across processes, and rename-based writes could lose data. Horizontal scaling requires a transactional database and a durable queue or database-backed job-claim mechanism.

**Why:** the limitation is made explicit rather than adding a fragile file lock. The chosen mechanism is easy to audit and test for the required deployment shape.

## 10. Security

- Optional static API-key authentication is configured through an environment variable. If enabled, comparisons are timing-safe. A production-mode startup without the secret fails fast; local development may explicitly run unauthenticated.
- The status override uses the same key in this assessment. Real deployment should use separate service/operator identities and authorization scopes.
- `helmet` supplies baseline HTTP security headers.
- Express identifies itself as little as practical (`x-powered-by` disabled).
- Request bodies have a small limit; validation rejects unknown fields and malformed IDs.
- `express-rate-limit` applies an IP-based general limit (proposed default: 100 requests per 15 minutes) and a stricter mutation limit for `POST /payments` and `PATCH /payments/:id/status` (proposed default: 20 requests per minute). Health checks are excluded. Limit responses use the normal error envelope with `429 Too Many Requests` and standard `RateLimit` headers.
- Proxy trust is disabled by default and must be explicitly configured for the known deployment proxy count; blindly trusting forwarded IP headers would let callers bypass an IP limit.
- Logs redact authorization/API-key/idempotency headers and do not log request bodies.
- Secrets and payment data files are ignored by Git and supplied through environment variables.
- CORS is disabled by default because this is a service API. An explicit origin allowlist is required if a browser client is later added.
- Error responses do not expose stack traces, raw provider errors, or filesystem details.
- Dependencies will be locked, and CI should run tests, type-checking, linting, and an audit appropriate to the assessment.

The limiter's default in-memory counter matches the service's single-process deployment. It resets on restart and does not coordinate across instances; a shared store such as Redis or gateway-level limiting would replace it when horizontally scaling. TLS termination, secret rotation, and full identity/RBAC remain deployment concerns.

**Why:** lightweight middleware provides useful protection against accidental floods and basic abuse without adding infrastructure. Separate mutation limits protect the endpoints that create work or change state, while explicit proxy configuration prevents a security control from relying on spoofable client IP data.

## 11. Logging and observability

Pino emits structured JSON logs. `pino-http` associates each request with `requestId`. Logs cover:

- request completion: method, original pathname (`req.path`), status, duration, and request ID;
- payment creation and idempotent replay using payment ID, never the idempotency key;
- worker claim, attempt number, retry scheduling, terminal outcome, and processing duration;
- stale-lease recovery and optimistic-concurrency conflicts;
- repository/startup/shutdown errors.

Expected client validation failures use an appropriate lower log level to avoid noisy error logs. Tests use a silent logger or captured stream. Metrics and distributed tracing are omitted, but the event fields are designed to make their later addition straightforward.

`requestId` links HTTP completion to payment creation/replay or status-update events, which include `paymentId`. Background events use that stable payment ID and `attemptCount`; the originating request ID is not persisted. A persisted retry or terminal result is logged only after the repository confirms the write. A version conflict produces `payment_worker_result_discarded` instead of a misleading completion event.

Request serialization allows only the method and original pathname; mounted prefixes are preserved and query strings excluded. Response serialization allows only the status. Query strings, headers, bodies, and payment references are omitted. Common secret/body fields are also redacted at the logger boundary. Error serialization keeps type and stack call sites, excluding messages, causes, and custom properties. This sacrifices raw error-message detail to avoid leaking provider payloads or credentials. Logs use fixed messages and allowlisted context; field redaction cannot sanitize arbitrary free text.

`info` records normal requests and persisted outcomes, `warn` records expected HTTP client errors, gateway exceptions/timeouts, and stale worker results, and `error` records unexpected HTTP, persistence, and polling failures. Logger instances and streams are injected; the app factory defaults to a silent logger. No mutable global logger is required.

Catch blocks must log a handled failure or propagate it to a logging boundary; empty catches and no-op rejection handlers are disallowed by ESLint. Secondary storage close/cleanup failures are logged without replacing the original write error. HTTP handling uses the injected logger directly, rather than an error-reporting callback that could silently fail. Configuration validation occurs inside the startup error boundary. If both listening and worker cleanup fail, an aggregate retains both failures, and the error serializer records their types and call sites without raw messages. Expected absence of a new storage file is recorded as an informational initialization event.

**Why:** structured, correlated events make asynchronous flows debuggable without leaking request bodies or secrets.

## 12. Configuration and lifecycle

Configuration is parsed once with Zod at startup. Expected settings include port, data-file path, API key/auth mode, rate-limit windows and maxima, trusted-proxy count, worker interval, attempt timeout, lease duration, maximum attempts, shutdown timeout, simulated latency, log level, and environment.

Startup order:

1. Validate configuration.
2. Initialize and validate repository storage.
3. Recover expired processing leases.
4. Start the worker.
5. Listen for HTTP traffic and report ready.

On `SIGTERM`/`SIGINT`, readiness turns false, the HTTP server stops accepting connections, the worker stops polling, active work receives a bounded grace period, and logs flush before exit.

**Why:** explicit lifecycle ordering avoids accepting payments before persistence is usable and makes shutdown behavior reviewable.

## 13. Testing strategy

Vitest and Supertest will cover behavior rather than implementation details.

### Unit tests

- State-machine allowed and forbidden transitions.
- Money/currency/request validation boundaries.
- Idempotency hash normalization and conflict behavior.

### Persistence and service integration tests

- Repository compare-and-set behavior and serialized concurrent mutations.
- JSON repository restart persistence, atomic-write failure behavior, and corrupt-file startup failure.
- Payment service creation, retrieval, idempotency, status updates, and concurrent operator updates against temporary JSON files.

### API integration tests

- Create returns `202`, `Location`, and a retrievable `pending` payment.
- Same idempotency key and payload replays; different payload conflicts.
- Invalid bodies, IDs, headers, and unknown routes use the documented error envelope.
- Status update succeeds from a non-terminal state and rejects stale versions or invalid transitions.
- Authentication behavior and header/log redaction.
- General and mutation rate limits return `429` with the documented envelope and headers; health checks remain available.
- Unexpected errors are mapped to a sanitized `500`.

### Worker integration tests

- Retry classification, backoff, exhaustion, timeout, and terminal outcomes with fake timers and a scripted gateway against the JSON repository.
- Tests wait for explicit claim/gateway events before advancing fake timers so filesystem timing cannot change the outcome.
- HTTP creation returns before delayed provider completion.
- A payment eventually succeeds.
- Transient failures retry and exhausted/permanent failures terminate.
- Restart processes pending work and recovers an expired `processing` lease.
- A racing operator update is not overwritten by a late worker result.
- Graceful shutdown stops new claims.

Each test gets its own application instance and repository. The application factory will not listen on a port, so Supertest can exercise it directly. Timers, UUID generation where needed, gateway behavior, and clock are injected to eliminate flaky randomness.

**Why:** most risk sits at boundaries—duplicate creation, disk failure, timers, and competing updates—so the test plan emphasizes those rather than chasing line coverage alone.

## 14. API documentation

The checked-in `openapi.json` describes all implemented endpoints, schemas, status codes, authentication, correlation and rate-limit headers, error envelopes, and examples. `amount` explicitly means integer minor units: `2500 NGN` is 2,500 kobo (₦25.00). Currency validation accepts three uppercase ASCII letters without checking a registry or performing exponent conversion.

`GET /doc` serves Swagger UI, `GET /doc/initializer.js` serves its local initialization script, and `GET /openapi.json` serves the checked-in contract. These routes are public and covered by the general rate limiter. Payment requests made through the UI retain normal API-key authentication. The contract uses a relative server URL to target the service's current host and port. The root JSON artifact must accompany `dist/` when deploying compiled code.

The UI loads pinned Swagger UI 5.34.1 assets from jsDelivr without adding npm dependencies. This requires browser internet access and trusts that CDN for UI assets; the JSON contract can still be used offline. Only the documentation page allows the CDN in its content security policy, with scripts loaded externally rather than inline. Remote validation and persisted authorization are disabled. This keeps setup small while providing the requested interactive route; bundled local assets would remove the CDN dependency if offline UI support becomes necessary.

Contract tests compare documented request schemas with JSON Schema generated from the existing Zod schemas, validate examples, resolve local references, and check public fields, enums, security, and key response codes. These targeted tests do not claim full OpenAPI specification validation. Documentation-route tests exercise the Express stack over in-memory HTTP streams, checking content, public access, scoped security headers, payment authentication, and rate limiting without binding a socket.

The README explains setup, explicit `.env` loading, all configuration settings, commands, `curl` flows, state transitions, and limitations. Operating examples cover success, permanent decline, transient exhaustion, timeout, idempotent replay/conflict, and versioned operator finalization with a delayed gateway.

**Why:** a checked-in contract is reviewable without running the service, while a served copy improves evaluator experience. Contract tests prevent documentation from becoming aspirational.

## 15. Explicit tradeoffs and limitations

- **Single process only:** JSON storage and the worker cannot safely coordinate multiple instances.
- **At-least-once execution:** downstream idempotency is required; no system can guarantee exactly once across a crash boundary here.
- **Whole-file writes:** simple and robust for assessment-sized data, but write cost and startup memory grow with all records.
- **No durable external queue:** leases recover interrupted local work, but a separate queue would be needed for independent scaling and stronger delivery controls.
- **Basic authentication:** a static key demonstrates secret handling, not user identity, scoped authorization, or key rotation.
- **Process-local rate limiting:** counters reset on restart and do not coordinate across instances; production multi-instance deployment needs a shared limiter or API gateway.
- **No real payment provider or sensitive instrument data:** provider behavior is simulated and PCI compliance is out of scope.
- **No refunds, partial captures, cancellation workflow, webhooks, pagination, or payment listing:** these are not required and would distract from correctness of the core lifecycle.
- **No permanent idempotency cleanup initially:** records are retained with payments. A production service would define a retention window and archival rules.
- **Operator update can finalize a processing payment:** version checks prevent lost updates, but business authorization and an audit actor would be required in production.
- **File durability is filesystem-dependent:** atomic rename on the same filesystem is assumed. A database is the proper choice for stronger durability guarantees.

These are conscious boundaries, not hidden omissions. The repository, gateway, clock, and worker interfaces leave room to replace the constrained pieces without changing the HTTP contract or domain rules.
