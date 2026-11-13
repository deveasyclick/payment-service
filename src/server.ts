import type {
  CloseableHttpServer,
  ServerDependencies,
} from './server.types.js';

export class PaymentServer {
  private httpServer: CloseableHttpServer | undefined;
  private ready = false;
  private startup: Promise<void> | undefined;
  private shutdown: Promise<void> | undefined;

  constructor(private readonly dependencies: ServerDependencies) {}

  isReady(): boolean {
    return this.ready;
  }

  start(): Promise<void> {
    this.startup ??= this.startService();
    return this.startup;
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    this.shutdown ??= this.stopService(signal);
    return this.shutdown;
  }

  registerSignalHandlers(): void {
    process.once('SIGTERM', this.handleSignal);
    process.once('SIGINT', this.handleSignal);
  }

  private readonly handleSignal = (signal: NodeJS.Signals): void => {
    void this.stop(signal).catch((error: unknown) => {
      process.exitCode = 1;
      this.dependencies.logger.error(
        { event: 'service_shutdown_failed', err: error, signal },
        'Payment service shutdown failed',
      );
    });
  };

  private async startService(): Promise<void> {
    await this.dependencies.initializeStorage();
    await this.dependencies.recoverWork();
    this.dependencies.worker.start();

    try {
      this.httpServer = await this.dependencies.listen();
    } catch (error) {
      try {
        await this.dependencies.worker.stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Service startup and worker cleanup failed',
        );
      }
      throw error;
    }

    this.ready = true;
    this.dependencies.logger.info(
      { event: 'service_started', port: this.dependencies.port },
      'Payment service started',
    );
  }

  private async stopService(signal: NodeJS.Signals): Promise<void> {
    this.ready = false;
    process.removeListener('SIGTERM', this.handleSignal);
    process.removeListener('SIGINT', this.handleSignal);
    const logger = this.dependencies.logger;
    logger.info(
      { event: 'service_stopping', signal },
      'Payment service stopping',
    );

    const [httpResult, workerResult] = await Promise.allSettled([
      this.httpServer === undefined
        ? Promise.resolve(true)
        : this.closeHttpServer(this.httpServer),
      this.dependencies.worker.stop(),
    ]);

    if (httpResult.status === 'rejected') {
      process.exitCode = 1;
      logger.error(
        { event: 'http_shutdown_failed', err: httpResult.reason },
        'HTTP server shutdown failed',
      );
    } else if (!httpResult.value) {
      logger.warn(
        { event: 'http_shutdown_timeout' },
        'HTTP connections exceeded the shutdown deadline',
      );
    }

    if (workerResult.status === 'rejected') {
      process.exitCode = 1;
      logger.error(
        { event: 'worker_shutdown_failed', err: workerResult.reason },
        'Worker shutdown failed',
      );
    } else if (!workerResult.value) {
      logger.warn(
        { event: 'worker_shutdown_timeout' },
        'Active payment work exceeded the shutdown deadline',
      );
    }

    logger.info({ event: 'service_stopped' }, 'Payment service stopped');
    logger.flush();
  }

  private async closeHttpServer(server: CloseableHttpServer): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const settle = (result: boolean, error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error === undefined) resolve(result);
        else
          reject(
            error instanceof Error
              ? error
              : new Error('HTTP server shutdown failed', { cause: error }),
          );
      };
      const timeout = setTimeout(() => {
        settle(false);
        server.closeAllConnections?.();
      }, this.dependencies.shutdownTimeoutMs);
      try {
        server.close((error) => {
          settle(true, error);
        });
        server.closeIdleConnections?.();
      } catch (error) {
        settle(false, error);
      }
    });
  }
}
