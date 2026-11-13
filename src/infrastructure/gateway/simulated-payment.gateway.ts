import { setTimeout as delay } from 'node:timers/promises';

import type {
  PaymentGateway,
  PaymentGatewayContext,
  PaymentGatewayResult,
} from '../../modules/payments/payment-gateway.types.js';
import type { Payment } from '../../modules/payments/payment.types.js';
import type { SimulatedGatewayOutcome } from '../../shared/types/config.types.js';

export class SimulatedPaymentGateway implements PaymentGateway {
  private readonly completedResults = new Map<string, PaymentGatewayResult>();

  constructor(
    private readonly latencyMs: number,
    private readonly outcome: SimulatedGatewayOutcome = 'succeeded',
  ) {}

  async processPayment(
    _payment: Payment,
    context: PaymentGatewayContext,
  ): Promise<PaymentGatewayResult> {
    await delay(this.latencyMs, undefined, { signal: context.signal });

    const existingResult = this.completedResults.get(context.idempotencyKey);
    if (existingResult !== undefined) {
      return existingResult;
    }

    if (this.outcome === 'transient_failure') {
      return {
        kind: 'failed',
        failureCode: 'processing_error',
        retryable: true,
      };
    }

    const result: PaymentGatewayResult =
      this.outcome === 'declined'
        ? {
            kind: 'failed',
            failureCode: 'provider_declined',
            retryable: false,
          }
        : { kind: 'succeeded' };
    this.completedResults.set(context.idempotencyKey, result);
    return result;
  }
}
