import { ZodError } from 'zod';

import { ConfigurationError } from '../shared/errors/configuration.errors.js';
import type { AppConfig } from '../shared/types/config.types.js';
import { parseEnvironment } from './config.schema.js';

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  try {
    return parseEnvironment(environment);
  } catch (error) {
    if (!(error instanceof ZodError)) {
      throw error;
    }

    const details = error.issues
      .map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      )
      .join('; ');

    throw new ConfigurationError(`Invalid configuration: ${details}`);
  }
}
