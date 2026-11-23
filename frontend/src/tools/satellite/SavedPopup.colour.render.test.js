// @vitest-environment happy-dom
/**
 * A place's colour, picked in the card its mark opens.
 *
 * The colour is the place's, kept on it (`attrs.color`), and its mark is painted
 * again at once. It is picked from the palette a layer's style is picked from: the
 * plain colours, those picked lately and a code typed or pasted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const patch = vi.fn(async () => ({}));
vi.mock('../../lib/api.js', () => ({ api: { patch, get: vi.fn(async () => ({ relations: [] })) } }));

const { default: SavedPopup } = await import('./SavedPopup.svelte');

const place = { id: 'p1', key: 'p1', kind: 'place', title: 'Depot', lat: 1, lon: 2, color: null };
const capture = { id: 'c1', key: 'c1', kind: 'capture', title: 'Bridge', lat: 1, lon: 2, path: 'media/a.png' };

let held = null;
function show(props = {}) {
  held = mount(SavedPopup, {
    target: document.body,
    props: { items: [place], caseId: 'case-1', coords: () => '1, 2', onopen: () => {}, ...props },
  });
  flushSync();
}
const button = () => document.body.querySelector('[aria-label="Place colour"]');

beforeEach(() => patch.mockClear());
afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

describe('a place’s colour in its card', () => {
  it('is offered on a place where the map edits, and nowhere else', () => {
    show({ oncolour: vi.fn() });
    expect(button()).toBeTruthy();
    unmount(held);
    show({ oncolour: null });
    expect(button()).toBe(null);
    unmount(held);
    show({ items: [capture], oncolour: vi.fn() });
    expect(button()).toBe(null);
  });

  it('opens the palette, keeps the colour picked on the place, and paints its mark again', async () => {
    const oncolour = vi.fn();
    const onrefresh = vi.fn(async () => {});
    show({ oncolour, onrefresh });
    button().click();
    flushSync();
    // any colour but the red it wears now
    const swatch = [...document.body.querySelectorAll('.colours button.swatch')]
      .find((node) => node.title.includes('#') && !node.title.includes('#e5484d'));
    expect(swatch).toBeTruthy();
    swatch.click();
    await vi.waitFor(() => expect(patch).toHaveBeenCalled());
    const hex = swatch.title.split(', ').at(-1);
    expect(patch).toHaveBeenCalledWith('/api/cases/case-1/entities/p1', { attrs: { color: hex } });
    await vi.waitFor(() => expect(oncolour).toHaveBeenCalledWith(place, hex));
    expect(onrefresh).toHaveBeenCalled();
    flushSync();
    expect(button().querySelector('.colour-dot').style.background).toBeTruthy();
  });

  it('takes a code typed or pasted', async () => {
    show({ oncolour: vi.fn() });
    button().click();
    flushSync();
    document.body.querySelector('.colours [aria-label="More colours"]').click();
    flushSync();
    const field = document.body.querySelector('.colours input[aria-label="Place colour code"]');
    expect(field).toBeTruthy();
  });
});
