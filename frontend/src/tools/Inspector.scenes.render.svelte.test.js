// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Scenes tab inside Inspect, driven through the real tab: which row is open, what
 * S and Shift+S do beside it, the empty strip's invitation, the To-do named once, and
 * a picture marked whole.
 */

const CLIP = 'media/clip.mp4';
const ROOF = 'media/roof.png';
const MEDIA = [
  { path: ROOF, kind: 'image', title: 'Roof', filename: 'roof.png', entity_id: 'e_roof', source: { type: 'upload' } },
  { path: CLIP, kind: 'video', title: 'Convoy clip', filename: 'clip.mp4', entity_id: 'e_clip', source: { type: 'upload' } },
  { path: 'media/cap.png', kind: 'image', title: 'From above', filename: 'cap.png', entity_id: 'e_cap', source: { type: 'satellite' } },
  { path: 'media/frame.png', kind: 'image', title: 'A frame', filename: 'frame.png', entity_id: 'e_frame', source: { type: 'inspect', op: 'frame', from: CLIP, time: 2 } },
];
const OPS = {
  filters: [{ id: 'brightness', label: 'Brightness', params: [{ name: 'value', default: 1, min: 0, max: 2, step: 0.05 }], css: 'brightness({v})' }],
  analyses: [],
};

let saved = {};
let listed = {}; // what the server lists for each file: { scenes, taken, geolocating }
let held = null; // the scene the server holds as being geolocated
let overview = { scan: null };

const row = (id, start, end, label, extra = {}) => ({
  kind: 'draft', id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
});
const proofRow = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name, moments: [], at: [], stated: false, draft: null, points: [{}], ...extra,
});
const kept = (id, start, end, label) => ({ id, start, end, label });
const work = (path, scenes, kind = 'video') => {
  saved[path] = {
    name: 'Work',
    title: 'Work',
    spec: { source: { path, kind }, videoAdjust: {}, videoRotation: 0, frames: [], marks: [], scenes, activeFrameId: null },
  };
};

const decoded = (path) => decodeURIComponent(path.split('=')[1]);
const get = vi.fn(async (path) => {
  if (path === '/api/inspect/ops') return structuredClone(OPS);
  if (path === '/api/cases/case-a/media') return structuredClone(MEDIA);
  if (path === '/api/cases/case-a/inspect/works') return [];
  if (path.startsWith('/api/cases/case-a/inspect/probe')) {
    return path.includes('clip') ? { kind: 'video', duration: 20, fps: 25, width: 640, height: 360 } : { kind: 'image', width: 80, height: 60 };
  }
  if (path.startsWith('/api/cases/case-a/inspect/work?path=')) {
    const found = saved[decoded(path)];
    return { work: found ? structuredClone(found) : null };
  }
  if (path.startsWith('/api/cases/case-a/scenes?')) {
    const answer = listed[decoded(path)] ?? {};
    return { scenes: [], taken: [], used: {}, geolocating: null, ...structuredClone(answer) };
  }
  return {};
});
const put = vi.fn(async (path, body) => {
  if (path === '/api/cases/case-a/geolocating') {
    held = body.draft;
    return { geolocating: { video: body.video, id: body.draft, start: null, end: null, label: '', order: 0 } };
  }
  return { name: 'Work', title: 'x' };
});
const post = vi.fn(async (path) => (path.endsWith('/inspect/overview') ? structuredClone(overview) : { saved: [] }));
const del = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, put, post, del, patch: vi.fn() } }));

const caseState = $state({ current: { id: 'case-a', folders: [] }, rev: 0 });
const uiState = $state({ tool: 'inspect', inspectPath: null, openInspect: null, inspectScene: null, proofScene: null, geolocateRef: null, focusMedia: null, todoHint: false, toasts: [] });
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast, dismissToast: vi.fn(), reloadCase: vi.fn(async () => {}) }));
vi.mock('../lib/navigate.js', () => ({ openInReverseSearch: vi.fn(), openInHorizon: vi.fn() }));
vi.mock('../lib/trash.js', () => ({ deletedToast: vi.fn() }));

const { default: Inspector } = await import('./Inspector.svelte');
const { geolocating } = await import('../lib/geolocating.svelte.js');
const { retimed } = await import('../lib/sceneRetime.svelte.js');

let live;
let target;

async function settle(ms = 0) {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  flushSync();
}
const afterQuiet = () => settle(1000);

async function start() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Inspector, { target });
  flushSync();
  await settle();
}

async function openFile(title) {
  [...target.querySelectorAll('.card')].find((c) => c.textContent.includes(title)).click();
  await settle();
  await settle(10);
}

const panelTabs = () => [...target.querySelectorAll('.ptab')];
const tab = (name) => panelTabs().find((t) => t.textContent.trim().startsWith(name));
const picked = () => panelTabs().find((t) => t.getAttribute('aria-selected') === 'true').textContent.trim();
const pick = (name) => {
  tab(name).click();
  flushSync();
};
const rows = () => [...target.querySelectorAll('[data-testid="scene-row"]')];
const openRow = () => rows().find((r) => r.classList.contains('open')) ?? null;
const inside = (node, text) => [...node.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const press = (key, extra = {}, on = document.body) => {
  on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
  flushSync();
};
function playheadAt(time) {
  const video = target.querySelector('video');
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: () => {} });
  video.dispatchEvent(new Event('timeupdate'));
  flushSync();
}
const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
const field = (name) => target.querySelector(`input[aria-label="${name}"]`);
/** A press at `x` on the bar, 100 px wide over the 20 s clip, so 5 px to the second. */
function pressBar(x) {
  const track = target.querySelector('.track');
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 });
  track.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, bubbles: true }));
  track.dispatchEvent(new PointerEvent('pointerup', { clientX: x, button: 0, bubbles: true }));
  flushSync();
}
const lastSpec = () => put.mock.calls.filter(([path]) => path.endsWith('/inspect/work')).at(-1)?.[1].spec;
const toasts = (text) => toast.mock.calls.filter(([message]) => message.includes(text));

beforeEach(() => {
  saved = {};
  listed = {};
  held = null;
  overview = { scan: null };
  get.mockClear();
  put.mockClear();
  post.mockClear();
  del.mockClear();
  toast.mockClear();
  uiState.tool = 'inspect';
  uiState.inspectScene = null;
  uiState.proofScene = null;
  uiState.geolocateRef = null;
  uiState.todoHint = false;
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
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

// First in the file: the hint is asked for once for a module's life.
describe('the first scene ever kept', () => {
  it('asks the app to point at the To-do while it is due, the toast keeping its plain words and Undo', async () => {
    await start();
    await openFile('Convoy clip');
    playheadAt(2);
    press('s');

    expect(uiState.todoHint).toBe(true);
    const [message, , , action] = toasts('Scene kept')[0];
    expect(message).toBe('Scene kept at 0:02');
    expect(action.label).toBe('Undo');
    action.onClick();
    flushSync();
    expect(rows()).toHaveLength(0);

    // the app gave it (App.svelte): never asked again in this browser
    uiState.todoHint = false;
    localStorage.setItem('azimut:sceneTodoHint', '1');
    playheadAt(4);
    press('s');
    expect(uiState.todoHint).toBe(false);
    expect(toasts('Scene kept')[1][0]).toBe('Scene kept at 0:04');
    localStorage.clear();
  });

  it('asks only for a scene kept, never for a time moved or a scene removed', async () => {
    localStorage.removeItem('azimut:sceneTodoHint');
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    type(field('Scene start'), '2');
    await settle();
    expect(uiState.todoHint).toBe(false);
  });
});

describe('the Scenes tab on a video', () => {
  it('comes first, Info last, and counts the scenes, tinted while some are still to prove', async () => {
    work(CLIP, [kept('sc_1', 1, 4, 'bridge?')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, 4, 'bridge?'), proofRow('Depot', { moments: [{ start: 6, end: 8 }] })] };
    await start();
    await openFile('Convoy clip');

    expect(panelTabs().map((t) => t.textContent.replace(/\d/g, '').trim())).toEqual(['Scenes', 'Adjust', 'Moments', 'Info']);
    expect(picked()).toContain('Scenes');
    expect(tab('Scenes').querySelector('.count').textContent).toBe('2');
    expect(tab('Scenes').querySelector('.count').classList.contains('todo')).toBe(true);
  });

  it('drops the tint once every scene is proved, and counts no abandoned one', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, 4, '', { state: 'abandoned', abandoned: { reason: '', at: 't' } }), proofRow('Depot')] };
    await start();
    await openFile('Convoy clip');
    expect(tab('Scenes').querySelector('.count').textContent).toBe('1');
    expect(tab('Scenes').querySelector('.count').classList.contains('todo')).toBe(false);
  });

  it('keeps the tab in use while the file stays open, and a frame of the clip has none of its own', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    saved[CLIP].spec.frames = [{ id: 'fr_a', path: CLIP, time: 2, adjust: { brightness: 1 }, crop: null, sourceOps: [], rotation: 0, w: 640, h: 360, filed: null }];
    await start();
    await openFile('Convoy clip');
    pick('Moments');
    target.querySelector('.strip .pick').click();
    await settle(10);
    expect(panelTabs().map((t) => t.textContent.trim())).toEqual(['Adjust', 'Analyze', 'Info']);
    expect(picked()).toBe('Adjust');
    target.querySelector('.tile.source').click();
    await settle(10);
    expect(picked()).toContain('Moments');
  });

  it('opens every file on its Scenes tab, whatever tab the last was left on', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    saved[CLIP].spec.frames = [{ id: 'fr_a', path: CLIP, time: 2, adjust: { brightness: 1 }, crop: null, sourceOps: [], rotation: 0, w: 640, h: 360, filed: null }];
    saved[CLIP].spec.activeFrameId = 'fr_a';
    const back = async () => {
      target.querySelector('.tool-header .btn').click();
      await settle(10);
    };
    await start();
    // a video on the clip itself, not on the frame it was left on
    await openFile('Convoy clip');
    expect(picked()).toContain('Scenes');
    expect(target.querySelector('.tile.source').classList.contains('active')).toBe(true);
    pick('Info');
    await back();
    // a picture, marked or not
    await openFile('Roof');
    expect(picked()).toBe('Scenes');
    pick('Analyze');
    await back();
    // a capture and a frame have no Scenes, and keep the tab they had
    await openFile('From above');
    expect(panelTabs().map((t) => t.textContent.trim())).toEqual(['Adjust', 'Analyze', 'Info']);
    expect(picked()).toBe('Analyze');
    await back();
    await openFile('A frame');
    expect(picked()).toBe('Analyze');
    await back();
    await openFile('Convoy clip');
    expect(picked()).toContain('Scenes');
    await back();
    await openFile('Roof');
    expect(picked()).toBe('Scenes');
  });

  it('opens the first row until one is touched, a press opening another alone, the clip going there', async () => {
    work(CLIP, [kept('sc_1', 1, 4, 'bridge?'), kept('sc_2', 8, null, '')]);
    await start();
    await openFile('Convoy clip');

    expect(rows()).toHaveLength(2);
    expect(openRow().dataset.sceneKey).toBe('sc_1');
    expect(field('Scene start').value).toBe('0:01');
    expect(field('Scene end').value).toBe('0:04');
    expect(target.querySelector('[data-testid="scene-grip-end"]')).not.toBeNull();

    rows()[1].click();
    await settle();
    expect(openRow().dataset.sceneKey).toBe('sc_2');
    expect(target.querySelectorAll('.editor')).toHaveLength(1);
    expect(target.querySelector('.player-time .now').textContent).toBe('0:08.000');
    expect(target.querySelector('[data-testid="scene-grip-end"]')).toBeNull();
  });

  it('leaves a clip of proofs folded, a proof\'s time opened only when asked', async () => {
    listed[CLIP] = { scenes: [proofRow('Depot', { moments: [{ start: 6, end: 8 }] })] };
    await start();
    await openFile('Convoy clip');
    expect(rows()).toHaveLength(1);
    expect(openRow()).toBeNull();
    rows()[0].click();
    await settle();
    expect(openRow().textContent).toContain('Depot');
    expect(target.querySelector('.player-time .now').textContent).toBe('0:06.000');
  });

  it('keeps a proof\'s frames pinned on the bar with its row open', async () => {
    listed[CLIP] = { scenes: [proofRow('Depot', { at: [4] })] };
    await start();
    await openFile('Convoy clip');
    rows()[0].click();
    await settle();
    expect(target.querySelectorAll('[data-testid="scene-pin"]')).toHaveLength(1);
  });

  it('opens the one under the playhead on landing in the tab, else the last touched', async () => {
    work(CLIP, [kept('sc_1', 1, 4, ''), kept('sc_2', 8, 12, ''), kept('sc_3', 15, null, '')]);
    await start();
    await openFile('Convoy clip');
    rows()[1].click();
    await settle();

    pick('Adjust');
    expect(target.querySelector('.editor')).toBeNull();
    expect(target.querySelector('[data-testid="scene-grip-start"]')).toBeNull();
    pick('Scenes');
    await settle();
    expect(openRow().dataset.sceneKey).toBe('sc_2');

    pick('Adjust');
    playheadAt(2);
    pick('Scenes');
    await settle();
    expect(openRow().dataset.sceneKey).toBe('sc_1');
  });

  it('keeps a scene with S whichever row is open, opens it from any tab, and leaves the keys to the player', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    pick('Adjust');
    playheadAt(9);
    press('s');
    await settle();

    expect(picked()).toContain('Scenes');
    expect(rows()).toHaveLength(2);
    expect(openRow().querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Instant');
    expect(field('Scene start').value).toBe('0:09');
    expect(document.activeElement).toBe(document.body);

    // again, on a passage this time: S never moves the open row
    playheadAt(12);
    press('s');
    await settle();
    expect(rows()).toHaveLength(3);
    await afterQuiet();
    expect(lastSpec().scenes.map((sc) => [sc.start, sc.end])).toEqual([[1, 4], [9, null], [12, null]]);
  });

  it('ends the open scene with Shift+S or End here, at once, its fields following', async () => {
    work(CLIP, [kept('sc_1', 1, null, ''), kept('sc_2', 2, null, '')]);
    await start();
    await openFile('Convoy clip');
    rows()[0].click();
    await settle();
    playheadAt(5);
    press('S', { shiftKey: true });
    await settle();

    expect(openRow().dataset.sceneKey).toBe('sc_1');
    expect(field('Scene end').value).toBe('0:05.04');
    expect(inside(openRow(), 'Apply')).toBeUndefined();
    await afterQuiet();
    expect(lastSpec().scenes.find((sc) => sc.id === 'sc_1').end).toBeCloseTo(5.04, 6);
    // the latest started before it, as ever, when the tab is not on one
    pick('Adjust');
    playheadAt(9);
    press('S', { shiftKey: true });
    await settle();
    expect(picked()).toContain('Scenes');
    expect(openRow().dataset.sceneKey).toBe('sc_2');
    expect(field('Scene end').value).toBe('0:09.04');
  });

  it('leaves the open row as it was when there is nothing to end', async () => {
    work(CLIP, [kept('sc_1', null, null, 'town?')]);
    await start();
    await openFile('Convoy clip');
    press('S', { shiftKey: true });
    await settle();
    expect(openRow().querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Whole video');
    expect(target.querySelector('.editor')).not.toBeNull();
    expect(toasts('Scene ends')).toHaveLength(0);
  });

  it('drops the word being asked when another row is opened', async () => {
    work(CLIP, [kept('sc_1', 1, null, ''), kept('sc_2', 8, null, '')]);
    await start();
    await openFile('Convoy clip');
    inside(openRow(), 'Abandon').click();
    await settle();
    expect(field('Why it is abandoned')).not.toBeNull();
    rows()[1].click();
    await settle();
    rows()[0].click();
    await settle();
    expect(field('Why it is abandoned')).toBeNull();
    expect(inside(openRow(), 'Geolocate')).toBeDefined();
  });

  it('applies a changed time with Enter, drops it with Escape, and Escape again folds the row', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    const start_ = field('Scene start');
    type(start_, '2');
    expect(inside(openRow(), 'Apply')).toBeDefined();
    press('Escape');
    await settle();
    expect(field('Scene start').value).toBe('0:01');
    expect(inside(openRow(), 'Apply')).toBeUndefined();
    expect(openRow()).not.toBeNull();

    type(field('Scene start'), '2');
    press('Enter');
    await settle();
    expect(field('Scene start').value).toBe('0:02');
    expect(inside(openRow(), 'Apply')).toBeUndefined();
    expect(toasts('Scene now 0:02–0:04')).toHaveLength(1);
    await afterQuiet();
    expect(lastSpec().scenes[0].start).toBe(2);

    press('Escape');
    await settle();
    expect(openRow()).toBeNull();
    expect(rows()[0].tagName).toBe('BUTTON');
    // the clip's history took the time: Ctrl+Z puts it back, the row closed or not
    press('z', { ctrlKey: true });
    await settle();
    expect(rows()[0].textContent).toContain('0:01–0:04');
  });

  it('follows the scene when its time moves under the open row', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    type(field('Scene start'), '2');
    press('Enter');
    await settle();
    press('z', { ctrlKey: true });
    await settle();
    expect(field('Scene start').value).toBe('0:01');
    press('z', { ctrlKey: true, shiftKey: true });
    await settle();
    expect(field('Scene start').value).toBe('0:02');
  });

  it('keeps a time that reads as one when the tab is left, and leaves one that does not', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    type(field('Scene start'), '2');
    pick('Adjust');
    await settle();
    expect(toasts('Scene now 0:02–0:04')).toHaveLength(1);
    pick('Scenes');
    await settle();
    type(field('Scene start'), 'soon');
    pick('Adjust');
    await settle();
    pick('Scenes');
    await settle();
    expect(field('Scene start').value).toBe('0:02');
  });

  it('keeps a time changed before Geolocate and Make the proof act on the scene', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, 4, '')] };
    await start();
    await openFile('Convoy clip');
    type(field('Scene start'), '2');
    inside(openRow(), 'Geolocate').click();
    await settle(10);

    const paths = put.mock.calls.map(([path]) => path);
    expect(paths.indexOf('/api/cases/case-a/inspect/work')).toBeLessThan(paths.indexOf('/api/cases/case-a/geolocating'));
    expect(lastSpec().scenes[0].start).toBe(2);
    expect(uiState.tool).toBe('satellite');
  });

  it('offers Make the proof on the time just changed', async () => {
    work(CLIP, [kept('sc_1', 1, 4, '')]);
    await start();
    await openFile('Convoy clip');
    type(field('Scene start'), '2');
    target.querySelector('[aria-label="Make the proof"]').click();
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="Make the proof"]').textContent).toContain('0:02–0:04');
  });

  it('opens the Scenes tab on a pin pressed on the bar from any tab, and on a band only from Scenes', async () => {
    work(CLIP, [kept('sc_1', 2, 6, 'bridge?'), kept('sc_2', 10, null, '')]);
    await start();
    await openFile('Convoy clip');
    pick('Adjust');
    // a band pressed from another tab moves the clip and nothing else
    pressBar(20); // 4 s, inside the band
    await settle();
    expect(picked()).toBe('Adjust');
    expect(target.querySelector('.player-time .now').textContent).toBe('0:04.000');

    pressBar(50); // the pin at 10 s
    await settle();
    expect(picked()).toContain('Scenes');
    expect(openRow().dataset.sceneKey).toBe('sc_2');
    expect(target.querySelector('.player-time .now').textContent).toBe('0:10.000');

    // on the Scenes tab, the band opens its scene
    pressBar(20);
    await settle();
    expect(openRow().dataset.sceneKey).toBe('sc_1');
    expect(openRow().classList.contains('lit')).toBe(true);
    // away from either, only the clip moves
    pressBar(80);
    await settle();
    expect(openRow().dataset.sceneKey).toBe('sc_1');
  });

  it('unfolds the abandoned scene pressed on the bar', async () => {
    work(CLIP, [kept('sc_1', 2, 6, 'bridge?'), kept('sc_2', 10, null, '')]);
    listed[CLIP] = { scenes: [row('sc_1', 2, 6, 'bridge?', { state: 'abandoned', abandoned: { reason: 'gone', at: 't' } }), row('sc_2', 10, null, '')] };
    await start();
    await openFile('Convoy clip');
    pressBar(20);
    await settle(5);
    expect(target.querySelector('[data-testid="scene-row-abandoned"]').textContent).toContain('gone');
    expect(openRow().dataset.sceneKey).toBe('sc_2');
  });

  it('keeps the whole video from the arrow, once, and a shot without leaving Moments', async () => {
    overview = { scan: { frames: [], shots: [{ start: 3, best: 3.5, score: 9 }, { start: 8, best: 9, score: 7 }] } };
    await start();
    await openFile('Convoy clip');
    target.querySelector('[aria-label="More ways to mark"]').click();
    flushSync();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('Whole video')).click();
    await settle();
    expect(openRow().querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Whole video');
    target.querySelector('[aria-label="More ways to mark"]').click();
    flushSync();
    expect([...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes('Whole video')).disabled).toBe(true);
    target.querySelector('[aria-label="More ways to mark"]').click();
    flushSync();

    pick('Moments');
    target.querySelector('[title="Keep this shot as a scene to geolocate"]').click();
    await settle();
    expect(picked()).toContain('Moments');
    expect(tab('Scenes').querySelector('.count').textContent).toBe('2');
  });

  it('offers no scene key on a frame of the clip', async () => {
    work(CLIP, []);
    saved[CLIP].spec.frames = [{ id: 'fr_a', path: CLIP, time: 2, adjust: { brightness: 1 }, crop: null, sourceOps: [], rotation: 0, w: 640, h: 360, filed: null }];
    await start();
    await openFile('Convoy clip');
    target.querySelector('.strip .pick').click();
    await settle(10);
    press('s');
    expect(toasts('Scene kept')).toHaveLength(0);
  });
});

describe('the collages of the clip', () => {
  const PAN = { collage: 'Pan', title: 'Harbour pan', export: 'media/Pan.png', current: true, times: [1.5, 3], start: 1.5, end: 3 };

  it('hang under the scene they fall in, and open in the Collage tool', async () => {
    work(CLIP, [kept('sc_1', 1, 4, 'Bridge?'), kept('sc_2', 10, 12, '')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, 4, 'Bridge?'), row('sc_2', 10, 12, '')], collages: [PAN] };
    await start();
    await openFile('Convoy clip');

    const lines = [...target.querySelectorAll('[data-testid="scene-collage"]')];
    expect(lines.map((el) => el.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Harbour pan 0:01–0:03']);
    expect(lines[0].closest('ul').previousElementSibling.dataset.sceneKey).toBe('sc_1');
    lines[0].click();
    expect(uiState.openCollage).toBe('Pan');
    expect(uiState.tool).toBe('collage');
  });

  it('take up a time their scene was given in the Collage tool, so the next save keeps it', async () => {
    work(CLIP, [kept('sc_1', 1, 4, 'Bridge?'), kept('sc_2', 10, 12, '')]);
    await start();
    await openFile('Convoy clip');
    expect(field('Scene start').value).toBe('0:01');

    Object.assign(retimed, { caseId: 'case-a', video: CLIP, draft: 'sc_1', start: 2, end: 6, n: retimed.n + 1 });
    await settle();
    expect(field('Scene start').value).toBe('0:02');
    expect(field('Scene end').value).toBe('0:06');
    await afterQuiet();
    expect(lastSpec().scenes).toEqual([kept('sc_1', 2, 6, 'Bridge?'), kept('sc_2', 10, 12, '')]);

    // another video's scene is none of its business
    put.mockClear();
    Object.assign(retimed, { caseId: 'case-a', video: 'media/other.mp4', draft: 'sc_2', start: 0, end: 1, n: retimed.n + 1 });
    await afterQuiet();
    expect(put.mock.calls.filter(([path]) => path.endsWith('/inspect/work'))).toHaveLength(0);
  });

  it('come into the scene\'s proof by their saved picture, with no frame to capture', async () => {
    work(CLIP, [kept('sc_1', 1, 4, 'Bridge?')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, 4, 'Bridge?')], collages: [PAN, { ...PAN, collage: 'Unsaved', export: null }] };
    await start();
    await openFile('Convoy clip');

    target.querySelector('[aria-label="Make the proof"]').click();
    await settle();
    const chooser = document.querySelector('[role="dialog"][aria-label="Make the proof"]');
    expect(chooser.textContent).toContain('1 of 1 collage in the proof');
    expect(chooser.textContent).not.toContain('No frame in this scene yet');
    [...chooser.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the proof').click();
    await settle(10);
    expect(uiState.proofScene).toMatchObject({ video: CLIP, draft: 'sc_1', panels: ['media/Pan.png'] });
    expect(uiState.tool).toBe('proof');
  });
});

describe('the empty strip', () => {
  const invite = () => target.querySelector('[data-testid="scene-invite"]');

  it('asks on a video with nothing marked once the list is read, and goes at the first scene', async () => {
    let answer;
    const reading = new Promise((resolve) => (answer = resolve));
    const plain = get.getMockImplementation();
    get.mockImplementation(async (path) => {
      if (path.startsWith('/api/cases/case-a/scenes?')) await reading;
      return plain(path);
    });
    await start();
    await openFile('Convoy clip');
    // a clip that may have proofs resting on it is not asked yet
    expect(invite()).toBeNull();
    expect(target.querySelector('.strip').textContent).toContain('Frames you capture are kept with this video.');
    answer();
    await settle(5);
    get.mockImplementation(plain);

    expect(invite().textContent).toContain('Several places in this video?');
    inside(invite(), 'This moment').click();
    await settle();
    expect(invite()).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('keeps the whole video from its second press', async () => {
    await start();
    await openFile('Convoy clip');
    inside(invite(), 'Whole video').click();
    await settle();
    expect(invite()).toBeNull();
    await afterQuiet();
    expect(lastSpec().scenes).toEqual([{ id: expect.any(String), start: null, end: null, label: '' }]);
  });

  it('asks nothing of a clip with a proof resting on it, frames in it, or an abandoned scene', async () => {
    listed[CLIP] = { scenes: [proofRow('Depot')] };
    await start();
    await openFile('Convoy clip');
    expect(invite()).toBeNull();

    listed[CLIP] = { scenes: [] };
    work(CLIP, [kept('sc_1', 1, null, '')]);
    listed[CLIP] = { scenes: [row('sc_1', 1, null, '', { state: 'abandoned', abandoned: { reason: '', at: 't' } })] };
    target.querySelector('.tool-header .btn').click();
    await settle(10);
    await openFile('Convoy clip');
    expect(invite()).toBeNull();
  });

  it('remembers Not now for that file, and says what it said before', async () => {
    await start();
    await openFile('Convoy clip');
    inside(invite(), 'Not now').click();
    await settle();
    expect(invite()).toBeNull();
    expect(target.querySelector('.strip').textContent).toContain('Frames you capture are kept with this video.');

    target.querySelector('.tool-header .btn').click();
    await settle(10);
    await openFile('Convoy clip');
    expect(invite()).toBeNull();
    localStorage.clear();
  });
});

describe('a picture', () => {
  it('offers Scenes first, Mark to geolocate in it, and files nothing until pressed', async () => {
    await start();
    await openFile('Roof');
    expect(panelTabs().map((t) => t.textContent.trim())).toEqual(['Scenes', 'Adjust', 'Analyze', 'Info']);
    expect(picked()).toBe('Scenes');
    expect(inside(target.querySelector('[data-scene-panel]'), 'Mark to geolocate')).toBeDefined();
    await afterQuiet();
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps one whole scene in its work, undone from the toast before anything is written', async () => {
    await start();
    await openFile('Roof');
    pick('Scenes');
    inside(target.querySelector('[data-scene-panel]'), 'Mark to geolocate').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(tab('Scenes').querySelector('.count').classList.contains('todo')).toBe(true);
    expect(toasts('Picture marked to geolocate')).toHaveLength(1);
    await afterQuiet();
    expect(lastSpec().scenes).toEqual([{ id: expect.any(String), start: null, end: null, label: '' }]);

    const [, , , action] = toasts('Picture marked to geolocate')[0];
    (Array.isArray(action) ? action.at(-1) : action).onClick();
    await settle();
    expect(rows()).toHaveLength(0);
    await afterQuiet();
    expect(lastSpec().scenes).toEqual([]);
  });

  it('takes in a mark made from the Media Library rather than write over it', async () => {
    work(ROOF, [kept('sc_m', null, null, 'Market')], 'image');
    listed[ROOF] = { scenes: [row('sc_m', null, null, 'Market')] };
    await start();
    await openFile('Roof');
    pick('Scenes');
    expect(field('Scene label').value).toBe('Market');
    expect(inside(target.querySelector('[data-scene-panel]'), 'Mark to geolocate')).toBeUndefined();

    // marked elsewhere while it was open, with no work read for it
    listed[ROOF] = { scenes: [row('sc_m', null, null, 'Market'), row('sc_n', null, null, 'Then')] };
    caseState.rev += 1;
    await settle(10);
    await afterQuiet();
    expect(lastSpec().scenes.map((sc) => sc.id)).toEqual(['sc_m', 'sc_n']);
  });

  it('writes the work, then geolocates it, from the same rows as a video', async () => {
    await start();
    await openFile('Roof');
    pick('Scenes');
    inside(target.querySelector('[data-scene-panel]'), 'Mark to geolocate').click();
    await settle();
    const id = rows()[0].dataset.sceneKey;
    inside(rows()[0], 'Geolocate').click();
    await settle(10);

    const paths = put.mock.calls.map(([path]) => path);
    expect(paths.indexOf('/api/cases/case-a/inspect/work')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('/api/cases/case-a/inspect/work')).toBeLessThan(paths.indexOf('/api/cases/case-a/geolocating'));
    expect(put.mock.calls.find(([path]) => path === '/api/cases/case-a/geolocating')[1]).toEqual({ video: ROOF, draft: id });
    expect(uiState.tool).toBe('satellite');
  });

  it('makes the proof of the picture and its captures, stating no scene', async () => {
    work(ROOF, [kept('sc_m', null, null, 'Market?')], 'image');
    listed[ROOF] = { scenes: [row('sc_m', null, null, 'Market?', { state: 'progress', captures: ['media/cap.png'] })] };
    await start();
    await openFile('Roof');
    pick('Scenes');
    target.querySelector('[aria-label="Make the proof"]').click();
    await settle();
    expect(uiState.proofScene).toEqual({ picture: ROOF, panels: [ROOF, 'media/cap.png'], label: 'Market?' });
    expect(uiState.tool).toBe('proof');
    expect(document.querySelector('[role="dialog"][aria-label="Make the proof"]')).toBeNull();
  });

  it('opens from the pill on its tab, and with proof, its Make the proof', async () => {
    work(ROOF, [kept('sc_m', null, null, 'Market')], 'image');
    listed[ROOF] = { scenes: [row('sc_m', null, null, 'Market')] };
    uiState.inspectScene = { video: ROOF, draft: 'sc_m', proof: true };
    await start();
    await settle(10);
    await settle(10);
    expect(uiState.inspectScene).toBeNull();
    expect(picked()).toContain('Scenes');
    expect(uiState.proofScene).toEqual({ picture: ROOF, panels: [ROOF], label: 'Market' });
  });

  it('says so when the scene sent is no longer in it', async () => {
    uiState.inspectScene = { video: ROOF, draft: 'sc_gone' };
    await start();
    await settle(10);
    await settle(10);
    expect(toast).toHaveBeenCalledWith('That scene is no longer in this picture', 'warn');
  });

  it('shows the proof laying it out, and no second mark', async () => {
    work(ROOF, [kept('sc_m', null, null, 'Market')], 'image');
    listed[ROOF] = { scenes: [proofRow('p12', { title: 'Proof 12' })], taken: ['sc_m'] };
    await start();
    await openFile('Roof');
    pick('Scenes');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Proved · Proof 12');
    expect(tab('Scenes').querySelector('.count').classList.contains('todo')).toBe(false);
    rows()[0].click();
    await settle();
    expect(uiState.openProof).toBe('p12');
    expect(uiState.tool).toBe('proof');
    uiState.openProof = null;
  });

  it('has no Scenes on a capture or a frame cut from a video, and reads none', async () => {
    await start();
    await openFile('From above');
    expect(panelTabs().map((t) => t.textContent.trim())).toEqual(['Adjust', 'Analyze', 'Info']);
    target.querySelector('.tool-header .btn').click();
    await settle(10);
    await openFile('A frame');
    expect(panelTabs().map((t) => t.textContent.trim())).toEqual(['Adjust', 'Analyze', 'Info']);
    expect(get.mock.calls.some(([path]) => path.startsWith('/api/cases/case-a/scenes?'))).toBe(false);
  });
});
