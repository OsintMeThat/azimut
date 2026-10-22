// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ReliefControl from './ReliefControl.svelte';
import { READING_TILT } from '../../lib/map/relief.js';

let held;
beforeEach(() => localStorage.clear());
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const show = (props) => { held = mount(ReliefControl, { target: document.body, props }); flushSync(); };
const press = (label) => { document.querySelector(`[aria-label="${label}"], [title="${label}"]`).click(); flushSync(); };

it('leans the view as the 3D switch comes on, since relief seen straight down looks flat', () => {
  const ontilt = vi.fn();
  const onhint = vi.fn();
  show({ ontilt, onhint });
  press('Show the relief in 3D');
  expect(ontilt).toHaveBeenCalledWith(READING_TILT);
  // the word on tilting by hand is said once, ever
  expect(onhint).toHaveBeenCalledTimes(1);
});

it('says nothing again and leans nothing when the switch goes off', () => {
  const ontilt = vi.fn();
  const onhint = vi.fn();
  show({ on: true, pitch: 60, ontilt, onhint });
  press('Back to the flat map');
  expect(ontilt).not.toHaveBeenCalled();
  expect(onhint).not.toHaveBeenCalled();
  expect(document.querySelector('.tilt')).toBeNull();
});

it('levels a tilted view and leans a flat one from the Tilt button', () => {
  const ontilt = vi.fn();
  show({ on: true, pitch: 45, ontilt });
  press('Look straight down');
  expect(ontilt).toHaveBeenLastCalledWith(0);
});

it('offers the previous 3D view one press away while 3D is on, to compare it with the globe', () => {
  show({ on: true, pitch: 20 });
  const classic = () => document.querySelector('.classic');
  expect(classic().getAttribute('aria-pressed')).toBe('false');
  press('Use the previous 3D view, to compare');
  expect(classic().getAttribute('aria-pressed')).toBe('true');
  press('Back to the new 3D view');
  expect(classic().getAttribute('aria-pressed')).toBe('false');
});

it('offers no previous view on a flat map, nor where the globe cannot run at all', () => {
  show({ on: false });
  expect(document.querySelector('.classic')).toBeNull();
  unmount(held);
  show({ on: true, classicOffered: false });
  expect(document.querySelector('.classic')).toBeNull();
});
