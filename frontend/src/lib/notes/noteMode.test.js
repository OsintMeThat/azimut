// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Whether the page is drawn or raw is one choice for the browser: read once as the
 * module loads, kept as it is changed.
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function fresh() {
  vi.resetModules();
  return (await import('./noteMode.svelte.js')).noteMode;
}

describe('the mode of the page', () => {
  it('is drawn the first time', async () => {
    const mode = await fresh();
    expect(mode.mode).toBe('drawn');
  });

  it('is kept under one key, as it is set, and read once on the next load', async () => {
    const mode = await fresh();
    mode.set('markdown');
    expect(mode.mode).toBe('markdown');
    expect(localStorage.getItem('azimut.noteMode')).toBe('markdown');
    expect(localStorage.length).toBe(1);
    const next = await fresh();
    expect(next.mode).toBe('markdown');
    next.set('drawn');
    expect(localStorage.getItem('azimut.noteMode')).toBe('drawn');
    expect((await fresh()).mode).toBe('drawn');
  });

  it('is not read again once loaded', async () => {
    const mode = await fresh();
    const read = vi.spyOn(Storage.prototype, 'getItem');
    localStorage.setItem('azimut.noteMode', 'markdown');
    expect(mode.mode).toBe('drawn');
    mode.toggle();
    mode.toggle();
    expect(read).not.toHaveBeenCalled();
  });

  it('switches to the other with toggle', async () => {
    const mode = await fresh();
    mode.toggle();
    expect(mode.mode).toBe('markdown');
    mode.toggle();
    expect(mode.mode).toBe('drawn');
  });

  it('takes anything but markdown for drawn', async () => {
    localStorage.setItem('azimut.noteMode', 'sepia');
    expect((await fresh()).mode).toBe('drawn');
    const mode = await fresh();
    mode.set('sepia');
    expect(mode.mode).toBe('drawn');
  });

  it('works for the visit when the browser will not store it', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const mode = await fresh();
    expect(mode.mode).toBe('drawn');
    expect(() => mode.set('markdown')).not.toThrow();
    expect(mode.mode).toBe('markdown');
  });
});
