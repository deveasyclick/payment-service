import { Router, type RequestHandler } from 'express';

import { PaymentController } from './payment.controller.js';
import type { PaymentIdParams } from './payment-http.types.js';
import type { PaymentUseCases } from './payment-service.types.js';

export function createPaymentRouter(
  paymentService: PaymentUseCases,
  mutationRateLimiter: RequestHandler,
): Router {
  const router = Router();
  const controller = new PaymentController(paymentService);

  router.post('/', mutationRateLimiter, controller.createPayment);
  router.get<PaymentIdParams>('/:id', controller.getPayment);
  router.patch<PaymentIdParams>(
    '/:id/status',
    mutationRateLimiter,
    controller.updatePaymentStatus,
  );

  return router;
}
