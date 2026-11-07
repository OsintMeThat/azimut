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
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast }));

const { default: GeolocatingPill } = await import('./GeolocatingPill.svelte');
const { geolocating } = await import('../lib/geolocating.svelte.js');
const { sceneColorAt } = await import('../lib/scenes.js');
const { dispatch } = await import('../lib/events.js');

const SCENE = {
  kind: 'draft', video: 'media/convoy.mp4', id: 'sc_1', start: 238, end: 252, label: 'bridge?',
  state: 'progress', captures: ['media/cap-1.png'], abandoned: null, since: 't',
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

  it('says what is being geolocated, when in the clip, and how many captures it holds', async () => {
    answers.set('GET /api/cases/c1/geolocating', { geolocating: SCENE });
    await show();
    expect(pill().getAttribute('aria-label')).toBe('Geolocating · 3:58–4:12 · bridge?');
    expect(pill().querySelector('.geo-time').textContent).toBe('3:58–4:12');
    expect(pill().querySelector('.geo-label').textContent).toBe('bridge?');
    const count = target.querySelector('[data-testid="geolocating-count"]');
    expect(count.textContent.trim()).toBe('1');
    expect(count.getAttribute('title')).toBe('1 capture gathered for it');
    expect(button('Geolocating').getAttribute('title')).toBe('Open the scene in Inspect, on convoy.mp4');
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
    const count = () => target.querySelector('[data-testid="geolocating-count"]');
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
    const count = () => target.querySelector('[data-testid="geolocating-count"]');
    const two = { ...SCENE, captures: ['media/cap-1.png', 'media/cap-2.png'] };
    answers.set('GET /api/cases/c1/geolocating', { geolocating: two });
    calls.length = 0;
    dispatch({ type: 'geolocating', case_id: 'c1', video: SCENE.video, draft: SCENE.id, capture: 'media/cap-2.png', captures: 2 });
    flushSync();
    // nothing read yet, and the pill says it already
    expect(calls).toEqual(['GET /api/cases/c1/geolocating']);
    expect(count().textContent.trim()).toBe('2');
    expect(count().classList.contains('bump')).toBe(true);
    expect(count().getAttribute('aria-label')).toBe('2 captures');
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
