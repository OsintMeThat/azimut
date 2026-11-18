import { describe, expect, it, vi } from 'vitest';

/**
 * A map put: what it asks the server for, and the offer `putInNote` runs, Undo's filed
 * pictures included.
 */

vi.mock('../api.js', () => ({ api: { post: vi.fn() } }));
vi.mock('../state.svelte.js', () => ({ reloadCase: vi.fn(), toast: vi.fn() }));
const { layerMapOffer, mapOffer, mapRequest, proofsPeriod, putMap } = await import('./mapPut.js');

describe('a map put', () => {
  it('asks only for what was picked, each layer once', () => {
    expect(mapRequest({ title: '  The  front ', layers: ['A', 'A', ' ', 'B'], plate: '', proofs: '' }))
      .toEqual({ title: 'The front', layers: ['A', 'B'] });
    expect(mapRequest({ plate: 'Losses', proofs: 'all', provider: 'osm' })).toEqual({ title: '', plate: 'Losses', proofs: 'all', provider: 'osm' });
  });

  it('writes a period of proofs as the block reads it', () => {
    expect(proofsPeriod({ on: false, from: '2026-01-01' })).toBe('');
    expect(proofsPeriod({ on: true })).toBe('all');
    expect(proofsPeriod({ on: true, from: '2026-10-01', to: '2026-10-01' })).toBe('2026-10-01');
    expect(proofsPeriod({ on: true, from: '2026-11-01', to: '2026-10-01' })).toBe('2026-10-01..2026-11-01');
    expect(proofsPeriod({ on: true, to: '2026-10-01' })).toBe('..2026-10-01');
  });

  it('answers the block and what it filed, and says the server’s warnings', async () => {
    const post = vi.fn(async () => ({ text: '::: map\nlayer: A\n:::', filed: ['e_ground'], warnings: ['No ground'] }));
    const reload = vi.fn();
    const say = vi.fn();
    const answer = await putMap('Port strike', { layers: ['A'] }, { post, reload, say });
    expect(post).toHaveBeenCalledWith('/api/cases/Port%20strike/notes/maps', { layers: ['A'] }, { signal: undefined });
    expect(answer).toEqual({ text: '::: map\nlayer: A\n:::', filed: ['e_ground'] });
    expect(reload).toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('No ground', 'warn', 8000);
  });

  it('reads what to map on the press, after what must happen first', async () => {
    const post = vi.fn(async (_path, body) => ({ text: `::: map\nplate: ${body.plate}\n:::`, filed: [] }));
    const order = [];
    let name = 'Draft';
    const offer = mapOffer({
      caseId: () => 'c1',
      prepare: async () => { order.push('saved'); name = 'Losses'; },
      request: () => { order.push('read'); return { plate: name }; },
      deps: { post, reload: vi.fn(), say: vi.fn() },
    });
    expect(offer.label).toBe('As an interactive map');
    const put = await offer.put({});
    expect(order).toEqual(['saved', 'read']);
    expect(put.text).toBe('::: map\nplate: Losses\n:::');
    await expect(mapOffer({ caseId: () => '', request: {}, deps: { post } }).put({})).rejects.toThrow('nothing to map');
  });

  it('maps one of My layers under its title', async () => {
    const post = vi.fn(async () => ({ text: 'x', filed: [] }));
    await layerMapOffer('c1', { name: 'Front, north', title: 'Front' }, { post, reload: vi.fn(), say: vi.fn() }).put({});
    expect(post.mock.calls[0][1]).toEqual({ title: 'Front', layers: ['Front, north'] });
  });
});
