import { once } from 'node:events';

import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { SimulatedPaymentGateway } from './infrastructure/gateway/simulated-payment.gateway.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { PaymentService } from './modules/payments/payment.service.js';
import { PaymentWorker } from './modules/payments/payment.worker.js';
import { JsonPaymentRepository } from './modules/payments/repositories/json-payment.repository.js';
import { PaymentServer } from './server.js';
import { ConfigurationError } from './shared/errors/configuration.errors.js';
import { SystemClock } from './shared/helpers/clock.js';
import { UuidGenerator } from './shared/helpers/id-generator.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const clock = new SystemClock();
  const repository = new JsonPaymentRepository({
    filePath: config.dataFilePath,
    logger,
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
    logger,
  );
  const app = createApp({
    config,
    logger,
    paymentService,
    isReady: () => server.isReady(),
  });
  const server = new PaymentServer({
    port: config.port,
    shutdownTimeoutMs: config.worker.shutdownTimeoutMs,
    logger,
    initializeStorage: () => repository.initialize(),
    recoverWork: async () => {
      const recoveredPayments = await repository.recoverExpiredPayments(
        clock.now(),
        config.worker.leaseMs,
        config.worker.maxAttempts,
      );
      logger.info(
        { event: 'payment_leases_recovered', recoveredPayments },
        'Expired payment leases recovered',
      );
    },
    worker,
    listen: async () => {
      const listener = app.listen(config.port);
      await once(listener, 'listening');
      return listener;
    },
  });
  await server.start();
  server.registerSignalHandlers();
}

void main().catch((error: unknown) => {
  process.exitCode = 1;
  createLogger('info').fatal(
    {
      event: 'service_startup_failed',
      err: error,
      ...(error instanceof ConfigurationError
        ? { configurationIssues: error.message }
        : {}),
    },
    'Payment service failed to start',
  );
});
