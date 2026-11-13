import type { Payment, PaymentFailureCode } from './payment.types.js';

export interface PaymentGatewayContext {
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

export type PaymentGatewayResult =
  | { readonly kind: 'succeeded' }
  | {
      readonly kind: 'failed';
      readonly failureCode: PaymentFailureCode;
      readonly retryable: boolean;
    };

export interface PaymentGateway {
  processPayment(
    payment: Payment,
    context: PaymentGatewayContext,
  ): Promise<PaymentGatewayResult>;
}
