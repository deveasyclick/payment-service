import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createLogger } from '../logging/logger.js';
import type { ServiceLogger } from '../../shared/types/logger.types.js';

export async function writeFileAtomically(
  filePath: string,
  contents: string,
  logger?: ServiceLogger,
): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    const handle = await open(temporaryPath, 'wx', 0o600);

    try {
      await handle.writeFile(contents, { encoding: 'utf8' });
      await handle.sync();
    } catch (error) {
      try {
        await handle.close();
      } catch (closeError) {
        (logger ?? createLogger('info')).error(
          { event: 'storage_file_close_failed', err: closeError, filePath },
          'Failed to close temporary storage file after a write failure',
        );
      }
      throw error;
    }
    await handle.close();

    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      (logger ?? createLogger('info')).error(
        {
          event: 'storage_cleanup_failed',
          err: cleanupError,
          filePath,
          temporaryPath,
        },
        'Failed to remove temporary storage file',
      );
    }
    throw error;
  }
}
