import { once } from 'node:events';
import type { Server } from 'node:http';

import { createLogger } from './infrastructure/logging/logger.js';

import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { SimulatedPaymentGateway } from './infrastructure/gateway/simulated-payment.gateway.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { PaymentWorker } from './modules/payments/payment.worker.js';
import { JsonPaymentRepository } from './modules/payments/repositories/json-payment.repository.js';
import { closeHttpServer } from './server-lifecycle.js';
import { SystemClock } from './shared/helpers/clock.js';
import { UuidGenerator } from './shared/helpers/id-generator.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const clock = new SystemClock();
const repository = new JsonPaymentRepository({
  filePath: config.dataFilePath,
});
const paymentService = new PaymentService(
  repository,
  clock,
  new UuidGenerator(),
);
const gateway = new SimulatedPaymentGateway(
  config.simulatedGateway.latencyMs,
  config.simulatedGateway.outcome,
);
const worker = new PaymentWorker(
  repository,
  gateway,
  clock,
  config.worker,
  Math.random,
  (error) => {
    logger.error(
      { event: 'payment_worker_poll_failed', err: error },
      'Payment worker poll failed',
    );
  },
  logger,
);

let ready = false;
const app = createApp({
  config,
  logger,
  paymentService,
  isReady: () => ready,
  reportUnexpectedError: (error, requestId) => {
    logger.error(
      { event: 'http_unexpected_error', err: error, requestId },
      'HTTP request failed',
    );
  },
});

async function start(): Promise<void> {
  await repository.initialize();
  const recoveredPayments = await repository.recoverExpiredPayments(
    clock.now(),
    config.worker.leaseMs,
  );
  logger.info(
    { event: 'payment_leases_recovered', recoveredPayments },
    'Expired payment leases recovered',
  );

  worker.start();
  const server = app.listen(config.port);

  try {
    await once(server, 'listening');
  } catch (error) {
    await worker.stop();
    throw error;
  }

  ready = true;
  logger.info(
    { event: 'service_started', port: config.port, recoveredPayments },
    'Payment service started',
  );
  installShutdownHandlers(server);
}

function installShutdownHandlers(server: Server): void {
  let shutdown: Promise<void> | undefined;

  const handleSignal = (signal: NodeJS.Signals): void => {
    shutdown ??= stop(server, signal);
  };

  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);
}

async function stop(server: Server, signal: NodeJS.Signals): Promise<void> {
  ready = false;
  logger.info(
    { event: 'service_stopping', signal },
    'Payment service stopping',
  );

  const [httpResult, workerResult] = await Promise.allSettled([
    closeHttpServer(server, config.worker.shutdownTimeoutMs),
    worker.stop(),
  ]);

  if (httpResult.status === 'rejected') {
    process.exitCode = 1;
    logger.error({ err: httpResult.reason }, 'HTTP server shutdown failed');
  } else if (!httpResult.value) {
    logger.warn('HTTP connections exceeded the shutdown deadline');
  }

  if (workerResult.status === 'rejected') {
    process.exitCode = 1;
    logger.error({ err: workerResult.reason }, 'Worker shutdown failed');
  } else if (!workerResult.value) {
    logger.warn('Active payment work exceeded the shutdown deadline');
  }

  logger.info({ event: 'service_stopped' }, 'Payment service stopped');
  logger.flush();
}

void start().catch((error: unknown) => {
  process.exitCode = 1;
  logger.fatal(
    { event: 'service_startup_failed', err: error },
    'Payment service failed to start',
  );
});
