import type { CloseableHttpServer } from './server-lifecycle.types.js';

export async function closeHttpServer(
  server: CloseableHttpServer,
  timeoutMs: number,
): Promise<boolean> {
  server.closeIdleConnections?.();

  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const settle = (result: boolean, error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (error === undefined) {
        resolve(result);
      } else {
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      settle(false);
    }, timeoutMs);

    server.close((error) => {
      settle(true, error);
    });
  });
}
