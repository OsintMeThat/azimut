// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeTheme,
  loadTheme,
  saveTheme,
  applyTheme,
  DEFAULT_THEME,
} from './theme.js';

/** A localStorage stand-in that records what it was handed. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => (data[k] = v)),
    data,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('normalizeTheme', () => {
  it('keeps a known theme', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('falls back to the default for anything else', () => {
    expect(normalizeTheme('sepia')).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
  });
});

describe('loadTheme / saveTheme', () => {
  it('round-trips a stored theme', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveTheme('light');
    expect(loadTheme()).toBe('light');
  });

  it('defaults to dark when nothing was ever stored', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadTheme()).toBe('dark');
  });

  it('re-normalizes a garbage stored value instead of trusting it', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'azimut:theme': 'neon' }));
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it('never writes a garbage value', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    saveTheme('neon');
    expect(store.data['azimut:theme']).toBe(DEFAULT_THEME);
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
    expect(loadTheme()).toBe(DEFAULT_THEME);
    expect(() => saveTheme('light')).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('stamps the theme onto the document root', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('normalizes before stamping', () => {
    applyTheme('neon');
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });
});
