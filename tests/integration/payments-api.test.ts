import type { Express } from 'express';
import type { Logger } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import type { PaymentUseCases } from '../../src/modules/payments/payment-service.types.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import type { Clock } from '../../src/shared/types/clock.types.js';
import type { IdGenerator } from '../../src/shared/types/id-generator.types.js';
import { captureLogs } from '../helpers/capture-logs.js';
import { createTestPaymentRepository } from '../helpers/create-test-payment-repository.js';

const apiKey = 'test-api-key-1234';
const firstPaymentId = '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec';
const missingPaymentId = '1351bb54-e5f2-42ee-8ef0-d2cc31b61cf8';

interface TestAppOptions {
  readonly logger?: Logger;
  readonly authenticated?: boolean;
  readonly generalRateLimitMax?: number;
  readonly mutationRateLimitMax?: number;
  readonly isReady?: () => boolean;
  readonly paymentService?: PaymentUseCases;
}

async function createTestApp(options: TestAppOptions = {}): Promise<Express> {
  const repository = await createTestPaymentRepository();
  const clock: Clock = {
    now: () => new Date('2026-11-13T12:00:00.000Z'),
  };
  const idGenerator: IdGenerator = { generate: () => firstPaymentId };
  const paymentService =
    options.paymentService ??
    new PaymentService(repository, clock, idGenerator);
  const config = loadConfig({
    NODE_ENV: 'test',
    ...(options.authenticated === false ? {} : { API_KEY: apiKey }),
    RATE_LIMIT_MAX: String(options.generalRateLimitMax ?? 100),
    MUTATION_RATE_LIMIT_MAX: String(options.mutationRateLimitMax ?? 20),
  });

  return createApp({
    config,
    paymentService,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.isReady === undefined ? {} : { isReady: options.isReady }),
  });
}

describe('payment API', () => {
  it('correlates creation and replay without logging headers, bodies, or query values', async () => {
    const logs = captureLogs();
    const app = await createTestApp({ logger: logs.logger });
    const create = () =>
      request(app)
        .post('/payments?token=query-secret')
        .set('X-API-Key', apiKey)
        .set('Authorization', 'auth-secret')
        .set('X-Request-Id', 'request-log-123')
        .set('Idempotency-Key', 'idempotency-secret')
        .send({ amount: 2_500, currency: 'NGN', reference: 'body-secret' });

    expect((await create()).status).toBe(202);
    expect((await create()).status).toBe(200);
    expect(logs.text()).not.toContain('-secret');
    expect(logs.text()).not.toContain(apiKey);
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment_created',
          paymentId: firstPaymentId,
          requestId: 'request-log-123',
        }),
        expect.objectContaining({
          event: 'payment_replayed',
          paymentId: firstPaymentId,
          requestId: 'request-log-123',
        }),
        expect.objectContaining({
          event: 'http_request_completed',
          requestId: 'request-log-123',
        }),
      ]),
    );
  });

  it('logs unexpected failures with request context and returns a sanitized response', async () => {
    const logs = captureLogs();
    const app = await createTestApp({
      logger: logs.logger,
      paymentService: {
        createPayment: vi.fn(),
        updatePaymentStatus: vi.fn(),
        getPayment: () => Promise.reject(new Error('database-secret')),
      },
    });
    const response = await request(app)
      .get(`/payments/${firstPaymentId}`)
      .set('X-API-Key', apiKey)
      .set('X-Request-Id', 'failed-request-123');

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({
      error: { code: 'INTERNAL_ERROR', requestId: 'failed-request-123' },
    });
    expect(JSON.stringify(response.body)).not.toContain('database-secret');
    expect(logs.text()).not.toContain('database-secret');
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'http_unexpected_error',
          requestId: 'failed-request-123',
          level: 50,
        }),
      ]),
    );
  });
  it('creates and retrieves a pending payment', async () => {
    const app = await createTestApp();

    const created = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'create-order-123')
      .send({ amount: 2_500, currency: 'NGN', reference: 'order-123' });

    expect(created.status).toBe(202);
    expect(created.headers.location).toBe(`/payments/${firstPaymentId}`);
    expect(created.headers['x-request-id']).toBeTypeOf('string');
    expect(created.headers['x-powered-by']).toBeUndefined();
    expect(created.body as unknown).toMatchObject({
      id: firstPaymentId,
      amount: 2_500,
      currency: 'NGN',
      status: 'pending',
      version: 1,
    });

    const retrieved = await request(app)
      .get(`/payments/${firstPaymentId}`)
      .set('X-API-Key', apiKey);

    expect(retrieved.status).toBe(200);
    expect(retrieved.body as unknown).toEqual(created.body as unknown);
  });

  it('returns an idempotent replay and conflicts on a changed payload', async () => {
    const app = await createTestApp();
    const create = () =>
      request(app)
        .post('/payments')
        .set('X-API-Key', apiKey)
        .set('Idempotency-Key', 'same-key');

    expect(
      (await create().send({ amount: 2_500, currency: 'NGN' })).status,
    ).toBe(202);
    const replay = await create().send({ amount: 2_500, currency: 'NGN' });
    const conflict = await create().send({ amount: 3_000, currency: 'NGN' });

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(conflict.status).toBe(409);
    expect(conflict.body as unknown).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('updates status and rejects stale or terminal transitions', async () => {
    const app = await createTestApp();
    await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'status-key')
      .send({ amount: 2_500, currency: 'NGN' });

    const updated = await request(app)
      .patch(`/payments/${firstPaymentId}/status`)
      .set('X-API-Key', apiKey)
      .send({ status: 'succeeded', expectedVersion: 1 });
    const stale = await request(app)
      .patch(`/payments/${firstPaymentId}/status`)
      .set('X-API-Key', apiKey)
      .send({
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        expectedVersion: 1,
      });
    const terminal = await request(app)
      .patch(`/payments/${firstPaymentId}/status`)
      .set('X-API-Key', apiKey)
      .send({
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        expectedVersion: 2,
      });

    expect(updated.status).toBe(200);
    expect(updated.body as unknown).toMatchObject({
      status: 'succeeded',
      version: 2,
    });
    expect(stale.status).toBe(412);
    expect(stale.body as unknown).toMatchObject({
      error: { code: 'PAYMENT_VERSION_CONFLICT' },
    });
    expect(terminal.status).toBe(409);
    expect(terminal.body as unknown).toMatchObject({
      error: { code: 'INVALID_PAYMENT_TRANSITION' },
    });
  });

  it('returns consistent validation errors', async () => {
    const app = await createTestApp();
    const missingKey = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .send({ amount: 2_500, currency: 'NGN' });
    const unknownField = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'validation-key')
      .send({ amount: 2_500, currency: 'NGN', unexpected: true });
    const malformedId = await request(app)
      .get('/payments/not-a-uuid')
      .set('X-API-Key', apiKey);

    for (const response of [missingKey, unknownField, malformedId]) {
      expect(response.status).toBe(400);
      expect(response.body as unknown).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
      expect(response.headers['x-request-id']).toBeTypeOf('string');
    }
  });

  it('rejects malformed and oversized JSON bodies', async () => {
    const app = await createTestApp();
    const malformed = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'malformed-key')
      .set('Content-Type', 'application/json')
      .send('{"amount":');
    const oversized = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'oversized-key')
      .send({
        amount: 2_500,
        currency: 'NGN',
        reference: 'x'.repeat(17 * 1_024),
      });

    expect(malformed.status).toBe(400);
    expect(malformed.body as unknown).toMatchObject({
      error: { code: 'INVALID_JSON' },
    });
    expect(oversized.status).toBe(413);
    expect(oversized.body as unknown).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('requires the configured API key while leaving health checks public', async () => {
    const app = await createTestApp();
    const missing = await request(app).get(`/payments/${missingPaymentId}`);
    const wrong = await request(app)
      .get(`/payments/${missingPaymentId}`)
      .set('X-API-Key', 'incorrect-api-key');
    const live = await request(app).get('/health/live');

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(live.status).toBe(200);
    expect(live.body as unknown).toEqual({ status: 'ok' });
  });

  it('preserves a valid request ID and replaces an invalid one', async () => {
    const app = await createTestApp();
    const supplied = await request(app)
      .get('/health/live')
      .set('X-Request-Id', 'assessment-request:123');
    const replaced = await request(app)
      .get('/health/live')
      .set('X-Request-Id', 'invalid request id');

    expect(supplied.headers['x-request-id']).toBe('assessment-request:123');
    expect(replaced.headers['x-request-id']).not.toBe('invalid request id');
  });

  it('reports readiness without exposing diagnostics', async () => {
    const readyApp = await createTestApp({ isReady: () => true });
    const unavailableApp = await createTestApp({ isReady: () => false });

    const ready = await request(readyApp).get('/health/ready');
    const unavailable = await request(unavailableApp).get('/health/ready');

    expect(ready.status).toBe(200);
    expect(ready.body as unknown).toEqual({ status: 'ready' });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body as unknown).toMatchObject({
      error: { code: 'SERVICE_NOT_READY' },
    });
  });

  it('applies the general rate limit but excludes health checks', async () => {
    const app = await createTestApp({ generalRateLimitMax: 1 });

    expect((await request(app).get('/health/live')).status).toBe(200);
    expect((await request(app).get('/health/live')).status).toBe(200);
    const first = await request(app)
      .get(`/payments/${missingPaymentId}`)
      .set('X-API-Key', apiKey);
    const limited = await request(app)
      .get(`/payments/${missingPaymentId}`)
      .set('X-API-Key', apiKey);

    expect(first.status).toBe(404);
    expect(limited.status).toBe(429);
    expect(limited.headers.ratelimit).toBeTypeOf('string');
  });

  it('applies a stricter mutation rate limit', async () => {
    const app = await createTestApp({ mutationRateLimitMax: 1 });
    const first = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'first-mutation')
      .send({ amount: 2_500, currency: 'NGN' });
    const limited = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'second-mutation')
      .send({ amount: 3_000, currency: 'NGN' });

    expect(first.status).toBe(202);
    expect(limited.status).toBe(429);
    expect(limited.body as unknown).toMatchObject({
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });
  });

  it('returns a sanitized 500 and reports the internal error', async () => {
    const internalError = new Error('sensitive implementation detail');
    const logs = captureLogs();
    const failingService: PaymentUseCases = {
      createPayment: () => Promise.reject(internalError),
      getPayment: () => Promise.reject(internalError),
      updatePaymentStatus: () => Promise.reject(internalError),
    };
    const app = await createTestApp({
      paymentService: failingService,
      logger: logs.logger,
    });

    const response = await request(app)
      .post('/payments')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', 'error-key')
      .send({ amount: 2_500, currency: 'NGN' });

    expect(response.status).toBe(500);
    expect(response.body as unknown).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'sensitive implementation detail',
    );
    const failure = logs
      .entries()
      .find((entry) => entry.event === 'http_unexpected_error');
    expect(failure).toMatchObject({ path: '/payments', level: 50 });
    expect(failure?.requestId).toBe(response.headers['x-request-id']);
    expect(logs.text()).not.toContain('sensitive implementation detail');
  });

  it('uses the standard error envelope for unknown routes', async () => {
    const app = await createTestApp();
    const response = await request(app).get('/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body as unknown).toMatchObject({
      error: { code: 'ROUTE_NOT_FOUND' },
    });
  });
});
