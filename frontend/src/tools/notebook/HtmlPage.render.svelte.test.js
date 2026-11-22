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

describe('the page drawn again', () => {
  it('shows a page the hidden frame already holds, which loads nothing new there, as after an Undo', () => {
    target = document.createElement('div');
    document.body.append(target);
    const props = $state({ html: '<!doctype html><html><body><p>One</p></body></html>' });
    app = mount(HtmlPage, { target, props });
    flushSync();
    const frames = [...target.querySelectorAll('iframe')];
    const shown = () => frames.findIndex((frame) => frame.classList.contains('shown'));
    frames[1].dispatchEvent(new Event('load'));
    flushSync();
    expect(shown()).toBe(1);
    props.html = '<!doctype html><html><body><p>Two</p></body></html>';
    flushSync();
    frames[0].dispatchEvent(new Event('load'));
    flushSync();
    expect(shown()).toBe(0);
    // back to the first page, which frame 1 holds already: shown with no load to wait for
    props.html = '<!doctype html><html><body><p>One</p></body></html>';
    flushSync();
    expect(shown()).toBe(1);
    expect(frames[1].getAttribute('srcdoc')).toContain('<p>One</p>');
  });
});

describe('a double-click inside the HTML page', () => {
  it('hands up the note\'s line and the word, said by the frame shown only', () => {
    target = document.createElement('div');
    document.body.append(target);
    const online = vi.fn();
    app = mount(HtmlPage, { target, props: { html: '<!doctype html><html><body><p data-line="4">Hi</p></body></html>', online } });
    flushSync();
    const frames = [...target.querySelectorAll('iframe')];
    frames[1].dispatchEvent(new Event('load'));
    flushSync();
    // the page's own script says it from the frame on screen
    expect(frames[1].getAttribute('srcdoc')).toContain("addEventListener('dblclick'");
    const say = (frame, data) => window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
    say(frames[1], { azimutLine: 4, azimutWord: 'held' });
    expect(online).toHaveBeenCalledWith(4, 'held');
    // the hidden frame, or a line that is none, says nothing
    say(frames[0], { azimutLine: 9, azimutWord: '' });
    say(frames[1], { azimutLine: -2 });
    expect(online).toHaveBeenCalledTimes(1);
  });
});

describe('a right-click inside the HTML page', () => {
  it('opens the app\'s menu where the pointer is, with the line, the words and a link it is on', () => {
    target = document.createElement('div');
    document.body.append(target);
    const onmenu = vi.fn();
    app = mount(HtmlPage, { target, props: { html: '<!doctype html><html><body><p data-line="4">Hi</p></body></html>', onmenu } });
    flushSync();
    const frames = [...target.querySelectorAll('iframe')];
    frames[1].dispatchEvent(new Event('load'));
    flushSync();
    expect(frames[1].getAttribute('srcdoc')).toContain("addEventListener('contextmenu'");
    frames[1].getBoundingClientRect = () => ({ left: 300, top: 100, width: 600, height: 800 });
    Object.defineProperty(frames[1], 'offsetWidth', { value: 600 });
    const say = (data) => window.dispatchEvent(new MessageEvent('message', { data, source: frames[1].contentWindow }));
    say({ azimutMenu: { line: 4, word: 'held', words: 'The line held.', href: 'https://example.org/a', x: 20, y: 30 } });
    expect(onmenu).toHaveBeenCalledWith({ line: 4, word: 'held', words: 'The line held.', href: 'https://example.org/a', at: { x: 320, y: 130 } });
    // what the page says is held to what a menu can carry: no line, no script address
    say({ azimutMenu: { line: -1, href: 'javascript:alert(1)', x: 0, y: 0 } });
    expect(onmenu.mock.calls[1][0]).toMatchObject({ line: -1, href: '', words: '' });
  });
});
