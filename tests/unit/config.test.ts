import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/index.js';
import { ConfigurationError } from '../../src/shared/errors/configuration.errors.js';

describe('loadConfig', () => {
  it('returns safe local defaults', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      apiKey: undefined,
      dataFilePath: './data/payments.json',
      environment: 'development',
      logLevel: 'info',
      mutationRateLimit: { max: 20, windowMs: 60_000 },
      port: 3_000,
      rateLimit: { max: 100, windowMs: 900_000 },
      simulatedGateway: { latencyMs: 500, outcome: 'succeeded' },
      trustedProxyHops: 0,
      worker: {
        attemptTimeoutMs: 5_000,
        leaseMs: 30_000,
        maxAttempts: 3,
        pollIntervalMs: 250,
        retryBaseDelayMs: 250,
        shutdownTimeoutMs: 10_000,
      },
    });
  });

  it('coerces valid environment strings into typed values', () => {
    const config = loadConfig({
      API_KEY: '  a-long-development-key  ',
      PORT: '4000',
      TRUST_PROXY_HOPS: '1',
      WORKER_MAX_ATTEMPTS: '5',
    });

    expect(config.apiKey).toBe('a-long-development-key');
    expect(config.port).toBe(4_000);
    expect(config.trustedProxyHops).toBe(1);
    expect(config.worker.maxAttempts).toBe(5);
  });

  it('reports the invalid environment variable in its error', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrowError(
      ConfigurationError,
    );
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrowError(/PORT/u);
  });

  it('requires an API key in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      'API_KEY: is required when NODE_ENV is production',
    );
  });

  it('requires the processing lease to exceed the attempt timeout', () => {
    expect(() =>
      loadConfig({
        WORKER_ATTEMPT_TIMEOUT_MS: '5000',
        WORKER_LEASE_MS: '5000',
      }),
    ).toThrow(
      'WORKER_LEASE_MS: must be greater than WORKER_ATTEMPT_TIMEOUT_MS',
    );
  });
});
