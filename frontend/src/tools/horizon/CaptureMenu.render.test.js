// @vitest-environment happy-dom
/** Capture, in the Horizon header: the whole view, or an area of it, filed in the case. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CaptureMenu from './CaptureMenu.svelte';

let app;
let host;

function show(props = {}) {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(CaptureMenu, { target: host, props });
  flushSync();
}

const opener = () => host.querySelector('button[aria-label="Capture"]');
const row = (text) => [...host.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes(text));

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = null;
});

describe('the capture menu', () => {
  it('captures the whole view or an area of it, and folds away once picked', () => {
    const oncapture = vi.fn();
    show({ oncapture });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    opener().click();
    flushSync();
    expect(host.querySelector('.cm-head').textContent).toBe('Capture into the case');
    row('The whole view').click();
    flushSync();
    expect(oncapture).toHaveBeenLastCalledWith(false);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    opener().click();
    flushSync();
    row('An area of it').click();
    expect(oncapture).toHaveBeenLastCalledWith(true);
  });

  it('folds away on Escape or a press elsewhere, and waits while a capture is filed', () => {
    show({ oncapture: vi.fn() });
    opener().click();
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    opener().click();
    flushSync();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    flushSync();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    unmount(app);
    host.remove();
    show({ busy: true });
    expect(opener().disabled).toBe(true);
    expect(opener().title).toBe('Capturing…');
  });
});
