import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileAtomically } from '../../src/infrastructure/storage/atomic-file-writer.js';
import { JsonPaymentRepository } from '../../src/modules/payments/repositories/json-payment.repository.js';
import { PaymentWorker } from '../../src/modules/payments/payment.worker.js';
import {
  InvalidStorageDataError,
  UnsupportedStorageVersionError,
} from '../../src/infrastructure/storage/storage.errors.js';
import type { AtomicFileWriter } from '../../src/infrastructure/storage/storage.types.js';
import {
  buildIdempotencyRecord,
  buildPayment,
} from '../helpers/payment-fixtures.js';
import { ScriptedPaymentGateway } from '../helpers/scripted-payment-gateway.js';

describe('JsonPaymentRepository', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'payment-repository-'));
    filePath = join(directory, 'nested', 'payments.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates its directory and persists payments across instances', async () => {
    const payment = buildPayment();
    const record = buildIdempotencyRecord();
    const firstRepository = new JsonPaymentRepository({ filePath });
    await firstRepository.initialize();
    await firstRepository.createPayment(payment, record);

    const secondRepository = new JsonPaymentRepository({ filePath });
    await secondRepository.initialize();

    await expect(secondRepository.findPaymentById(payment.id)).resolves.toEqual(
      payment,
    );
    await expect(
      secondRepository.findIdempotencyRecordByKey(record.key),
    ).resolves.toEqual(record);
    await expect(
      secondRepository.createPayment(payment, record),
    ).resolves.toMatchObject({ kind: 'replayed', payment });
    expect(await readdir(join(directory, 'nested'))).toEqual(['payments.json']);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'treats %s as a normal idempotency key across reloads',
    async (key) => {
      const repository = new JsonPaymentRepository({ filePath });
      await repository.initialize();
      const payment = buildPayment();
      const record = buildIdempotencyRecord({ key });
      await expect(
        repository.findIdempotencyRecordByKey(key),
      ).resolves.toBeUndefined();
      await expect(
        repository.createPayment(payment, record),
      ).resolves.toMatchObject({ kind: 'created' });
      const restarted = new JsonPaymentRepository({ filePath });
      await restarted.initialize();
      await expect(
        restarted.createPayment(payment, record),
      ).resolves.toMatchObject({ kind: 'replayed' });
    },
  );

  it('serializes concurrent versioned updates without losing data', async () => {
    const repository = new JsonPaymentRepository({ filePath });
    await repository.initialize();
    const payment = buildPayment();
    await repository.createPayment(payment, buildIdempotencyRecord());
    const processing = buildPayment({
      status: 'processing',
      attemptCount: 1,
      processingStartedAt: '2026-11-13T12:01:00.000Z',
      updatedAt: '2026-11-13T12:01:00.000Z',
      version: 2,
    });
    const failed = buildPayment({
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      updatedAt: '2026-11-13T12:01:00.000Z',
      version: 2,
    });

    const results = await Promise.all([
      repository.updatePayment(processing, 1),
      repository.updatePayment(failed, 1),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      'updated',
      'version_conflict',
    ]);
    const reloadedRepository = new JsonPaymentRepository({ filePath });
    await reloadedRepository.initialize();
    expect(
      (await reloadedRepository.findPaymentById(payment.id))?.version,
    ).toBe(2);
  });

  it('does not publish or persist a mutation when its atomic write fails', async () => {
    let rejectWrites = false;
    const writer: AtomicFileWriter = async (path, contents) => {
      if (rejectWrites) {
        throw new Error('simulated disk failure');
      }

      await writeFileAtomically(path, contents);
    };
    const repository = new JsonPaymentRepository({
      filePath,
      writeFileAtomically: writer,
    });
    await repository.initialize();
    const payment = buildPayment();
    await repository.createPayment(payment, buildIdempotencyRecord());
    rejectWrites = true;

    await expect(
      repository.updatePayment(
        buildPayment({
          status: 'failed',
          failureCode: 'cancelled_by_operator',
          updatedAt: '2026-11-13T12:01:00.000Z',
          version: 2,
        }),
        1,
      ),
    ).rejects.toThrow('simulated disk failure');
    await expect(repository.findPaymentById(payment.id)).resolves.toEqual(
      payment,
    );

    const reloadedRepository = new JsonPaymentRepository({ filePath });
    await reloadedRepository.initialize();
    await expect(
      reloadedRepository.findPaymentById(payment.id),
    ).resolves.toEqual(payment);

    rejectWrites = false;
    await expect(
      repository.updatePayment(
        buildPayment({
          status: 'failed',
          failureCode: 'cancelled_by_operator',
          updatedAt: '2026-11-13T12:01:00.000Z',
          version: 2,
        }),
        1,
      ),
    ).resolves.toMatchObject({ kind: 'updated' });
  });

  it('rejects malformed storage without replacing it', async () => {
    const malformed = '{ definitely not JSON';
    await mkdir(join(directory, 'nested'), { recursive: true });
    await writeFile(filePath, malformed, 'utf8');
    const repository = new JsonPaymentRepository({ filePath });

    await expect(repository.initialize()).rejects.toBeInstanceOf(
      InvalidStorageDataError,
    );
    await expect(readFile(filePath, 'utf8')).resolves.toBe(malformed);
  });

  it.each([
    buildPayment({ status: 'processing', attemptCount: 1 }),
    buildPayment({ status: 'failed' }),
    buildPayment({
      status: 'succeeded',
      nextAttemptAt: '2026-11-13T12:01:00.000Z',
    }),
  ])(
    'rejects inconsistent persisted payment state without replacing it',
    async (payment) => {
      await mkdir(join(directory, 'nested'), { recursive: true });
      const contents = JSON.stringify({
        schemaVersion: 1,
        payments: { [payment.id]: payment },
        idempotencyRecords: {},
      });
      await writeFile(filePath, contents);
      const repository = new JsonPaymentRepository({ filePath });
      await expect(repository.initialize()).rejects.toBeInstanceOf(
        InvalidStorageDataError,
      );
      expect(await readFile(filePath, 'utf8')).toBe(contents);
    },
  );

  it('rejects an unsupported schema version without replacing it', async () => {
    const repository = new JsonPaymentRepository({ filePath });
    await repository.initialize();
    const unsupported =
      '{"schemaVersion":999,"payments":{},"idempotencyRecords":{}}\n';
    await writeFile(filePath, unsupported, 'utf8');
    const incompatibleRepository = new JsonPaymentRepository({ filePath });

    await expect(incompatibleRepository.initialize()).rejects.toBeInstanceOf(
      UnsupportedStorageVersionError,
    );
    await expect(readFile(filePath, 'utf8')).resolves.toBe(unsupported);
  });

  it('recovers and processes abandoned work after repository restart', async () => {
    const payment = buildPayment();
    const firstRepository = new JsonPaymentRepository({ filePath });
    await firstRepository.initialize();
    await firstRepository.createPayment(payment, buildIdempotencyRecord());
    await firstRepository.claimNextDuePayment(
      new Date('2026-11-13T12:00:00.000Z'),
    );

    const restartedRepository = new JsonPaymentRepository({ filePath });
    await restartedRepository.initialize();
    await expect(
      restartedRepository.recoverExpiredPayments(
        new Date('2026-11-13T12:01:00.000Z'),
        30_000,
        3,
      ),
    ).resolves.toBe(1);

    const worker = new PaymentWorker(
      restartedRepository,
      new ScriptedPaymentGateway([{ kind: 'succeeded' }]),
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      {
        attemptTimeoutMs: 1_000,
        leaseMs: 30_000,
        maxAttempts: 3,
        pollIntervalMs: 250,
        retryBaseDelayMs: 250,
        shutdownTimeoutMs: 500,
      },
    );
    await worker.processNextPayment();

    const finalRepository = new JsonPaymentRepository({ filePath });
    await finalRepository.initialize();
    await expect(
      finalRepository.findPaymentById(payment.id),
    ).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
      version: 5,
    });
  });
});
