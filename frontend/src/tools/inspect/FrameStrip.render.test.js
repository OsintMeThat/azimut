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
    onsave: vi.fn(),
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

describe('saving a frame from its tile', () => {
  const saves = () => [...target.querySelectorAll('button[aria-label="Save frame"]')];

  it('saves in one press, without opening the frame', () => {
    const props = show({ frames: [frame('a', 1), frame('b', 2)] });

    expect(saves()).toHaveLength(2);
    saves()[1].click();
    expect(props.onsave).toHaveBeenCalledWith('b');
    expect(props.onselect).not.toHaveBeenCalled();
  });

  it('turns the press into the in-case mark once the frame is filed', () => {
    show({ frames: [frame('a', 1), frame('b', 2)], filedIds: new Set(['a']) });

    const [first, second] = target.querySelectorAll('.strip > div.tile');
    expect(first.querySelector('.filed')).not.toBeNull();
    expect(first.querySelector('button[aria-label="Save frame"]')).toBeNull();
    expect(second.querySelector('button[aria-label="Save frame"]')).not.toBeNull();
  });

  it('shows a frame being saved, and leaves it out of the save-all count', () => {
    show({ frames: [frame('a', 1), frame('b', 2), frame('c', 3)], busyIds: new Set(['a']) });

    const first = target.querySelector('.strip > div.tile');
    expect(first.querySelector('[aria-label="Saving"]')).not.toBeNull();
    expect(saves()).toHaveLength(2);
    expect(target.textContent).toContain('Save 2 frames');
  });

  it('offers nothing to save while the frame is still rendering', () => {
    show({ frames: [frame('a', 1, { url: null })] });
    expect(saves()).toHaveLength(0);
  });
});
