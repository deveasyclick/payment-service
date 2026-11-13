import { createTestPaymentRepository } from '../helpers/create-test-payment-repository.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PaymentGateway,
  PaymentGatewayResult,
} from '../../src/modules/payments/types/payment-gateway.types.js';
import { PaymentWorker } from '../../src/modules/payments/payment.worker.js';
import type { JsonPaymentRepository } from '../../src/modules/payments/repositories/json-payment.repository.js';
import type { Clock } from '../../src/shared/types/clock.types.js';
import {
  buildIdempotencyRecord,
  buildPayment,
} from '../helpers/payment-fixtures.js';
import { ScriptedPaymentGateway } from '../helpers/scripted-payment-gateway.js';
import { captureLogs } from '../helpers/capture-logs.js';

const defaultWorkerOptions = {
  attemptTimeoutMs: 1_000,
  leaseMs: 30_000,
  maxAttempts: 3,
  pollIntervalMs: 250,
  retryBaseDelayMs: 250,
  shutdownTimeoutMs: 500,
} as const;

async function createSeededRepository(): Promise<JsonPaymentRepository> {
  const repository = await createTestPaymentRepository();
  await repository.createPayment(buildPayment(), buildIdempotencyRecord());
  return repository;
}

describe('PaymentWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('claims and completes a successful payment', async () => {
    const logs = captureLogs();
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
      logs.logger,
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
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment_attempt_started',
          paymentId: buildPayment().id,
          attemptCount: 1,
        }),
        expect.objectContaining({
          event: 'payment_completed',
          paymentId: buildPayment().id,
          attemptCount: 1,
          status: 'succeeded',
          durationMs: 0,
        }),
      ]),
    );
  });

  it('schedules a transient failure and succeeds on retry', async () => {
    const logs = captureLogs();
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
      logs.logger,
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
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment_retry_scheduled',
          paymentId: buildPayment().id,
          nextAttemptAt: '2026-11-13T12:01:00.250Z',
        }),
        expect.objectContaining({
          event: 'payment_completed',
          paymentId: buildPayment().id,
          attemptCount: 2,
        }),
      ]),
    );
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
    const enteredGateway = Promise.withResolvers<void>();
    const gateway: PaymentGateway = {
      processPayment: () => {
        enteredGateway.resolve();
        return new Promise<PaymentGatewayResult>(() => undefined);
      },
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      { ...defaultWorkerOptions, attemptTimeoutMs: 100, maxAttempts: 1 },
    );

    const processing = worker.processNextPayment();
    await enteredGateway.promise;
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
    const logs = captureLogs();
    const enteredGateway = Promise.withResolvers<void>();
    let resolveGateway: ((result: PaymentGatewayResult) => void) | undefined;
    const repository = await createSeededRepository();
    const gateway: PaymentGateway = {
      processPayment: () =>
        new Promise<PaymentGatewayResult>((resolve) => {
          resolveGateway = resolve;
          enteredGateway.resolve();
        }),
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
      undefined,
      logs.logger,
    );
    const processing = worker.processNextPayment();

    await enteredGateway.promise;
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
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment_worker_result_discarded',
          paymentId: buildPayment().id,
          reason: 'version_conflict',
        }),
      ]),
    );
    expect(
      logs.entries().some((entry) => entry.event === 'payment_completed'),
    ).toBe(false);
  });

  it('correlates persistence failures without recording raw provider errors', async () => {
    const logs = captureLogs();
    const repository = await createSeededRepository();
    vi.spyOn(repository, 'updatePayment').mockRejectedValue(
      new Error('storage-secret'),
    );
    const worker = new PaymentWorker(
      repository,
      new ScriptedPaymentGateway([new Error('provider-secret')]),
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
      () => 0,
      logs.logger,
    );

    await expect(worker.processNextPayment()).rejects.toThrow('storage-secret');
    expect(logs.text()).not.toContain('-secret');
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment_gateway_error',
          paymentId: buildPayment().id,
          level: 40,
        }),
        expect.objectContaining({
          event: 'payment_persistence_failed',
          paymentId: buildPayment().id,
          level: 50,
        }),
      ]),
    );
  });

  it('polls without overlapping and can be stopped', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    const enteredGateway = Promise.withResolvers<void>();
    const gateway = new ScriptedPaymentGateway([
      () => {
        enteredGateway.resolve();
        return { kind: 'succeeded' };
      },
    ]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
    );

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await enteredGateway.promise;
    await worker.stop();

    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(gateway.contexts).toHaveLength(1);
  });

  it('aborts active gateway work after the shutdown deadline', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    let attemptSignal: AbortSignal | undefined;
    const enteredGateway = Promise.withResolvers<void>();
    const gateway: PaymentGateway = {
      processPayment: (_payment, context) => {
        attemptSignal = context.signal;
        enteredGateway.resolve();
        return new Promise<PaymentGatewayResult>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => {
            reject(new Error('gateway attempt aborted'));
          });
        });
      },
    };
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      { ...defaultWorkerOptions, shutdownTimeoutMs: 100 },
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await enteredGateway.promise;

    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(100);

    await expect(stopping).resolves.toBe(false);
    expect(attemptSignal?.aborted).toBe(true);
    await expect(worker.stop()).resolves.toBe(true);
  });

  it('recovers a lease that expires after a quick restart without exceeding the attempt limit', async () => {
    const repository = await createSeededRepository();
    const start = new Date('2026-11-13T12:01:00.000Z');
    await repository.claimNextDuePayment(start);
    let now = new Date(start.getTime() + 1);
    const gateway = new ScriptedPaymentGateway([]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => now },
      { ...defaultWorkerOptions, maxAttempts: 1 },
    );

    expect(await worker.processNextPayment()).toBe(false);
    now = new Date(start.getTime() + defaultWorkerOptions.leaseMs);
    expect(await worker.processNextPayment()).toBe(false);
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'attempts_exhausted',
      attemptCount: 1,
    });
    expect(gateway.contexts).toHaveLength(0);
  });

  it('stops a non-cooperative gateway without writing a retry after shutdown', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    const enteredGateway = Promise.withResolvers<void>();
    const gateway = new ScriptedPaymentGateway([
      () => {
        enteredGateway.resolve();
        return new Promise<PaymentGatewayResult>(() => undefined);
      },
    ]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      { ...defaultWorkerOptions, shutdownTimeoutMs: 100 },
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await enteredGateway.promise;
    const stopping = worker.stop();
    await vi.advanceTimersByTimeAsync(100);
    await expect(stopping).resolves.toBe(false);
    await expect(worker.stop()).resolves.toBe(true);
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({
      status: 'processing',
      attemptCount: 1,
      version: 2,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(await worker.processNextPayment()).toBe(false);
  });

  it('does not start a gateway attempt if shutdown begins during a claim', async () => {
    vi.useFakeTimers();
    const repository = await createSeededRepository();
    const originalClaim = repository.claimNextDuePayment.bind(repository);
    const releaseClaim = Promise.withResolvers<void>();
    const enteredClaim = Promise.withResolvers<void>();
    vi.spyOn(repository, 'claimNextDuePayment').mockImplementation(
      async (now) => {
        enteredClaim.resolve();
        await releaseClaim.promise;
        return originalClaim(now);
      },
    );
    const gateway = new ScriptedPaymentGateway([{ kind: 'succeeded' }]);
    const worker = new PaymentWorker(
      repository,
      gateway,
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await enteredClaim.promise;
    const stopping = worker.stop();
    releaseClaim.resolve();
    await expect(stopping).resolves.toBe(true);
    expect(gateway.contexts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs poll failures with the injected logger and continues polling', async () => {
    vi.useFakeTimers();
    const logs = captureLogs();
    const repository = await createSeededRepository();
    vi.spyOn(repository, 'claimNextDuePayment').mockRejectedValueOnce(
      new Error('storage-secret'),
    );
    const enteredGateway = Promise.withResolvers<void>();
    const worker = new PaymentWorker(
      repository,
      new ScriptedPaymentGateway([
        () => {
          enteredGateway.resolve();
          return { kind: 'succeeded' };
        },
      ]),
      { now: () => new Date('2026-11-13T12:01:00.000Z') },
      defaultWorkerOptions,
      () => 0,
      logs.logger,
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(defaultWorkerOptions.pollIntervalMs);
    await enteredGateway.promise;
    await worker.stop();
    const failures = logs
      .entries()
      .filter((entry) => entry.event === 'payment_worker_poll_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      event: 'payment_worker_poll_failed',
      level: 50,
      err: { type: 'Error' },
    });
    expect(logs.text()).not.toContain('storage-secret');
    await expect(
      repository.findPaymentById(buildPayment().id),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
