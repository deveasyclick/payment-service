import type { ErrorRequestHandler, Request, Response } from 'express';
import { ZodError } from 'zod';

import {
  InvalidPaymentTransitionError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentVersionConflictError,
} from '../modules/payments/payment.errors.js';
import {
  AuthenticationError,
  RateLimitExceededError,
  RouteNotFoundError,
  ServiceNotReadyError,
} from '../shared/errors/http.errors.js';
import type {
  ErrorDetail,
  ErrorResponse,
  UnexpectedErrorReporter,
} from '../shared/types/http.types.js';

function requestIdFrom(response: Response): string {
  const requestId = response.getHeader('X-Request-Id');
  return typeof requestId === 'string' ? requestId : 'unknown';
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: readonly ErrorDetail[],
): void {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: requestIdFrom(response),
    },
  };

  response.status(status).json(body);
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }

  return undefined;
}

function reportSafely(
  reporter: UnexpectedErrorReporter,
  error: unknown,
  requestId: string,
): void {
  try {
    reporter(error, requestId);
  } catch {
    // Error reporting must never replace the original request failure.
  }
}

export function createErrorHandler(
  reportUnexpectedError: UnexpectedErrorReporter = () => undefined,
): ErrorRequestHandler {
  return (error: unknown, _request: Request, response: Response, _next) => {
    void _next;

    if (error instanceof ZodError) {
      sendError(
        response,
        400,
        'VALIDATION_ERROR',
        'Request validation failed',
        error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
      return;
    }

    if (errorStatus(error) === 413) {
      sendError(
        response,
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body is too large',
      );
      return;
    }

    if (errorStatus(error) === 400 && error instanceof SyntaxError) {
      sendError(
        response,
        400,
        'INVALID_JSON',
        'Request body contains invalid JSON',
      );
      return;
    }

    if (error instanceof AuthenticationError) {
      sendError(response, 401, 'UNAUTHORIZED', error.message);
      return;
    }

    if (error instanceof PaymentNotFoundError) {
      sendError(response, 404, 'PAYMENT_NOT_FOUND', error.message);
      return;
    }

    if (error instanceof RouteNotFoundError) {
      sendError(response, 404, 'ROUTE_NOT_FOUND', error.message);
      return;
    }

    if (error instanceof PaymentIdempotencyConflictError) {
      sendError(response, 409, 'IDEMPOTENCY_CONFLICT', error.message);
      return;
    }

    if (error instanceof InvalidPaymentTransitionError) {
      sendError(response, 409, 'INVALID_PAYMENT_TRANSITION', error.message);
      return;
    }

    if (error instanceof PaymentVersionConflictError) {
      sendError(response, 412, 'PAYMENT_VERSION_CONFLICT', error.message);
      return;
    }

    if (error instanceof RateLimitExceededError) {
      sendError(response, 429, 'RATE_LIMIT_EXCEEDED', error.message);
      return;
    }

    if (error instanceof ServiceNotReadyError) {
      sendError(response, 503, 'SERVICE_NOT_READY', error.message);
      return;
    }

    reportSafely(reportUnexpectedError, error, requestIdFrom(response));
    sendError(response, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  };
}
