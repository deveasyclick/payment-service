import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { RateLimitExceededError } from '../shared/errors/http.errors.js';
import type { RateLimitConfig } from '../shared/types/config.types.js';

function createLimiter(config: RateLimitConfig): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) => {
      next(new RateLimitExceededError());
    },
  });
}

export function createGeneralRateLimiter(
  config: RateLimitConfig,
): RequestHandler {
  return createLimiter(config);
}

export function createMutationRateLimiter(
  config: RateLimitConfig,
): RequestHandler {
  return createLimiter(config);
}
