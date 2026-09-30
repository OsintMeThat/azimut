// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import DifferencePanel from './DifferencePanel.svelte';
import { changeSettings } from '../../lib/map/changeAssist.js';

const ready = { ok: true, label: 'Two dated passes', methods: ['colour', 'brightness'], notes: [],
  family: 'sentinel2', clouds: true };

const here = dirname(fileURLToPath(import.meta.url));

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(DifferencePanel, {
    target,
    props: { settings: changeSettings(), status: ready, ...props },
  });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

const button = (target, name) =>
  [...target.querySelectorAll('button')].find((node) =>
    node.getAttribute('aria-label') === name || node.textContent.trim() === name);

describe('Difference settings panel', () => {
  it('keeps every tooltip to one short clause', () => {
    // The settings sit on three tabs, so the written titles are read off the
    // components rather than opened one tab at a time.
    const tips = ['DifferencePanel.svelte', 'DifferenceBar.svelte'].flatMap((file) => {
      const source = readFileSync(join(here, file), 'utf8');
      return [...source.matchAll(/title=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap(([, text, code]) =>
        text !== undefined ? [text] : [...code.matchAll(/'([^']+)'|`([^`]+)`/g)].map((m) => m[1] ?? m[2]));
    });

    expect(tips.length).toBeGreaterThan(15);
    for (const tip of tips) {
      expect(tip.length, tip).toBeLessThanOrEqual(60);
      expect(tip, tip).not.toContain(';');
    }
  });

  it('lies over the maps in the glass their floating panels share, rather than narrowing them', () => {
    // A narrower map is a new view, and a band reading would fetch again for a panel opening.
    const source = readFileSync(join(here, 'DifferencePanel.svelte'), 'utf8');
    const rule = source.match(/\.settings\.cmp-dock \{([^}]*)\}/)[1];
    expect(rule).toMatch(/position: absolute;/);
    expect(rule).toMatch(/right: 8px;/);
    expect(rule).toMatch(/top: 54px;/);
    expect(rule).toMatch(/bottom: 8px;/);
    expect(rule).toMatch(/color-mix\(in srgb, var\(--bg-1\) 88%, transparent\)/);
    expect(rule).toMatch(/backdrop-filter: blur\(6px\);/);
  });

  it('closes on its button and on Escape, and stays open through presses anywhere else', () => {
    const onclose = vi.fn();
    const { target, done } = render({ onclose });
    // Tuning is watching the map answer, so a press on the map leaves it up.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    target.querySelector('select').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(onclose).not.toHaveBeenCalled();
    button(target, 'Close the settings').click();
    expect(onclose).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onclose).toHaveBeenCalledTimes(2);
    done();
  });

  it('stops listening for Escape once closed', () => {
    const onclose = vi.fn();
    const { done } = render({ onclose });
    done();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onclose).not.toHaveBeenCalled();
  });

  it('keeps an index reading as a Detect analyzer, and offers nothing for the picture methods', () => {
    const onanalyzer = vi.fn();
    const index = render({ settings: changeSettings({ method: 'index', index: 'nbr' }),
      status: { ...ready, methods: ['colour', 'index'] }, onanalyzer });
    button(index.target, 'Save as a Detect analyzer').click();
    expect(onanalyzer).toHaveBeenCalledOnce();
    index.done();
    const colour = render();
    expect(button(colour.target, 'Save as a Detect analyzer')).toBeUndefined();
    colour.done();
  });

  it('says so when the highlights are from an earlier read', () => {
    const result = { share: 0.1, coverage: 1, area: 20, zones: [], zoneCount: 0 };
    const { target, done } = render({ reading: 'due', result });
    expect(target.querySelector('.readout').textContent).toContain('From an earlier read');
    done();
  });

  it('says a failed reading in its readout', () => {
    const { target, done } = render({ reading: 'reading', error: 'Could not compare these pixels' });
    expect(target.querySelector('.readout [role="alert"]').textContent).toBe('Could not compare these pixels');
    done();
  });

  it('offers the cloud filter only where a scene classification exists', () => {
    const { target, done } = render();
    expect(target.textContent).toContain('Clouds & shadows');
    done();
    const esri = render({ status: { ...ready, family: 'esri', clouds: false } });
    expect(esri.target.textContent).not.toContain('Clouds & shadows');
    esri.done();
  });

  it('says when a reading reads bands, and never asks to be turned on', () => {
    // The reading always follows the camera. Reading bands is a different
    // question: it is what costs a request, and only off the held ground.
    const { target, done } = render({ settings: changeSettings({ ignore_clouds: true }) });
    expect(target.textContent).toContain('one request a side');
    done();
    const free = render();
    expect(free.target.textContent).not.toContain('one request a side');
    expect(free.target.textContent).not.toContain('Follow the map');
    free.done();
  });

  it('reads the view as soon as a method or an index is chosen', async () => {
    const onrun = vi.fn();
    const { target, done } = render({ settings: changeSettings({ method: 'index', index: 'nbr' }),
      status: { ...ready, methods: ['colour', 'index'] }, onrun });
    const [method, index] = target.querySelectorAll('aside.settings select');
    index.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(onrun).toHaveBeenCalledTimes(1);
    method.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(onrun).toHaveBeenCalledTimes(2);
    done();
  });

  it('reads the view as soon as the cloud filter is switched on', async () => {
    // The switch says the sky is being read, so it cannot leave an unfiltered
    // reading up behind it.
    const onrun = vi.fn();
    const { target, done } = render({ onrun });
    target.querySelector('.cloud-filter button').click();
    flushSync();
    await Promise.resolve();
    expect(onrun).toHaveBeenCalledTimes(1);
    done();
  });

  it('states the index change it draws the line at', () => {
    const { target, done } = render({ settings: changeSettings({ method: 'index', index: 'nbr' }) });
    expect(target.textContent).toContain('NBR moved by 0.19');
    done();
  });
});
