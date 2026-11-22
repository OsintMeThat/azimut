// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateAdd from './PlateAdd.svelte';
import { recentAdds } from '../../lib/plate/recentAdds.svelte.js';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; recentAdds.list = []; localStorage.clear(); });

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
    expect(heads()).toEqual(['From the case', 'Maps', 'On the map', 'Round the map', 'Writing', 'Blocks', 'Signing', 'Pictures and shapes', 'Slides']);
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

  it('offers no step and no video to a template, which plays nothing, and nothing from the case, which it keeps none of', () => {
    show({ template: true });
    expect(heads()).not.toContain('Slides');
    expect(heads()).not.toContain('From the case');
    expect(tiles()).not.toContain('Video');
    expect(tiles()).not.toContain('Comparison');
    expect(tiles()).not.toContain('Geo Proof');
  });

  it('offers the tiles picked lately first, the newest first, and keeps them between visits', () => {
    let calls = show();
    expect(document.body.querySelector('.recent')).toBeNull();
    const pickTile = (label) => [...document.body.querySelectorAll('.group:not(.recent) .tile')].find((tile) => tile.textContent.trim() === label).click();
    pickTile('Arrow');
    expect(calls.onadd).toHaveBeenCalledWith('arrow');
    unmount(held); document.body.innerHTML = '';
    calls = show();
    pickTile('Zone');
    unmount(held); document.body.innerHTML = '';
    // Enter adds the first found, and it is picked as any tile is
    calls = show();
    type('rings');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.onadd).toHaveBeenCalledWith('ring');
    unmount(held); document.body.innerHTML = '';
    calls = show();
    expect(heads()[0]).toBe('Recent');
    const row = () => [...document.body.querySelectorAll('.recent .tile')].map((tile) => tile.textContent.trim());
    expect(row()).toEqual(['Rings', 'Zone', 'Arrow']);
    // a tile of the row adds as its group's does, with the same words on hover
    const zone = [...document.body.querySelectorAll('.recent .tile')].find((tile) => tile.textContent.trim() === 'Zone');
    expect(zone.title).toBe('Zone: press the map to place it');
    zone.click();
    expect(calls.onadd).toHaveBeenCalledWith('zone');
    expect(JSON.parse(localStorage.getItem('azimut:plateRecentAdds'))).toEqual(['zone', 'ring', 'arrow']);
  });

  it('hides the row while a word is searched, and on a template keeps only the tiles it offers', () => {
    recentAdds.list = ['video', 'step', 'label', 'comparison'];
    show();
    expect([...document.body.querySelectorAll('.recent .tile')].map((tile) => tile.textContent.trim())).toEqual(['Video', 'Slide', 'Label', 'Comparison']);
    type('label');
    expect(document.body.querySelector('.recent')).toBeNull();
    expect(tiles()).toEqual(['Label']);
    unmount(held); document.body.innerHTML = '';
    show({ template: true });
    expect([...document.body.querySelectorAll('.recent .tile')].map((tile) => tile.textContent.trim())).toEqual(['Label']);
    unmount(held); document.body.innerHTML = '';
    recentAdds.list = ['video'];
    show({ template: true });
    expect(document.body.querySelector('.recent')).toBeNull();
  });

  it('finds a comparison of the case by the words it is asked by', () => {
    show();
    type('before after');
    expect(tiles()).toEqual(['Comparison']);
  });
});
