// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const uiState = { tool: 'collage' };
vi.mock('../../lib/state.svelte.js', () => ({ uiState }));

const { default: CollageCanvas } = await import('./CollageCanvas.svelte');
const { joinOverlays } = await import('../../lib/overlayStack.js');
const { fitView } = await import('../../lib/inspect.js');

const rect = [[0, 0], [80, 0], [80, 60], [0, 60]];
const node = (id) => ({ id, save: { path: `media/${id}.png`, time: null, ops: [] }, quad: rect, w: 80, h: 60, url: `blob:${id}` });

let live;
let target;
let collage;

let props;

function show(selectedIds, level = null, view = undefined, { collage: extra = {}, ...more } = {}) {
  const shown = $state({ width: 1600, height: 800, nodes: [node('nd_1'), node('nd_2')], clip: null, ...extra });
  collage = shown;
  target = document.createElement('div');
  document.body.append(target);
  // the bindings the tool holds, read back here as it would
  const held = $state({ collage, selectedIds, requestCrop: vi.fn(), level, view, unstitched: [], fitted: true, ...more });
  props = held;
  live = mount(CollageCanvas, { target, props });
  flushSync();
}

function wheel(init, extra = {}) {
  const e = new WheelEvent('wheel', { clientX: 50, clientY: 40, bubbles: true, cancelable: true, ...init });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(e, key, { value });
  target.querySelector('.wrap').dispatchEvent(e);
  flushSync();
}

function pointer(el, type, x, y, init = {}) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...init }));
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

describe('the view and the cue', () => {
  it('zooms the view the tool holds on a mouse wheel, so the bar over it can say so and fit it back', () => {
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view);

    // Firefox's wheel, in lines
    wheel({ deltaY: -3, deltaMode: 1 });
    expect(view.zoom).toBeCloseTo(1.1);
    expect(target.querySelector('.surface').style.transform).toContain(`translate(${view.x}px, ${view.y}px)`);
    // Chromium's, in pixels a notch of 120 at a time
    wheel({ deltaY: 100 }, { wheelDeltaY: -120 });
    expect(view.zoom).toBeCloseTo(1);
  });

  it('pans on two fingers of a touchpad and zooms on a pinch, by how far they moved', () => {
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view);

    wheel({ deltaX: 12, deltaY: -30 });
    expect(view).toMatchObject({ zoom: 1, x: -12, y: 30 });
    // a pinch arrives as the wheel with Ctrl held, a little at a time
    wheel({ deltaY: -4 }, { ctrlKey: true });
    expect(view.zoom).toBeCloseTo(Math.exp(0.04));
    wheel({ deltaY: 8 }, { ctrlKey: true });
    expect(view.zoom).toBeCloseTo(Math.exp(-0.04));
  });

  it('fits the pieces, and says when the view shows them so', () => {
    // no pane is measured here, so the pieces fit as the canvas does (lib/inspect.fitView has the sums)
    const view = $state({ zoom: 2, x: 30, y: -12 });
    show([], null, view);
    expect(props.fitted).toBe(false);
    live.fitPieces();
    flushSync();
    expect({ ...view }).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(props.fitted).toBe(true);
    wheel({ deltaY: -3, deltaMode: 1 });
    expect(props.fitted).toBe(false);
  });

  it('says what to click while the line is drawn, in place of the keys of the canvas', () => {
    const level = $state({ drawing: false, points: [] });
    show([], level);
    expect(target.querySelector('.view-hint').textContent).toContain('wheel or pinch to zoom');
    expect(target.querySelector('.wrap').classList.contains('drawing')).toBe(false);

    level.drawing = true;
    flushSync();
    expect(target.querySelector('.level-cue').textContent).toContain('along something level that crosses the view');
    expect(target.querySelector('.level-cue').textContent).toContain('double-click or Enter ends');
    expect(target.querySelector('.wrap').classList.contains('drawing')).toBe(true);
  });
});

describe('the arrows', () => {
  const moved = (id) => collage.nodes.find((n) => n.id === id).quad[0];

  it('nudge the selected piece a canvas pixel, ten with Shift', () => {
    show(['nd_1']);
    press('ArrowRight');
    press('ArrowDown');
    expect(moved('nd_1')).toEqual([1, 1]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    flushSync();
    expect(moved('nd_1')).toEqual([-9, 1]);
    expect(moved('nd_2')).toEqual([0, 0]);
  });

  it('move a block of pieces as one', () => {
    show(['nd_1', 'nd_2']);
    press('ArrowUp');
    expect(moved('nd_1')).toEqual([0, -1]);
    expect(moved('nd_2')).toEqual([0, -1]);
  });

  it('leave the pieces alone while a field has the keys, a dialog is open, or nothing is selected', () => {
    show(['nd_1']);
    const input = document.createElement('input');
    input.className = 'stray';
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    const leave = joinOverlays({});
    press('ArrowRight');
    leave();
    expect(moved('nd_1')).toEqual([0, 0]);

    // a slider moved by the arrows keeps them
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.className = 'stray';
    document.body.append(slider);
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    flushSync();
    expect(moved('nd_1')).toEqual([0, 0]);

    unmount(live);
    target.remove();
    show([]);
    press('ArrowRight');
    expect(moved('nd_1')).toEqual([0, 0]);
  });

  it('take the outline off a piece the stitch left out once it is moved', () => {
    show(['nd_2'], null, undefined, { unstitched: [{ id: 'nd_2', why: 'no-overlap', mode: 'cylindrical' }] });
    const outlined = () => [...target.querySelectorAll('img.node.unstitched')].map((img) => img.title);
    expect(outlined()).toEqual(['Auto-stitch left it here. No overlap']);
    expect(target.querySelector('[data-testid="piece-left-out"]').textContent.trim()).toBe('No overlap');
    press('ArrowRight');
    expect(props.unstitched).toEqual([]);
    expect(outlined()).toEqual([]);
    expect(target.querySelector('[data-testid="piece-left-out"]')).toBeNull();
  });
});

describe('a piece the stitch left out', () => {
  const chips = () => [...target.querySelectorAll('[data-testid="piece-left-out"]')].map((chip) => chip.textContent.trim());

  it('says why on the piece itself, above every other piece', () => {
    show([], null, undefined, { unstitched: [
      { id: 'nd_1', why: 'no-detail', mode: 'cylindrical' },
      { id: 'nd_2', why: 'off-canvas', mode: 'planar' },
    ] });
    expect(chips()).toEqual(['Nothing to match: blank or painted out', 'Fell off the canvas: try Cylindrical']);
    expect(target.querySelector('img.node').title).toBe('Auto-stitch left it here. Nothing to match: blank or painted out');
    // drawn over the pieces' layer, so a piece laid on top never hides it
    expect(target.querySelector('.pieces [data-testid="piece-left-out"]')).toBeNull();
  });
});

describe('the cut', () => {
  const frame = () => ({ ...props.cut.frame });

  it('draws the frame with its edges and corners, says what to do, and dims what lies outside', () => {
    show([], null, undefined, { cut: { editing: true, frame: { x: 0, y: 0, w: 80, h: 60 } } });
    expect(target.querySelector('[data-testid="cut-frame"]')).not.toBeNull();
    expect([...target.querySelectorAll('[data-handle]')].map((h) => h.dataset.handle)).toEqual(['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']);
    expect(target.querySelector('.cut-cue').textContent).toContain('frame what the saved picture keeps');
    expect(target.querySelector('.wrap').classList.contains('cutting')).toBe(true);
    // the pieces whole while it is drawn
    expect(target.querySelector('.pieces.cut')).toBeNull();
  });

  it('moves the edge in hand, snapping to a piece, never past the other edge, and the whole frame from inside', () => {
    show([], null, undefined, { cut: { editing: true, frame: { x: 0, y: 0, w: 80, h: 60 } } });
    pointer(target.querySelector('[data-handle="s"]'), 'pointerdown', 40, 60);
    pointer(window, 'pointermove', 40, 38);
    expect(frame()).toEqual({ x: 0, y: 0, w: 80, h: 38 });
    // near the pieces' bottom it snaps to it, and Alt lets it go
    pointer(window, 'pointermove', 40, 57);
    expect(frame().h).toBe(60);
    pointer(window, 'pointermove', 40, 57, { altKey: true });
    expect(frame().h).toBe(57);
    pointer(window, 'pointermove', 40, -200);
    expect(frame().h).toBe(24);
    pointer(window, 'pointerup', 40, -200);

    pointer(target.querySelector('.cut-inside'), 'pointerdown', 20, 10);
    pointer(window, 'pointermove', 31, 25);
    expect(frame()).toEqual({ x: 11, y: 15, w: 80, h: 24 });
    // its top edge near the pieces' top, the whole frame snaps there
    pointer(window, 'pointermove', 31, 14);
    pointer(window, 'pointerup', 31, 14);
    expect(frame()).toEqual({ x: 11, y: 0, w: 80, h: 24 });
  });

  it('keeps the frame on Enter and leaves the cut as it was on Esc', () => {
    show([], null, undefined, { cut: { editing: true, frame: { x: 0, y: 0, w: 80, h: 40 } } });
    press('Escape');
    expect(props.cut.editing).toBe(false);
    expect(collage.clip).toBeNull();

    props.cut.editing = true;
    flushSync();
    press('Enter');
    expect(collage.clip).toEqual({ x: 0, y: 0, w: 80, h: 40 });
    expect(props.cut.editing).toBe(false);
  });

  it('pans from outside the frame, as from the background', () => {
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view, { cut: { editing: true, frame: { x: 0, y: 0, w: 80, h: 40 } } });
    pointer(target.querySelector('.cut-layer'), 'pointerdown', 300, 300);
    pointer(window, 'pointermove', 320, 290);
    pointer(window, 'pointerup', 320, 290);
    expect({ ...view }).toEqual({ zoom: 1, x: 20, y: -10 });
    expect(frame()).toEqual({ x: 0, y: 0, w: 80, h: 40 });
  });

  it('draws the pieces cut to the frame once kept, with a hairline round what the picture holds', () => {
    show([], null, undefined, { collage: { clip: { x: 10, y: -5, w: 50, h: 40 } }, cut: { editing: false, frame: null } });
    const layer = target.querySelector('.pieces.cut');
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(['10px', '-5px', '50px', '40px']);
    expect(target.querySelector('.pieces-in').style.transform).toBe('translate(-10px, 5px)');
    expect(layer.querySelectorAll('img.node')).toHaveLength(2);
    const mark = target.querySelector('.cut-mark');
    expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual(['10px', '0px', '50px', '35px']);
  });
});

describe('opening a collage', () => {
  const pane = (width, height) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  };
  afterEach(() => {
    delete HTMLElement.prototype.clientWidth;
    delete HTMLElement.prototype.clientHeight;
  });

  it('frames its pieces, as Fit does, once the pane has its size', () => {
    pane(900, 500);
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view);
    const fitted = fitView([rect], { width: 900, height: 500 }, { width: 1600, height: 800 });
    expect(view.zoom).toBeCloseTo(fitted.zoom);
    expect([view.x, view.y]).toEqual([fitted.x, fitted.y]);
    expect(props.fitted).toBe(true);
  });

  it('frames a cut collage on what its picture holds', () => {
    pane(900, 500);
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view, { collage: { clip: { x: 0, y: 0, w: 40, h: 30 } } });
    const fitted = fitView([[[0, 0], [40, 30]]], { width: 900, height: 500 }, { width: 1600, height: 800 });
    expect(view.zoom).toBeCloseTo(fitted.zoom);
  });

  it('leaves a new, empty one on the whole canvas, and its first piece too', () => {
    pane(900, 500);
    const view = $state({ zoom: 1, x: 0, y: 0 });
    show([], null, view, { collage: { nodes: [] } });
    collage.nodes.push(node('nd_1'));
    flushSync();
    expect({ ...view }).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('the brush', () => {
  const brushOn = (more = {}) => ({ on: true, size: 40, erase: false, ...more });
  const piece = (i) => target.querySelectorAll('img.node')[i];

  it('paints on the piece it starts on, in the picture the stitch receives, and selects it', () => {
    show([], null, undefined, { brush: brushOn() });
    // nd_2 lies over nd_1: the press lands on the one on top
    pointer(piece(1), 'pointerdown', 40, 30);
    pointer(window, 'pointermove', 60, 30);
    pointer(window, 'pointermove', 61, 30); // too close to the last point to be kept
    pointer(window, 'pointerup', 60, 30);
    const [stroke] = collage.nodes[1].exclude;
    expect(props.selectedIds).toEqual(['nd_2']);
    expect(stroke.points).toEqual([[0.5, 0.5], [0.75, 0.5]]);
    // 40 screen pixels across over a piece 80 wide at scale 1
    expect(stroke.radius).toBe(0.25);
    expect(collage.nodes[0].exclude).toBeUndefined();
    expect(target.querySelectorAll('[data-testid="piece-paint"] polyline')).toHaveLength(1);
    expect(target.querySelector('[data-testid="piece-paint"] polyline').getAttribute('stroke-width')).toBe('40');
  });

  it('keeps a stroke inside the piece, and erases with Alt', () => {
    show([], null, undefined, { brush: brushOn({ size: 8 }) });
    pointer(piece(1), 'pointerdown', 76, 30);
    pointer(window, 'pointermove', 83, 30); // over the edge by less than the brush: the edge
    pointer(window, 'pointermove', 140, 30); // far off the piece: nothing
    pointer(window, 'pointerup', 140, 30);
    expect(collage.nodes[1].exclude[0].points).toEqual([[0.95, 0.5], [1, 0.5]]);

    pointer(piece(1), 'pointerdown', 80, 30, { altKey: true });
    pointer(window, 'pointerup', 80, 30);
    expect(collage.nodes[1].exclude).toEqual([]);
  });

  it('shows the paint only while the brush is out, and a mark that takes it up otherwise', () => {
    const brush = $state(brushOn());
    show([], null, undefined, { brush });
    collage.nodes[0].exclude = [{ points: [[0.5, 0.5]], radius: 0.1 }];
    flushSync();
    expect(target.querySelectorAll('[data-testid="piece-paint"] circle')).toHaveLength(1);
    expect(target.querySelector('[data-testid="piece-ignored"]')).toBeNull();
    // the corner handles step aside while painting
    expect(target.querySelector('.handle')).toBeNull();

    brush.on = false;
    flushSync();
    expect(target.querySelector('[data-testid="piece-paint"]')).toBeNull();
    const mark = target.querySelector('[data-testid="piece-ignored"]');
    expect(mark.title).toBe('Areas left out of auto-stitch: paint or erase them');
    mark.click();
    flushSync();
    expect(brush.on).toBe(true);
    expect(props.selectedIds).toEqual(['nd_1']);
  });

  it('changes size on [ and ], and is put down with Esc', () => {
    const brush = $state(brushOn());
    show([], null, undefined, { brush });
    press(']');
    expect(brush.size).toBe(48);
    press('[');
    press('[');
    expect(brush.size).toBe(32);
    expect(target.querySelector('.brush-cue').textContent).toContain('Auto-stitch does not match there');
    press('Escape');
    expect(brush.on).toBe(false);
    expect(target.querySelector('.brush-cue')).toBeNull();
  });
});
