// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Welcome from './Welcome.svelte';

let live;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  delete HTMLElement.prototype.animate;
});

/** The card laid out in the middle of happy-dom's 1024×768 window. */
function laidOut() {
  const at = { offsetLeft: 312, offsetTop: 290, offsetWidth: 400, offsetHeight: 188 };
  for (const [key, value] of Object.entries(at)) vi.spyOn(HTMLElement.prototype, key, 'get').mockReturnValue(value);
}

function show(anchor = null) {
  const onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(Welcome, { target, props: { version: '0.3.3', anchor, onclose } });
  flushSync();
  return onclose;
}

const button = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name);

/** The topbar's `?`, where a real layout would put it. */
function questionMark(left = 900) {
  const node = document.createElement('button');
  node.getBoundingClientRect = () => ({ left, right: left + 32, top: 10, bottom: 42, width: 32, height: 32 });
  document.body.append(node);
  return node;
}

describe('the welcome a version opens with', () => {
  it('names the version and says where the guide is', () => {
    show();
    expect(document.querySelector('h2').textContent).toContain('Azimut');
    expect(document.querySelector('.version').textContent).toBe('0.3.3');
    expect(document.querySelector('.how').textContent).toMatch(/top right opens the guide/);
  });

  it('closes without muting unless the box is ticked', () => {
    const onclose = show();
    button('Close').click();
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: false });
  });

  it('mutes the version when "Don’t show this again" is ticked', () => {
    const onclose = show();
    const box = document.querySelector('.mute input');
    box.click();
    flushSync();
    button('Close').click();
    expect(onclose).toHaveBeenCalledWith({ mute: true, guide: false });
  });

  it('opens the guide from its button', () => {
    const onclose = show();
    button('Open the guide').click();
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: true });
  });

  it('lights the `?` it points at through the veil, and opens the guide from it', () => {
    const onclose = show(questionMark());
    const lit = document.querySelector('.lit');
    expect(lit.style.left).toBe('897px');
    expect(lit.style.top).toBe('7px');
    lit.click();
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: true });
  });

  it('draws a line out of the card’s side and up into the `?`', () => {
    laidOut();
    show(questionMark());
    const port = document.querySelector('.lead .port');
    expect([port.getAttribute('cx'), port.getAttribute('cy')]).toEqual(['712', '328']);
    const d = document.querySelector('.lead .trail').getAttribute('d');
    expect(d).toBe('M712 328 C834 328 916 218 916 52');
    // the reveal that draws it follows the same course
    expect(document.querySelector('.lead .reveal').getAttribute('d')).toBe(d);
  });

  it('leaves from the card’s top when the `?` sits above it', () => {
    laidOut();
    show(questionMark(600));
    const port = document.querySelector('.lead .port');
    expect([port.getAttribute('cx'), port.getAttribute('cy')]).toEqual(['616', '290']);
    expect(document.querySelector('.lead .trail').getAttribute('d')).toMatch(/ 616 52$/);
  });

  it('sits alone in the middle when there is no `?` to point at', () => {
    show();
    expect(document.querySelector('.lit')).toBeNull();
    expect(document.querySelector('.lead')).toBeNull();
    expect(document.querySelector('.veil').classList.contains('plain')).toBe(true);
  });

  it('flies into the `?` when put away, then closes', async () => {
    laidOut();
    const landings = [];
    const animate = vi.fn(() => ({ finished: new Promise((resolve) => landings.push(resolve)) }));
    HTMLElement.prototype.animate = animate;
    const onclose = show(questionMark());

    button('Close').click();
    flushSync();
    expect(document.querySelector('.welcome').classList.contains('leaving')).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
    // from the card's middle (512, 384) to the button's (916, 26)
    const [frames] = animate.mock.calls[0];
    expect(frames.at(-1)).toEqual({ translate: '404px -358px', scale: 0.06 });

    // a second close on the way changes nothing
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    landings.forEach((land) => land());
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: false });
  });

  it('goes at once when asked for the guide, or when motion is reduced', () => {
    HTMLElement.prototype.animate = vi.fn();
    let onclose = show(questionMark());
    button('Open the guide').click();
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: true });
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
    unmount(live);

    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    onclose = show(questionMark());
    button('Close').click();
    expect(onclose).toHaveBeenCalledWith({ mute: false, guide: false });
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click beside it', () => {
    const onclose = show();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onclose).toHaveBeenCalledTimes(1);
    document.querySelector('.veil').click();
    expect(onclose).toHaveBeenCalledTimes(2);
  });
});
