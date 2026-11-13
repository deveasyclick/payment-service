import type { PaymentTransition } from './payment.types.js';

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
