import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeHttpServer } from '../../src/server-lifecycle.js';
import type { CloseableHttpServer } from '../../src/server-lifecycle.types.js';

describe('closeHttpServer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes idle connections and reports a graceful close', async () => {
    const closeIdleConnections = vi.fn();
    const server: CloseableHttpServer = {
      close: (callback) => {
        callback();
      },
      closeIdleConnections,
    };

    await expect(closeHttpServer(server, 1_000)).resolves.toBe(true);
    expect(closeIdleConnections).toHaveBeenCalledOnce();
  });

  it('force-closes connections after the deadline', async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const server: CloseableHttpServer = {
      close: () => undefined,
      closeAllConnections,
    };

    const closing = closeHttpServer(server, 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(closing).resolves.toBe(false);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });
});
