// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CloudFilter from './CloudFilter.svelte';

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CloudFilter, { target, props: { kind: 'classes', ontoggle: () => {}, ...props } });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

const chip = (target) => target.querySelector('button');

describe('the cloud and shadow filter', () => {
  it('offers nothing for a method that cannot separate cloud from its subject', () => {
    // smoke, bright shapes on water and a hotspot: masking cloud would mask
    // the very thing they look for, so there is no switch to mislead with
    const { target, done } = render({ kind: '' });
    expect(chip(target)).toBe(null);
    done();
  });

  it('turns both cloud and shadow on with one click', () => {
    const ontoggle = vi.fn();
    const { target, done } = render({ clouds: false, shadows: false, ontoggle });
    expect(chip(target).getAttribute('aria-pressed')).toBe('false');
    chip(target).click();
    expect(ontoggle).toHaveBeenCalledWith(true);
    done();
  });

  it('turns a filter that is on back off', () => {
    const ontoggle = vi.fn();
    const { target, done } = render({ clouds: true, shadows: true, ontoggle });
    expect(chip(target).getAttribute('aria-pressed')).toBe('true');
    chip(target).click();
    expect(ontoggle).toHaveBeenCalledWith(false);
    done();
  });

  it('names a half-set filter rather than reading as both', () => {
    const { target, done } = render({ clouds: true, shadows: false });
    expect(chip(target).textContent).toContain('Clouds only');
    done();
    const shadow = render({ clouds: false, shadows: true });
    expect(chip(shadow.target).textContent).toContain('Shadows only');
    shadow.done();
  });

  it('says a guess is a guess, and a classification a classification', () => {
    // the panel must never let a brightness test pass for a measurement
    const { target, done } = render({ kind: 'classes', clouds: true });
    expect(target.textContent).toContain('scene classification');
    expect(target.textContent).not.toContain('guess');
    done();

    const guess = render({ kind: 'picture', clouds: true });
    expect(guess.target.textContent).toContain('A guess from the picture');
    guess.done();
  });

  it('follows one switch when cloud and shadow cannot be split', () => {
    const ontoggle = vi.fn();
    const { target, done } = render({ kind: 'picture', split: false, clouds: true, ontoggle });
    expect(chip(target).getAttribute('aria-pressed')).toBe('true');
    expect(chip(target).textContent).toContain('Clouds & shadows');
    chip(target).click();
    expect(ontoggle).toHaveBeenCalledWith(false);
    done();
  });
});
