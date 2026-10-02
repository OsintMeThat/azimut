// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import Modal from './Modal.svelte';

let live;
let opener;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const body = createRawSnippet(() => ({ render: () => '<div><input id="first"><button id="last">Go</button></div>' }));

async function openModal() {
  opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(Modal, { target, props: { title: 'Name it', onclose: () => {}, children: body } });
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
}

describe('a modal and the keyboard', () => {
  it('takes the focus in, says it is modal, and gives it back on close', async () => {
    await openModal();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);

    unmount(live);
    live = null;
    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab inside the dialog', async () => {
    await openModal();
    const dialog = document.querySelector('[role="dialog"]');
    const close = dialog.querySelector('button[aria-label="Close"]');
    document.getElementById('last').focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById('last'));
  });
});
