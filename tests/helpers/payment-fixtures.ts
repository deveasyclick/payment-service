import type {
  IdempotencyRecord,
  Payment,
} from '../../src/modules/payments/payment.types.js';

export function buildPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
    amount: 2_500,
    currency: 'NGN',
    status: 'pending',
    attemptCount: 0,
    createdAt: '2026-11-13T12:00:00.000Z',
    updatedAt: '2026-11-13T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function buildIdempotencyRecord(
  overrides: Partial<IdempotencyRecord> = {},
): IdempotencyRecord {
  return {
    key: 'create-payment-key',
    requestHash: 'a'.repeat(64),
    paymentId: '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec',
    createdAt: '2026-11-13T12:00:00.000Z',
    ...overrides,
  };
}
