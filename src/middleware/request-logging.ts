import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';

import { serializeError } from '../infrastructure/logging/logger.js';

export function createRequestLoggingMiddleware(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    quietReqLogger: true,
    customAttributeKeys: { reqId: 'requestId' },
    genReqId: (_request, response) =>
      String(response.getHeader('X-Request-Id')),
    wrapSerializers: false,
    serializers: {
      req: (request: { method?: string }) => ({ method: request.method }),
      res: (response: { statusCode: number }) => ({
        statusCode: response.statusCode,
      }),
      err: serializeError,
    },
    customLogLevel: (_request, response, error) => {
      if (error !== undefined || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: () => 'HTTP request completed',
    customErrorMessage: () => 'HTTP request failed',
    customProps: () => ({ event: 'http_request_completed' }),
  });
}
