export interface PaymentWorkerOptions {
  readonly attemptTimeoutMs: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly pollIntervalMs: number;
  readonly retryBaseDelayMs: number;
  readonly shutdownTimeoutMs: number;
}
