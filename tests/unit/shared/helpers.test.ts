import { describe, expect, it } from 'vitest';

import { SystemClock } from '../../../src/shared/helpers/clock.js';
import { UuidGenerator } from '../../../src/shared/helpers/id-generator.js';

describe('shared helpers', () => {
  it('provides the current time through an injectable clock', () => {
    const before = Date.now();
    const current = new SystemClock().now().getTime();
    const after = Date.now();

    expect(current).toBeGreaterThanOrEqual(before);
    expect(current).toBeLessThanOrEqual(after);
  });

  it('generates UUID identifiers', () => {
    expect(new UuidGenerator().generate()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});
