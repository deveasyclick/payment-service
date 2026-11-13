import { z } from 'zod';

import { PAYMENT_FAILURE_CODES } from './payment.const.js';
import type {
  CreatePaymentBody,
  CreatePaymentCommand,
  UpdatePaymentStatusBody,
  UpdatePaymentStatusCommand,
} from './types/payment-service.types.js';

const amountSchema = z.number().int().positive().max(999_999_999_999);
// ISO 4217-style code: exactly three uppercase ASCII letters.
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
const referenceSchema = z.string().trim().min(1).max(100).optional();
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  // Printable ASCII only, from space (0x20) through tilde (0x7E).
  .regex(/^[\x20-\x7E]+$/u);
const paymentIdSchema = z.uuid();
const expectedVersionSchema = z.number().int().positive();

const createPaymentBodySchema = z.strictObject({
  amount: amountSchema,
  currency: currencySchema,
  reference: referenceSchema,
});

const createPaymentCommandSchema = z.strictObject({
  amount: amountSchema,
  currency: currencySchema,
  reference: referenceSchema,
  idempotencyKey: idempotencyKeySchema,
});

const updatePaymentStatusBodySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('succeeded'),
    expectedVersion: expectedVersionSchema,
  }),
  z.strictObject({
    status: z.literal('failed'),
    expectedVersion: expectedVersionSchema,
    failureCode: z.enum(PAYMENT_FAILURE_CODES),
  }),
]);

const updatePaymentStatusCommandSchema = z.discriminatedUnion('status', [
  z.strictObject({
    paymentId: paymentIdSchema,
    status: z.literal('succeeded'),
    expectedVersion: expectedVersionSchema,
  }),
  z.strictObject({
    paymentId: paymentIdSchema,
    status: z.literal('failed'),
    expectedVersion: expectedVersionSchema,
    failureCode: z.enum(PAYMENT_FAILURE_CODES),
  }),
]);

export function parseCreatePaymentBody(value: unknown): CreatePaymentBody {
  const body = createPaymentBodySchema.parse(value);

  return {
    amount: body.amount,
    currency: body.currency,
    ...(body.reference === undefined ? {} : { reference: body.reference }),
  };
}

export function parseIdempotencyKey(value: unknown): string {
  return z
    .strictObject({ idempotencyKey: idempotencyKeySchema })
    .parse({ idempotencyKey: value }).idempotencyKey;
}

export function parsePaymentId(value: unknown): string {
  return z.strictObject({ id: paymentIdSchema }).parse({ id: value }).id;
}

export function parseUpdatePaymentStatusBody(
  value: unknown,
): UpdatePaymentStatusBody {
  return updatePaymentStatusBodySchema.parse(value);
}

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

// Used by contract tests to keep the checked-in OpenAPI schemas aligned with validation.
export function getPaymentRequestJsonSchemas() {
  return {
    CreatePayment: z.toJSONSchema(createPaymentBodySchema),
    UpdatePaymentStatus: z.toJSONSchema(updatePaymentStatusBodySchema),
    IdempotencyKey: z.toJSONSchema(idempotencyKeySchema),
    PaymentId: z.toJSONSchema(paymentIdSchema),
  };
}
