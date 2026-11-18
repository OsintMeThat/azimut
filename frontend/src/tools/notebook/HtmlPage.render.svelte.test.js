// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import HtmlPage, { pressFrame } from './HtmlPage.svelte';

let app;
let target;
const heard = [];
const listen = (event) => heard.push(event.type);

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target?.remove();
  for (const type of ['pointerdown', 'mousedown']) window.removeEventListener(type, listen, true);
  heard.length = 0;
  vi.useRealTimers();
});

describe('a press inside the HTML page', () => {
  it('is said on the frame, where the press-outside rules of menus hear it', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    for (const type of ['pointerdown', 'mousedown']) window.addEventListener(type, listen, true);
    pressFrame(frame);
    expect(heard).toEqual(['pointerdown', 'mousedown']);
    frame.remove();
  });

  it('is told once the focus has moved into one of its frames, and never for another one', () => {
    vi.useFakeTimers();
    target = document.createElement('div');
    document.body.append(target);
    app = mount(HtmlPage, { target, props: { html: '<!doctype html><html><body><p>Hi</p></body></html>' } });
    flushSync();
    for (const type of ['pointerdown', 'mousedown']) window.addEventListener(type, listen, true);
    const frames = [...target.querySelectorAll('iframe')];
    expect(frames).toHaveLength(2);

    // the app keeps the focus (another window took it): nothing is pressed
    window.dispatchEvent(new Event('blur'));
    vi.runAllTimers();
    expect(heard).toEqual([]);

    // a frame elsewhere in the app is not this page's
    const other = document.createElement('iframe');
    document.body.append(other);
    other.focus();
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(other);
    window.dispatchEvent(new Event('blur'));
    vi.runAllTimers();
    expect(heard).toEqual([]);

    // the page's frame took the focus: the press is said on it
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frames[0]);
    window.dispatchEvent(new Event('blur'));
    vi.runAllTimers();
    expect(heard).toEqual(['pointerdown', 'mousedown']);
    other.remove();
  });
});
