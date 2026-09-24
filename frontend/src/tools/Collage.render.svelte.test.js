// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Collage tool driven the way an analyst drives it: start a canvas, place a
 * piece, rename it, export it. A collage is saved as it is made, so what these
 * check is what reaches the server and when.
 */

const MEDIA = [
  { path: 'media/roof.png', kind: 'image', title: 'Roof', filename: 'roof.png', thumbnail: 'media/.thumbs/r.jpg' },
  { path: 'media/clip.mp4', kind: 'video', title: 'Convoy clip', filename: 'clip.mp4' },
];
let media = MEDIA;
let works = [];
const piece = (path) => ({
  id: 'nd_1', frameId: null, save: { path, time: null, ops: [] }, w: 80, h: 60,
  quad: [[0, 0], [80, 0], [80, 60], [0, 60]], frameOps: [], crop: null,
});

let collages = [];
let saved = {};

const get = vi.fn(async (path) => {
  if (path === '/api/inspect/ops') return { filters: [], analyses: [] };
  if (path === '/api/cases/case-a/media') return structuredClone(media);
  if (path === '/api/cases/case-a/inspect/works') return structuredClone(works);
  if (path.startsWith('/api/cases/case-a/inspect/works/')) {
    throw Object.assign(new Error('nothing was inspected under that name'), { status: 404 });
  }
  if (path === '/api/cases/case-a/collages') return structuredClone(collages);
  if (path.startsWith('/api/cases/case-a/collages/')) {
    return structuredClone(saved[decodeURIComponent(path.split('/collages/')[1])]);
  }
  return {};
});
const post = vi.fn(async (path, body) => {
  if (path === '/api/cases/case-a/collages') return { name: body.title, title: body.title };
  return {};
});
vi.mock('../lib/api.js', () => ({ api: { get, post, put: vi.fn(), patch: vi.fn(), del: vi.fn() } }));

// Reactive, so a change made elsewhere in the case can reach the open collage.
const caseState = $state({ current: { id: 'case-a', folders: [] }, rev: 0 });
const uiState = { tool: 'collage', openCollage: null, focusMedia: null };
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast, reloadCase: vi.fn(async () => {}) }));
vi.mock('../lib/trash.js', () => ({ deletedToast: vi.fn() }));

const { default: Collage } = await import('./Collage.svelte');
const { workState } = await import('../lib/inspectWork.svelte.js');

let live;
let target;

async function settle(ms = 0) {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  flushSync();
}

const afterQuiet = () => settle(1000);
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const collagePosts = () => post.mock.calls.filter(([path]) => path === '/api/cases/case-a/collages');

async function start() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Collage, { target });
  flushSync();
  await settle();
}

beforeEach(() => {
  collages = [];
  saved = {};
  media = MEDIA;
  works = [];
  post.mockClear();
  toast.mockClear();
  uiState.openCollage = null;
  // A picture "loads" as soon as it is asked for, with a size to lay out.
  vi.stubGlobal('Image', class {
    naturalWidth = 80;
    naturalHeight = 60;
    set src(_value) {
      setTimeout(() => this.onload?.(), 0);
    }
  });
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  vi.unstubAllGlobals();
});

describe('a new collage', () => {
  it('leaves the title to the tab, with no bar until a collage is open', async () => {
    await start();

    expect(target.querySelector('h2')).toBeNull();
    expect(target.querySelector('.tool-header')).toBeNull();
    button('New collage').click();
    await settle();
    expect(target.querySelector('.tool-header input[aria-label="Collage name"]')).not.toBeNull();
  });

  it('files nothing until a piece is placed', async () => {
    collages = [{ name: 'Collage 1', title: 'Collage 1', pieces: 2 }];
    await start();

    button('New collage').click();
    await settle();
    await afterQuiet();

    // named past the ones the case already holds
    expect(target.querySelector('input[aria-label="Collage name"]').value).toBe('Collage 2');
    expect(collagePosts()).toHaveLength(0);
  });

  it('is filed under its name once a case image is placed on it', async () => {
    await start();
    button('New collage').click();
    await settle();

    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    await afterQuiet();

    expect(collagePosts()).toHaveLength(1);
    const [, body] = collagePosts()[0];
    expect(body.name).toBeNull();
    expect(body.title).toBe('Collage 1');
    expect(body.spec.nodes).toHaveLength(1);
    expect(body.spec.nodes[0].save).toEqual({ path: 'media/roof.png', time: null, ops: [] });
    expect(body.spec.nodes[0]).not.toHaveProperty('url');
  });
});

describe('an existing collage', () => {
  beforeEach(() => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] },
    };
  });

  it('opens from the list without writing anything', async () => {
    await start();
    button('Strip').click();
    await settle(20);
    await afterQuiet();

    expect(target.querySelector('input[aria-label="Collage name"]').value).toBe('Strip');
    expect(collagePosts()).toHaveLength(0);
  });

  it('refuses a rename onto a name another collage holds, and keeps its own', async () => {
    post.mockImplementationOnce(async () => {
      throw Object.assign(new Error('another collage already uses that name'), { status: 409 });
    });
    await start();
    button('Strip').click();
    await settle(20);

    const input = target.querySelector('input[aria-label="Collage name"]');
    input.value = 'Harbour';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    await settle(20);

    expect(toast).toHaveBeenCalledWith('Another collage already uses that name', 'warn');
    expect(input.value).toBe('Strip');
  });

  it('holds the export while a piece has lost its file', async () => {
    saved.Strip.spec.nodes = [piece('media/gone.png')];
    await start();
    button('Strip').click();
    await settle(20);

    expect(target.textContent).toContain('1 piece lost its file. Remove it to save.');
    const save = [...document.querySelectorAll('.save .btn-primary')][0];
    expect(save.disabled).toBe(true);
    expect(target.querySelector('.node.missing')).not.toBeNull();
  });

  it('shows a piece still rendering as loading, not as lost', async () => {
    saved.Strip.spec.nodes = [{ ...piece('media/clip.mp4'), save: { path: 'media/clip.mp4', time: 2, ops: [] } }];
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (finish = resolve))));
    URL.createObjectURL = vi.fn(() => 'blob:piece');
    URL.revokeObjectURL = vi.fn();
    await start();
    button('Strip').click();
    await settle(20);

    const holder = target.querySelector('.node.placeholder');
    expect(holder.classList.contains('missing')).toBe(false);
    expect(holder.querySelector('.spinner')).not.toBeNull();
    expect(target.textContent).not.toContain('lost its file');

    finish(new Response(new Blob(['png'], { type: 'image/png' })));
    await settle(20);
    expect(target.querySelector('.node.placeholder')).toBeNull();
    expect(target.querySelector('img.node').getAttribute('src')).toBe('blob:piece');
  });

  it('follows a piece whose file was renamed elsewhere', async () => {
    await start();
    button('Strip').click();
    await settle(20);

    // the rename rewrote the saved collage along with the file
    media = [{ ...MEDIA[0], path: 'media/North roof.png', title: 'North roof' }, MEDIA[1]];
    saved.Strip.spec.nodes = [piece('media/North roof.png')];
    caseState.rev += 1;
    await settle(20);

    expect(target.querySelector('.node.missing')).toBeNull();
    expect(target.textContent).not.toContain('lost its file');
  });

  it('marks a piece whose file was deleted elsewhere', async () => {
    await start();
    button('Strip').click();
    await settle(20);

    media = [MEDIA[1]];
    caseState.rev += 1;
    await settle(20);

    expect(target.querySelector('.node.missing')).not.toBeNull();
    expect(target.textContent).toContain('1 piece lost its file. Remove it to save.');
  });

  it('reopens from the sidebar by name', async () => {
    uiState.openCollage = 'Strip';
    await start();
    await settle(20);

    expect(target.querySelector('input[aria-label="Collage name"]').value).toBe('Strip');
    expect(uiState.openCollage).toBeNull();
  });
});

describe('frames from Inspect', () => {
  const clipWork = { name: 'Convoy clip', title: 'Convoy clip', source: 'media/clip.mp4', frames: 2, kind: 'video' };

  it('stops offering a work cleared in Inspect', async () => {
    works = [clipWork];
    await start();
    button('New collage').click();
    await settle();
    expect(target.querySelector('.group-head').textContent).toContain('Convoy clip');

    works = [];
    workState.rev += 1;
    await settle(20);

    expect(target.querySelector('.group-head')).toBeNull();
  });

  it('lists a work under the name its file has now', async () => {
    // a work that kept the name the file had before a rename
    works = [{ ...clipWork, name: 'Old clip name', title: 'Old clip name' }];
    await start();
    button('New collage').click();
    await settle();

    expect(target.querySelector('.group-head .name').textContent).toBe('Convoy clip');
  });

  it('says so, rather than spinning, when a work is no longer there', async () => {
    works = [clipWork];
    await start();
    button('New collage').click();
    await settle();

    target.querySelector('.group-head').click();
    await settle(20);

    expect(target.querySelector('.group .spinner')).toBeNull();
    expect(target.querySelector('.group').textContent).toContain('No frames left here.');
  });
});
