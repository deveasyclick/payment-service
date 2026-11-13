import { InvalidPaymentTransitionError } from './payment.errors.js';
import type {
  PaymentStatus,
  PaymentTransition,
  PaymentTransitionActor,
} from './types/payment.types.js';

const allowedTransitions: Readonly<
  Record<PaymentTransitionActor, ReadonlySet<string>>
> = {
  worker: new Set([
    'pending->processing',
    'processing->pending',
    'processing->succeeded',
    'processing->failed',
  ]),
  operator: new Set([
    'pending->succeeded',
    'pending->failed',
    'processing->succeeded',
    'processing->failed',
  ]),
};

function transitionKey(from: PaymentStatus, to: PaymentStatus): string {
  return `${from}->${to}`;
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

export function isPaymentTransitionAllowed(
  transition: PaymentTransition,
): boolean {
  return allowedTransitions[transition.actor].has(
    transitionKey(transition.from, transition.to),
  );
}

export function assertPaymentTransitionAllowed(
  transition: PaymentTransition,
): void {
  if (!isPaymentTransitionAllowed(transition)) {
    throw new InvalidPaymentTransitionError(transition);
  }
}
