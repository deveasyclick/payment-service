export class GatewayAttemptTimeoutError extends Error {
  override readonly name = 'GatewayAttemptTimeoutError';

  constructor(readonly timeoutMs: number) {
    super(`Payment gateway attempt exceeded ${timeoutMs}ms`);
  }
}
