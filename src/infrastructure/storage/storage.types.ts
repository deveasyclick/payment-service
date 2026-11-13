import type {
  IdempotencyRecord,
  Payment,
} from '../../modules/payments/payment.types.js';
import type { STORAGE_SCHEMA_VERSION } from './storage.const.js';
import type { ServiceLogger } from '../../shared/types/logger.types.js';

export interface StorageDocument {
  readonly schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  readonly payments: Readonly<Record<string, Payment>>;
  readonly idempotencyRecords: Readonly<Record<string, IdempotencyRecord>>;
}

export interface DocumentMutation<T> {
  readonly document: StorageDocument;
  readonly result: T;
}

export type AtomicFileWriter = (
  filePath: string,
  contents: string,
) => Promise<void>;

export interface JsonPaymentRepositoryOptions {
  readonly logger?: ServiceLogger;
  readonly filePath: string;
  readonly writeFileAtomically?: AtomicFileWriter;
}
