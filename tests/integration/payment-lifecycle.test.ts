import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { writeFileAtomically } from '../../src/infrastructure/storage/atomic-file-writer.js';
import { PaymentService } from '../../src/modules/payments/payment.service.js';
import { PaymentWorker } from '../../src/modules/payments/payment.worker.js';
import type { PaymentGatewayResult } from '../../src/modules/payments/payment-gateway.types.js';
import { JsonPaymentRepository } from '../../src/modules/payments/repositories/json-payment.repository.js';
import { UuidGenerator } from '../../src/shared/helpers/id-generator.js';
import { requestApp } from '../helpers/request-app.js';
import { ScriptedPaymentGateway } from '../helpers/scripted-payment-gateway.js';

describe('HTTP-to-storage payment lifecycle', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'payment-lifecycle-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function setup(failCreates = false) {
    let rejectWrites = false;
    const config = loadConfig({
      PAYMENT_DATA_FILE: join(directory, 'payments.json'),
    });
    const repository = new JsonPaymentRepository({
      filePath: config.dataFilePath,
      writeFileAtomically: async (path, contents) => {
        if (rejectWrites) throw new Error('simulated disk failure');
        await writeFileAtomically(path, contents);
      },
    });
    await repository.initialize();
    rejectWrites = failCreates;
    let now = new Date('2026-11-13T12:00:00.000Z');
    const clock = { now: () => new Date(now) };
    const service = new PaymentService(repository, clock, new UuidGenerator());
    const app = createApp({ config, paymentService: service });
    const create = () =>
      requestApp(app, '/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'lifecycle-key' },
        body: { amount: 2500, currency: 'NGN' },
      });
    return {
      app,
      create,
      config,
      repository,
      clock,
      advance: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
      allowWrites: () => {
        rejectWrites = false;
      },
      rejectWrites: () => {
        rejectWrites = true;
      },
    };
  }

  it('returns before gateway completion and preserves an operator win over a late worker result', async () => {
    const { app, create, config, repository, clock } = await setup();
    const created = await create();
    expect(created.status).toBe(202);
    const payment = JSON.parse(created.body) as { id: string; status: string };
    expect(payment.status).toBe('pending');
    const entered = Promise.withResolvers<void>();
    const result = Promise.withResolvers<PaymentGatewayResult>();
    const worker = new PaymentWorker(
      repository,
      {
        processPayment: () => {
          entered.resolve();
          return result.promise;
        },
      },
      clock,
      config.worker,
    );
    const processing = worker.processNextPayment();
    await entered.promise;
    try {
      const current = await requestApp(app, `/payments/${payment.id}`);
      const claimed = JSON.parse(current.body) as {
        status: string;
        version: number;
      };
      expect(claimed.status).toBe('processing');
      const updated = await requestApp(app, `/payments/${payment.id}/status`, {
        method: 'PATCH',
        body: {
          status: 'failed',
          expectedVersion: claimed.version,
          failureCode: 'cancelled_by_operator',
        },
      });
      expect(updated.status).toBe(200);
    } finally {
      result.resolve({ kind: 'succeeded' });
      await processing;
    }
    const final = await requestApp(app, `/payments/${payment.id}`);
    expect(JSON.parse(final.body) as unknown).toMatchObject({
      status: 'failed',
      failureCode: 'cancelled_by_operator',
      version: 3,
    });
  });

  it('serializes simultaneous duplicate creates into one durable payment', async () => {
    const { create, repository } = await setup();
    const responses = await Promise.all([create(), create()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 202,
    ]);
    const payments = responses.map(
      (response) => JSON.parse(response.body) as { id: string },
    );
    expect(payments[0]?.id).toBe(payments[1]?.id);
    const record = await repository.findIdempotencyRecordByKey('lifecycle-key');
    expect(record?.paymentId).toBe(payments[0]?.id);
  });

  it('does not consume an idempotency key after a failed create write', async () => {
    const { create, repository, allowWrites } = await setup(true);
    const failed = await create();
    expect(failed.status).toBe(500);
    expect(failed.body).not.toContain('simulated disk failure');
    await expect(
      repository.findIdempotencyRecordByKey('lifecycle-key'),
    ).resolves.toBeUndefined();
    allowWrites();
    expect((await create()).status).toBe(202);
  });

  it('resumes persisted pending retries in a new repository instance', async () => {
    const { create, repository, config, clock, advance } = await setup();
    const payment = JSON.parse((await create()).body) as { id: string };
    const first = new PaymentWorker(
      repository,
      new ScriptedPaymentGateway([
        { kind: 'failed', failureCode: 'processing_error', retryable: true },
      ]),
      clock,
      config.worker,
      () => 0,
    );
    await first.processNextPayment();
    const restarted = new JsonPaymentRepository({
      filePath: config.dataFilePath,
    });
    await restarted.initialize();
    advance(config.worker.retryBaseDelayMs);
    const worker = new PaymentWorker(
      restarted,
      new ScriptedPaymentGateway([{ kind: 'succeeded' }]),
      clock,
      config.worker,
    );
    await worker.processNextPayment();
    await expect(restarted.findPaymentById(payment.id)).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
    });
  });

  it('recovers a claimed payment after a completion write failure', async () => {
    const {
      create,
      repository,
      config,
      clock,
      advance,
      rejectWrites,
      allowWrites,
    } = await setup();
    const payment = JSON.parse((await create()).body) as { id: string };
    const worker = new PaymentWorker(
      repository,
      new ScriptedPaymentGateway([
        () => {
          rejectWrites();
          return { kind: 'succeeded' };
        },
        { kind: 'succeeded' },
      ]),
      clock,
      config.worker,
    );
    await expect(worker.processNextPayment()).rejects.toThrow(
      'simulated disk failure',
    );
    await expect(repository.findPaymentById(payment.id)).resolves.toMatchObject(
      { status: 'processing', attemptCount: 1 },
    );
    allowWrites();
    advance(config.worker.leaseMs);
    await worker.processNextPayment();
    const restarted = new JsonPaymentRepository({
      filePath: config.dataFilePath,
    });
    await restarted.initialize();
    await expect(restarted.findPaymentById(payment.id)).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
    });
  });

  it('waits for a still-active persisted lease to expire after restart, then processes it', async () => {
    const { create, repository, config, clock, advance } = await setup();
    const payment = JSON.parse((await create()).body) as { id: string };
    await repository.claimNextDuePayment(clock.now());
    const restarted = new JsonPaymentRepository({
      filePath: config.dataFilePath,
    });
    await restarted.initialize();
    const gateway = new ScriptedPaymentGateway([{ kind: 'succeeded' }]);
    const worker = new PaymentWorker(restarted, gateway, clock, config.worker);
    expect(await worker.processNextPayment()).toBe(false);
    advance(config.worker.leaseMs);
    expect(await worker.processNextPayment()).toBe(true);
    await expect(restarted.findPaymentById(payment.id)).resolves.toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
    });
    expect(gateway.contexts).toHaveLength(1);
  });

  it.each([
    '{ invalid json',
    JSON.stringify({
      amount: 2500,
      currency: 'NGN',
      reference: 'x'.repeat(17000),
    }),
  ])(
    'maps malformed or oversized HTTP bodies to safe errors',
    async (rawBody) => {
      const { app } = await setup();
      const response = await requestApp(app, '/payments', {
        method: 'POST',
        rawBody,
        headers: { 'Idempotency-Key': 'invalid-body-key' },
      });
      expect(response.status).toBe(rawBody.startsWith('{ invalid') ? 400 : 413);
      expect(JSON.parse(response.body) as unknown).toMatchObject({
        error: { path: '/payments' },
      });
    },
  );
});
