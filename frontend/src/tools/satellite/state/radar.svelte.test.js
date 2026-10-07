import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRadarState } from './radar.svelte.js';

/** Every read is a metered request, so what this store must get right is when it asks. */

let at;
let get;
const PASSES = [
  { date: '2026-05-14', time: '17:33:02', orbit: 'ascending', cloud: null, granules: 1 },
  { date: '2026-05-14', time: '05:42:10', orbit: 'descending', cloud: null, granules: 2 },
];

function store(peer = () => null) {
  return createRadarState({ api: { get }, place: () => at, onBilled: vi.fn(), peer });
}

beforeEach(() => {
  at = { lat: 51.95, lon: 4.05 };
  get = vi.fn(async () => ({ dates: PASSES }));
});

describe('radar passes', () => {
  it('asks nothing until its picker opens, then asks for the month', async () => {
    const s1 = store();
    expect(get).not.toHaveBeenCalled();
    s1.toggleMenu();
    await vi.waitFor(() => expect(s1.passes).toHaveLength(2));
    expect(get.mock.calls[0][0]).toContain('collection=sentinel1');
    expect(get.mock.calls[0][0]).toMatch(/start=\d{4}-\d{2}-01&end=/);
  });

  it('keeps a month it has read, for the place it read it for', async () => {
    const s1 = store();
    await s1.loadPasses();
    await s1.loadPasses();
    expect(get).toHaveBeenCalledOnce();
    at = { lat: 52.5, lon: 4.05 };
    expect(s1.stale).toBe(true);
    await s1.loadPasses();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says a read failed rather than that there was no pass', async () => {
    get = vi.fn(async () => { throw new Error('offline'); });
    const s1 = store();
    await s1.loadPasses();
    expect(s1.passes).toEqual([]);
    expect(s1.note).toContain('Could not read');
    get = vi.fn(async () => ({ dates: [] }));
    const empty = store();
    await empty.loadPasses();
    expect(empty.note).toBe('No Sentinel-1 pass here this month.');
  });

  it('shows one pass, and goes back to the most recent', () => {
    const s1 = store();
    s1.pick(PASSES[1]);
    expect(s1.variant).toEqual({ pass: { date: '2026-05-14', time: '05:42:10', orbit: 'descending' } });
    expect(s1.month).toBe('2026-05');
    s1.pick(null);
    expect(s1.pass).toBe(null);
  });

  it('never pages past the current month', () => {
    const s1 = store();
    const now = s1.month;
    s1.stepMonth(1);
    expect(s1.month).toBe(now);
  });

  it('leaves the pass already shown alone, so asking twice changes nothing', () => {
    const s1 = store();
    s1.pick(PASSES[1]);
    const shown = s1.pass;
    // a fresh object for the same pass once read as a change, and fed a loop
    s1.pick({ ...PASSES[1] });
    expect(s1.pass).toBe(shown);
    s1.pick(PASSES[0]);
    expect(s1.pass.time).toBe('17:33:02');
  });

  it('knows the other side’s pass, to mark its track', () => {
    const s1 = store(() => ({ date: '2026-05-02', time: '05:42:40' }));
    expect(s1.peer.time).toBe('05:42:40');
  });
});

/**
 * With no pass chosen the tiles used to go out without a mosaicking window,
 * which makes Sentinel Hub blend the whole archive pixel by pixel — for radar
 * that mixes looks from opposite sides of the track, which cannot be read. So
 * "most recent" resolves to one pass and that pass is the window.
 */
describe('never showing a blend of passes', () => {
  it('resolves the newest pass and renders that one', async () => {
    const s1 = store();
    expect(s1.shownPass).toBe(null);
    await s1.resolveLatest('2026-05-20');
    // two passes that day, from opposite sides: the later one is the newest
    expect(s1.shownPass).toEqual({ date: '2026-05-14', time: '17:33:02', orbit: 'ascending' });
    expect(s1.variant).toEqual({ pass: s1.shownPass });
  });

  it('prefers a chosen pass over the resolved one', async () => {
    const s1 = store();
    await s1.resolveLatest('2026-05-20');
    s1.pick(PASSES[1]);
    expect(s1.shownPass.time).toBe('05:42:10');
  });

  it('ignores a pass later than the day asked about', async () => {
    get = vi.fn(async () => ({ dates: PASSES }));
    const s1 = store();
    await s1.resolveLatest('2026-05-13');
    // nothing on or before that day in either month, so there is no window
    expect(s1.shownPass).toBe(null);
    expect(s1.undated).toBe(true);
  });

  it('separates "not asked yet" from "there is no pass here"', async () => {
    const s1 = store();
    expect(s1.resolved).toBe(false);
    expect(s1.undated).toBe(false);
    await s1.resolveLatest('2026-05-20');
    expect(s1.resolved).toBe(true);
    expect(s1.undated).toBe(false);
  });

  it('stays silent rather than declaring a blend when the lookup failed', async () => {
    get = vi.fn(async () => { throw new Error('offline'); });
    const s1 = store();
    await s1.resolveLatest('2026-05-20');
    expect(s1.undated).toBe(false);
    expect(s1.resolved).toBe(false);
  });

  it('steps back a month rather than claiming there was no pass', async () => {
    get = vi.fn(async (path) => (
      path.includes('start=2026-05')
        ? { dates: [] }
        : { dates: [{ date: '2026-04-28', time: '05:42:10', orbit: 'descending' }] }
    ));
    const s1 = store();
    await s1.resolveLatest('2026-05-02');
    expect(s1.shownPass.date).toBe('2026-04-28');
  });

  it('resolves once per place, and asks again where the map went', async () => {
    const s1 = store();
    await s1.resolveLatest('2026-05-20');
    const before = get.mock.calls.length;
    await s1.resolveLatest('2026-05-20');
    expect(get).toHaveBeenCalledTimes(before);
    at = { lat: 26.3833, lon: 56.4383 };
    expect(s1.resolved).toBe(false);
    // the pass it resolved holds while the new place is being looked up, so the
    // tiles never fall back to a blend in between
    expect(s1.shownPass.date).toBe('2026-05-14');
    expect(s1.undated).toBe(false);
  });
});
