// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: FrameStrip } = await import('./FrameStrip.svelte');

const frame = (id, time, extra = {}) => ({
  id, path: 'media/clip.mp4', time, url: `blob:${id}`, adjust: {}, crop: null, ...extra,
});

let live = null;
let target = null;

function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  const all = {
    source: { kind: 'video', path: 'media/clip.mp4' },
    frames: [],
    selected: 'video',
    filters: [],
    filedIds: new Set(),
    onselect: vi.fn(),
    onremove: vi.fn(),
    onsaveall: vi.fn(),
    ...props,
  };
  live = mount(FrameStrip, { target, props: all });
  flushSync();
  return all;
}

const buttons = () => [...target.querySelectorAll('button')];

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the frame strip', () => {
  it('leads with the video, where frames come from', () => {
    const props = show({ frames: [frame('a', 12.4)] });

    const first = target.querySelector('.tile');
    expect(first.textContent).toContain('Video');
    first.click();
    expect(props.onselect).toHaveBeenCalledWith('video');
  });

  it('names each frame by where it sits in the clip', () => {
    const props = show({ frames: [frame('a', 12.4), frame('b', 75)] });

    const pick = target.querySelector('button[aria-label="Frame 2 at 1:15.0"]');
    expect(pick).not.toBeNull();
    pick.click();
    expect(props.onselect).toHaveBeenCalledWith('b');
  });

  it('says where captures go before there are any', () => {
    show({ frames: [] });
    expect(target.textContent).toContain('Frames you capture are kept with this video.');
  });

  it('offers to save every frame not in the case yet, once there are two', () => {
    const props = show({ frames: [frame('a', 1), frame('b', 2), frame('c', 3)], filedIds: new Set(['a']) });

    const saveAll = buttons().find((b) => b.textContent.includes('Save 2 frames'));
    saveAll.click();
    expect(props.onsaveall).toHaveBeenCalled();
    expect(target.querySelectorAll('.filed')).toHaveLength(1);
  });

  it('keeps the save-all press out of the way for a single frame', () => {
    show({ frames: [frame('a', 1)] });
    expect(buttons().some((b) => b.textContent.includes('Save'))).toBe(false);
  });

  it('keeps the last frame of an image, which is the image itself', () => {
    show({
      source: { kind: 'image', path: 'media/roof.png' },
      frames: [frame('a', null, { path: 'media/roof.png' })],
      selected: 'a',
      removable: false,
    });
    expect(target.querySelector('button[aria-label="Remove frame"]')).toBeNull();
    expect(target.textContent).not.toContain('Video');
  });

  it('removes a frame on its own button', () => {
    const props = show({ frames: [frame('a', 1)] });
    target.querySelector('button[aria-label="Remove frame"]').click();
    expect(props.onremove).toHaveBeenCalledWith('a');
  });
});
