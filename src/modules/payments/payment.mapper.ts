import type { Payment, PublicPayment } from './payment.types.js';

export function toPublicPayment(payment: Payment): PublicPayment {
  return {
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    ...(payment.reference === undefined
      ? {}
      : { reference: payment.reference }),
    status: payment.status,
    attemptCount: payment.attemptCount,
    ...(payment.failureCode === undefined
      ? {}
      : { failureCode: payment.failureCode }),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    version: payment.version,
  };
}
