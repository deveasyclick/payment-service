import type { Express } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { SWAGGER_ASSET_URL } from '../../src/infrastructure/documentation/documentation.const.js';
import { getTestResponse as get } from '../helpers/request-app.js';

function createTestApp(max = 100): Express {
  return createApp({
    config: loadConfig({
      API_KEY: 'documentation-test-key',
      RATE_LIMIT_MAX: String(max),
    }),
    paymentService: {
      createPayment: vi.fn(),
      getPayment: vi.fn(),
      updatePaymentStatus: vi.fn(),
    },
  });
}

describe('documentation routes', () => {
  it('serves a public Swagger UI page with a narrowly scoped CDN policy', async () => {
    const app = createTestApp();
    const page = await get(app, '/doc');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain(`${SWAGGER_ASSET_URL}/swagger-ui-bundle.js`);
    expect(page.body).toContain('/doc/initializer.js');
    expect(page.headers['content-security-policy']).toContain(
      "script-src 'self' https://cdn.jsdelivr.net",
    );
    expect(page.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(page.headers['x-request-id']).toBeTypeOf('string');

    const contract = await get(app, '/openapi.json');
    expect(contract.status).toBe(200);
    expect(contract.headers['content-type']).toContain('application/json');
    expect(JSON.parse(contract.body) as unknown).toMatchObject({
      openapi: '3.1.0',
      servers: [{ url: '/' }],
    });
    expect(contract.headers['content-security-policy']).not.toContain(
      'cdn.jsdelivr.net',
    );
    expect(contract.body).not.toContain('documentation-test-key');

    const payment = await get(
      app,
      '/payments/7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
    );
    expect(payment.status).toBe(401);
    expect(payment.headers['content-security-policy']).not.toContain(
      'cdn.jsdelivr.net',
    );
  });

  it('loads the local contract without persisting auth or using a remote validator', async () => {
    const result = await get(createTestApp(), '/doc/initializer.js');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('javascript');
    expect(result.body).toContain("url: '/openapi.json'");
    expect(result.body).toContain('persistAuthorization: false');
    expect(result.body).toContain('validatorUrl: null');
  });

  it('applies the general rate limit to documentation routes', async () => {
    const app = createTestApp(1);
    expect((await get(app, '/doc')).status).toBe(200);
    const limited = await get(app, '/openapi.json');
    expect(limited.status).toBe(429);
    expect(JSON.parse(limited.body) as unknown).toMatchObject({
      error: { code: 'RATE_LIMIT_EXCEEDED', path: '/openapi.json' },
    });
  });
});
