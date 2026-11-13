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
import type { ServiceLogger } from '../../shared/types/logger.types.js';

export class PaymentWorker {
  private activeAttemptController: AbortController | undefined;
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
    private readonly logger?: ServiceLogger,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.schedulePoll(0);
  }

  async stop(): Promise<boolean> {
    this.running = false;

    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    const activePoll = this.activePoll;
    if (activePoll === undefined) {
      return true;
    }

    let shutdownTimer: NodeJS.Timeout | undefined;
    const stoppedGracefully = await Promise.race([
      activePoll.then(() => true),
      new Promise<false>((resolve) => {
        shutdownTimer = setTimeout(
          () => resolve(false),
          this.options.shutdownTimeoutMs,
        );
      }),
    ]);

    if (shutdownTimer !== undefined) {
      clearTimeout(shutdownTimer);
    }

    if (!stoppedGracefully) {
      this.activeAttemptController?.abort();
    }

    return stoppedGracefully;
  }

  async processNextPayment(): Promise<boolean> {
    const claimedPayment = await this.repository.claimNextDuePayment(
      this.clock.now(),
    );

    if (claimedPayment === undefined) {
      return false;
    }

    this.logger?.info(
      {
        event: 'payment_attempt_started',
        paymentId: claimedPayment.id,
        attemptCount: claimedPayment.attemptCount,
        version: claimedPayment.version,
      },
      'Payment attempt started',
    );

    let result: PaymentGatewayResult;

    try {
      result = await this.processWithTimeout(claimedPayment);
    } catch (error) {
      this.logger?.warn(
        {
          event: 'payment_gateway_error',
          paymentId: claimedPayment.id,
          attemptCount: claimedPayment.attemptCount,
          failureCode:
            error instanceof GatewayAttemptTimeoutError
              ? 'processing_timeout'
              : 'processing_error',
        },
        'Payment gateway attempt failed',
      );
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
    this.activeAttemptController = abortController;
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

      if (this.activeAttemptController === abortController) {
        this.activeAttemptController = undefined;
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

    await this.persistOutcome(payment, retryPayment, 'payment_retry_scheduled');
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

    await this.persistOutcome(payment, completedPayment, 'payment_completed');
  }

  private async persistOutcome(
    claimed: Payment,
    next: Payment,
    event: string,
  ): Promise<void> {
    const fields = {
      paymentId: claimed.id,
      attemptCount: claimed.attemptCount,
      version: claimed.version,
      durationMs: Math.max(
        0,
        this.clock.now().getTime() -
          Date.parse(claimed.processingStartedAt ?? claimed.updatedAt),
      ),
    };

    try {
      const result = await this.repository.updatePayment(next, claimed.version);
      if (result.kind !== 'updated') {
        this.logger?.warn(
          {
            ...fields,
            event: 'payment_worker_result_discarded',
            reason: result.kind,
          },
          'Stale worker result discarded',
        );
        return;
      }

      this.logger?.info(
        {
          ...fields,
          event,
          status: next.status,
          version: next.version,
          nextAttemptAt: next.nextAttemptAt,
          failureCode: next.failureCode,
        },
        'Payment attempt outcome persisted',
      );
    } catch (error) {
      this.logger?.error(
        { ...fields, event: 'payment_persistence_failed', err: error },
        'Payment outcome persistence failed',
      );
      throw error;
    }
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
