import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentServer } from '../../src/server.js';
import type {
  CloseableHttpServer,
  ServerDependencies,
} from '../../src/server.types.js';
import { captureLogs } from '../helpers/capture-logs.js';

function setup(overrides: Partial<ServerDependencies> = {}) {
  const logs = captureLogs();
  const httpServer: CloseableHttpServer = {
    close: (callback) => {
      callback();
    },
  };
  const dependencies: ServerDependencies = {
    port: 3000,
    shutdownTimeoutMs: 100,
    logger: logs.logger,
    initializeStorage: () => Promise.resolve(),
    recoverWork: () => Promise.resolve(),
    worker: { start: vi.fn(), stop: vi.fn(() => Promise.resolve(true)) },
    listen: () => Promise.resolve(httpServer),
    ...overrides,
  };
  return { server: new PaymentServer(dependencies), dependencies, logs };
}

const originalExitCode = process.exitCode;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

describe('PaymentServer startup', () => {
  it('initializes and recovers storage before the worker/listener, then becomes ready', async () => {
    const events: string[] = [];
    const initializing = Promise.withResolvers<void>();
    const listening = Promise.withResolvers<CloseableHttpServer>();
    const { server } = setup({
      initializeStorage: async () => {
        events.push('initialize');
        await initializing.promise;
      },
      recoverWork: () => {
        events.push('recover');
        return Promise.resolve();
      },
      worker: {
        start: () => {
          events.push('worker');
        },
        stop: () => Promise.resolve(true),
      },
      listen: () => {
        events.push('listen');
        return listening.promise;
      },
    });
    expect(server.isReady()).toBe(false);
    const started = server.start();
    expect(events).toEqual(['initialize']);
    initializing.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(server.isReady()).toBe(false);
    listening.resolve({
      close: (callback) => {
        callback();
      },
    });
    await started;
    expect(events).toEqual(['initialize', 'recover', 'worker', 'listen']);
    expect(server.isReady()).toBe(true);
    expect(server.start()).toBe(started);
    await server.stop();
  });

  it.each(['initialize', 'recover'])(
    'does not start the worker/listener after a %s failure',
    async (stage) => {
      const listen = vi.fn();
      const worker = {
        start: vi.fn(),
        stop: vi.fn(() => Promise.resolve(true)),
      };
      const { server } = setup({
        initializeStorage: () =>
          stage === 'initialize'
            ? Promise.reject(new Error('storage unavailable'))
            : Promise.resolve(),
        recoverWork: () =>
          stage === 'recover'
            ? Promise.reject(new Error('storage unavailable'))
            : Promise.resolve(),
        worker,
        listen,
      });
      await expect(server.start()).rejects.toThrow('storage unavailable');
      expect(server.isReady()).toBe(false);
      expect(worker.start).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
    },
  );

  it('stops the worker if HTTP listening fails', async () => {
    const worker = { start: vi.fn(), stop: vi.fn(() => Promise.resolve(true)) };
    const { server } = setup({
      worker,
      listen: () => Promise.reject(new Error('port unavailable')),
    });
    await expect(server.start()).rejects.toThrow('port unavailable');
    expect(worker.start).toHaveBeenCalledOnce();
    expect(worker.stop).toHaveBeenCalledOnce();
    expect(server.isReady()).toBe(false);
  });

  it('retains both listener and worker cleanup failures for startup logging', async () => {
    const startupError = new Error('listener failed');
    const cleanupError = new Error('worker stop failed');
    const { server } = setup({
      worker: { start: vi.fn(), stop: () => Promise.reject(cleanupError) },
      listen: () => Promise.reject(startupError),
    });
    await expect(server.start()).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [startupError, cleanupError],
    });
  });
});

describe('PaymentServer shutdown', () => {
  it('becomes unready immediately and closes HTTP and worker resources once', async () => {
    const closeIdleConnections = vi.fn();
    const close = vi.fn((callback: (error?: Error) => void) => {
      callback();
    });
    const { server, dependencies, logs } = setup({
      listen: () => Promise.resolve({ close, closeIdleConnections }),
    });
    const stopWorker = vi.spyOn(dependencies.worker, 'stop');
    await server.start();
    const stopping = server.stop();
    expect(server.isReady()).toBe(false);
    expect(server.stop('SIGINT')).toBe(stopping);
    await stopping;
    expect(close).toHaveBeenCalledOnce();
    expect(closeIdleConnections).toHaveBeenCalledOnce();
    expect(stopWorker).toHaveBeenCalledOnce();
    expect(logs.entries().at(-1)).toMatchObject({ event: 'service_stopped' });
  });

  it('force-closes connections at the deadline and records the timeout', async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const { server, logs } = setup({
      listen: () =>
        Promise.resolve({ close: () => undefined, closeAllConnections }),
    });
    await server.start();
    const stopping = server.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'http_shutdown_timeout', level: 40 }),
      ]),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a timeout when forced closure synchronously finishes the server', async () => {
    vi.useFakeTimers();
    let onClose: (() => void) | undefined;
    const { server, logs } = setup({
      listen: () =>
        Promise.resolve({
          close: (callback) => {
            onClose = callback;
          },
          closeAllConnections: () => onClose?.(),
        }),
    });
    await server.start();
    const stopping = server.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'http_shutdown_timeout' }),
      ]),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs synchronous HTTP shutdown failures and clears the deadline', async () => {
    vi.useFakeTimers();
    const { server, logs } = setup({
      listen: () =>
        Promise.resolve({
          close: () => {
            throw new Error('close-secret');
          },
        }),
    });
    await server.start();
    await server.stop();
    expect(process.exitCode).toBe(1);
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'http_shutdown_failed', level: 50 }),
      ]),
    );
    expect(logs.text()).not.toContain('close-secret');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs worker failures while still finishing HTTP shutdown', async () => {
    const { server, logs } = setup({
      worker: {
        start: vi.fn(),
        stop: () => Promise.reject(new Error('worker-secret')),
      },
    });
    await server.start();
    await server.stop();
    expect(process.exitCode).toBe(1);
    expect(logs.entries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'worker_shutdown_failed', level: 50 }),
      ]),
    );
    expect(logs.text()).not.toContain('worker-secret');
  });

  it('handles both termination signals through the same shutdown promise', async () => {
    const handlers = new Map<string, (signal: NodeJS.Signals) => void>();
    vi.spyOn(process, 'once').mockImplementation((event, handler) => {
      handlers.set(String(event), handler as (signal: NodeJS.Signals) => void);
      return process;
    });
    const { server, dependencies } = setup();
    const stopWorker = vi.spyOn(dependencies.worker, 'stop');
    await server.start();
    server.registerSignalHandlers();
    handlers.get('SIGTERM')?.('SIGTERM');
    handlers.get('SIGINT')?.('SIGINT');
    await server.stop();
    expect(stopWorker).toHaveBeenCalledOnce();
    expect(server.isReady()).toBe(false);
  });
});
