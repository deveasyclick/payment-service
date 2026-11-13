import { z } from 'zod';

import type { AppConfig } from '../shared/types/config.types.js';
import { CONFIG_DEFAULTS } from './config.const.js';

function integerFromEnvironment(
  defaultValue: number,
  options: { min: number; max: number },
) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : value),
    z.coerce.number().int().min(options.min).max(options.max),
  );
}

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(16).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default(CONFIG_DEFAULTS.environment),
    PORT: integerFromEnvironment(CONFIG_DEFAULTS.port, {
      min: 1,
      max: 65_535,
    }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default(CONFIG_DEFAULTS.logLevel),
    PAYMENT_DATA_FILE: z
      .string()
      .trim()
      .min(1)
      .default(CONFIG_DEFAULTS.dataFilePath),
    API_KEY: optionalSecret,
    TRUST_PROXY_HOPS: integerFromEnvironment(CONFIG_DEFAULTS.trustedProxyHops, {
      min: 0,
      max: 10,
    }),
    RATE_LIMIT_WINDOW_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.rateLimitWindowMs,
      { min: 1_000, max: 86_400_000 },
    ),
    RATE_LIMIT_MAX: integerFromEnvironment(CONFIG_DEFAULTS.rateLimitMax, {
      min: 1,
      max: 100_000,
    }),
    MUTATION_RATE_LIMIT_WINDOW_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.mutationRateLimitWindowMs,
      { min: 1_000, max: 86_400_000 },
    ),
    MUTATION_RATE_LIMIT_MAX: integerFromEnvironment(
      CONFIG_DEFAULTS.mutationRateLimitMax,
      { min: 1, max: 100_000 },
    ),
    WORKER_POLL_INTERVAL_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.workerPollIntervalMs,
      { min: 10, max: 60_000 },
    ),
    WORKER_ATTEMPT_TIMEOUT_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.workerAttemptTimeoutMs,
      { min: 100, max: 300_000 },
    ),
    WORKER_LEASE_MS: integerFromEnvironment(CONFIG_DEFAULTS.workerLeaseMs, {
      min: 100,
      max: 3_600_000,
    }),
    WORKER_MAX_ATTEMPTS: integerFromEnvironment(
      CONFIG_DEFAULTS.workerMaxAttempts,
      { min: 1, max: 10 },
    ),
    WORKER_RETRY_BASE_DELAY_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.workerRetryBaseDelayMs,
      { min: 10, max: 300_000 },
    ),
    WORKER_SHUTDOWN_TIMEOUT_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.workerShutdownTimeoutMs,
      { min: 100, max: 300_000 },
    ),
    SIMULATED_GATEWAY_LATENCY_MS: integerFromEnvironment(
      CONFIG_DEFAULTS.simulatedGatewayLatencyMs,
      { min: 0, max: 300_000 },
    ),
    SIMULATED_GATEWAY_OUTCOME: z
      .enum(['succeeded', 'declined', 'transient_failure'])
      .default(CONFIG_DEFAULTS.simulatedGatewayOutcome),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'is required when NODE_ENV is production',
        path: ['API_KEY'],
      });
    }

    if (value.WORKER_LEASE_MS <= value.WORKER_ATTEMPT_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        message: 'must be greater than WORKER_ATTEMPT_TIMEOUT_MS',
        path: ['WORKER_LEASE_MS'],
      });
    }
  })
  .transform((value) => ({
    apiKey: value.API_KEY,
    dataFilePath: value.PAYMENT_DATA_FILE,
    environment: value.NODE_ENV,
    logLevel: value.LOG_LEVEL,
    mutationRateLimit: {
      max: value.MUTATION_RATE_LIMIT_MAX,
      windowMs: value.MUTATION_RATE_LIMIT_WINDOW_MS,
    },
    port: value.PORT,
    rateLimit: {
      max: value.RATE_LIMIT_MAX,
      windowMs: value.RATE_LIMIT_WINDOW_MS,
    },
    simulatedGateway: {
      latencyMs: value.SIMULATED_GATEWAY_LATENCY_MS,
      outcome: value.SIMULATED_GATEWAY_OUTCOME,
    },
    trustedProxyHops: value.TRUST_PROXY_HOPS,
    worker: {
      attemptTimeoutMs: value.WORKER_ATTEMPT_TIMEOUT_MS,
      leaseMs: value.WORKER_LEASE_MS,
      maxAttempts: value.WORKER_MAX_ATTEMPTS,
      pollIntervalMs: value.WORKER_POLL_INTERVAL_MS,
      retryBaseDelayMs: value.WORKER_RETRY_BASE_DELAY_MS,
      shutdownTimeoutMs: value.WORKER_SHUTDOWN_TIMEOUT_MS,
    },
  }));

export function parseEnvironment(environment: NodeJS.ProcessEnv): AppConfig {
  return environmentSchema.parse(environment);
}
