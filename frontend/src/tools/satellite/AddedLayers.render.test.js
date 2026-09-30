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
const byLabel = (label) => document.body.querySelector(`[aria-label="${label}"]`);

/** Every row opens folded: this is the press that shows the rest of one. */
function unfold(title) {
  byText('.fold', title).click();
  flushSync();
}

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
  it('opens folded to one line: the eye, the name, and its acts', () => {
    show({ rows: [LAYER] });

    expect(text()).toContain('Sightings');
    expect(text()).not.toContain('sightings.kml');
    expect(document.querySelector('.fold').getAttribute('aria-expanded')).toBe('false');
    expect(byLabel('Remove Sightings')).toBeTruthy();
  });

  it('unfolds the layer just added, since it was added to be read', () => {
    show({ rows: [LAYER, followed()], opened: 'Roadblocks' });

    const [first, second] = rows('.fold');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds the layer just added when asked, and keeps it folded', () => {
    show({ rows: [followed()], opened: 'Roadblocks' });

    unfold('Roadblocks');

    expect(document.querySelector('.fold').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders from state, with where it came from and how fresh it is', () => {
    show({ rows: [LAYER] });
    unfold('Sightings');

    expect(text()).toContain('Sightings');
    expect(text()).toContain('sightings.kml');
    expect(text()).toContain('opened');
  });

  it('states what is loaded and what is drawn, separately', () => {
    show({ rows: [{ ...LAYER, hidden: ['Damage'] }] });
    unfold('Sightings');

    // never the drawn count passing for the loaded one
    expect(text()).toMatch(/3.200 features · 2.788 shown/);
  });

  it('links a followed map back to the page it was published on', () => {
    show({ rows: [followed()] });
    unfold('Roadblocks');

    const link = document.querySelector('.from');
    expect(link.getAttribute('href')).toBe('https://example.test/r.kml');
    expect(link.textContent).toContain('Google My Maps');
    // it leaves the app, so it leaves in its own tab and carries no referrer
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('leaves a file as plain text, having nowhere to send anybody', () => {
    show({ rows: [LAYER] });
    unfold('Sightings');

    expect(document.querySelector('.from')).toBeNull();
    expect(text()).toContain('sightings.kml');
  });

  it('says a stale snapshot is stale, folded or not', () => {
    show({ rows: [followed({ stale: true, checked_at: '2020-01-01T00:00:00Z' })] });

    // folded, the name and a mark say it before anything is read
    expect(document.querySelector('.name.stale')).toBeTruthy();
    expect(document.querySelector('.stale-mark').title).toContain('out of date');

    unfold('Roadblocks');
    expect(text()).toContain('out of date');
  });

  it('offers Refresh only to a layer that has somewhere to refresh from', () => {
    show({ rows: [LAYER] });
    expect(byLabel('Refresh Sightings')).toBeNull();

    unmount(held);
    held = null;
    document.body.innerHTML = '';

    show({ rows: [followed()] });
    expect(byLabel('Refresh Roadblocks')).toBeTruthy();
  });

  it('owns its layer the way a curated row does not: it can be removed', () => {
    show({ rows: [LAYER] });

    expect(byLabel('Remove Sightings')).toBeTruthy();
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
    unfold('Sightings');

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
    unfold('Sightings');
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
    unfold('Sightings');
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
    unfold('Sightings');
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
    unfold('Sightings');
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
    byLabel('Refresh Roadblocks').click();
    byLabel('Remove Roadblocks').click();
    byText('button', 'Add a layer').click();

    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalled();
  });

  it('says a refresh is running on the row it is running on', () => {
    show({ rows: [followed()], busy: 'Roadblocks' });

    const button = byLabel('Refresh Roadblocks');
    expect(button.title).toBe('Reading…');
    expect(button.disabled).toBe(true);
  });

  it('refreshes every followed layer from the head, and only offers it when there is one', () => {
    show({ rows: [LAYER] });
    expect(byLabel('Refresh every followed layer')).toBeNull();

    unmount(held);
    held = null;
    document.body.innerHTML = '';

    const onrefreshall = vi.fn();
    show({ rows: [LAYER, followed()], onrefreshall });
    byLabel('Refresh every followed layer').click();
    expect(onrefreshall).toHaveBeenCalled();
  });

  it('holds the head button while it is going through them', () => {
    show({ rows: [followed()], refreshing: true });

    expect(byLabel('Refresh every followed layer').disabled).toBe(true);
  });
});

/** The list is the stack, top first, and the grip is how it changes. */
describe('restacking', () => {
  const three = () => [
    LAYER,
    followed(),
    { ...LAYER, name: 'Damage', title: 'Damage' },
  ];

  /** happy-dom has no DataTransfer, so the drag carries a stand-in. */
  function dragEvent(type, { x = 100, y = 0 } = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    event.dataTransfer = {
      setData() {},
      setDragImage() {},
      effectAllowed: '',
      dropEffect: '',
    };
    event.clientX = x;
    event.clientY = y;
    return event;
  }

  /** …and no layout: each row 26px tall, the list 300px wide from x 0. */
  const ROW = 26;
  function laidOut() {
    const list = document.querySelector('ul.layers');
    const items = [...list.children];
    const rect = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 300, width: 300 });
    list.getBoundingClientRect = () => rect(0, items.length * ROW);
    items.forEach((item, index) => (item.getBoundingClientRect = () => rect(index * ROW, ROW)));
    return items;
  }

  it('has nothing to drag in a list of one', () => {
    show({ rows: [LAYER] });

    expect(document.querySelector('.grip')).toBeNull();
  });

  it('drops a row below the one it was let go over the lower half of', () => {
    const onreorder = vi.fn();
    show({ rows: three(), onreorder });
    const items = laidOut();
    rows('.grip')[0].dispatchEvent(dragEvent('dragstart'));
    // the lower half of the second row
    items[1].dispatchEvent(dragEvent('dragover', { y: ROW + 20 }));
    flushSync();
    expect(items[2].classList.contains('gap-above')).toBe(true);
    items[1].dispatchEvent(dragEvent('drop', { y: ROW + 20 }));

    expect(onreorder).toHaveBeenCalledWith(['Roadblocks', 'Sightings', 'Damage']);
  });

  it('still takes the drop when the pointer drifted off the row beside the list', () => {
    // the grip sits on the row's left edge, and a hand moving down drifts off it
    const onreorder = vi.fn();
    show({ rows: three(), onreorder });
    laidOut();
    rows('.grip')[2].dispatchEvent(dragEvent('dragstart'));
    const over = dragEvent('dragover', { x: -12, y: 4 });
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    document.body.dispatchEvent(dragEvent('drop', { x: -12, y: 4 }));

    expect(onreorder).toHaveBeenCalledWith(['Damage', 'Sightings', 'Roadblocks']);
  });

  it('refuses a drop far from the list, so the row goes back where it was', () => {
    const onreorder = vi.fn();
    show({ rows: three(), onreorder });
    laidOut();
    rows('.grip')[0].dispatchEvent(dragEvent('dragstart'));
    const over = dragEvent('dragover', { x: 600, y: 40 });
    document.body.dispatchEvent(over);
    flushSync();

    expect(over.defaultPrevented).toBe(false);
    expect(document.querySelector('.gap-above, .gap-below')).toBeNull();
    document.body.dispatchEvent(dragEvent('drop', { x: 600, y: 40 }));
    expect(onreorder).not.toHaveBeenCalled();
  });

  it('asks for nothing when a row is let go where it was', () => {
    const onreorder = vi.fn();
    show({ rows: three(), onreorder });
    const items = laidOut();
    const own = items[1];
    // a drop that never passed over the list…
    rows('.grip')[1].dispatchEvent(dragEvent('dragstart'));
    own.dispatchEvent(dragEvent('drop', { y: ROW + 20 }));
    // …and one let go over itself
    rows('.grip')[1].dispatchEvent(dragEvent('dragstart'));
    own.dispatchEvent(dragEvent('dragover', { y: ROW + 20 }));
    own.dispatchEvent(dragEvent('drop', { y: ROW + 20 }));

    expect(onreorder).not.toHaveBeenCalled();
  });

  it('moves one place at a time with the arrow keys, and not past either end', () => {
    const onreorder = vi.fn();
    show({ rows: three(), onreorder });
    const press = (grip, key) =>
      grip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

    press(rows('.grip')[0], 'ArrowDown');
    expect(onreorder).toHaveBeenLastCalledWith(['Roadblocks', 'Sightings', 'Damage']);
    press(rows('.grip')[2], 'ArrowUp');
    expect(onreorder).toHaveBeenLastCalledWith(['Sightings', 'Damage', 'Roadblocks']);

    onreorder.mockClear();
    press(rows('.grip')[0], 'ArrowUp');
    press(rows('.grip')[2], 'ArrowDown');
    expect(onreorder).not.toHaveBeenCalled();
  });
});
