import { z } from 'zod';

import {
  PAYMENT_FAILURE_CODES,
  PAYMENT_STATUSES,
} from '../../modules/payments/payment.const.js';
import {
  InvalidStorageDataError,
  UnsupportedStorageVersionError,
} from './storage.errors.js';
import { STORAGE_SCHEMA_VERSION } from './storage.const.js';
import type { StorageDocument } from './storage.types.js';

const timestampSchema = z.iso.datetime({ offset: true });

const paymentSchema = z.strictObject({
  id: z.uuid(),
  amount: z.number().int().positive().max(999_999_999_999),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  reference: z.string().min(1).max(100).optional(),
  status: z.enum(PAYMENT_STATUSES),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: timestampSchema.optional(),
  processingStartedAt: timestampSchema.optional(),
  failureCode: z.enum(PAYMENT_FAILURE_CODES).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  version: z.number().int().positive(),
});

const idempotencyRecordSchema = z.strictObject({
  key: z.string().min(1).max(128),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
  paymentId: z.uuid(),
  createdAt: timestampSchema,
});

const storageDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(STORAGE_SCHEMA_VERSION),
    payments: z.record(z.string(), paymentSchema),
    idempotencyRecords: z.record(z.string(), idempotencyRecordSchema),
  })
  .superRefine((document, context) => {
    for (const [id, payment] of Object.entries(document.payments)) {
      if (id !== payment.id) {
        context.addIssue({
          code: 'custom',
          message: 'payment map key must match payment.id',
          path: ['payments', id],
        });
      }
    }

    for (const [key, record] of Object.entries(document.idempotencyRecords)) {
      if (key !== record.key) {
        context.addIssue({
          code: 'custom',
          message: 'idempotency map key must match record.key',
          path: ['idempotencyRecords', key],
        });
      }

      if (document.payments[record.paymentId] === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'idempotency record must reference an existing payment',
          path: ['idempotencyRecords', key, 'paymentId'],
        });
      }
    }
  });

function hasSchemaVersion(
  value: unknown,
): value is { readonly schemaVersion: unknown } {
  return (
    typeof value === 'object' && value !== null && 'schemaVersion' in value
  );
}

export function parseStorageDocument(contents: string): StorageDocument {
  let value: unknown;

  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new InvalidStorageDataError('Storage file contains malformed JSON', {
      cause: error,
    });
  }

  if (
    hasSchemaVersion(value) &&
    value.schemaVersion !== STORAGE_SCHEMA_VERSION
  ) {
    throw new UnsupportedStorageVersionError(value.schemaVersion);
  }

  const result = storageDocumentSchema.safeParse(value);

  if (!result.success) {
    throw new InvalidStorageDataError(
      `Storage data failed validation: ${z.prettifyError(result.error)}`,
      { cause: result.error },
    );
  }

  return result.data as StorageDocument;
}
