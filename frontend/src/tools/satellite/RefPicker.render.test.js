// @vitest-environment happy-dom
/**
 * The Add reference picker, actually mounted.
 *
 * What it is for is one click to the shot being geolocated in a case that also
 * holds dozens of renders. So what is asserted is what a click narrows to: the
 * working files start held back, a chip is one press, a chip that would narrow
 * nothing is left out, and a short case skips all of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import RefPicker from './RefPicker.svelte';

const upload = (title, extra = {}) => ({
  path: `media/${title}.jpg`,
  filename: `${title}.jpg`,
  title,
  kind: 'image',
  source: { type: 'upload' },
  ...extra,
});
const clip = (title) => ({
  path: `media/${title}.mp4`,
  filename: `${title}.mp4`,
  title,
  kind: 'video',
  source: { type: 'download' },
});
const made = (title, source) => ({
  path: `media/${title}.png`,
  filename: `${title}.png`,
  title,
  kind: 'image',
  source,
});

const COLLECTED = [
  upload('Gate', { folder: 'street' }),
  upload('Roof'),
  upload('Checkpoint'),
  upload('Crowd'),
  clip('Strike'),
  clip('Convoy'),
  clip('Launch'),
];
const WORKING = [
  made('Small change', { type: 'compare' }),
  made('Comparison 12', { type: 'compare' }),
  made('15.73, 45.02', { type: 'satellite' }),
  made('Collage 4', { type: 'inspect', op: 'collage' }),
];

let held = null;

function show(props = {}) {
  held = mount(RefPicker, {
    target: document.body,
    props: { media: [...COLLECTED, ...WORKING], caseId: 'c1', onpick: vi.fn(), onclose: vi.fn(), ...props },
  });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const shown = () => [...document.body.querySelectorAll('.ref-pick')].map((node) => node.title);
const chips = () =>
  [...document.body.querySelectorAll('.ref-chips .ref-chip')].map((node) => node.textContent.replace(/\s+/g, ' ').trim());
const chip = (label) =>
  [...document.body.querySelectorAll('.ref-chip')].find((node) => node.textContent.trim().startsWith(label));
const pressed = () =>
  [...document.body.querySelectorAll('.ref-chip[aria-pressed="true"]')].map((node) => node.textContent.trim());

function press(node) {
  node.click();
  flushSync();
}

function search(text) {
  const input = document.body.querySelector('.search-input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('a short case', () => {
  it('is a plain grid with everything in it, working files included', () => {
    const media = [COLLECTED[0], COLLECTED[4], WORKING[0]];
    show({ media });

    expect(shown()).toEqual(['Gate', 'Strike', 'Small change']);
    expect(document.body.querySelector('.search-input')).toBeNull();
    expect(chips()).toEqual([]);
  });
});

describe('a long case', () => {
  it('opens on what the case collected, and says how much it holds back', () => {
    show();

    expect(shown()).toEqual(COLLECTED.map((item) => item.title));
    expect(document.body.querySelector('.search-count').textContent).toBe('7/7');
    expect(chip('Show 4 working files')).toBeTruthy();
  });

  it('brings the working files back with one press, and their facets with them', () => {
    show();
    press(chip('Show 4 working files'));

    expect(shown()).toHaveLength(11);
    expect(chips()).toContain('Comparisons 2');
    expect(chips()).toContain('Satellite 1');
    expect(chip('Hide working files')).toBeTruthy();
  });

  it('narrows to one type in one click, counts included', () => {
    show();
    expect(chips()).toEqual([
      'All 7',
      'Images 4',
      'Videos 3',
      'Imports 4',
      'Downloads 3',
    ]);

    press(chip('Videos'));
    expect(shown()).toEqual(['Strike', 'Convoy', 'Launch']);
    expect(pressed()).toEqual(['Videos 3']);

    press(chip('All'));
    expect(shown()).toHaveLength(7);
  });

  it('searches inside the chip, and says when only held-back files match', () => {
    show();
    press(chip('Images'));
    search('roof');
    expect(shown()).toEqual(['Roof']);

    press(chip('All'));
    search('comparison');
    expect(shown()).toEqual([]);
    expect(document.body.textContent).toContain('Only working files match this search.');
  });

  it('opens on the chip the session kept', () => {
    show({ category: 'video' });
    expect(shown()).toEqual(['Strike', 'Convoy', 'Launch']);
  });

  it('reads a kept chip the switch hides as All, and gives it back with the switch', () => {
    show({ category: 'satellite' });
    expect(shown()).toHaveLength(7);
    expect(pressed()).toEqual(['All 7']);

    press(chip('Show 4 working files'));
    expect(shown()).toEqual(['15.73, 45.02']);
  });

  it('leaves out a chip that would narrow nothing', () => {
    const media = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(clip);
    show({ media });

    // Every item is a downloaded video: Videos and Downloads would hide nothing,
    // and there are no working files to hold back.
    expect(chips()).toEqual([]);
    expect(shown()).toHaveLength(7);
  });

  it('shows the working files when the case collected nothing', () => {
    const media = [...WORKING, ...WORKING.map((item) => ({ ...item, path: `${item.path}-2` }))];
    show({ media });

    expect(shown()).toHaveLength(8);
    expect(chip('Show')).toBeUndefined();
  });

  it('browses folders behind a button that says so, within the chip', () => {
    show();
    press(document.body.querySelector('button[title="Browse folders"]'));
    const rows = () =>
      [...document.body.querySelectorAll('.browser-row')].map((node) => node.textContent.trim());
    expect(rows()).toEqual(['Unfiled', 'street']);

    // Only an image is filed under street, so the Videos chip takes the folder away.
    press(chip('Videos'));
    expect(rows()).toEqual(['Unfiled']);
    expect(document.body.querySelector('button[title="Back to the grid"]')).toBeTruthy();
  });

  it('hands the picked item back', () => {
    const onpick = vi.fn();
    show({ onpick });
    press(document.body.querySelector('.ref-pick[title="Roof"]'));
    expect(onpick).toHaveBeenCalledWith(COLLECTED[1]);
  });
});
