// @vitest-environment happy-dom
/** Find's keys: its own while Horizon is on screen, left alone while another tool is. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { uiState } from '../../lib/state.svelte.js';
import Find from './Find.svelte';

vi.mock('./FindPhoto.svelte', () => import('../detect/MapSurface.stub.svelte'));
vi.mock('./FindMap.svelte', () => import('../detect/MapSurface.stub.svelte'));
vi.mock('./FindSteps.svelte', () => import('../detect/MapSurface.stub.svelte'));

function fakeFind(over = {}) {
  return {
    area: [],
    areas: [],
    strokes: [],
    zones: [],
    settings: {},
    who: {},
    facing: [],
    stands: [],
    water: false,
    over: null,
    view: [],
    mirror: false,
    alignments: [],
    pending: null,
    drawing: null,
    step: null,
    search: null,
    searching: false,
    searchProblem: '',
    list: [],
    estimate: vi.fn(),
    readDetail: vi.fn(),
    cancelAlignment: vi.fn(),
    stopBrush: vi.fn(),
    ...over,
  };
}

const overlay = { source: null, strokes: [], marks: null, hints: {}, lens: null };

let shown = null;
function show(find, onsave = vi.fn()) {
  shown = mount(Find, { target: document.body, props: { find, overlay, caseOpen: true, caseId: 'c1', onsave } });
  flushSync();
  return onsave;
}

/** A key as the browser sends it to the window, answering whether anyone took it. */
function press(init) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

const save = { key: 's', ctrlKey: true };

beforeEach(() => {
  uiState.tool = 'horizon';
});

afterEach(() => {
  if (shown) unmount(shown);
  shown = null;
  document.body.innerHTML = '';
});

describe('the keys of Find', () => {
  it('saves the setup on Ctrl+S while Horizon is on screen', () => {
    const onsave = show(fakeFind());
    expect(press(save)).toBe(true);
    expect(onsave).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and leaves Ctrl+S to the tool on screen', () => {
    const onsave = show(fakeFind());
    uiState.tool = 'sheet';
    expect(press(save)).toBe(false);
    expect(onsave).not.toHaveBeenCalled();
  });

  it('leaves Escape to the tool on screen, a pending alignment waiting', () => {
    const find = fakeFind({ pending: { step: 0 } });
    show(find);
    uiState.tool = 'sheet';
    press({ key: 'Escape' });
    expect(find.cancelAlignment).not.toHaveBeenCalled();
    uiState.tool = 'horizon';
    press({ key: 'Escape' });
    expect(find.cancelAlignment).toHaveBeenCalledTimes(1);
  });
});
