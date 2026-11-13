import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  CreatePaymentResult,
  PaymentRepository,
  UpdatePaymentResult,
} from '../payment-repository.types.js';
import { RepositoryNotInitializedError } from '../payment-repository.errors.js';
import type { IdempotencyRecord, Payment } from '../payment.types.js';
import { MutationQueue } from '../../../shared/helpers/mutation-queue.js';
import { writeFileAtomically as defaultAtomicWriter } from '../../../infrastructure/storage/atomic-file-writer.js';
import {
  claimNextDuePaymentInDocument,
  createEmptyStorageDocument,
  createPaymentInDocument,
  updatePaymentInDocument,
} from '../../../infrastructure/storage/payment-storage-state.js';
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
  private document: StorageDocument | undefined;

  constructor(options: JsonPaymentRepositoryOptions) {
    this.filePath = options.filePath;
    this.writeFileAtomically =
      options.writeFileAtomically ?? defaultAtomicWriter;
  }

  async initialize(): Promise<void> {
    await this.mutationQueue.run(async () => {
      if (this.document !== undefined) {
        return;
      }

      await mkdir(dirname(this.filePath), { recursive: true });

      try {
        const contents = await readFile(this.filePath, 'utf8');
        this.document = parseStorageDocument(contents);
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }

        const initialDocument = createEmptyStorageDocument();
        await this.persist(initialDocument);
        this.document = initialDocument;
      }
    });
  }

  async createPayment(
    payment: Payment,
    idempotencyRecord: IdempotencyRecord,
  ): Promise<CreatePaymentResult> {
    return this.mutationQueue.run(async () => {
      const mutation = createPaymentInDocument(
        this.getDocument(),
        payment,
        idempotencyRecord,
      );

      if (mutation.document !== this.document) {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  findPaymentById(id: string): Promise<Payment | undefined> {
    return Promise.resolve().then(() => {
      const payment = this.getDocument().payments[id];
      return payment === undefined ? undefined : structuredClone(payment);
    });
  }

  findIdempotencyRecordByKey(
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve().then(() => {
      const record = this.getDocument().idempotencyRecords[key];
      return record === undefined ? undefined : structuredClone(record);
    });
  }

  async updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): Promise<UpdatePaymentResult> {
    return this.mutationQueue.run(async () => {
      const mutation = updatePaymentInDocument(
        this.getDocument(),
        payment,
        expectedVersion,
      );

      if (mutation.document !== this.document) {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  async claimNextDuePayment(now: Date): Promise<Payment | undefined> {
    return this.mutationQueue.run(async () => {
      const mutation = claimNextDuePaymentInDocument(this.getDocument(), now);

      if (mutation.document !== this.document) {
        await this.persistAndPublish(mutation.document);
      }

      return mutation.result;
    });
  }

  private getDocument(): StorageDocument {
    if (this.document === undefined) {
      throw new RepositoryNotInitializedError();
    }

    return this.document;
  }

  private async persistAndPublish(document: StorageDocument): Promise<void> {
    await this.persist(document);
    this.document = document;
  }

  private async persist(document: StorageDocument): Promise<void> {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    parseStorageDocument(contents);
    await this.writeFileAtomically(this.filePath, contents);
  }
}
