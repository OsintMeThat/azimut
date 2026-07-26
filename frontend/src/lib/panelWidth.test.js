import { describe, it, expect, vi, afterEach } from 'vitest';
import { panelWidth } from './panelWidth.js';

/** A localStorage stand-in — the test env has no DOM. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => (data[k] = v)),
    data,
  };
}

const panel = panelWidth({ key: 'azimut:testW', min: 100, max: 400, def: 200, fraction: 0.25 });

afterEach(() => vi.unstubAllGlobals());

describe('panelWidth', () => {
  it('caps at the configured fraction of the viewport, then at the hard max', () => {
    expect(panel.maxWidth(1200)).toBe(300); // a quarter of the window
    expect(panel.maxWidth(4000)).toBe(400); // a quarter would be 1000 — the cap wins
  });

  it('never drops below the minimum, however small the window', () => {
    expect(panel.maxWidth(200)).toBe(100);
  });

  it('clamps both ends and rounds to whole pixels', () => {
    expect(panel.clampWidth(40, 1600)).toBe(100);
    expect(panel.clampWidth(5000, 1600)).toBe(400);
    expect(panel.clampWidth(220.6, 1600)).toBe(221);
  });

  it('falls back to the default for garbage', () => {
    expect(panel.clampWidth(NaN)).toBe(200);
    expect(panel.clampWidth(Infinity)).toBe(200);
  });

  it('round-trips a stored width under its own key', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    panel.saveWidth(320);
    expect(store.data['azimut:testW']).toBe('320');
    expect(panel.loadWidth()).toBe(320);
  });

  it('returns the default when nothing was ever stored', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(panel.loadWidth()).toBe(200);
  });

  it('re-clamps a stored width instead of trusting it', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'azimut:testW': '9000' }));
    expect(panel.loadWidth()).toBe(400);
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
    expect(panel.loadWidth()).toBe(200);
    expect(() => panel.saveWidth(300)).not.toThrow();
  });

  it('keeps two panels independent', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const other = panelWidth({ key: 'azimut:otherW', min: 100, max: 400, def: 150 });
    panel.saveWidth(300);
    expect(other.loadWidth()).toBe(150);
  });
});
