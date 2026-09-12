// @vitest-environment happy-dom
/**
 * The page the app opens on, driven the way somebody opening the app drives it.
 *
 * `lib/overview.test.js` covers the arithmetic. This covers what is only true in a
 * browser: that a count of nothing stops being a control, that pressing a tile hands
 * the Board the same question the number was read from, that a case holding nothing is
 * offered a way in rather than a reading of nothing, and that a workspace with no case
 * asks the backend nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const SUMMARY = {
  total: 30,
  by_type: { place: 6, media: 20, person: 4 },
  by_status: { confirmed: 26, suggested: 4 },
  by_folder: { work: 18 },
  by_source: {},
  linked_to: {},
  unlinked: 7,
  countable: 0,
};

const RECENT = [
  {
    id: 'e1',
    type: 'media',
    label: 'Clip',
    attrs: { kind: 'video' },
    thumb: 'azimut/media/.thumbs/clip.jpg',
    provenance: { at: '2026-09-10T09:00:00Z' },
  },
  { id: 'e2', type: 'place', label: 'Quai sud', attrs: {}, provenance: { at: '2026-09-09T09:00:00Z' } },
];

const SAVED = [
  { id: 'p1', key: 'p1', kind: 'place', title: 'Quai sud', lat: 49.98, lon: 36.25 },
  { id: 'p2', key: 'p2', kind: 'capture', title: 'Depot', lat: 49.99, lon: 36.3 },
];

const PROVIDERS = [
  { id: 'esri-world-imagery', label: 'Esri World Imagery', max_zoom: 19, tile_size: 256, oversample: 1 },
];

// The map of the case is a map, and a test DOM has no canvas to draw one on. What
// it asks `lib/map` for is covered next door (`overview/PlaceMap.render.test.js`);
// here it stands in for itself so the page around it can be driven.
vi.mock('../lib/map/engine.js', () => ({
  createMapEngine: async () => ({ fitPoints: () => true, getZoom: () => 3, destroy: () => {}, impl: {} }),
}));
vi.mock('../lib/map/basemap.js', () => ({
  createBasemaps: () => ({ show: () => {}, dispose: () => {}, setLabels: () => {} }),
}));
vi.mock('../lib/map/surface.js', () => ({
  createSurface: () => ({ set: () => {}, destroy: () => {} }),
}));

/** What the case answers unless a test says otherwise. Re-armed every time, since
 *  clearing a mock leaves the last implementation in place and the next test would
 *  quietly inherit the empty case the one before it asked for. */
const answers = async (url) => {
  if (url === '/api/satellite/providers') return PROVIDERS;
  if (url.includes('/catalog/summary')) return SUMMARY;
  if (url.includes('/timeline')) return { items: [], undated: 3, unplaced: 0, total: 9 };
  if (url.includes('/satellite/index')) return SAVED;
  if (url.includes('since=')) return { items: [], total: 5, next_cursor: null };
  if (url.includes('/catalog/entities')) return { items: RECENT, total: 30, next_cursor: null };
  return {};
};
const get = vi.fn(answers);
vi.mock('../lib/api.js', () => ({ api: { get, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() }, ApiError: Error }));

const createCase = vi.fn(async () => ({ id: 'new' }));
const openCase = vi.fn(async () => {});
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', async () => {
  const fixture = await import('./overview.fixture.svelte.js');
  return {
    caseState: fixture.caseState,
    uiState: fixture.uiState,
    prefs: fixture.prefs,
    updatesState: fixture.updatesState,
    createCase,
    openCase,
    toast,
  };
});

const setAnalysisFilter = vi.fn();
const leaveAnalysisView = vi.fn();
vi.mock('../lib/analysisSearch.svelte.js', () => ({ setAnalysisFilter, leaveAnalysisView }));

const openEntity = vi.fn();
vi.mock('../lib/navigate.js', () => ({ openEntity }));

// The registry is served by the backend and never loaded here, so the families it
// would answer with are stated instead: without them every type falls into "other"
// and the band under test draws one bar.
vi.mock('../lib/entityTypes.svelte.js', async (importOriginal) => ({
  ...(await importOriginal()),
  entityFamily: (type) => ({ place: 'place', media: 'collected', person: 'actor' })[type] ?? null,
}));

const { default: Overview } = await import('./Overview.svelte');
const { caseState, prefs, uiState, updatesState, resetOverviewFixture } = await import(
  './overview.fixture.svelte.js'
);

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Overview, { target });
  flushSync();
  await settle();
  return target;
}

/** The waiting tiles, as `[label, count, pressable]`. */
const waiting = () =>
  [...target.querySelectorAll('.tiles .tile')].map((tile) => [
    tile.querySelector('.say-label').textContent.trim(),
    tile.querySelector('.n').textContent.trim(),
    !tile.disabled,
  ]);

const pressRow = async (label) => {
  const row = [...target.querySelectorAll('.tile, .row')].find(
    (candidate) => candidate.querySelector('.say-label')?.textContent.trim() === label
  );
  row.click();
  flushSync();
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(answers);
  resetOverviewFixture();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
  document.body.innerHTML = '';
});

describe('with a case open', () => {
  beforeEach(() => {
    caseState.current = { id: 'case-a', name: 'Kharkiv strike', updated_at: '2026-09-10T08:00:00Z' };
    caseState.list = [{ id: 'case-a', name: 'Kharkiv strike', updated_at: '2026-09-11T08:00:00Z' }];
  });

  it('prices each waiting row off the payload that holds it', async () => {
    await open();
    expect(waiting()).toEqual([
      ['To review', '4', true],
      ['Nothing linked yet', '7', true],
      ['Unfiled', '12', true],
      ['No date yet', '3', true],
    ]);
  });

  it('reads the case with five bounded requests and no more', async () => {
    await open();
    const asked = get.mock.calls.map(([url]) => url);
    const paths = asked.filter((url) => url.startsWith('/api/cases/'));
    expect(paths).toHaveLength(5);
    // every one of them capped, counting, or the compact index the map panel already
    // opens on — never a whole-graph read
    expect(paths.filter((url) => url.includes('limit=')).length).toBe(3);
    expect(paths.every((url) => url.startsWith('/api/cases/case-a/'))).toBe(true);
    // and the one read that is not the case's own: which basemap the map of the
    // case draws, asked once by the map itself
    expect(asked.filter((url) => !url.startsWith('/api/cases/'))).toEqual([
      '/api/satellite/providers',
    ]);
  });

  it('stops being a control where the answer is nothing', async () => {
    // a zero is the answer; offering a press that lands on an empty table asks the
    // analyst to go and confirm what the page already told them
    get.mockImplementation(async (url) => {
      if (url.includes('/catalog/summary')) return { ...SUMMARY, by_status: {} };
      if (url.includes('/timeline')) return { undated: 3 };
      if (url.includes('since=')) return { items: [], total: 0 };
      if (url.includes('/catalog/entities')) return { items: [], total: 0, next_cursor: null };
      return {};
    });
    await open();
    expect(waiting()[0]).toEqual(['To review', '0', false]);
    expect(waiting()[3]).toEqual(['No date yet', '3', true]);
  });

  it('says a clear case in one line rather than four zeros', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/catalog/summary')) {
        return { ...SUMMARY, total: 18, by_status: {}, by_folder: { work: 18 }, unlinked: 0 };
      }
      if (url.includes('/timeline')) return { undated: 0 };
      if (url.includes('/satellite/index')) return [];
      return { items: [], total: 0, next_cursor: null };
    });
    await open();
    expect(target.querySelectorAll('.tiles .tile')).toHaveLength(0);
    // and it says it about the four questions, not about the case: a case is never
    // finished, so nothing here may read as a case that is
    expect(target.textContent).toContain('Nothing waiting on these four right now.');
  });

  it('offers a way in rather than a reading of nothing, on a case holding nothing', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/catalog/summary')) return { ...SUMMARY, total: 0, by_type: {}, by_status: {}, by_folder: {}, unlinked: 0 };
      if (url.includes('/timeline')) return { undated: 0 };
      if (url.includes('/satellite/index')) return [];
      return { items: [], total: 0, next_cursor: null };
    });
    await open();
    expect(target.querySelector('.tiles')).toBeNull();
    expect(target.textContent).toContain('Nothing in this case yet');
    const steps = [...target.querySelectorAll('.step')];
    expect(steps).toHaveLength(3);
    steps[0].click();
    flushSync();
    expect(uiState.tool).toBe('media');
  });

  it('draws the case by family in the hues the Graph gives those families', async () => {
    await open();
    const bars = [...target.querySelectorAll('.bars li')];
    expect(bars.map((bar) => bar.querySelector('strong').textContent)).toEqual(['20', '6', '4']);
    // the widest bar is the biggest family, and every bar carries its family's token
    expect(bars[0].getAttribute('style')).toContain('--graph-');
    expect(bars[0].querySelector('.track i').getAttribute('style')).toContain('100%');
  });

  it('puts the case on a map, and presses through to the tool that works it', async () => {
    await open();
    expect(target.querySelector('.area-places .plate')).not.toBeNull();
    expect(target.textContent).toContain('2 points on the map');
    target.querySelector('.plate .foot').click();
    flushSync();
    expect(uiState.tool).toBe('satellite');
  });

  it('leaves the map out, and the shoulder filled, when nothing is placed', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/satellite/index')) return [];
      return answers(url);
    });
    await open();
    expect(target.querySelector('.plate')).toBeNull();
    expect(target.querySelector('.grid').classList.contains('flat')).toBe(true);
  });

  it('shows the case its own pictures where the catalog attached one', async () => {
    await open();
    const shot = target.querySelector('.row.thin .glyph img');
    expect(shot.getAttribute('src')).toBe('/files/case-a/azimut/media/.thumbs/clip.jpg');
  });

  it('hands the Board the same question the number was read from', async () => {
    await open();
    await pressRow('To review');
    expect(leaveAnalysisView).toHaveBeenCalledWith('case-a', 'board');
    const [, filter] = setAnalysisFilter.mock.calls.at(-1);
    expect(filter.status).toBe('suggested');
    expect(uiState.tool).toBe('board');
  });

  it('sends the undated row to the Timeline, which is what answers it', async () => {
    await open();
    await pressRow('No date yet');
    expect(setAnalysisFilter).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('timeline');
  });

  it('prefers the list stamp, which is recomputed off the database', async () => {
    await open();
    // the manifest says 10 September, the list says the 11th
    expect(target.querySelector('.meta span').title).toContain('2026-09-11');
  });

  it('opens a recent row in whatever tool owns it', async () => {
    await open();
    const row = [...target.querySelectorAll('.row.thin')][0];
    row.click();
    flushSync();
    expect(openEntity).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });
});

describe('what the startup checks left on the page', () => {
  beforeEach(() => {
    caseState.current = { id: 'case-a', name: 'Kharkiv strike' };
  });

  it('says nothing at all when both checks came back happy', async () => {
    await open();
    expect(target.querySelector('.notice')).toBeNull();
    expect(target.querySelector('.notice-line')).toBeNull();
  });

  it('unfolds the release body the check already brought back', async () => {
    updatesState.app = {
      update_available: true,
      latest: 'v0.3.0',
      url: 'https://example.invalid/releases',
      notes: '## Fixed\n- a thing that was broken',
    };
    await open();
    const card = target.querySelector('.notice');
    expect(card.textContent).toContain('Azimut v0.3.0 is available');
    // folded until asked for: a landing page is not where somebody else's changelog
    // sits open
    expect(target.querySelector('.notes')).toBeNull();
    card.querySelector('.notice-head').click();
    flushSync();
    expect(target.querySelector('.notes').textContent).toContain('a thing that was broken');
    expect(card.querySelector('a').getAttribute('href')).toBe('https://example.invalid/releases');
  });

  it('never checks anything itself, so a muted release leaves no card', async () => {
    updatesState.app = { update_available: true, latest: 'v0.3.0', notes: 'x' };
    prefs.updateDismissedVersion = 'v0.3.0';
    await open();
    expect(target.querySelector('.notice')).toBeNull();
  });

  it('points an uninstalled extension at the tab that installs it', async () => {
    updatesState.extensionBundled = '0.2.0';
    updatesState.extensionInstalled = null;
    await open();
    const line = target.querySelector('.notice-line');
    expect(line.textContent).toContain('capture extension is not installed');
    line.click();
    flushSync();
    expect(uiState.tool).toBe('settings');
    expect(uiState.settingsTab).toBe('extension');
  });

  it('says nothing about an extension that is already loaded', async () => {
    updatesState.extensionBundled = '0.2.0';
    updatesState.extensionInstalled = '0.2.0';
    await open();
    expect(target.querySelector('.notice-line')).toBeNull();
  });
});

describe('with no case open', () => {
  it('asks the backend nothing, because there is nothing to summarise', async () => {
    await open();
    expect(get).not.toHaveBeenCalled();
  });

  it('is the front door instead of an empty reading', async () => {
    await open();
    expect(target.querySelector('.door')).toBeTruthy();
    expect(target.querySelectorAll('.stage')).toHaveLength(4); // the rail, as a sequence
    expect(target.textContent).toContain('Nothing leaves this machine.');
  });

  it('names the first case from the door itself', async () => {
    await open();
    const field = target.querySelector('#home-case-name');
    field.value = 'Kharkiv strike';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const create = [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create');
    expect(create.disabled).toBe(false);
    create.click();
    await settle();
    expect(createCase).toHaveBeenCalledWith('Kharkiv strike');
  });

  it('refuses to create a case with no name', async () => {
    await open();
    const create = [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create');
    expect(create.disabled).toBe(true);
  });

  it('offers the cases the workspace already holds', async () => {
    caseState.list = [
      { id: 'case-a', name: 'Kharkiv strike', updated_at: '2026-09-01T00:00:00Z' },
      { id: 'case-b', name: 'Odesa port', updated_at: '2026-08-01T00:00:00Z' },
    ];
    await open();
    const chips = [...target.querySelectorAll('.chip')];
    expect(chips.map((chip) => chip.querySelector('span').textContent)).toEqual([
      'Kharkiv strike',
      'Odesa port',
    ]);
    chips[1].click();
    flushSync();
    expect(openCase).toHaveBeenCalledWith('case-b');
  });
});
