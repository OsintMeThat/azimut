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
// what the server reads of the rail's video, its Inspect work, and the frames a panorama takes
let probe = { duration: 10, fps: 25, width: 1920, height: 1080 };
let work = null;
let panorama = { times: [], note: null };
// stands in for the panorama's reading and its stitch, to hold one or make it fail
let panoramaAnswer = null;
let stitchAnswer = null;
const piece = (path) => ({
  id: 'nd_1', frameId: null, save: { path, time: null, ops: [] }, w: 80, h: 60,
  quad: [[0, 0], [80, 0], [80, 60], [0, 60]], frameOps: [], crop: null,
});

let collages = [];
let saved = {};

const get = vi.fn(async (path) => {
  if (path === '/api/inspect/ops') return { filters: [], analyses: [] };
  if (path === '/api/cases/case-a/media') return structuredClone(media);
  if (path.startsWith('/api/cases/case-a/inspect/probe')) return structuredClone(probe);
  if (path.startsWith('/api/cases/case-a/inspect/work?')) return { work: structuredClone(work) };
  if (path.startsWith('/api/cases/case-a/scenes')) return { scenes: [], taken: [], collages: [] };
  if (path === '/api/cases/case-a/collages') return structuredClone(collages);
  if (path.startsWith('/api/cases/case-a/collages/')) {
    return structuredClone(saved[decodeURIComponent(path.split('/collages/')[1])]);
  }
  return {};
});
const post = vi.fn(async (path, body) => {
  if (path === '/api/cases/case-a/collages') return { name: body.title, title: body.title };
  if (path === '/api/cases/case-a/inspect/panorama-frames') return panoramaAnswer ? panoramaAnswer() : structuredClone(panorama);
  if (path === '/api/cases/case-a/inspect/auto-stitch' && stitchAnswer) return stitchAnswer(body);
  if (path === '/api/cases/case-a/inspect/auto-stitch') {
    // each piece put in a row, as a stitch answers, and the angle they cover
    return {
      canvas: null,
      nodes: body.nodes.map((_n, index) => ({ index, quad: [[index * 70, 0], [index * 70 + 80, 0], [index * 70 + 80, 60], [index * 70, 60]] })),
      dropped: [],
      span_deg: 40 * body.nodes.length,
    };
  }
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
  probe = { duration: 10, fps: 25, width: 1920, height: 1080 };
  work = null;
  panorama = { times: [], note: null };
  panoramaAnswer = null;
  stitchAnswer = null;
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

describe('the video rail', () => {
  const at = (id, path, time, ops = []) => ({ ...piece(path), id, save: { path, time, ops }, frameOps: ops });
  const rail = () => target.querySelector('[data-testid="collage-rail"]');
  const railButton = (text) => [...rail().querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
  const key = (k, opts = {}) => {
    rail().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
    flushSync();
  };
  let renders;

  beforeEach(() => {
    renders = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(init?.body ?? '{}');
      renders.push(body);
      // the server names the frame the player shows at the time asked
      const headers = body.snap ? { 'X-Frame-Time': String(Math.floor(body.time * 25 + 1e-6) / 25) } : {};
      return new Response(new Blob(['png'], { type: 'image/png' }), { headers });
    }));
    URL.createObjectURL = vi.fn(() => 'blob:piece');
    URL.revokeObjectURL = vi.fn();
  });

  async function openNew() {
    await start();
    button('New collage').click();
    await settle();
  }

  it('plays a video picked in Videos under the canvas, beside it once it stands upright', async () => {
    await openNew();
    expect(rail()).toBeNull();

    target.querySelector('.picker .group-head').click();
    await settle(20);
    expect(rail().querySelector('.rail-title').textContent).toBe('Convoy clip');
    expect(rail().classList.contains('bottom')).toBe(true);
    expect(target.querySelector('.workspace').classList.contains('upright')).toBe(false);
    expect(target.querySelector('.picker .group-head').classList.contains('open')).toBe(true);
  });

  it('stands beside the canvas for a clip filmed upright, and folds to its title', async () => {
    probe = { duration: 10, fps: 25, width: 1080, height: 1920 };
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);

    expect(rail().classList.contains('left')).toBe(true);
    expect(target.querySelector('.workspace').classList.contains('upright')).toBe(true);
    rail().querySelector('button[aria-label="Fold the video"]').click();
    flushSync();
    expect(rail().classList.contains('folded')).toBe(true);
    expect(rail().querySelector('video')).toBeNull();
    // folded, it lies under the canvas whatever the clip's shape
    expect(target.querySelector('.workspace').classList.contains('upright')).toBe(false);
  });

  it('opens a collage on the video its pieces come from', async () => {
    collages = [{ name: 'Pan', title: 'Pan', pieces: 1 }];
    saved.Pan = { name: 'Pan', title: 'Pan', spec: { width: 800, height: 600, nodes: [at('nd_1', 'media/clip.mp4', 2)] } };
    uiState.openCollage = 'Pan';
    await start();
    await settle(20);

    expect(rail().querySelector('.rail-title').textContent).toBe('Convoy clip');
  });

  it('lays the frame on screen beside the last piece, as the server named it, and never twice', async () => {
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);

    key('ArrowRight');
    key('ArrowRight');
    railButton('Add frame').click();
    await settle(20);
    const asked = renders.find((r) => r.snap);
    expect(asked.path).toBe('media/clip.mp4');
    const autosaved = () => collagePosts().at(-1)?.[1].spec.nodes ?? [];
    await afterQuiet();
    expect(autosaved()).toHaveLength(1);
    expect(autosaved()[0].save.time).toBeCloseTo(Math.floor(asked.time * 25 + 1e-6) / 25, 6);

    key('ArrowRight');
    railButton('Add frame').click();
    await afterQuiet();
    const [first, second] = autosaved();
    // in a row: the second starts right of the first, at its height
    expect(second.quad[0][0]).toBeGreaterThan(Math.max(...first.quad.map(([x]) => x)));
    expect(second.quad[0][1]).toBe(first.quad[0][1]);

    railButton('Add frame').click();
    await settle(20);
    expect(toast).toHaveBeenCalledWith('This frame is already on the collage', 'info', 2500);
    await afterQuiet();
    expect(autosaved()).toHaveLength(2);
  });

  it('takes a frame Inspect cut there as it was cut, its crop and light kept', async () => {
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    work = { spec: { frames: [{ id: 'fr_1', path: 'media/clip.mp4', time: 0, crop, adjust: {} }] } };
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);

    railButton('Add frame').click();
    await afterQuiet();
    const [node] = collagePosts().at(-1)[1].spec.nodes;
    expect(node.frameId).toBe('fr_1');
    expect(node.save.ops).toEqual([{ op: 'crop', params: crop }]);
  });

  it('asks for A and B before a panorama, then lays the frames picked and stitches them, one undo', async () => {
    panorama = { times: [0.2, 0.6, 1.0], note: null };
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);

    expect(railButton('Panorama').disabled).toBe(true);
    expect(railButton('Panorama').title).toBe('Set A and B around the pan first');
    railButton('A').click();
    for (let i = 0; i < 10; i += 1) key('ArrowRight');
    railButton('B').click();
    flushSync();
    expect(railButton('Panorama').disabled).toBe(false);

    railButton('Panorama').click();
    await settle(40);
    const call = post.mock.calls.find(([path]) => path === '/api/cases/case-a/inspect/panorama-frames');
    expect(call[1]).toMatchObject({ path: 'media/clip.mp4', start: 0 });
    expect(call[1].end).toBeGreaterThan(0.3);
    const stitch = post.mock.calls.find(([path]) => path === '/api/cases/case-a/inspect/auto-stitch');
    expect(stitch[1].mode).toBe('cylindrical');
    expect(stitch[1].nodes.map((n) => n.time)).toEqual([0.2, 0.6, 1.0]);
    expect(toast).toHaveBeenCalledWith('Stitched 3 pieces, about 120° across', 'ok', null, expect.any(Object));

    expect(target.querySelectorAll('img.node')).toHaveLength(3);
    target.querySelector('.tool-header button[title^="Undo"]').click();
    await settle(500);
    // one undo takes the frames and their stitch back together
    expect(target.querySelectorAll('img.node')).toHaveLength(0);
    expect(target.querySelector('.tool-header button[title^="Undo"]').disabled).toBe(true);
  });

  it('says why a stretch makes no panorama, and lays nothing', async () => {
    panorama = { times: [1.2], note: 'The camera barely moves here, so one frame is enough.' };
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);
    railButton('A').click();
    for (let i = 0; i < 10; i += 1) key('ArrowRight');
    railButton('B').click();
    flushSync();

    railButton('Panorama').click();
    await settle(40);
    expect(toast).toHaveBeenCalledWith('The camera barely moves here, so one frame is enough.', 'warn');
    expect(post.mock.calls.some(([path]) => path === '/api/cases/case-a/inspect/auto-stitch')).toBe(false);
    expect(target.querySelector('.empty-canvas')).not.toBeNull();
  });

  async function panoramaOfTheFirstSecond() {
    await openNew();
    target.querySelector('.picker .group-head').click();
    await settle(20);
    railButton('A').click();
    for (let i = 0; i < 10; i += 1) key('ArrowRight');
    railButton('B').click();
    flushSync();
    railButton('Panorama').click();
  }

  it('shows on the canvas that a panorama is under way, until it is done', async () => {
    panorama = { times: [0.2, 0.6, 1.0], note: null };
    let answer;
    panoramaAnswer = () => new Promise((resolve) => (answer = resolve));
    await panoramaOfTheFirstSecond();
    await settle();
    const working = () => target.querySelector('[data-testid="panorama-working"]');
    expect(working().textContent.trim()).toBe('Reading the pan…');
    expect(working().querySelector('.spinner')).not.toBeNull();
    // the canvas's own ways in stay out from under it
    expect(target.querySelector('.empty-canvas')).toBeNull();

    answer(structuredClone(panorama));
    await settle(40);
    expect(working()).toBeNull();
    expect(target.querySelectorAll('img.node')).toHaveLength(3);
  });

  it.each([
    ['the stitch fails', () => { throw new Error('auto-stitch could not estimate the camera rotations'); },
      'Auto-stitch could not estimate the camera rotations. Nothing was added'],
    ['the stitch joins no two frames', () => ({ canvas: null, nodes: [{ index: 0, quad: [[0, 0], [80, 0], [80, 60], [0, 60]] }], dropped: [1, 2], why: ['no-overlap', 'no-overlap'] }),
      'Its frames do not overlap. Nothing was added'],
  ])('takes its frames back when %s, and says why once', async (_name, answer, words) => {
    panorama = { times: [0.2, 0.6, 1.0], note: null };
    stitchAnswer = answer;
    await panoramaOfTheFirstSecond();
    await settle(40);
    expect(post.mock.calls.some(([path]) => path === '/api/cases/case-a/inspect/auto-stitch')).toBe(true);
    expect(target.querySelectorAll('img.node')).toHaveLength(0);
    expect(target.querySelector('[data-testid="panorama-working"]')).toBeNull();
    expect(toast.mock.calls).toEqual([[words, 'warn']]);
    await settle(500);
    // nothing to undo: the collage is as it was
    expect(target.querySelector('.tool-header button[title^="Undo"]').disabled).toBe(true);
  });

  it('puts the video of a piece taken in hand in the rail', async () => {
    media = [...MEDIA, { path: 'media/other.mp4', kind: 'video', title: 'Other clip', filename: 'other.mp4' }];
    collages = [{ name: 'Two', title: 'Two', pieces: 2 }];
    saved.Two = {
      name: 'Two', title: 'Two',
      spec: { width: 800, height: 600, nodes: [at('nd_1', 'media/other.mp4', 1), at('nd_2', 'media/clip.mp4', 2)] },
    };
    uiState.openCollage = 'Two';
    await start();
    await settle(20);
    expect(rail().querySelector('.rail-title').textContent).toBe('Convoy clip');

    // the first piece drawn on the canvas is the other clip's
    target.querySelector('img.node').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    await settle(20);
    expect(rail().querySelector('.rail-title').textContent).toBe('Other clip');
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

  it('lists the case’s videos by their own thumbnail, and only videos', async () => {
    media = [
      ...MEDIA,
      { path: 'media/quay.mp4', kind: 'video', title: 'Quay', filename: 'quay.mp4', thumbnail: 'media/.thumbs/q.jpg' },
    ];
    await openNew();

    expect(heads()).toEqual(['Convoy clip', 'Quay']);
    const [first, second] = target.querySelectorAll('.group-head .file');
    expect(first.querySelector('img')).toBeNull(); // no thumbnail cached: its kind stands in
    expect(second.querySelector('img').getAttribute('src')).toBe('/files/case-a/media/.thumbs/q.jpg');
  });

  it('narrows the videos, then the images, to the words typed', async () => {
    await openNew();
    const search = target.querySelector('.picker input[aria-label="Search…"]');

    typeInto(search, 'convoy');
    expect(heads()).toEqual(['Convoy clip']);
    typeInto(search, 'quay');
    expect(target.querySelector('.picker').textContent).toContain('No video named “quay”.');

    button('Images').click();
    flushSync();
    typeInto(search, 'ROOF');
    expect(target.querySelectorAll('.picker .thumbs .thumb')).toHaveLength(1);
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
  const tabOn = () => target.querySelector('.picker [role="tab"].on').textContent.trim();

  it('says how pieces come in, and opens the list each way leads to', async () => {
    await start();
    button('New collage').click();
    await settle();

    const card = target.querySelector('.empty-canvas');
    expect(card.textContent).toContain('Add frames from a video, or pictures');
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Images')).click();
    flushSync();
    expect(tabOn()).toBe('Images');
    [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Videos')).click();
    flushSync();
    expect(tabOn()).toBe('Videos');
    expect(target.querySelector('[data-guide="collage.add"]').classList.contains('pointed')).toBe(true);
  });

  it('offers Videos only in a case that holds one, and steps aside once a piece is in', async () => {
    media = MEDIA.filter((m) => m.kind === 'image');
    await start();
    button('New collage').click();
    await settle();

    const card = target.querySelector('.empty-canvas');
    expect([...card.querySelectorAll('button')].some((b) => b.textContent.includes('Videos'))).toBe(false);
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
  const bent = (time) => ({
    path: `media/Pan straightened 00-00-0${time} Convoy clip.png`, kind: 'image', title: `Pan straightened 00-00-0${time} Convoy clip`,
    filename: `Pan straightened 00-00-0${time} Convoy clip.png`,
    source: { type: 'inspect', op: 'collage', sources: ['media/clip.mp4'], times: [time], straightened: true },
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png'], { type: 'image/png' }))));
    URL.createObjectURL = vi.fn(() => 'blob:piece');
    URL.revokeObjectURL = vi.fn();
    media = MEDIA;
    collages = [{ name: 'Pan', title: 'Pan', pieces: 2 }];
    saved.Pan = { name: 'Pan', title: 'Pan', spec: { width: 800, height: 400, transparent: true, nodes: [at('nd_1', 'media/clip.mp4', 2), { ...at('nd_2', 'media/clip.mp4', 5), quad: [[80, 0], [160, 0], [160, 60], [80, 60]] }] } };
    // each bent piece lands in the case as the server files it: bent from its frame, and its own picture
    post.mockImplementation(async (path, body) => {
      if (path === '/api/cases/case-a/collages') return { name: body.title, title: body.title };
      if (path === '/api/cases/case-a/inspect/straighten') {
        media = [...MEDIA, bent(2), bent(5)];
        return { pieces: [
          { item: { path: bent(2).path }, box: [0, 3, 80, 66] },
          { item: { path: bent(5).path }, box: [80, 0, 160, 63] },
        ] };
      }
      return {};
    });
  });

  afterEach(() => post.mockImplementation(async (path, body) => (path === '/api/cases/case-a/collages' ? { name: body.title, title: body.title } : {})));

  async function straighten() {
    await start();
    button('Pan').click();
    await settle(20);
    button('Draw the line').click();
    flushSync();
    const catcher = target.querySelector('.level-catch');
    for (const [x, y] of [[10, 30], [150, 36]]) {
      catcher.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
      flushSync();
    }
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Straighten').click();
    await settle(20);
  }

  it('bends every piece alike and keeps one piece per frame, each in its place', async () => {
    await straighten();

    const [, body] = post.mock.calls.find(([path]) => path === '/api/cases/case-a/inspect/straighten');
    expect(body.bend).toHaveLength(body.width);
    expect(body.folder).toBeNull();
    expect(body.nodes.map((n) => [n.src, n.label])).toEqual([
      [{ path: 'media/clip.mp4', time: 2, ops: [] }, 'Pan straightened 00-00-02 Convoy clip'],
      [{ path: 'media/clip.mp4', time: 5, ops: [] }, 'Pan straightened 00-00-05 Convoy clip'],
    ]);
    const pieces = target.querySelectorAll('img.node');
    expect(pieces).toHaveLength(2);
    // each its box on the bent picture, back on the canvas
    await afterQuiet();
    const written = collagePosts().at(-1)[1].spec;
    expect(written.straightened).toBe(true);
    expect(written.nodes.map((n) => n.save.path)).toEqual([bent(2).path, bent(5).path]);
    const pad = body.nodes[0].quad[0][1];
    expect(written.nodes[0].quad).toEqual([[0, 3 - pad], [80, 3 - pad], [80, 66 - pad], [0, 66 - pad]]);
    expect(written.nodes[1].quad[0]).toEqual([80, -pad]);
    expect(toast).toHaveBeenCalledWith('Straightened the 2 pieces. Ctrl+Z puts them back', 'ok');
  });

  it('still reads as its video, the stretch of its pieces, never as a picture of its own', async () => {
    await start();
    button('Pan').click();
    await settle(20);
    expect(target.querySelector('.panel .from .from-when').textContent).toBe('0:02–0:05');
    unmount(live);
    live = null;
    target.remove();

    await straighten();
    expect(target.querySelector('.panel .from').textContent.replace(/\s+/g, ' ').trim()).toBe('From Convoy clip 0:02–0:05');
    // Mark to geolocate offers the video and its stretch, as before the bend
    expect(target.querySelector('.panel button[aria-label="More ways to mark"]')).not.toBeNull();
  });

  it('puts the pieces back on Ctrl+Z', async () => {
    await straighten();
    await afterQuiet();
    expect(collagePosts().at(-1)[1].spec.straightened).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    await afterQuiet();
    const written = collagePosts().at(-1)[1].spec;
    expect(written.nodes.map((n) => n.save)).toEqual([
      { path: 'media/clip.mp4', time: 2, ops: [] }, { path: 'media/clip.mp4', time: 5, ops: [] },
    ]);
    expect(written).not.toHaveProperty('straightened');
  });
});

describe('a cut', () => {
  beforeEach(() => {
    collages = [{ name: 'Strip', title: 'Strip', pieces: 1 }];
    saved.Strip = { name: 'Strip', title: 'Strip', spec: { width: 800, height: 400, transparent: true, nodes: [piece('media/roof.png')] } };
  });

  async function cutTo(bottom) {
    await start();
    button('Strip').click();
    await settle(20);
    button('Cut').click();
    flushSync();
    // the pane is not measured here, so the canvas reads the pointer as canvas pixels
    const edge = target.querySelector('[data-handle="s"]');
    edge.dispatchEvent(new MouseEvent('pointerdown', { clientX: 40, clientY: 60, button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: bottom, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: bottom, bubbles: true }));
    flushSync();
    button('Apply').click();
    flushSync();
  }

  it('keeps its frame with the collage and saves the picture cut to it', async () => {
    await cutTo(30);
    await afterQuiet();
    expect(collagePosts().at(-1)[1].spec.clip).toEqual({ x: 0, y: 0, w: 80, h: 30 });
    expect(target.textContent).toContain('Exports at 80 × 30 px.');

    [...document.querySelectorAll('.save .btn-primary')][0].click();
    await settle(20);
    const [, body] = post.mock.calls.find(([path]) => path.endsWith('/inspect/compose'));
    expect(body).toMatchObject({ width: 80, height: 30, clip: { x: 0, y: 0, w: 80, h: 30 } });
  });

  it('waits for a piece in the frame before it saves', async () => {
    saved.Strip.spec.clip = { x: 500, y: 0, w: 40, h: 40 };
    await start();
    button('Strip').click();
    await settle(20);
    expect(target.querySelector('[data-guide="collage.save"]').textContent).toContain('No piece lies in the cut. Move it or clear it.');
    expect(target.textContent).not.toContain('Exports at');
  });

  it('is one undo, and the piece stays whole', async () => {
    await cutTo(30);
    await afterQuiet();
    expect(target.querySelectorAll('img.node, .node.placeholder')).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    await afterQuiet();
    expect(collagePosts().at(-1)[1].spec).not.toHaveProperty('clip');
    expect(target.textContent).toContain('Exports at 80 × 60 px.');
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
