import { describe, expect, it } from 'vitest';

import { InMemoryPaymentRepository } from '../../../../src/modules/payments/repositories/in-memory-payment.repository.js';
import { PaymentStorageState } from '../../../../src/infrastructure/storage/payment-storage-state.js';
import {
  InvalidPaymentVersionError,
  RepositoryNotInitializedError,
} from '../../../../src/modules/payments/payment-repository.errors.js';
import {
  buildIdempotencyRecord,
  buildPayment,
} from '../../../helpers/payment-fixtures.js';

describe('InMemoryPaymentRepository', () => {
  it('rejects access before initialization', async () => {
    const repository = new InMemoryPaymentRepository();

    await expect(repository.findPaymentById('missing')).rejects.toBeInstanceOf(
      RepositoryNotInitializedError,
    );
  });

  it('atomically creates a payment with its idempotency record', async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.initialize();
    const payment = buildPayment();
    const record = buildIdempotencyRecord();

    await expect(repository.createPayment(payment, record)).resolves.toEqual({
      kind: 'created',
      payment,
    });
    await expect(repository.findPaymentById(payment.id)).resolves.toEqual(
      payment,
    );
    await expect(
      repository.findIdempotencyRecordByKey(record.key),
    ).resolves.toEqual(record);
  });

  it('replays the same idempotent request and conflicts on a different hash', async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.initialize();
    const payment = buildPayment();
    const record = buildIdempotencyRecord();
    await repository.createPayment(payment, record);

    await expect(repository.createPayment(payment, record)).resolves.toEqual({
      kind: 'replayed',
      payment,
    });
    await expect(
      repository.createPayment(payment, {
        ...record,
        requestHash: 'b'.repeat(64),
      }),
    ).resolves.toEqual({
      kind: 'idempotency_conflict',
      existingPaymentId: payment.id,
    });
  });

  it('allows only one concurrent update for an expected version', async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.initialize();
    const payment = buildPayment();
    await repository.createPayment(payment, buildIdempotencyRecord());
    const processingPayment = buildPayment({
      status: 'processing',
      attemptCount: 1,
      processingStartedAt: '2026-11-13T12:01:00.000Z',
      updatedAt: '2026-11-13T12:01:00.000Z',
      version: 2,
    });
    const failedPayment = buildPayment({
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      updatedAt: '2026-11-13T12:01:00.000Z',
      version: 2,
    });

    const results = await Promise.all([
      repository.updatePayment(processingPayment, 1),
      repository.updatePayment(failedPayment, 1),
    ]);

    expect(results.filter((result) => result.kind === 'updated')).toHaveLength(
      1,
    );
    expect(
      results.filter((result) => result.kind === 'version_conflict'),
    ).toHaveLength(1);
    expect((await repository.findPaymentById(payment.id))?.version).toBe(2);
  });

  it('rejects a candidate that does not increment the expected version', async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.initialize();
    const payment = buildPayment();
    await repository.createPayment(payment, buildIdempotencyRecord());

    await expect(
      repository.updatePayment(buildPayment({ version: 3 }), 1),
    ).rejects.toBeInstanceOf(InvalidPaymentVersionError);
    await expect(repository.findPaymentById(payment.id)).resolves.toEqual(
      payment,
    );
  });

  it('claims only the oldest due pending payment', async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.initialize();
    const first = buildPayment({
      id: '1351bb54-e5f2-42ee-8ef0-d2cc31b61cf8',
      createdAt: '2026-11-13T11:00:00.000Z',
      updatedAt: '2026-11-13T11:00:00.000Z',
    });
    const future = buildPayment({
      id: '4d04ff93-77fd-487f-81a9-39b80f6bf9fc',
      nextAttemptAt: '2026-11-13T14:00:00.000Z',
    });
    await repository.createPayment(
      first,
      buildIdempotencyRecord({ key: 'first', paymentId: first.id }),
    );
    await repository.createPayment(
      future,
      buildIdempotencyRecord({ key: 'future', paymentId: future.id }),
    );

    const claimed = await repository.claimNextDuePayment(
      new Date('2026-11-13T13:00:00.000Z'),
    );

    expect(claimed).toMatchObject({
      id: first.id,
      status: 'processing',
      attemptCount: 1,
      processingStartedAt: '2026-11-13T13:00:00.000Z',
      version: 2,
    });
    await expect(
      repository.claimNextDuePayment(new Date('2026-11-13T13:00:00.000Z')),
    ).resolves.toBeUndefined();
  });

  it('requeues only processing payments whose lease has expired', async () => {
    const expired = buildPayment({
      id: '1351bb54-e5f2-42ee-8ef0-d2cc31b61cf8',
      status: 'processing',
      attemptCount: 1,
      processingStartedAt: '2026-11-13T11:59:00.000Z',
      updatedAt: '2026-11-13T11:59:00.000Z',
      version: 2,
    });
    const active = buildPayment({
      id: '4d04ff93-77fd-487f-81a9-39b80f6bf9fc',
      status: 'processing',
      attemptCount: 1,
      processingStartedAt: '2026-11-13T11:59:45.001Z',
      updatedAt: '2026-11-13T11:59:45.001Z',
      version: 2,
    });
    const pending = buildPayment({
      id: '8cae7d58-8a6e-4297-bdd4-3c6140bcc98c',
    });
    const emptyDocument = new PaymentStorageState().toDocument();
    const repository = new InMemoryPaymentRepository({
      ...emptyDocument,
      payments: {
        [expired.id]: expired,
        [active.id]: active,
        [pending.id]: pending,
      },
    });
    await repository.initialize();

    await expect(
      repository.recoverExpiredPayments(
        new Date('2026-11-13T12:00:00.000Z'),
        30_000,
        3,
      ),
    ).resolves.toBe(1);
    await expect(repository.findPaymentById(expired.id)).resolves.toEqual({
      ...expired,
      status: 'pending',
      nextAttemptAt: '2026-11-13T12:00:00.000Z',
      processingStartedAt: undefined,
      updatedAt: '2026-11-13T12:00:00.000Z',
      version: 3,
    });
    await expect(repository.findPaymentById(active.id)).resolves.toEqual(
      active,
    );
    await expect(repository.findPaymentById(pending.id)).resolves.toEqual(
      pending,
    );
  });
});
