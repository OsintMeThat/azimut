import { describe, expect, it, vi } from 'vitest';
import { fileReading, readingName, readingOffer } from './readingFigure.js';

const plate = { svg: '<svg/>', width: 1800, height: 900, filename: 'timeline-5-mar' };

describe('a Graph or Timeline reading filed as a picture', () => {
  it('names a snapshot made for a note after the tool and what it holds, cut to a name the views accept', () => {
    expect(readingName('Timeline', '5 Mar 2024 to 6 Mar 2024')).toBe('Timeline, 5 Mar 2024 to 6 Mar 2024');
    expect(readingName('Graph', '')).toBe('Graph');
    expect(readingName('Graph', 'x'.repeat(200))).toHaveLength(76);
  });

  it('posts the plate as a PNG with the recipe to freeze, and says whether the picture is new', async () => {
    const toPng = vi.fn().mockResolvedValue('PNGDATA');
    const post = vi.fn().mockResolvedValue({ entity: 'e_fig', view: 'v_1', path: 'media/x.png', reused: false });
    const signal = new AbortController().signal;
    const filed = await fileReading({ caseId: 'c1', surface: 'timeline', name: 'Timeline', spec: { a: 1 }, plate, signal, post, toPng });
    expect(toPng).toHaveBeenCalledWith('<svg/>', { width: 1800, height: 900 });
    expect(post).toHaveBeenCalledWith('/api/cases/c1/analysis-views/figure', {
      name: 'Timeline', surface: 'timeline', spec: { a: 1 }, png: 'PNGDATA', filename: 'timeline-5-mar',
    }, { signal });
    expect(filed).toEqual({ entity: { id: 'e_fig' }, view: 'v_1', fresh: true });
    // a snapshot already open is named, and a picture filed before is cited again
    post.mockResolvedValue({ entity: 'e_fig', view: 'v_9', reused: true });
    const again = await fileReading({ caseId: 'c1', surface: 'graph', name: 'N', spec: {}, plate, viewId: 'v_9', post, toPng });
    expect(post.mock.calls.at(-1)[1].view_id).toBe('v_9');
    expect(post.mock.calls.at(-1)[2]).toBeUndefined();
    expect(again.fresh).toBe(false);
  });

  it('puts the picture at the page width its shape allows, filing nothing again for one filed before', async () => {
    const keep = vi.fn().mockResolvedValue({ entity: { id: 'e_fig' }, label: 'Timeline, 5 Mar 2024', fresh: true, width: 1800, height: 900 });
    const offer = readingOffer({ label: 'This window as a picture', hint: 'h', keep });
    expect(offer).toMatchObject({ id: 'figure', label: 'This window as a picture', picture: true });
    expect(await offer.put({})).toEqual({ text: '[[media:e_fig|Timeline, 5 Mar 2024]]{width=100%}', filed: ['e_fig'] });
    keep.mockResolvedValue({ entity: { id: 'e_fig' }, label: 'G', fresh: false, width: 900, height: 1800 });
    expect(await offer.put({})).toEqual({ text: '[[media:e_fig|G]]{width=71%}', filed: [] });
    await expect(readingOffer({ label: 'l', hint: 'h', keep: async () => ({}) }).put({})).rejects.toThrow('could not be filed');
  });
});
