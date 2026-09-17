// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Compass from './Compass.svelte';

function render(props) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(Compass, { target, props });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

describe('Compass', () => {
  it('turns the needle by the bearing and rounds what it prints', () => {
    const { target, done } = render({ bearing: 32.4 });
    expect(target.querySelector('svg').getAttribute('style')).toContain('rotate(32deg)');
    expect(target.querySelector('.deg').textContent.trim()).toBe('32°');
    expect(target.querySelector('.rotate-ctl').classList.contains('turned')).toBe(true);
    done();
  });

  it('says nothing special when the map is north up', () => {
    const { target, done } = render({ bearing: 0 });
    expect(target.querySelector('.rotate-ctl').classList.contains('turned')).toBe(false);
    expect(target.querySelector('button[aria-label="Reset to north"]').title)
      .toBe('North up · middle-drag the map to rotate');
    done();
  });

  it('resets north from the needle and takes an exact angle from the number', () => {
    const onbearing = vi.fn();
    const { target, done } = render({ bearing: 40, onbearing });
    target.querySelector('button[aria-label="Reset to north"]').click();
    expect(onbearing).toHaveBeenCalledWith(0);

    target.querySelector('.deg').click();
    flushSync();
    const input = target.querySelector('[aria-label="Set bearing in degrees"]');
    input.value = '125';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(onbearing).toHaveBeenLastCalledWith(125);
    expect(target.querySelector('[aria-label="Set bearing in degrees"]')).toBeNull();
    done();
  });

  it('leaves the bearing alone when the typed angle is not a number', () => {
    const onbearing = vi.fn();
    const { target, done } = render({ bearing: 40, onbearing });
    target.querySelector('.deg').click();
    flushSync();
    const input = target.querySelector('[aria-label="Set bearing in degrees"]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    expect(onbearing).not.toHaveBeenCalled();
    done();
  });
});
