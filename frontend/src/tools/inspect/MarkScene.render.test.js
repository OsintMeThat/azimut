// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MarkScene from './MarkScene.svelte';

/** Mark to geolocate, above the tabs: Whole video, Passage and Instant, side by side. */

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

function render(props) {
  const target = document.createElement('div');
  document.body.append(target);
  targets.push(target);
  live.push(mount(MarkScene, { target, props }));
  flushSync();
  return target;
}

const kind = (root, name) => [...root.querySelectorAll('.kind')].find((b) => b.textContent.includes(name));

describe('Mark to geolocate', () => {
  it('names itself over the three kinds, in the order a scene\'s time names them, S said on Instant', () => {
    const root = render({});
    expect(root.querySelector('.mark-head').textContent.trim()).toBe('Mark to geolocate');
    expect([...root.querySelectorAll('.kind .name')].map((n) => n.textContent)).toEqual(['Whole video', 'Passage', 'Instant']);
    expect(kind(root, 'Instant').querySelector('kbd').textContent).toBe('S');
    expect(kind(root, 'Instant').getAttribute('title')).toBe('A scene at the frame on screen (S), and Shift+S ends one there');
    expect(kind(root, 'Whole video').getAttribute('title')).toBe('A scene about the whole video, with no timecode');
  });

  it('does what each press says, in one press', () => {
    const oninstant = vi.fn();
    const onpassage = vi.fn();
    const onwhole = vi.fn();
    const root = render({ oninstant, onpassage, onwhole });
    kind(root, 'Whole video').click();
    kind(root, 'Passage').click();
    kind(root, 'Instant').click();
    expect([onwhole, onpassage, oninstant].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('lights Passage while the bar waits for the drag, its hover saying how to stop', () => {
    const root = render({ drawing: true });
    const passage = kind(root, 'Passage');
    expect(passage.classList.contains('on')).toBe(true);
    expect(passage.getAttribute('aria-pressed')).toBe('true');
    expect(passage.getAttribute('title')).toBe('Stop waiting for a drag across the bar (Esc)');
    const idle = render({});
    expect(kind(idle, 'Passage').getAttribute('aria-pressed')).toBe('false');
    expect(kind(idle, 'Passage').getAttribute('title')).toBe('A scene over a passage you drag across the bar');
  });

  it('greys Whole video once a scene to geolocate says so already, the others still pressed', () => {
    const root = render({ wholeOff: 'The whole video is marked already' });
    expect(kind(root, 'Whole video').disabled).toBe(true);
    expect(kind(root, 'Whole video').getAttribute('title')).toBe('The whole video is marked already');
    expect([kind(root, 'Passage').disabled, kind(root, 'Instant').disabled]).toEqual([false, false]);
  });

  it('greys Whole video beside scenes holding passages, and says why on hover', () => {
    const onwhole = vi.fn();
    const root = render({ wholeOff: 'Scenes already hold passages of this video, so the whole of it is not one place', onwhole });
    const whole = kind(root, 'Whole video');
    expect(whole.disabled).toBe(true);
    expect(whole.getAttribute('title')).toBe('Scenes already hold passages of this video, so the whole of it is not one place');
    whole.click();
    expect(onwhole).not.toHaveBeenCalled();
  });
});
