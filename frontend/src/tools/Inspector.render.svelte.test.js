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
// a test that answers differently puts this back for the next one
const getDefault = get.getMockImplementation();
const put = vi.fn(async (path, body) => ({ name: body.path.includes('roof') ? 'Roof' : 'Convoy clip', title: 'x' }));
// A video asks for its hover strip and waveform as it opens; with nothing cached
// and no job to wait on, the bar is simply plainer.
const postDefault = async (path) => (path.endsWith('/inspect/overview') ? { scan: null } : { saved: [] });
const post = vi.fn(postDefault);
const del = vi.fn(async () => ({ status: 'deleted', deleted: ['e_work'], trash: 'g_1' }));
const patch = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, put, post, del, patch } }));

// Reactive, so a change made elsewhere in the case can reach the open file.
const caseState = $state({ current: { id: 'case-a', folders: [] }, rev: 0 });
const uiState = { tool: 'inspect', inspectPath: null, openInspect: null, focusMedia: null, toasts: [] };
const toast = vi.fn();
const dismissToast = vi.fn();
const reloadCase = vi.fn(async () => {});
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast, dismissToast, reloadCase }));
vi.mock('../lib/navigate.js', () => ({ openInReverseSearch: vi.fn(), openTodo: vi.fn() }));
const deletedToast = vi.fn();
vi.mock('../lib/trash.js', () => ({ deletedToast }));
// The Scenes tab as far as Inspect needs it here: a row's Make the proof, Geolocate,
// Abandon and Restore, each handing the tool its scene (the tab's own rows are driven
// in its tests). What it was last handed is kept, to read the rows' state.
let tabHeld = null;
vi.mock('./inspect/SceneTab.svelte', () => ({
  default: function SceneTabStub(anchor, props) {
    tabHeld = props;
    const acts = [
      ['Prove', (scene) => props.onmakeproof?.(scene)],
      ['Geolocate', (scene) => props.ongeolocate?.(scene)],
      ['Abandon', (scene) => props.onabandon?.(scene, 'no landmark')],
      ['Restore', (scene) => props.onrestore?.(scene)],
    ];
    const presses = [];
    for (const scene of props.scenes.filter((sc) => sc.kind === 'draft')) {
      for (const [word, act] of acts) {
        const press = document.createElement('button');
        press.textContent = `${word} ${scene.id}`;
        press.onclick = () => act(scene);
        anchor.before(press);
        presses.push(press);
      }
    }
    $effect(() => () => presses.forEach((press) => press.remove()));
  },
}));

const { default: Inspector } = await import('./Inspector.svelte');
const { geolocating } = await import('../lib/geolocating.svelte.js');
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
/** A picture opens on its Scenes tab: its Duplicate is on Adjust. */
function toAdjust() {
  [...target.querySelectorAll('.ptab')].find((t) => t.textContent.includes('Adjust')).click();
  flushSync();
}
/** The Scenes tab shown afresh, its stub handed the list as it stands. */
function showScenes() {
  [...target.querySelectorAll('.ptab')].find((t) => t.textContent.includes('Adjust')).click();
  flushSync();
  [...target.querySelectorAll('.ptab')].find((t) => t.textContent.includes('Scenes')).click();
  flushSync();
}

beforeEach(() => {
  // the To-do named once has its own test (`Inspector.scenes.render.svelte.test.js`)
  localStorage.setItem('azimut:sceneTodoHint', '1');
  saved = {};
  works = [];
  media = MEDIA;
  get.mockClear();
  get.mockImplementation(getDefault);
  put.mockClear();
  post.mockReset();
  post.mockImplementation(postDefault);
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
    toAdjust();
    button('Duplicate').click();
    flushSync();

    button('Files').click();
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
    toAdjust();

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

describe('saving a frame from the strip', () => {
  it('files it under its default name and last folder, while the clip stays open', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [frame('fr_a', 2), frame('fr_b', 5.5)], activeFrameId: null },
    };
    let answer;
    post.mockImplementation((path, body) => (
      path.endsWith('/save-frames') ? new Promise((resolve) => { answer = resolve; }) : postDefault(path, body)
    ));
    await start();
    await openFile('Convoy clip');
    await afterQuiet();

    target.querySelector('button[aria-label="Save frame"]').click();
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/inspect/save-frames', {
      items: [expect.objectContaining({ path: 'media/clip.mp4', time: 2, label: expect.stringContaining('Convoy clip') })],
      folder: null,
      notes: null,
    });
    const [first] = target.querySelectorAll('.strip > div.tile');
    expect(first.querySelector('[aria-label="Saving"]')).not.toBeNull();
    expect(target.querySelectorAll('button[aria-label="Save frame"]')).toHaveLength(1);
    expect(target.querySelector('.strip > button.tile').classList.contains('active')).toBe(true);

    media = [...MEDIA, { path: 'media/frame-a.png', kind: 'image', title: 'frame a', filename: 'frame-a.png' }];
    answer({ saved: [{ item: { path: 'media/frame-a.png' } }] });
    await settle();

    expect(first.querySelector('.filed')).not.toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Saved “.*Convoy clip.*” to the case$/), 'ok');
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
    // the dialog asks what the clear touches, and holds its button until the answer is in
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/delete-impact', {
      ids: [], paths: [], named: [{ tool: 'inspect', name: 'media/clip.mp4' }],
    });
    await settle(5);
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Clear work').pop();
    expect(confirm.disabled).toBe(false);
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
    toAdjust();
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
    // the same file under its new name, still on the tab it was looked at from
    expect(tab('Adjust').getAttribute('aria-selected')).toBe('true');
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

const press = (key, extra = {}) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
  flushSync();
};
const tab = (name) => [...target.querySelectorAll('.ptab')].find((t) => t.textContent.trim().startsWith(name));
/** Put the clip at `time`, the way the player hears it from the browser. */
function playheadAt(time) {
  const video = target.querySelector('video');
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: () => {} });
  video.dispatchEvent(new Event('timeupdate'));
  flushSync();
}
const renders = () => fetch.mock.calls.filter(([url]) => String(url).endsWith('/render-preview')).map(([, init]) => JSON.parse(init.body));

describe('the capture and the save, in reach whatever the panel shows', () => {
  it('keeps Capture frame above the video panel\'s tabs', async () => {
    await start();
    await openFile('Convoy clip');

    expect(target.querySelector('.pinned').textContent).toContain('Capture frame');
    for (const name of ['Scenes', 'Adjust', 'Moments', 'Info']) {
      tab(name).click();
      flushSync();
      expect(tab(name).getAttribute('aria-selected')).toBe('true');
      expect(target.querySelector('.pinned').textContent).toContain('Capture frame');
    }
  });

  it('keeps Save to case above a frame\'s tabs', async () => {
    await start();
    await openFile('Roof');

    expect(target.querySelector('.pinned').textContent).toContain('Save to case');
    expect([...target.querySelectorAll('.ptab')].map((t) => t.textContent.trim())).toEqual(['Scenes', 'Adjust', 'Analyze', 'Info']);
    tab('Analyze').click();
    flushSync();
    expect(target.querySelector('.pinned').textContent).toContain('Save to case');
    expect(target.textContent).toContain('Reverse image search');
  });

  it('offers to save the captured frames from the same place', async () => {
    await start();
    await openFile('Convoy clip');
    press('c');
    await settle(10);

    expect(target.querySelector('.pinned').textContent).toContain('Save the frame to the case');
  });
});

describe('capturing from the keyboard', () => {
  it('asks the server for the frame on screen, and keeps the timestamp it names', async () => {
    // the server's answer: 25 fps, so 0.5 s sits inside frame 12, which starts at 0.48
    fetch.mockImplementation(async (url, init) => {
      const { time } = JSON.parse(init.body);
      const headers = { 'Content-Type': 'image/png', 'X-Frame-Time': (Math.floor(time * 25 + 1e-6) / 25).toFixed(6) };
      return new Response(new Blob(['png'], { type: 'image/png' }), { headers });
    });
    await start();
    await openFile('Convoy clip');
    playheadAt(0.5);
    press('c');
    await settle(10);

    expect(renders().at(-1)).toMatchObject({ path: 'media/clip.mp4', time: 0.5, snap: true });
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.frames.map((f) => f.time)).toEqual([0.48]);
  });

  it('points at a frame already cut when the server names one in the strip', async () => {
    fetch.mockImplementation(async () => new Response(new Blob(['png']), { headers: { 'X-Frame-Time': '2.000000' } }));
    await start();
    await openFile('Convoy clip');
    playheadAt(2.01);
    press('c');
    await settle(10);
    playheadAt(2.03);
    press('c');
    await settle(10);

    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('already in the strip'), 'info', 2500);
  });

  it('shows the frame in the strip at once, and a second press on it only points at it', async () => {
    await start();
    await openFile('Convoy clip');
    playheadAt(2);
    press('c');
    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(1);
    press('c');
    await settle(10);

    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('already in the strip'), 'info', 2500);
  });

  it('leaves the keys alone while a field has the focus', async () => {
    await start();
    await openFile('Convoy clip');
    const name = target.querySelector('.file-name');
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    await settle(10);

    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(0);
  });
});

describe('marking a moment', () => {
  it('marks where the clip is, opens Moments on it, and keeps it with the work', async () => {
    await start();
    await openFile('Convoy clip');
    playheadAt(3.3);
    press('m');
    await settle();

    expect(tab('Moments').getAttribute('aria-selected')).toBe('true');
    const label = target.querySelector('.mark-label');
    expect(label).not.toBeNull();
    expect(document.activeElement).toBe(label);
    label.value = 'convoy turns left';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    await afterQuiet();

    const spec = put.mock.calls.at(-1)[1].spec;
    expect(spec.frames).toEqual([]);
    expect(spec.marks).toEqual([{ id: expect.any(String), time: expect.closeTo(3.28, 6), label: 'convoy turns left' }]);
  });

  it('brings a work\'s marks back with the clip', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [], marks: [{ id: 'mk_1', time: 7.2, label: 'flash' }], activeFrameId: null },
    };
    await start();
    await openFile('Convoy clip');
    tab('Moments').click();
    flushSync();

    expect(tab('Moments').textContent).toContain('1');
    expect(target.querySelector('.mark-label').value).toBe('flash');
    expect(target.querySelector('.mark-row .stamp').textContent).toBe('0:07.200');
    await afterQuiet();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('what the server read off the clip', () => {
  it('lays the sound under the bar and points the hover at the strip it drew', async () => {
    post.mockImplementation(async (path) => (path.endsWith('/inspect/overview')
      ? { overview: { duration: 20, tiles: { count: 20, columns: 10, rows: 2, width: 160, height: 90, interval: 1 }, waveform: [0.1, 0.4, 0.2] }, scan: null }
      : { saved: [] }));
    await start();
    await openFile('Convoy clip');
    await settle(10);

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/inspect/overview', { path: 'media/clip.mp4' });
    expect(target.querySelector('.track.waved canvas.wave')).not.toBeNull();
  });

  it('shows the shots a previous scan found as soon as the clip opens', async () => {
    post.mockImplementation(async (path) => (path.endsWith('/inspect/overview')
      ? { job_id: 'never', scan: { frames: [{ time: 4, score: 9, rank: 0 }], shots: [{ start: 0, end: 10, best: 4, score: 9 }, { start: 10, end: 20, best: 12, score: 5 }] } }
      : { saved: [] }));
    get.mockImplementation(async (path) => {
      if (path === '/api/jobs/never') return { status: 'running', progress: {} };
      if (path === '/api/inspect/ops') return structuredClone(OPS);
      if (path === '/api/cases/case-a/media') return structuredClone(media);
      if (path === '/api/cases/case-a/inspect/works') return [];
      if (path.startsWith('/api/cases/case-a/inspect/probe')) return { kind: 'video', duration: 20, fps: 25, width: 640, height: 360 };
      if (path.startsWith('/api/cases/case-a/inspect/work?path=')) return { work: null };
      return {};
    });
    await start();
    await openFile('Convoy clip');
    tab('Moments').click();
    flushSync();

    expect(target.textContent).toContain('2 shots');
    expect(target.querySelectorAll('.shot-card')).toHaveLength(2);
    expect(target.querySelectorAll('.track .shot')).toHaveLength(1);
  });
});

describe('zooming the bar\'s time', () => {
  /** The bar laid out 1000 px wide: 20 s at 25 fps zooms down to 1000 / 24 frames. */
  const measureBar = () => {
    target.querySelector('.track').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 30, right: 1000, bottom: 30 });
  };
  const reading = () => target.querySelector('button.bar-zoom');

  it('zooms with + and -, reads the zoom on the controls row, and a press there shows the whole clip', async () => {
    await start();
    await openFile('Convoy clip');
    measureBar();
    expect(reading()).toBeNull();
    press('+');
    expect(reading().textContent.trim()).toBe('×1.5');
    press('=');
    expect(reading().textContent.trim()).toBe('×2.2');
    press('-');
    expect(reading().textContent.trim()).toBe('×1.5');
    press('-');
    expect(reading()).toBeNull();

    press('+');
    reading().click();
    flushSync();
    expect(reading()).toBeNull();
  });

  it('opens the next file on the whole clip', async () => {
    await start();
    await openFile('Convoy clip');
    measureBar();
    press('+');
    expect(reading()).not.toBeNull();
    button('Files').click();
    await settle(10);
    await openFile('Convoy clip');
    expect(target.querySelector('.track')).not.toBeNull();
    expect(reading()).toBeNull();
  });
});

describe('holding O', () => {
  it('shows the picture without its adjustments for as long as it is held', async () => {
    await start();
    await openFile('Roof');
    press('o');
    expect(target.textContent).toContain('Without adjustments');
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'o', bubbles: true }));
    flushSync();
    expect(target.textContent).not.toContain('Without adjustments');
  });
});

describe('a capture still rendering', () => {
  it('leaves the other frames alone when it was removed and turns out to be one of them', async () => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [frame('fr_a', 2)], activeFrameId: null },
    };
    await start();
    await openFile('Convoy clip');
    let answer;
    fetch.mockImplementation((url, init) => (JSON.parse(init.body).snap
      ? new Promise((resolve) => { answer = resolve; })
      : Promise.resolve(new Response(new Blob(['png'])))));
    playheadAt(2.01);
    press('c');
    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(2);
    target.querySelectorAll('.strip > div.tile')[1].querySelector('button[aria-label="Remove frame"]').click();
    flushSync();

    answer(new Response(new Blob(['png']), { headers: { 'X-Frame-Time': '2.000000' } }));
    await settle(10);

    const tiles = target.querySelectorAll('.strip > div.tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].querySelector('.num').textContent).toBe('0:02.0');
  });
});

describe('the scenes of the clip, in the strip and in a proof', () => {
  const scenesRead = (scenes, used = {}) => {
    get.mockImplementation(async (path) => (path.startsWith('/api/cases/case-a/scenes?')
      ? { video: 'media/clip.mp4', video_id: 'e_clip', scenes: structuredClone(scenes), used: structuredClone(used) }
      : getDefault(path)));
  };
  const keep = (frames, scenes) => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames, scenes, activeFrameId: null },
    };
  };
  const tiles = () => [...target.querySelectorAll('.strip > div.tile')];
  const dialog = () => document.querySelector('[role="dialog"][aria-label="Make the proof"]');

  beforeEach(() => {
    uiState.tool = 'inspect';
    delete uiState.proofScene;
  });

  it('dots a frame in each scene it falls in, and says which proof lays it out', async () => {
    keep(
      [{ ...frame('fr_a', 2), filed: { path: 'media/frame-a.png', signature: 'x' } }, frame('fr_b', 5.5)],
      [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }],
    );
    scenesRead([], { 'media/frame-a.png': [{ proof: 'p29', title: 'Proof 29' }] });
    await start();
    await openFile('Convoy clip');
    await settle(10);

    const [inside, outside] = tiles();
    expect(inside.querySelectorAll('.scene-dot')).toHaveLength(1);
    expect(inside.querySelector('.scene-dots').title).toBe('In bridge?');
    expect(inside.querySelector('.pick').title).toContain('Used in Proof 29');
    expect(outside.querySelector('.scene-dots')).toBeNull();
    expect(outside.querySelector('.pick').title).not.toContain('Used in');
  });

  it('keeps a draft a proof took up in the work, hidden, so deleting the proof gives it back', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }, { id: 'sc_2', start: 8, end: null, label: '' }]);
    scenesRead([{ kind: 'proof', proof: 'Bridge', title: 'Bridge', moments: [{ start: 2, end: 3 }], at: [], stated: true, draft: 'sc_1' }]);
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();

    // one to prove: the proof's draft is not offered again
    expect([...target.querySelectorAll('button')].map((b) => b.textContent).filter((t) => t.startsWith('Prove'))).toEqual(['Prove sc_2']);
    press('m');
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes.map((sc) => sc.id)).toEqual(['sc_1', 'sc_2']);

    const bands = () => [...target.querySelectorAll('[data-testid="scene-band"]')].map((b) => b.style.left);
    expect(bands()).toEqual(['10%']);

    // the proof sent to the Trash elsewhere: the scene is back on the bar, at its own time
    scenesRead([]);
    caseState.rev += 1;
    await settle(10);
    expect(bands()).toEqual(['5%']);
  });

  it('takes in the scenes a proof gave back on its way to the Trash, once each', async () => {
    const draftRow = (id, start, end, label) => ({ kind: 'draft', id, start, end, label });
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    scenesRead([draftRow('sc_1', 1, 4, 'bridge?')]);
    await start();
    await openFile('Convoy clip');
    await settle(10);

    // a proof deleted elsewhere: its two moments come back as scenes to geolocate
    scenesRead([draftRow('sc_1', 1, 4, 'bridge?'), draftRow('sc_back1', 6, 8, 'Depot'), draftRow('sc_back2', 12, null, 'Depot')]);
    caseState.rev += 1;
    await settle(10);
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes.map((sc) => [sc.id, sc.start, sc.end, sc.label])).toEqual([
      ['sc_1', 1, 4, 'bridge?'], ['sc_back1', 6, 8, 'Depot'], ['sc_back2', 12, null, 'Depot'],
    ]);
    caseState.rev += 1;
    await settle(10);
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes).toHaveLength(3);

    // one taken back here before its removal was saved is not taken in again
    playheadAt(15);
    press('s');
    await afterQuiet();
    const kept = put.mock.calls.at(-1)[1].spec.scenes;
    expect(kept).toHaveLength(4);
    press('z', { ctrlKey: true });
    scenesRead(kept.map((sc) => draftRow(sc.id, sc.start, sc.end, sc.label)));
    caseState.rev += 1;
    await settle(10);
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes.map((sc) => sc.id)).toEqual(['sc_1', 'sc_back1', 'sc_back2']);
  });

  it('offers the scene\'s frames ticked, saves those not in the case, and hands the proof over', async () => {
    keep([frame('fr_a', 2), frame('fr_b', 5.5), frame('fr_c', 3.5)], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    post.mockImplementation(async (path, body) => (path.endsWith('/save-frames')
      ? { saved: body.items.map((item, i) => ({ item: { path: `media/saved-${item.time}-${i}.png` } })) }
      : postDefault(path, body)));
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    button('Prove sc_1').click();
    flushSync();

    expect(dialog()).not.toBeNull();
    expect([...dialog().querySelectorAll('input[type="checkbox"]')].map((b) => [b.getAttribute('aria-label'), b.checked]))
      .toEqual([['Frame at 0:02', true], ['Frame at 0:03.5', true]]);
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the proof').click();
    await settle(10);

    const filing = post.mock.calls.find(([path]) => path.endsWith('/save-frames'))[1];
    expect(filing.items.map((item) => item.time)).toEqual([2, 3.5]);
    expect(uiState.proofScene).toEqual({
      video: 'media/clip.mp4',
      moments: [{ start: 1, end: 4 }],
      draft: 'sc_1',
      panels: ['media/saved-2-0.png', 'media/saved-3.5-1.png'],
      label: 'bridge?',
    });
    expect(uiState.tool).toBe('proof');
    expect(dialog()).toBeNull();
  });

  it('captures the sharpest frame a scan found when the scene holds none', async () => {
    keep([frame('fr_b', 9)], [{ id: 'sc_1', start: 1, end: 4, label: '' }]);
    post.mockImplementation(async (path, body) => {
      if (path.endsWith('/inspect/overview')) return { scan: { frames: [{ time: 2.4, score: 9, rank: 0 }, { time: 9, score: 12, rank: 1 }], shots: [] } };
      if (path.endsWith('/save-frames')) return { saved: [{ item: { path: 'media/sharp.png' } }] };
      return {};
    });
    fetch.mockImplementation(async () => new Response(new Blob(['png']), { headers: { 'X-Frame-Time': '2.400000' } }));
    // the capture is a frame once its picture has loaded and been measured
    vi.stubGlobal('Image', class {
      set src(_url) {
        Object.assign(this, { naturalWidth: 640, naturalHeight: 360 });
        queueMicrotask(() => this.onload?.());
      }
    });
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    button('Prove sc_1').click();
    flushSync();

    expect(dialog().textContent).toContain('Captures and saves the sharpest frame of the scene, at 0:02.');
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the proof').click();
    await settle(10);

    expect(renders().at(-1)).toMatchObject({ path: 'media/clip.mp4', time: 2.4, snap: true });
    expect(post.mock.calls.find(([path]) => path.endsWith('/save-frames'))[1].items.map((item) => item.time)).toEqual([2.4]);
    expect(uiState.proofScene).toMatchObject({ draft: 'sc_1', label: '', panels: ['media/sharp.png'] });
    expect(tiles()).toHaveLength(2);
  });

  it('stays in Inspect when a frame cannot be saved, and says why', async () => {
    keep([frame('fr_a', 2)], [{ id: 'sc_1', start: 1, end: 4, label: '' }]);
    post.mockImplementation(async (path, body) => {
      if (path.endsWith('/save-frames')) throw new Error('disk full');
      return postDefault(path, body);
    });
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    button('Prove sc_1').click();
    flushSync();
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the proof').click();
    await settle(10);

    expect(toast).toHaveBeenCalledWith('disk full', 'danger');
    expect(uiState.tool).toBe('inspect');
    expect(uiState.proofScene).toBeUndefined();
    expect(dialog()).not.toBeNull();
  });
});

describe('geolocating a scene', () => {
  const draftRow = (id, start, end, label, extra = {}) => ({
    kind: 'draft', video: 'media/clip.mp4', id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
  });
  const keep = (frames, scenes) => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames, scenes, activeFrameId: null },
    };
  };
  let listed = [];
  let held = null;
  const sceneReads = () => get.mock.calls.filter(([path]) => path.startsWith('/api/cases/case-a/scenes?')).length;

  beforeEach(() => {
    listed = [draftRow('sc_1', 1, 4, 'bridge?')];
    held = null;
    tabHeld = null;
    // the app's copy of the scene being geolocated, unread
    Object.assign(geolocating, { caseId: null, scene: null, error: '' });
    uiState.tool = 'inspect';
    uiState.geolocateRef = null;
    delete uiState.proofScene;
    delete uiState.inspectScene;
    get.mockImplementation(async (path) => (path.startsWith('/api/cases/case-a/scenes?')
      ? { video: 'media/clip.mp4', video_id: 'e_clip', scenes: structuredClone(listed), used: {}, geolocating: held }
      : getDefault(path)));
    put.mockImplementation(async (path, body) => {
      if (path === '/api/cases/case-a/geolocating') {
        held = body.draft;
        return { geolocating: { ...listed.find((sc) => sc.id === body.draft) ?? draftRow(body.draft, 6, null, ''), since: 't' } };
      }
      const abandon = /\/scenes\/([^/]+)\/abandon$/.exec(path);
      if (abandon) {
        const row = listed.find((sc) => sc.id === abandon[1]);
        Object.assign(row, { state: 'abandoned', abandoned: { reason: body.reason, at: 't' } });
        return { scene: structuredClone(row) };
      }
      return { name: 'Convoy clip', title: 'x' };
    });
    del.mockImplementation(async (path) => {
      const restore = /\/scenes\/([^/]+)\/abandon\?/.exec(path);
      if (restore) {
        const row = listed.find((sc) => sc.id === restore[1]);
        Object.assign(row, { state: 'todo', abandoned: null });
        return { scene: structuredClone(row) };
      }
      return { status: 'deleted', deleted: ['e_work'], trash: 'g_1' };
    });
  });

  afterEach(() => {
    put.mockImplementation(async (path, body) => ({ name: body.path.includes('roof') ? 'Roof' : 'Convoy clip', title: 'x' }));
    del.mockImplementation(async () => ({ status: 'deleted', deleted: ['e_work'], trash: 'g_1' }));
  });

  it('writes the work first, then holds the scene on the server and goes to the map with its video', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    await start();
    await openFile('Convoy clip');
    await settle(10);
    // a scene kept a moment ago, its save still pending
    playheadAt(6);
    press('s');
    showScenes();
    const fresh = tabHeld.scenes.find((sc) => sc.kind === 'draft' && sc.id !== 'sc_1');
    button(`Geolocate ${fresh.id}`).click();
    await settle(10);

    const paths = put.mock.calls.map(([path]) => path);
    expect(paths.indexOf('/api/cases/case-a/inspect/work')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('/api/cases/case-a/inspect/work')).toBeLessThan(paths.indexOf('/api/cases/case-a/geolocating'));
    expect(put.mock.calls.find(([path]) => path === '/api/cases/case-a/geolocating')[1]).toEqual({ video: 'media/clip.mp4', draft: fresh.id });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/clip.mp4', draft: fresh.id });
    expect(uiState.tool).toBe('satellite');
  });

  it('marks the scene the server says is being geolocated, with what it gathered', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }, { id: 'sc_2', start: 8, end: null, label: '' }]);
    listed = [draftRow('sc_1', 1, 4, 'bridge?', { state: 'progress', captures: ['media/cap.png'] }), draftRow('sc_2', 8, null, '')];
    held = 'sc_1';
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    const rows = Object.fromEntries(tabHeld.scenes.map((sc) => [sc.id, sc]));
    expect(rows.sc_1).toMatchObject({ state: 'progress', captures: ['media/cap.png'], geolocating: true });
    expect(rows.sc_2).toMatchObject({ state: 'todo', captures: [] });
    expect(rows.sc_2.geolocating).toBeUndefined();
  });

  it('stops the scene in hand when its Geolocate is pressed again, staying in Inspect', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    listed = [draftRow('sc_1', 1, 4, 'bridge?', { state: 'progress', captures: ['media/cap.png'] })];
    held = 'sc_1';
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    const before = sceneReads();
    del.mockClear();
    put.mockClear();
    button('Geolocate sc_1').click();
    await settle(10);
    expect(del).toHaveBeenCalledWith('/api/cases/case-a/geolocating');
    expect(put.mock.calls.some(([path]) => path === '/api/cases/case-a/geolocating')).toBe(false);
    expect(uiState.tool).not.toBe('satellite');
    expect(sceneReads()).toBeGreaterThan(before);
  });

  it('abandons a scene with its word, reads the list again, and takes it back from the toast', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    toast.mockImplementation(() => 1);
    await start();
    await openFile('Convoy clip');
    await settle(10);
    showScenes();
    const before = sceneReads();
    button('Abandon sc_1').click();
    await settle(10);

    expect(put).toHaveBeenCalledWith('/api/cases/case-a/scenes/sc_1/abandon', { video: 'media/clip.mp4', reason: 'no landmark' });
    expect(sceneReads()).toBeGreaterThan(before);
    showScenes();
    expect(tabHeld.scenes.find((sc) => sc.id === 'sc_1')).toMatchObject({ state: 'abandoned', abandoned: { reason: 'no landmark' } });
    // greyed on the bar, still where it was
    expect(target.querySelector('[data-testid="scene-band"]').classList.contains('abandoned')).toBe(true);

    const [message, , , action] = toast.mock.calls.find(([text]) => text === 'Scene abandoned');
    expect(message).toBe('Scene abandoned');
    action.onClick();
    await settle(10);
    expect(del).toHaveBeenCalledWith('/api/cases/case-a/scenes/sc_1/abandon?video=media%2Fclip.mp4');
    showScenes();
    expect(tabHeld.scenes.find((sc) => sc.id === 'sc_1')).toMatchObject({ state: 'todo', abandoned: null });
    toast.mockReset();
  });

  it('opens a scene sent from elsewhere on its row, and with proof, its Make the proof holding its captures', async () => {
    media = [...MEDIA, { path: 'media/cap.png', kind: 'image', title: 'Bridge from above', filename: 'cap.png', thumbnail: 'thumbs/cap.jpg', source: { type: 'satellite' } }];
    keep([frame('fr_a', 2), frame('fr_b', 9)], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    listed = [draftRow('sc_1', 1, 4, 'bridge?', { state: 'progress', captures: ['media/cap.png'] })];
    post.mockImplementation(async (path, body) => (path.endsWith('/save-frames')
      ? { saved: body.items.map((item) => ({ item: { path: `media/saved-${item.time}.png` } })) }
      : postDefault(path, body)));
    uiState.inspectScene = { video: 'media/clip.mp4', draft: 'sc_1', proof: true };
    await start();
    await settle(10);
    await settle(10);

    expect(uiState.inspectScene).toBeNull();
    expect(tabHeld?.focus).toEqual({ key: 'sc_1', n: 1 });
    const dialog = document.querySelector('[role="dialog"][aria-label="Make the proof"]');
    expect(dialog).not.toBeNull();
    expect([...dialog.querySelectorAll('input[type="checkbox"]')].map((b) => [b.getAttribute('aria-label'), b.checked]))
      .toEqual([['Frame at 0:02', true], ['Capture Bridge from above', true]]);
    expect(dialog.querySelector('[aria-label="Captures of the scene"] img').getAttribute('src')).toContain('thumbs/cap.jpg');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the proof').click();
    await settle(10);
    // the frames first, then the captures
    expect(uiState.proofScene.panels).toEqual(['media/saved-2.png', 'media/cap.png']);
    expect(uiState.tool).toBe('proof');
  });

  it('says so when the scene sent is no longer in its video', async () => {
    keep([], [{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    uiState.inspectScene = { video: 'media/clip.mp4', draft: 'sc_gone' };
    await start();
    await settle(10);
    await settle(10);
    expect(toast).toHaveBeenCalledWith('That scene is no longer in this video', 'warn');
    expect(target.querySelector('video')).not.toBeNull();
  });
});

describe('a frame captured in no scene', () => {
  let seq = 0;
  const offers = () => uiState.toasts.filter((t) => Array.isArray(t.action) && t.action.some((a) => a.label === 'This instant'));
  const choice = (t, label) => t.action.find((a) => a.label === label);
  const keep = (scenes) => {
    saved['media/clip.mp4'] = {
      name: 'Convoy clip',
      title: 'Convoy clip',
      spec: { source: { path: 'media/clip.mp4', kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [], scenes, activeFrameId: null },
    };
  };
  async function captureAt(time) {
    playheadAt(time);
    press('c');
    await settle(10);
  }

  beforeEach(() => {
    uiState.toasts = [];
    // the toasts as the app keeps them, so one can be rewritten in place
    toast.mockImplementation((message, kind, timeout, action) => {
      uiState.toasts.push({ id: ++seq, message, kind, action });
      return seq;
    });
    dismissToast.mockImplementation((id) => {
      const index = uiState.toasts.findIndex((t) => t.id === id);
      if (index !== -1) uiState.toasts.splice(index, 1);
    });
    // the server names the frame at 25 fps, and the picture loads
    fetch.mockImplementation(async (url, init) => {
      const { time } = JSON.parse(init.body);
      const headers = { 'X-Frame-Time': (Math.floor(time * 25 + 1e-6) / 25).toFixed(6) };
      return new Response(new Blob(['png'], { type: 'image/png' }), { headers });
    });
    vi.stubGlobal('Image', class {
      set src(_url) {
        Object.assign(this, { naturalWidth: 640, naturalHeight: 360 });
        queueMicrotask(() => this.onload?.());
      }
    });
  });

  afterEach(() => {
    toast.mockReset();
    dismissToast.mockReset();
  });

  it('offers to add a scene there, which keeps an instant the way S does', async () => {
    await start();
    await openFile('Convoy clip');
    await captureAt(2.01);

    const [offer] = offers();
    expect(offer.message).toBe('Frame captured at 0:02 · Add a scene');
    expect(offer.action.map((a) => a.label)).toEqual(['Whole video', 'This instant']);
    choice(offer, 'This instant').onClick();
    flushSync();

    expect(toast).toHaveBeenCalledWith('Scene kept at 0:02', 'info', 6000, expect.objectContaining({ label: 'Undo' }));
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes).toEqual([{ id: expect.any(String), start: 2, end: null, label: '' }]);
    expect(target.querySelectorAll('.strip > div.tile .scene-dot')).toHaveLength(1);
  });

  it('keeps a scene about the whole video, and asks nothing more of that clip', async () => {
    await start();
    await openFile('Convoy clip');
    await captureAt(2.01);

    choice(offers()[0], 'Whole video').onClick();
    flushSync();
    expect(toast).toHaveBeenCalledWith('Scene kept for the whole video', 'info', 6000, expect.objectContaining({ label: 'Undo' }));
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes).toEqual([{ id: expect.any(String), start: null, end: null, label: '' }]);

    uiState.toasts = [];
    await captureAt(6.01);
    expect(offers()).toEqual([]);
  });

  it('asks nothing of a frame already in a scene', async () => {
    keep([{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    await start();
    await openFile('Convoy clip');
    await captureAt(2.51);

    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(1);
    expect(offers()).toEqual([]);
  });

  it('keeps one offer through quick captures, pointing at the latest', async () => {
    await start();
    await openFile('Convoy clip');
    await captureAt(6.01);
    await captureAt(8.01);

    expect(target.querySelectorAll('.strip > div.tile')).toHaveLength(2);
    const all = offers();
    expect(all.map((t) => t.message)).toEqual(['Frame captured at 0:08 · Add a scene']);
    choice(all[0], 'This instant').onClick();
    await afterQuiet();
    expect(put.mock.calls.at(-1)[1].spec.scenes.map((sc) => sc.start)).toEqual([8]);
  });

  it('keeps quiet once a scene is kept with S', async () => {
    await start();
    await openFile('Convoy clip');
    await captureAt(6.01);
    expect(offers()).toHaveLength(1);
    playheadAt(10);
    press('s');
    expect(offers()).toEqual([]);
    await captureAt(12.01);
    expect(offers()).toEqual([]);
  });

  it('offers nothing on an image', async () => {
    await start();
    await openFile('Roof');
    press('c');
    await settle(10);
    expect(offers()).toEqual([]);
  });

  it('offers no whole video beside scenes holding passages, a video being one place or several', async () => {
    keep([{ id: 'sc_1', start: 1, end: 4, label: 'bridge?' }]);
    await start();
    await openFile('Convoy clip');
    await captureAt(8.01);

    const [offer] = offers();
    expect(offer.action.map((a) => a.label)).toEqual(['This instant']);
  });
});
