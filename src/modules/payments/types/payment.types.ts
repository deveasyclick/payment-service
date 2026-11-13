import {
  PAYMENT_FAILURE_CODES,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITION_ACTORS,
} from '../payment.const.js';

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentFailureCode = (typeof PAYMENT_FAILURE_CODES)[number];
export type PaymentTransitionActor = (typeof PAYMENT_TRANSITION_ACTORS)[number];

export interface PaymentTransition {
  readonly actor: PaymentTransitionActor;
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
}

export interface Payment {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly reference?: string;
  readonly status: PaymentStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string;
  readonly processingStartedAt?: string;
  readonly failureCode?: PaymentFailureCode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PublicPayment {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly reference?: string;
  readonly status: PaymentStatus;
  readonly attemptCount: number;
  readonly failureCode?: PaymentFailureCode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface IdempotencyRecord {
  readonly key: string;
  readonly requestHash: string;
  readonly paymentId: string;
  readonly createdAt: string;
}
