import type {
  CreatePaymentResult,
  PaymentRepository,
  UpdatePaymentResult,
} from '../payment-repository.types.js';
import { RepositoryNotInitializedError } from '../payment-repository.errors.js';
import type { IdempotencyRecord, Payment } from '../payment.types.js';
import { MutationQueue } from '../../../shared/helpers/mutation-queue.js';
import { PaymentStorageState } from '../../../infrastructure/storage/payment-storage-state.js';
import type { StorageDocument } from '../../../infrastructure/storage/storage.types.js';

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly mutationQueue = new MutationQueue();
  private initialized = false;
  private state: PaymentStorageState;

  constructor(initialDocument?: StorageDocument) {
    this.state = new PaymentStorageState(initialDocument);
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
      const mutation = this.state.createPayment(payment, idempotencyRecord);
      if (mutation.result.kind === 'created') {
        this.state = new PaymentStorageState(mutation.document);
      }
      return mutation.result;
    });
  }

  findPaymentById(id: string): Promise<Payment | undefined> {
    return Promise.resolve().then(() => {
      this.assertInitialized();
      return this.state.findPaymentById(id);
    });
  }

  findIdempotencyRecordByKey(
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve().then(() => {
      this.assertInitialized();
      return this.state.findIdempotencyRecordByKey(key);
    });
  }

  async updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): Promise<UpdatePaymentResult> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = this.state.updatePayment(payment, expectedVersion);
      if (mutation.result.kind === 'updated') {
        this.state = new PaymentStorageState(mutation.document);
      }
      return mutation.result;
    });
  }

  async claimNextDuePayment(now: Date): Promise<Payment | undefined> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = this.state.claimNextDuePayment(now);
      if (mutation.result !== undefined) {
        this.state = new PaymentStorageState(mutation.document);
      }
      return mutation.result;
    });
  }

  async recoverExpiredPayments(now: Date, leaseMs: number): Promise<number> {
    return this.mutationQueue.run(() => {
      this.assertInitialized();
      const mutation = this.state.recoverExpiredPayments(now, leaseMs);
      if (mutation.result > 0) {
        this.state = new PaymentStorageState(mutation.document);
      }
      return mutation.result;
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new RepositoryNotInitializedError();
    }
  }
}
