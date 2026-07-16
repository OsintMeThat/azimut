import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clampWidth,
  maxWidth,
  loadWidth,
  saveWidth,
  MIN_W,
  MAX_W,
  DEFAULT_W,
} from './sidebar.js';

/** A localStorage stand-in — the test env has no DOM. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => (data[k] = v)),
    data,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('maxWidth', () => {
  it('caps at half the viewport on narrow windows, at MAX_W on wide ones', () => {
    expect(maxWidth(900)).toBe(450);
    expect(maxWidth(2560)).toBe(MAX_W); // half would be 1280 — the hard cap wins
  });

  it('never drops below the minimum, however small the window', () => {
    expect(maxWidth(320)).toBe(MIN_W); // half (160) would be unusable
  });
});

describe('clampWidth', () => {
  it('leaves a width inside the range alone', () => {
    expect(clampWidth(420, 1600)).toBe(420);
  });

  it('clamps both ends', () => {
    expect(clampWidth(40, 1600)).toBe(MIN_W);
    expect(clampWidth(5000, 1600)).toBe(MAX_W);
  });

  it('clamps against the viewport, so a big-screen width cannot eat a small one', () => {
    expect(clampWidth(600, 1000)).toBe(500);
  });

  it('applies only the hard cap when no viewport is given', () => {
    expect(clampWidth(5000)).toBe(MAX_W);
  });

  it('rounds to whole pixels', () => {
    expect(clampWidth(320.6, 1600)).toBe(321);
  });

  it('falls back to the default for garbage', () => {
    expect(clampWidth(NaN)).toBe(DEFAULT_W);
    expect(clampWidth(Infinity)).toBe(DEFAULT_W);
  });
});

describe('loadWidth / saveWidth', () => {
  it('round-trips a stored width', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    saveWidth(480);
    expect(loadWidth()).toBe(480);
  });

  it('returns the default when nothing was ever stored', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadWidth()).toBe(DEFAULT_W);
  });

  it('re-clamps a stored width instead of trusting it', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'azimut:sidebarW': '9000' }));
    expect(loadWidth()).toBe(MAX_W);
  });

  it('survives a hostile or absent localStorage (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadWidth()).toBe(DEFAULT_W);
    expect(() => saveWidth(400)).not.toThrow();
  });
});
