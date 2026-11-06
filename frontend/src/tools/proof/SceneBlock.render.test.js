// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('../../lib/api.js', () => ({
  api: { get: vi.fn(async () => ({ kind: 'video', duration: 400, fps: 25 })) },
}));

import SceneBlock from './SceneBlock.svelte';
import { ProofScene } from './proofScene.svelte.js';

/**
 * The scene block in Geo Proof's side column, used the way an analyst uses it: the
 * field of each video the proof rests on, its time opened in Inspect's editor, the
 * player under the fields, a frame made a panel, and a panel outside the moments.
 */

const CLIP = 'media/clip.mp4';
const OTHER = 'media/other.mp4';

let live = [];
let targets = [];

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
});

afterEach(() => {
  for (const one of live) unmount(one);
  live = [];
  for (const node of targets) node.remove();
  targets = [];
});

function setup({ frames = [{ panel: 'p1', video: CLIP, time: 130.4 }], stated = null, name = 'depot' } = {}) {
  const puts = [];
  const api = {
    put: vi.fn(async (url, body) => {
      puts.push(body);
      // what the server answers: a proof that says no more than its first frame states nothing
      return { video: body.video, moments: body.moments, at: [], stated: body.moments.length > 0 || body.video !== CLIP, draft: null };
    }),
  };
  const scene = new ProofScene({ api, toast: vi.fn(), where: () => ({ caseId: 'case', name }), frames: () => frames });
  if (stated) scene.load(stated);
  const onaddframe = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  targets.push(target);
  live.push(mount(SceneBlock, { target, props: { scene, caseId: 'case', color: 'var(--anno-1)', onaddframe } }));
  flushSync();
  return { root: target, scene, puts, onaddframe };
}

const fields = (root) => [...root.querySelectorAll('[data-testid="scene-video"]')];
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const settle = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

describe('the scene field', () => {
  it('reads like the fields around it: the ★ video and its time, a play act at its end', () => {
    const { root } = setup({ stated: { video: CLIP, moments: [{ start: 130, end: 158 }] } });
    const [field] = fields(root);
    expect(root.querySelector('.meta-head').textContent.trim()).toBe('Scene');
    expect(field.classList.contains('field-with-act')).toBe(true);
    expect(field.querySelector('.line').textContent.replace(/\s+/g, ' ').trim()).toBe('★ clip.mp4 · 2:10–2:38');
    expect(field.querySelector('.time').getAttribute('aria-label')).toBe('Time of the scene, 2:10–2:38');
    expect(field.querySelector('.field-act').getAttribute('aria-label')).toBe('Play clip.mp4');
    // nothing open until asked
    expect(root.querySelector('[data-testid="scene-player"]')).toBeNull();
    expect(root.querySelector('.editor')).toBeNull();
  });

  it('says Whole video for a proof that states no time', () => {
    const { root } = setup();
    expect(fields(root)[0].querySelector('.time').textContent.trim()).toBe('Whole video');
  });

  it('lists another video as a confirmation, made the ★ in one press', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { root, puts } = setup({ frames });
    const [first, second] = fields(root);
    expect(first.textContent).toContain('★');
    expect(second.querySelector('.line').textContent.replace(/\s+/g, ' ').trim()).toBe('☆ other.mp4 · confirmation');
    second.querySelector('[aria-label="Make other.mp4 the proof\'s video"]').click();
    await settle();
    expect(puts).toEqual([{ moments: [], video: OTHER }]);
    expect(fields(root).map((f) => f.querySelector('.name').textContent)).toEqual(['other.mp4', 'clip.mp4']);
  });
});

describe('the time, opened', () => {
  it('opens Inspect\'s editor under the player, Here taking the player\'s frame', async () => {
    const { root, scene, puts } = setup({ stated: { video: CLIP, moments: [{ start: 130, end: 158 }] } });
    fields(root)[0].querySelector('.time').click();
    await settle();
    expect(root.querySelector('[data-testid="scene-player"]')).not.toBeNull();
    const editor = root.querySelector('.editor');
    expect(editor.querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Passage');
    expect(editor.textContent).toContain('Here takes the frame on the player, for the start or the end');
    expect(button(editor, 'Here').getAttribute('title')).toBe('Start at the frame on the player');

    // the player stands on 2:24 and its frame is taken as the end
    const video = root.querySelector('video');
    video.currentTime = 144.02;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    [...editor.querySelectorAll('.here')][1].click();
    flushSync();
    expect(scene.edit.end).toBeCloseTo(144.04, 6);
    button(editor, 'Apply').click();
    await settle();
    expect(puts).toHaveLength(1);
    expect(puts[0].moments[0].start).toBe(130);
    expect(puts[0].moments[0].end).toBeCloseTo(144.04, 6);
    expect(root.querySelector('.editor')).toBeNull();
  });

  it('draws the moments in the scene\'s colour on the player\'s bar, and the panels\' frames as dots', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130.4 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { root } = setup({ frames, stated: { video: CLIP, moments: [{ start: 120, end: 160 }, { start: 200, end: null }] } });
    fields(root)[0].querySelector('.field-act').click();
    await settle();
    const player = root.querySelector('[data-testid="scene-player"]');
    expect(player.getAttribute('style')).toContain('--scene: var(--anno-1)');
    expect(player.querySelector('video').getAttribute('src')).toBe('/files/case/media/clip.mp4');
    expect(player.querySelector('video').muted).toBe(true);
    expect(player.querySelector('[data-testid="scene-band"]').style.left).toBe('30%');
    expect(player.querySelector('[data-testid="scene-pin"]').style.left).toBe('50%');
    expect([...player.querySelectorAll('.dot')].map((d) => d.style.left)).toEqual(['32.6%', '75%']);
    // the act now folds it
    expect(fields(root)[0].querySelector('.field-act').getAttribute('aria-label')).toBe('Fold the player');
    fields(root)[0].querySelector('.field-act').click();
    flushSync();
    expect(root.querySelector('[data-testid="scene-player"]')).toBeNull();
  });
});

describe('the player', () => {
  it('makes the frame on screen a panel', async () => {
    const { root, onaddframe } = setup();
    fields(root)[0].querySelector('.field-act').click();
    await settle();
    const video = root.querySelector('video');
    video.currentTime = 12.5;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    button(root, 'Add this frame').click();
    expect(onaddframe).toHaveBeenCalledWith(CLIP, 12.48);
  });

  it('steps a frame and keeps its keys from the composer behind it', async () => {
    const { root } = setup();
    fields(root)[0].querySelector('.field-act').click();
    await settle();
    const video = root.querySelector('video');
    video.currentTime = 10.02;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    const player = root.querySelector('[data-testid="scene-player"]');
    player.querySelector('[aria-label="Forward one frame"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    window.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(10.06, 6); // the next frame, half a frame in
  });
});

describe('a panel outside the moments', () => {
  it('is said, and its moment added on demand', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { root, puts } = setup({ frames, stated: { video: CLIP, moments: [{ start: 120, end: 140 }] } });
    const note = root.querySelector('.outside');
    expect(note.textContent.replace(/\s+/g, ' ').trim()).toBe('1 panel is outside these moments. Add its moment');
    button(note, 'Add its moment').click();
    await settle();
    expect(puts).toEqual([{ moments: [{ start: 120, end: 140 }, { start: 300, end: null }], video: CLIP }]);
    expect(root.querySelector('.outside')).toBeNull();
  });

  it('is never said of the whole video', () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { root } = setup({ frames });
    expect(root.querySelector('.outside')).toBeNull();
  });
});
