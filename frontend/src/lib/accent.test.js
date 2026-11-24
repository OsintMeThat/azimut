// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as FileURL, fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENTS,
  ACCENT_KEY,
  DEFAULT_ACCENT,
  applyAccent,
  loadAccent,
  normalizeAccent,
  saveAccent,
} from './accent.js';

// node's URL: happy-dom's own is not one readFileSync takes
const read = (rel) => readFileSync(fileURLToPath(new FileURL(rel, import.meta.url)), 'utf8');
const css = read('../app.css');
const html = read('../../index.html');

/** A localStorage stand-in that keeps what it was handed. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    setItem: vi.fn((k, v) => (data[k] = v)),
    data,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.accent;
});

describe('normalizeAccent', () => {
  it('keeps a known accent and falls back to amber for anything else', () => {
    expect(normalizeAccent('teal')).toBe('teal');
    expect(normalizeAccent('neon')).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent(null)).toBe(DEFAULT_ACCENT);
    expect(DEFAULT_ACCENT).toBe('amber');
  });
});

describe('loadAccent / saveAccent', () => {
  it('round-trips a stored accent', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveAccent('rose');
    expect(loadAccent()).toBe('rose');
  });

  it('reads amber when nothing, or garbage, was stored', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadAccent()).toBe('amber');
    vi.stubGlobal('localStorage', fakeStorage({ [ACCENT_KEY]: '</style>' }));
    expect(loadAccent()).toBe('amber');
  });

  it('never writes a garbage value', () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    saveAccent('neon');
    expect(store.data[ACCENT_KEY]).toBe('amber');
  });

  it('survives an absent localStorage (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(loadAccent()).toBe('amber');
    expect(() => saveAccent('teal')).not.toThrow();
  });
});

describe('applyAccent', () => {
  it('stamps a picked accent on <html> and takes the stamp away for amber', () => {
    applyAccent('lavender');
    expect(document.documentElement.dataset.accent).toBe('lavender');
    applyAccent('amber');
    expect(document.documentElement.dataset.accent).toBeUndefined();
    applyAccent('neon');
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });
});

describe('the palette and its stylesheet stay in step', () => {
  const picked = ACCENTS.filter((a) => a.id !== DEFAULT_ACCENT);

  it('gives every accent but amber its own tokens, in both themes', () => {
    for (const { id } of picked) {
      expect(css, id).toMatch(new RegExp(`:root\\[data-accent='${id}'\\]\\s*\\{[^}]*--accent:`));
      expect(css, id).toMatch(new RegExp(`:root\\[data-theme='light'\\]\\[data-accent='${id}'\\]\\s*\\{[^}]*--accent-hover:`));
    }
  });

  it('has no rule for an accent the picker does not offer', () => {
    const ruled = new Set([...css.matchAll(/data-accent='([a-z]+)'/g)].map((m) => m[1]));
    expect([...ruled].sort()).toEqual(picked.map((a) => a.id).sort());
  });

  it('shows each swatch in the colour the stylesheet gives the accent', () => {
    for (const { id, swatch } of picked) {
      expect(css, id).toMatch(new RegExp(`:root\\[data-accent='${id}'\\]\\s*\\{\\s*--accent: ${swatch};`));
    }
  });

  it('turns a quiet accent to deep ink with white text in the light theme, and back on a dark surface', () => {
    for (const { id, swatch, swatchLight } of ACCENTS.filter((a) => a.quiet)) {
      expect(css, id).toMatch(new RegExp(`:root\\[data-theme='light'\\]\\[data-accent='${id}'\\]\\s*\\{\\s*--accent: ${swatchLight};[^}]*--accent-text: #ffffff;`));
      expect(css, id).toMatch(new RegExp(`:root\\[data-theme='light'\\]\\[data-accent='${id}'\\] \\.dark-surface\\s*\\{\\s*--accent: ${swatch};`));
    }
  });

  it('is stamped before first paint under the same key', () => {
    expect(html).toContain(`localStorage.getItem('${ACCENT_KEY}')`);
    expect(html).toContain('document.documentElement.dataset.accent = a');
  });
});
