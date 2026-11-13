import type { PaymentFailureCode, PublicPayment } from './payment.types.js';

export interface CreatePaymentCommand {
  readonly amount: number;
  readonly currency: string;
  readonly reference?: string;
  readonly idempotencyKey: string;
}

export type CreatePaymentBody = Omit<CreatePaymentCommand, 'idempotencyKey'>;

export interface NormalizedCreatePaymentRequest {
  readonly amount: number;
  readonly currency: string;
  readonly reference?: string;
}

export interface CreatePaymentOutcome {
  readonly payment: PublicPayment;
  readonly replayed: boolean;
}

export type UpdatePaymentStatusCommand =
  | {
      readonly paymentId: string;
      readonly status: 'succeeded';
      readonly expectedVersion: number;
      readonly failureCode?: never;
    }
  | {
      readonly paymentId: string;
      readonly status: 'failed';
      readonly expectedVersion: number;
      readonly failureCode: PaymentFailureCode;
    };

export type UpdatePaymentStatusBody =
  | {
      readonly status: 'succeeded';
      readonly expectedVersion: number;
      readonly failureCode?: never;
    }
  | {
      readonly status: 'failed';
      readonly expectedVersion: number;
      readonly failureCode: PaymentFailureCode;
    };

export interface PaymentUseCases {
  createPayment(command: CreatePaymentCommand): Promise<CreatePaymentOutcome>;
  getPayment(paymentId: string): Promise<PublicPayment>;
  updatePaymentStatus(
    command: UpdatePaymentStatusCommand,
  ): Promise<PublicPayment>;
}
