import type { PaymentRepository } from './payment-repository.types.js';
import {
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentVersionConflictError,
} from './payment.errors.js';
import {
  hashCreatePaymentRequest,
  normalizeCreatePaymentRequest,
} from './payment-idempotency.js';
import { toPublicPayment } from './payment.mapper.js';
import {
  parseCreatePaymentCommand,
  parseUpdatePaymentStatusCommand,
} from './payment.schemas.js';
import type {
  CreatePaymentCommand,
  CreatePaymentOutcome,
  UpdatePaymentStatusCommand,
} from './payment-service.types.js';
import { assertPaymentTransitionAllowed } from './payment.state-machine.js';
import type { Payment, PublicPayment } from './payment.types.js';
import type { Clock } from '../../shared/types/clock.types.js';
import type { IdGenerator } from '../../shared/types/id-generator.types.js';

export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async createPayment(
    command: CreatePaymentCommand,
  ): Promise<CreatePaymentOutcome> {
    const parsedCommand = parseCreatePaymentCommand(command);
    const request = normalizeCreatePaymentRequest(parsedCommand);
    const timestamp = this.clock.now().toISOString();
    const paymentId = this.idGenerator.generate();
    const payment: Payment = {
      id: paymentId,
      amount: request.amount,
      currency: request.currency,
      ...(request.reference === undefined
        ? {}
        : { reference: request.reference }),
      status: 'pending',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const result = await this.repository.createPayment(payment, {
      key: parsedCommand.idempotencyKey,
      requestHash: hashCreatePaymentRequest(request),
      paymentId,
      createdAt: timestamp,
    });

    if (result.kind === 'idempotency_conflict') {
      throw new PaymentIdempotencyConflictError(result.existingPaymentId);
    }

    return {
      payment: toPublicPayment(result.payment),
      replayed: result.kind === 'replayed',
    };
  }

  async getPayment(paymentId: string): Promise<PublicPayment> {
    const payment = await this.repository.findPaymentById(paymentId);

    if (payment === undefined) {
      throw new PaymentNotFoundError(paymentId);
    }

    return toPublicPayment(payment);
  }

  async updatePaymentStatus(
    command: UpdatePaymentStatusCommand,
  ): Promise<PublicPayment> {
    const parsedCommand = parseUpdatePaymentStatusCommand(command);
    const currentPayment = await this.repository.findPaymentById(
      parsedCommand.paymentId,
    );

    if (currentPayment === undefined) {
      throw new PaymentNotFoundError(parsedCommand.paymentId);
    }

    if (currentPayment.version !== parsedCommand.expectedVersion) {
      throw new PaymentVersionConflictError(
        currentPayment.id,
        parsedCommand.expectedVersion,
        currentPayment.version,
      );
    }

    assertPaymentTransitionAllowed({
      actor: 'operator',
      from: currentPayment.status,
      to: parsedCommand.status,
    });

    const timestamp = this.clock.now().toISOString();
    const updatedPayment: Payment = {
      id: currentPayment.id,
      amount: currentPayment.amount,
      currency: currentPayment.currency,
      ...(currentPayment.reference === undefined
        ? {}
        : { reference: currentPayment.reference }),
      status: parsedCommand.status,
      attemptCount: currentPayment.attemptCount,
      ...(currentPayment.processingStartedAt === undefined
        ? {}
        : { processingStartedAt: currentPayment.processingStartedAt }),
      ...(parsedCommand.status === 'failed'
        ? { failureCode: parsedCommand.failureCode }
        : {}),
      createdAt: currentPayment.createdAt,
      updatedAt: timestamp,
      version: currentPayment.version + 1,
    };
    const result = await this.repository.updatePayment(
      updatedPayment,
      parsedCommand.expectedVersion,
    );

    if (result.kind === 'not_found') {
      throw new PaymentNotFoundError(parsedCommand.paymentId);
    }

    if (result.kind === 'version_conflict') {
      throw new PaymentVersionConflictError(
        parsedCommand.paymentId,
        parsedCommand.expectedVersion,
        result.currentPayment.version,
      );
    }

    return toPublicPayment(result.payment);
  }
}
