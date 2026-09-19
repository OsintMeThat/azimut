import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaybackState } from './wayback.svelte.js';

/**
 * Both questions this store asks reach Esri, so what it must get right is when
 * it asks and what it refuses to claim.
 */

const RELEASES = [
  { release: 26334, date: '2026-08-05' },
  { release: 64776, date: '2023-08-31' },
  { release: 25982, date: '2023-06-13' },
  { release: 10, date: '2014-02-20' },
];

let at;
let get;

function store() {
  return createWaybackState({ api: { get }, place: () => at });
}

beforeEach(() => {
  at = { lat: 50.45, lon: 30.51, zoom: 15 };
  get = vi.fn(async (path) => {
    if (path.includes('/wayback/releases')) return { releases: RELEASES };
    if (path.includes('/wayback/changes')) {
      return {
        changes: [
          { release: 64776, acquired: '2022-03-31', source: 'Maxar WV03' },
          { release: 10, acquired: '2011-09-20', source: 'DigitalGlobe WV02' },
        ],
        zoom: 15,
      };
    }
    throw new Error(`unexpected ${path}`);
  });
});

describe('asking Esri', () => {
  it('asks nothing until it is used', () => {
    store();
    expect(get).not.toHaveBeenCalled();
  });

  it('reads the release list once, however often it is asked', async () => {
    const wb = store();
    await Promise.all([wb.loadReleases(), wb.loadReleases()]);
    await wb.loadReleases();
    expect(get.mock.calls.filter(([path]) => path.includes('/releases'))).toHaveLength(1);
    expect(wb.date).toBe('2026-08-05');
  });

  it('says it is busy for either read, so a chip can carry the wait', async () => {
    const wb = store();
    expect(wb.busy).toBe(false);

    const list = wb.loadReleases();
    expect(wb.busy).toBe(true);
    await list;
    expect(wb.busy).toBe(false);

    const history = wb.loadChanges();
    expect(wb.busy).toBe(true);
    await history;
    expect(wb.busy).toBe(false);
  });

  it('opening the picker reads the list and this point’s history', async () => {
    const wb = store();
    wb.toggleMenu();
    await vi.waitFor(() => expect(wb.changes).toEqual([64776, 10]));
    expect(get).toHaveBeenCalledWith('/api/satellite/wayback/changes?lat=50.45&lon=30.51&zoom=15');
    expect(wb.visible.map((entry) => entry.release)).toEqual([64776, 10]);
  });

  it('answers a nudge inside the same tile from memory', async () => {
    const wb = store();
    await wb.loadChanges();
    at = { lat: 50.4501, lon: 30.5101, zoom: 15 };
    expect(wb.stale).toBe(false);
    await wb.loadChanges();
    expect(get.mock.calls.filter(([path]) => path.includes('/changes'))).toHaveLength(1);
  });

  it('marks the history stale once the map leaves its tile, and keeps the changes meanwhile', async () => {
    const wb = store();
    await wb.loadReleases();
    await wb.loadChanges();
    at = { lat: 48.85, lon: 2.29, zoom: 15 };
    expect(wb.stale).toBe(true);
    // the walk takes seconds: the bar stays a bar of changes rather than
    // flipping to every release and back
    expect(wb.visible.map((entry) => entry.release)).toEqual([64776, 10]);
  });

  it('reads the history again when changes are re-asked for after the map moved', async () => {
    const wb = store();
    await wb.loadChanges();
    at = { lat: 48.85, lon: 2.29, zoom: 15 };
    wb.setChangesOnly(false);
    wb.setChangesOnly(true);
    await vi.waitFor(() => expect(wb.stale).toBe(false));
    expect(get.mock.calls.filter(([path]) => path.includes('/changes'))).toHaveLength(2);
  });
});

describe('following the map', () => {
  it('asks nothing until the picker has been opened once', async () => {
    const wb = store();
    at = { lat: 48.85, lon: 2.29, zoom: 15 };
    expect(wb.follow()).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('reads the new tile’s history once the picker has been opened, shut or not', async () => {
    const wb = store();
    wb.toggleMenu();
    await vi.waitFor(() => expect(wb.changes).toEqual([64776, 10]));
    wb.toggleMenu(); // shut again: the history still follows the map
    expect(wb.menuOpen).toBe(false);
    at = { lat: 48.85, lon: 2.29, zoom: 15 };
    await wb.follow();
    expect(get).toHaveBeenLastCalledWith(
      '/api/satellite/wayback/changes?lat=48.85&lon=2.29&zoom=15'
    );
    expect(wb.stale).toBe(false);
  });

  it('asks once per tile, however often the map settles over it', async () => {
    const wb = store();
    wb.toggleMenu();
    await vi.waitFor(() => expect(wb.changes).toEqual([64776, 10]));
    const asked = get.mock.calls.filter(([path]) => path.includes('/changes')).length;
    at = { lat: 50.4501, lon: 30.5101, zoom: 15 }; // a nudge inside the same tile
    await wb.follow();
    await wb.follow();
    expect(get.mock.calls.filter(([path]) => path.includes('/changes'))).toHaveLength(asked);
  });

  it('leaves a tile Esri refused alone until Refresh is pressed', async () => {
    get = vi.fn(async (path) => {
      if (path.includes('/releases')) return { releases: RELEASES };
      throw new Error('offline');
    });
    const wb = store();
    wb.toggleMenu();
    await vi.waitFor(() => expect(wb.changesNote).toContain('offline'));
    const refused = get.mock.calls.filter(([path]) => path.includes('/changes')).length;
    await wb.follow(); // panning must not hammer a service that is down
    expect(get.mock.calls.filter(([path]) => path.includes('/changes'))).toHaveLength(refused);
    await wb.loadChanges(); // …but the analyst can ask again
    expect(get.mock.calls.filter(([path]) => path.includes('/changes'))).toHaveLength(refused + 1);
  });

  it('offers nothing while the first history of a point is coming', async () => {
    const wb = store();
    await wb.loadReleases();
    expect(wb.reading).toBe(false);
    const coming = wb.loadChanges();
    expect(wb.reading).toBe(true);
    await coming;
    expect(wb.reading).toBe(false);
  });
});

describe('what it refuses to claim', () => {
  it('says a failed history is unknown rather than empty', async () => {
    get = vi.fn(async (path) => {
      if (path.includes('/releases')) return { releases: RELEASES };
      throw new Error('could not read this point');
    });
    const wb = store();
    await wb.loadReleases();
    await wb.loadChanges();
    expect(wb.changes).toBeNull();
    expect(wb.changesNote).toContain('could not read this point');
    // every release stays on offer: we do not know which changed
    expect(wb.visible).toHaveLength(4);
  });

  it('says so when the release list cannot be read', async () => {
    get = vi.fn(async () => {
      throw new Error('offline');
    });
    const wb = store();
    await wb.loadReleases();
    expect(wb.releases).toEqual([]);
    expect(wb.listNote).toContain('offline');
  });
});

describe('naming what is on screen', () => {
  it('keeps when each picture was taken beside the release that showed it', async () => {
    const wb = store();
    await wb.loadChanges();
    expect(wb.picture(64776)).toMatchObject({ acquired: '2022-03-31', source: 'Maxar WV03' });
    expect(wb.picture(26334)).toBeNull();
  });

  it('names the newest release by the change it shows once narrowed to changes', async () => {
    // the newest release carries the latest change's pixels; two dates for one
    // picture read as two pictures
    const wb = store();
    await wb.loadReleases();
    expect(wb.date).toBe('2026-08-05');
    await wb.loadChanges();
    expect(wb.date).toBe('2023-08-31');
    wb.setChangesOnly(false);
    expect(wb.date).toBe('2026-08-05');
  });
});

describe('choosing a release', () => {
  it('keeps the newest as the plain basemap', async () => {
    const wb = store();
    await wb.loadReleases();
    wb.pick(26334);
    expect(wb.release).toBeNull();
    expect(wb.variant).toEqual({ release: null });
    wb.pick(25982);
    expect(wb.variant).toEqual({ release: 25982 });
  });

  it('steps through what the picker offers', async () => {
    const wb = store();
    await wb.loadReleases();
    await wb.loadChanges();
    // the newest release shows the latest change's pixels here, so one step
    // older is the change before it
    expect(wb.step(1)).toBe(10);
    expect(wb.step(1)).toBeUndefined();
    expect(wb.release).toBe(10);
    expect(wb.step(-1)).toBe(64776);
  });

  it('reads the history when narrowed to changes it does not have yet', async () => {
    const wb = store();
    wb.setChangesOnly(false);
    expect(get).not.toHaveBeenCalled();
    wb.setChangesOnly(true);
    await vi.waitFor(() => expect(wb.changes).toEqual([64776, 10]));
  });
});
