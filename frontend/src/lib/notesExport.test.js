import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawDiagrams, exportNotes, rasterise, revealExports } from './notesExport.js';
import { api } from './api.js';

afterEach(() => vi.restoreAllMocks());

describe('exporting notes as PDF', () => {
  it('asks the backend which diagrams to draw, then sends them back', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation((path) => (
      path.endsWith('/diagrams')
        ? Promise.resolve({ diagrams: [{ key: 'abc123', source: 'graph TD; A-->B;' }] })
        : Promise.resolve({ written: [{ note: 'n1', file: 'Rooftop.pdf' }], warnings: [] })
    ));
    const draw = vi.fn(async (source) => ({ svg: `<svg>${source}</svg>`, width: 400, height: 200 }));
    const toPng = vi.fn(async () => 'AAAA');

    const result = await exportNotes('case-1', ['case', 'n1'], { draw, toPng });

    expect(post).toHaveBeenNthCalledWith(1, '/api/cases/case-1/notes/pdf/diagrams', {
      notes: ['case', 'n1'], edition: 'internal',
    });
    expect(draw).toHaveBeenCalledWith('graph TD; A-->B;');
    expect(post).toHaveBeenNthCalledWith(2, '/api/cases/case-1/notes/pdf', {
      notes: ['case', 'n1'],
      diagrams: { abc123: 'AAAA' },
      edition: 'internal',
    });
    expect(result.written).toHaveLength(1);
  });

  it('writes an HTML page with its diagrams as SVG, and what its dialog asked', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation((path) => (
      path.endsWith('/diagrams')
        ? Promise.resolve({ diagrams: [{ key: 'abc123', source: 'graph TD; A-->B;' }] })
        : Promise.resolve({ written: [{ note: 'n1', file: 'Rooftop.html' }], warnings: [] })
    ));
    const draw = vi.fn(async (source) => ({ svg: `<svg>${source}</svg>`, width: 400, height: 200 }));
    await exportNotes('case-1', ['n1'], {
      draw, edition: 'public', format: 'html', roundPov: true, changes: `  ${'Corrected the second date. '.repeat(20)}`,
    });
    expect(post).toHaveBeenNthCalledWith(1, '/api/cases/case-1/notes/pdf/diagrams', { notes: ['n1'], edition: 'public' });
    const [path, body] = post.mock.calls[1];
    expect(path).toBe('/api/cases/case-1/notes/html');
    expect(body).toMatchObject({ notes: ['n1'], diagrams: { abc123: '<svg>graph TD; A-->B;</svg>' }, edition: 'public', round_pov: true });
    expect(body.changes.startsWith('Corrected the second date.')).toBe(true);
    expect(body.changes.length).toBe(300);
  });

  it('writes a web folder in the public edition, its diagrams as SVG, with the address it will live at', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation((path) => (
      path.endsWith('/diagrams')
        ? Promise.resolve({ diagrams: [{ key: 'abc123', source: 'graph TD; A-->B;' }] })
        : Promise.resolve({ written: [{ note: 'n1', file: 'harbour' }], warnings: [] })
    ));
    const draw = vi.fn(async (source) => ({ svg: `<svg>${source}</svg>`, width: 400, height: 200 }));
    await exportNotes('case-1', ['n1'], { draw, edition: 'internal', format: 'web', address: ' https://desk.github.io/articles/harbour/ ' });
    expect(post).toHaveBeenNthCalledWith(1, '/api/cases/case-1/notes/pdf/diagrams', { notes: ['n1'], edition: 'public' });
    const [path, body] = post.mock.calls[1];
    expect(path).toBe('/api/cases/case-1/notes/web');
    expect(body).toEqual({
      notes: ['n1'], diagrams: { abc123: '<svg>graph TD; A-->B;</svg>' }, edition: 'public', round_pov: false, changes: '',
      base_url: 'https://desk.github.io/articles/harbour/',
    });
    // with no address, none is sent: the folder works without one
    await exportNotes('case-1', ['n1'], { draw, format: 'web' });
    expect(post.mock.calls[3][1]).not.toHaveProperty('base_url');
    expect(post.mock.calls[3][1]).not.toHaveProperty('offline_maps');
    // its maps kept offline when asked, and only then said
    await exportNotes('case-1', ['n1'], { draw, format: 'web', offlineMaps: true });
    expect(post.mock.calls[5][1].offline_maps).toBe(true);
  });

  it('skips drawing entirely when no note holds a diagram', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation((path) => (
      path.endsWith('/diagrams')
        ? Promise.resolve({ diagrams: [] })
        : Promise.resolve({ written: [], warnings: [] })
    ));
    const draw = vi.fn();

    await exportNotes('case-1', ['case'], { draw, edition: 'public' });

    expect(draw).not.toHaveBeenCalled();
    // the edition asked for goes to both: the public one draws no diagram of a passage it leaves out
    expect(post).toHaveBeenNthCalledWith(1, '/api/cases/case-1/notes/pdf/diagrams', { notes: ['case'], edition: 'public' });
    expect(post).toHaveBeenLastCalledWith('/api/cases/case-1/notes/pdf', {
      notes: ['case'],
      diagrams: {},
      edition: 'public',
    });
  });

  it('drops a diagram that will not draw rather than losing the export', async () => {
    const draw = vi.fn()
      .mockRejectedValueOnce(new Error('bad syntax'))
      .mockResolvedValueOnce({ svg: '<svg/>', width: 10, height: 10 });

    const diagrams = await drawDiagrams(
      [{ key: 'broken', source: 'nope' }, { key: 'fine', source: 'graph TD; A-->B;' }],
      { draw, toPng: async () => 'BBBB' },
    );

    expect(diagrams).toEqual({ fine: 'BBBB' });
  });

  it('rasterises a diagram onto an opaque canvas', async () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    const canvas = { getContext: () => context, toDataURL: () => 'data:image/png;base64,PNGDATA' };
    vi.stubGlobal('document', { createElement: () => canvas });
    class FakeImage {
      addEventListener(type, callback) { if (type === 'load') this.onload = callback; }
      set src(_value) { queueMicrotask(() => this.onload()); }
    }
    vi.stubGlobal('Image', FakeImage);

    await expect(rasterise('<svg/>', { width: 400, height: 200 })).resolves.toBe('PNGDATA');
    // A transparent SVG on an empty canvas prints black; the fill is what
    // keeps a diagram on white paper.
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalled();
    expect(canvas.width).toBe(800);
    vi.unstubAllGlobals();
  });

  it('reveals the export folder without naming a path', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ path: '/somewhere/exports' });

    await revealExports('case-1');

    expect(post).toHaveBeenCalledWith('/api/cases/case-1/notes/pdf/reveal');
  });
});
