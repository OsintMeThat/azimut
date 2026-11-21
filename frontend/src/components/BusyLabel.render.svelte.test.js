// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import BusyLabel from './BusyLabel.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

const own = createRawSnippet(() => ({ render: () => '<span>Publish to GitHub Pages</span>' }));

function show(props) {
  const state = $state({ busy: false, text: 'Publishing…', ...props });
  const button = document.createElement('button');
  document.body.append(button);
  held = mount(BusyLabel, { target: button, props: { get busy() { return state.busy; }, get text() { return state.text; }, children: own } });
  flushSync();
  return { state, button };
}

describe('what a press says while it waits', () => {
  it('says its own words until it waits, then a spinner and its busy words, then its own again', () => {
    const { state, button } = show();
    expect(button.textContent).toBe('Publish to GitHub Pages');
    expect(button.querySelector('.busy-spin')).toBeNull();
    state.busy = true;
    flushSync();
    expect(button.textContent).toBe('Publishing…');
    // the spinner is drawn, never read out
    expect(button.querySelector('.busy-spin').getAttribute('aria-hidden')).toBe('true');
    state.busy = false;
    flushSync();
    expect(button.textContent).toBe('Publish to GitHub Pages');
    expect(button.querySelector('.busy-spin')).toBeNull();
  });

  it('stands alone as a line saying what is under way', () => {
    const line = document.createElement('p');
    document.body.append(line);
    held = mount(BusyLabel, { target: line, props: { busy: true, text: 'GitHub is building the page…' } });
    flushSync();
    expect(line.textContent).toBe('GitHub is building the page…');
    expect(line.querySelector('.busy-spin')).not.toBeNull();
  });
});
