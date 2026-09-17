// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CloudFilter from './CloudFilter.svelte';

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(CloudFilter, { target, props: { ontoggle: () => {}, ...props } });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

const chip = (target) => target.querySelector('button');

describe('the cloud and shadow filter', () => {
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

  it('says what it reads, which is the sensor and the sun rather than a guess', () => {
    const { target, done } = render({ clouds: true });
    expect(target.textContent).toContain('scene classification');
    expect(target.textContent).toContain('traced from the sun');
    done();
  });
});
