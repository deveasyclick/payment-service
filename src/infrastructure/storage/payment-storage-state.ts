import type {
  CreatePaymentResult,
  UpdatePaymentResult,
} from '../../modules/payments/payment-repository.types.js';
import type {
  IdempotencyRecord,
  Payment,
} from '../../modules/payments/payment.types.js';
import {
  InvalidPaymentVersionError,
  RepositoryInvariantError,
} from '../../modules/payments/payment-repository.errors.js';
import { STORAGE_SCHEMA_VERSION } from './storage.const.js';
import type { StorageDocument } from './storage.types.js';

interface DocumentMutation<T> {
  readonly document: StorageDocument;
  readonly result: T;
}

function clonePayment(payment: Payment): Payment {
  return structuredClone(payment);
}

function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return structuredClone(record);
}

export function createEmptyStorageDocument(): StorageDocument {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    payments: {},
    idempotencyRecords: {},
  };
}

export function cloneStorageDocument(
  document: StorageDocument,
): StorageDocument {
  return structuredClone(document);
}

export function createPaymentInDocument(
  document: StorageDocument,
  payment: Payment,
  idempotencyRecord: IdempotencyRecord,
): DocumentMutation<CreatePaymentResult> {
  if (idempotencyRecord.paymentId !== payment.id) {
    throw new RepositoryInvariantError(
      'Idempotency record paymentId must match the created payment id',
    );
  }

  const existingRecord = document.idempotencyRecords[idempotencyRecord.key];

  if (existingRecord !== undefined) {
    const existingPayment = document.payments[existingRecord.paymentId];

    if (existingPayment === undefined) {
      throw new RepositoryInvariantError(
        'Idempotency record references a missing payment',
      );
    }

    if (existingRecord.requestHash === idempotencyRecord.requestHash) {
      return {
        document,
        result: { kind: 'replayed', payment: clonePayment(existingPayment) },
      };
    }

    return {
      document,
      result: {
        kind: 'idempotency_conflict',
        existingPaymentId: existingRecord.paymentId,
      },
    };
  }

  if (document.payments[payment.id] !== undefined) {
    throw new RepositoryInvariantError(`Payment ${payment.id} already exists`);
  }

  const storedPayment = clonePayment(payment);
  const storedRecord = cloneIdempotencyRecord(idempotencyRecord);
  const nextDocument: StorageDocument = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    payments: { ...document.payments, [payment.id]: storedPayment },
    idempotencyRecords: {
      ...document.idempotencyRecords,
      [idempotencyRecord.key]: storedRecord,
    },
  };

  return {
    document: nextDocument,
    result: { kind: 'created', payment: clonePayment(storedPayment) },
  };
}

export function updatePaymentInDocument(
  document: StorageDocument,
  payment: Payment,
  expectedVersion: number,
): DocumentMutation<UpdatePaymentResult> {
  const currentPayment = document.payments[payment.id];

  if (currentPayment === undefined) {
    return { document, result: { kind: 'not_found' } };
  }

  if (currentPayment.version !== expectedVersion) {
    return {
      document,
      result: {
        kind: 'version_conflict',
        currentPayment: clonePayment(currentPayment),
      },
    };
  }

  if (payment.version !== expectedVersion + 1) {
    throw new InvalidPaymentVersionError(expectedVersion, payment.version);
  }

  const storedPayment = clonePayment(payment);
  const nextDocument: StorageDocument = {
    ...document,
    payments: { ...document.payments, [payment.id]: storedPayment },
  };

  return {
    document: nextDocument,
    result: { kind: 'updated', payment: clonePayment(storedPayment) },
  };
}

function isDue(payment: Payment, nowIso: string): boolean {
  return (
    payment.status === 'pending' &&
    (payment.nextAttemptAt === undefined || payment.nextAttemptAt <= nowIso)
  );
}

function dueOrder(payment: Payment): string {
  return payment.nextAttemptAt ?? payment.createdAt;
}

export function claimNextDuePaymentInDocument(
  document: StorageDocument,
  now: Date,
): DocumentMutation<Payment | undefined> {
  const nowIso = now.toISOString();
  const payment = Object.values(document.payments)
    .filter((candidate) => isDue(candidate, nowIso))
    .toSorted((left, right) => {
      const timeOrder = dueOrder(left).localeCompare(dueOrder(right));
      return timeOrder === 0 ? left.id.localeCompare(right.id) : timeOrder;
    })[0];

  if (payment === undefined) {
    return { document, result: undefined };
  }

  const claimedPayment: Payment = {
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    ...(payment.reference === undefined
      ? {}
      : { reference: payment.reference }),
    status: 'processing',
    attemptCount: payment.attemptCount + 1,
    processingStartedAt: nowIso,
    createdAt: payment.createdAt,
    updatedAt: nowIso,
    version: payment.version + 1,
  };

  return {
    document: {
      ...document,
      payments: { ...document.payments, [payment.id]: claimedPayment },
    },
    result: clonePayment(claimedPayment),
  };
}
