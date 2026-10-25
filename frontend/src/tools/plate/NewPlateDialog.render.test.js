// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import NewPlateDialog from './NewPlateDialog.svelte';
import { GALLERY } from '../../lib/plate/gallery.js';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(props = {}) {
  const made = [];
  held = mount(NewPlateDialog, { target: document.body, props: { rows: [{ name: 'front', title: 'Front', bbox: [30, 44, 34, 46] }, { name: 'empty', title: 'Empty' }],
    layers: ['front'], templates: [{ id: 't1', name: 'Mine', data: { page: { paper: 'a4', orientation: 'landscape' }, theme: {}, elements: [] } }],
    onmake: (choice) => made.push(choice), onclose: () => {}, ...props } });
  flushSync();
  return made;
}
const button = (text) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const tile = (name) => [...document.body.querySelectorAll('.tile')].find((node) => node.querySelector('.name')?.textContent === name);
const press = (node) => { node.click(); flushSync(); };

describe('a new plate on one screen', () => {
  it('creates the house layout over the Map\'s ground at once', () => {
    const made = show();
    press(button('Create plate'));
    expect(made).toEqual([{ from: { kind: 'blank', id: '' }, where: 'map', layers: ['front'], format: '', look: '' }]);
  });

  it('shows the layouts, the map, the paper and the look together, with no steps to walk', () => {
    show();
    expect(document.body.querySelectorAll('.tile')).toHaveLength(1 + GALLERY.length + 1);
    expect(document.body.querySelectorAll('.tile svg.sketch')).toHaveLength(1 + GALLERY.length + 1);
    expect([...document.body.querySelectorAll('h4')].map((node) => node.textContent)).toEqual(['Layout', 'Map', 'Paper', 'Look']);
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(button('Next')).toBeUndefined();
  });

  it('takes a ready plate, the ground round the layers picked, a paper and a look', () => {
    const made = show();
    press(tile('Before and after'));
    press(button('Round the layers picked'));
    press([...document.body.querySelectorAll('.layers input')][1]);
    press(button('Story, 9:16'));
    press([...document.body.querySelectorAll('.look')].find((node) => node.textContent.includes('Tactical')));
    press(button('Create plate'));
    expect(made.at(-1)).toEqual({ from: { kind: 'ready', id: 'before-after' }, where: 'layers', layers: ['front', 'empty'], format: 'story', look: 'tactical' });
  });

  it('frames round no layer that holds nothing to frame', () => {
    const made = show({ layers: [] });
    expect(button('Round the layers picked').disabled).toBe(true);
    press(tile('Post'));
    press(button('Create plate'));
    expect(made.at(-1)).toMatchObject({ from: { kind: 'ready', id: 'post' }, where: 'map', layers: [] });
  });

  it('a ready plate goes back to its own paper, and Cancel makes nothing', () => {
    let closed = 0;
    const made = show({ onclose: () => { closed += 1; } });
    press(button('Square'));
    press(tile('Post'));
    expect(button('As laid out').getAttribute('aria-pressed')).toBe('true');
    press(button('Cancel'));
    expect(closed).toBe(1);
    expect(made).toEqual([]);
  });
});
