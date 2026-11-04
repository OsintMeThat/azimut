import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get } }));

const { faceFamily, forgetNoteFonts, loadNoteFont, noteFonts } = await import('./noteFonts.js');

/** A stand-in for the browser's FontFace: `failing` keys refuse to load. */
function fakeFonts(failing = []) {
  const added = [];
  const made = [];
  class FakeFace {
    constructor(family, source, descriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      made.push(this);
    }

    load() {
      return failing.some((key) => this.source.includes(`/${key}.ttf`)) ? Promise.reject(new Error('404')) : Promise.resolve(this);
    }
  }
  vi.stubGlobal('FontFace', FakeFace);
  vi.stubGlobal('document', { fonts: { add: (face) => added.push(face.family) } });
  return { added, made };
}

beforeEach(() => forgetNoteFonts());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the typefaces a note prints in', () => {
  it('are named by the server, in its order, with the style\'s own first', async () => {
    get.mockResolvedValue({ fonts: [
      { key: 'book', label: 'Source Serif 4', kind: 'serif' },
      { key: 'serif', label: 'Noto Serif', kind: 'serif' },
      { key: 'modern', label: 'Inter', kind: 'sans' },
      { key: 'sans', label: 'Noto Sans', kind: 'sans' },
      { key: 'other', label: 'Not offered', kind: 'sans' },
    ] });
    const fonts = await noteFonts();
    expect(get).toHaveBeenCalledWith('/api/notes/fonts');
    expect(fonts.map((font) => [font.id, font.label])).toEqual([
      ['', "Style's own"], ['book', 'Source Serif 4'], ['serif', 'Noto Serif'], ['modern', 'Inter'], ['sans', 'Noto Sans'],
    ]);
    // asked once per tab
    await noteFonts();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('are still offered, under their stand-in names, when the server cannot be asked', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    const fonts = await noteFonts();
    expect(fonts.map((font) => font.id)).toEqual(['', 'serif', 'sans', 'book', 'modern']);
    // and asked again the next time
    get.mockResolvedValueOnce({ fonts: [{ key: 'book', label: 'Source Serif 4' }] });
    expect((await noteFonts()).find((font) => font.id === 'book').label).toBe('Source Serif 4');
  });

  it('are drawn in their own face, loaded once from the server', async () => {
    const { added, made } = fakeFonts();
    expect(await loadNoteFont('book')).toBe(true);
    expect(await loadNoteFont('book')).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].source).toBe('url(/api/notes/fonts/book.ttf)');
    expect(added).toEqual([faceFamily('book')]);
  });

  it('keep the interface\'s font when a face does not load, and never ask for one they do not know', async () => {
    const { added, made } = fakeFonts(['modern']);
    expect(await loadNoteFont('modern')).toBe(false);
    expect(await loadNoteFont('../secret')).toBe(false);
    expect(await loadNoteFont('')).toBe(false);
    expect(added).toEqual([]);
    expect(made).toHaveLength(1);
  });
});
