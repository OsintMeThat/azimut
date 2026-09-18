// @vitest-environment happy-dom
/**
 * The `+` dialog, and the one decision it is the right place for.
 *
 * Whether to draw a map in its own pictograms is asked here because here is the
 * moment the request would be made: the icons are read once, at import, and
 * served out of the case folder from then on. What is asserted is the default on
 * each half — off for a file, on for an address — because that is the local-first
 * line, and a pre-ticked box on a file import would cross it quietly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AddLayerDialog from './AddLayerDialog.svelte';

let held = null;

function show(props = {}) {
  held = mount(AddLayerDialog, {
    target: document.body,
    props: { busy: false, ...props },
  });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const ticks = () => [...document.body.querySelectorAll('input[type="checkbox"]')];
const button = (label) =>
  [...document.body.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === label
  );

describe('the add-a-layer dialog', () => {
  it('offers the choice once per half, and nowhere else', () => {
    show();

    expect(ticks()).toHaveLength(2);
  });

  it('leaves a file alone and dresses an address', () => {
    show();
    const [file, url] = ticks();

    expect(file.checked).toBe(false);
    expect(url.checked).toBe(true);
  });

  it('says what ticking it will do to a file, rather than after the fact', () => {
    show();
    const [file] = ticks();

    expect(document.body.textContent).toContain('Nothing leaves this machine.');
    file.checked = true;
    file.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(document.body.textContent).toContain('fetched once, now');
  });

  it('hands the answer to the caller with the address', () => {
    const onurl = vi.fn();
    show({ onurl });
    const input = document.body.querySelector('input[type="url"]');
    input.value = 'https://www.google.com/maps/d/viewer?mid=XyZ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    button('Subscribe').click();

    expect(onurl).toHaveBeenCalledWith('https://www.google.com/maps/d/viewer?mid=XyZ', true);
  });

  it('hands it over untouched when the box was cleared', () => {
    const onurl = vi.fn();
    show({ onurl });
    const [, url] = ticks();
    url.checked = false;
    url.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.body.querySelector('input[type="url"]');
    input.value = 'https://example.test/roads.kml';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    button('Subscribe').click();

    expect(onurl).toHaveBeenCalledWith('https://example.test/roads.kml', false);
  });
});
