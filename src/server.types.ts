import type { ServiceLogger } from './shared/types/logger.types.js';

export interface CloseableHttpServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  closeIdleConnections?(): void;
}

export interface ServerDependencies {
  readonly port: number;
  readonly shutdownTimeoutMs: number;
  readonly logger: ServiceLogger & { flush(): void };
  readonly initializeStorage: () => Promise<void>;
  readonly recoverWork: () => Promise<void>;
  readonly worker: {
    start(): void;
    stop(): Promise<boolean>;
  };
  readonly listen: () => Promise<CloseableHttpServer>;
}
