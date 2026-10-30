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

function show(selectedIds, level = null) {
  const shown = $state({ width: 1600, height: 800, nodes: [node('nd_1'), node('nd_2')] });
  collage = shown;
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageCanvas, { target, props: { collage, selectedIds, requestCrop: vi.fn(), level } });
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

describe('the level line', () => {
  it('is drawn click by click as a smooth curve, Ctrl+Z takes a point back rather than a piece, Esc stops', () => {
    const level = $state({ drawing: true, points: [] });
    show(['nd_1'], level);

    const click = (x, y) => {
      target.querySelector('.level-catch').dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
      flushSync();
    };
    click(40, 30);
    click(200, 60);
    click(400, 50);
    expect(level.points).toHaveLength(3);
    expect(target.querySelectorAll('.level-line circle')).toHaveLength(3);
    // the curve Straighten reads, not the clicks joined straight: many points, through the clicks' bend
    expect(target.querySelector('.level-line polyline').getAttribute('points').split(' ').length).toBeGreaterThan(30);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    expect(level.points).toHaveLength(2);
    press('Backspace');
    expect(level.points).toHaveLength(1);
    expect(collage.nodes.map((n) => n.id)).toEqual(['nd_1', 'nd_2']);

    press('Escape');
    expect(level.drawing).toBe(false);
    expect(target.querySelector('.level-catch')).toBeNull();
    // the point drawn so far stays, for more clicks later, and can still be picked up
    expect(target.querySelectorAll('.level-line circle:not(.grab)')).toHaveLength(1);
    expect(target.querySelectorAll('.level-line circle.grab')).toHaveLength(1);
  });

  it('runs on to the pointer, moves a point dragged, ends on a double-click and still takes a point back after', () => {
    const level = $state({ drawing: true, points: [] });
    show([], level);
    const catcher = () => target.querySelector('.level-catch');
    const fire = (el, type, x, y) => {
      el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      flushSync();
    };
    fire(catcher(), 'pointerdown', 40, 30);
    expect(target.querySelector('.level-line polyline')).toBeNull();
    // one point and the pointer already make a curve: where the next click would put it
    fire(catcher(), 'pointermove', 300, 60);
    expect(target.querySelector('.level-line polyline')).not.toBeNull();
    expect(level.points).toHaveLength(1);

    fire(catcher(), 'pointerdown', 300, 60);
    const placed = [...level.points[1]];
    // a press on a point picks it up rather than adding one, and the drag moves it
    fire(catcher(), 'pointerdown', 300, 60);
    fire(window, 'pointermove', 300, 90);
    fire(window, 'pointerup', 300, 90);
    expect(level.points).toHaveLength(2);
    expect(level.points[1][1]).toBeGreaterThan(placed[1]);

    catcher().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(level.drawing).toBe(false);
    expect(level.points).toHaveLength(2);
    // done drawing, a point is still picked up and moved
    const before = [...level.points[1]];
    fire(target.querySelectorAll('.level-line circle.grab')[1], 'pointerdown', 300, 90);
    fire(window, 'pointermove', 300, 40);
    fire(window, 'pointerup', 300, 40);
    expect(level.points[1][1]).toBeLessThan(before[1]);
    expect(level.points).toHaveLength(2);
    // the line still shown: Ctrl+Z takes its last point back, Escape no longer means anything to it
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    expect(level.points).toHaveLength(1);
  });
});
