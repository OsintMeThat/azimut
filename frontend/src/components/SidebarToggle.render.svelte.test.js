// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The sidebar's toggle in the top bar: the accent's dot while the sidebar is closed on
 * scenes waiting to be geolocated, the abandoned left out, and the queue read as the
 * sidebar reads it, once for the case and again only when its number may have moved.
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
const uiState = $state({ tool: 'inspect', sidebarOpen: false, geolocateRef: null });
vi.mock('../lib/state.svelte.js', () => ({ caseState, uiState, toast: vi.fn() }));

const { default: SidebarToggle } = await import('./SidebarToggle.svelte');
const { sceneQueue, holdSceneCount } = await import('../lib/geolocating.svelte.js');
const { dispatch } = await import('../lib/events.js');

const VIDEO = 'media/market.mp4';
const scene = (id, extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null, ...extra,
});
const queue = (scenes) => ({ files: [{ video: VIDEO, title: 'Market', scenes }], geolocating: null });

let live = null;
let target = null;
const onclick = vi.fn();

async function settle(ms = 0) {
  if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  flushSync();
}

async function show() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SidebarToggle, { target, props: { onclick } });
  flushSync();
  await settle();
}

const button = () => target.querySelector('button');
const dot = () => target.querySelector('.waiting-dot');

beforeEach(() => {
  answers.clear();
  calls.length = 0;
  Object.assign(sceneQueue, { caseId: null, files: null, busy: false, error: '' });
  caseState.current = { id: 'c1' };
  uiState.sidebarOpen = false;
  onclick.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the sidebar’s toggle', () => {
  it('wears the dot while the sidebar is closed on scenes waiting, and says so on hover', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', queue([scene('sc_1'), scene('sc_2', { state: 'progress', captures: ['media/c.png'] })]));
    await show();
    expect(calls).toEqual(['GET /api/cases/c1/scenes/queue']);
    expect(dot()).not.toBeNull();
    expect(dot().getAttribute('aria-label')).toBe('scenes to geolocate in the To-do');
    expect(button().title).toBe('Toggle case sidebar · scenes to geolocate in the To-do');
    expect(button().classList.contains('dotted')).toBe(true);

    button().click();
    expect(onclick).toHaveBeenCalledTimes(1);
    // open, the To-do tab counts them instead
    uiState.sidebarOpen = true;
    flushSync();
    expect(dot()).toBeNull();
    expect(button().title).toBe('Toggle case sidebar');
  });

  it('counts no abandoned scene, and names one scene as one', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', queue([scene('sc_1', { state: 'abandoned', abandoned: { reason: '', at: 't' } })]));
    await show();
    expect(dot()).toBeNull();
    expect(button().title).toBe('Toggle case sidebar');

    answers.set('GET /api/cases/c1/scenes/queue', queue([scene('sc_1', { state: 'abandoned', abandoned: { reason: '', at: 't' } }), scene('sc_2')]));
    // the case reloaded reads nothing again: the count is held
    caseState.current = { id: 'c1' };
    await settle();
    expect(calls).toHaveLength(1);
    dispatch({ type: 'saved', case_id: 'c1' });
    await settle(1100);
    expect(calls).toHaveLength(2);
    expect(button().title).toBe('Toggle case sidebar · a scene to geolocate in the To-do');
  });

  it('shows nothing without a case, and reads nothing', async () => {
    caseState.current = null;
    await show();
    expect(calls).toHaveLength(0);
    expect(dot()).toBeNull();
  });

  it('shares the read with an open sidebar, which keeps it in step once the toggle is gone', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', queue([scene('sc_1')]));
    const sidebar = holdSceneCount();
    await show();
    expect(calls).toHaveLength(1);
    unmount(live);
    live = null;
    // still held by the sidebar: a nudge naming the file asks that file's scenes alone
    answers.set(`GET /api/cases/c1/scenes?${new URLSearchParams({ video: VIDEO })}`, { scenes: [scene('sc_1')] });
    dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await settle(350);
    expect(calls.at(-1)).toBe(`GET /api/cases/c1/scenes?${new URLSearchParams({ video: VIDEO })}`);
    expect(calls.filter((call) => call.endsWith('/scenes/queue'))).toHaveLength(1);
    sidebar();
  });

  it('reads the file’s scenes alone on an Inspect save, never the whole queue, while closed', async () => {
    answers.set('GET /api/cases/c1/scenes/queue', queue([scene('sc_1')]));
    await show();
    answers.set(`GET /api/cases/c1/scenes?${new URLSearchParams({ video: VIDEO })}`, { scenes: [scene('sc_1')] });
    for (let i = 0; i < 5; i += 1) dispatch({ type: 'scenes', case_id: 'c1', video: VIDEO });
    await settle(350);
    // one ask for the burst, and the scenes there are the ones held
    expect(calls).toEqual(['GET /api/cases/c1/scenes/queue', `GET /api/cases/c1/scenes?${new URLSearchParams({ video: VIDEO })}`]);
    expect(dot()).not.toBeNull();
  });
});
