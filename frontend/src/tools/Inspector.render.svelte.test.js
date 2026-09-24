// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Inspect driven the way an analyst drives it: open a file, change something,
 * come back to it. The work is saved as it is made, so what these check is what
 * reaches the server and when.
 */

const MEDIA = [
  { path: 'media/roof.png', kind: 'image', title: 'Roof', filename: 'roof.png', entity_id: 'e_roof', source: { type: 'upload' } },
  { path: 'media/clip.mp4', kind: 'video', title: 'Convoy clip', filename: 'clip.mp4', entity_id: 'e_clip', source: { type: 'download' } },
];
let media = MEDIA;
const OPS = {
  filters: [
    { id: 'brightness', label: 'Brightness', params: [{ name: 'value', default: 1, min: 0, max: 2, step: 0.05 }], css: 'brightness({v})' },
  ],
  analyses: [],
};
const frame = (id, time) => ({
  id, path: 'media/clip.mp4', time, adjust: { brightness: 1 }, crop: null, sourceOps: [], rotation: 0, w: 640, h: 360, filed: null,
});

let saved = {};
let works = [];

const get = vi.fn(async (path) => {
  if (path === '/api/inspect/ops') return structuredClone(OPS);
  if (path === '/api/cases/case-a/media') return structuredClone(media);
  if (path === '/api/cases/case-a/inspect/works') return structuredClone(works);
  if (path.startsWith('/api/cases/case-a/inspect/probe')) {
    return path.includes('clip') ? { kind: 'video', duration: 20, fps: 25, width: 640, height: 360 } : { kind: 'image', width: 80, height: 60 };
  }
  if (path.startsWith('/api/cases/case-a/inspect/work?path=')) {
    const file = decodeURIComponent(path.split('path=')[1]);
    return { work: saved[file] ? structuredClone(saved[file]) : null };
  }
  if (path.startsWith('/api/cases/case-a/inspect/works/')) {
    const name = decodeURIComponent(path.split('/works/')[1]);
    const found = Object.values(saved).find((w) => w.name === name);
    if (!found) throw Object.assign(new Error('nothing was inspected under that name'), { status: 404 });
    return structuredClone(found);
  }
  return {};
});
const put = vi.fn(async (path, body) => ({ name: body.path.includes('roof') ? 'Roof' : 'Convoy clip', title: 'x' }));
const post = vi.fn(async () => ({ saved: [] }));
const del = vi.fn(async () => ({ status: 'deleted', deleted: ['e_work'], trash: 'g_1' }));
const patch = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, put, post, del, patch } }));

// Reactive, so a change made elsewhere in the case can reach the open file.
const caseState = $state({ current: { id: 'case-a', folders: [] }, rev: 0 });
const uiState = { tool: 'inspect', inspectPath: null, openInspect: null, focusMedia: null };
const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast, reloadCase }));
vi.mock('../lib/navigate.js', () => ({ openInReverseSearch: vi.fn() }));
const deletedToast = vi.fn();
vi.mock('../lib/trash.js', () => ({ deletedToast }));

const { default: Inspector } = await import('./Inspector.svelte');
const { workState } = await import('../lib/inspectWork.svelte.js');

let live;
let target;

async function settle(ms = 0) {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  flushSync();
}

/** Past the autosave's quiet period, so a pending save has run. */
const afterQuiet = () => settle(1000);

async function start() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Inspector, { target });
  flushSync();
  await settle();
}

async function openFile(title) {
  const card = [...target.querySelectorAll('.card')].find((c) => c.textContent.includes(title));
  card.click();
  await settle();
  await settle(10);
}

const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

beforeEach(() => {
  saved = {};
  works = [];
  media = MEDIA;
  get.mockClear();
  put.mockClear();
  del.mockClear();
  patch.mockReset();
  toast.mockClear();
  reloadCase.mockClear();
  deletedToast.mockClear();
  uiState.openInspect = null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' }))));
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  vi.unstubAllGlobals();
});

describe('opening a file', () => {
  it('lists every image and video to open, with no session to start first', async () => {
    await start();

    expect(target.textContent).toContain('Open a file');
    expect([...target.querySelectorAll('.card .title')].map((t) => t.textContent)).toEqual(['Roof', 'Convoy clip']);
    expect(button('New session')).toBeUndefined();
  });

  it('leaves the title to the tab, with no bar until a file is open', async () => {
    await start();

    expect(target.querySelector('h2')).toBeNull();
    expect(target.querySelector('.tool-header')).toBeNull();
    await openFile('Roof');
    expect(target.querySelector('.tool-header .file-name').value).toBe('Roof');
  });

  it('files nothing for a file that was only looked at', async () => {
    await start();
    await openFile('Roof');
    await afterQuiet();

    expect(target.querySelector('.file-name').value).toBe('Roof');
    expect(put).not.toHaveBeenCalled();
    expect(target.querySelector('.status')).toBeNull();
  });
});

describe('leaving a file', () => {
  it('goes back to the file list, writing what was pending first', async () => {
    await start();
    await openFile('Roof');
    button('Duplicate').click();
    flushSync();

    target.querySelector('button[aria-label="Close file"]').click();
    await settle(10);

    expect(put).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Open a file');
    expect(target.querySelector('.file-name')).toBeNull();
  });

  it('opens another file from the header without going back to the list', async () => {
    await start();
    await openFile('Roof');

    button('Change file').click();
    flushSync();
    const modal = document.querySelector('[role="dialog"]');
    [...modal.querySelectorAll('.card')].find((c) => c.textContent.includes('Convoy clip')).click();
    await settle(10);

    expect(target.querySelector('.file-name').value).toBe('Convoy clip');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('saving as it is made', () => {
  it('files the work once the edits stop, and says it is saved', async () => {
    await start();
    await openFile('Roof');

    button('Duplicate').click();
    flushSync();
    button('Duplicate').click();
    flushSync();
    await afterQuiet();

    expect(put).toHaveBeenCalledTimes(1);
    const [path, body] = put.mock.calls[0];
    expect(path).toBe('/api/cases/case-a/inspect/work');
    expect(body.path).toBe('media/roof.png');
    expect(body.spec.frames).toHaveLength(3);
    expect(body.spec.frames.every((f) => !('url' in f))).toBe(true);
    expect(target.querySelector('.status').textContent).toContain('Saved');
  });
});

describe('coming back to a file', () => {
  it('puts its frames back in the strip without writing anything', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [frame('fr_a', 2), frame('fr_b', 5.5)], activeFrameId: null },
    };
    works = [{ name: 'Convoy clip', title: 'Convoy clip', source: 'media/clip.mp4', frames: 2, kind: 'video' }];
    await start();

    expect(target.querySelector('h4').textContent).toBe('Worked on');
    await openFile('Convoy clip');
    await afterQuiet();

    const tiles = [...target.querySelectorAll('.strip .tile')];
    expect(tiles).toHaveLength(3);
    expect(tiles[0].textContent).toContain('Video');
    expect(target.querySelector('button[aria-label="Frame 2 at 0:05.5"]')).not.toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('reopens a work from the sidebar on the file it belongs to', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, frames: [frame('fr_a', 2)], activeFrameId: 'fr_a' },
    };
    uiState.openInspect = 'Convoy clip';
    await start();
    await settle(20);

    expect(target.querySelector('.file-name').value).toBe('Convoy clip');
    expect(uiState.openInspect).toBeNull();
  });
});

describe('clearing a work', () => {
  it('sends it to the Trash, with the way back, and leaves the file open', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, frames: [frame('fr_a', 2)], activeFrameId: null },
    };
    await start();
    await openFile('Convoy clip');

    button('Clear work').click();
    flushSync();
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Clear work').pop();
    delete saved['media/clip.mp4'];
    const rev = workState.rev;
    confirm.click();
    await settle(20);

    expect(del).toHaveBeenCalledWith('/api/cases/case-a/inspect/work?path=media%2Fclip.mp4');
    // Collage stops offering its frames, and the sidebar drops it
    expect(workState.rev).toBeGreaterThan(rev);
    expect(reloadCase).toHaveBeenCalled();
    expect(deletedToast).toHaveBeenCalledWith('case-a', expect.objectContaining({ trash: 'g_1' }), 'Convoy clip');
    expect(target.querySelector('.file-name').value).toBe('Convoy clip');
    expect(target.querySelectorAll('.strip .tile')).toHaveLength(1);
  });
});

describe('renaming the file', () => {
  const renamed = { path: 'media/North roof.png', kind: 'image', title: 'North roof', filename: 'North roof.png', entity_id: 'e_roof' };
  const field = () => target.querySelector('input[aria-label="File name"]');

  function type(value) {
    field().value = value;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('renames it from the header, writing what was pending first, and stays on it', async () => {
    await start();
    await openFile('Roof');
    patch.mockImplementation(async () => {
      media = [renamed, MEDIA[1]];
      const { entity_id: _id, ...answer } = renamed; // the route answers without it
      return answer;
    });
    button('Duplicate').click();
    flushSync();

    type('North roof');
    field().dispatchEvent(new FocusEvent('blur'));
    await settle(20);

    expect(patch).toHaveBeenCalledWith('/api/cases/case-a/media', { path: 'media/roof.png', title: 'North roof' });
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
    expect(get).toHaveBeenCalledWith('/api/cases/case-a/inspect/work?path=media%2FNorth%20roof.png');
    expect(field().value).toBe('North roof');
    expect(reloadCase).toHaveBeenCalled();
  });

  it('leaves the name as it was on Escape', async () => {
    await start();
    await openFile('Roof');

    type('Something else');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    field().dispatchEvent(new FocusEvent('blur'));
    await settle();

    expect(field().value).toBe('Roof');
    expect(patch).not.toHaveBeenCalled();
  });

  it('follows the open file when it is renamed elsewhere', async () => {
    await start();
    await openFile('Roof');

    media = [renamed, MEDIA[1]];
    caseState.rev += 1;
    await settle(20);

    expect(field().value).toBe('North roof');
    expect(toast).not.toHaveBeenCalled();
  });

  it('closes the open file when it is deleted elsewhere', async () => {
    await start();
    await openFile('Roof');

    media = [MEDIA[1]];
    caseState.rev += 1;
    await settle(20);

    expect(toast).toHaveBeenCalledWith('“Roof” was deleted from the case', 'warn');
    expect(field()).toBeNull();
  });
});
