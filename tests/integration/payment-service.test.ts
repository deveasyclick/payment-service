import { createTestPaymentRepository } from '../helpers/create-test-payment-repository.js';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';

import type { JsonPaymentRepository } from '../../src/modules/payments/repositories/json-payment.repository.js';
import {
  InvalidPaymentTransitionError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentVersionConflictError,
} from '../../src/modules/payments/payment.errors.js';
import type { UpdatePaymentStatusCommand } from '../../src/modules/payments/types/payment-service.types.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import type { Clock } from '../../src/shared/types/clock.types.js';
import type { IdGenerator } from '../../src/shared/types/id-generator.types.js';

const firstPaymentId = '7ccf50b4-1c73-44c9-97ae-c0fd218d18ec';
const secondPaymentId = '1351bb54-e5f2-42ee-8ef0-d2cc31b61cf8';

describe('PaymentService', () => {
  let currentTime: Date;
  let generatedIdIndex: number;
  let repository: JsonPaymentRepository;
  let service: PaymentService;

  beforeEach(async () => {
    currentTime = new Date('2026-11-13T12:00:00.000Z');
    generatedIdIndex = 0;
    const clock: Clock = { now: () => new Date(currentTime) };
    const ids = [firstPaymentId, secondPaymentId] as const;
    const idGenerator: IdGenerator = {
      generate: () => ids[generatedIdIndex++] ?? secondPaymentId,
    };
    repository = await createTestPaymentRepository();
    service = new PaymentService(repository, clock, idGenerator);
  });

  it('atomically creates a pending payment in minor units', async () => {
    const result = await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      reference: '  order-123  ',
      idempotencyKey: 'create-order-123',
    });

    expect(result).toEqual({
      replayed: false,
      payment: {
        id: firstPaymentId,
        amount: 2_500,
        currency: 'NGN',
        reference: 'order-123',
        status: 'pending',
        attemptCount: 0,
        createdAt: '2026-11-13T12:00:00.000Z',
        updatedAt: '2026-11-13T12:00:00.000Z',
        version: 1,
      },
    });
    await expect(repository.findPaymentById(firstPaymentId)).resolves.toEqual(
      expect.objectContaining({ amount: 2_500, status: 'pending' }),
    );
    const idempotencyRecord =
      await repository.findIdempotencyRecordByKey('create-order-123');
    expect(idempotencyRecord?.paymentId).toBe(firstPaymentId);
    // SHA-256 encoded as exactly 64 lowercase hexadecimal characters.
    expect(idempotencyRecord?.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('returns the original payment for a normalized idempotent replay', async () => {
    const first = await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      reference: ' order-123 ',
      idempotencyKey: 'same-key',
    });
    const replay = await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      reference: 'order-123',
      idempotencyKey: 'same-key',
    });

    expect(replay).toEqual({ replayed: true, payment: first.payment });
    expect(replay.payment.id).toBe(firstPaymentId);
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'same-key',
    });

    await expect(
      service.createPayment({
        amount: 3_000,
        currency: 'NGN',
        idempotencyKey: 'same-key',
      }),
    ).rejects.toMatchObject({
      name: 'PaymentIdempotencyConflictError',
      existingPaymentId: firstPaymentId,
    } satisfies Partial<PaymentIdempotencyConflictError>);
  });

  it('retrieves an existing payment and rejects a missing payment', async () => {
    const created = await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'retrieve-key',
    });

    await expect(service.getPayment(firstPaymentId)).resolves.toEqual(
      created.payment,
    );
    await expect(service.getPayment(secondPaymentId)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('finalizes a payment as failed with a failure code', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'failure-key',
    });
    currentTime = new Date('2026-11-13T12:01:00.000Z');

    const updated = await service.updatePaymentStatus({
      paymentId: firstPaymentId,
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      expectedVersion: 1,
    });

    expect(updated).toMatchObject({
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      updatedAt: '2026-11-13T12:01:00.000Z',
      version: 2,
    });
  });

  it('finalizes a payment as succeeded without a failure code', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'success-key',
    });

    const updated = await service.updatePaymentStatus({
      paymentId: firstPaymentId,
      status: 'succeeded',
      expectedVersion: 1,
    });

    expect(updated.status).toBe('succeeded');
    expect(updated).not.toHaveProperty('failureCode');
  });

  it('rejects invalid create and status-update inputs', async () => {
    await expect(
      service.createPayment({
        amount: 25.5,
        currency: 'ngn',
        idempotencyKey: 'invalid-key',
      }),
    ).rejects.toBeInstanceOf(ZodError);

    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'valid-key',
    });
    const missingFailureCode = {
      paymentId: firstPaymentId,
      status: 'failed',
      expectedVersion: 1,
    } as unknown as UpdatePaymentStatusCommand;

    await expect(
      service.updatePaymentStatus(missingFailureCode),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('does not reopen a terminal payment', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'terminal-key',
    });
    await service.updatePaymentStatus({
      paymentId: firstPaymentId,
      status: 'succeeded',
      expectedVersion: 1,
    });

    await expect(
      service.updatePaymentStatus({
        paymentId: firstPaymentId,
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
  });

  it('rejects a stale expected version', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'version-key',
    });
    await service.updatePaymentStatus({
      paymentId: firstPaymentId,
      status: 'succeeded',
      expectedVersion: 1,
    });

    await expect(
      service.updatePaymentStatus({
        paymentId: firstPaymentId,
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      name: 'PaymentVersionConflictError',
      expectedVersion: 1,
      currentVersion: 2,
    } satisfies Partial<PaymentVersionConflictError>);
  });

  it('allows only one of two concurrent updates to win', async () => {
    await service.createPayment({
      amount: 2_500,
      currency: 'NGN',
      idempotencyKey: 'race-key',
    });

    const results = await Promise.allSettled([
      service.updatePaymentStatus({
        paymentId: firstPaymentId,
        status: 'succeeded',
        expectedVersion: 1,
      }),
      service.updatePaymentStatus({
        paymentId: firstPaymentId,
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        expectedVersion: 1,
      }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejection?.reason).toBeInstanceOf(PaymentVersionConflictError);
  });
});
