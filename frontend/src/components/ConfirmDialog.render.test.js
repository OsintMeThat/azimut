// @vitest-environment happy-dom
/**
 * The confirmation dialog, actually mounted.
 *
 * This dialog is a guard rail, and the two ways a guard rail fails are invisible in the
 * source: the key that dismisses it also dismissing the window behind it, and the key that
 * raised it answering it. Both need a real DOM and real key events.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: ConfirmDialog } = await import('./ConfirmDialog.svelte');
const { default: Modal } = await import('./Modal.svelte');

const live = [];

function open(Component, props) {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Component, { target, props });
  live.push(app);
  flushSync();
  return app;
}

const press = (key, init = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

const cancelButton = () =>
  [...document.querySelectorAll('[role="alertdialog"] button')].find(
    (b) => b.textContent.trim() === 'Cancel'
  );

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

describe('escape', () => {
  it('steps back one overlay, leaving the window that raised the dialog open', () => {
    const onclose = vi.fn();
    const oncancel = vi.fn();
    open(Modal, { title: 'Details', onclose });
    open(ConfirmDialog, { title: 'Remove relation', message: 'It comes back.', oncancel });

    press('Escape');

    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('reaches the window again once the dialog is gone', () => {
    const onclose = vi.fn();
    open(Modal, { title: 'Details', onclose });
    const dialog = open(ConfirmDialog, { title: 'Remove', message: 'x', oncancel: () => {} });

    unmount(live.pop() === dialog ? dialog : dialog);
    flushSync();
    press('Escape');

    expect(onclose).toHaveBeenCalledTimes(1);
  });
});

describe('focus', () => {
  it('moves into the dialog, onto the half that takes nothing away', () => {
    open(ConfirmDialog, { title: 'Delete', message: 'x', tone: 'danger', oncancel: () => {} });
    expect(document.activeElement).toBe(cancelButton());
  });

  it('goes back to the button that raised the dialog when it closes', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const dialog = open(ConfirmDialog, { title: 'Delete', message: 'x', oncancel: () => {} });
    expect(document.activeElement).not.toBe(trigger);

    live.splice(live.indexOf(dialog), 1);
    unmount(dialog);
    flushSync();

    expect(document.activeElement).toBe(trigger);
  });
});

describe('enter', () => {
  it('is not answered by the window, so a stray press cannot confirm', () => {
    const onconfirm = vi.fn();
    open(ConfirmDialog, { title: 'Delete', message: 'x', onconfirm, oncancel: () => {} });

    press('Enter');

    expect(onconfirm).not.toHaveBeenCalled();
  });

  it('ignores the repeats of a key still held down from the click that opened it', () => {
    open(ConfirmDialog, { title: 'Delete', message: 'x', oncancel: () => {} });

    const held = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    cancelButton().dispatchEvent(held);

    expect(held.defaultPrevented).toBe(true);
  });

  it('still lets a fresh press through to the focused button', () => {
    open(ConfirmDialog, { title: 'Delete', message: 'x', oncancel: () => {} });

    const fresh = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: false,
      bubbles: true,
      cancelable: true,
    });
    cancelButton().dispatchEvent(fresh);

    expect(fresh.defaultPrevented).toBe(false);
  });
});
