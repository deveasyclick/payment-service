import pino, { type DestinationStream, type Logger } from 'pino';

import type { LogLevel } from '../../shared/types/config.types.js';
import { LOG_REDACTION_PATHS } from './logging.const.js';

export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: 'UnknownError' };
  }

  // Messages, causes, and custom properties may contain credentials or provider payloads.
  return {
    type: error.name,
    stack: error.stack
      ?.split('\n')
      .filter((line) => line.trimStart().startsWith('at '))
      .join('\n'),
  };
}

export function createLogger(
  level: LogLevel,
  destination?: DestinationStream,
): Logger {
  const options = {
    level,
    redact: { paths: [...LOG_REDACTION_PATHS], censor: '[REDACTED]' },
    serializers: { err: serializeError },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
