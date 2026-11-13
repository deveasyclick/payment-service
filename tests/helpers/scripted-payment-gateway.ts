import type {
  PaymentGateway,
  PaymentGatewayContext,
  PaymentGatewayResult,
} from '../../src/modules/payments/payment-gateway.types.js';
import type { Payment } from '../../src/modules/payments/payment.types.js';

type GatewayStep =
  | PaymentGatewayResult
  | Error
  | ((
      payment: Payment,
      context: PaymentGatewayContext,
    ) => PaymentGatewayResult | Promise<PaymentGatewayResult>);

export class ScriptedPaymentGateway implements PaymentGateway {
  readonly contexts: PaymentGatewayContext[] = [];
  private readonly steps: GatewayStep[];

  constructor(steps: readonly GatewayStep[]) {
    this.steps = [...steps];
  }

  async processPayment(
    payment: Payment,
    context: PaymentGatewayContext,
  ): Promise<PaymentGatewayResult> {
    this.contexts.push(context);
    const step = this.steps.shift();

    if (step === undefined) {
      throw new Error('Scripted payment gateway has no remaining steps');
    }

    if (step instanceof Error) {
      throw step;
    }

    return typeof step === 'function' ? step(payment, context) : step;
  }
}
