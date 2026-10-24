// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../../lib/api.js', () => ({ api: { post: vi.fn() } }));
vi.mock('../../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case-a' } }, toast: vi.fn() }));

const { default: CollageMenu } = await import('./CollageMenu.svelte');

const rect = [[0, 0], [80, 0], [80, 60], [0, 60]];
const node = (id, save, extra = {}) => ({ id, save, quad: rect, w: 80, h: 60, url: `blob:${id}`, ...extra });

let live;
let target;

function show(nodes, selectedIds, extra = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageMenu, {
    target,
    props: {
      ...extra,
      collage: extra.collage ?? { width: 1600, height: 800, nodes },
      selectedIds,
      requestCrop: vi.fn(),
      renderPiece: vi.fn(),
      fileTitles: new Map([['media/clip.mp4', 'Convoy clip']]),
    },
  });
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the selected piece', () => {
  it('says which file it was cut from, and where in it', () => {
    show([node('nd_1', { path: 'media/clip.mp4', time: 12.4, ops: [] })], ['nd_1']);

    expect(target.querySelector('.identity .source').textContent).toBe('Convoy clip · 0:12.4');
    expect(target.querySelector('.identity img').getAttribute('src')).toBe('blob:nd_1');
  });

  it('names an image by its file alone, even one the case no longer lists', () => {
    show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] })], ['nd_1']);

    expect(target.querySelector('.identity .source').textContent).toBe('roof.png');
  });

  it('shows nothing of a piece while none is selected, and asks for no canvas size', () => {
    show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] })], []);

    expect(target.querySelector('.identity')).toBeNull();
    expect(target.querySelector('input[type="number"]')).toBeNull();
    expect(target.querySelector('.hint')).toBeNull();
  });
});

describe('straightening along a level line', () => {
  const straightenButton = () => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Straighten');

  it('waits for a line of two points or more', () => {
    show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] })], [], { level: { drawing: false, points: [[10, 30]] } });

    expect(target.querySelector('[data-guide="collage.straighten"] .say').textContent).toMatch(/level that crosses the view/);
    expect(straightenButton().disabled).toBe(true);
  });

  it('hands the line to the tool to bend the whole collage, and waits for it', async () => {
    const pieces = [node('nd_1', { path: 'media/pan.png', time: null, ops: [] })];
    const level = { drawing: true, points: [[5, 30], [145, 50]] };
    let finish;
    const straighten = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    show(pieces, [], { level, straighten });

    straightenButton().click();
    flushSync();
    expect(straighten).toHaveBeenCalledTimes(1);
    // one bend at a time
    expect([...target.querySelectorAll('button')].find((b) => b.textContent.includes('Straightening')).disabled).toBe(true);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(straightenButton().disabled).toBe(false);
  });
});
