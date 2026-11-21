// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SupportDialog from './SupportDialog.svelte';
import { uiState } from '../lib/state.svelte.js';
import { TIP_LINES, TIP_LINE_SECONDS } from '../lib/support.js';

let live = null;

function show(props = {}) {
  const onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SupportDialog, { target, props: { kofi: 'https://ko-fi.invalid/test', form: 'https://forms.invalid/test', discord: 'https://discord.invalid/test', site: '', onclose, ...props } });
  flushSync();
  return { onclose };
}

const links = () => [...document.querySelectorAll('.modal a')];
// a choice's name, without the line under it that says what it is for
const text = (node) => (node.querySelector('.what') ?? node).textContent.trim();
const said = () => text(document.querySelector('.modal .words'));

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Support & feedback', () => {
  it('opens every link in its own tab, telling it nothing of the app', () => {
    show();
    expect(links().map(text)).toEqual(['Tip on Ko-fi', 'Vote on what comes next', 'Suggest an idea', 'Join the Discord']);
    for (const link of links()) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('hides a block until its link exists, and still takes a problem', () => {
    show({ kofi: '', form: '', discord: '' });
    expect(links()).toEqual([]);
    expect(document.querySelector('.modal').textContent).not.toContain('tip');
    expect(document.querySelector('.modal button.choice').textContent).toContain('Report a problem');
  });

  it('shows the tip alone while no form or Discord is set', () => {
    show({ form: '', discord: '' });
    expect(links().map(text)).toEqual(['Tip on Ko-fi']);
  });

  it('offers the Discord without a form, above the problem report', () => {
    show({ form: '' });
    expect(links().map(text)).toEqual(['Tip on Ko-fi', 'Join the Discord']);
    const discord = links()[1];
    expect(discord.getAttribute('href')).toBe('https://discord.invalid/test');
    const choices = [...document.querySelectorAll('.modal .choices .choice')].map(text);
    expect(choices).toEqual(['Join the Discord', 'Report a problem']);
  });

  it('says under each choice what it is for, in one short line', () => {
    show();
    const choices = [...document.querySelectorAll('.modal .choices .choice')];
    expect(choices.map(text)).toEqual(['Vote on what comes next', 'Suggest an idea', 'Join the Discord', 'Report a problem']);
    for (const choice of choices) {
      const why = choice.querySelector('.why')?.textContent.trim() ?? '';
      expect(why.length).toBeGreaterThan(0);
      expect(why.length).toBeLessThanOrEqual(40);
    }
  });

  it('names who makes Azimut at its foot, opening the site only on a press', () => {
    show({ site: 'https://site.invalid' });
    const made = document.querySelector('.modal .made');
    expect(made.textContent).toContain('Made by one analyst');
    const link = made.querySelector('a');
    expect(text(link)).toBe('site.invalid');
    expect(link.getAttribute('href')).toBe('https://site.invalid');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    unmount(live);
    document.body.innerHTML = '';
    show();
    expect(document.querySelector('.modal .made')).toBeNull();
  });

  it('says one of its lines above the tip, and none without a tip', () => {
    show();
    expect(TIP_LINES).toContain(said());
    unmount(live);
    document.body.innerHTML = '';
    show({ kofi: '' });
    expect(document.querySelector('.modal .words')).toBeNull();
  });

  it('draws another line on a press', () => {
    show();
    const before = said();
    document.querySelector('.modal .words').click();
    flushSync();
    expect(TIP_LINES).toContain(said());
    expect(said()).not.toBe(before);
  });

  it('turns the line on its own, and holds it while a pointer rests on it', () => {
    vi.useFakeTimers();
    show();
    const first = said();
    vi.advanceTimersByTime(TIP_LINE_SECONDS * 1000 - 1);
    flushSync();
    expect(said()).toBe(first);
    vi.advanceTimersByTime(1);
    flushSync();
    const second = said();
    expect(second).not.toBe(first);

    const words = document.querySelector('.modal .words');
    words.dispatchEvent(new Event('pointerenter'));
    flushSync();
    vi.advanceTimersByTime(TIP_LINE_SECONDS * 3000);
    flushSync();
    expect(said()).toBe(second);

    words.dispatchEvent(new Event('pointerleave'));
    flushSync();
    vi.advanceTimersByTime(TIP_LINE_SECONDS * 1000);
    flushSync();
    expect(said()).not.toBe(second);
  });

  it('keeps one line still when the system asks for less motion', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce'), media: query }));
    show();
    const first = said();
    vi.advanceTimersByTime(TIP_LINE_SECONDS * 5000);
    flushSync();
    expect(said()).toBe(first);
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
