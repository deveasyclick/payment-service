import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

import type { StorageDocument } from '../../src/infrastructure/storage/storage.types.js';
import { JsonPaymentRepository } from '../../src/modules/payments/repositories/json-payment.repository.js';

export async function createTestPaymentRepository(
  options: {
    initialize?: boolean;
    initialDocument?: StorageDocument;
  } = {},
): Promise<JsonPaymentRepository> {
  const directory = await mkdtemp(join(tmpdir(), 'payment-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'payments.json');
  if (options.initialDocument !== undefined) {
    await writeFile(filePath, JSON.stringify(options.initialDocument));
  }
  const repository = new JsonPaymentRepository({ filePath });
  if (options.initialize !== false) await repository.initialize();
  return repository;
}
