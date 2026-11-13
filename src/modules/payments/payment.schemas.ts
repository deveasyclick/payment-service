import { z } from 'zod';

import { PAYMENT_FAILURE_CODES } from './payment.const.js';
import type {
  CreatePaymentCommand,
  UpdatePaymentStatusCommand,
} from './payment-service.types.js';

const createPaymentCommandSchema = z.strictObject({
  amount: z.number().int().positive().max(999_999_999_999),
  // ISO 4217-style code: exactly three uppercase ASCII letters.
  currency: z.string().regex(/^[A-Z]{3}$/u),
  reference: z.string().trim().min(1).max(100).optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    // Printable ASCII only, from space (0x20) through tilde (0x7E).
    .regex(/^[\x20-\x7E]+$/u),
});

const updatePaymentStatusCommandSchema = z.discriminatedUnion('status', [
  z.strictObject({
    paymentId: z.uuid(),
    status: z.literal('succeeded'),
    expectedVersion: z.number().int().positive(),
  }),
  z.strictObject({
    paymentId: z.uuid(),
    status: z.literal('failed'),
    expectedVersion: z.number().int().positive(),
    failureCode: z.enum(PAYMENT_FAILURE_CODES),
  }),
]);

export function parseCreatePaymentCommand(
  command: CreatePaymentCommand,
): CreatePaymentCommand {
  const parsedCommand = createPaymentCommandSchema.parse(command);

  return {
    amount: parsedCommand.amount,
    currency: parsedCommand.currency,
    ...(parsedCommand.reference === undefined
      ? {}
      : { reference: parsedCommand.reference }),
    idempotencyKey: parsedCommand.idempotencyKey,
  };
}

export function parseUpdatePaymentStatusCommand(
  command: UpdatePaymentStatusCommand,
): UpdatePaymentStatusCommand {
  return updatePaymentStatusCommandSchema.parse(command);
}
