// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Mark to geolocate in the Collage tool: a collage of one video marks that video,
 * whole or over the stretch its pieces span, and one of several sources is a picture
 * marked whole once saved. Marked, it says where its scene stands, with Geolocate and
 * Make the proof.
 */

let listed = {};
const calls = [];
const respond = (method) => vi.fn(async (path, body) => {
  calls.push({ method, path, body });
  if (method === 'GET' && path.includes('/scenes?video=')) {
    const file = decodeURIComponent(path.split('video=')[1]);
    return structuredClone(listed[file] ?? { scenes: [], taken: [], collages: [], geolocating: null });
  }
  if (method === 'POST' && path.endsWith('/scenes/mark')) {
    const draft = { kind: 'draft', id: 'sc_new', video: body.path === 'media/Pan.png' ? 'media/Pan.png' : 'media/clip.mp4', start: body.start ?? null, end: body.end ?? null, label: '', state: 'todo', captures: [], abandoned: null };
    listed[draft.video] = { ...(listed[draft.video] ?? { taken: [], collages: [] }), scenes: [draft], geolocating: null };
    return { scene: draft };
  }
  if (method === 'PUT' && path.endsWith('/geolocating')) {
    return { geolocating: { video: body.video, id: body.draft, start: null, end: null, label: '', order: 0, captures: [], file_kind: body.video.endsWith('.png') ? 'image' : 'video' } };
  }
  if (method === 'DELETE' && path.endsWith('/geolocating')) return { ended: true };
  if (path.endsWith('/scenes/queue')) return { files: [], geolocating: null };
  return {};
});
const api = { get: respond('GET'), post: respond('POST'), put: respond('PUT'), del: respond('DELETE') };
vi.mock('../../lib/api.js', () => ({ api }));

const uiState = $state({ tool: 'collage', geolocateRef: null, inspectScene: null, openProof: null });
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', () => ({ uiState, toast, caseState: { current: { id: 'case-a' } } }));

const { default: CollageScene } = await import('./CollageScene.svelte');
const { geolocating } = await import('../../lib/geolocating.svelte.js');

let live;
let target;

async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  flushSync();
}

async function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageScene, { target, props: { caseId: 'case-a', name: 'Pan', save: vi.fn(async () => 'media/Pan.png'), ...props } });
  flushSync();
  await settle();
  return props;
}

const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const marks = () => calls.filter((c) => c.path.endsWith('/scenes/mark')).map((c) => c.body);
const ONE_VIDEO = { path: 'media/clip.mp4', times: [1.2, 2.4, 3.6] };

beforeEach(() => {
  listed = {};
  calls.length = 0;
  toast.mockClear();
  Object.assign(uiState, { tool: 'collage', geolocateRef: null, inspectScene: null, openProof: null });
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('a collage of one video', () => {
  it('marks the whole video on its press, its picture saved first', async () => {
    const save = vi.fn(async () => 'media/Pan.png');
    await show({ video: ONE_VIDEO, save });

    button('Mark to geolocate').click();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(marks()).toEqual([{ path: 'media/clip.mp4', label: '' }]);
    expect(target.querySelector('.where').textContent).toBe('Whole video');
    expect(target.querySelector('[data-testid="collage-scene-state"]').textContent).toBe('To geolocate');
  });

  it('marks the stretch its pieces span from its arrow, its picture already saved', async () => {
    const save = vi.fn();
    await show({ video: ONE_VIDEO, save, current: 'media/Pan.png', picture: 'media/Pan.png' });

    target.querySelector('button[aria-label="More ways to mark"]').click();
    flushSync();
    const stretch = button('Its stretch');
    expect(stretch.textContent).toContain('0:01–0:03');
    stretch.click();
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(marks()).toEqual([{ path: 'media/clip.mp4', label: '', start: 1.2, end: 3.6 }]);
    expect(target.querySelector('.where').textContent).toBe('In scene · 0:01–0:03');
  });

  it('marks a single piece as its instant', async () => {
    await show({ video: { path: 'media/clip.mp4', times: [5] }, current: 'media/Pan.png' });
    target.querySelector('button[aria-label="More ways to mark"]').click();
    flushSync();
    button('Its instant').click();
    await settle();
    expect(marks()).toEqual([{ path: 'media/clip.mp4', label: '', start: 5 }]);
  });

  it('shows the scene its pieces already fall in, by the times the server reads, rather than offering to mark', async () => {
    listed['media/clip.mp4'] = {
      scenes: [{ kind: 'draft', id: 'sc_b', video: 'media/clip.mp4', start: 10, end: 20, label: 'Bridge?', state: 'progress', captures: ['media/cap.png'], abandoned: null }],
      taken: [],
      // a frame saved from the video read back to its instant
      collages: [{ collage: 'Pan', times: [12, 15] }],
      geolocating: null,
    };
    await show({ video: { path: 'media/clip.mp4', times: [12] } });

    expect(button('Mark to geolocate')).toBeUndefined();
    expect(target.querySelector('.where').textContent).toBe('In scene · Bridge?');
    expect(target.querySelector('[data-testid="collage-scene-state"]').textContent).toBe('In progress · 1 capture');
  });

  it('geolocates its scene with the collage open beside the video, and stops on a second press', async () => {
    listed['media/clip.mp4'] = {
      scenes: [{ kind: 'draft', id: 'sc_all', video: 'media/clip.mp4', start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null }],
      taken: [], collages: [], geolocating: null,
    };
    await show({ video: ONE_VIDEO, current: 'media/Pan.png', picture: 'media/Pan.png' });

    button('Geolocate').click();
    await settle();
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({ video: 'media/clip.mp4', draft: 'sc_all' });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/clip.mp4', kind: 'video', picture: 'media/Pan.png' });
    expect(uiState.tool).toBe('satellite');

    uiState.tool = 'collage';
    flushSync();
    await settle();
    expect(target.querySelector('[data-testid="collage-scene-state"]').textContent).toBe('Geolocating');
    button('Stop').click();
    await settle();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(button('Geolocate')).toBeTruthy();
  });

  it('makes the proof through Inspect, on the scene, so its frames and collages come together', async () => {
    listed['media/clip.mp4'] = {
      scenes: [{ kind: 'draft', id: 'sc_all', video: 'media/clip.mp4', start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null }],
      taken: [], collages: [], geolocating: null,
    };
    await show({ video: ONE_VIDEO, current: 'media/Pan.png' });

    button('Make the proof').click();
    await settle();
    expect(uiState.inspectScene).toEqual({ video: 'media/clip.mp4', draft: 'sc_all', proof: true });
    expect(uiState.tool).toBe('inspect');
  });

  it('says a scene proved, and opens its proof', async () => {
    listed['media/clip.mp4'] = {
      scenes: [{ kind: 'proof', proof: 'Proof 3', title: 'Harbour bridge', moments: [{ start: 1, end: 4 }], at: [], points: [] }],
      taken: [], collages: [], geolocating: null,
    };
    await show({ video: ONE_VIDEO });

    expect(target.querySelector('.where').textContent).toBe('Harbour bridge');
    expect(target.querySelector('.proved').textContent).toContain('Proved');
    button('Open the proof').click();
    await settle();
    expect(uiState.openProof).toBe('Proof 3');
  });
});

describe('a collage of several sources', () => {
  it('saves its picture and marks it whole, with no arrow to pick a time', async () => {
    const save = vi.fn(async () => 'media/Pan.png');
    await show({ save });

    expect(target.querySelector('button[aria-label="More ways to mark"]')).toBeNull();
    button('Mark to geolocate').click();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(marks()).toEqual([{ path: 'media/Pan.png', label: '' }]);
  });

  it('waits while its picture cannot be saved, and says why', async () => {
    await show({ blocked: '1 piece lost its file. Remove it to save.' });
    expect(button('Mark to geolocate').disabled).toBe(true);
    expect(button('Mark to geolocate').title).toBe('1 piece lost its file. Remove it to save.');
  });

  it('saves a changed collage again before geolocating, so the mark follows its new picture', async () => {
    const draft = { kind: 'draft', id: 'sc_p', video: 'media/Pan.png', start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null, file_kind: 'image' };
    listed['media/Pan.png'] = { scenes: [draft], taken: [], collages: [], geolocating: null };
    listed['media/Pan 2.png'] = { scenes: [{ ...draft, video: 'media/Pan 2.png' }], taken: [], collages: [], geolocating: null };
    const save = vi.fn(async () => 'media/Pan 2.png');
    await show({ picture: 'media/Pan.png', current: null, save });

    expect(target.querySelector('.where').textContent).toBe('Whole picture');
    button('Geolocate').click();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({ video: 'media/Pan 2.png', draft: 'sc_p' });
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/Pan 2.png', kind: 'image' });
    expect(uiState.geolocateRef.picture).toBeUndefined();
  });
});
