import type {
  CreatePaymentResult,
  UpdatePaymentResult,
} from '../../modules/payments/types/payment-repository.types.js';
import type {
  IdempotencyRecord,
  Payment,
} from '../../modules/payments/types/payment.types.js';
import {
  InvalidPaymentVersionError,
  RepositoryInvariantError,
} from '../../modules/payments/payment.errors.js';
import { STORAGE_SCHEMA_VERSION } from './storage.const.js';
import type { DocumentMutation, StorageDocument } from './storage.types.js';

export class PaymentStorageState {
  private readonly document: StorageDocument;

  constructor(document?: StorageDocument) {
    this.document =
      document === undefined
        ? {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            payments: {},
            idempotencyRecords: {},
          }
        : structuredClone(document);
  }

  toDocument(): StorageDocument {
    return structuredClone(this.document);
  }

  findPaymentById(id: string): Payment | undefined {
    const payment = this.document.payments[id];
    return payment === undefined ? undefined : this.clonePayment(payment);
  }

  findIdempotencyRecordByKey(key: string): IdempotencyRecord | undefined {
    const record = Object.hasOwn(this.document.idempotencyRecords, key)
      ? this.document.idempotencyRecords[key]
      : undefined;
    return record === undefined
      ? undefined
      : this.cloneIdempotencyRecord(record);
  }

  private clonePayment(payment: Payment): Payment {
    return structuredClone(payment);
  }

  private cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
    return structuredClone(record);
  }

  createPayment(
    payment: Payment,
    idempotencyRecord: IdempotencyRecord,
  ): DocumentMutation<CreatePaymentResult> {
    const document = this.document;
    if (idempotencyRecord.paymentId !== payment.id) {
      throw new RepositoryInvariantError(
        'Idempotency record paymentId must match the created payment id',
      );
    }

    const existingRecord = Object.hasOwn(
      document.idempotencyRecords,
      idempotencyRecord.key,
    )
      ? document.idempotencyRecords[idempotencyRecord.key]
      : undefined;

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
          result: {
            kind: 'replayed',
            payment: this.clonePayment(existingPayment),
          },
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
      throw new RepositoryInvariantError(
        `Payment ${payment.id} already exists`,
      );
    }

    const storedPayment = this.clonePayment(payment);
    const storedRecord = this.cloneIdempotencyRecord(idempotencyRecord);
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
      result: { kind: 'created', payment: this.clonePayment(storedPayment) },
    };
  }

  updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): DocumentMutation<UpdatePaymentResult> {
    const document = this.document;
    const currentPayment = document.payments[payment.id];

    if (currentPayment === undefined) {
      return { document, result: { kind: 'not_found' } };
    }

    if (currentPayment.version !== expectedVersion) {
      return {
        document,
        result: {
          kind: 'version_conflict',
          currentPayment: this.clonePayment(currentPayment),
        },
      };
    }

    if (payment.version !== expectedVersion + 1) {
      throw new InvalidPaymentVersionError(expectedVersion, payment.version);
    }

    const storedPayment = this.clonePayment(payment);
    const nextDocument: StorageDocument = {
      ...document,
      payments: { ...document.payments, [payment.id]: storedPayment },
    };

    return {
      document: nextDocument,
      result: { kind: 'updated', payment: this.clonePayment(storedPayment) },
    };
  }

  private isDue(payment: Payment, nowIso: string): boolean {
    return (
      payment.status === 'pending' &&
      (payment.nextAttemptAt === undefined || payment.nextAttemptAt <= nowIso)
    );
  }

  private dueOrder(payment: Payment): string {
    return payment.nextAttemptAt ?? payment.createdAt;
  }

  claimNextDuePayment(now: Date): DocumentMutation<Payment | undefined> {
    const document = this.document;
    const nowIso = now.toISOString();
    const payment = Object.values(document.payments)
      .filter((candidate) => this.isDue(candidate, nowIso))
      .toSorted((left, right) => {
        const timeOrder = this.dueOrder(left).localeCompare(
          this.dueOrder(right),
        );
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
      result: this.clonePayment(claimedPayment),
    };
  }

  recoverExpiredPayments(
    now: Date,
    leaseMs: number,
    maxAttempts: number,
  ): DocumentMutation<number> {
    const document = this.document;
    const nowIso = now.toISOString();
    const leaseCutoff = new Date(now.getTime() - leaseMs).toISOString();
    let recoveredCount = 0;
    const payments = Object.fromEntries(
      Object.entries(document.payments).map(([id, payment]) => {
        if (
          payment.status !== 'processing' ||
          payment.processingStartedAt === undefined ||
          payment.processingStartedAt > leaseCutoff
        ) {
          return [id, payment];
        }

        recoveredCount += 1;
        const exhausted = payment.attemptCount >= maxAttempts;
        const recoveredPayment: Payment = {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          ...(payment.reference === undefined
            ? {}
            : { reference: payment.reference }),
          status: exhausted ? 'failed' : 'pending',
          attemptCount: payment.attemptCount,
          ...(exhausted
            ? { failureCode: 'attempts_exhausted' as const }
            : { nextAttemptAt: nowIso }),
          createdAt: payment.createdAt,
          updatedAt: nowIso,
          version: payment.version + 1,
        };
        return [id, recoveredPayment];
      }),
    );

    if (recoveredCount === 0) {
      return { document, result: 0 };
    }

    return {
      document: { ...document, payments },
      result: recoveredCount,
    };
  }
}
