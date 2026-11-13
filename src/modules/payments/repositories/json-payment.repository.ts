import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  CreatePaymentResult,
  PaymentRepository,
  UpdatePaymentResult,
} from '../types/payment-repository.types.js';
import { RepositoryNotInitializedError } from '../payment.errors.js';
import type { IdempotencyRecord, Payment } from '../types/payment.types.js';
import { MutationQueue } from '../../../shared/helpers/mutation-queue.js';
import { writeFileAtomically as defaultAtomicWriter } from '../../../infrastructure/storage/atomic-file-writer.js';
import { PaymentStorageState } from '../../../infrastructure/storage/payment-storage-state.js';
import type { ServiceLogger } from '../../../shared/types/logger.types.js';
import { parseStorageDocument } from '../../../infrastructure/storage/storage.schemas.js';
import type {
  AtomicFileWriter,
  JsonPaymentRepositoryOptions,
  StorageDocument,
} from '../../../infrastructure/storage/storage.types.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export class JsonPaymentRepository implements PaymentRepository {
  private readonly filePath: string;
  private readonly mutationQueue = new MutationQueue();
  private readonly writeFileAtomically: AtomicFileWriter;
  private readonly logger: ServiceLogger | undefined;
  private state: PaymentStorageState | undefined;

  constructor(options: JsonPaymentRepositoryOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger;
    this.writeFileAtomically =
      options.writeFileAtomically ??
      ((path, contents) => defaultAtomicWriter(path, contents, options.logger));
  }

  async initialize(): Promise<void> {
    await this.mutationQueue.run(async () => {
      if (this.state !== undefined) {
        return;
      }

      await mkdir(dirname(this.filePath), { recursive: true });

      try {
        const contents = await readFile(this.filePath, 'utf8');
        this.state = new PaymentStorageState(parseStorageDocument(contents));
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }

        this.logger?.info(
          { event: 'storage_file_missing', filePath: this.filePath },
          'Storage file does not exist; initializing empty storage',
        );

        const initialState = new PaymentStorageState();
        const initialDocument = initialState.toDocument();
        await this.persist(initialDocument);
        this.state = initialState;
      }
    });
  }

  async createPayment(
    payment: Payment,
    idempotencyRecord: IdempotencyRecord,
  ): Promise<CreatePaymentResult> {
    return this.mutationQueue.run(async () => {
      const mutation = this.getState().createPayment(
        payment,
        idempotencyRecord,
      );

      if (mutation.result.kind === 'created') {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  findPaymentById(id: string): Promise<Payment | undefined> {
    return Promise.resolve().then(() => {
      return this.getState().findPaymentById(id);
    });
  }

  findIdempotencyRecordByKey(
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve().then(() => {
      return this.getState().findIdempotencyRecordByKey(key);
    });
  }

  async updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): Promise<UpdatePaymentResult> {
    return this.mutationQueue.run(async () => {
      const mutation = this.getState().updatePayment(payment, expectedVersion);

      if (mutation.result.kind === 'updated') {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  async claimNextDuePayment(now: Date): Promise<Payment | undefined> {
    return this.mutationQueue.run(async () => {
      const mutation = this.getState().claimNextDuePayment(now);

      if (mutation.result !== undefined) {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  async recoverExpiredPayments(
    now: Date,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<number> {
    return this.mutationQueue.run(async () => {
      const mutation = this.getState().recoverExpiredPayments(
        now,
        leaseMs,
        maxAttempts,
      );

      if (mutation.result > 0) {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  private getState(): PaymentStorageState {
    if (this.state === undefined) {
      throw new RepositoryNotInitializedError();
    }

    return this.state;
  }

  private async persistAndPublish(document: StorageDocument): Promise<void> {
    await this.persist(document);
    this.state = new PaymentStorageState(document);
  }

  private async persist(document: StorageDocument): Promise<void> {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    parseStorageDocument(contents);
    await this.writeFileAtomically(this.filePath, contents);
  }
}
