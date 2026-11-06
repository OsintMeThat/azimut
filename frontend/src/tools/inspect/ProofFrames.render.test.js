// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: ProofFrames } = await import('./ProofFrames.svelte');

const frame = (id, time, extra = {}) => ({ id, path: 'media/clip.mp4', time, url: `blob:${id}`, adjust: {}, crop: null, ...extra });
const scene = { kind: 'draft', id: 'sc_1', start: 10, end: 20, label: 'Bridge?', key: 'sc_1', color: 'red' };

let live = null;

function show(props) {
  const all = { scene, frames: [], filters: [], filedIds: new Set(), onconfirm: vi.fn(), oncancel: vi.fn(), ...props };
  live = mount(ProofFrames, { target: document.body, props: all });
  flushSync();
  return all;
}

const dialog = () => document.querySelector('[role="dialog"]');
const button = (text) => [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const boxes = () => [...dialog().querySelectorAll('input[type="checkbox"]')];

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('making the proof of a scene', () => {
  it('offers the scene\'s frames, every one ticked, and hands over the ticked ones', () => {
    const props = show({ frames: [frame('a', 10.5), frame('b', 12)], filedIds: new Set(['a']) });

    expect(dialog().getAttribute('aria-label')).toBe('Make the proof');
    expect(dialog().textContent).toContain('Bridge?');
    expect(dialog().textContent).toContain('0:10–0:20');
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    expect(dialog().textContent).toContain('2 of 2 frames in the proof');
    // the one not in the case yet says it is saved on the way
    expect(dialog().textContent).toContain('Saves 1 frame to the case on the way.');

    boxes()[0].click();
    flushSync();
    expect(dialog().textContent).toContain('1 of 2 frames in the proof');
    button('Make the proof').click();
    expect(props.onconfirm).toHaveBeenCalledWith(['b'], []);
  });

  it('makes nothing once every frame is unticked, and ticks them all back in one press', () => {
    const props = show({ frames: [1, 2, 3, 4].map((t) => frame(`f${t}`, 10 + t)) });

    button('Untick all').click();
    flushSync();
    expect(boxes().every((b) => !b.checked)).toBe(true);
    expect(button('Make the proof').disabled).toBe(true);
    expect(dialog().textContent).not.toContain('on the way');

    button('Tick all').click();
    flushSync();
    button('Make the proof').click();
    expect(props.onconfirm).toHaveBeenCalledWith(['f1', 'f2', 'f3', 'f4'], []);
  });

  it('keeps the tick-all press out of the way for a few frames', () => {
    show({ frames: [frame('a', 11)] });
    expect(button('Untick all')).toBeUndefined();
    expect(dialog().textContent).toContain('1 of 1 frame in the proof');
  });

  it('says which frame it captures when the scene holds none', () => {
    const props = show({ capture: { time: 14.2, why: 'sharpest' } });

    expect(boxes()).toHaveLength(0);
    expect(dialog().textContent).toContain('No frame in this scene yet.');
    expect(dialog().textContent).toContain('Captures and saves the sharpest frame of the scene, at 0:14.');
    button('Make the proof').click();
    expect(props.onconfirm).toHaveBeenCalledWith([], []);
  });

  it.each([
    ['start', 'Captures and saves the frame the scene starts on, at 0:10.'],
    ['instant', 'Captures and saves the frame at 0:10.'],
    ['screen', 'Captures and saves the frame on screen, at 0:10.'],
  ])('words the %s capture', (why, words) => {
    show({ capture: { time: 10, why } });
    expect(dialog().textContent).toContain(words);
  });

  it('offers the captures the scene gathered on the map after its frames, ticked too', () => {
    const captures = [
      { path: 'media/cap-1.png', url: 'blob:c1', title: 'Bridge from above' },
      { path: 'media/cap-2.png', url: 'blob:c2', title: 'Bridge, oblique' },
    ];
    const props = show({ frames: [frame('a', 11)], captures, filedIds: new Set(['a']) });
    const lists = [...dialog().querySelectorAll('ul')].map((ul) => ul.getAttribute('aria-label'));
    expect(lists).toEqual(['Frames of the scene', 'Captures of the scene']);
    expect(boxes().map((b) => [b.getAttribute('aria-label'), b.checked])).toEqual([
      ['Frame at 0:11', true], ['Capture Bridge from above', true], ['Capture Bridge, oblique', true],
    ]);
    expect(dialog().textContent).toContain('2 of 2 captures from the map');
    boxes()[2].click();
    flushSync();
    expect(dialog().textContent).toContain('1 of 2 captures from the map');
    button('Make the proof').click();
    expect(props.onconfirm).toHaveBeenCalledWith(['a'], ['media/cap-1.png']);
  });

  it('needs a frame of the video even when captures are ticked, since the proof rests on one', () => {
    show({ frames: [frame('a', 11)], captures: [{ path: 'media/cap-1.png', url: 'blob:c1', title: 'Cap' }] });
    boxes()[0].click();
    flushSync();
    expect(button('Make the proof').disabled).toBe(true);
  });

  it('captures a frame beside the captures when the scene holds none', () => {
    const props = show({ capture: { time: 14.2, why: 'start' }, captures: [{ path: 'media/cap-1.png', url: 'blob:c1', title: 'Cap' }] });
    expect(dialog().textContent).toContain('No frame in this scene yet.');
    button('Make the proof').click();
    expect(props.onconfirm).toHaveBeenCalledWith([], ['media/cap-1.png']);
  });

  it('names an unlabelled scene by its time, and the whole video in words', () => {
    show({ scene: { ...scene, label: '' }, frames: [frame('a', 11)] });
    const line = dialog().querySelector('.scene-line');
    expect(line.textContent.trim()).toBe('0:10–0:20');
    expect(line.textContent).not.toContain('To geolocate');
    unmount(live);
    live = null;
    document.body.innerHTML = '';

    show({ scene: { ...scene, start: null, end: null }, frames: [frame('a', 11)] });
    const when = dialog().querySelector('.scene-line .when');
    expect(when.textContent).toBe('Whole video');
    expect(when.classList.contains('mono')).toBe(false);
  });

  it('says on its picture that a frame is not in the case yet', () => {
    show({ frames: [frame('a', 10.5), frame('b', 12)], filedIds: new Set(['a']) });
    const chips = [...dialog().querySelectorAll('.unsaved')];
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe('Not in the case');
    expect(chips[0].closest('li').textContent).toContain('0:12');
  });

  it('holds still while it works, and lets go on Cancel', () => {
    const props = show({ frames: [frame('a', 11)], busy: true });
    expect(button('Making…').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    unmount(live);
    live = null;
    document.body.innerHTML = '';

    const idle = show({ frames: [frame('a', 11)] });
    button('Cancel').click();
    expect(idle.oncancel).toHaveBeenCalled();
    expect(props.oncancel).not.toHaveBeenCalled();
  });
});
