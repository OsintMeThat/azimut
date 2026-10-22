// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const uiState = { tool: 'collage' };
vi.mock('../../lib/state.svelte.js', () => ({ uiState }));

const { default: CollageCanvas } = await import('./CollageCanvas.svelte');
const { joinOverlays } = await import('../../lib/overlayStack.js');

const rect = [[0, 0], [80, 0], [80, 60], [0, 60]];
const node = (id) => ({ id, save: { path: `media/${id}.png`, time: null, ops: [] }, quad: rect, w: 80, h: 60, url: `blob:${id}` });

let live;
let target;
let collage;

function show(selectedIds) {
  const shown = $state({ width: 1600, height: 800, nodes: [node('nd_1'), node('nd_2')] });
  collage = shown;
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageCanvas, { target, props: { collage, selectedIds, requestCrop: vi.fn() } });
  flushSync();
}

function press(key) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.querySelectorAll('.stray').forEach((el) => el.remove());
  uiState.tool = 'collage';
});

describe('Delete in the collage', () => {
  it('removes the selected piece and only that one', () => {
    show(['nd_1']);
    press('Delete');
    expect(collage.nodes.map((n) => n.id)).toEqual(['nd_2']);
  });

  it('still works while another tool draws an element of its own called overlay', () => {
    const stray = document.createElement('img');
    stray.className = 'overlay stray';
    document.body.append(stray);
    show(['nd_2']);
    press('Delete');
    expect(collage.nodes.map((n) => n.id)).toEqual(['nd_1']);
  });

  it('leaves the pieces alone while a dialog is open', () => {
    show(['nd_1']);
    const leave = joinOverlays({});
    press('Delete');
    leave();
    expect(collage.nodes).toHaveLength(2);
  });

  it('leaves the pieces alone when the Collage is not the tool on screen', () => {
    uiState.tool = 'inspect';
    show(['nd_1']);
    press('Delete');
    expect(collage.nodes).toHaveLength(2);
  });
});
