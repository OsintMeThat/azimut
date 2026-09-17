// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ModeControl from './ModeControl.svelte';

function render(props) {
  const target = document.createElement('div');
  document.body.append(target);
  const live = mount(ModeControl, { target, props });
  flushSync();
  return { target, done: () => { unmount(live); target.remove(); } };
}

describe('Compare mode footer', () => {
  it('carries the one control each reading mode needs', () => {
    for (const [mode, label] of [['swipe', 'Swipe position'], ['opacity', 'B opacity']]) {
      const { target, done } = render({ mode });
      expect(target.querySelector(`[aria-label="${label}"]`)).not.toBe(null);
      done();
    }
    const { target, done } = render({ mode: 'blink' });
    expect(target.querySelector('[aria-label="Blink speed"]')).not.toBe(null);
    done();
  });

  it('stays out of the computing modes, which own a panel instead', () => {
    for (const mode of ['side', 'change', 'analysis']) {
      const { target, done } = render({ mode });
      expect(target.textContent.trim()).toBe('');
      done();
    }
  });
});
