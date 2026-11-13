import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { getTestResponse } from '../helpers/request-app.js';

function createTestApp(isReady = true, environment: NodeJS.ProcessEnv = {}) {
  return createApp({
    config: loadConfig(environment),
    isReady: () => isReady,
    paymentService: {
      createPayment: vi.fn(),
      updatePaymentStatus: vi.fn(),
      getPayment: () => Promise.reject(new Error('internal-secret')),
    },
  });
}

describe('health and error routes', () => {
  it('serves /health as a public, rate-limit-exempt liveness alias, independently of readiness', async () => {
    const app = createTestApp(false, {
      API_KEY: 'health-test-api-key',
      RATE_LIMIT_MAX: '1',
    });
    for (const path of ['/health', '/health/live', '/health']) {
      const response = await getTestResponse(app, path);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body) as unknown).toEqual({ status: 'ok' });
    }
    const ready = await getTestResponse(app, '/health/ready');
    expect(ready.status).toBe(503);
    expect(JSON.parse(ready.body) as unknown).toMatchObject({
      error: { code: 'SERVICE_NOT_READY', path: '/health/ready' },
    });
    expect((await getTestResponse(app, '/doc')).status).toBe(200);
  });

  it.each([
    [
      '/unknown/path?token=query-secret',
      404,
      'ROUTE_NOT_FOUND',
      '/unknown/path',
    ],
    [
      '/payments/not-a-uuid?token=query-secret',
      400,
      'VALIDATION_ERROR',
      '/payments/not-a-uuid',
    ],
    [
      '/payments/7ccf50b4-1c73-44c9-97ae-c0fd218d18ec?token=query-secret',
      500,
      'INTERNAL_ERROR',
      '/payments/7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
    ],
  ])(
    'includes the original pathname for %s',
    async (url, status, code, path) => {
      const response = await getTestResponse(createTestApp(), url);
      expect(response.status).toBe(status);
      expect(JSON.parse(response.body) as unknown).toMatchObject({
        error: { code, path, requestId: response.headers['x-request-id'] },
      });
      expect(response.body).not.toContain('query-secret');
      expect(response.body).not.toContain('internal-secret');
    },
  );

  it('includes the full mounted path on authentication failures', async () => {
    const response = await getTestResponse(
      createTestApp(true, { API_KEY: 'health-test-api-key' }),
      '/payments/not-a-uuid?token=query-secret',
    );
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body) as unknown).toMatchObject({
      error: { code: 'UNAUTHORIZED', path: '/payments/not-a-uuid' },
    });
    expect(response.body).not.toContain('query-secret');
  });
});
