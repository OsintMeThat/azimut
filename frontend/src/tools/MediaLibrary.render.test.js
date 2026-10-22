// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The header's upkeep menu, driven the way an analyst drives it.
 *
 * `MediaLibrary.test.js` reads the source for what the tool is wired to. This
 * one presses the `⋮`, because the two failures that matter here — a row that
 * sends the other row's sweep, and a menu that closes before its row fires —
 * both read as correct wiring in the source.
 */

const ITEMS = [
  {
    path: 'media/quai.jpg',
    filename: 'quai.jpg',
    kind: 'image',
    size: 1024,
    folder: '',
    added_at: '2026-08-01T10:00:00Z',
    sha256: '1'.repeat(64),
    thumbnail: 'media/.thumbs/quai-g2.jpg',
    thumb_state: 'ready',
    enrich_state: 'ready',
  },
  {
    path: 'media/clip.mp4',
    filename: 'clip.mp4',
    kind: 'video',
    size: 2048,
    folder: '',
    added_at: '2026-08-02T10:00:00Z',
    sha256: '2'.repeat(64),
    thumbnail: null,
    thumb_state: 'failed',
    enrich_state: 'none',
  },
];

let page = { items: ITEMS, total: ITEMS.length, next_cursor: null, facets: {} };

const get = vi.fn(async (url) => {
  if (url.includes('/media/page')) return page;
  if (url.includes('/entity-types')) return [];
  return {};
});
const post = vi.fn(async () => ({ queued: 1 }));
vi.mock('../lib/api.js', () => ({
  api: { get, post, del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: Error,
}));

const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
const ensureCase = vi.fn(async () => ({ id: 'case-a' }));
const uiState = { tool: 'media', focusMedia: null, composeQueue: [], inspectPath: null };
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, uiState, ensureCase, reloadCase, toast, fmtCoords: (v) => String(v) };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: MediaLibrary } = await import('./MediaLibrary.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MediaLibrary, { target });
  flushSync();
  await settle();
  return target;
}

const toggle = () => target.querySelector('.upkeep-toggle');
const menu = () => target.querySelector('.upkeep-menu');
const rows = () => [...target.querySelectorAll('.upkeep-option')];
const row = (label) => rows().find((r) => r.textContent.trim().includes(label));

async function press(element) {
  element.click();
  flushSync();
  await settle();
}

async function key(name) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  flushSync();
  await settle();
}

beforeEach(() => {
  page = { items: ITEMS, total: ITEMS.length, next_cursor: null, facets: {} };
  uiState.tool = 'media';
  uiState.reverseTarget = null;
  uiState.inspectPath = null;
  uiState.composeQueue = [];
  vi.clearAllMocks();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the upkeep menu', () => {
  it('keeps both sweeps behind one door, and shows no bare buttons for them', async () => {
    await open();

    expect(toggle()).not.toBeNull();
    expect(menu()).toBeNull(); // closed until asked for
    const labels = [...target.querySelectorAll('.tool-header button')].map((b) =>
      b.textContent.trim()
    );
    expect(labels).not.toContain('Thumbnails');
    expect(labels).not.toContain('Enrich');
  });

  it('opens on the door and lists the two sweeps', async () => {
    await open();
    await press(toggle());

    expect(menu()).not.toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(rows().map((r) => r.textContent.trim())).toEqual([
      'Regenerate missing thumbnails',
      'Read file metadata',
    ]);
  });

  it('sends the thumbnail sweep for the whole case, not for one file', async () => {
    await open();
    await press(toggle());
    await press(row('Regenerate missing thumbnails'));

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/media/thumbnails/regenerate', {});
    expect(menu()).toBeNull(); // the menu never hangs over the request it sent
  });

  it('sends the metadata sweep', async () => {
    await open();
    await press(toggle());
    await press(row('Read file metadata'));

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/media/enrich', {});
    expect(menu()).toBeNull();
  });

  it('closes on the backdrop and on Escape, sending nothing', async () => {
    await open();

    await press(toggle());
    await press(target.querySelector('.upkeep-backdrop'));
    expect(menu()).toBeNull();

    await press(toggle());
    await key('Escape');
    expect(menu()).toBeNull();

    expect(post).not.toHaveBeenCalled();
  });

  it('leaves the door in place on a case with no media, with both rows refused', async () => {
    page = { items: [], total: 0, next_cursor: null, facets: {} };
    await open();
    await press(toggle());

    expect(toggle().disabled).toBe(false);
    expect(rows().map((r) => r.disabled)).toEqual([true, true]);
  });
});

describe('open in… from a row', () => {
  const doors = () => [...target.querySelectorAll('[title="Open in…"]')];
  const doorOf = (path) => doors().find((b) => b.closest('[data-path]')?.dataset.path === path);
  const choices = () =>
    [...document.querySelectorAll('.open-in-menu [role="menuitem"]')].map((b) => b.textContent.trim());
  const choice = (label) =>
    [...document.querySelectorAll('.open-in-menu [role="menuitem"]')].find((b) => b.textContent.trim() === label);

  it('keeps the tools behind one door per row instead of a button each', async () => {
    await open();
    expect(doors()).toHaveLength(2);
    expect(target.querySelector('[title="Open in Inspect"]')).toBeNull();
    expect(target.querySelector('[title="Send to Geo Proof"]')).toBeNull();
  });

  it('offers Geo Proof for a picture and not for a video', async () => {
    await open();
    await press(doorOf('media/quai.jpg'));
    expect(choices()).toEqual(['Inspect', 'Reverse Search', 'Geo Proof']);

    await press(doorOf('media/clip.mp4'));
    expect(choices()).toEqual(['Inspect', 'Reverse Search']);
  });

  it('hands Reverse Search the row it was opened on, and closes', async () => {
    // By the row rather than by position: the list is sorted, and the failure
    // worth catching is a menu that sends the other row's file.
    await open();
    await press(doorOf('media/clip.mp4'));
    await press(choice('Reverse Search'));

    expect(uiState.tool).toBe('reverse');
    expect(uiState.reverseTarget).toEqual({
      path: 'media/clip.mp4',
      blob: null,
      kind: 'video',
      label: 'clip.mp4',
      time: null,
    });
    expect(document.querySelector('.open-in-menu')).toBeNull();
  });

  it('still reaches Inspect and Geo Proof', async () => {
    await open();
    await press(doorOf('media/quai.jpg'));
    await press(choice('Inspect'));
    expect(uiState.tool).toBe('inspect');
    expect(uiState.inspectPath).toBe('media/quai.jpg');

    await press(doorOf('media/quai.jpg'));
    await press(choice('Geo Proof'));
    expect(uiState.tool).toBe('proof');
    expect(uiState.composeQueue).toContain('media/quai.jpg');
  });

  it('closes on the backdrop and on Escape without going anywhere', async () => {
    await open();
    await press(doorOf('media/quai.jpg'));
    await press(document.querySelector('.open-in-backdrop'));
    expect(document.querySelector('.open-in-menu')).toBeNull();

    await press(doorOf('media/quai.jpg'));
    await key('Escape');
    expect(document.querySelector('.open-in-menu')).toBeNull();
    expect(uiState.tool).toBe('media');
  });

  it('opens toward the side with room, so a card by the rail does not hang over it', async () => {
    const rect = (left, right) => () => ({ left, right, top: 300, bottom: 330, width: right - left, height: 30 });
    await open();

    const door = doorOf('media/quai.jpg');
    door.getBoundingClientRect = rect(160, 190);
    await press(door);
    let menu = document.querySelector('.open-in-menu');
    expect(menu.style.left).toBe('160px');
    expect(menu.style.right).toBe('');

    await press(door); // closes
    door.getBoundingClientRect = rect(window.innerWidth - 60, window.innerWidth - 30);
    await press(door);
    menu = document.querySelector('.open-in-menu');
    expect(menu.style.right).toBe('30px');
    expect(menu.style.left).toBe('');
  });

  it('gives a document no door', async () => {
    page = {
      items: [{ ...ITEMS[0], path: 'media/plan.pdf', filename: 'plan.pdf', kind: 'file', thumbnail: null }],
      total: 1,
      next_cursor: null,
      facets: {},
    };
    await open();
    expect(doors()).toHaveLength(0);
  });
});

describe('the worklist of what was brought in', () => {
  const routes = get.getMockImplementation();
  const posts = post.getMockImplementation();
  afterEach(() => {
    get.mockImplementation(routes);
    post.mockImplementation(posts);
    uiState.openSheet = null;
  });

  const worklistButton = () =>
    [...target.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Worklist');

  it('opens the worklist the case already has', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/media/page')) return page;
      if (url.endsWith('/sheets/from-case/files')) return { total: 2, answered: 0, sheet: 'e_list' };
      return {};
    });
    await open();

    await press(worklistButton());

    expect(post).not.toHaveBeenCalledWith('/api/cases/case-a/sheets/from-case', expect.anything());
    expect(uiState.openSheet).toBe('e_list');
    expect(uiState.tool).toBe('sheet');
  });

  it('builds it on the first press', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/media/page')) return page;
      if (url.endsWith('/sheets/from-case/files')) return { total: 2, answered: 0, sheet: null };
      return {};
    });
    post.mockImplementation(async (url) =>
      url.endsWith('/sheets/from-case') ? { id: 'e_new', taken: 2, total: 2 } : { queued: 1 },
    );
    await open();

    await press(worklistButton());

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/sheets/from-case', {
      title: 'Files to geolocate',
      shape: 'files',
    });
    expect(uiState.openSheet).toBe('e_new');
    expect(uiState.tool).toBe('sheet');
  });
});

describe('dragging a file out, and files in', () => {
  function drag(type, data = {}, extra = {}) {
    const store = { ...data };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        get types() {
          return Object.keys(store);
        },
        setData: (key, value) => (store[key] = value),
        getData: (key) => store[key] ?? '',
        effectAllowed: 'all',
        files: [],
      },
    });
    for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
    return event;
  }
  const card = () => target.querySelector('.media-card[data-path="media/quai.jpg"]');
  const zone = () => target.querySelector('.tool');
  const overlay = () => target.querySelector('.drop-overlay');

  it('hands the card to a folder of the sidebar, picture and all', async () => {
    await open();
    expect(card().getAttribute('draggable')).toBe('true');
    // the card is what moves, not the bare thumbnail the browser would drag
    expect(card().querySelector('img').getAttribute('draggable')).toBe('false');
    const start = drag('dragstart');
    card().dispatchEvent(start);
    flushSync();
    expect(JSON.parse(start.dataTransfer.getData('application/x-azimut-media'))).toEqual([
      { path: 'media/quai.jpg', title: 'quai.jpg', folder: '' },
    ]);
    expect(card().classList.contains('dragging')).toBe(true);
    card().dispatchEvent(new Event('dragend', { bubbles: true }));
    flushSync();
    expect(card().classList.contains('dragging')).toBe(false);
  });

  it('leaves a drag that starts on a link inside the card to the link', async () => {
    await open();
    const start = drag('dragstart');
    card().querySelector('a[title="Open file"]').dispatchEvent(start);
    flushSync();
    expect(start.dataTransfer.types).toEqual([]);
    expect(card().classList.contains('dragging')).toBe(false);
  });

  it('raises no import overlay for a picture dragged out of the page', async () => {
    await open();
    const inPage = { Files: '', 'text/uri-list': 'x', 'application/x-azimut-page': '1' };
    const over = drag('dragover', inPage);
    zone().dispatchEvent(over);
    flushSync();
    expect(over.defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
    const drop = drag('drop', inPage);
    zone().dispatchEvent(drop);
    flushSync();
    await settle();
    expect(drop.defaultPrevented).toBe(false);
    expect(target.textContent).not.toContain('Import 1 file');
  });

  it('raises it for a desktop file and lowers it once the file leaves', async () => {
    await open();
    zone().dispatchEvent(drag('dragover', { Files: '' }));
    flushSync();
    expect(overlay()).not.toBeNull();
    // crossing onto the overlay itself is not leaving
    zone().dispatchEvent(drag('dragleave', { Files: '' }, { relatedTarget: overlay() }));
    flushSync();
    expect(overlay()).not.toBeNull();
    // over to the sidebar: the overlay used to stay up here
    zone().dispatchEvent(drag('dragleave', { Files: '' }, { relatedTarget: document.body }));
    flushSync();
    expect(overlay()).toBeNull();
  });

  it('lowers it when the drag is called off or leaves the window', async () => {
    await open();
    zone().dispatchEvent(drag('dragover', { Files: '' }));
    flushSync();
    overlay().dispatchEvent(drag('dragleave', { Files: '' }, { relatedTarget: null }));
    flushSync();
    expect(overlay()).toBeNull();
  });
});
