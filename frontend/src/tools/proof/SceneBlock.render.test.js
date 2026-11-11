// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(async () => ({ kind: 'video', duration: 400, fps: 25 })),
    // the prefs as settings.json now holds them
    put: vi.fn(async (url, body) => ({ ...body })),
  },
}));

import SceneBlock from './SceneBlock.svelte';
import { ProofScene } from './proofScene.svelte.js';
import { api } from '../../lib/api.js';
import { prefs } from '../../lib/state.svelte.js';
import { PROOF_SCENE_HELP } from '../../lib/proofSceneHelp.js';

/**
 * The Scene tab of Geo Proof's side column, used the way an analyst uses it: the
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

function setup({ frames = [{ panel: 'p1', video: CLIP, time: 130.4 }], stated = null, name = 'depot', active = true, listed = null, opened = false } = {}) {
  const puts = [];
  const api = {
    put: vi.fn(async (url, body) => {
      puts.push(body);
      // what the server answers: a proof that says no more than its first frame states nothing
      return { video: body.video, moments: body.moments, at: [], stated: body.moments.length > 0 || body.video !== CLIP || !!body.draft, draft: body.draft ?? null };
    }),
  };
  const scene = new ProofScene({ api, toast: vi.fn(), where: () => ({ caseId: 'case', name }), frames: () => frames, listed: () => listed });
  if (stated || opened) scene.load(stated ?? undefined);
  const onaddframe = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  targets.push(target);
  live.push(mount(SceneBlock, { target, props: { scene, caseId: 'case', color: 'var(--anno-1)', active, onaddframe } }));
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
    // the tab says Scene already, so the field names what it lists
    expect(root.querySelector('.meta-head').textContent.trim()).toBe('Video');
    expect(field.classList.contains('field-with-act')).toBe(true);
    expect(field.querySelector('.line').textContent.replace(/\s+/g, ' ').trim()).toBe('★ clip · 2:10–2:38');
    expect(field.querySelector('.time').getAttribute('aria-label')).toBe('Time of the scene, 2:10–2:38');
    expect(field.querySelector('.field-act').getAttribute('aria-label')).toBe('Play clip');
    expect(field.querySelector('.field-act').getAttribute('title')).toBe('Play it in the player');
    // the editor waits to be asked
    expect(root.querySelector('.editor')).toBeNull();
  });

  it('opens the player on the ★ video with the tab, paused where the scene starts', async () => {
    const { root, scene } = setup({ stated: { video: CLIP, moments: [{ start: 130, end: 158 }] } });
    await settle();
    expect(scene.view).toMatchObject({ video: CLIP, play: false, at: null });
    const player = root.querySelector('[data-testid="scene-player"]');
    expect(player).not.toBeNull();
    expect(player.querySelector('video').paused).toBe(true);
    // half a frame in, at whatever rate is known yet
    expect(player.querySelector('video').currentTime).toBeCloseTo(130.02, 1);
    expect(fields(root)[0].querySelector('.field-act').classList.contains('on')).toBe(true);
  });

  it('opens nothing while its tab is hidden', async () => {
    const { root, scene } = setup({ active: false });
    await settle();
    expect(scene.view).toBeNull();
    expect(root.querySelector('[data-testid="scene-player"]')).toBeNull();
  });

  it('names its fields Videos when there are two', () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { root } = setup({ frames });
    expect(root.querySelector('.meta-head').textContent.trim()).toBe('Videos');
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
    expect(second.querySelector('.line').textContent.replace(/\s+/g, ' ').trim()).toBe('☆ other · confirmation');
    second.querySelector('[aria-label="Make other the proof\'s video"]').click();
    await settle();
    expect(puts).toEqual([{ moments: [], video: OTHER }]);
    expect(fields(root).map((f) => f.querySelector('.name').textContent)).toEqual(['other', 'clip']);
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

  it('adds a passage of the scene\'s kind from the player\'s frame, held on the bar, the end of the clip bounding it', async () => {
    const { root, scene, puts } = setup({ stated: { video: CLIP, moments: [{ start: 130, end: 158 }] } });
    fields(root)[0].querySelector('.time').click();
    await settle();
    const video = root.querySelector('video');
    video.currentTime = 200;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    const editor = root.querySelector('.editor');
    button(editor, 'Another passage').click();
    flushSync();
    expect([scene.edit.active, scene.edit.start, scene.edit.end]).toEqual([1, 200, 228]);
    expect(root.querySelectorAll('[data-testid="scene-band"].held')).toHaveLength(1);

    // near the clip's end it is cut there; with no frame left it is said, not added
    video.currentTime = 390;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    button(editor, 'Another passage').click();
    flushSync();
    expect([scene.edit.start, scene.edit.end]).toEqual([390, 400]);
    video.currentTime = 395;
    video.dispatchEvent(new Event('timeupdate'));
    flushSync();
    button(editor, 'Another passage').click();
    flushSync();
    expect(scene.edit.moments).toHaveLength(3);
    expect(editor.querySelector('[role="status"]').textContent).toBe('No room here for another passage');

    button(editor, 'Apply').click();
    await settle();
    expect(puts).toEqual([{ moments: [{ start: 130, end: 158 }, { start: 200, end: 228 }, { start: 390, end: 400 }], video: CLIP }]);
  });

  it('draws the moments in the scene\'s colour on the player\'s bar, and the panels\' frames as dots', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130.4 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { root, scene } = setup({ frames, stated: { video: CLIP, moments: [{ start: 120, end: 160 }, { start: 200, end: null }] } });
    await settle();
    const player = root.querySelector('[data-testid="scene-player"]');
    expect(player.getAttribute('style')).toContain('--scene: var(--anno-1)');
    expect(player.querySelector('video').getAttribute('src')).toBe('/files/case/media/clip.mp4');
    expect(player.querySelector('video').muted).toBe(true);
    expect(player.querySelector('[data-testid="scene-band"]').style.left).toBe('30%');
    expect(player.querySelector('[data-testid="scene-pin"]').style.left).toBe('50%');
    expect([...player.querySelectorAll('.dot')].map((d) => d.style.left)).toEqual(['32.6%', '75%']);
    // the act runs the scene in the player, which stays
    fields(root)[0].querySelector('.field-act').click();
    await settle();
    expect(scene.view).toMatchObject({ video: CLIP, play: true });
    expect(player.querySelector('[aria-label="Loop the scene"]').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-testid="scene-player"]')).toBe(player);
  });

  it('runs a confirmation video in the player from its field', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { root, scene } = setup({ frames });
    await settle();
    expect(root.querySelector('video').getAttribute('src')).toBe('/files/case/media/clip.mp4');
    fields(root)[1].querySelector('.field-act').click();
    await settle();
    expect(scene.view).toMatchObject({ video: OTHER, play: true });
    expect(root.querySelector('video').getAttribute('src')).toBe('/files/case/media/other.mp4');
    expect(fields(root)[1].querySelector('.field-act').classList.contains('on')).toBe(true);
    expect(fields(root)[0].querySelector('.field-act').classList.contains('on')).toBe(false);
  });
});

describe('the player', () => {
  it('makes the frame on screen a panel', async () => {
    const { root, onaddframe } = setup();
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

describe('a panel outside the passages', () => {
  it('is said, and its moment added on demand', async () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p3', video: CLIP, time: 300 }];
    const { root, puts } = setup({ frames, stated: { video: CLIP, moments: [{ start: 120, end: 140 }] } });
    const note = root.querySelector('.outside');
    expect(note.textContent.replace(/\s+/g, ' ').trim()).toBe('1 panel is outside these passages. Add its passage');
    button(note, 'Add its passage').click();
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

describe('the scene its frames found', () => {
  /** The clip's scenes still to prove, as the strip read them: Bridge? from 2:00 to 2:20, an instant at 5:00. */
  const LISTED = {
    video: CLIP,
    scenes: [
      { kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null },
      { kind: 'draft', id: 's2', start: 300, end: null, label: '', state: 'todo', captures: [], abandoned: null },
    ],
    taken: [],
    collages: [],
  };
  const line = (root) => root.querySelector('[data-testid="scene-match"]');
  const words = (node) => node.textContent.replace(/\s+/g, ' ').trim();

  it('is named under the ★ field in its colour, with its time in the field and a way out', () => {
    const { root } = setup({ name: null, listed: LISTED });
    const [field] = fields(root);
    expect(words(field.querySelector('.line'))).toBe('★ clip · 2:00–2:20');
    const found = line(root);
    expect(field.nextElementSibling).toBe(found);
    expect(words(found)).toBe('Bridge? · found by its frames Not this scene');
    expect(found.getAttribute('title')).toBe('Its panels from this video all fall in this scene, which the save takes up');
    expect(found.querySelector('.swatch').style.background).toBe('var(--anno-2)');
    expect(button(found, 'Not this scene').getAttribute('title')).toBe('Keep this proof apart from that scene');
    // all of its frames are in the scene, so none is said to be outside
    expect(root.querySelector('.outside')).toBeNull();
  });

  it('names a scene with no label by its time, and the whole video as its only scene', () => {
    const instant = setup({ name: null, listed: LISTED, frames: [{ panel: 'p1', video: CLIP, time: 300 }] });
    expect(words(line(instant.root))).toBe('5:00 · found by its frames Not this scene');
    const whole = {
      video: CLIP, taken: [], collages: [],
      scenes: [{ kind: 'draft', id: 'w', start: null, end: null, label: 'Which town?', state: 'todo', captures: [], abandoned: null }],
    };
    const only = setup({ name: null, listed: whole });
    expect(words(line(only.root))).toBe('Which town? · the video\'s only scene Not this scene');
    expect(line(only.root).getAttribute('title')).toBe('The one scene of this video to geolocate, which the save takes up');
    expect(words(fields(only.root)[0].querySelector('.line'))).toBe('★ clip · Whole video');
  });

  it('goes with Not this scene, the field reading the whole video again, and nothing written', async () => {
    const { root, puts } = setup({ name: null, listed: LISTED });
    button(line(root), 'Not this scene').click();
    await settle();
    expect(line(root)).toBeNull();
    expect(words(fields(root)[0].querySelector('.line'))).toBe('★ clip · Whole video');
    expect(puts).toEqual([]);
  });

  it('is not said of frames in two scenes, nor of a proof stating its scene', () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: CLIP, time: 300 }];
    expect(line(setup({ name: null, listed: LISTED, frames }).root)).toBeNull();
    expect(line(setup({ listed: LISTED, stated: { video: CLIP, moments: [{ start: 125, end: 135 }] } }).root)).toBeNull();
  });

  it('stands under the ★ alone, with a confirmation video below', () => {
    const frames = [{ panel: 'p1', video: CLIP, time: 130 }, { panel: 'p2', video: OTHER, time: 12 }];
    const { root } = setup({ name: null, listed: LISTED, frames });
    const [star, other] = fields(root);
    expect(star.nextElementSibling).toBe(line(root));
    expect(line(root).nextElementSibling).toBe(other);
  });
});

describe('the scene offered to a saved proof', () => {
  const LISTED = {
    video: CLIP,
    scenes: [{ kind: 'draft', id: 's1', start: 120, end: 140, label: 'Bridge?', state: 'todo', captures: [], abandoned: null }],
    taken: [],
    collages: [],
  };
  const offer = (root) => root.querySelector('[data-testid="scene-proposal"]');
  const words = (node) => node.textContent.replace(/\s+/g, ' ').trim();

  it('is named under the ★ field with its time, the field keeping the time the proof states', () => {
    const { root } = setup({ listed: LISTED, opened: true });
    const [field] = fields(root);
    expect(words(field.querySelector('.line'))).toBe('★ clip · Whole video');
    expect(root.querySelector('[data-testid="scene-match"]')).toBeNull();
    expect(field.nextElementSibling).toBe(offer(root));
    expect(words(offer(root))).toBe('Bridge? · 2:00–2:20 Take it up Not this scene');
    expect(offer(root).getAttribute('title')).toBe('Its panels from this video all fall in this scene, still to prove');
    expect(button(offer(root), 'Take it up').getAttribute('title')).toBe('Make this scene\'s time the proof\'s, and take the scene up');
  });

  it('is taken up with Take it up, written at once with the scene', async () => {
    const { root, puts, scene } = setup({ listed: LISTED, opened: true });
    button(offer(root), 'Take it up').click();
    await settle();
    expect(puts).toEqual([{ moments: [{ start: 120, end: 140 }], video: CLIP, draft: 's1' }]);
    expect(offer(root)).toBeNull();
    expect(scene.draft).toBe('s1');
  });

  it('goes with Not this scene, nothing written', async () => {
    const { root, puts } = setup({ listed: LISTED, opened: true });
    button(offer(root), 'Not this scene').click();
    await settle();
    expect(offer(root)).toBeNull();
    expect(words(fields(root)[0].querySelector('.line'))).toBe('★ clip · Whole video');
    expect(puts).toEqual([]);
  });

  it('is never made to a proof that said the whole video', () => {
    const { root } = setup({ listed: LISTED, stated: { video: CLIP, moments: [] } });
    expect(offer(root)).toBeNull();
  });
});

describe('the ▶ on video panels', () => {
  const box = (root) => root.querySelector('label.plays');

  it('is a box of the tab, ticked unless the analyst hid them, its words on hover', () => {
    prefs.proofScenePlays = true;
    const { root } = setup({ stated: { video: CLIP, moments: [{ start: 130, end: 158 }] } });
    expect(box(root).textContent.trim()).toBe('▶ on video panels');
    expect(box(root).getAttribute('title')).toBe(PROOF_SCENE_HELP.plays);
    expect(box(root).getAttribute('title')).toBe('Shows a play button on each panel cut from a video');
    expect(box(root).querySelector('input').checked).toBe(true);
  });

  it('hides them for every proof, kept in settings.json, and shows them again', async () => {
    prefs.proofScenePlays = true;
    api.put.mockClear();
    const { root } = setup();
    const input = box(root).querySelector('input');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    // the box answers the click, before the round trip
    expect(prefs.proofScenePlays).toBe(false);
    await settle();
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { proof_scene_plays: false });
    expect(prefs.proofScenePlays).toBe(false);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.put).toHaveBeenLastCalledWith('/api/settings/prefs', { proof_scene_plays: true });
    expect(prefs.proofScenePlays).toBe(true);
  });

  it('reads as the analyst left it on the next proof', () => {
    prefs.proofScenePlays = false;
    const { root } = setup();
    expect(box(root).querySelector('input').checked).toBe(false);
    prefs.proofScenePlays = true;
  });
});
