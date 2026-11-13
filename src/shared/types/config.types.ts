export type Environment = 'development' | 'test' | 'production';

export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';

export interface RateLimitConfig {
  readonly max: number;
  readonly windowMs: number;
}

export interface WorkerConfig {
  readonly attemptTimeoutMs: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly pollIntervalMs: number;
  readonly retryBaseDelayMs: number;
}

export type SimulatedGatewayOutcome =
  | 'succeeded'
  | 'declined'
  | 'transient_failure';

export interface AppConfig {
  readonly apiKey: string | undefined;
  readonly dataFilePath: string;
  readonly environment: Environment;
  readonly logLevel: LogLevel;
  readonly mutationRateLimit: RateLimitConfig;
  readonly port: number;
  readonly rateLimit: RateLimitConfig;
  readonly simulatedGateway: {
    readonly latencyMs: number;
    readonly outcome: SimulatedGatewayOutcome;
  };
  readonly trustedProxyHops: number;
  readonly worker: WorkerConfig;
}
