// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DifferenceBar from './DifferenceBar.svelte';
import { changeSettings } from '../../lib/map/changeAssist.js';

const ready = { ok: true, label: 'Two dated passes', methods: ['colour', 'brightness'], notes: [],
  family: 'sentinel2', clouds: true };

function render(props = {}, { open = false } = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(DifferenceBar, {
    target,
    props: { settings: changeSettings(), status: ready, ...props },
  });
  flushSync();
  if (open) {
    target.querySelector('button[aria-label="Difference settings"]').click();
    flushSync();
  }
  return { target, done: () => { unmount(live); target.remove(); } };
}

const button = (target, name) =>
  [...target.querySelectorAll('button')].find((node) =>
    node.getAttribute('aria-label') === name || node.textContent.trim() === name);

const base = (target, label) =>
  [...target.querySelectorAll('[aria-label="Image under the highlights"] button')]
    .find((entry) => entry.textContent.trim() === label);

describe('Difference strip', () => {
  it('lays the highlights over both images by default, and over one on request', () => {
    const { target, done } = render();
    expect(base(target, 'Both').getAttribute('aria-pressed')).toBe('true');
    base(target, 'A').click();
    flushSync();
    expect(base(target, 'A').getAttribute('aria-pressed')).toBe('true');
    expect(base(target, 'Both').getAttribute('aria-pressed')).toBe('false');
    done();
  });

  it('keeps its settings closed until asked, then opens them over the stage', () => {
    const { target, done } = render();
    expect(target.querySelector('.settings')).toBeNull();
    const gear = target.querySelector('button[aria-label="Difference settings"]');
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    gear.click();
    flushSync();
    expect(target.querySelector('aside.settings')).not.toBeNull();
    expect(target.textContent).toContain('Sensitivity');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(target.querySelector('.settings')).toBeNull();
    done();
  });

  it('refuses to read a pair it cannot read, and says why', () => {
    const { target, done } = render({
      status: { ok: false, reason: 'Date both passes first', methods: [] },
    });
    expect(button(target, 'Read').disabled).toBe(true);
    expect(button(target, 'Read').title).toBe('Date both passes first');
    done();
  });

  it('reads only when asked', () => {
    const onrun = vi.fn();
    const { target, done } = render({ onrun });
    const run = button(target, 'Read');
    expect(run.disabled).toBe(false);
    run.click();
    expect(onrun).toHaveBeenCalledTimes(1);
    done();
  });

  it('blinks the highlights on and off, which only touches the overlay', () => {
    const onrun = vi.fn();
    const { target, done } = render({ onrun });
    const blink = () => target.querySelector('button[aria-label$="the highlights"]');
    expect(blink().getAttribute('aria-pressed')).toBe('false');
    blink().click();
    flushSync();
    expect(blink().getAttribute('aria-label')).toBe('Stop blinking the highlights');
    expect(onrun).not.toHaveBeenCalled();
    done();
  });

  it('says so in the panel when the highlights are from an earlier read', () => {
    const result = { share: 0.1, coverage: 1, area: 20, zones: [], zoneCount: 0 };
    const { target, done } = render({ stale: true, result }, { open: true });
    expect(target.querySelector('.readout').textContent).toContain('From an earlier read');
    done();
  });

  it('keeps the strip the same through a read, so the panel hanging from it stays put', () => {
    // The strip once grew a status label on every read and error, which moved
    // the open panel under the pointer.
    const shape = (target) => [...target.querySelector('.difference-bar').children]
      .filter((node) => !node.matches('aside')).map((node) => node.tagName);
    const idle = render({}, { open: true });
    const before = shape(idle.target);
    idle.done();
    const reading = render({ busy: true, error: 'Could not compare these pixels', stale: true }, { open: true });
    expect(shape(reading.target)).toEqual(before);
    expect(reading.target.querySelector('.readout [role="alert"]').textContent).toBe('Could not compare these pixels');
    reading.done();
  });

  it('closes the panel on a press off the strip, but not on one inside it or on the gear', () => {
    const { target, done } = render({}, { open: true });
    const press = (node) => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    press(target.querySelector('aside.settings select'));
    flushSync();
    expect(target.querySelector('aside.settings')).not.toBeNull();
    // Reading with the settings open is tuning them, not leaving them.
    press(button(target, 'Read'));
    flushSync();
    expect(target.querySelector('aside.settings')).not.toBeNull();
    // The gear's own press must not close it, or its click would reopen it.
    const gear = target.querySelector('button[aria-label="Difference settings"]');
    press(gear);
    gear.click();
    flushSync();
    expect(target.querySelector('aside.settings')).toBeNull();
    gear.click();
    flushSync();
    expect(target.querySelector('aside.settings')).not.toBeNull();
    press(document.body);
    flushSync();
    expect(target.querySelector('aside.settings')).toBeNull();
    done();
  });

  it('offers the cloud filter only where a scene classification exists', () => {
    const { target, done } = render({}, { open: true });
    expect(target.textContent).toContain('Clouds & shadows');
    done();
    const esri = render({ status: { ...ready, family: 'esri', clouds: false } }, { open: true });
    expect(esri.target.textContent).not.toContain('Clouds & shadows');
    esri.done();
  });

  it('says when a reading reads bands, and never asks to be turned on', () => {
    // The reading always follows the camera. Reading bands is a different
    // question: it is what costs a request, and only off the held ground.
    const { target, done } = render({ settings: changeSettings({ ignore_clouds: true }) }, { open: true });
    expect(target.textContent).toContain('one request a side');
    done();
    const free = render({}, { open: true });
    expect(free.target.textContent).not.toContain('one request a side');
    expect(free.target.textContent).not.toContain('Follow the map');
    free.done();
  });

  it('reads the view as soon as the cloud filter is switched on', async () => {
    // The switch says the sky is being read, so it cannot leave an unfiltered
    // reading up behind it.
    const onrun = vi.fn();
    const { target, done } = render({ onrun }, { open: true });
    target.querySelector('.cloud-filter button').click();
    flushSync();
    await Promise.resolve();
    expect(onrun).toHaveBeenCalledTimes(1);
    done();
  });

  it('states the index change it draws the line at', () => {
    const { target, done } = render({ settings: changeSettings({ method: 'index', index: 'nbr' }) }, { open: true });
    expect(target.textContent).toContain('NBR moved by 0.25');
    done();
  });
});
