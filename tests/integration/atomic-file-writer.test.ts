import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { rename, remove, openFile } = vi.hoisted(() => ({
  rename: vi.fn(),
  remove: vi.fn(),
  openFile: vi.fn(),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename,
    rm: remove.mockImplementation(original.rm),
    open: openFile.mockImplementation(original.open),
  };
});

import { writeFileAtomically } from '../../src/infrastructure/storage/atomic-file-writer.js';
import { captureLogs } from '../helpers/capture-logs.js';

describe('atomic file failure', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  });

  it('preserves the old snapshot and removes the temporary file when rename fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'atomic-file-failure-'));
    const path = join(directory, 'payments.json');
    await writeFile(path, '{"snapshot":"original"}\n');
    rename.mockRejectedValueOnce(new Error('simulated rename failure'));
    await expect(
      writeFileAtomically(path, '{"snapshot":"next"}\n'),
    ).rejects.toThrow('simulated rename failure');
    expect(await readFile(path, 'utf8')).toBe('{"snapshot":"original"}\n');
    expect(await readdir(directory)).toEqual(['payments.json']);
  });

  it('logs cleanup failures while retaining the original write failure', async () => {
    directory = await mkdtemp(join(tmpdir(), 'atomic-cleanup-failure-'));
    const logs = captureLogs();
    const original = new Error('rename-secret');
    rename.mockRejectedValueOnce(original);
    remove.mockRejectedValueOnce(new Error('cleanup-secret'));
    await expect(
      writeFileAtomically(join(directory, 'payments.json'), '{}', logs.logger),
    ).rejects.toBe(original);
    expect(logs.entries()[0]).toMatchObject({
      event: 'storage_cleanup_failed',
      level: 50,
      err: { type: 'Error' },
    });
    expect(logs.text()).not.toContain('-secret');
  });

  it('logs a close failure without replacing the original write failure', async () => {
    directory = await mkdtemp(join(tmpdir(), 'atomic-close-failure-'));
    const logs = captureLogs();
    const original = new Error('write-secret');
    openFile.mockResolvedValueOnce({
      writeFile: () => Promise.reject(original),
      close: () => Promise.reject(new Error('close-secret')),
    });
    await expect(
      writeFileAtomically(join(directory, 'payments.json'), '{}', logs.logger),
    ).rejects.toBe(original);
    expect(logs.entries()[0]).toMatchObject({
      event: 'storage_file_close_failed',
      level: 50,
      err: { type: 'Error' },
    });
    expect(logs.text()).not.toContain('-secret');
  });
});
