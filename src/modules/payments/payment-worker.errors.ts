export class GatewayAttemptTimeoutError extends Error {
  override readonly name = 'GatewayAttemptTimeoutError';

  constructor(readonly timeoutMs: number) {
    super(`Payment gateway attempt exceeded ${timeoutMs}ms`);
  }
}

export class GatewayAttemptAbortedError extends Error {
  override readonly name = 'GatewayAttemptAbortedError';

  constructor() {
    super('Payment gateway attempt aborted during shutdown');
  }
}
