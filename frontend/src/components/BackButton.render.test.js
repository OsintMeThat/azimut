// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import BackButton from './BackButton.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

describe('the way back from an open document', () => {
  it('names the place it goes back to, in words, and goes there', () => {
    const onclick = vi.fn();
    held = mount(BackButton, { target: document.body, props: { label: 'Plates', title: 'Back to the plates', onclick } });
    flushSync();
    const button = document.body.querySelector('button');
    expect(button.textContent.trim()).toBe('Plates');
    expect(button.getAttribute('title')).toBe('Back to the plates');
    expect(button.hasAttribute('aria-label')).toBe(false);
    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('says Close under a cross for a view that closes onto the same screen', () => {
    held = mount(BackButton, { target: document.body, props: { label: 'Close', icon: 'x', onclick: () => {} } });
    flushSync();
    expect(document.body.querySelector('button').classList.contains('closes')).toBe(true);
  });
});
