// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { drawnOnce, keptCount } from './drawnOnce.js';

describe('a picture the page draws once', () => {
  it('is drawn again only when what it is drawn from changes, a few kept at a time, the replaced let go', () => {
    const make = vi.fn(() => true);
    const first = drawnOnce('globe:a', 'k1', 40, 30, make);
    expect(first.width).toBe(40);
    expect(drawnOnce('globe:a', 'k1', 40, 30, make)).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);
    const second = drawnOnce('globe:a', 'k2', 40, 30, make);
    expect(second).not.toBe(first);
    expect(first.width).toBe(0);
    for (let index = 0; index < 10; index += 1) drawnOnce(`spot:${index}`, 'k', 10, 10, make);
    expect(keptCount()).toBe(6);
    // too large to keep: drawn, handed over, not held
    const large = drawnOnce('spot:large', 'k', 4000, 2000, make);
    expect(large.width).toBe(4000);
    expect(drawnOnce('spot:large', 'k', 4000, 2000, make)).not.toBe(large);
    // nothing drawn, nothing handed over
    expect(drawnOnce('spot:none', 'k', 10, 10, () => false)).toBeNull();
  });
});
