import { execFile, type ExecFileException } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('startup error logging', () => {
  it('logs configuration failures before repository or HTTP startup', async () => {
    const result = await new Promise<{
      error: ExecFileException | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('../../src/main.ts', import.meta.url)),
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'development',
            PORT: 'invalid-port',
            API_KEY: 'startup-api-secret',
          },
          timeout: 4000,
        },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      );
    });
    expect(result.error?.code).toBe(1);
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({
      event: 'service_startup_failed',
      level: 60,
      err: { type: 'ConfigurationError' },
    });
    expect(result.stdout).toContain('PORT');
    expect(result.stdout).not.toContain('startup-api-secret');
    expect(result.stderr).toBe('');
  });
});
