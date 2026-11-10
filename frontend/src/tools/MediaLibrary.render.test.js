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
const del = vi.fn();
vi.mock('../lib/api.js', () => ({
  api: { get, post, del, patch: vi.fn(), put: vi.fn() },
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

const { pinNote } = await import('../lib/notes/putInNote.svelte.js');
const { sceneQueue } = await import('../lib/geolocating.svelte.js');
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
  const MARK = 'Mark to geolocate';

  describe('marking to geolocate', () => {
    const scene = (extra = {}) => ({ id: 'sc_1', start: null, end: null, state: 'todo', ...extra });
    const answer = (route) => post.mockImplementation(async (url, body) => route(url, body));

    beforeEach(() => {
      Object.assign(sceneQueue, { caseId: null, files: null, busy: false, error: '' });
      post.mockClear();
      del.mockClear();
      toast.mockClear();
      uiState.sidebarOpen = false;
      uiState.sidebarView = 'folders';
    });

    afterEach(() => post.mockImplementation(async () => ({ queued: 1 })));

    it('marks the row it was opened on, says so, and Show opens the To-do', async () => {
      answer(() => ({ scene: scene() }));
      await open();
      await press(doorOf('media/quai.jpg'));
      await press(choice(MARK));
      await settle();

      expect(post).toHaveBeenCalledWith('/api/cases/case-a/scenes/mark', { path: 'media/quai.jpg', label: '' });
      expect(document.querySelector('.open-in-menu')).toBeNull();
      const [message, kind, , action] = toast.mock.calls[0];
      expect([message, kind, action.label]).toEqual(['Marked to geolocate', 'ok', 'Show']);
      action.onClick();
      expect(uiState).toMatchObject({ sidebarOpen: true, sidebarView: 'todo' });
    });

    it('says a video is marked whole', async () => {
      answer(() => ({ scene: scene() }));
      await open();
      await press(doorOf('media/clip.mp4'));
      await press(choice(MARK));
      await settle();
      expect(toast.mock.calls[0][0]).toBe('Whole video marked to geolocate');
    });

    it('leaves a capture and a frame of a video out of the menu', async () => {
      page = {
        ...page,
        items: [
          { ...ITEMS[0], path: 'media/map.png', source: { type: 'satellite' } },
          { ...ITEMS[0], path: 'media/frame.png', source: { type: 'inspect', op: 'frame', from: 'media/clip.mp4', time: 3 } },
        ],
      };
      await open();
      // made here, so behind the working-files switch
      await press(target.querySelector('.gps-filter[aria-pressed="false"][title^="Show the"]'));
      await press(doorOf('media/map.png'));
      expect(choices()).toEqual(['Inspect', 'Reverse Search', 'Geo Proof']);
      await press(document.querySelector('.open-in-backdrop'));
      await press(doorOf('media/frame.png'));
      expect(choices()).toEqual(['Inspect', 'Reverse Search', 'Geo Proof']);
    });

    it('offers no mark on a file with no tool to go to', async () => {
      page = { ...page, items: [{ ...ITEMS[0], path: 'media/map.pdf', kind: 'file' }] };
      await open();
      expect(doors()).toHaveLength(0);
    });

    it('says a file already in the list is marked, and shows the list with no second mark', async () => {
      Object.assign(sceneQueue, {
        caseId: 'case-a',
        files: [{ video: 'media/quai.jpg', title: 'quai', kind: 'image', scenes: [scene()] }],
      });
      await open();
      await press(doorOf('media/quai.jpg'));
      expect(choices()).toContain('Marked to geolocate');
      await press(choice('Marked to geolocate'));
      await settle();
      expect(post).not.toHaveBeenCalledWith('/api/cases/case-a/scenes/mark', expect.anything());
      expect(uiState).toMatchObject({ sidebarOpen: true, sidebarView: 'todo' });
    });

    it('still marks a video the whole of which is not in the list yet', async () => {
      Object.assign(sceneQueue, {
        caseId: 'case-a',
        files: [{ video: 'media/clip.mp4', title: 'clip', kind: 'video', scenes: [scene({ start: 12 })] }],
      });
      await open();
      await press(doorOf('media/clip.mp4'));
      expect(choices()).toContain(MARK);
    });

    it('takes up a file marked after being given up on', async () => {
      answer(() => ({ scene: scene({ state: 'abandoned' }) }));
      del.mockResolvedValue({ scene: scene() });
      await open();
      await press(doorOf('media/quai.jpg'));
      await press(choice(MARK));
      await settle();
      expect(del).toHaveBeenCalledWith('/api/cases/case-a/scenes/sc_1/abandon?video=media%2Fquai.jpg');
      expect(toast.mock.calls[0][0]).toBe('Marked to geolocate again');
    });

    it('says calmly why the server refused', async () => {
      answer(() => {
        throw new Error("a frame cut from a video belongs to its video's scenes");
      });
      await open();
      await press(doorOf('media/quai.jpg'));
      await press(choice(MARK));
      await settle();
      expect(toast).toHaveBeenCalledWith("A frame cut from a video belongs to its video's scenes", 'warn');
    });
  });

  it('keeps the tools behind one door per row instead of a button each', async () => {
    await open();
    expect(doors()).toHaveLength(2);
    expect(target.querySelector('[title="Open in Inspect"]')).toBeNull();
    expect(target.querySelector('[title="Send to Geo Proof"]')).toBeNull();
  });

  it('offers Geo Proof for a picture and not for a video', async () => {
    await open();
    await press(doorOf('media/quai.jpg'));
    expect(choices()).toEqual(['Inspect', 'Reverse Search', 'Geo Proof', MARK]);

    await press(doorOf('media/clip.mp4'));
    expect(choices()).toEqual(['Inspect', 'Reverse Search', MARK]);
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

  it('quotes a downloaded post in the pinned note, and only one whose words were kept', async () => {
    page = {
      ...page,
      items: [
        { ...ITEMS[0], entity_id: 'e_quai', source: { type: 'upload' } },
        {
          ...ITEMS[1],
          entity_id: 'e_clip',
          title: 'clip',
          source: { type: 'download', url: 'https://t.me/portnews/412', description: 'Smoke over the port', upload_date: '20260312' },
        },
      ],
    };
    await open();
    await press(doorOf('media/clip.mp4'));
    // no note pinned: the door holds the tools and nothing else
    expect(choices()).toEqual(['Inspect', 'Reverse Search', MARK]);
    await press(document.querySelector('.open-in-backdrop'));

    const unpin = pinNote({ caseId: 'case-a', noteId: 'n1', title: 'Port strike', editor: {} });
    try {
      await press(doorOf('media/clip.mp4'));
      expect(choices()).toEqual(['Inspect', 'Reverse Search', MARK, 'Quote the post in “Port strike”']);
      await press(document.querySelector('.open-in-backdrop'));
      await press(doorOf('media/quai.jpg'));
      expect(choices()).toEqual(['Inspect', 'Reverse Search', 'Geo Proof', MARK]);
    } finally {
      unpin();
    }
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

describe('opening a file from its card', () => {
  const thumb = (path) => target.querySelector(`.media-card[data-path="${path}"] .thumb`);
  const viewer = () => document.querySelector('.viewer');

  beforeEach(() => localStorage.clear());

  it('opens a video full screen on one press, as a picture does', async () => {
    await open();
    await press(thumb('media/clip.mp4'));
    expect(viewer().querySelector('video').getAttribute('src')).toContain('media/clip.mp4');
    await key('ArrowLeft');
    expect(viewer().querySelector('img').getAttribute('src')).toContain('media/quai.jpg');
    await key('Escape');
    expect(viewer()).toBeNull();
  });

  it('retries a failed thumbnail without opening the file under it', async () => {
    await open();
    await press(thumb('media/clip.mp4').querySelector('.thumb-retry'));
    expect(viewer()).toBeNull();
  });

  it('opens again on the view it was left on', async () => {
    await open();
    await press([...target.querySelectorAll('.view-btn')].find((b) => b.textContent.includes('List')));
    unmount(live);
    target.remove();
    await open();
    const active = target.querySelector('.view-btn.active');
    expect(active.textContent).toContain('List');
  });
});

describe('the Unused switch', () => {
  const unusedButton = () =>
    [...target.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Unused'));

  it('is offered only once the case holds a file nothing uses', async () => {
    await open();
    expect(unusedButton()).toBeUndefined();
  });

  it('counts those files and asks the server for them alone', async () => {
    page = { ...page, facets: { unused_count: 1 } };
    await open();
    expect(unusedButton().textContent.trim()).toBe('Unused (1)');
    expect(unusedButton().getAttribute('aria-pressed')).toBe('false');

    page = { ...page, items: [ITEMS[1]], total: 1 };
    await press(unusedButton());

    expect(get.mock.calls.at(-1)[0]).toContain('unused=true');
    expect(unusedButton().getAttribute('aria-pressed')).toBe('true');
    expect(target.textContent).toContain('clip.mp4');
    expect(target.textContent).not.toContain('quai.jpg');
  });

  it('asks the server for every file again when the filters are reset', async () => {
    page = { ...page, facets: { unused_count: 1 } };
    await open();
    await press(unusedButton());
    get.mockClear();

    await press(target.querySelector('.reset-filters'));

    expect(get).toHaveBeenCalled();
    expect(get.mock.calls.at(-1)[0]).not.toContain('unused=true');
  });

  it('asks the delete what else it touches before it is confirmed', async () => {
    await open();
    await press(target.querySelector('.del'));

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/delete-impact', {
      ids: [], paths: [expect.stringMatching(/^media\//)], named: [],
    });
  });
});

describe('Show in Media, from another tool', () => {
  const CLIP = 'media/clip 0m01s–0m02s.mp4';

  afterEach(() => {
    uiState.focusMedia = null;
    get.mockImplementation(async (url) => {
      if (url.includes('/media/page')) return page;
      if (url.includes('/entity-types')) return [];
      return {};
    });
  });

  it('lets a file the case made itself through the working-files switch, so the highlight finds it', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/media/page')) return page;
      if (url.includes('/media/item')) return { path: CLIP, kind: 'video', source: { type: 'inspect', op: 'clip' } };
      return [];
    });
    uiState.focusMedia = CLIP;
    await open();
    await settle();

    expect(get).toHaveBeenCalledWith(`/api/cases/case-a/media/item?path=${encodeURIComponent(CLIP)}`);
    expect(get.mock.calls.at(-1)[0]).toContain('/media/page');
    expect(get.mock.calls.at(-1)[0]).not.toContain('collected_only=true');
  });

  it('leaves the switch alone for a file the case collected', async () => {
    get.mockImplementation(async (url) => {
      if (url.includes('/media/page')) return page;
      if (url.includes('/media/item')) return { path: 'media/quai.jpg', kind: 'image', source: { type: 'upload' } };
      return [];
    });
    uiState.focusMedia = 'media/quai.jpg';
    await open();
    await settle();

    const pages = get.mock.calls.map(([url]) => url).filter((url) => url.includes('/media/page'));
    expect(pages.every((url) => url.includes('collected_only=true'))).toBe(true);
  });
});
