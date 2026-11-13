import type {
  PaymentGateway,
  PaymentGatewayResult,
} from './payment-gateway.types.js';
import type { PaymentRepository } from './payment-repository.types.js';
import { GatewayAttemptTimeoutError } from './payment-worker.errors.js';
import type { PaymentWorkerOptions } from './payment-worker.types.js';
import { assertPaymentTransitionAllowed } from './payment.state-machine.js';
import type { Payment, PaymentFailureCode } from './payment.types.js';
import type { Clock } from '../../shared/types/clock.types.js';

export class PaymentWorker {
  private activePoll: Promise<void> | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    private readonly options: PaymentWorkerOptions,
    private readonly random: () => number = Math.random,
    private readonly reportError: (error: unknown) => void = () => undefined,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.schedulePoll(0);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    await this.activePoll;
  }

  async processNextPayment(): Promise<boolean> {
    const claimedPayment = await this.repository.claimNextDuePayment(
      this.clock.now(),
    );

    if (claimedPayment === undefined) {
      return false;
    }

    let result: PaymentGatewayResult;

    try {
      result = await this.processWithTimeout(claimedPayment);
    } catch (error) {
      await this.retryOrFail(
        claimedPayment,
        error instanceof GatewayAttemptTimeoutError
          ? 'processing_timeout'
          : 'attempts_exhausted',
      );
      return true;
    }

    if (result.kind === 'succeeded') {
      await this.completePayment(claimedPayment, 'succeeded');
    } else if (result.retryable) {
      await this.retryOrFail(claimedPayment, result.failureCode);
    } else {
      await this.completePayment(claimedPayment, 'failed', result.failureCode);
    }

    return true;
  }

  private async processWithTimeout(
    payment: Payment,
  ): Promise<PaymentGatewayResult> {
    const abortController = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortController.abort();
        reject(new GatewayAttemptTimeoutError(this.options.attemptTimeoutMs));
      }, this.options.attemptTimeoutMs);
      timeout.unref();
    });

    try {
      return await Promise.race([
        this.gateway.processPayment(payment, {
          idempotencyKey: payment.id,
          signal: abortController.signal,
        }),
        timeoutResult,
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async retryOrFail(
    payment: Payment,
    terminalFailureCode: PaymentFailureCode,
  ): Promise<void> {
    if (payment.attemptCount >= this.options.maxAttempts) {
      await this.completePayment(payment, 'failed', terminalFailureCode);
      return;
    }

    assertPaymentTransitionAllowed({
      actor: 'worker',
      from: payment.status,
      to: 'pending',
    });
    const timestamp = this.clock.now();
    const retryPayment: Payment = {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      ...(payment.reference === undefined
        ? {}
        : { reference: payment.reference }),
      status: 'pending',
      attemptCount: payment.attemptCount,
      nextAttemptAt: new Date(
        timestamp.getTime() + this.retryDelayMs(payment.attemptCount),
      ).toISOString(),
      createdAt: payment.createdAt,
      updatedAt: timestamp.toISOString(),
      version: payment.version + 1,
    };

    await this.repository.updatePayment(retryPayment, payment.version);
  }

  private async completePayment(
    payment: Payment,
    status: 'succeeded' | 'failed',
    failureCode?: PaymentFailureCode,
  ): Promise<void> {
    assertPaymentTransitionAllowed({
      actor: 'worker',
      from: payment.status,
      to: status,
    });
    const timestamp = this.clock.now().toISOString();
    const completedPayment: Payment = {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      ...(payment.reference === undefined
        ? {}
        : { reference: payment.reference }),
      status,
      attemptCount: payment.attemptCount,
      ...(payment.processingStartedAt === undefined
        ? {}
        : { processingStartedAt: payment.processingStartedAt }),
      ...(status === 'failed' && failureCode !== undefined
        ? { failureCode }
        : {}),
      createdAt: payment.createdAt,
      updatedAt: timestamp,
      version: payment.version + 1,
    };

    await this.repository.updatePayment(completedPayment, payment.version);
  }

  private retryDelayMs(attemptCount: number): number {
    const exponentialDelay =
      this.options.retryBaseDelayMs * 2 ** Math.max(0, attemptCount - 1);
    const maximumJitter = Math.floor(exponentialDelay * 0.2);
    const jitter = Math.floor(this.random() * (maximumJitter + 1));
    return exponentialDelay + jitter;
  }

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      const poll = this.runPoll();
      this.activePoll = poll;
      void poll.finally(() => {
        if (this.activePoll === poll) {
          this.activePoll = undefined;
        }

        if (this.running) {
          this.schedulePoll(this.options.pollIntervalMs);
        }
      });
    }, delayMs);
    this.pollTimer.unref();
  }

  private async runPoll(): Promise<void> {
    try {
      await this.processNextPayment();
    } catch (error) {
      this.reportError(error);
    }
  }
}
