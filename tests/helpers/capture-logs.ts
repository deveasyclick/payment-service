import { createLogger } from '../../src/infrastructure/logging/logger.js';

export function captureLogs() {
  const lines: string[] = [];
  const logger = createLogger('debug', {
    write: (line) => {
      lines.push(line);
    },
  });
  return {
    logger,
    text: () => lines.join(''),
    entries: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
