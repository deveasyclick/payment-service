import type { IdempotencyRecord, Payment } from './payment.types.js';

export type CreatePaymentResult =
  | { readonly kind: 'created'; readonly payment: Payment }
  | { readonly kind: 'replayed'; readonly payment: Payment }
  | {
      readonly kind: 'idempotency_conflict';
      readonly existingPaymentId: string;
    };

export type UpdatePaymentResult =
  | { readonly kind: 'updated'; readonly payment: Payment }
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'version_conflict';
      readonly currentPayment: Payment;
    };

export interface PaymentRepository {
  initialize(): Promise<void>;
  createPayment(
    payment: Payment,
    idempotencyRecord: IdempotencyRecord,
  ): Promise<CreatePaymentResult>;
  findPaymentById(id: string): Promise<Payment | undefined>;
  findIdempotencyRecordByKey(
    key: string,
  ): Promise<IdempotencyRecord | undefined>;
  updatePayment(
    payment: Payment,
    expectedVersion: number,
  ): Promise<UpdatePaymentResult>;
  claimNextDuePayment(now: Date): Promise<Payment | undefined>;
}
