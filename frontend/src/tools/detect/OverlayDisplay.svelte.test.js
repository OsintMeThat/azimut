// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import OverlayDisplay from './OverlayDisplay.svelte';

let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); });
const settle = async () => { await Promise.resolve(); flushSync(); await Promise.resolve(); };
async function open(props = {}) {
  target = document.createElement('div'); document.body.append(target);
  live = mount(OverlayDisplay, { target, props }); flushSync();
  // The first button is the eye now; the chevron beside it is what opens the menu.
  chevron().click(); await settle();
}
const chevron = () => target.querySelector('[aria-haspopup="menu"]');
const eye = () => target.querySelector('[aria-pressed]');
const key = (name) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

it('offers independent marker and outline choices, with check pins only in the maker', async () => {
  await open();
  const rows = [...target.querySelectorAll('[role="menuitemcheckbox"]')];
  expect(rows.map((row) => row.textContent.trim())).toEqual(['Markers', 'Outlines']);
  rows[0].click(); flushSync();
  expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  expect(target.querySelector('[role="menu"]')).not.toBeNull();
  rows[1].click(); flushSync();
  expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'false']);
});

it('focuses and walks the menu, closes on Escape or outside, and retains the display choices', async () => {
  await open({ checkPins: true, upward: true });
  const trigger = chevron();
  const rows = [...target.querySelectorAll('[role="menuitemcheckbox"]')];
  expect(document.activeElement).toBe(rows[0]);
  key('ArrowDown'); expect(document.activeElement).toBe(rows[1]);
  key('End'); expect(document.activeElement).toBe(rows[2]);
  rows[2].click(); flushSync();
  expect(rows[2].getAttribute('aria-checked')).toBe('false');
  key('ArrowDown'); expect(document.activeElement).toBe(rows[0]);
  key('Escape'); flushSync();
  expect(target.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click(); await settle();
  expect(target.querySelectorAll('[role="menuitemcheckbox"]')[2].getAttribute('aria-checked')).toBe('false');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); flushSync();
  expect(target.querySelector('[role="menu"]')).toBeNull();
});

it('is one control: the eye switches off what the menu lists', async () => {
  // apart, nothing says the eye is the master of the list
  await open({ checkPins: true });
  expect(eye().getAttribute('aria-pressed')).toBe('false');
  const rows = () => [...target.querySelectorAll('[role="menuitemcheckbox"]')];
  expect(rows().every((row) => !row.disabled)).toBe(true);

  eye().click(); flushSync();
  expect(eye().getAttribute('aria-pressed')).toBe('true');
  expect(eye().title).toBe('Show the overlays');
  // with everything off, picking which is off is moot, and the menu says why
  expect(rows().every((row) => row.disabled)).toBe(true);
  expect(target.querySelector('.all-off').textContent).toBe('The eye has them all off');

  eye().click(); flushSync();
  expect(rows().every((row) => !row.disabled)).toBe(true);
});

it('names what it hides, and the key that does the same', async () => {
  await open({ what: 'the candidates and areas', shortcut: 'H' });
  expect(eye().title).toBe('Hide the candidates and areas (H)');
  expect(eye().getAttribute('aria-label')).toBe('Hide the candidates and areas');
});
