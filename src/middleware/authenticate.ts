import { timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';

import { AuthenticationError } from '../shared/errors/http.errors.js';

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createAuthenticationMiddleware(
  apiKey: string | undefined,
): RequestHandler {
  return (request, _response, next) => {
    if (apiKey === undefined) {
      next();
      return;
    }

    const suppliedApiKey = request.get('x-api-key');

    if (suppliedApiKey === undefined || !secretsMatch(suppliedApiKey, apiKey)) {
      next(new AuthenticationError());
      return;
    }

    next();
  };
}
