// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ChangePanel from './ChangePanel.svelte';
import { changeSettings } from '../../lib/map/changeAssist.js';

const ready = { ok: true, label: 'Two dated passes', methods: ['colour', 'brightness'], notes: [] };

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
});
