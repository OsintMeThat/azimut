// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: CollageMenu } = await import('./CollageMenu.svelte');

const rect = [[0, 0], [80, 0], [80, 60], [0, 60]];
const node = (id, save, extra = {}) => ({ id, save, quad: rect, w: 80, h: 60, url: `blob:${id}`, ...extra });

let live;
let target;
let requestCrop;

function show(nodes, selectedIds) {
  const collage = $state({ width: 1600, height: 800, nodes });
  requestCrop = vi.fn();
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CollageMenu, {
    target,
    props: { collage, selectedIds, requestCrop, fileTitles: new Map([['media/clip.mp4', 'Convoy clip']]) },
  });
  flushSync();
  return collage;
}

const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

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

  it('keeps every act on the piece: scale, turn, crop, unwarp, order and remove', () => {
    const collage = show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] }), node('nd_2', { path: 'media/b.png', time: null, ops: [] })], ['nd_1']);

    for (const label of ['Shrink piece', 'Enlarge piece', 'Rotate left', 'Rotate right']) {
      expect(target.querySelector(`button[aria-label="${label}"]`), label).not.toBeNull();
    }
    button('Crop').click();
    expect(requestCrop).toHaveBeenCalledWith(collage.nodes[0]);
    button('Front').click();
    flushSync();
    expect(collage.nodes.map((n) => n.id)).toEqual(['nd_2', 'nd_1']);
    button('Remove').click();
    flushSync();
    expect(collage.nodes.map((n) => n.id)).toEqual(['nd_2']);
  });

  it('offers to clear a crop beside Crop, once there is one', () => {
    show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] }, { crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })], ['nd_1']);

    target.querySelector('button[aria-label="Clear crop"]').click();
    expect(requestCrop).toHaveBeenCalledWith(expect.objectContaining({ id: 'nd_1' }), true);
  });
});

describe('the selected block', () => {
  it('counts the pieces and acts on them as one', () => {
    const collage = show([node('nd_1', { path: 'media/a.png', time: null, ops: [] }), node('nd_2', { path: 'media/b.png', time: null, ops: [] })], ['nd_1', 'nd_2']);

    expect(target.querySelector('.identity .source').textContent).toBe('2 pieces selected');
    expect(target.querySelector('button[aria-label="Enlarge block"]')).not.toBeNull();
    button('Remove 2').click();
    flushSync();
    expect(collage.nodes).toHaveLength(0);
  });
});

describe('with nothing selected', () => {
  it('says how to pick a piece, in the place its controls take, and asks for no canvas size', () => {
    show([node('nd_1', { path: 'media/roof.png', time: null, ops: [] })], []);

    expect(target.querySelector('.identity')).toBeNull();
    expect(target.querySelector('.none').textContent).toContain('Click a piece to scale, turn or crop it.');
    expect(target.querySelector('input[type="number"]')).toBeNull();
  });
});
