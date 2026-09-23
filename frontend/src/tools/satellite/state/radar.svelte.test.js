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
