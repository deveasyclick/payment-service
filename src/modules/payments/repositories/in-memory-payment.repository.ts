import type {
  CreatePaymentResult,
  PaymentRepository,
  UpdatePaymentResult,
} from '../payment-repository.types.js';
import { RepositoryNotInitializedError } from '../payment-repository.errors.js';
import type { IdempotencyRecord, Payment } from '../payment.types.js';
import { MutationQueue } from '../../../shared/helpers/mutation-queue.js';
import {
  claimNextDuePaymentInDocument,
  cloneStorageDocument,
  createEmptyStorageDocument,
  createPaymentInDocument,
  updatePaymentInDocument,
} from '../../../infrastructure/storage/payment-storage-state.js';
import type { StorageDocument } from '../../../infrastructure/storage/storage.types.js';

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly mutationQueue = new MutationQueue();
  private initialized = false;
  private document: StorageDocument;

  constructor(initialDocument: StorageDocument = createEmptyStorageDocument()) {
    this.document = cloneStorageDocument(initialDocument);
  }

  initialize(): Promise<void> {
    this.initialized = true;
    return Promise.resolve();
  }

  async createPayment(
    payment: Payment,
    idempotencyRecord: IdempotencyRecord,
  ): Promise<CreatePaymentResult> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = createPaymentInDocument(
        this.document,
        payment,
        idempotencyRecord,
      );
      this.document = mutation.document;
      return mutation.result;
    });
  }

  findPaymentById(id: string): Promise<Payment | undefined> {
    return Promise.resolve().then(() => {
      this.assertInitialized();
      const payment = this.document.payments[id];
      return payment === undefined ? undefined : structuredClone(payment);
    });
  }

  findIdempotencyRecordByKey(
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve().then(() => {
      this.assertInitialized();
      const record = this.document.idempotencyRecords[key];
      return record === undefined ? undefined : structuredClone(record);
    });
  }

  async updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): Promise<UpdatePaymentResult> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = updatePaymentInDocument(
        this.document,
        payment,
        expectedVersion,
      );
      this.document = mutation.document;
      return mutation.result;
    });
  }

  async claimNextDuePayment(now: Date): Promise<Payment | undefined> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = claimNextDuePaymentInDocument(this.document, now);
      this.document = mutation.document;
      return mutation.result;
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new RepositoryNotInitializedError();
    }
  }
}
