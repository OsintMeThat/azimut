// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The frame panel's reverse-search press, driven the way an analyst drives it: the
 * frame pressed on is the one handed over, and a second press while the first is
 * still rendering does not send it twice.
 */

vi.mock('../../lib/api.js', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../lib/state.svelte.js', () => ({
  caseState: { current: { id: 'case-a', folders: [] } },
  uiState: { tool: 'inspect' },
  toast: vi.fn(),
}));

const { default: FrameMenu } = await import('./FrameMenu.svelte');

const FRAME = {
  id: 'fr1', path: 'media/clip.mp4', time: 12.4, url: 'blob:frame', adjust: {}, crop: null,
  sourceOps: [], rotation: 0, w: 640, h: 360,
};

let live = null;
let target = null;

function open(reverse) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(FrameMenu, {
    target,
    props: {
      frame: FRAME,
      filters: [],
      analyses: [],
      shared: {},
      setRotation: vi.fn(),
      reverse,
      onduplicate: vi.fn(),
      frameSave: { defaultName: '00-00-12 clip', filedPath: null, busy: false, blocked: '', onsave: vi.fn() },
    },
  });
  flushSync();
}

const button = () => [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Reverse image search') || b.textContent.includes('Preparing'));

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('reverse search from a frame', () => {
  it('hands over the active frame', async () => {
    const reverse = vi.fn(async () => {});
    open(reverse);

    button().click();
    await Promise.resolve();

    expect(reverse).toHaveBeenCalledTimes(1);
    expect(reverse).toHaveBeenCalledWith(FRAME);
  });

  it('holds the button while the frame renders, so one press sends it once', async () => {
    let finish;
    const reverse = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    open(reverse);

    button().click();
    flushSync();
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain('Preparing');
    button().click();
    expect(reverse).toHaveBeenCalledTimes(1);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(button().disabled).toBe(false);
  });
});
