// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The frame's Analyze tab, driven the way an analyst drives it: the reverse-search
 * press hands over the frame pressed on, once, and a reading says whether it still
 * describes the frame as it reads now.
 */

vi.mock('../../lib/api.js', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../lib/state.svelte.js', () => ({
  caseState: { current: { id: 'case-a', folders: [] } },
  uiState: { tool: 'inspect' },
  toast: vi.fn(),
}));

const { default: FrameAnalyze } = await import('./FrameAnalyze.svelte');

const FRAME = {
  id: 'fr1', path: 'media/clip.mp4', time: 12.4, url: 'blob:frame', adjust: {}, crop: null,
  sourceOps: [], rotation: 0, w: 640, h: 360,
};

let live = null;
let target = null;

function open(reverse, horizon = null, extra = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(FrameAnalyze, {
    target,
    props: {
      frame: FRAME,
      analyses: [{ id: 'ela', label: 'Error Level Analysis' }],
      onrun: vi.fn(),
      reverse,
      horizon,
      ...extra,
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

describe('a frame matched in Horizon', () => {
  const horizonButton = () => [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Match in Horizon'));

  it('hands the frame over to be laid on the view', () => {
    const horizon = vi.fn();
    open(vi.fn(), horizon);
    horizonButton().click();
    expect(horizon).toHaveBeenCalledWith(FRAME);
  });

  it('is not offered where no Horizon is wired', () => {
    open(vi.fn());
    expect(horizonButton()).toBeUndefined();
  });
});

describe('a reading on the frame', () => {
  const ELA = { id: 'ela', kind: 'image', url: 'data:image/png;base64,x', note: 'A hint, not proof.', shown: true, opacity: 0.85 };

  it('runs the reading pressed on', () => {
    const onrun = vi.fn();
    open(vi.fn(), null, { onrun });
    [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Error Level Analysis')).click();
    expect(onrun).toHaveBeenCalledWith('ela');
  });

  it('lays a picture reading over the frame, with its strength and its caveat', () => {
    open(vi.fn(), null, { analysis: { ...ELA }, current: true });
    expect(target.textContent).toContain('Show over the frame');
    expect(target.textContent).toContain('A hint, not proof.');
    expect(target.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('asks to be run again once the frame was edited since', () => {
    open(vi.fn(), null, { analysis: { ...ELA }, current: false });
    expect(target.textContent).toContain('The frame changed since');
    expect(target.textContent).not.toContain('Show over the frame');
  });
});
