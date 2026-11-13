import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

function isValidRequestId(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }

  // Correlation IDs may contain letters, numbers, dots, underscores, colons, and hyphens.
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

export function requestIdMiddleware(): RequestHandler {
  return (request, response, next) => {
    const suppliedRequestId = request.get('x-request-id');
    const requestId = isValidRequestId(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

    response.setHeader('X-Request-Id', requestId);
    next();
  };
}
