// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import DifferenceBar from './DifferenceBar.svelte';
import { changeSettings } from '../../lib/map/changeAssist.js';

const ready = { ok: true, label: 'Two dated passes', methods: ['colour', 'brightness'], notes: [],
  family: 'sentinel2', clouds: true };

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(DifferenceBar, {
    target,
    props: { settings: changeSettings(), status: ready, ...props },
  });
  flushSync();
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

  it('says what the reading is doing on Read itself, and lights it only when pressing it does something', () => {
    const result = { share: 0.1, coverage: 1, area: 20, zones: [], zoneCount: 0 };
    const read = (target) => target.querySelector('button.read');
    const seen = Object.fromEntries(['due', 'reading', 'tiles', 'current'].map((reading) => {
      const { target, done } = render({ reading, result });
      const node = read(target);
      const shown = [node.textContent.trim(), node.disabled, node.classList.contains('due'), node.title];
      done();
      return [reading, shown];
    }));
    expect(seen.due).toEqual(['Read', false, true, 'Read the pixels in this view']);
    expect(seen.reading).toEqual(['Reading…', true, false, 'Reading the pixels in this view']);
    expect(seen.tiles).toEqual(['Loading…', true, false, 'Waiting for the map tiles to load']);
    // A press on an up-to-date reading used to do nothing and say nothing.
    expect(seen.current).toEqual(['Up to date', true, false, 'Nothing moved since the last read']);
    // What a press will cost is said before it is spent.
    const bands = render({ reading: 'due', settings: changeSettings({ ignore_clouds: true }) });
    expect(read(bands.target).title).toBe('Read this view, one Sentinel-2 request a side');
    bands.done();
  });

  it('gives Read one width for every label, so the gear beside it never moves', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'DifferenceBar.svelte'), 'utf8');
    expect(source).toMatch(/\.text-btn\.read \{ width: \d+px;/);
    expect(source).not.toMatch(/\.text-btn\.read \{[^}]*min-width/);
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

  it('opens and closes its settings from the gear, and draws none of them itself', () => {
    // The panel is Compare's, docked on the stage, so the strip only says whether it is open.
    const { target, done } = render();
    const gear = target.querySelector('button[aria-label="Difference settings"]');
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    gear.click();
    flushSync();
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('aside')).toBeNull();
    gear.click();
    flushSync();
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    done();
  });
});
