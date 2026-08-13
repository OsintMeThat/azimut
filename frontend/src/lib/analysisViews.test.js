import { describe, expect, it } from 'vitest';
import { copyName } from './analysisViews.js';

describe('analysis view names', () => {
  it('finds an unused duplicate name without a failing save first', () => {
    expect(copyName('Ports', ['Ports', 'Ports copy', 'Ports copy 2'])).toBe('Ports copy 3');
  });
});
