// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SupportDialog from './SupportDialog.svelte';
import { uiState } from '../lib/state.svelte.js';

let live = null;

function show(props = {}) {
  const onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SupportDialog, { target, props: { kofi: 'https://ko-fi.invalid/test', form: 'https://forms.invalid/test', onclose, ...props } });
  flushSync();
  return { onclose };
}

const links = () => [...document.querySelectorAll('.modal a')];
const text = (node) => node.textContent.trim();

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('Support & feedback', () => {
  it('opens every link in its own tab, telling it nothing of the app', () => {
    show();
    expect(links().map(text)).toEqual(['Tip on Ko-fi', 'Vote on what comes next', 'Suggest an idea']);
    for (const link of links()) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('hides a block until its link exists, and still takes a problem', () => {
    show({ kofi: '', form: '' });
    expect(links()).toEqual([]);
    expect(document.querySelector('.modal').textContent).not.toContain('tip');
    expect(document.querySelector('.modal button.choice').textContent).toContain('Report a problem');
  });

  it('shows the tip alone while no form is set', () => {
    show({ form: '' });
    expect(links().map(text)).toEqual(['Tip on Ko-fi']);
  });

  it('takes a problem to the report Settings writes, and closes', () => {
    const { onclose } = show();
    document.querySelector('.modal button.choice').click();
    flushSync();
    expect(uiState.tool).toBe('settings');
    expect(uiState.settingsTab).toBe('system');
    expect(onclose).toHaveBeenCalledOnce();
  });
});
