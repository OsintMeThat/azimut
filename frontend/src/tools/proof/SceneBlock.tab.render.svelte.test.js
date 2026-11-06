// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('../../lib/api.js', () => ({
  api: { get: vi.fn(async () => ({ kind: 'video', duration: 400, fps: 25 })) },
}));

import SceneBlock from './SceneBlock.svelte';
import { ProofScene } from './proofScene.svelte.js';

/**
 * The Scene tab shown and hidden: the player stops where nobody sees it, keeps its
 * frame for the tab shown again, and a ▶ on the canvas still reaches it.
 */

const CLIP = 'media/clip.mp4';
let live = [];

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  for (const [one, target] of live) {
    unmount(one);
    target.remove();
  }
  live = [];
});

const settle = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

function setup() {
  const api = { put: vi.fn() };
  const frames = [{ panel: 'p1', video: CLIP, time: 130.4 }];
  const scene = new ProofScene({ api, toast: vi.fn(), where: () => ({ caseId: 'case', name: 'depot' }), frames: () => frames });
  scene.load({ video: CLIP, moments: [{ start: 120, end: 160 }] });
  const props = $state({ scene, caseId: 'case', active: true, onaddframe: vi.fn() });
  const target = document.createElement('div');
  document.body.append(target);
  live.push([mount(SceneBlock, { target, props }), target]);
  flushSync();
  return { root: target, scene, props };
}

describe('the Scene tab, left and shown again', () => {
  it('stops the scene playing as the tab is left, and finds the same frame on return', async () => {
    const { root, scene, props } = setup();
    await settle();
    scene.show(CLIP, { play: true });
    await settle();
    const video = root.querySelector('video');
    expect(video.paused).toBe(false);
    video.currentTime = 141.02;
    video.dispatchEvent(new Event('timeupdate'));

    props.active = false;
    await settle();
    expect(video.paused).toBe(true);
    expect(root.querySelector('[aria-label="Loop the scene"]').getAttribute('aria-pressed')).toBe('false');

    props.active = true;
    await settle();
    // the same player, on the same frame, and nothing asked of it again
    expect(root.querySelector('video')).toBe(video);
    expect(video.currentTime).toBeCloseTo(141.02, 6);
    expect(video.paused).toBe(true);
  });

  it('goes to a panel\'s frame asked from the canvas while the tab was hidden', async () => {
    const { root, scene, props } = setup();
    await settle();
    props.active = false;
    await settle();
    // the composer shows the tab and points the player at the frame in one go
    scene.show(CLIP, { at: 150 });
    props.active = true;
    await settle();
    expect(root.querySelector('video').currentTime).toBeCloseTo(150.02, 1);
  });
});
