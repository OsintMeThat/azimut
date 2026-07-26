import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollWhile } from './poll.js';

describe('pollWhile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps ticking while the condition holds (the poll a one-shot timer misses)', () => {
    let ticks = 0;
    pollWhile(() => true, () => (ticks += 1), 1500);
    vi.advanceTimersByTime(1500 * 3);
    expect(ticks).toBe(3); // repeats — not stuck at 1
  });

  it('stops on its own once the condition clears', () => {
    let pending = true;
    let ticks = 0;
    pollWhile(() => pending, () => (ticks += 1), 1000);
    vi.advanceTimersByTime(1000); // tick 1 (pending)
    pending = false;
    vi.advanceTimersByTime(1000 * 5); // sees !pending, clears itself
    expect(ticks).toBe(1);
  });

  it('never starts when the condition is already false, and stop is safe', () => {
    let ticks = 0;
    const stop = pollWhile(() => false, () => (ticks += 1), 1000);
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});
