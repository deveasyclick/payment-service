import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PAYMENT_FAILURE_CODES,
  PAYMENT_STATUSES,
} from '../../src/modules/payments/payment.const.js';
import { toPublicPayment } from '../../src/modules/payments/payment.mapper.js';
import {
  getPaymentRequestJsonSchemas,
  parseCreatePaymentBody,
  parseUpdatePaymentStatusBody,
} from '../../src/modules/payments/payment.schemas.js';
import { buildPayment } from '../helpers/payment-fixtures.js';

const record = z.record(z.string(), z.unknown());
const documentSchema = z.object({
  openapi: z.literal('3.1.0'),
  security: z.array(record),
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        operationId: z.string(),
        responses: record,
        security: z.array(record).optional(),
      }),
    ),
  ),
  components: z.object({
    schemas: z.record(z.string(), record),
    securitySchemes: z.record(z.string(), record),
    headers: z.record(z.string(), record),
  }),
});
const rawDocument: unknown = JSON.parse(
  await readFile(new URL('../../openapi.json', import.meta.url), 'utf8'),
);
const document = documentSchema.parse(rawDocument);

function withoutAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAnnotations);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['description', 'examples'].includes(key))
      .map(([key, child]) => [key, withoutAnnotations(child)]),
  );
}

function verifyReferences(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(verifyReferences);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref') {
      expect(typeof child).toBe('string');
      if (typeof child !== 'string') throw new Error('Invalid reference');
      expect(child.startsWith('#/')).toBe(true);
      let target: unknown = rawDocument;
      for (const segment of child.slice(2).split('/')) {
        target = record.parse(target)[segment];
      }
      expect(target, `Unresolved reference: ${child}`).toBeDefined();
    } else verifyReferences(child);
  }
}

describe('OpenAPI contract', () => {
  it.each(Object.entries(getPaymentRequestJsonSchemas()))(
    'keeps %s identical to the runtime Zod schema',
    (name, schema) => {
      expect(withoutAnnotations(document.components.schemas[name])).toEqual(
        withoutAnnotations(schema),
      );
    },
  );

  it('resolves all local references', () => {
    verifyReferences(rawDocument);
  });

  it('publishes create and status examples accepted by the runtime parsers', () => {
    const creates = z
      .array(z.unknown())
      .parse(document.components.schemas.CreatePayment?.examples);
    const updates = z
      .array(z.unknown())
      .parse(document.components.schemas.UpdatePaymentStatus?.examples);
    for (const example of creates)
      expect(() => parseCreatePaymentBody(example)).not.toThrow();
    for (const example of updates)
      expect(() => parseUpdatePaymentStatusBody(example)).not.toThrow();
    expect(creates).toContainEqual({
      amount: 2500,
      currency: 'NGN',
      reference: 'order-123',
    });
    const properties = record.parse(
      document.components.schemas.CreatePayment?.properties,
    );
    expect(record.parse(properties.amount).description).toContain(
      'kobo (₦25.00)',
    );
  });

  it('matches the public mapper fields, status enum, and failure codes', () => {
    const payment = document.components.schemas.Payment;
    const properties = record.parse(payment?.properties);
    expect(Object.keys(properties).sort()).toEqual(
      Object.keys(
        toPublicPayment(
          buildPayment({
            reference: 'order-123',
            status: 'failed',
            failureCode: 'provider_declined',
          }),
        ),
      ).sort(),
    );
    expect(record.parse(properties.status).enum).toEqual([...PAYMENT_STATUSES]);
    expect(record.parse(properties.failureCode).enum).toEqual([
      ...PAYMENT_FAILURE_CODES,
    ]);
    const required = z.array(z.string()).parse(payment?.required);
    expect(required.toSorted()).toEqual(
      Object.keys(toPublicPayment(buildPayment())).sort(),
    );
  });

  it('documents all routes and their important status codes', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      '/health',
      '/health/live',
      '/health/ready',
      '/payments',
      '/payments/{id}',
      '/payments/{id}/status',
    ]);
    const expected = [
      [
        '/payments',
        'post',
        ['200', '202', '400', '401', '409', '413', '429', '500'],
      ],
      [
        '/payments/{id}',
        'get',
        ['200', '400', '401', '404', '413', '429', '500'],
      ],
      [
        '/payments/{id}/status',
        'patch',
        ['200', '400', '401', '404', '409', '412', '413', '429', '500'],
      ],
      ['/health', 'get', ['200']],
      ['/health/live', 'get', ['200']],
      ['/health/ready', 'get', ['200', '503']],
    ] as const;
    for (const [path, method, statuses] of expected) {
      expect(
        Object.keys(document.paths[path]?.[method]?.responses ?? {}).sort(),
      ).toEqual([...statuses].sort());
    }
  });

  it('documents conditional API-key authentication, public health checks, and rate-limit headers', () => {
    expect(document.security).toEqual([{ ApiKey: [] }]);
    expect(document.components.securitySchemes.ApiKey).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    for (const path of ['/health', '/health/live', '/health/ready'])
      expect(document.paths[path]?.get?.security).toEqual([]);
    expect(document.components.headers).toHaveProperty('RateLimit');
    expect(document.components.headers).toHaveProperty('RateLimitPolicy');
    expect(document.components.headers).toHaveProperty('RequestId');
  });

  it('requires the request pathname on every error envelope', () => {
    const error = record.parse(
      record.parse(document.components.schemas.Error?.properties).error,
    );
    expect(error.required).toEqual(['code', 'message', 'path', 'requestId']);
    expect(record.parse(error.properties)).toHaveProperty('path');
  });
});
