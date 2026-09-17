// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ChangePanel from './ChangePanel.svelte';
import { changeSettings } from '../../lib/map/changeAssist.js';

const ready = { ok: true, label: 'Two dated passes', methods: ['colour', 'brightness'], notes: [],
  family: 'sentinel2', clouds: true };

function render(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(ChangePanel, {
    target,
    props: { settings: changeSettings(), status: ready, ...props },
  });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

const button = (target, name) =>
  [...target.querySelectorAll('button')].find((node) =>
    node.getAttribute('aria-label') === name || node.textContent.trim() === name);

describe('Difference panel', () => {
  it('hides and restores the overlay from the eye, without recomputing', () => {
    const onrun = vi.fn();
    const { target, done } = render({ onrun });
    const eye = () => target.querySelector('button[aria-label*="difference overlay"]');
    expect(eye().getAttribute('aria-label')).toBe('Hide the difference overlay');
    eye().click();
    flushSync();
    expect(eye().getAttribute('aria-label')).toBe('Show the difference overlay');
    expect(eye().getAttribute('aria-pressed')).toBe('false');
    eye().click();
    flushSync();
    expect(eye().getAttribute('aria-pressed')).toBe('true');
    expect(onrun).not.toHaveBeenCalled();
    done();
  });

  it('refuses to run a pair it cannot read, and says why', () => {
    const { target, done } = render({
      status: { ok: false, reason: 'Date both passes first', methods: [] },
    });
    expect(button(target, 'Read this view').disabled).toBe(true);
    expect(target.textContent).toContain('Date both passes first');
    done();
  });

  it('runs only when asked', () => {
    const onrun = vi.fn();
    const { target, done } = render({ onrun });
    const run = button(target, 'Read this view');
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
    // nothing to blink once the overlay is hidden
    target.querySelector('button[aria-label*="difference overlay"]').click();
    flushSync();
    expect(blink().disabled).toBe(true);
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

  it('says so in the footer when the highlights are from an earlier read', () => {
    const { target, done } = render({ stale: true, result: { share: 0.1, coverage: 1, area: 20, zones: [], zoneCount: 0 } });
    expect(target.querySelector('.cmp-dock-foot').textContent).toContain('from an earlier read');
    done();
  });

  it('states the index change it draws the line at', () => {
    const { target, done } = render({ settings: changeSettings({ method: 'index', index: 'nbr' }) });
    expect(target.textContent).toContain('NBR moved by 0.25');
    done();
  });
});
