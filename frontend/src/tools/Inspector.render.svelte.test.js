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
    for (const name of ['Info', 'Adjust', 'Moments']) {
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
    expect([...target.querySelectorAll('.ptab')].map((t) => t.textContent.trim())).toEqual(['Info', 'Adjust', 'Analyze']);
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
