// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MarkScene from './MarkScene.svelte';

/** Mark to geolocate, above the tabs: the main press, and what its arrow offers. */

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

const item = (name) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.includes(name));
const openMenu = (root) => {
  root.querySelector('[aria-label="More ways to mark"]').click();
  flushSync();
};

describe('Mark to geolocate', () => {
  it('keeps a scene at the frame on screen from its main press, S said on it', () => {
    const onmoment = vi.fn();
    const root = render({ onmoment });
    const press = root.querySelector('.press');
    expect(press.textContent).toContain('Mark to geolocate');
    expect(press.querySelector('kbd').textContent).toBe('S');
    press.click();
    expect(onmoment).toHaveBeenCalledTimes(1);
  });

  it('offers This moment and Whole video from its arrow, and closes on a pick', () => {
    const onmoment = vi.fn();
    const onwhole = vi.fn();
    const root = render({ onmoment, onwhole });
    const arrow = root.querySelector('[aria-label="More ways to mark"]');
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
    openMenu(root);
    expect(arrow.getAttribute('aria-expanded')).toBe('true');
    expect(item('This moment').querySelector('kbd').textContent).toBe('S');
    expect(document.querySelector('.fm-note').textContent).toContain('Shift+S ends a scene at the frame on screen');
    item('Whole video').click();
    flushSync();
    expect(onwhole).toHaveBeenCalledTimes(1);
    expect(item('Whole video')).toBeUndefined();

    openMenu(root);
    item('This moment').click();
    flushSync();
    expect(onmoment).toHaveBeenCalledTimes(1);
  });

  it('greys Whole video once a scene to geolocate says so already', () => {
    const onwhole = vi.fn();
    const root = render({ wholeTaken: true, onwhole });
    openMenu(root);
    expect(item('Whole video').disabled).toBe(true);
    expect(item('Whole video').getAttribute('title')).toBe('The whole video is marked already');
    expect(item('This moment').disabled).toBe(false);
  });
});
