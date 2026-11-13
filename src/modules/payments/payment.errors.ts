import type { PaymentTransition } from './payment.types.js';

export class InvalidPaymentTransitionError extends Error {
  override readonly name = 'InvalidPaymentTransitionError';

  constructor(readonly transition: PaymentTransition) {
    super(
      `${transition.actor} cannot transition a payment from ${transition.from} to ${transition.to}`,
    );
  }
}
