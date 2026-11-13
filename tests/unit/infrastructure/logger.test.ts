import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/infrastructure/logging/logger.js';
import { captureLogs } from '../../helpers/capture-logs.js';

describe('structured logger', () => {
  it('serializes aggregate failures without exposing their raw messages', () => {
    const logs = captureLogs();
    logs.logger.error(
      {
        err: new AggregateError(
          [new TypeError('startup-secret'), new RangeError('cleanup-secret')],
          'aggregate-secret',
        ),
      },
      'Startup failed',
    );
    expect(logs.entries()[0]).toMatchObject({
      err: {
        type: 'AggregateError',
        errors: [{ type: 'TypeError' }, { type: 'RangeError' }],
      },
    });
    expect(logs.text()).not.toContain('-secret');
  });
  it('redacts secrets and bodies at the root and within request objects', () => {
    const logs = captureLogs();
    logs.logger.info(
      {
        event: 'redaction_test',
        apiKey: 'root-api-secret',
        authorization: 'root-auth-secret',
        idempotencyKey: 'root-idempotency-secret',
        body: { reference: 'root-body-secret' },
        req: {
          headers: {
            authorization: 'header-secret',
            'x-api-key': 'key-secret',
            'idempotency-key': 'idempotency-secret',
          },
          body: { reference: 'body-secret' },
        },
        request: {
          headers: { cookie: 'cookie-secret' },
          body: { reference: 'request-body-secret' },
        },
      },
      'Safe fixed message',
    );

    expect(logs.text()).not.toContain('-secret');
    expect(logs.entries()[0]).toMatchObject({
      event: 'redaction_test',
      apiKey: '[REDACTED]',
      body: '[REDACTED]',
    });
  });

  it('keeps error type and call sites without raw messages, causes, or properties', () => {
    const logs = captureLogs();
    const error = Object.assign(
      new Error('provider-secret\nmultiline-secret', {
        cause: new Error('cause-secret'),
      }),
      { apiKey: 'property-secret' },
    );
    logs.logger.error(
      { err: error, paymentId: 'payment-1' },
      'Persistence failed',
    );

    expect(logs.text()).not.toContain('-secret');
    expect(logs.entries()[0]).toMatchObject({
      paymentId: 'payment-1',
      err: { type: 'Error' },
    });
    expect(logs.text()).toContain('at ');
  });

  it('supports a silent logger without mutating global logging state', () => {
    const lines: string[] = [];
    createLogger('silent', {
      write: (line) => {
        lines.push(line);
      },
    }).info('Hidden');
    expect(lines).toEqual([]);
  });
});
