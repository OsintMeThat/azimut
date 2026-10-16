// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateAdd from './PlateAdd.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(props = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const calls = { onadd: vi.fn(), onclose: vi.fn() };
  held = mount(PlateAdd, { target: document.body, props: { anchor, ...calls, ...props } });
  flushSync();
  return calls;
}
const field = () => document.body.querySelector('input[aria-label="Find an element"]');
const tiles = () => [...document.body.querySelectorAll('.tile')].map((tile) => tile.textContent.trim());
const heads = () => [...document.body.querySelectorAll('.group-head > span:first-child')].map((head) => head.textContent);
function type(text) {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('the Add panel', () => {
  it('opens on every group, its field ready to type in', () => {
    show();
    expect(heads()).toEqual(['Maps', 'On the map', 'Round the map', 'Writing', 'Signing', 'Pictures and shapes', 'Playing']);
    expect(document.activeElement).toBe(field());
  });

  it('finds an element by a word, and Enter adds the first found', () => {
    const calls = show();
    type('rings');
    expect(tiles()).toEqual(['Rings']);
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.onclose).toHaveBeenCalled();
    expect(calls.onadd).toHaveBeenCalledWith('ring');
  });

  it('says when nothing answers', () => {
    show();
    type('zzz');
    expect(tiles()).toEqual([]);
    expect(document.body.textContent).toContain('Nothing by that name.');
  });

  it('adds what a tile names, and lights the tool armed on the map', () => {
    const calls = show({ placing: { kind: 'label', preset: 'number' } });
    const number = [...document.body.querySelectorAll('.tile')].find((tile) => tile.textContent.trim() === 'Number');
    expect(number.classList.contains('on')).toBe(true);
    number.click();
    expect(calls.onadd).toHaveBeenCalledWith('number');
  });

  it('offers no step and no video to a template, which plays nothing', () => {
    show({ template: true });
    expect(heads()).not.toContain('Playing');
    expect(tiles()).not.toContain('Video');
  });
});
