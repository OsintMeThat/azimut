// @vitest-environment happy-dom
/**
 * The panel section for layers the analyst added.
 *
 * What is asserted here is what the row *says*, because that is where this
 * feature can quietly lie: a count that hides how much was filtered out, a
 * subscription drawing week-old marks without a word, a legend that decorates
 * instead of filtering.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AddedLayers from './AddedLayers.svelte';
import { GROUP_SPACE } from '../../lib/map/addedLayers.js';

let held = null;

function show(props = {}) {
  held = mount(AddedLayers, {
    target: document.body,
    props: { rows: [], busy: '', ...props },
  });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const text = () => document.body.textContent ?? '';
const rows = (selector) => [...document.body.querySelectorAll(selector)];
const byText = (selector, label) =>
  rows(selector).find((node) => node.textContent.trim().startsWith(label));

const LAYER = {
  name: 'Sightings',
  title: 'Sightings',
  source: { kind: 'file', name: 'sightings.kml' },
  enabled: true,
  hidden: [],
  features: 3200,
  categories: [
    { name: 'Checkpoints', count: 2788, colour: '#ff0000', kinds: ['point'] },
    { name: 'Damage', count: 412, colour: '', kinds: ['area'] },
  ],
  fetched_at: new Date().toISOString(),
  stale: false,
};

const followed = (over = {}) => ({
  ...LAYER,
  name: 'Roadblocks',
  title: 'Roadblocks',
  source: { kind: 'url', url: 'https://example.test/r.kml', my_maps: true },
  ...over,
});

describe('before anything is added', () => {
  it('is an empty section with a way to fill it, not an absent one', () => {
    show();

    expect(text()).toContain('Added layers');
    expect(text()).toContain('Nothing added yet.');
    expect(byText('button', 'Add a layer')).toBeTruthy();
  });

  it('counts nothing rather than borrowing the curated list’s number', () => {
    show();

    expect(document.querySelector('.count').textContent).toBe('0');
  });
});

describe('a row', () => {
  it('renders from state, with where it came from and how fresh it is', () => {
    show({ rows: [LAYER] });

    expect(text()).toContain('Sightings');
    expect(text()).toContain('sightings.kml');
    expect(text()).toContain('opened');
  });

  it('states what is loaded and what is drawn, separately', () => {
    show({ rows: [{ ...LAYER, hidden: ['Damage'] }] });

    // never the drawn count passing for the loaded one
    expect(text()).toMatch(/3.200 features · 2.788 shown/);
  });

  it('links a followed map back to the page it was published on', () => {
    show({ rows: [followed()] });

    const link = document.querySelector('.from');
    expect(link.getAttribute('href')).toBe('https://example.test/r.kml');
    expect(link.textContent).toContain('Google My Maps');
    // it leaves the app, so it leaves in its own tab and carries no referrer
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('leaves a file as plain text, having nowhere to send anybody', () => {
    show({ rows: [LAYER] });

    expect(document.querySelector('.from')).toBeNull();
    expect(text()).toContain('sightings.kml');
  });

  it('says a stale snapshot is stale, and marks it for the eye', () => {
    show({ rows: [followed({ stale: true, checked_at: '2020-01-01T00:00:00Z' })] });

    expect(text()).toContain('stale');
    expect(document.querySelector('.stale')).toBeTruthy();
  });

  it('offers Refresh only to a layer that has somewhere to refresh from', () => {
    show({ rows: [LAYER] });
    expect(byText('button', 'Refresh')).toBeFalsy();

    unmount(held);
    held = null;
    document.body.innerHTML = '';

    show({ rows: [followed()] });
    expect(byText('button', 'Refresh')).toBeTruthy();
  });

  it('owns its layer the way a curated row does not: it can be removed', () => {
    show({ rows: [LAYER] });

    expect(byText('button', 'Remove')).toBeTruthy();
    // no way to reach the saved copy on disk: it is stored under an extension
    // no other program opens, in a folder the analyst never sees
    expect(byText('button', 'Reveal file')).toBeFalsy();
  });

  it('counts only what is being drawn in the section head', () => {
    show({ rows: [LAYER, followed({ enabled: false })] });

    expect(document.querySelector('.count').textContent).toBe('1');
  });
});

describe('the legend is the filter', () => {
  it('opens to one row per category, with its colour and its count', () => {
    show({ rows: [LAYER] });

    byText('.legend-head', '2 groups').click();
    flushSync();

    const cats = rows('.cat');
    expect(cats.map((node) => node.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Checkpoints 2788',
      'Damage 412',
    ]);
    expect(cats[0].querySelector('.swatch').getAttribute('style')).toContain('#ff0000');
  });

  it('reports a hidden category as off rather than dropping it from the legend', () => {
    show({ rows: [{ ...LAYER, hidden: ['Damage'] }] });
    byText('.legend-head', '2 groups').click();
    flushSync();

    expect(rows('.cat').map((node) => node.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);
  });

  it('asks for exactly the category that was clicked', () => {
    const oncategory = vi.fn();
    show({ rows: [LAYER], oncategory });
    byText('.legend-head', '2 groups').click();
    flushSync();

    rows('.cat')[1].click();

    expect(oncategory).toHaveBeenCalledWith(LAYER, 'Damage');
  });
});

/**
 * The search shares the legend's slot, and the point of the sharing is that the
 * two never speak at once: one is the filter the case keeps, the other is a way
 * of looking that leaves nothing behind.
 */
describe('finding a pin', () => {
  const HITS = [
    { index: 4, name: 'North gate', category: 'Checkpoints', colour: '#ff0000', hidden: false },
    { index: 9, name: 'Gate house', category: 'Damage', colour: '#5ac8fa', hidden: false },
  ];

  const finder = (found) => vi.fn(() => found);

  function type(what) {
    const box = document.querySelector('.find input');
    box.value = what;
    box.dispatchEvent(new Event('input'));
    flushSync();
    return box;
  }

  function opened(props = {}) {
    show({ rows: [LAYER], ...props });
    byText('.legend-head', '2 groups').click();
    flushSync();
  }

  it('offers the box under the groups, on a layer that is being drawn', () => {
    opened({ search: finder({ total: 0, results: [], ready: true }) });

    expect(document.querySelector('.find input')).toBeTruthy();
  });

  it('offers nothing to search on a layer that is switched off', () => {
    // a match is somewhere to go, and a layer nobody is drawing has nowhere
    show({ rows: [{ ...LAYER, enabled: false }], search: finder(null) });
    byText('.legend-head', '2 groups').click();
    flushSync();

    expect(document.querySelector('.find input')).toBeNull();
    expect(rows('.cat')).toHaveLength(2);
  });

  it('shows the matches in place of the legend, and the legend again after', () => {
    opened({ search: finder({ total: 2, results: HITS, ready: true }) });

    type('gate');
    expect(rows('.cat').map((node) => node.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'North gate Checkpoints',
      'Gate house Damage',
    ]);

    type('');
    expect(rows('.cat').map((node) => node.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Checkpoints 2788',
      'Damage 412',
    ]);
  });

  it('never lets a search pass for a filter on the row above it', () => {
    // the invariant the shared slot exists to protect: typing changes what is
    // listed, and states nothing about what the map is drawing
    opened({ search: finder({ total: 1, results: [HITS[0]], ready: true }) });

    type('gate');

    expect(text()).toContain(`3${GROUP_SPACE}200 features`);
    expect(text()).not.toContain('shown');
  });

  it('says how many were found and how many are listed', () => {
    opened({ search: finder({ total: 412, results: HITS, ready: true }) });

    type('gate');

    expect(document.querySelector('.search-count').textContent).toBe('412');
    expect(text()).toContain('First 2 of 412.');
  });

  it('says when nothing matches', () => {
    opened({ search: finder({ total: 0, results: [], ready: true }) });

    type('gate');

    expect(text()).toContain('No pin matches that.');
  });

  it('does not call that nothing while the features are still on their way', () => {
    opened({ search: finder({ total: 0, results: [], ready: false }) });

    type('gate');

    expect(text()).toContain('Reading…');
    expect(text()).not.toContain('No pin matches that.');
  });

  it('lists a match from a hidden group, marked, and still goes to it', () => {
    const onpick = vi.fn();
    const hit = { ...HITS[1], hidden: true };
    opened({ search: finder({ total: 1, results: [hit], ready: true }), onpick });

    type('gate');
    const [match] = rows('.cat');

    expect(match.className).toContain('off');
    expect(match.title).toBe('Show this group and go there');
    match.click();
    expect(onpick).toHaveBeenCalledWith(LAYER, hit);
  });
});

describe('the acts', () => {
  it('reports the switch, the refresh and the remove', () => {
    const handlers = {
      ontoggle: vi.fn(),
      onrefresh: vi.fn(),
      onremove: vi.fn(),
      onadd: vi.fn(),
    };
    show({ rows: [followed()], ...handlers });

    document.querySelector('.eye').click();
    byText('button', 'Refresh').click();
    byText('button', 'Remove').click();
    byText('button', 'Add a layer').click();

    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalled();
  });

  it('says a refresh is running on the row it is running on', () => {
    show({ rows: [followed()], busy: 'Roadblocks' });

    expect(byText('button', 'Reading…')).toBeTruthy();
    expect(byText('button', 'Reading…').disabled).toBe(true);
  });
});
