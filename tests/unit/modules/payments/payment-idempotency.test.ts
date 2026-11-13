import { describe, expect, it } from 'vitest';

import {
  hashCreatePaymentRequest,
  normalizeCreatePaymentRequest,
} from '../../../../src/modules/payments/payment-idempotency.js';

describe('payment idempotency', () => {
  it('normalizes the business payload and excludes the idempotency key', () => {
    const first = normalizeCreatePaymentRequest({
      amount: 2_500,
      currency: 'NGN',
      reference: '  order-123  ',
      idempotencyKey: 'first-key',
    });
    const second = normalizeCreatePaymentRequest({
      amount: 2_500,
      currency: 'NGN',
      reference: 'order-123',
      idempotencyKey: 'second-key',
    });

    expect(first).toEqual({
      amount: 2_500,
      currency: 'NGN',
      reference: 'order-123',
    });
    expect(second).toEqual(first);
    expect(hashCreatePaymentRequest(first)).toBe(
      hashCreatePaymentRequest(second),
    );
  });

  it('produces a stable SHA-256 request fingerprint', () => {
    const request = { amount: 2_500, currency: 'NGN' } as const;

    // SHA-256 encoded as exactly 64 lowercase hexadecimal characters.
    expect(hashCreatePaymentRequest(request)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashCreatePaymentRequest(request)).toBe(
      hashCreatePaymentRequest({ ...request }),
    );
  });
});
