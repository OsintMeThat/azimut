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

function show({ nodes = [node('nd_1', 0), node('nd_2', 100)], drawn = null, straighten = null, renderPiece = vi.fn() } = {}) {
  const shownCollage = $state({ width: 1600, height: 800, nodes, straightened: false });
  const shownView = $state({ zoom: 1, x: 0, y: 0 });
  const shownLevel = $state(drawn ?? { drawing: false, points: [] });
  collage = shownCollage;
  view = shownView;
  level = shownLevel;
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageToolbar, { target, props: { collage, selectedIds: [], renderPiece, level, straighten, view } });
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
    expect(message).toBe('Stitched 1. 1 left in place because no overlap was found');
    expect(kind).toBe('warn');
    expect(action.label).toBe('Undo');

    target.querySelector('button[aria-label="More ways to stitch"]').click();
    flushSync();
    expect(button('Undo auto-stitch')).toBeTruthy();
    action.onClick();
    flushSync();
    expect([collage.width, collage.height]).toEqual([1600, 800]);
    expect(collage.nodes[0].quad).toEqual(rect(0));
    expect(collage.nodes[1].quad).toEqual(rect(100));
    expect(button('Undo auto-stitch')).toBeFalsy();
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

describe('Fit', () => {
  it('puts the view back, and rests while it is there', () => {
    show();
    expect(button('Fit').disabled).toBe(true);
    expect(target.querySelector('.zoom')).toBeNull();

    Object.assign(view, { zoom: 2.5, x: -40, y: 12 });
    flushSync();
    expect(target.querySelector('.zoom').textContent).toBe('250%');
    button('Fit').click();
    flushSync();
    expect({ ...view }).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(button('Fit').disabled).toBe(true);
  });
});
