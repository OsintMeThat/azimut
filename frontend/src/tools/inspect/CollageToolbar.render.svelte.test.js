// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const post = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { post } }));
const toast = vi.fn();
vi.mock('../../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case-a' } }, toast }));

const { default: CollageToolbar } = await import('./CollageToolbar.svelte');

const rect = (x) => [[x, 0], [x + 80, 0], [x + 80, 60], [x, 60]];
const node = (id, x) => ({ id, save: { path: `media/${id}.png`, time: null, ops: [] }, quad: rect(x), w: 80, h: 60, url: `blob:${id}` });

let live;
let target;
let collage;
let view;
let level;
let props;

function show({ nodes = [node('nd_1', 0), node('nd_2', 100)], drawn = null, straighten = null, renderPiece = vi.fn(), ...more } = {}) {
  const shownCollage = $state({ width: 1600, height: 800, nodes, straightened: false, clip: null });
  const shownView = $state({ zoom: 1, x: 0, y: 0 });
  const shownLevel = $state(drawn ?? { drawing: false, points: [] });
  collage = shownCollage;
  view = shownView;
  level = shownLevel;
  target = document.createElement('div');
  document.body.append(target);
  // what the tool binds, read back here as it would
  const held = $state({
    collage, selectedIds: [], renderPiece, level, straighten, view, unstitched: [],
    brush: { on: false, size: 40, erase: false }, fit: vi.fn(), fitted: false, cut: { editing: false, frame: null }, ...more,
  });
  props = held;
  live = mount(CollageToolbar, { target, props });
  flushSync();
}

const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  flushSync();
};

beforeEach(() => {
  post.mockReset();
  toast.mockReset();
  localStorage.clear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('Auto-stitch', () => {
  it('stitches on its press in the projection its arrow picked, and keeps that pick for next time', async () => {
    post.mockResolvedValue({ nodes: [], dropped: [], canvas: null });
    show();
    expect(button('Auto-stitch').textContent).toContain('Cylindrical');

    target.querySelector('button[aria-label="More ways to stitch"]').click();
    flushSync();
    const options = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(options.map((o) => o.querySelector('.mode-name').textContent)).toEqual(['Planar', 'Cylindrical', 'Spherical']);
    options[2].click();
    flushSync();
    expect(document.querySelector('[role="menuitemradio"]')).toBeNull(); // picking closes the menu, nothing stitched yet
    expect(post).not.toHaveBeenCalled();
    expect(button('Auto-stitch').textContent).toContain('Spherical');

    button('Auto-stitch').click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/inspect/auto-stitch', expect.objectContaining({ mode: 'spherical' }));

    unmount(live);
    target.remove();
    show();
    expect(button('Auto-stitch').textContent).toContain('Spherical');
  });

  it('waits for two pieces', () => {
    show({ nodes: [node('nd_1', 0)] });
    expect(button('Auto-stitch').disabled).toBe(true);
    expect(button('Auto-stitch').title).toBe('Add at least two overlapping pieces');
  });

  it('grows the canvas to the answer, carrying the pieces it could not place, and undoes from its message or its menu', async () => {
    post.mockResolvedValue({
      nodes: [{ index: 0, quad: [[10, 10], [500, 10], [500, 300], [10, 300]], op: null }],
      dropped: [1],
      canvas: { width: 3200, height: 1600 },
    });
    show();

    button('Auto-stitch').click();
    await settle();
    expect([collage.width, collage.height]).toEqual([3200, 1600]);
    expect(collage.nodes[0].quad[1]).toEqual([500, 10]);
    expect(collage.nodes[1].quad[0]).toEqual([200, 0]); // left in place, scaled with the canvas
    const [message, kind, , action] = toast.mock.calls.at(-1);
    expect(message).toBe('Stitched 1. No overlap found for the outlined piece, left where it was');
    expect(kind).toBe('warn');
    expect(action.label).toBe('Undo');
    // the piece left out is outlined and in hand, saying why, and the view shows the pieces whole
    expect(props.unstitched).toEqual([{ id: 'nd_2', why: 'no-overlap', mode: 'cylindrical' }]);
    expect(props.selectedIds).toEqual(['nd_2']);
    expect(props.fit).toHaveBeenCalledTimes(1);

    target.querySelector('button[aria-label="More ways to stitch"]').click();
    flushSync();
    expect(button('Undo auto-stitch')).toBeTruthy();
    action.onClick();
    flushSync();
    expect([collage.width, collage.height]).toEqual([1600, 800]);
    expect(props.unstitched).toEqual([]);
    expect(collage.nodes[0].quad).toEqual(rect(0));
    expect(collage.nodes[1].quad).toEqual(rect(100));
    expect(button('Undo auto-stitch')).toBeFalsy();
  });

  it('says when no piece found an overlap', async () => {
    post.mockResolvedValue({ nodes: [], dropped: [0, 1], canvas: null });
    show();
    button('Auto-stitch').click();
    await settle();
    expect(toast.mock.calls.at(-1)[0]).toBe('No overlap found between the pieces, so none moved');
    expect(props.unstitched.map((piece) => piece.id)).toEqual(['nd_1', 'nd_2']);
  });

  it('says why it left each piece where it was, on the piece and in its message', async () => {
    post.mockResolvedValue({ nodes: [{ index: 0, quad: rect(5), op: null }], dropped: [1, 2], why: ['no-detail', 'off-canvas'], canvas: null });
    show({ nodes: [node('nd_1', 0), node('nd_2', 100), node('nd_3', 200)] });
    target.querySelector('button[aria-label="More ways to stitch"]').click();
    flushSync();
    [...document.querySelectorAll('[role="menuitemradio"]')][0].click();
    flushSync();

    button('Auto-stitch').click();
    await settle();
    expect(props.unstitched).toEqual([
      { id: 'nd_2', why: 'no-detail', mode: 'planar' },
      { id: 'nd_3', why: 'off-canvas', mode: 'planar' },
    ]);
    expect(toast.mock.calls.at(-1)[0]).toBe('Stitched 1. The 2 outlined pieces stay where they were: 1 with nothing to match, 1 off the canvas');
  });

  it('lays the pieces out anew, so the cut goes, and its Undo brings the cut back', async () => {
    post.mockResolvedValue({ nodes: [{ index: 0, quad: rect(5), op: null }, { index: 1, quad: rect(90), op: null }], dropped: [], canvas: null });
    show();
    collage.clip = { x: 0, y: 0, w: 100, h: 40 };
    flushSync();

    button('Auto-stitch').click();
    await settle();
    expect(collage.clip).toBeNull();
    toast.mock.calls.at(-1)[3].onClick();
    expect(collage.clip).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  it('names the pieces left out in its message, two or more', async () => {
    post.mockResolvedValue({ nodes: [{ index: 0, quad: rect(5), op: null }], dropped: [1, 2], canvas: null });
    show({ nodes: [node('nd_1', 0), node('nd_2', 100), node('nd_3', 200)] });
    button('Auto-stitch').click();
    await settle();
    expect(toast.mock.calls.at(-1)[0]).toBe('Stitched 1. No overlap found for the 2 outlined pieces, left where they were');
  });

  it('sends the areas painted out of each piece only when some piece has them', async () => {
    post.mockResolvedValue({ nodes: [], dropped: [], canvas: null });
    show();
    button('Auto-stitch').click();
    await settle();
    expect(post.mock.calls[0][1]).not.toHaveProperty('exclude');

    const strokes = [{ points: [[0.5, 0.5]], radius: 0.1 }];
    collage.nodes[1].exclude = strokes;
    button('Auto-stitch').click();
    await settle();
    expect(post.mock.calls[1][1].exclude).toEqual([null, strokes]);
  });

  it('is one undo: the history is held from before the request until the last piece is drawn again', async () => {
    const op = { op: 'remap', params: { warp: 'cylindrical' } };
    post.mockResolvedValue({ nodes: [0, 1, 2, 3, 4].map((index) => ({ index, quad: rect(index * 90), op })), dropped: [], canvas: null });
    const order = [];
    const release = vi.fn(() => order.push('release'));
    const hold = vi.fn(() => {
      order.push('hold');
      return release;
    });
    // the pieces a warp reshapes are drawn again three at a time
    let drawing = 0;
    let most = 0;
    const waiting = [];
    const renderPiece = vi.fn((n, ops) => new Promise((resolve) => {
      drawing += 1;
      most = Math.max(most, drawing);
      waiting.push(() => {
        drawing -= 1;
        n.save = { ...n.save, ops };
        resolve();
      });
    }));
    show({ nodes: [0, 1, 2, 3, 4].map((i) => node(`nd_${i}`, i * 100)), hold, renderPiece });

    button('Auto-stitch').click();
    await settle();
    expect(order).toEqual(['hold']);
    expect(post).toHaveBeenCalledTimes(1);
    // every piece is at its place at once, its pixels on their way
    expect(collage.nodes.map((n) => n.quad[0][0])).toEqual([0, 90, 180, 270, 360]);
    expect(drawing).toBe(3);
    while (waiting.length) {
      waiting.shift()();
      await settle();
    }
    expect(renderPiece).toHaveBeenCalledTimes(5);
    expect(most).toBe(3);
    expect(order).toEqual(['hold', 'release']);
  });

  it('leaves the canvas alone when the answer matches it', async () => {
    post.mockResolvedValue({ nodes: [{ index: 0, quad: rect(5), op: null }, { index: 1, quad: rect(90), op: null }], dropped: [], canvas: { width: 1600, height: 800 } });
    show();

    button('Auto-stitch').click();
    await settle();
    expect([collage.width, collage.height]).toEqual([1600, 800]);
    expect(toast.mock.calls.at(-1).slice(0, 2)).toEqual(['Stitched 2 pieces', 'ok']);
  });

  it('has nothing to put back once its collage is closed', async () => {
    post.mockResolvedValue({ nodes: [{ index: 0, quad: rect(300), op: null }], dropped: [], canvas: { width: 3200, height: 1600 } });
    show();
    button('Auto-stitch').click();
    await settle();
    const [, , , action] = toast.mock.calls.at(-1);

    unmount(live);
    live = null;
    collage.width = 900;
    action.onClick();
    expect(collage.width).toBe(900);
  });
});

describe('Straighten', () => {
  const straightenButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Straighten');

  it('draws the line on its press, and waits for two points before it bends', () => {
    show({ straighten: vi.fn() });
    const draw = button('Draw the line');
    expect(draw.closest('[data-guide="collage.straighten"]')).not.toBeNull();
    expect(straightenButton().disabled).toBe(true);

    draw.click();
    flushSync();
    expect(level.drawing).toBe(true);
    expect(button('Done')).toBeTruthy();
    level.points = [[10, 30]];
    flushSync();
    expect(straightenButton().disabled).toBe(true);
    level.points = [[10, 30], [140, 50]];
    flushSync();
    expect(straightenButton().disabled).toBe(false);
    expect(straightenButton().classList.contains('btn-primary')).toBe(true);
  });

  it('hands the line to the tool to bend the whole collage, and waits for it', async () => {
    let finish;
    const straighten = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    show({ drawn: { drawing: true, points: [[5, 30], [145, 50]] }, straighten });

    straightenButton().click();
    flushSync();
    expect(straighten).toHaveBeenCalledTimes(1);
    // one bend at a time
    expect(button('Straightening').disabled).toBe(true);
    finish();
    await settle();
    expect(straightenButton().disabled).toBe(false);
  });

  it('takes the line away, and says when the collage was straightened', () => {
    show({ drawn: { drawing: false, points: [[5, 30], [145, 50]] } });
    expect(button('Draw more')).toBeTruthy();

    button('Clear').click();
    flushSync();
    expect(level.points).toEqual([]);
    expect(button('Clear')).toBeFalsy();
    expect(target.querySelector('.done')).toBeNull();
    collage.straightened = true;
    flushSync();
    expect(target.querySelector('.done').textContent).toContain('straightened');
  });
});

describe('Cut', () => {
  it('frames the pieces on its press, and keeps the frame on Apply', () => {
    show();
    expect(button('Cut').closest('[data-guide="collage.cut"]')).not.toBeNull();
    expect(button('Clear')).toBeFalsy();

    button('Cut').click();
    flushSync();
    expect(props.cut).toEqual({ editing: true, frame: { x: 0, y: 0, w: 180, h: 60 } });
    // the line steps aside while the frame is drawn
    expect(target.querySelector('[data-guide="collage.straighten"]')).toBeNull();
    props.cut.frame = { x: 0, y: 0, w: 180, h: 45.257 };
    button('Apply').click();
    flushSync();
    expect(collage.clip).toEqual({ x: 0, y: 0, w: 180, h: 45.26 });
    expect(props.cut.editing).toBe(false);
    expect(button('Cut').getAttribute('aria-pressed')).toBe('true');
  });

  it('starts again from the frame kept, leaves it as it was on Cancel, and clears it', () => {
    show();
    collage.clip = { x: 10, y: 0, w: 100, h: 40 };
    flushSync();
    button('Cut').click();
    flushSync();
    expect(props.cut.frame).toEqual({ x: 10, y: 0, w: 100, h: 40 });
    props.cut.frame = { x: 20, y: 0, w: 100, h: 40 };
    button('Cancel').click();
    flushSync();
    expect(collage.clip).toEqual({ x: 10, y: 0, w: 100, h: 40 });

    button('Clear').click();
    flushSync();
    expect(collage.clip).toBeNull();
    expect(button('Clear')).toBeFalsy();
  });

  it('cuts nothing when the frame still holds every piece', () => {
    show();
    button('Cut').click();
    flushSync();
    button('Apply').click();
    flushSync();
    expect(collage.clip).toBeNull();
  });

  it('puts the frame down for the brush and the line, and waits for a piece', () => {
    show();
    button('Cut').click();
    flushSync();
    button('Ignore areas').click();
    flushSync();
    expect(props.cut.editing).toBe(false);
    // the brush out, the frame waits
    expect(target.querySelector('[data-guide="collage.cut"]')).toBeNull();
    button('Done').click();
    flushSync();
    button('Draw the line').click();
    flushSync();
    button('Cut').click();
    flushSync();
    expect(level.drawing).toBe(false);
    expect(props.cut.editing).toBe(true);

    unmount(live);
    target.remove();
    show({ nodes: [] });
    expect(button('Cut').disabled).toBe(true);
  });
});

describe('Fit', () => {
  it('asks the canvas to show the pieces whole, and rests while the view does', () => {
    show({ fitted: true });
    expect(button('Fit').disabled).toBe(true);
    expect(target.querySelector('.zoom')).toBeNull();

    props.fitted = false;
    Object.assign(view, { zoom: 2.5, x: -40, y: 12 });
    flushSync();
    expect(target.querySelector('.zoom').textContent).toBe('250%');
    button('Fit').click();
    expect(props.fit).toHaveBeenCalledTimes(1);
  });
});

describe('Ignore areas', () => {
  it('takes the brush up and puts it down, never with the level line out', () => {
    show({ drawn: { drawing: true, points: [] } });
    expect(target.querySelector('input[aria-label="Brush size"]')).toBeNull();

    button('Ignore areas').click();
    flushSync();
    expect(props.brush.on).toBe(true);
    expect(level.drawing).toBe(false);
    expect(target.querySelector('input[aria-label="Brush size"]')).not.toBeNull();
    button('Erase').click();
    flushSync();
    expect(props.brush.erase).toBe(true);
    // the level line steps aside while the brush is out
    expect(target.querySelector('[data-guide="collage.straighten"]')).toBeNull();

    button('Done').click();
    flushSync();
    expect(props.brush).toMatchObject({ on: false, erase: false });
    button('Draw the line').click();
    flushSync();
    expect(level.drawing).toBe(true);
    button('Ignore areas').click();
    flushSync();
    expect(level.drawing).toBe(false);
  });

  it('clears what the selected piece holds', () => {
    show({ brush: { on: true, size: 40, erase: false } });
    expect(button('Clear piece').disabled).toBe(true);
    collage.nodes[0].exclude = [{ points: [[0.2, 0.2]], radius: 0.1 }];
    props.selectedIds = ['nd_1'];
    flushSync();
    button('Clear piece').click();
    flushSync();
    expect(collage.nodes[0].exclude).toEqual([]);
  });
});
