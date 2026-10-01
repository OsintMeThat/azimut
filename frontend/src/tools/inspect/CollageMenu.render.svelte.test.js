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

function show(nodes, selectedIds) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageMenu, {
    target,
    props: {
      collage: { width: 1600, height: 800, nodes },
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
