// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The pill over the tools while the open case geolocates a scene: it reads which one
 * when a case opens, counts the captures gathered for it, goes back to it in Inspect,
 * opens its Make the proof there, and stops.
 */

const answers = new Map();
const calls = [];
vi.mock('../lib/api.js', () => {
  const request = (method) => async (path) => {
    calls.push(`${method} ${path}`);
    const key = `${method} ${path}`;
    if (!answers.has(key)) throw new Error(`unexpected ${key}`);
    return structuredClone(answers.get(key));
  };
  return { api: { get: request('GET'), put: request('PUT'), del: request('DELETE'), post: request('POST') } };
});

const caseState = $state({ current: { id: 'c1' }, rev: 0 });
const uiState = $state({ tool: 'satellite', inspectScene: null, geolocateRef: null });
const toast = vi.fn();
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast, fmtCoords: (lat, lon) => `${lat}, ${lon}` }));

const { default: GeolocatingPill } = await import('./GeolocatingPill.svelte');
const { paths } = await import('./Icon.svelte');
const cameraPath = paths.camera;
const { geolocating, holdInGeoProof } = await import('../lib/geolocating.svelte.js');
const { sceneColorAt } = await import('../lib/scenes.js');
const { dispatch } = await import('../lib/events.js');

const SCENE = {
  kind: 'draft', video: 'media/convoy.mp4', id: 'sc_1', start: 238, end: 252, label: 'bridge?',
  state: 'progress', captures: ['media/cap-1.png'], footage: 4, abandoned: null, since: 't',
};

let live = null;
let target = null;

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  flushSync();
}

async function show() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(GeolocatingPill, { target });
  flushSync();
  await settle();
}

const pill = () => target.querySelector('.geo-pill');
const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

beforeEach(() => {
  answers.clear();
  calls.length = 0;
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
  caseState.current = { id: 'c1' };
  uiState.tool = 'satellite';
  uiState.inspectScene = null;
  toast.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the pill', () => {
  it('reads the scene the case is geolocating when the case opens, and shows nothing without one', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: null });
    await show();
    expect(calls).toEqual(['GET /api/cases/c1/geolocating']);
    expect(pill()).toBeNull();
  });

  it('says what is being geolocated, when in the clip, and what the map and the video gave it', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    expect(pill().getAttribute('aria-label')).toBe('Geolocating · 3:58–4:12 · bridge?');
    expect(pill().querySelector('.geo-time').textContent).toBe('3:58–4:12');
    expect(pill().querySelector('.geo-label').textContent).toBe('bridge?');
    const count = target.querySelector('[data-testid="geolocating-count"]');
    expect(count.querySelector('[data-testid="count-map"]').textContent.trim()).toBe('1');
    expect(count.querySelector('[data-testid="count-video"]').textContent.trim()).toBe('4');
    expect(count.querySelector('[data-testid="scene-counts"]').title).toBe('Geolocating: 1 map capture, 4 pictures from the video');
    // the camera and its one number are gone
    expect(count.querySelector(`path[d="${cameraPath}"]`)).toBeNull();
    // its file by what the case calls it, else its name without the extension
    expect(button('Geolocating').getAttribute('title')).toBe('Open the scene in Inspect, on convoy');
  });

  it('names its file by its title in Media when the server says one', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, file_title: 'Convoy on the coast road' } });
    await show();
    expect(button('Geolocating').getAttribute('title')).toBe('Open the scene in Inspect, on Convoy on the coast road');
  });

  it('says the first moment of a scene showing its place again and counts the rest, every one on hover', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, start: 0, end: 7, more: [{ start: 65, end: 72 }] } });
    await show();
    const time = pill().querySelector('.geo-time');
    expect(time.textContent).toBe('0:00–0:07 +1');
    expect(time.getAttribute('title')).toBe('0:00–0:07 · 1:05–1:12');
    expect(pill().getAttribute('aria-label')).toBe('Geolocating · 0:00–0:07 · 1:05–1:12 · bridge?');
  });

  it('dots the scene in the colour Inspect\'s bar draws it in, by its place in the clip', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, order: 2 } });
    await show();
    const dot = target.querySelector('[data-testid="geolocating-dot"]');
    expect(dot.style.getPropertyValue('--scene')).toBe(sceneColorAt(2));
  });

  it('words an instant and the whole video, and leaves an unnamed scene its time alone', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, start: null, end: null, label: '' } });
    await show();
    expect(pill().getAttribute('aria-label')).toBe('Geolocating · Whole video');
    expect(pill().querySelector('.geo-time').classList.contains('mono')).toBe(false);
    expect(pill().querySelector('.geo-label')).toBeNull();
  });

  it('names a picture as a picture, its Make the proof going through Inspect the same way', async () => {
    const picture = { ...SCENE, video: 'media/harbour.png', start: null, end: null, label: 'Harbour wall', file_kind: 'image' };
    answers.set('GET /api/cases/c1/geolocating', { geolocating: picture });
    await show();
    expect(target.querySelector('.geo-pill').getAttribute('aria-label')).toBe('Geolocating · Whole picture · Harbour wall');
    expect(target.querySelector('.geo-time').textContent).toBe('Whole picture');
    expect(target.querySelector('.geo-time').classList.contains('mono')).toBe(false);
    const make = target.querySelector('.geo-make');
    expect(make.title).toBe('Make the proof from the picture and its captures');
    make.click();
    expect(uiState.inspectScene).toEqual({ video: 'media/harbour.png', draft: 'sc_1', proof: true });
    expect(uiState.tool).toBe('inspect');
  });

  it('keeps a video’s words for a video', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, file_kind: 'video' } });
    await show();
    expect(target.querySelector('.geo-make').title).toBe('Make the proof from its frames and captures');
    expect(target.querySelector('.geo-time').textContent).toBe('3:58–4:12');
  });

  it('steps the count up with a pulse when a capture is gathered, rather than a toast', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    const count = () => target.querySelector('[data-testid="geolocating-count"] [data-testid="count-map"]');
    expect(count().classList.contains('bump')).toBe(false);
    geolocating.scene = { ...SCENE, captures: ['media/cap-1.png', 'media/cap-2.png'] };
    flushSync();
    expect(count().textContent.trim()).toBe('2');
    expect(count().classList.contains('bump')).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('steps up on the server’s word that a capture was gathered, before it is read again', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    const count = () => target.querySelector('[data-testid="geolocating-count"] [data-testid="count-map"]');
    const two = { ...SCENE, captures: ['media/cap-1.png', 'media/cap-2.png'] };
    answers.set('GET /api/cases/c1/geolocating', { geolocating: two });
    calls.length = 0;
    dispatch({ type: 'geolocating', case_id: 'c1', video: SCENE.video, draft: SCENE.id, capture: 'media/cap-2.png', captures: 2 });
    flushSync();
    // nothing read yet, and the pill says it already
    expect(calls).toEqual(['GET /api/cases/c1/geolocating']);
    expect(count().textContent.trim()).toBe('2');
    expect(count().classList.contains('bump')).toBe(true);
    expect(target.querySelector('[data-testid="scene-counts"]').title).toBe('Geolocating: 2 map captures, 4 pictures from the video');
    await settle();
    expect(count().textContent.trim()).toBe('2');
    // and it goes the moment it ends
    answers.set('GET /api/cases/c1/geolocating', { geolocating: null });
    dispatch({ type: 'geolocating', case_id: 'c1', video: null, draft: null });
    flushSync();
    expect(pill()).toBeNull();
    await settle();
    expect(pill()).toBeNull();
  });

  it('reads it again when the case reloads while one is held, as a capture reloads it', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    caseState.rev += 1;
    flushSync();
    await settle();
    expect(calls).toEqual(['GET /api/cases/c1/geolocating', 'GET /api/cases/c1/geolocating']);
  });

  it('reads it again when its video\'s scenes are saved, and only then', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    dispatch({ type: 'scenes', case_id: 'c1', video: 'media/other.mp4' });
    dispatch({ type: 'scenes', case_id: 'c2', video: 'media/convoy.mp4' });
    await settle();
    expect(calls).toHaveLength(1);
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, label: 'road bridge' } });
    dispatch({ type: 'scenes', case_id: 'c1', video: 'media/convoy.mp4' });
    await settle();
    expect(calls).toHaveLength(2);
    expect(pill().querySelector('.geo-label').textContent).toBe('road bridge');
  });

  it('belongs to its case: another case open, it goes', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    answers.set('GET /api/cases/c2/geolocating', { geolocating: null });
    await show();
    caseState.current = { id: 'c2' };
    flushSync();
    expect(pill()).toBeNull();
    await settle();
    expect(calls.at(-1)).toBe('GET /api/cases/c2/geolocating');
  });

  it('goes back to the scene in Inspect, or to its Make the proof there', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    button('Geolocating').click();
    expect(uiState.inspectScene).toEqual({ video: 'media/convoy.mp4', draft: 'sc_1' });
    expect(uiState.tool).toBe('inspect');

    uiState.tool = 'horizon';
    button('Make the proof').click();
    expect(uiState.inspectScene).toEqual({ video: 'media/convoy.mp4', draft: 'sc_1', proof: true });
    expect(uiState.tool).toBe('inspect');
  });

  it('stops on ✕, and says so when it could not', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    answers.set('DELETE /api/cases/c1/geolocating', { ended: true });
    await show();
    target.querySelector('[aria-label="Stop geolocating"]').click();
    await settle();
    expect(calls.at(-1)).toBe('DELETE /api/cases/c1/geolocating');
    expect(pill()).toBeNull();

    geolocating.caseId = 'c1';
    geolocating.scene = SCENE;
    flushSync();
    answers.delete('DELETE /api/cases/c1/geolocating');
    target.querySelector('[aria-label="Stop geolocating"]').click();
    await settle();
    expect(toast).toHaveBeenCalledWith('unexpected DELETE /api/cases/c1/geolocating', 'danger');
  });
});

describe('what the scene gathered, and the links', () => {
  const LEAD = { id: 'ld_1', n: 2, lat: 15.3547, lon: 44.2066 };
  const GATHERED = {
    geolocating: { ...SCENE, leads: [LEAD] },
    leads: [LEAD],
    captures: [{ path: 'media/cap-1.png', title: 'cap-1', thumb: 'media/.thumbs/cap-1.jpg' }],
    frames: [
      { id: 'f1', time: 240.5, path: 'media/frame-1.png', thumb: null },
      { id: 'f2', time: 245, path: null, thumb: null, edits: { rotation: 90 } },
    ],
    collages: [{ name: 'quay', title: 'Quay', path: null, thumb: null }],
  };
  const panel = () => document.querySelector('[data-testid="gathered-panel"]');
  const inBody = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

  // a frame never saved is drawn from its video; unless a test says, the server cannot
  let drawFrame = async () => ({ ok: false });
  const renders = [];
  const revoked = [];
  beforeEach(() => {
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
    drawFrame = async () => ({ ok: false });
    renders.length = 0;
    revoked.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      renders.push({ url, ...JSON.parse(init.body) });
      return drawFrame();
    }));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:f2');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revoked.push(url));
    answers.set('GET /api/inspect/ops', { filters: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function opened(scene = { ...SCENE, leads: [LEAD] }) {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: scene });
    answers.set('GET /api/cases/c1/geolocating/gathered', GATHERED);
    await show();
    target.querySelector('[data-testid="geolocating-count"]').click();
    await settle();
  }

  it('counts the scene’s leads beside what the map and the video gave it, only when it has some', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    expect(target.querySelector('[data-testid="count-leads"]')).toBeNull();
    geolocating.scene = { ...SCENE, leads: [LEAD, { ...LEAD, id: 'ld_2', n: 3 }] };
    flushSync();
    // the scene's own counts carry them, as everywhere a scene is counted
    expect(target.querySelector('[data-testid="count-leads"]').textContent.trim()).toBe('2');
    expect(target.querySelector('[data-testid="scene-counts"]').getAttribute('title')).toContain('2 leads');
  });

  it('lists its leads, captures, frames and collages from its counts, and closes on Escape', async () => {
    await opened();
    expect(calls).toContain('GET /api/cases/c1/geolocating/gathered');
    const list = panel();
    expect([...list.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Leads', 'Map captures', 'Frames', 'Collages']);
    expect(list.querySelector('.num').textContent).toBe('2');
    expect(list.querySelector('img').getAttribute('src')).toBe('/files/c1/media/.thumbs/cap-1.jpg');
    // a frame never saved to the case says so, and opens Inspect on the scene
    list.querySelector('.shot.unsaved').click();
    expect(uiState).toMatchObject({ tool: 'inspect', inspectScene: { video: 'media/convoy.mp4', draft: 'sc_1' } });
    await settle();
    expect(panel()).toBeNull();

    target.querySelector('[data-testid="geolocating-count"]').click();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(panel()).toBeNull();
  });

  it('draws a frame never saved from its video while the list is open, and lets it go when it closes', async () => {
    drawFrame = async () => ({ ok: true, blob: async () => new Blob(['jpeg']) });
    await opened();
    await vi.waitFor(() => expect(panel().querySelector('.shot.unsaved img')).not.toBeNull());
    // through the edits Inspect keeps for it, as Make the proof draws it
    expect(renders).toEqual([{
      url: '/api/cases/c1/inspect/render-preview', path: 'media/convoy.mp4', time: 245, ops: [{ op: 'rotate', params: { angle: 90 } }], format: 'jpeg',
    }]);
    const shot = panel().querySelector('.shot.unsaved');
    expect(shot.querySelector('img').getAttribute('src')).toBe('blob:f2');
    expect(shot.title).toBe('Not saved to the case yet: open the scene in Inspect');
    // the list read again draws nothing twice
    geolocating.scene = { ...geolocating.scene, footage: 5 };
    await settle();
    expect(renders).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(panel()).toBeNull();
    expect(revoked).toEqual(['blob:f2']);
  });

  it('keeps the dashed chip for a frame its video cannot draw', async () => {
    await opened();
    await vi.waitFor(() => expect(renders).toHaveLength(1));
    await settle();
    const shot = panel().querySelector('.shot.unsaved');
    expect(shot.querySelector('img')).toBeNull();
    expect(shot.querySelector('svg')).not.toBeNull();
  });

  it('shows a lead on the map, and deletes one in a press', async () => {
    await opened();
    panel().querySelector('.row.lead .main').click();
    expect(uiState.gotoCoords).toEqual({ lat: 15.3547, lon: 44.2066, zoom: 17 });
    expect(uiState.tool).toBe('satellite');

    target.querySelector('[data-testid="geolocating-count"]').click();
    await settle();
    answers.set('DELETE /api/cases/c1/geolocating/leads/ld_1', { geolocating: SCENE });
    panel().querySelector('[aria-label="Delete lead 2"]').click();
    await settle();
    expect(calls).toContain('DELETE /api/cases/c1/geolocating/leads/ld_1');
    expect(geolocating.scene.leads).toBeUndefined();
  });

  it('takes a frame off Inspect’s strip behind a dialog, its saved picture staying in Media', async () => {
    await opened();
    panel().querySelector('[aria-label="Take the frame at 4:00.500 off the strip"], [aria-label^="Take the frame at"]').click();
    flushSync();
    expect(document.body.textContent).toContain('Its picture saved to the case stays in Media.');
    answers.set('DELETE /api/cases/c1/geolocating/frames/f1', { video: 'media/convoy.mp4', frame: 'f1', geolocating: { ...SCENE, footage: 3 } });
    inBody('Remove').click();
    await settle();
    expect(calls).toContain('DELETE /api/cases/c1/geolocating/frames/f1');
    expect(geolocating.scene.footage).toBe(3);
  });

  it('sends a capture to the Trash behind the dialog that says what it touches', async () => {
    await opened();
    answers.set('POST /api/cases/c1/delete-impact', { blocking: [], cascade: [], tombstone: [], touched: [], counts: { blocking: 0, cascade: 0, tombstone: 0, touched: 0 } });
    panel().querySelector('[aria-label="Delete cap-1"]').click();
    await settle();
    expect(calls).toContain('POST /api/cases/c1/delete-impact');
    answers.set('DELETE /api/cases/c1/satellite?path=media%2Fcap-1.png', { deleted: ['e1'], trash: 't1' });
    inBody('Delete').click();
    await settle();
    expect(calls).toContain('DELETE /api/cases/c1/satellite?path=media%2Fcap-1.png');
    expect(toast).toHaveBeenCalledWith('Deleted “cap-1”', 'info', 7000, expect.anything());
  });

  it('opens the proof that took the scene up, with the captures it lacks, rather than making a second', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, proof: 'road-bridge' } });
    await show();
    expect(button('Make the proof')).toBeUndefined();
    button('Open the proof').click();
    expect(uiState.openProof).toEqual({ name: 'road-bridge', add: ['media/cap-1.png'] });
    expect(uiState.tool).toBe('proof');
  });

  it('goes back to a proof open in Geo Proof that holds the scene, never saved yet, rather than making a second', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    expect(button('Make the proof')).toBeDefined();
    // Send to Geo Proof from Horizon made it: the server knows nothing of it before its first save
    holdInGeoProof('c1', SCENE);
    flushSync();
    try {
      expect(button('Make the proof')).toBeUndefined();
      const open = button('Open the proof');
      expect(open.title).toBe('Back to its proof in Geo Proof, where new map captures join it');
      uiState.openProof = null;
      open.click();
      expect(uiState.tool).toBe('proof');
      expect(uiState.openProof).toBeNull();
      expect(uiState.inspectScene).toBeNull();
      // the proof closed, or holding another scene: Make the proof again
      holdInGeoProof('c1', null);
      flushSync();
      expect(button('Make the proof')).toBeDefined();
    } finally {
      holdInGeoProof(null, null);
    }
  });

  it('links to Inspect on the scene, to Satellite with its reference window, and to Horizon', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: { ...SCENE, order: 1 } });
    await show();
    target.querySelector('[aria-label="Open the scene in Inspect"]').click();
    expect(uiState).toMatchObject({ tool: 'inspect', inspectScene: { video: 'media/convoy.mp4', draft: 'sc_1' } });

    target.querySelector('[aria-label="Go to Satellite"]').click();
    expect(uiState.tool).toBe('satellite');
    expect(uiState.geolocateRef).toMatchObject({ video: 'media/convoy.mp4', draft: 'sc_1', start: 238, end: 252, order: 1, kind: 'video' });

    target.querySelector('[aria-label="Go to Horizon"]').click();
    expect(uiState.tool).toBe('horizon');
  });
});
