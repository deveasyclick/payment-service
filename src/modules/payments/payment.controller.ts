import type { RequestHandler } from 'express';

import type { PaymentIdParams } from './payment-http.types.js';
import type { PaymentUseCases } from './payment-service.types.js';
import {
  parseCreatePaymentBody,
  parseIdempotencyKey,
  parsePaymentId,
  parseUpdatePaymentStatusBody,
} from './payment.schemas.js';

export class PaymentController {
  constructor(private readonly paymentService: PaymentUseCases) {}

  readonly createPayment: RequestHandler<
    Record<string, never>,
    unknown,
    unknown
  > = async (request, response) => {
    const body = parseCreatePaymentBody(request.body);
    const idempotencyKey = parseIdempotencyKey(request.get('idempotency-key'));
    const result = await this.paymentService.createPayment({
      ...body,
      idempotencyKey,
    });

    response.location(`/payments/${result.payment.id}`);

    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
      response.status(200).json(result.payment);
      return;
    }

    response.status(202).json(result.payment);
  };

  readonly getPayment: RequestHandler<PaymentIdParams> = async (
    request,
    response,
  ) => {
    const paymentId = parsePaymentId(request.params.id);
    const payment = await this.paymentService.getPayment(paymentId);
    response.status(200).json(payment);
  };

  readonly updatePaymentStatus: RequestHandler<
    PaymentIdParams,
    unknown,
    unknown
  > = async (request, response) => {
    const paymentId = parsePaymentId(request.params.id);
    const body = parseUpdatePaymentStatusBody(request.body);
    const payment = await this.paymentService.updatePaymentStatus({
      ...body,
      paymentId,
    });
    response.status(200).json(payment);
  };
}
