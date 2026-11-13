import type { AppConfig } from './config.types.js';
import type { Logger } from 'pino';
import type { PaymentUseCases } from '../../modules/payments/payment-service.types.js';

export type UnexpectedErrorReporter = (
  error: unknown,
  requestId: string,
) => void;

export interface AppDependencies {
  readonly logger?: Logger;
  readonly config: AppConfig;
  readonly paymentService: PaymentUseCases;
  readonly isReady?: () => boolean;
  readonly reportUnexpectedError?: UnexpectedErrorReporter;
}

export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}

export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
    readonly requestId: string;
  };
}
