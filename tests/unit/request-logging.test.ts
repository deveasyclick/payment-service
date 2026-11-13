import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createRequestLoggingMiddleware } from '../../src/middleware/request-logging.js';
import { captureLogs } from '../helpers/capture-logs.js';

describe('request logging', () => {
  it.each([
    [200, 30],
    [400, 40],
    [500, 50],
  ])(
    'logs HTTP %i with level %i and safe request correlation',
    (statusCode, level) => {
      const logs = captureLogs();
      const socket = new Socket();
      const request = new IncomingMessage(socket);
      request.method = 'POST';
      request.url = '/payments?token=query-secret';
      request.headers = {
        authorization: 'auth-secret',
        'x-api-key': 'key-secret',
        'idempotency-key': 'idempotency-secret',
      };
      Object.assign(request, { body: { reference: 'body-secret' } });
      const response = new ServerResponse(request);
      response.setHeader('X-Request-Id', 'request-123');
      response.statusCode = statusCode;
      const next = vi.fn();

      createRequestLoggingMiddleware(logs.logger)(
        request as Request,
        response as Response,
        next,
      );
      request.log.info(
        { event: 'payment_created', paymentId: 'payment-123' },
        'Payment created',
      );
      response.emit('finish');
      socket.destroy();

      expect(next).toHaveBeenCalledOnce();
      expect(logs.text()).not.toContain('-secret');
      expect(logs.entries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'payment_created',
            paymentId: 'payment-123',
            requestId: 'request-123',
          }),
          expect.objectContaining({
            event: 'http_request_completed',
            requestId: 'request-123',
            level,
            req: { method: 'POST', path: '/payments' },
            res: { statusCode },
          }),
        ]),
      );
      expect(
        logs.entries().find((entry) => entry.event === 'http_request_completed')
          ?.responseTime,
      ).toBeTypeOf('number');
    },
  );

  it('keeps the original mounted pathname when Express rewrites the request URL', () => {
    const logs = captureLogs();
    const socket = new Socket();
    const request = new IncomingMessage(socket);
    request.method = 'GET';
    request.url = '/not-a-uuid?token=query-secret';
    Object.assign(request, {
      originalUrl: '/payments/not-a-uuid?token=query-secret',
    });
    const response = new ServerResponse(request);
    response.setHeader('X-Request-Id', 'mounted-request');
    response.statusCode = 400;

    createRequestLoggingMiddleware(logs.logger)(
      request as Request,
      response as Response,
      vi.fn(),
    );
    response.emit('finish');
    socket.destroy();

    expect(logs.entries()[0]).toMatchObject({
      requestId: 'mounted-request',
      req: { method: 'GET', path: '/payments/not-a-uuid' },
    });
    expect(logs.text()).not.toContain('query-secret');
    expect(logs.text()).not.toContain('?');
  });
});
