# Payment Processing Service

A small, production-minded payment-processing microservice designed for a Node.js + React Developer assessment. It exposes an Express REST API for creating payments, retrieving them, and updating their status while processing new payments asynchronously.

> **Project status:** implementation and delivery polish are complete. Local verification passes 143 tests; the full socket-based API suite, clean dependency installation, and registry audit still require an unrestricted local/CI run. See [verification results](./docs/VERIFICATION.md).

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

## Stack

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

## Run locally

Use the pinned Node.js and pnpm versions above, then run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

This starts the API and worker together at `http://localhost:3000`. By default authentication is disabled locally, payments are stored at `./data/payments.json`, and the simulated provider succeeds after 500 ms. A payment may finish before you retrieve it.

In another terminal:

```bash
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health
curl -i http://localhost:3000/health/ready
```

For a compiled run:

```bash
pnpm build
pnpm start
```

Environment variables are read once at startup. `pnpm dev` and `pnpm start` do not automatically load `.env`. To use a local file with Node's built-in environment loader:

```bash
cp .env.example .env
node --env-file=.env --watch --import tsx src/main.ts
```

For compiled code use `node --env-file=.env dist/main.js` after building. Exported environment variables also work with all commands. Stop the current service before switching scenarios; never run multiple processes against the same JSON file. `Ctrl+C` triggers graceful shutdown. The relative data path is resolved from the working directory; reuse it to resume persisted work across restarts.

## Configuration

All durations are milliseconds unless stated otherwise. Invalid configuration stops startup. API authentication is enabled whenever `API_KEY` is supplied and is mandatory in production.

| Variable                        | Default                | Meaning and bounds                                                                       |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | `development`          | `development`, `test`, or `production`.                                                  |
| `PORT`                          | `3000`                 | Integer 1–65535.                                                                         |
| `LOG_LEVEL`                     | `info`                 | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`.                         |
| `PAYMENT_DATA_FILE`             | `./data/payments.json` | Nonempty JSON-file path; parent directory is created.                                    |
| `API_KEY`                       | unset                  | At least 16 characters after trimming; empty disables authentication outside production. |
| `TRUST_PROXY_HOPS`              | `0`                    | Integer 0–10; enable only for a known proxy deployment.                                  |
| `RATE_LIMIT_WINDOW_MS`          | `900000`               | General per-IP window; 1000–86400000.                                                    |
| `RATE_LIMIT_MAX`                | `100`                  | General per-IP quota; 1–100000.                                                          |
| `MUTATION_RATE_LIMIT_WINDOW_MS` | `60000`                | Additional mutation window; 1000–86400000.                                               |
| `MUTATION_RATE_LIMIT_MAX`       | `20`                   | Additional mutation quota; 1–100000.                                                     |
| `WORKER_POLL_INTERVAL_MS`       | `250`                  | Delay between polls; 10–60000.                                                           |
| `WORKER_ATTEMPT_TIMEOUT_MS`     | `5000`                 | Gateway attempt deadline; 100–300000.                                                    |
| `WORKER_LEASE_MS`               | `30000`                | Abandoned processing lease; 100–3600000 and strictly greater than the attempt timeout.   |
| `WORKER_MAX_ATTEMPTS`           | `3`                    | Total attempts, including the initial attempt; 1–10.                                     |
| `WORKER_RETRY_BASE_DELAY_MS`    | `250`                  | Exponential retry base; 10–300000, with up to 20% jitter.                                |
| `WORKER_SHUTDOWN_TIMEOUT_MS`    | `10000`                | Concurrent HTTP and worker grace period; 100–300000.                                     |
| `SIMULATED_GATEWAY_LATENCY_MS`  | `500`                  | Simulated attempt latency; 0–300000.                                                     |
| `SIMULATED_GATEWAY_OUTCOME`     | `succeeded`            | `succeeded`, `declined`, or `transient_failure`; fixed for the lifetime of this process. |

If authentication is enabled, add `-H 'X-API-Key: your-configured-key'` to payment requests below. Health checks stay public. No payment method or card details are accepted.

## Exercise the payment flow

The examples below use local defaults with authentication disabled. The response body contains the payment ID; copy it into `payment_id` for subsequent requests. `curl -i` displays status codes and response headers.

### Create, retrieve, and replay

```bash
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-success-001' \
  -H 'X-Request-Id: demo-request-001' \
  -d '{"amount":2500,"currency":"NGN","reference":"order-123"}'

payment_id='paste-the-returned-id-here'
curl -i "http://localhost:3000/payments/$payment_id"
```

Creation returns `202` with `Location`. The worker then moves the payment from `pending` through `processing` to `succeeded`; repeat GET to observe the current state. Here `2500 NGN` means **2,500 kobo (₦25.00)**.

Repeat the exact POST with the same key and body to get `200` and `Idempotent-Replayed: true`. It returns the original payment's current state. Reuse that key with `amount: 3000` to get `409 IDEMPOTENCY_CONFLICT`. Use a new idempotency key for each new payment; restarting does not clear keys in the data file.

### Observe decline, retries, and timeout

Stop the current server, then choose one scenario. Each uses a separate data file for isolation:

```bash
# Permanent decline: failed/provider_declined after one attempt.
SIMULATED_GATEWAY_OUTCOME=declined PAYMENT_DATA_FILE=./data/declines.json pnpm dev

# Transient failure: retries, then failed/processing_error after three attempts.
SIMULATED_GATEWAY_OUTCOME=transient_failure PAYMENT_DATA_FILE=./data/retries.json pnpm dev

# Latency exceeds timeout: retries, then failed/processing_timeout.
SIMULATED_GATEWAY_LATENCY_MS=1000 WORKER_ATTEMPT_TIMEOUT_MS=100 PAYMENT_DATA_FILE=./data/timeouts.json pnpm dev
```

Run only one command at a time, then create and retrieve a payment as above. Inspect `attemptCount` and `failureCode` in GET responses. Watch `payment_attempt_started`, `payment_retry_scheduled`, and `payment_completed` JSON log events by `paymentId`; retry events expose the internal `nextAttemptAt` timestamp without exposing it in API responses. The fixed-outcome simulator cannot demonstrate transient failure followed by success in one run; deterministic scripted-gateway tests cover that case.

### Manually finalize an active payment

To leave time for an operator override, start a slow successful provider after stopping the previous service:

```bash
SIMULATED_GATEWAY_LATENCY_MS=120000 WORKER_ATTEMPT_TIMEOUT_MS=180000 WORKER_LEASE_MS=240000 PAYMENT_DATA_FILE=./data/operator.json pnpm dev
```

Create a payment with a new idempotency key, set `payment_id`, then read the current version:

```bash
curl -sS "http://localhost:3000/payments/$payment_id"
```

Copy its `version` into `expected_version`, then finalize it:

```bash
expected_version=2 # Replace with the version returned by GET.
curl -i -X PATCH "http://localhost:3000/payments/$payment_id/status" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"failed\",\"failureCode\":\"cancelled_by_operator\",\"expectedVersion\":$expected_version}"
```

Expect `200` and `failed`. To mark success instead, send `{"status":"succeeded","expectedVersion":2}` using the latest version and omit `failureCode`. A stale version returns `412`; GET again and reconsider the action. A terminal payment returns `409` when updated using its current version. When the delayed worker finishes, its stale result is discarded and logged as `payment_worker_result_discarded`.

## API contract

Open **http://localhost:3000/doc** after starting the service to browse the API in Swagger UI and try requests. The raw contract is available at **http://localhost:3000/openapi.json** and in the checked-in [OpenAPI 3.1 contract](./openapi.json). It documents the payment/health endpoints, request/response schemas, authentication, correlation and rate-limit headers, errors, and examples. The server URL is relative, so browser requests use the current service host and port.

Documentation routes are public and use the general rate limit. If `API_KEY` is configured, click **Authorize** in Swagger UI and enter that key before trying payment requests. Authentication is not persisted across page reloads. The page loads a pinned Swagger UI 5.34.1 bundle and stylesheet from jsDelivr, so the browser needs internet access; the raw JSON contract remains available without the CDN. External contract validation is disabled. Only `/doc` permits the CDN in its content security policy. No extra npm dependency is required. Deploy the root `openapi.json` alongside `dist/`, preserving the project layout.

`tests/unit/openapi-contract.test.ts` compares the request schemas to Zod's JSON Schema output, validates documented request examples, resolves local references, and checks public fields, enums, authentication, and response-code coverage. These checks catch key drift; they do not replace a full OpenAPI validator or the API integration suite.

## Project structure

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
│   │   ├── server.test.ts
│   │   ├── request-logging.test.ts
│   │   ├── openapi-contract.test.ts
│   │   ├── documentation-routes.test.ts
│   │   ├── health-and-errors.test.ts
│   │   └── config.test.ts
│   ├── integration/
│   │   ├── atomic-file-writer.test.ts
│   │   ├── payment-lifecycle.test.ts
│   │   ├── startup-logging.test.ts
│   │   ├── payments-api.test.ts
│   │   └── json-payment-repository.test.ts
│   └── helpers/
│       ├── capture-logs.ts
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

`app.ts` constructs the Express application without listening on a port, which allows Supertest to exercise it directly. `main.ts` is the executable composition root: it loads configuration, builds the shared dependencies, starts `PaymentServer`, and registers its signal handlers.

The `PaymentServer` class in `server.ts` owns readiness, ordered startup, worker lifecycle, signal handling, and bounded HTTP shutdown. Its injected dependency types live in `server.types.ts`. Importing the class does not start the service or initialize storage; `main.ts` performs startup. `pnpm dev` runs `src/main.ts`, and `pnpm start` runs `dist/main.js` after a build.

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

Integer minor units avoid floating-point rounding errors. The OpenAPI document describes this rule on the field and includes the NGN example. Currency validation checks three uppercase ASCII letters only; it does not verify registered currency codes or convert currency exponents. Clients must supply the correct minor-unit count.

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
| `GET /health`       | Liveness alias; same response as `/health/live`.             |
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
    "path": "/payments",
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

Expected errors have stable machine-readable codes. Unexpected failures return a generic `500 Internal Server Error`; logs retain error type and stack call sites with correlation. Raw provider messages are omitted and internal details are never returned to clients.

Every error includes `error.path`: the original request pathname with mounted prefixes, excluding query strings. Validation `details[].path` identifies the invalid field instead. Unknown routes return `404 ROUTE_NOT_FOUND`; `/health` and `/health/live` both return `200 {"status":"ok"}` and do not check readiness. Use `/health/ready` for readiness.

## Asynchronous processing

Creating a payment only persists and queues it. The HTTP request does not wait for the simulated provider.

The in-process worker:

1. Poll for due `pending` payments.
2. Atomically claim one as `processing`.
3. Invoke the simulated gateway with a bounded timeout.
4. Persist success, permanent failure, or a scheduled retry.
5. Retry transient failures up to three total attempts with exponential backoff and bounded jitter.

Processing has **at-least-once** semantics. If the process stops after the provider accepts a payment but before local success is saved, the attempt can run again. The payment ID is therefore reused as the downstream idempotency key.

On startup and before each worker claim, expired `processing` leases are recovered. Work with attempts remaining is requeued; exhausted work fails with `attempts_exhausted`. A lease still active during a quick restart is picked up after it expires, without another restart. A completion write failure leaves the durable claim available for the same recovery path. Interrupted claims count toward the attempt limit. A late worker result cannot overwrite a newer operator update because completion is conditional on the version originally claimed.

The worker starts automatically with the API through `pnpm dev` or `pnpm start` (after `pnpm build`). Both share one repository instance and one mutation queue. Running the worker in a separate process against the same JSON file is unsupported: each process would hold its own cached snapshot and write queue, so the worker would not see newly created payments and either process could overwrite the other's changes. Atomic file replacement prevents partial files; it does not coordinate concurrent processes, and payment version checks apply only to each process's local snapshot.

This keeps setup small for the assessment. A separate worker process would require shared transactional storage with atomic job claims and version checks, such as SQLite or PostgreSQL, before adding an independent worker entry point. Do not run multiple service instances against the same JSON file.

The service reports ready only after storage validation, lease recovery, worker startup, and HTTP listening succeed. `SIGTERM` and `SIGINT` immediately make it unready, stop new HTTP connections and worker claims, then allow active work a configurable bounded shutdown period before aborting it. Work interrupted at the deadline stays `processing` for lease recovery; shutdown does not schedule another retry. The gateway must honor cancellation to release its own resources; the simulator does so. Native filesystem operations already in flight cannot be cancelled by the worker deadline.

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

The implementation includes:

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

Rate-limit defaults:

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

HTTP logs carry `requestId`, `req.method`, `req.path`, response status, and `responseTime` in milliseconds. `req.path` is the original request pathname, including mounted prefixes and excluding query strings. Payment creation/replay and status-update logs link that request to `paymentId`; worker logs use the same `paymentId` with `attemptCount`, outcome, and `durationMs`. Search by `requestId` to inspect an HTTP request, then by `paymentId` to follow its background processing across attempts and restarts. Request IDs are not stored in the payment document.

Successful requests and persisted worker outcomes use `info`; expected client failures and discarded stale worker results use `warn`; unexpected HTTP, repository, and polling failures use `error`. `LOG_LEVEL` controls output. Query strings, headers, bodies, and payment references are omitted. Error serialization retains the type and stack call sites while omitting messages, causes, and custom properties that may contain sensitive values. Explicit redaction of common secret fields provides an additional safeguard; callers must still log only approved fields and fixed messages.

The app factory accepts an injected logger and defaults to silent logging for tests. Captured-log tests verify correlation, HTTP levels and durations, secret redaction, retry/completion events, and stale-result handling without changing global logger state.

Errors are logged where they are handled: HTTP rejections include their error code and path, unexpected HTTP failures and worker failures use the injected logger, and startup failures (including invalid configuration) are logged before exit. Rethrown infrastructure failures reach those boundaries. Secondary file-close and temporary-file cleanup failures are logged separately while preserving the original write error; combined startup/cleanup failures retain both errors as a safely serialized aggregate. ESLint rejects empty catch blocks, including comment-only blocks, and no-op promise rejection handlers.

## Testing approach

Vitest and Supertest cover the highest-risk behaviors:

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

The gateway, clock, timers, and ID generator are injectable where necessary so tests do not depend on randomness or real-time sleeps. Run `pnpm test` locally for the complete suite, including Supertest tests that bind an ephemeral local port. Environments that prohibit socket binding can run `pnpm exec vitest run --exclude tests/integration/payments-api.test.ts`; that excludes API verification and is not a substitute for a full local run.

The additional `payment-lifecycle.test.ts` integration suite exercises real Express requests, JSON persistence, and worker processing over in-memory HTTP streams. It covers asynchronous responses, concurrent idempotency, operator races, malformed/oversized bodies, disk failures, and restart recovery without requiring a listening port. Failure tests also verify temporary-file cleanup, bounded shutdown, startup ordering, and idempotency keys that match object-prototype names.

The GitHub Actions workflow installs the pinned dependencies, runs formatting, linting, type-checking, the full test suite, build, and `pnpm audit --audit-level=high`. Registry failures or high-severity advisories fail verification; audit checks are not silently skipped. The workflow is included but has not been executed from this workspace. See [VERIFICATION.md](./docs/VERIFICATION.md) for observed results and remaining release checks.

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
- The simulator's downstream idempotency cache is in memory and resets on restart; it does not prove a durable provider-side exactly-once guarantee.
- Readiness reflects startup/shutdown state; it does not continuously probe storage or guarantee provider availability.

A production evolution would replace JSON persistence with a transactional database, use database-backed or external job processing, adopt scoped service identities, and move distributed rate limiting to a shared store or gateway.

## Project documents

- [Architecture](./docs/ARCHITECTURE.md) — detailed decisions, rationale, contracts, failure behavior, and tradeoffs.
- [Implementation tasks](./docs/TASKS.md) — sequential milestones, acceptance criteria, and suggested commits.
- [Verification results](./docs/VERIFICATION.md) — completed checks, regression coverage, and checks awaiting an unrestricted environment.
