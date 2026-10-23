// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWelcome, shouldWelcome } from './welcome.js';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('when a version opens with its welcome', () => {
  it('on the first start of a version', () => {
    expect(shouldWelcome('0.3.3')).toBe(true);
  });

  it('not once the app has no version to name', () => {
    expect(shouldWelcome('')).toBe(false);
  });

  it('again at the next start when it was closed without the tick, but not on a reload', () => {
    closeWelcome('0.3.3', false);
    expect(shouldWelcome('0.3.3')).toBe(false);
    // the launcher opens a new tab, which starts with its session storage empty
    sessionStorage.clear();
    expect(shouldWelcome('0.3.3')).toBe(true);
  });

  it('never again on that version once "Don’t show this again" was ticked', () => {
    closeWelcome('0.3.3', true);
    sessionStorage.clear();
    expect(shouldWelcome('0.3.3')).toBe(false);
  });

  it('again on the next version, tick or not', () => {
    closeWelcome('0.3.3', true);
    expect(shouldWelcome('0.3.4')).toBe(true);
  });

  it('every time in a browser that refuses its storage, rather than failing the start', () => {
    // blocked site data: the accessor itself throws
    for (const store of ['localStorage', 'sessionStorage']) {
      vi.spyOn(window, store, 'get').mockImplementation(() => {
        throw new Error('denied');
      });
    }
    expect(() => closeWelcome('0.3.3', true)).not.toThrow();
    expect(shouldWelcome('0.3.3')).toBe(true);
  });
});
