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

it('keeps no other 3D view: the globe is the only one', () => {
  show({ on: true, pitch: 20 });
  expect(document.querySelector('.classic')).toBeNull();
  expect([...document.querySelectorAll('button')].map((b) => b.textContent.trim())).not.toContain('Classic');
});

it('greys the switch and says why in a browser that cannot draw the 3D view', () => {
  const ontilt = vi.fn();
  show({ refused: true, ontilt });
  const toggle = document.querySelector('.toggle');
  expect(toggle.disabled).toBe(true);
  expect(toggle.title).toBe('This browser cannot draw the 3D view: it needs WebGL2');
  toggle.click();
  flushSync();
  expect(ontilt).not.toHaveBeenCalled();
});
