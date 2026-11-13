import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '../types/id-generator.types.js';

export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
