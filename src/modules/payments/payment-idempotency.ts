import { createHash } from 'node:crypto';

import type {
  CreatePaymentCommand,
  NormalizedCreatePaymentRequest,
} from './types/payment-service.types.js';

export function normalizeCreatePaymentRequest(
  command: CreatePaymentCommand,
): NormalizedCreatePaymentRequest {
  return {
    amount: command.amount,
    currency: command.currency,
    ...(command.reference === undefined
      ? {}
      : { reference: command.reference.trim() }),
  };
}

export function hashCreatePaymentRequest(
  request: NormalizedCreatePaymentRequest,
): string {
  return createHash('sha256')
    .update(JSON.stringify(request), 'utf8')
    .digest('hex');
}
