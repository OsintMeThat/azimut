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
const put = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, patch: vi.fn(), del: vi.fn() } }));
// happy-dom has no 2D canvas, so the preview's pixels are stood in for.
const renderCollageThumb = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
vi.mock('../lib/collageThumb.js', () => ({ renderCollageThumb }));

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
  put.mockClear();
  renderCollageThumb.mockClear();
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

afterEach(async () => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  await settle(); // a preview sent on the way out lands before the next test counts
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

describe('the list', () => {
  const previewPuts = () => put.mock.calls.filter(([path]) => path.endsWith('/thumb'));
  // The preview waits for the layout to settle past the save.
  const afterPreview = () => settle(1700);

  it('shows each collage as a card with its preview, or its outline until it has one', async () => {
    collages = [
      { name: 'Strip', title: 'Strip', pieces: 1, thumb: '.collages/Strip.webp', thumb_v: 7, filed: true },
      { name: 'Wall', title: 'Wall', pieces: 2, filed: false,
        outline: { width: 100, height: 50, quads: [[[0, 0], [50, 0], [50, 50], [0, 50]], [[50, 0], [100, 0], [100, 50], [50, 50]]] } },
    ];
    await start();

    const [strip, wall] = target.querySelectorAll('.card');
    expect(strip.querySelector('img').getAttribute('src')).toBe('/files/case-a/.collages/Strip.webp?v=7');
    expect(wall.querySelectorAll('svg polygon')).toHaveLength(2);
    // Only the one whose picture is in the case carries the mark.
    expect(strip.querySelector('.filed')).not.toBeNull();
    expect(wall.querySelector('.filed')).toBeNull();
  });

  it('files a preview once a placed piece has settled', async () => {
    await start();
    button('New collage').click();
    await settle();
    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    await afterQuiet();
    await afterPreview();

    expect(previewPuts()).toHaveLength(1);
    const [path, body] = previewPuts()[0];
    expect(path).toBe('/api/cases/case-a/collages/Collage%201/thumb');
    expect(body).toBeInstanceOf(FormData);
    const [nodes] = renderCollageThumb.mock.calls[0];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].quad).toHaveLength(4);
  });

  it('draws nothing again for a collage reopened as it was', async () => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1, thumb: '.collages/Strip.webp', thumb_v: 1 }];
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] },
    };
    await start();
    button('Strip').click();
    await settle(20);
    await afterPreview();

    expect(previewPuts()).toHaveLength(0);
  });

  it('draws one for a collage that has none yet, once its pieces are in', async () => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1, outline: null }];
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] },
    };
    await start();
    button('Strip').click();
    await settle(20);
    await afterPreview();

    expect(previewPuts().map(([path]) => path)).toEqual(['/api/cases/case-a/collages/Strip/thumb']);
  });
});

describe('finding and leaving a collage', () => {
  const typeInto = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const titles = () => [...target.querySelectorAll('.card .row-title')].map((el) => el.textContent);

  it('narrows the list to the names holding every word, whatever their accents', async () => {
    collages = [
      { name: 'Façade est', title: 'Façade est', pieces: 2 },
      { name: 'Harbour strip', title: 'Harbour strip', pieces: 1 },
      { name: 'Facade west', title: 'Facade west', pieces: 1 },
    ];
    await start();
    const search = target.querySelector('input[aria-label="Search collages…"]');

    typeInto(search, 'FACADE');
    expect(titles()).toEqual(['Façade est', 'Facade west']);
    typeInto(search, 'façade west');
    expect(titles()).toEqual(['Facade west']);
    typeInto(search, 'quay');
    expect(titles()).toEqual([]);
    expect(target.textContent).toContain('No collage has “quay” in its name.');
  });

  it('offers no search over a single collage', async () => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    await start();

    expect(target.querySelector('input[aria-label="Search collages…"]')).toBeNull();
  });

  it('saves what is pending and goes back to the list on Close', async () => {
    await start();
    button('New collage').click();
    await settle();
    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    expect(collagePosts()).toHaveLength(0); // still waiting on the autosave

    collages = [{ name: 'Collage 1', title: 'Collage 1', pieces: 1 }];
    button('Collages').click();
    await settle(20);

    expect(collagePosts()).toHaveLength(1);
    expect(target.querySelector('.tool-header')).toBeNull();
    expect(titles()).toEqual(['Collage 1']);
  });

  it('lets a rename typed just before Close land first', async () => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] },
    };
    let answer;
    post.mockImplementationOnce((_path, body) => new Promise((resolve) => (answer = () => resolve({ name: body.title, title: body.title }))));
    await start();
    button('Strip').click();
    await settle(20);

    const input = target.querySelector('input[aria-label="Collage name"]');
    typeInto(input, 'Harbour');
    input.dispatchEvent(new FocusEvent('blur'));
    button('Collages').click();
    await settle(20);
    expect(target.querySelector('.tool-header')).not.toBeNull(); // waiting on the rename

    answer();
    await settle(20);
    expect(collagePosts().map(([, body]) => body.title)).toEqual(['Harbour']);
    expect(target.querySelector('.tool-header')).toBeNull();
  });

  it('stays open when the last save fails', async () => {
    post.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await start();
    button('New collage').click();
    await settle();
    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);

    button('Collages').click();
    await settle(20);

    expect(target.querySelector('.tool-header')).not.toBeNull();
    expect(toast).toHaveBeenCalledWith('The collage could not be saved, so it stays open', 'warn');
  });

  it('writes again on Retry after a failed save', async () => {
    post.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    await start();
    button('New collage').click();
    await settle();
    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    button('Collages').click(); // the save runs, and fails
    await settle(20);
    expect(target.querySelector('.status.error')).not.toBeNull();
    const before = collagePosts().length;

    button('Retry').click();
    await settle(20);

    expect(collagePosts().length).toBe(before + 1);
    expect(target.querySelector('.status.error')).toBeNull();
  });

  it('keeps an unsaved collage open when another is asked for', async () => {
    post.mockImplementation(async () => {
      throw new Error('disk full');
    });
    await start();
    button('New collage').click();
    await settle();
    button('Images').click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    button('Collages').click();
    await settle(20);
    toast.mockClear();

    [...document.querySelectorAll('button')].find((el) => el.title === 'Start an empty canvas').click();
    await settle(20);

    expect(toast).toHaveBeenCalledWith('The collage could not be saved, so it stays open', 'warn');
    expect(target.querySelector('.status.error')).not.toBeNull();
    post.mockReset();
    post.mockImplementation(async (path, body) => (path === '/api/cases/case-a/collages' ? { name: body.title, title: body.title } : {}));
  });
});

describe('the piece picker', () => {
  const clip = { name: 'Convoy clip', title: 'Convoy clip', source: 'media/clip.mp4', frames: 2, kind: 'video' };
  const roof = { name: 'Roof', title: 'Roof', source: 'media/roof.png', frames: 1, kind: 'image' };
  const heads = () => [...target.querySelectorAll('.group-head .name')].map((el) => el.textContent);
  const typeInto = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };

  async function openNew() {
    await start();
    button('New collage').click();
    await settle();
  }

  it('shows each file by its own thumbnail, in the order last worked on', async () => {
    works = [roof, clip];
    await openNew();

    expect(heads()).toEqual(['Roof', 'Convoy clip']);
    const [first, second] = target.querySelectorAll('.group-head .file');
    expect(first.querySelector('img').getAttribute('src')).toBe('/files/case-a/media/.thumbs/r.jpg');
    expect(second.querySelector('img')).toBeNull(); // no thumbnail cached: its kind stands in
  });

  it('narrows the files, then the images, to the words typed', async () => {
    works = [roof, clip];
    await openNew();
    const search = target.querySelector('.picker input[aria-label="Search…"]');

    typeInto(search, 'convoy');
    expect(heads()).toEqual(['Convoy clip']);
    typeInto(search, 'quay');
    expect(target.querySelector('.picker').textContent).toContain('No file named “quay”.');

    button('Images').click();
    flushSync();
    typeInto(search, 'ROOF');
    expect(target.querySelectorAll('.picker .thumbs .thumb')).toHaveLength(1);
  });

  it('keeps one file unfolded at a time', async () => {
    works = [roof, clip];
    await openNew();
    const [roofHead, clipHead] = target.querySelectorAll('.group-head');

    roofHead.click();
    flushSync();
    clipHead.click();
    flushSync();

    expect(roofHead.getAttribute('aria-expanded')).toBe('false');
    expect(clipHead.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the export', () => {
  it('says its size, and composes at the piece’s own resolution', async () => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    // a 1920×1080 piece shown at 800×450
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 1600, height: 800, transparent: true, nodes: [{
        ...piece('media/roof.png'), w: 1920, h: 1080, quad: [[100, 50], [900, 50], [900, 500], [100, 500]],
      }] },
    };
    await start();
    button('Strip').click();
    await settle(20);

    expect(target.textContent).toContain('Exports at 1920 × 1080 px.');
    expect(target.querySelector('input[aria-label="Canvas width in pixels"]')).toBeNull();

    [...document.querySelectorAll('.save .btn-primary')][0].click();
    await settle(20);
    const [, body] = post.mock.calls.find(([path]) => path.endsWith('/inspect/compose'));
    expect(body).toMatchObject({ width: 1920, height: 1080 });
    expect(body.nodes[0].quad).toEqual([[0, 0], [1920, 0], [1920, 1080], [0, 1080]]);
  });
});

describe('the layout', () => {
  beforeEach(() => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    saved.Strip = {
      name: 'Strip', title: 'Strip',
      spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] },
    };
  });

  it('puts what acts on the whole collage over the canvas, and the save on top of the panel', async () => {
    await start();
    button('Strip').click();
    await settle(20);

    const stage = target.querySelector('.stage');
    expect(stage.querySelector('[role="toolbar"] [data-guide="collage.arrange"]')).not.toBeNull();
    expect(stage.querySelector('[role="toolbar"] [data-guide="collage.straighten"]')).not.toBeNull();
    expect(button('Fit').closest('[role="toolbar"]')).not.toBeNull();
    // the panel reads top to bottom: the save, the pieces to add, the piece in hand
    const blocks = [...target.querySelectorAll('.panel [data-guide="collage.save"], .panel [data-guide="collage.add"], .panel .selection')];
    expect(blocks.map((el) => el.dataset.guide ?? 'selection')).toEqual(['collage.save', 'collage.add', 'selection']);
  });

  it('keeps the piece in hand in one place, whether one is selected or none', async () => {
    await start();
    button('Strip').click();
    await settle(20);
    const foot = target.querySelector('.panel .selection');
    expect(foot.textContent).toContain('Click a piece to scale, turn or crop it.');

    target.querySelector('img.node').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    flushSync();
    expect(target.querySelector('.panel .selection')).toBe(foot);
    expect(foot.querySelector('.identity .source').textContent).toBe('Roof');
  });
});

describe('an empty canvas', () => {
  const clipWork = { name: 'Convoy clip', title: 'Convoy clip', source: 'media/clip.mp4', frames: 2, kind: 'video' };
  const tabOn = () => target.querySelector('.picker [role="tab"].on').textContent.trim();

  it('says how pieces come in, and opens the list each way leads to', async () => {
    works = [clipWork];
    await start();
    button('New collage').click();
    await settle();

    const card = target.querySelector('.empty-canvas');
    expect(card.textContent).toContain('Add frames from a video, or pictures');
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Images')).click();
    flushSync();
    expect(tabOn()).toBe('Images');
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Frames')).click();
    flushSync();
    expect(tabOn()).toBe('Frames');
    expect(target.querySelector('[data-guide="collage.add"]').classList.contains('pointed')).toBe(true);
  });

  it('leads to Inspect while no frame is cut, and steps aside once a piece is in', async () => {
    await start();
    button('New collage').click();
    await settle();

    const card = target.querySelector('.empty-canvas');
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Cut frames in Inspect')).click();
    expect(uiState.tool).toBe('inspect');
    uiState.tool = 'collage';

    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Images')).click();
    flushSync();
    target.querySelector('.picker .thumb').click();
    await settle(20);
    expect(target.querySelector('.empty-canvas')).toBeNull();
  });
});

describe('a collage of one video', () => {
  const at = (id, path, time) => ({ ...piece(path), id, save: { path, time, ops: [] } });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' }))));
    URL.createObjectURL = vi.fn(() => 'blob:piece');
    URL.revokeObjectURL = vi.fn();
  });

  async function openWith(nodes, extraMedia = []) {
    media = [...MEDIA, ...extraMedia];
    collages = [{ name: 'Pan', title: 'Pan', pieces: nodes.length }];
    saved.Pan = { name: 'Pan', title: 'Pan', spec: { width: 800, height: 400, transparent: true, nodes } };
    await start();
    button('Pan').click();
    await settle(20);
  }

  it('says which video and which stretch of it the pieces come from', async () => {
    await openWith([at('nd_1', 'media/clip.mp4', 5), at('nd_2', 'media/clip.mp4', 2)]);

    expect(target.querySelector('.panel .from').textContent.replace(/\s+/g, ' ').trim()).toBe('From Convoy clip 0:02–0:05');
  });

  it('reads one piece as one instant', async () => {
    await openWith([at('nd_1', 'media/clip.mp4', 2)]);

    expect(target.querySelector('.panel .from .from-when').textContent).toBe('0:02');
  });

  it('reads a frame saved from the video back to the video', async () => {
    const frame = {
      path: 'media/00-00-07 clip.png', kind: 'image', title: '00-00-07 clip', filename: '00-00-07 clip.png',
      source: { type: 'inspect', op: 'frame', from: 'media/clip.mp4', time: 7 },
    };
    await openWith([at('nd_1', 'media/clip.mp4', 2), { ...piece(frame.path), id: 'nd_2' }], [frame]);

    expect(target.querySelector('.panel .from .from-when').textContent).toBe('0:02–0:07');
  });

  it('says nothing of a collage that also holds a picture', async () => {
    await openWith([at('nd_1', 'media/clip.mp4', 2), { ...piece('media/roof.png'), id: 'nd_2' }]);

    expect(target.querySelector('.panel .from')).toBeNull();
  });
});

describe('a collage straightened', () => {
  const at = (id, path, time) => ({ ...piece(path), id, save: { path, time, ops: [] } });
  const STRAIGHT = 'media/Pan straightened.png';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' }))));
    URL.createObjectURL = vi.fn(() => 'blob:piece');
    URL.revokeObjectURL = vi.fn();
    media = MEDIA;
    collages = [{ name: 'Pan', title: 'Pan', pieces: 2 }];
    saved.Pan = { name: 'Pan', title: 'Pan', spec: { width: 800, height: 400, transparent: true, nodes: [at('nd_1', 'media/clip.mp4', 2), { ...at('nd_2', 'media/clip.mp4', 5), quad: [[80, 0], [160, 0], [160, 60], [80, 60]] }] } };
    // the bent picture lands in the case as the server files it: composed from the pieces' frames
    post.mockImplementation(async (path, body) => {
      if (path === '/api/cases/case-a/collages') return { name: body.title, title: body.title };
      if (path === '/api/cases/case-a/inspect/compose') {
        media = [...MEDIA, {
          path: STRAIGHT, kind: 'image', title: 'Pan straightened', filename: 'Pan straightened.png',
          source: { type: 'inspect', op: 'collage', sources: ['media/clip.mp4', 'media/clip.mp4'], times: [2, 5], straightened: true },
        }];
        return { item: { path: STRAIGHT }, box: [0, 0, 160, 60] };
      }
      return {};
    });
  });

  afterEach(() => post.mockImplementation(async (path, body) => (path === '/api/cases/case-a/collages' ? { name: body.title, title: body.title } : {})));

  it('still reads as its video, the stretch of its pieces, never as a picture of its own', async () => {
    await start();
    button('Pan').click();
    await settle(20);
    expect(target.querySelector('.panel .from .from-when').textContent).toBe('0:02–0:05');

    button('Draw the line').click();
    flushSync();
    const catcher = target.querySelector('.level-catch');
    for (const x of [10, 150]) {
      catcher.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: 30, button: 0, bubbles: true }));
      flushSync();
    }
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Straighten').click();
    await settle(20);

    expect(post.mock.calls.some(([path]) => path === '/api/cases/case-a/inspect/compose')).toBe(true);
    expect(target.querySelectorAll('img.node')).toHaveLength(1);
    expect(target.querySelector('.panel .from').textContent.replace(/\s+/g, ' ').trim()).toBe('From Convoy clip 0:02–0:05');
    // Mark to geolocate offers the video and its stretch, as before the bend
    expect(target.querySelector('.panel button[aria-label="More ways to mark"]')).not.toBeNull();
  });
});

describe('undo', () => {
  const two = () => [
    { ...piece('media/roof.png'), id: 'nd_1' },
    { ...piece('media/roof.png'), id: 'nd_2', quad: [[100, 0], [180, 0], [180, 60], [100, 60]] },
  ];
  const ctrlZ = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
  };
  const press = (key) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    flushSync();
  };
  const corner = (i) => {
    const node = target.querySelectorAll('img.node')[i];
    return node.style.transform;
  };

  beforeEach(() => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 2 }];
    saved.Strip = { name: 'Strip', title: 'Strip', spec: { width: 800, height: 400, transparent: true, nodes: two() } };
  });

  afterEach(() => post.mockImplementation(async (path, body) => (path === '/api/cases/case-a/collages' ? { name: body.title, title: body.title } : {})));

  it('takes a whole auto-stitch back in one step, however long its pieces take to come back', async () => {
    // a panorama warp redraws each piece, slower than the history's pause between steps
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(new Response(new Blob(['png'], { type: 'image/png' }))), 450))));
    URL.createObjectURL = vi.fn(() => 'blob:warped');
    URL.revokeObjectURL = vi.fn();
    post.mockImplementation(async (path, body) => {
      if (path === '/api/cases/case-a/collages') return { name: body.title, title: body.title };
      if (path === '/api/cases/case-a/inspect/auto-stitch') {
        const op = { op: 'remap', params: { warp: 'cylindrical' } };
        return { nodes: [{ index: 0, quad: [[0, 100], [80, 100], [80, 160], [0, 160]], op }, { index: 1, quad: [[70, 100], [150, 100], [150, 160], [70, 160]], op }], dropped: [], canvas: null };
      }
      return {};
    });
    await start();
    button('Strip').click();
    await settle(20);
    const before = [corner(0), corner(1)];

    button('Auto-stitch').click();
    await settle(1200);
    expect(corner(0)).not.toBe(before[0]);
    expect(target.querySelector('img.node').getAttribute('src')).toBe('blob:warped');

    ctrlZ();
    expect([corner(0), corner(1)]).toEqual(before);
  });

  it('takes a burst of arrow presses back at once, and the next burst on its own', async () => {
    await start();
    button('Strip').click();
    await settle(20);
    const start0 = corner(0);
    target.querySelector('img.node').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    flushSync();

    for (let i = 0; i < 5; i += 1) press('ArrowRight');
    await settle(500);
    const afterFirst = corner(0);
    expect(afterFirst).not.toBe(start0);
    press('ArrowDown');
    press('ArrowDown');
    await settle(500);

    ctrlZ();
    expect(corner(0)).toBe(afterFirst);
    await settle(450);
    ctrlZ();
    expect(corner(0)).toBe(start0);
  });
});
