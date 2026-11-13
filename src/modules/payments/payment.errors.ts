import type { PaymentTransition } from './types/payment.types.js';

export class InvalidPaymentTransitionError extends Error {
  override readonly name = 'InvalidPaymentTransitionError';

  constructor(readonly transition: PaymentTransition) {
    super(
      `${transition.actor} cannot transition a payment from ${transition.from} to ${transition.to}`,
    );
  }
}

export class PaymentNotFoundError extends Error {
  override readonly name = 'PaymentNotFoundError';

  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} was not found`);
  }
}

export class PaymentIdempotencyConflictError extends Error {
  override readonly name = 'PaymentIdempotencyConflictError';

  constructor(readonly existingPaymentId: string) {
    super('Idempotency key was already used with a different payment request');
  }
}

export class PaymentVersionConflictError extends Error {
  override readonly name = 'PaymentVersionConflictError';

  constructor(
    readonly paymentId: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      `Payment ${paymentId} has version ${currentVersion}; expected ${expectedVersion}`,
    );
  }
}

export class RepositoryNotInitializedError extends Error {
  override readonly name = 'RepositoryNotInitializedError';

  constructor() {
    super('Payment repository has not been initialized');
  }
}

export class RepositoryInvariantError extends Error {
  override readonly name = 'RepositoryInvariantError';
}

export class InvalidPaymentVersionError extends Error {
  override readonly name = 'InvalidPaymentVersionError';

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Updated payment version must be ${expectedVersion + 1}; received ${actualVersion}`,
    );
  }
}

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
