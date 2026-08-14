import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn(() => Promise.resolve({ file: 'graph.svg', path: '/reports' }));
vi.mock('./api.js', () => ({ api: { post } }));

const {
  PLATE_MAX_EDGE, PLATE_SCALE, copyPlateImage, plateScale, pngBlob, revealPlates, writePlate,
} = await import('./plateExport.js');

const PLATE = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  width: 900,
  height: 600,
  filename: 'graph-rooftop-202608132010',
};

/** One pixel of PNG, base64 — enough to prove what travels, not what it looks like. */
const PNG64 = 'iVBORw0KGgo=';

beforeEach(() => post.mockClear());

describe('writing a plate out', () => {
  it('posts the vector page as it stands', async () => {
    await writePlate('case-a', PLATE);

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/plates', {
      filename: PLATE.filename, format: 'svg', svg: PLATE.svg,
    });
  });

  it('rasterises first when an image was asked for, and sends no markup', async () => {
    const toPng = vi.fn(() => Promise.resolve(PNG64));

    await writePlate('case-a', PLATE, { format: 'png', toPng });

    expect(toPng).toHaveBeenCalledWith(PLATE.svg, { width: 900, height: 600 });
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/plates', {
      filename: PLATE.filename, format: 'png', png: PNG64,
    });
  });

  it('asks for the folder without naming it', async () => {
    await revealPlates('case-a');
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/plates/reveal');
  });
});

describe('the scale a raster can promise', () => {
  it('is twice the page only while the page is small enough for it', () => {
    expect(plateScale({ width: 900, height: 600 })).toBe(PLATE_SCALE);
    // Past half the edge cap the ceiling bites, and the widest plate a reading can make
    // comes back smaller than itself. A dialog offering "twice the page" would be lying.
    expect(plateScale({ width: 3000, height: 2200 })).toBeCloseTo(PLATE_MAX_EDGE / 3000, 5);
    expect(plateScale({ width: 4800, height: 2000 })).toBeLessThan(1);
    expect(plateScale({ width: 0, height: 0 })).toBe(PLATE_SCALE);
  });
});

describe('copying a plate', () => {
  it('puts pixels on the clipboard, because an SVG pastes nowhere', async () => {
    const written = [];
    const clipboard = { write: (items) => (written.push(items), Promise.resolve()) };
    vi.stubGlobal('ClipboardItem', class { constructor(parts) { this.parts = parts; } });

    await copyPlateImage(PLATE, { clipboard, toPng: () => Promise.resolve(PNG64) });

    expect(written).toHaveLength(1);
    expect(written[0][0].parts['image/png']).toBeInstanceOf(Blob);
    expect(written[0][0].parts['image/png'].type).toBe('image/png');
  });

  it('says a browser cannot copy rather than reporting a copy that never happened', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    await expect(copyPlateImage(PLATE, { clipboard: {} })).rejects.toThrow('cannot copy an image');
  });

  it('decodes base64 into the bytes a PNG starts with', () => {
    const blob = pngBlob(PNG64);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(8);
  });
});
