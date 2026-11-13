import { describe, expect, it } from 'vitest';

import { SimulatedPaymentGateway } from '../../../src/infrastructure/gateway/simulated-payment.gateway.js';
import { buildPayment } from '../../helpers/payment-fixtures.js';

describe('SimulatedPaymentGateway', () => {
  it.each([
    ['succeeded', { kind: 'succeeded' }],
    [
      'declined',
      {
        kind: 'failed',
        failureCode: 'provider_declined',
        retryable: false,
      },
    ],
    [
      'transient_failure',
      {
        kind: 'failed',
        failureCode: 'processing_error',
        retryable: true,
      },
    ],
  ] as const)(
    'returns the configured %s outcome',
    async (outcome, expected) => {
      const gateway = new SimulatedPaymentGateway(0, outcome);

      await expect(
        gateway.processPayment(buildPayment(), {
          idempotencyKey: 'payment-id',
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(expected);
    },
  );

  it('honors attempt cancellation', async () => {
    const gateway = new SimulatedPaymentGateway(60_000);
    const abortController = new AbortController();
    const result = gateway.processPayment(buildPayment(), {
      idempotencyKey: 'payment-id',
      signal: abortController.signal,
    });

    abortController.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
