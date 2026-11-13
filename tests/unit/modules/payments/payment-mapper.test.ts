import { describe, expect, it } from 'vitest';

import { toPublicPayment } from '../../../../src/modules/payments/payment.mapper.js';
import type { Payment } from '../../../../src/modules/payments/types/payment.types.js';

describe('toPublicPayment', () => {
  it('exposes public fields and removes worker scheduling details', () => {
    const payment: Payment = {
      id: '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
      amount: 2_500,
      currency: 'NGN',
      reference: 'order-123',
      status: 'processing',
      attemptCount: 1,
      nextAttemptAt: '2026-11-13T12:01:00.000Z',
      processingStartedAt: '2026-11-13T12:00:00.000Z',
      createdAt: '2026-11-13T11:59:00.000Z',
      updatedAt: '2026-11-13T12:00:00.000Z',
      version: 2,
    };

    expect(toPublicPayment(payment)).toEqual({
      id: payment.id,
      amount: 2_500,
      currency: 'NGN',
      reference: 'order-123',
      status: 'processing',
      attemptCount: 1,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      version: 2,
    });
  });

  it('includes a terminal failure code', () => {
    const payment: Payment = {
      id: '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
      amount: 2_500,
      currency: 'NGN',
      status: 'failed',
      attemptCount: 3,
      failureCode: 'attempts_exhausted',
      createdAt: '2026-11-13T11:59:00.000Z',
      updatedAt: '2026-11-13T12:02:00.000Z',
      version: 6,
    };

    expect(toPublicPayment(payment).failureCode).toBe('attempts_exhausted');
    expect(toPublicPayment(payment)).not.toHaveProperty('reference');
  });
});
