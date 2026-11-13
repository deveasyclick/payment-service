import { describe, expect, it } from 'vitest';

import {
  PAYMENT_STATUSES,
  PAYMENT_TRANSITION_ACTORS,
} from '../../../../src/modules/payments/payment.const.js';
import { InvalidPaymentTransitionError } from '../../../../src/modules/payments/payment.errors.js';
import {
  assertPaymentTransitionAllowed,
  isPaymentTransitionAllowed,
  isTerminalPaymentStatus,
} from '../../../../src/modules/payments/payment.state-machine.js';
import {
  type PaymentStatus,
  type PaymentTransitionActor,
} from '../../../../src/modules/payments/types/payment.types.js';

const allowed = new Set([
  'worker:pending->processing',
  'worker:processing->pending',
  'worker:processing->succeeded',
  'worker:processing->failed',
  'operator:pending->succeeded',
  'operator:pending->failed',
  'operator:processing->succeeded',
  'operator:processing->failed',
]);

const transitionKey = (
  actor: PaymentTransitionActor,
  from: PaymentStatus,
  to: PaymentStatus,
): string => `${actor}:${from}->${to}`;

describe('payment state machine', () => {
  for (const actor of PAYMENT_TRANSITION_ACTORS) {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        const expected = allowed.has(transitionKey(actor, from, to));

        it(`${expected ? 'allows' : 'rejects'} ${actor}: ${from} -> ${to}`, () => {
          const transition = { actor, from, to } as const;

          expect(isPaymentTransitionAllowed(transition)).toBe(expected);

          if (expected) {
            expect(() =>
              assertPaymentTransitionAllowed(transition),
            ).not.toThrow();
          } else {
            expect(() => assertPaymentTransitionAllowed(transition)).toThrow(
              InvalidPaymentTransitionError,
            );
          }
        });
      }
    }
  }

  it.each(['succeeded', 'failed'] satisfies PaymentStatus[])(
    'treats %s as terminal',
    (status) => {
      expect(isTerminalPaymentStatus(status)).toBe(true);
    },
  );

  it.each(['pending', 'processing'] satisfies PaymentStatus[])(
    'treats %s as non-terminal',
    (status) => {
      expect(isTerminalPaymentStatus(status)).toBe(false);
    },
  );
});
