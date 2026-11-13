import express, { type Express } from 'express';
import helmet from 'helmet';

import { createAuthenticationMiddleware } from './middleware/authenticate.js';
import { createErrorHandler } from './middleware/error-handler.js';
import {
  createGeneralRateLimiter,
  createMutationRateLimiter,
} from './middleware/rate-limit.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { createPaymentRouter } from './modules/payments/payment.routes.js';
import {
  RouteNotFoundError,
  ServiceNotReadyError,
} from './shared/errors/http.errors.js';
import type { AppDependencies } from './shared/types/http.types.js';

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');

  if (dependencies.config.trustedProxyHops > 0) {
    app.set('trust proxy', dependencies.config.trustedProxyHops);
  }

  app.use(requestIdMiddleware());
  app.use(helmet());

  app.get('/health/live', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });
  app.get('/health/ready', (_request, response, next) => {
    if (dependencies.isReady?.() === false) {
      next(new ServiceNotReadyError());
      return;
    }

    response.status(200).json({ status: 'ready' });
  });

  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(createGeneralRateLimiter(dependencies.config.rateLimit));
  app.use(
    '/payments',
    createAuthenticationMiddleware(dependencies.config.apiKey),
    createPaymentRouter(
      dependencies.paymentService,
      createMutationRateLimiter(dependencies.config.mutationRateLimit),
    ),
  );

  app.use((_request, _response, next) => {
    next(new RouteNotFoundError());
  });
  app.use(createErrorHandler(dependencies.reportUnexpectedError));

  return app;
}
