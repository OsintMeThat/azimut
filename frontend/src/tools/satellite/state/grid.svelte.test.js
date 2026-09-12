// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGridState } from './grid.svelte.js';
import * as gridSearch from '../../../lib/gridSearch.js';
import { dispatch } from '../../../lib/events.js';

/**
 * Grid Search, apart from the map it draws on.
 *
 * The lattice geometry has its own tests (lib/gridSearch.js); what is asserted
 * here is which grid is open, what a switch away from it costs, and what a
 * sweep writes.
 */

/** A box a few hundred metres across — a handful of cells at 500 m. */
const AREA = { south: 50.44, north: 50.46, west: 30.51, east: 30.54 };
const CORNERS = {
  p1: { lat: AREA.south, lon: AREA.west },
  p2: { lat: AREA.north, lon: AREA.east },
  widthPx: 400,
  heightPx: 300,
};

let api;
let notify;
let layers;
let surface;
let engine;
let put;
let marks;
let revision;
let ensureCase;
let reloadCase;
let currentCase;
let stores;

function layer() {
  return {
    set: vi.fn(),
    clear: vi.fn(),
    patch: vi.fn(),
    visible: vi.fn(),
    destroy: vi.fn(),
  };
}

function store() {
  const created = createGridState({
    engine: () => engine,
    api,
    notify,
    caseId: () => currentCase,
    ensureCase,
    reloadCase,
    coords: (lat, lon) => `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    zoom: () => 14,
    surface,
  });
  // A store listens for nudges from the moment it exists, so one left behind by
  // an earlier test would answer this one's. Torn down in `afterEach`.
  stores.push(created);
  return created;
}

/** The cell shapes last handed to the map — what a click on the map runs. */
function cells() {
  return layers[0].set.mock.calls.at(-1)[0];
}

/** A store with one rect grid drawn and every pending write settled. */
async function drawn() {
  const g = store();
  g.open();
  await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
  g.startDraw('rect');
  await g.finishRect(CORNERS);
  return g;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stores = [];
  currentCase = 'case-1';
  notify = vi.fn();
  put = [];
  marks = [];
  // One counter for both roads to the file, as the server keeps it: a marked
  // cell moves the revision exactly as a rewritten shape does, which is what
  // makes a stale whole-spec save recognisable.
  revision = 0;
  ensureCase = vi.fn(async () => ({ id: currentCase }));
  reloadCase = vi.fn(async () => {});
  api = {
    get: vi.fn(async (path) => {
      if (path.endsWith('/search-grids')) return [{ name: 'grid-old', title: 'Old sweep' }];
      return gridSearch.createGrid({ type: 'rect', bounds: AREA }, 500);
    }),
    put: vi.fn(async (path, body) => {
      put.push({ path, body });
      return { name: 'grid-1', updated_at: '2026-09-10T10:00:00Z', revision: ++revision };
    }),
    post: vi.fn(async (path, body) => {
      if (!path.endsWith('/marks')) return { id: 'place-1' };
      marks.push({ path, body });
      return { name: 'grid-1', revision: ++revision };
    }),
    del: vi.fn(async () => ({})),
  };
  layers = [layer(), layer(), layer()];
  let handed = 0;
  surface = vi.fn(() => layers[handed++] ?? layer());
  engine = { fitBounds: vi.fn() };
});

afterEach(() => {
  for (const created of stores) created.destroy();
  vi.useRealTimers();
});

describe('opening the mode', () => {
  it('reads the case’s saved grids', async () => {
    const g = store();
    g.open();
    await vi.waitFor(() => expect(g.others).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('/api/cases/case-1/search-grids');
  });

  it('draws nothing before the map is up', () => {
    engine = null;
    const g = store();
    g.open();
    expect(surface).not.toHaveBeenCalled();
  });

  it('takes three layers: the cells, the area outline and the draft ring', () => {
    const g = store();
    g.open();
    expect(surface).toHaveBeenCalledTimes(3);
  });

  it('leaves the map bare on the way out, keeping the grid', async () => {
    const g = await drawn();
    g.exit();
    expect(g.on).toBe(false);
    expect(g.grid).not.toBe(null);
    for (const l of layers) expect(l.clear).toHaveBeenCalled();
  });
});

describe('drawing an area', () => {
  it('makes a grid the lattice covers', async () => {
    const g = await drawn();
    expect(g.grid.aoi.type).toBe('rect');
    expect(g.name).toMatch(/^grid-/);
    expect([...gridSearch.cellsInAoi(g.grid)].length).toBeGreaterThan(0);
  });

  it('titles it by where it is, so the picker names a place', async () => {
    const g = await drawn();
    expect(g.grid.title).toBe('50.450, 30.525');
  });

  it('always makes a *new* grid rather than redrawing the one you are on', async () => {
    const g = await drawn();
    const first = g.name;
    g.grid.statuses['0:0'] = 'flagged';

    vi.setSystemTime(new Date(Date.now() + 5000));
    g.startDraw('rect');
    await g.finishRect(CORNERS);
    expect(g.name).not.toBe(first);
    expect(g.grid.statuses).toEqual({}); // the marks stayed with the old one
  });

  it('writes the grid it is leaving before the next one opens', async () => {
    const g = await drawn();
    put.length = 0;
    const leaving = g.name;
    const marked = cells()[0].id;
    cells()[0].onClick(); // a mark still inside the debounce

    vi.setSystemTime(new Date(Date.now() + 5000));
    g.startDraw('rect');
    await g.finishRect(CORNERS);
    expect(marks[0].path).toContain(leaving);
    expect(marks[0].body.marks).toEqual({ [marked]: 'cleared' });
  });

  it('needs a case to hold the grid', async () => {
    await drawn();
    expect(ensureCase).toHaveBeenCalled();
  });

  it('refuses a lattice too fine for its area, keeping what was there', async () => {
    const g = await drawn();
    const kept = g.grid;
    g.cellMetres = 1; // a metre grid over a city block
    g.startDraw('rect');
    const made = await g.finishRect(CORNERS);
    expect(made).toBe(null);
    expect(g.grid).toBe(kept);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('cell limit'),
      'warn',
      expect.any(Number)
    );
  });

  it('never builds a NaN lattice out of an emptied cell-size box', async () => {
    const g = store();
    g.open();
    g.cellMetres = '';
    g.startDraw('rect');
    await g.finishRect(CORNERS);
    expect(Number.isFinite(g.grid.cell_m)).toBe(true);
  });

  it('treats a stray click as no area at all', async () => {
    const g = await drawn();
    const kept = g.grid;
    g.startDraw('rect');
    const made = await g.finishRect({ ...CORNERS, widthPx: 4, heightPx: 3 });
    expect(made).toBe(null);
    expect(g.grid).toBe(kept);
    expect(g.drawMode).toBe(null);
  });

  it('restores the cells it hid to draw over them', async () => {
    const g = await drawn();
    g.startDraw('rect');
    expect(layers[0].clear).toHaveBeenCalled();
    layers[0].set.mockClear();
    await g.finishRect(null);
    expect(layers[0].set).toHaveBeenCalled();
  });
});

describe('drawing a polygon', () => {
  it('takes map clicks as vertices only while that tool is armed', async () => {
    const g = await drawn();
    expect(g.addVertex({ lat: 50.45, lon: 30.52 })).toBe(false);

    g.startDraw('polygon');
    expect(g.addVertex({ lat: 50.45, lon: 30.52 })).toBe(true);
    expect(g.draft).toHaveLength(1);
  });

  it('will not confirm a shape that is not one', async () => {
    const g = await drawn();
    g.startDraw('polygon');
    g.addVertex({ lat: 50.45, lon: 30.52 });
    g.addVertex({ lat: 50.46, lon: 30.53 });
    expect(g.confirmPolygon()).toBe(null);
  });

  it('builds a grid over three corners and drops the draft', async () => {
    const g = await drawn();
    g.startDraw('polygon');
    g.addVertex({ lat: 50.44, lon: 30.51 });
    g.addVertex({ lat: 50.46, lon: 30.51 });
    g.addVertex({ lat: 50.46, lon: 30.54 });
    await g.confirmPolygon();
    expect(g.grid.aoi.type).toBe('polygon');
    expect(g.draft).toEqual([]);
    expect(g.drawMode).toBe(null);
  });

  it('cancelling drops the draft and puts the cells back', async () => {
    const g = await drawn();
    g.startDraw('polygon');
    g.addVertex({ lat: 50.45, lon: 30.52 });
    layers[0].set.mockClear();
    g.cancelDraw();
    expect(g.draft).toEqual([]);
    expect(layers[0].set).toHaveBeenCalled();
  });
});

describe('marking cells', () => {
  it('cycles a cell through its statuses and repaints only that one', async () => {
    const g = await drawn();
    layers[0].set.mockClear();
    const [i, j] = [...gridSearch.cellsInAoi(g.grid)][0];
    const key = gridSearch.cellKey(i, j);

    const cell = layers[0].set.mock.calls.length;
    g.grid.statuses[key] = gridSearch.cycleStatus(undefined);
    expect(g.grid.statuses[key]).toBe('cleared');
    expect(layers[0].set.mock.calls.length).toBe(cell); // never a rebuild
  });

  it('counts what has been swept', async () => {
    const g = await drawn();
    const total = [...gridSearch.cellsInAoi(g.grid)].length;
    expect(g.coverage.total).toBe(total);
    expect(g.coverage.cleared).toBe(0);
  });

  it('has no coverage to report with no grid open', () => {
    expect(store().coverage).toBe(null);
  });
});

describe('the sweep', () => {
  it('flies to the first unchecked cell and puts it under review', async () => {
    const g = await drawn();
    g.startReview();
    expect(g.reviewKey).not.toBe(null);
    expect(engine.fitBounds).toHaveBeenCalled();
  });

  it('marks the cell under review and moves on', async () => {
    const g = await drawn();
    g.startReview();
    const first = g.reviewKey;
    g.markReview('cleared');
    expect(g.grid.statuses[first]).toBe('cleared');
    expect(g.reviewKey).not.toBe(first);
  });

  it('says so when every cell is marked, and leaves nothing under review', async () => {
    const g = await drawn();
    for (const [i, j] of gridSearch.cellsInAoi(g.grid)) {
      g.grid.statuses[gridSearch.cellKey(i, j)] = 'cleared';
    }
    g.startReview();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Sweep complete'), 'ok');
    expect(g.reviewKey).toBe(null);
  });

  it('ignores a mark with nothing under review', async () => {
    const g = await drawn();
    g.markReview('flagged');
    expect(g.grid.statuses).toEqual({});
  });

  it('flags the cell under review and files its centre as a place', async () => {
    const g = await drawn();
    g.startReview();
    const key = g.reviewKey;
    await g.reviewToPlace();
    expect(g.grid.statuses[key]).toBe('flagged');
    expect(api.post).toHaveBeenCalledWith(
      '/api/cases/case-1/satellite/place',
      expect.objectContaining({ zoom: 16, bearing: 0 })
    );
    expect(reloadCase).toHaveBeenCalled();
  });

  it('keeps the flag when the place cannot be saved', async () => {
    api.post = vi.fn(async () => {
      throw new Error('refused');
    });
    const g = await drawn();
    g.startReview();
    const key = g.reviewKey;
    await g.reviewToPlace();
    expect(g.grid.statuses[key]).toBe('flagged');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Could not save place'),
      'danger',
      expect.any(Number)
    );
  });
});

describe('the eye toggle', () => {
  it('takes all three layers off the map and puts them back', async () => {
    const g = await drawn();
    expect(g.toggleHidden()).toBe(true);
    for (const l of layers) expect(l.visible).toHaveBeenCalledWith(false);
    expect(g.toggleHidden()).toBe(false);
    for (const l of layers) expect(l.visible).toHaveBeenCalledWith(true);
  });

  it('keeps the grid itself', async () => {
    const g = await drawn();
    g.toggleHidden();
    expect(g.grid).not.toBe(null);
  });
});

describe('renaming', () => {
  it('writes the new title', async () => {
    const g = await drawn();
    put.length = 0;
    g.startRename();
    g.renameText = 'Riverbank';
    g.commitRename();
    await vi.advanceTimersByTimeAsync(700);
    expect(g.grid.title).toBe('Riverbank');
    expect(put.at(-1).body.title).toBe('Riverbank');
  });

  it('an emptied box is not a title', async () => {
    const g = await drawn();
    const was = g.grid.title;
    g.startRename();
    g.renameText = '   ';
    g.commitRename();
    expect(g.grid.title).toBe(was);
  });
});

describe('saving', () => {
  it('debounces a run of marks into one patch', async () => {
    const g = await drawn();
    put.length = 0;
    g.startReview();
    g.markReview('cleared');
    g.markReview('cleared');
    g.markReview('flagged');
    expect(marks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(marks).toHaveLength(1);
  });

  /**
   * The one property that lets two people sweep one area: a marked cell travels
   * as that cell. A whole-spec save carries every other cell with it, so the
   * copy this tab loaded would go back over whatever the extension's panel
   * marked in between — silently, since it is a perfectly valid grid.
   */
  it('sends the cells that were marked and never the sweep around them', async () => {
    const g = await drawn();
    put.length = 0;
    g.startReview();
    g.markReview('cleared');
    await vi.advanceTimersByTimeAsync(700);
    expect(put).toHaveLength(0);
    expect(marks.at(-1).path).toBe(`/api/cases/case-1/search-grids/${g.name}/marks`);
    expect(Object.values(marks.at(-1).body.marks)).toEqual(['cleared']);
  });

  it('a cell cleared back to unchecked is sent as one, not left out', async () => {
    // Clearing a cell is a patch that says "nothing here" — left out of the
    // patch instead, the mark could never be taken back from another surface.
    const g = await drawn();
    const cell = cells()[0];
    cell.onClick(); // unchecked → cleared
    cell.onClick(); // → flagged
    cell.onClick(); // → unchecked again
    await vi.advanceTimersByTimeAsync(700);
    expect(marks.at(-1).body.marks[cell.id]).toBe(null);
    expect(g.grid.statuses[cell.id]).toBe(undefined);
  });

  it('a mark that could not be sent goes back on the patch', async () => {
    const g = await drawn();
    api.post = vi.fn(async () => {
      throw new Error('disk full');
    });
    g.startReview();
    g.markReview('cleared');
    await vi.advanceTimersByTimeAsync(700);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Could not save that mark'),
      'danger',
      expect.any(Number)
    );
    // it is still owed, so the next send carries it
    api.post = vi.fn(async (path, body) => {
      marks.push({ path, body });
      return { name: 'grid-1', revision: ++revision };
    });
    g.markReview('flagged');
    await vi.advanceTimersByTimeAsync(700);
    expect(Object.keys(marks.at(-1).body.marks)).toHaveLength(2);
  });

  it('claims the copy it is replacing, so a stale shape can be refused', async () => {
    const g = await drawn();
    expect(put.at(-1).body).toHaveProperty('base_revision', null); // nothing on disk yet
    const written = revision;
    g.startRename();
    g.renameText = 'Riverbank';
    g.commitRename();
    await vi.advanceTimersByTimeAsync(700);
    // the rename claims what the create wrote, not what was loaded
    expect(put.at(-1).body.base_revision).toBe(written);
  });

  /**
   * A shape refused because the file moved on is not a shape to redo. What moved
   * it was someone marking a cell, and a mark and an outline are separate halves
   * of one file — so both are kept and the file is written once more. The old
   * behaviour here was "reloaded it, redo your last mark", which threw away the
   * area the analyst had just dragged.
   */
  it('puts a reshape on top of marks made elsewhere, keeping both', async () => {
    const g = await drawn();
    put.length = 0;
    const theirs = {
      ...gridSearch.createGrid({ type: 'rect', bounds: AREA }, 500),
      statuses: { '0:0': 'flagged' },
      updated_at: '2026-09-10T11:00:00Z',
      revision: 9,
    };
    api.get = vi.fn(async (path) =>
      path.endsWith('/search-grids') ? [] : theirs
    );
    let refused = true;
    api.put = vi.fn(async (path, body) => {
      put.push({ path, body });
      if (refused) {
        refused = false;
        throw Object.assign(new Error('changed elsewhere'), { status: 409 });
      }
      return { name: 'grid-1', updated_at: '2026-09-10T11:01:00Z', revision: 10 };
    });

    g.startRename();
    g.renameText = 'Riverbank';
    g.commitRename();
    await vi.advanceTimersByTimeAsync(700);

    expect(g.grid.statuses).toEqual({ '0:0': 'flagged' }); // theirs
    expect(g.grid.title).toBe('Riverbank'); // ours
    expect(put.at(-1).body.base_revision).toBe(9); // written on top of their copy
    expect(put.at(-1).body.title).toBe('Riverbank');
  });

  it('says so when a grid cannot be written', async () => {
    api.put = vi.fn(async () => {
      throw new Error('disk full');
    });
    const g = await drawn();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Could not save the grid'),
      'danger',
      expect.any(Number)
    );
  });
});

/**
 * The same sweep, worked from somewhere else at the same time — the app's other
 * tab, or the extension's panel over a map this one cannot see.
 *
 * The nudges are the app's own channel (`api/events.py`, `lib/events.js`) and
 * say only what changed, so every one of them ends in a read. What is asserted
 * here is which nudges are worth a read and what the answer is allowed to do to
 * what the analyst is looking at.
 */
describe('a sweep worked from elsewhere', () => {
  /** A file as another surface left it. */
  function theirs(statuses, rev = 9) {
    return {
      ...gridSearch.createGrid({ type: 'rect', bounds: AREA }, 500),
      statuses,
      updated_at: '2026-09-10T11:00:00Z',
      revision: rev,
    };
  }

  function answers(file) {
    api.get = vi.fn(async (path) =>
      path.endsWith('/search-grids') ? [{ name: 'grid-old', title: 'Old sweep' }] : file
    );
  }

  it('a cell marked elsewhere appears without a reload', async () => {
    const g = await drawn();
    answers(theirs({ '0:0': 'flagged' }));
    dispatch({ type: 'grid-marks', case_id: 'case-1', name: g.name, revision: 9 });
    await vi.waitFor(() => expect(g.grid.statuses).toEqual({ '0:0': 'flagged' }));
  });

  it('its own mark, heard back, costs no read', async () => {
    const g = await drawn();
    const written = revision;
    api.get = vi.fn(async () => theirs({}));
    dispatch({ type: 'grid-marks', case_id: 'case-1', name: g.name, revision: written });
    await vi.advanceTimersByTimeAsync(50);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('a mark still in hand here survives the file arriving', async () => {
    const g = await drawn();
    const mine = cells()[0].id;
    api.post = vi.fn(async () => {
      throw new Error('disk full'); // so it stays unsent, and is the only copy
    });
    cells()[0].onClick();
    await vi.advanceTimersByTimeAsync(700);
    answers(theirs({ '1:1': 'flagged' }));
    dispatch({ type: 'grid-marks', case_id: 'case-1', name: g.name, revision: 9 });
    await vi.waitFor(() => expect(g.grid.statuses['1:1']).toBe('flagged'));
    expect(g.grid.statuses[mine]).toBe('cleared');
  });

  it('an area reshaped elsewhere is taken whole', async () => {
    const g = await drawn();
    const wider = { south: 50.4, north: 50.5, west: 30.5, east: 30.6 };
    answers({
      ...gridSearch.createGrid({ type: 'rect', bounds: wider }, 500),
      statuses: {},
      revision: 9,
    });
    dispatch({ type: 'grid', case_id: 'case-1', name: g.name, revision: 9 });
    await vi.waitFor(() => expect(g.grid.aoi.bounds.north).toBe(wider.north));
  });

  it('a shape of ours that has not landed is not overwritten by the nudge', async () => {
    const g = await drawn();
    answers(theirs({ '0:0': 'flagged' }));
    g.startRename();
    g.renameText = 'Riverbank';
    g.commitRename(); // debounced: the file has not heard about it yet
    dispatch({ type: 'grid-marks', case_id: 'case-1', name: g.name, revision: 9 });
    await vi.advanceTimersByTimeAsync(50);
    expect(g.grid.title).toBe('Riverbank');
  });

  it('a sweep discarded elsewhere closes here, and says so', async () => {
    const g = await drawn();
    dispatch({ type: 'grid-removed', case_id: 'case-1', name: g.name });
    expect(g.grid).toBe(null);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('discarded elsewhere'),
      'warn',
      expect.any(Number)
    );
  });

  it('a grid drawn elsewhere shows up in the picker', async () => {
    const g = await drawn();
    api.get = vi.fn(async (path) =>
      path.endsWith('/search-grids')
        ? [{ name: 'grid-new', title: 'Quay sweep' }]
        : theirs({})
    );
    dispatch({ type: 'grid', case_id: 'case-1', name: 'grid-new', revision: 1 });
    await vi.waitFor(() => expect(g.others.map((e) => e.name)).toContain('grid-new'));
  });

  it('another case is another case', async () => {
    const g = await drawn();
    api.get = vi.fn(async () => theirs({ '0:0': 'flagged' }));
    dispatch({ type: 'grid-marks', case_id: 'case-2', name: g.name, revision: 9 });
    await vi.advanceTimersByTimeAsync(50);
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('switching grids', () => {
  it('sends the marks of the one being left before reading the next', async () => {
    const g = await drawn();
    put.length = 0;
    const leaving = g.name;
    cells()[0].onClick(); // marked, and still inside the debounce
    await g.load('grid-old');
    expect(marks.at(-1).path).toContain(leaving);
    expect(g.name).toBe('grid-old');
  });

  it('leaves a grid nothing changed on alone', async () => {
    // A spec written for nothing bumps the revision, which is how the other
    // surface's pending save gets refused for no reason at all.
    const g = await drawn();
    put.length = 0;
    await g.load('grid-old');
    expect(put).toHaveLength(0);
    expect(marks).toHaveLength(0);
  });

  it('says so when a grid cannot be read, and keeps the one open', async () => {
    const g = await drawn();
    const kept = g.grid;
    api.get = vi.fn(async (path) => {
      if (path.endsWith('/search-grids')) return [];
      throw new Error('gone');
    });
    await g.load('grid-missing');
    expect(g.grid).toBe(kept);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Could not load grid'),
      'danger',
      expect.any(Number)
    );
  });

  it('never offers the open grid as one to switch to', async () => {
    const g = await drawn();
    await g.load('grid-old');
    expect(g.others.map((entry) => entry.name)).not.toContain('grid-old');
  });

  it('discarding writes what is pending, then closes', async () => {
    const g = await drawn();
    put.length = 0;
    cells()[0].onClick();
    await g.discard();
    expect(marks).toHaveLength(1);
    expect(g.grid).toBe(null);
    expect(g.name).toBe(null);
  });

  it('deleting the open grid closes it', async () => {
    const g = await drawn();
    await g.remove(g.name);
    expect(g.grid).toBe(null);
    expect(api.del).toHaveBeenCalled();
  });

  it('deleting another grid leaves the open one alone', async () => {
    const g = await drawn();
    const open = g.name;
    await g.remove('grid-old');
    expect(g.name).toBe(open);
  });

  it('a file already gone is not an error to report', async () => {
    api.del = vi.fn(async () => {
      throw new Error('404');
    });
    const g = await drawn();
    await expect(g.remove('grid-old')).resolves.not.toThrow();
  });
});

describe('a different case', () => {
  it('drops the open grid and reads its own', async () => {
    const g = await drawn();
    currentCase = 'case-2';
    expect(g.forCase('case-2')).toBe(true);
    expect(g.grid).toBe(null);
    expect(g.name).toBe(null);
    await vi.waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/cases/case-2/search-grids')
    );
  });

  it('does nothing at all when the case has not changed', async () => {
    const g = await drawn();
    expect(g.forCase('case-1')).toBe(false);
    expect(g.grid).not.toBe(null);
  });

  it('never writes the old case’s grid into the new one', async () => {
    const g = await drawn();
    put.length = 0;
    g.grid.statuses['0:0'] = 'cleared'; // pending inside the debounce
    currentCase = 'case-2';
    g.forCase('case-2');
    await vi.advanceTimersByTimeAsync(700);
    expect(put).toHaveLength(0);
  });

  it('reads nothing with no case open', async () => {
    const g = await drawn();
    currentCase = undefined;
    g.forCase(undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(g.others).toEqual([]);
  });
});

describe('teardown', () => {
  it('takes its layers off the map and drops a pending write', async () => {
    const g = await drawn();
    put.length = 0;
    g.grid.statuses['0:0'] = 'cleared';
    g.destroy();
    await vi.advanceTimersByTimeAsync(700);
    expect(put).toHaveLength(0);
    for (const l of layers) expect(l.destroy).toHaveBeenCalled();
  });

  it('is safe on a store that never drew anything', () => {
    expect(() => store().destroy()).not.toThrow();
  });
});
