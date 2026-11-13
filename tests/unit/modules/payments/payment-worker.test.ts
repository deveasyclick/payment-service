import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PaymentGateway,
  PaymentGatewayResult,
} from '../../../../src/modules/payments/payment-gateway.types.js';
import { PaymentWorker } from '../../../../src/modules/payments/payment.worker.js';
import { InMemoryPaymentRepository } from '../../../../src/modules/payments/repositories/in-memory-payment.repository.js';
import type { Clock } from '../../../../src/shared/types/clock.types.js';
import {
  buildIdempotencyRecord,
  buildPayment,
} from '../../../helpers/payment-fixtures.js';
import { ScriptedPaymentGateway } from '../../../helpers/scripted-payment-gateway.js';

const defaultWorkerOptions = {
  attemptTimeoutMs: 1_000,
  maxAttempts: 3,
  pollIntervalMs: 250,
  retryBaseDelayMs: 250,
} as const;

async function createSeededRepository(): Promise<InMemoryPaymentRepository> {
  const repository = new InMemoryPaymentRepository();
  await repository.initialize();
  await repository.createPayment(buildPayment(), buildIdempotencyRecord());
  return repository;
}

describe('PaymentWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('claims and completes a successful payment', async () => {
    const repository = await createSeededRepository();
    const gateway = new ScriptedPaymentGateway([{ kind: 'succeeded' }]);
    const clock: Clock = {
      now: () => new Date('2026-11-13T12:01:00.000Z'),
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      clock,
      defaultWorkerOptions,
      () => 0,
    );

    await expect(worker.processNextPayment()).resolves.toBe(true);
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
      version: 3,
    });
    expect(gateway.contexts[0]?.idempotencyKey).toBe(buildPayment().id);
  });

  it('schedules a transient failure and succeeds on retry', async () => {
    let currentTime = new Date('2026-11-13T12:01:00.000Z');
    const repository = await createSeededRepository();
    const gateway = new ScriptedPaymentGateway([
      {
        kind: 'failed',
        failureCode: 'processing_error',
        retryable: true,
      },
      { kind: 'succeeded' },
    ]);
    const clock: Clock = { now: () => new Date(currentTime) };
    const worker = new PaymentWorker(
      repository,
      gateway,
      clock,
      defaultWorkerOptions,
      () => 0,
    );

    await worker.processNextPayment();
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'pending',
      attemptCount: 1,
      nextAttemptAt: '2026-11-13T12:01:00.250Z',
      version: 3,
    });
    await expect(worker.processNextPayment()).resolves.toBe(false);

    currentTime = new Date('2026-11-13T12:01:00.250Z');
    await expect(worker.processNextPayment()).resolves.toBe(true);
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
      version: 5,
    });
  });

  it('fails immediately after a permanent provider decline', async () => {
    const repository = await createSeededRepository();
    const gateway = new ScriptedPaymentGateway([
      {
        kind: 'failed',
        failureCode: 'provider_declined',
        retryable: false,
      },
    ]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
    );

    await worker.processNextPayment();

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'provider_declined',
      attemptCount: 1,
    });
  });

  it('retries unknown errors and fails after attempts are exhausted', async () => {
    let currentTime = new Date('2026-11-13T12:01:00.000Z');
    const repository = await createSeededRepository();
    const gateway = new ScriptedPaymentGateway([
      new Error('temporary provider error'),
      new Error('provider still unavailable'),
    ]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date(currentTime) },
      { ...defaultWorkerOptions, maxAttempts: 2 },
      () => 0,
    );

    await worker.processNextPayment();
    currentTime = new Date('2026-11-13T12:01:00.250Z');
    await worker.processNextPayment();

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'attempts_exhausted',
      attemptCount: 2,
    });
  });

  it('times out a provider that never settles', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    const gateway: PaymentGateway = {
      processPayment: () => new Promise<PaymentGatewayResult>(() => undefined),
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      { ...defaultWorkerOptions, attemptTimeoutMs: 100, maxAttempts: 1 },
    );

    const processing = worker.processNextPayment();
    await vi.advanceTimersByTimeAsync(100);
    await processing;

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'processing_timeout',
      attemptCount: 1,
    });
  });

  it('does not overwrite an operator update with a late gateway result', async () => {
    let resolveGateway: ((result: PaymentGatewayResult) => void) | undefined;
    const repository = await createSeededRepository();
    const gateway: PaymentGateway = {
      processPayment: () =>
        new Promise<PaymentGatewayResult>((resolve) => {
          resolveGateway = resolve;
        }),
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
    );
    const processing = worker.processNextPayment();

    await vi.waitFor(async () => {
      expect(
        (await repository.findPaymentById(buildPayment().id))?.status,
      ).toBe('processing');
    });
    const claimed = await repository.findPaymentById(buildPayment().id);
    expect(claimed).toBeDefined();
    if (claimed === undefined) {
      throw new Error('Expected a claimed payment');
    }

    await repository.updatePayment(
      {
        ...claimed,
        status: 'failed',
        failureCode: 'cancelled_by_operator',
        updatedAt: '2026-11-13T12:01:01.000Z',
        version: claimed.version + 1,
      },
      claimed.version,
    );
    resolveGateway?.({ kind: 'succeeded' });
    await processing;

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      version: 3,
    });
  });

  it('polls without overlapping and can be stopped', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    const gateway = new ScriptedPaymentGateway([{ kind: 'succeeded' }]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
    );

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(gateway.contexts).toHaveLength(1);
  });
});
