// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AnalysisPeriodBar from './AnalysisPeriodBar.svelte';

let live = null;

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(AnalysisPeriodBar, {
    target,
    props: {
      period: { from: '2026-08-23T20:49:00Z', to: '2026-10-01T10:12:00Z' },
      ...props,
    },
  });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('AnalysisPeriodBar', () => {
  it('states the fact-time window being applied', () => {
    const root = open();

    expect(root.querySelector('[aria-label="Fact-time range"]').textContent).toContain(
      'Fact time · 23 Aug – 1 Oct 2026'
    );
  });

  it('hands off to Timeline and Map, or clears the window', () => {
    const ontimeline = vi.fn();
    const onmap = vi.fn();
    const onclear = vi.fn();
    const root = open({ ontimeline, onmap, onclear });
    const buttons = [...root.querySelectorAll('button')];

    buttons.find((button) => button.textContent.trim() === 'Timeline').click();
    buttons.find((button) => button.textContent.trim() === 'Map').click();
    buttons.find((button) => button.textContent.trim() === 'Clear').click();
    flushSync();

    expect(ontimeline).toHaveBeenCalledOnce();
    expect(onmap).toHaveBeenCalledOnce();
    expect(onclear).toHaveBeenCalledOnce();
  });
});
