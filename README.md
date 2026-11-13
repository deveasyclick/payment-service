# Payment Processing Service

A small, production-minded payment-processing microservice designed for a Node.js + React Developer assessment. It exposes an Express REST API for creating payments, retrieving them, and updating their status while processing new payments asynchronously.

> **Project status:** configuration, payment-domain rules, atomic JSON persistence, application use cases, the secured Express API, asynchronous processing, restart recovery, graceful server lifecycle, and correlated/redacted logging are complete. The OpenAPI contract remains to be implemented.

## What this project demonstrates

- Idempotent payment creation
- Explicit payment lifecycle rules
- Asynchronous processing outside the HTTP request
- Bounded retries and processing timeouts
- Recovery of interrupted work after restart
- Persistent JSON storage with atomic replacement
- Protection against concurrent and stale updates
- Structured, redacted logging
- Authentication, validation, body limits, and rate limiting
- Deterministic unit and API integration testing
- OpenAPI documentation

The solution deliberately uses one Node.js process, an in-process worker, and JSON-file persistence. This keeps the assessment easy to run and review while still addressing failure handling honestly.

## Planned stack

- Node.js and TypeScript
- Express
- Zod
- Pino and `pino-http`
- Vitest
- Supertest
- `helmet`
- `express-rate-limit`
- OpenAPI 3.1

## Development tooling

The project pins Node.js 24.14.0 in `.nvmrc` and pnpm 11.15.0 through the `packageManager` and `engines` fields in `package.json`.

Install dependencies exactly as recorded in `pnpm-lock.yaml`:

```bash
pnpm install --frozen-lockfile
```

The available quality commands are:

| Command             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `pnpm dev`          | Watch the TypeScript server entry point during development. |
| `pnpm build`        | Compile production TypeScript into `dist`.                  |
| `pnpm start`        | Run the compiled server entry point.                        |
| `pnpm typecheck`    | Run strict TypeScript checks without emitting files.        |
| `pnpm lint`         | Run type-aware ESLint checks.                               |
| `pnpm format`       | Format supported files with Prettier.                       |
| `pnpm format:check` | Check formatting without changing files.                    |
| `pnpm test`         | Run the Vitest suite once.                                  |
| `pnpm test:watch`   | Run Vitest in watch mode.                                   |

## Project structure

```text
payment-service/
├── src/
│   ├── app.ts
│   ├── server-lifecycle.ts
│   ├── server-lifecycle.types.ts
│   ├── server.ts
│   ├── config/
│   │   ├── config.const.ts
│   │   ├── config.schema.ts
│   │   ├── index.ts
│   │   └── load-config.ts
│   ├── modules/
│   │   └── payments/
│   │       ├── payment.const.ts
│   │       ├── payment.controller.ts
│   │       ├── payment.errors.ts
│   │       ├── payment-http.types.ts
│   │       ├── payment-idempotency.ts
│   │       ├── payment.types.ts
│   │       ├── payment.schemas.ts
│   │       ├── payment.state-machine.ts
│   │       ├── payment.mapper.ts
│   │       ├── payment.service.ts
│   │       ├── payment-service.types.ts
│   │       ├── payment-repository.errors.ts
│   │       ├── payment-repository.types.ts
│   │       ├── repositories/
│   │       │   ├── in-memory-payment.repository.ts
│   │       │   └── json-payment.repository.ts
│   │       ├── payment-gateway.types.ts
│   │       ├── payment-worker.errors.ts
│   │       ├── payment-worker.types.ts
│   │       ├── payment.worker.ts
│   │       └── payment.routes.ts
│   ├── infrastructure/
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
│   │   ├── request-logging.ts
│   │   └── validate.ts
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
│   │   │       ├── in-memory-payment-repository.test.ts
│   │   │       ├── payment-idempotency.test.ts
│   │   │       ├── payment-mapper.test.ts
│   │   │       ├── payment-state-machine.test.ts
│   │   │       ├── payment-service.test.ts
│   │   │       └── payment-worker.test.ts
│   │   ├── infrastructure/
│   │   │   ├── logger.test.ts
│   │   │   └── simulated-payment-gateway.test.ts
│   │   ├── shared/
│   │   │   └── helpers.test.ts
│   │   ├── server-lifecycle.test.ts
│   │   ├── request-logging.test.ts
│   │   └── config.test.ts
│   ├── integration/
│   │   ├── payments-api.test.ts
│   │   └── json-payment-repository.test.ts
│   └── helpers/
│       ├── capture-logs.ts
│       ├── create-test-app.ts
│       ├── payment-fixtures.ts
│       ├── scripted-payment-gateway.ts
│       └── test-clock.ts
├── openapi.yaml
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   ├── ARCHITECTURE.md
│   └── TASKS.md
└── README.md
```

`app.ts` constructs the Express application without listening on a port, which allows Supertest to exercise it directly. `server.ts` is the composition root and owns startup, listening, worker lifecycle, and graceful shutdown.

Payment-specific behavior and its repository implementations stay in `modules/payments`. File-database mechanics, storage schemas, and atomic writing stay under `infrastructure/storage`, mirroring the separation between database infrastructure and feature repositories in a database-backed service. Other cross-module adapters, such as the simulated provider and Pino configuration, also stay under `infrastructure`. Cross-cutting Express functions live under `middleware`.

The runtime JSON directory is intentionally absent from the committed tree. The service creates the parent directory of the configured data-file path, such as `./data/payments.json`, and `.gitignore` excludes the generated data.

## Payment model

A payment contains the following key fields:

| Field          | Description                                               |
| -------------- | --------------------------------------------------------- |
| `id`           | Server-generated UUID.                                    |
| `amount`       | Positive integer expressed in the currency's minor unit.  |
| `currency`     | Three-letter uppercase currency code.                     |
| `reference`    | Optional client business reference.                       |
| `status`       | `pending`, `processing`, `succeeded`, or `failed`.        |
| `attemptCount` | Number of processing attempts started.                    |
| `failureCode`  | Non-sensitive terminal failure category, when applicable. |
| `createdAt`    | UTC ISO-8601 creation timestamp.                          |
| `updatedAt`    | UTC ISO-8601 last-update timestamp.                       |
| `version`      | Monotonic value used to reject stale concurrent updates.  |

### Amount units

`amount` is always an integer count of the selected currency's **minor unit**. Clients do not send decimal major-unit amounts.

For NGN, the minor unit is kobo:

```json
{
  "amount": 2500,
  "currency": "NGN"
}
```

This represents **2,500 kobo**, or **₦25.00**. It does not represent ₦2,500.

Integer minor units avoid floating-point rounding errors. The eventual OpenAPI document will describe this rule on the field and provide currency-specific examples.

## Payment lifecycle

```text
                 worker claim
pending ----------------------------> processing
   ^                                      |   |
   | transient failure, retry scheduled   |   | provider success
   +--------------------------------------+   v
                                          succeeded

                              permanent/exhausted failure
                         processing ----------------------> failed
```

- New payments begin as `pending`.
- The worker claims due payments by moving them to `processing`.
- Successful processing ends in `succeeded`.
- Permanent errors or exhausted retries end in `failed`.
- Transient errors return to `pending` with a future retry time.
- `succeeded` and `failed` are terminal and cannot be reopened.
- An operator status update may finalize a `pending` or `processing` payment as `succeeded` or `failed`.

## REST API

All request and response bodies use JSON. Successful responses include an `X-Request-Id` header for correlation.

### Create a payment

```http
POST /payments
Content-Type: application/json
Idempotency-Key: 99de8a30-f2c2-47ad-9a11-7d04d2059cf6
X-API-Key: development-secret
```

```json
{
  "amount": 2500,
  "currency": "NGN",
  "reference": "order-123"
}
```

A newly accepted payment returns `202 Accepted`, includes `Location: /payments/{id}`, and initially has `pending` status.

The `Idempotency-Key` header is required:

- Repeating the key with the same normalized payload returns the original payment with `200 OK`.
- Repeating the key with a different payload returns `409 Conflict`.

This lets clients safely retry requests after timeouts without creating a second payment.

### Retrieve a payment

```http
GET /payments/{id}
X-API-Key: development-secret
```

Returns `200 OK` with the payment or `404 Not Found`. A malformed UUID returns `400 Bad Request`.

### Update payment status

```http
PATCH /payments/{id}/status
Content-Type: application/json
X-API-Key: development-secret
```

```json
{
  "status": "failed",
  "failureCode": "cancelled_by_operator",
  "expectedVersion": 2
}
```

Only `succeeded` and `failed` are accepted as target statuses. `failureCode` is required for failure and forbidden for success.

The caller supplies the last version it read. If another request or the background worker has already changed the payment, the endpoint returns `412 Precondition Failed` rather than overwriting newer state. Invalid state transitions return `409 Conflict`.

### Health checks

| Endpoint            | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `GET /health/live`  | Confirms that the process is running.                        |
| `GET /health/ready` | Confirms that storage is initialized and processing can run. |

Health checks are not rate-limited and expose no configuration or diagnostic secrets.

## Error responses

Errors use one consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "path": "amount",
        "message": "Must be a positive integer"
      }
    ],
    "requestId": "01J..."
  }
}
```

Expected errors have stable machine-readable codes. Unexpected failures return a generic `500 Internal Server Error`; stack traces, file paths, and raw provider errors are logged but never returned to clients.

## Asynchronous processing

Creating a payment only persists and queues it. The HTTP request does not wait for the simulated provider.

The in-process worker:

1. Poll for due `pending` payments.
2. Atomically claim one as `processing`.
3. Invoke the simulated gateway with a bounded timeout.
4. Persist success, permanent failure, or a scheduled retry.
5. Retry transient failures up to three total attempts with exponential backoff and bounded jitter.

Processing has **at-least-once** semantics. If the process stops after the provider accepts a payment but before local success is saved, the attempt can run again. The payment ID is therefore reused as the downstream idempotency key.

On startup, pending work remains eligible and expired `processing` leases are requeued. A late worker result cannot overwrite a newer operator update because completion is conditional on the version and state originally claimed.

The worker starts automatically with the API through `pnpm dev` or `pnpm start` (after `pnpm build`). Both share one repository instance and one mutation queue. Running the worker in a separate process against the same JSON file is unsupported: each process would hold its own cached snapshot and write queue, so the worker would not see newly created payments and either process could overwrite the other's changes. Atomic file replacement prevents partial files; it does not coordinate concurrent processes, and payment version checks apply only to each process's local snapshot.

This keeps setup small for the assessment. A separate worker process would require shared transactional storage with atomic job claims and version checks, such as SQLite or PostgreSQL, before adding an independent worker entry point. Do not run multiple service instances against the same JSON file.

The service reports ready only after storage validation, lease recovery, worker startup, and HTTP listening succeed. `SIGTERM` and `SIGINT` immediately make it unready, stop new HTTP connections and worker claims, then allow active work a configurable bounded shutdown period before aborting it.

## Persistence

The default repository stores payments and idempotency records in one versioned JSON document.

Each mutation is serialized inside the process and persisted by:

1. Creating the next in-memory snapshot.
2. Writing it to a temporary file in the same directory.
3. Flushing the temporary file.
4. Atomically renaming it over the current data file.
5. Publishing the new in-memory snapshot only after persistence succeeds.

Malformed JSON and unsupported storage versions cause startup to fail without replacing the existing file. This is intentionally safer than silently starting with empty data.

## Security controls

The planned implementation includes:

- Optional static API-key authentication, required in production mode
- Timing-safe secret comparison
- Strict Zod request validation
- Rejection of unknown request properties
- 16 KiB JSON body limit
- Baseline HTTP headers through `helmet`
- Disabled `x-powered-by` header
- Redaction of API keys, authorization values, and idempotency keys from logs
- No logging of request bodies
- CORS disabled by default
- Configurable rate limiting

Proposed rate-limit defaults:

| Scope                                              | Limit                                     |
| -------------------------------------------------- | ----------------------------------------- |
| General API traffic                                | 100 requests per 15 minutes per client IP |
| `POST /payments` and `PATCH /payments/{id}/status` | 20 requests per minute per client IP      |

Exceeded limits return `429 Too Many Requests` using the standard error envelope and standard `RateLimit` headers. Proxy trust is disabled unless the known deployment proxy count is configured explicitly.

The default limiter is process-local, matching the single-process service. It resets after restart and would need a shared store or API gateway for multi-instance deployment.

## Logging and observability

Pino emits structured JSON logs containing request and payment correlation data. Important events include:

- HTTP request completion and duration
- New payment creation and idempotent replay
- Worker claim and attempt number
- Retry scheduling
- Terminal processing outcome
- Expired-lease recovery
- Version conflicts
- Startup, persistence, and shutdown errors

Sensitive headers, request bodies, and raw payment-provider errors are excluded or redacted.

HTTP logs carry `requestId`, method, status, and `responseTime` in milliseconds. Payment creation/replay and status-update logs link that request to `paymentId`; worker logs use the same `paymentId` with `attemptCount`, outcome, and `durationMs`. Search by `requestId` to inspect an HTTP request, then by `paymentId` to follow its background processing across attempts and restarts. Request IDs are not stored in the payment document.

Successful requests and persisted worker outcomes use `info`; expected client failures and discarded stale worker results use `warn`; unexpected HTTP, repository, and polling failures use `error`. `LOG_LEVEL` controls output. Request URLs, query strings, headers, bodies, and payment references are omitted. Error serialization retains the type and stack call sites while omitting messages, causes, and custom properties that may contain sensitive values. Explicit redaction of common secret fields provides an additional safeguard; callers must still log only approved fields and fixed messages.

The app factory accepts an injected logger and defaults to silent logging for tests. Captured-log tests verify correlation, HTTP levels and durations, secret redaction, retry/completion events, and stale-result handling without changing global logger state.

## Testing approach

Vitest and Supertest will cover the highest-risk behaviors:

- Allowed and forbidden status transitions
- Validation boundaries for money and currency
- Idempotent replay and conflicting key reuse
- Serialized persistence and stale version rejection
- Atomic-write failure and corrupt-file startup behavior
- API success and error contracts
- Authentication and rate limiting
- Retry, timeout, exhaustion, and permanent failure
- Restart recovery
- Races between worker completion and operator updates
- Graceful shutdown
- Log redaction

The gateway, clock, timers, and ID generator will be injectable where necessary so tests do not depend on randomness or real-time sleeps.

## Known limitations

- JSON persistence supports one service process only.
- Whole-file rewrites are unsuitable for high payment volume.
- Processing is at least once, not exactly once.
- The worker is not an independently durable queue.
- Static API-key authentication does not provide user identity, roles, or secret rotation.
- Rate-limit counters reset on restart and are not shared across instances.
- No real payment provider or payment instrument is used.
- Refunds, captures, webhooks, payment listing, and pagination are outside the assessment scope.
- Idempotency records do not initially expire.
- File durability depends on same-filesystem atomic rename behavior.

A production evolution would replace JSON persistence with a transactional database, use database-backed or external job processing, adopt scoped service identities, and move distributed rate limiting to a shared store or gateway.

## Project documents

- [Architecture](./docs/ARCHITECTURE.md) — detailed decisions, rationale, contracts, failure behavior, and tradeoffs.
- [Implementation tasks](./docs/TASKS.md) — sequential milestones, acceptance criteria, and suggested commits.
