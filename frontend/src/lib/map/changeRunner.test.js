import { describe, expect, it } from 'vitest';
import { runChangeDetection } from './changeRunner.js';

describe('running a change detection', () => {
  it('answers on the main thread when the environment has no worker', async () => {
    const a = new Uint8ClampedArray([10, 10, 10, 255]);
    const b = new Uint8ClampedArray([10, 10, 10, 255]);
    const result = await runChangeDetection({ a, b, width: 1, height: 1, settings: {} });
    expect(result.counts.quiet).toBe(1);
  });

  it('rejects rather than throwing', async () => {
    await expect(
      runChangeDetection({ a: new Uint8ClampedArray(4), b: new Uint8ClampedArray(8), width: 1, height: 1 })
    ).rejects.toThrow('same pixel geometry');
  });
});
