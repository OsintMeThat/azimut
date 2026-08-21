// @vitest-environment happy-dom
/**
 * The screens the bridge to the case is made of, actually mounted.
 *
 * Each is a **plan read before it is pressed**, which is the promise the road is safe
 * under: forty rows becoming forty entities is not a thing to find out about afterwards.
 * So what these drive is the half a lib suite cannot — that the screen asks the server
 * what would happen, shows that answer, and only then offers a button that writes.
 *
 * And the two answers the hours form exists to ask for, because guessing either would move
 * evidence in time: which day a column of bare clocks belongs to, and which zone it is
 * written in. It answers them by **showing one row read back**, which is checkable by eye.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const { default: SheetToCase } = await import('./SheetToCase.svelte');
const { default: SheetDate } = await import('./SheetDate.svelte');
const { default: SheetAnchors } = await import('./SheetAnchors.svelte');

const TABLE = {
  columns: ['id', 'Subject', 'Local time', 'Est. time', 'start synchro'],
  rows: [
    ['r1', 'First impact', '01:57', '', '-00:01:50'],
    ['r2', 'Second impact', '', '02:05', '00:04:04'],
  ],
};
const META = {
  roles: { 'start synchro': { kind: 'offset', anchor: 'IGLA launch' } },
  anchors: { 'IGLA launch': { at: '2026-01-03T01:57:00Z' } },
};

let live = null;

function open(component, props) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(component, { target, props });
  flushSync();
  return target;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** The DOM keeps the source's line breaks, so a sentence written across two lines in the
 *  markup arrives with them. Asserting on prose means asserting on the words. */
const flat = (target) => target.textContent.replace(/\s+/g, ' ');

const labels = (target) =>
  [...target.querySelectorAll('button')].map((node) => node.textContent.trim());

const press = (target, text) => {
  const found = [...target.querySelectorAll('button')].find((node) =>
    node.textContent.trim().startsWith(text),
  );
  found.click();
  flushSync();
};

/** The registry the promotion screens read their types out of. Two is enough: what is
 *  under test is the plan, not the vocabulary. */
const TYPES = [
  { type: 'person', label: 'Person', promotable: true, attrs: [] },
  { type: 'organization', label: 'Organization', promotable: true, attrs: [] },
  { type: 'structure', label: 'Structure', promotable: true, attrs: [] },
  { type: 'place', label: 'Place', promotable: true, attrs: [] },
];

/** The relation registry, cut to the three verbs these tests turn on: one pair with a
 *  single reading, one with two, and one pair the vocabulary joins by nothing. */
const RELATIONS = [
  {
    type: 'member-of', label: 'is a member of', inverse_label: 'has member',
    manual: true, action: 'relation', group: '',
    from_types: ['person', 'organization'], to_types: ['organization'],
    from_media_kinds: [], to_media_kinds: [],
  },
  {
    type: 'owns', label: 'owns', inverse_label: 'is owned by',
    manual: true, action: 'relation', group: '',
    from_types: ['person', 'organization'], to_types: ['organization'],
    from_media_kinds: [], to_media_kinds: [],
  },
  {
    type: 'sited-at', label: 'is sited at', inverse_label: 'is the site of',
    manual: true, action: 'relation', group: '',
    from_types: ['structure'], to_types: ['place'],
    from_media_kinds: [], to_media_kinds: [],
  },
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url) => {
    if (url.endsWith('/relation-types')) return Promise.resolve(RELATIONS);
    if (url.endsWith('/confidence-levels')) return Promise.resolve([]);
    return Promise.resolve(TYPES);
  });
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('the hours form, as one mode of the pass', () => {
  const onchoices = vi.fn();

  beforeEach(() => onchoices.mockReset());

  function screen(props = {}) {
    return open(SheetDate, {
      table: TABLE,
      meta: { ...META, roles: { ...META.roles, 'Local time': { kind: 'when' } } },
      subject: 'Subject',
      onchoices,
      ...props,
    });
  }

  it('picks the column the sheet already says holds a time', async () => {
    const target = screen();
    await settle();
    expect(target.querySelector('[aria-label="The established hour"]').value).toBe('Local time');
    expect(onchoices).toHaveBeenCalledWith(
      expect.objectContaining({ when_column: 'Local time' }),
    );
  });

  it('asks for the day only where the cells hold clocks, and says why', async () => {
    const target = screen();
    await settle();
    expect(target.querySelector('[aria-label="The day these hours belong to"]')).toBeTruthy();
    expect(flat(target)).toContain('These cells hold clocks with no day');
  });

  it('reads one row back, which is how the day and the zone are checked', async () => {
    const target = screen();
    await settle();
    // Before a day: the moment cannot be spelled, and it says so rather than guessing today.
    expect(flat(target)).toContain('waiting for the day');

    const day = target.querySelector('[aria-label="The day these hours belong to"]');
    day.value = '2026-01-03';
    day.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(flat(target)).toContain('2026-01-03 01:57 local');
    expect(onchoices).toHaveBeenCalledWith(expect.objectContaining({ day: '2026-01-03' }));
  });

  it('folds away the answers that have a right default', async () => {
    const target = screen();
    await settle();
    expect(target.querySelector('[aria-label="What the time says"]')).toBeFalsy();
    press(target, 'More answers');
    await settle();
    expect(target.querySelector('[aria-label="What the time says"]')).toBeTruthy();
    expect(target.querySelector('[aria-label="The time zone this column is in"]')).toBeTruthy();
  });

  it('offers the other road when the sheet has an offset column', async () => {
    const target = screen();
    await settle();
    expect(labels(target)).toContain('From a sync point');

    press(target, 'From a sync point');
    await settle();
    // The anchor and its time are said, because "-00:01:50 from what, exactly" is the
    // question this road has to answer.
    expect(target.textContent).toContain('IGLA launch');
    expect(flat(target)).toContain('is dated 2026-01-03 01:57:00');
  });

  it('says an undated sync point dates nothing rather than failing quietly', async () => {
    const target = screen({
      meta: { ...META, anchors: { 'IGLA launch': { at: '' } } },
    });
    await settle();
    press(target, 'From a sync point');
    await settle();
    expect(flat(target)).toContain('has no time yet, so nothing can be dated from it');
  });

  it('offers to date an undated sync point instead of ending on the sentence', async () => {
    const onanchors = vi.fn();
    const target = screen({
      meta: { ...META, anchors: { 'IGLA launch': { at: '' } } },
      onanchors,
    });
    await settle();
    press(target, 'From a sync point');
    await settle();

    // The rows already carry their order; the shot's own time is the only thing between
    // that and real hours, so it is a press away rather than three screens back.
    press(target, 'Date it');
    expect(onanchors).toHaveBeenCalled();
  });

  it('does not offer to date a sync point that is already dated', async () => {
    const target = screen({ onanchors: vi.fn() });
    await settle();
    press(target, 'From a sync point');
    await settle();
    expect(labels(target)).not.toContain('Date it');
  });

  it('reports nothing at all until it has a column to read', async () => {
    const target = screen({ meta: { ...META } });
    await settle();
    const when = target.querySelector('[aria-label="The established hour"]');
    expect(when.value).toBe('');
    expect(onchoices).toHaveBeenCalledWith(null);
  });
});

describe('the sync points rows are lined up on', () => {
  const onchange = vi.fn();

  beforeEach(() => onchange.mockReset());

  it('says which columns are synced on it, and what one offset lands on', () => {
    const target = open(SheetAnchors, {
      table: TABLE,
      meta: META,
      onchange,
      onclose: vi.fn(),
    });
    expect(target.textContent).toContain('IGLA launch');
    expect(flat(target)).toContain('start synchro is synced on it');
    // A worked example, because nobody checks `-00:01:50` against `01:57:00Z` in their head.
    expect(target.textContent).toContain('-00:01:50 lands on 2026-01-03 01:55:10');
  });

  it('says an undated sync point leaves the rows their order and no times', () => {
    const target = open(SheetAnchors, {
      table: TABLE,
      meta: { ...META, anchors: { 'IGLA launch': { at: '' } } },
      onchange,
      onclose: vi.fn(),
    });
    expect(target.textContent).toContain('Undated, so the rows have an order and no times');
  });

  it('names a new one without dating it, because that is the normal state', () => {
    const target = open(SheetAnchors, {
      table: TABLE,
      meta: { ...META, anchors: {} },
      onchange,
      onclose: vi.fn(),
    });
    const box = target.querySelector('[aria-label="Name a sync point"]');
    box.value = 'second impact';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    press(target, 'Name it');
    expect(onchange).toHaveBeenCalledWith({ 'second impact': { at: '' } });
  });
});


describe('a whole sheet into the case, in one declaration', () => {
  const onpreview = vi.fn();
  const onpass = vi.fn();

  const ROSTER = {
    columns: ['id', 'Name', 'Unit', 'Coordinates', 'Source'],
    rows: [['r1', 'Ivanov', '3rd Brigade', '48.5, 35.1', 'https://example.org/a']],
  };
  const ROLES = {
    roles: { Coordinates: { kind: 'latlon' }, Source: { kind: 'url' } },
  };

  beforeEach(() => {
    onpreview.mockReset();
    onpass.mockReset();
  });

  function screen(props = {}) {
    return open(SheetToCase, {
      table: ROSTER,
      meta: ROLES,
      count: 1,
      onpreview,
      onpass,
      onclose: vi.fn(),
      ...props,
    });
  }

  const modeSelect = (target, column) =>
    target.querySelector(`[aria-label="What ${column} is"]`);

  function setMode(target, column, mode) {
    const select = modeSelect(target, column);
    select.value = mode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }

  function setType(target, column, type) {
    const select = target.querySelector(`[aria-label="What ${column} becomes"]`);
    select.value = type;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  }

  /** Whether the press that reads a plan is on offer. */
  const press_ready = (target) =>
    !([...target.querySelectorAll('button')].find((node) =>
      node.textContent.trim().startsWith('Preview'),
    ).disabled);

  const options = (node) =>
    [...node.querySelectorAll('option')].map((o) => o.textContent.replace(/\s+/g, ' ').trim());

  it('offers a mode only where the column role carries it', async () => {
    const target = screen();
    await settle();
    // Any column of words can name something; the four that need a role are gated on it.
    expect(options(modeSelect(target, 'Name'))).toEqual([
      'Ignore', 'One entity per row', 'One entity per value',
    ]);
    // Named after the one type they mint, in the vocabulary's own word.
    expect(options(modeSelect(target, 'Coordinates'))).toContain('Place (coordinates)');
    expect(options(modeSelect(target, 'Source'))).toContain('Bookmark (links)');
    expect(options(modeSelect(target, 'Source'))).not.toContain('Place (coordinates)');
  });

  it('sends an analyst after the points themselves to the mode that makes them', async () => {
    const target = screen();
    await settle();
    // The right column under the wrong mode, which is the shape of the mistake: this one
    // puts a subject on its ground, and a geolocation index wants the ground itself.
    setMode(target, 'Coordinates', 'point');
    await settle();
    expect(flat(target)).toContain('set Coordinates to “One entity per row” and pick Place');

    setMode(target, 'Coordinates', 'row');
    setType(target, 'Coordinates', 'place');
    await settle();
    // And then it is its own point, said rather than asked for a second time.
    expect(target.querySelector('.short')).toBeFalsy();
    expect(flat(target)).toContain('Each place is read from Coordinates');
    expect(press_ready(target)).toBe(true);
  });

  it('asks for the coordinates of a place named by a column of words', async () => {
    const target = screen();
    await settle();
    setMode(target, 'Name', 'row');
    setType(target, 'Name', 'place');
    await settle();
    // A column of names is not a column of coordinates, and the door says so rather than
    // letting 468 rows each say it.
    expect(flat(target)).toContain('set the column holding them to “Place (coordinates)”');
    expect(press_ready(target)).toBe(false);

    setMode(target, 'Coordinates', 'point');
    await settle();
    expect(press_ready(target)).toBe(true);
  });

  it('says what a declaration is short of rather than greying the press out', async () => {
    const target = screen();
    await settle();
    setMode(target, 'Source', 'addresses');
    await settle();

    // The server refuses those three at the door; a disabled button is the same refusal
    // with the reason taken off it.
    expect(target.querySelector('.note').textContent).toContain(
      'one column has to be the subject',
    );
    setMode(target, 'Name', 'row');
    await settle();
    expect(target.querySelector('.note')).toBeFalsy();
  });

  it('offers the pairs the vocabulary allows, and not the ones it does not', async () => {
    const target = screen();
    await settle();
    setMode(target, 'Name', 'row');
    setType(target, 'Name', 'person');
    setMode(target, 'Unit', 'value');
    setType(target, 'Unit', 'organization');
    setMode(target, 'Coordinates', 'point');
    await settle();

    const pair = target.querySelector('[aria-label="How Name and Unit are joined"]');
    expect(pair).toBeTruthy();
    // The registry's own readings, in the words it wrote them in.
    expect(options(pair)).toEqual([
      'Not joined', 'Name is a member of Unit', 'Name owns Unit',
    ]);
    // A person and a point have no verb between them, so that pair is absent entirely.
    expect(target.querySelector('[aria-label="How Name and Coordinates are joined"]')).toBeFalsy();
  });

  it('fills in a pair the vocabulary leaves no choice about', async () => {
    onpreview.mockResolvedValue({ entities: [], joins: [] });
    const target = screen();
    await settle();
    // A structure is sited at its ground and nothing else, so asking the analyst to confirm
    // the only possible answer is asking nothing. One click on "Not joined" takes it off.
    setMode(target, 'Name', 'row');
    setType(target, 'Name', 'structure');
    setMode(target, 'Coordinates', 'point');
    await settle();

    const pair = target.querySelector('[aria-label="How Name and Coordinates are joined"]');
    expect(options(pair)).toEqual(['Not joined', 'Name is sited at Coordinates']);
    expect(pair.value).toBe('sited-at:out');

    press(target, 'Preview');
    await settle();
    expect(onpreview).toHaveBeenCalledWith(
      expect.objectContaining({
        joins: [{ from: 'Name', to: 'Coordinates', verb: 'sited-at' }],
      }),
    );

    pair.value = '';
    pair.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    press(target, 'Preview');
    await settle();
    expect(onpreview).toHaveBeenLastCalledWith(expect.objectContaining({ joins: [] }));
  });

  it('reads the inverse from the same side, and flips the edge instead', async () => {
    onpreview.mockResolvedValue({ entities: [], joins: [] });
    const target = screen();
    await settle();
    // The unit is the subject this time, so the only legal verb runs the other way: a
    // person is a member of an organization, never the reverse.
    setMode(target, 'Unit', 'row');
    setType(target, 'Unit', 'organization');
    setMode(target, 'Name', 'value');
    setType(target, 'Name', 'person');
    await settle();

    const pair = target.querySelector('[aria-label="How Unit and Name are joined"]');
    expect(options(pair)).toEqual([
      'Not joined', 'Unit has member Name', 'Unit is owned by Name',
    ]);

    pair.value = 'member-of:in';
    pair.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    press(target, 'Preview');
    await settle();
    // Read on the unit's side, drawn from the person: the reading settles the direction and
    // the analyst is never asked which way an arrow points.
    expect(onpreview).toHaveBeenCalledWith(
      expect.objectContaining({ joins: [{ from: 'Name', to: 'Unit', verb: 'member-of' }] }),
    );
  });

  it('carries the picked reading as an ordered join', async () => {
    onpreview.mockResolvedValue({ entities: [], joins: [] });
    const target = screen();
    await settle();
    setMode(target, 'Name', 'row');
    setType(target, 'Name', 'person');
    setMode(target, 'Unit', 'value');
    setType(target, 'Unit', 'organization');
    await settle();

    const pair = target.querySelector('[aria-label="How Name and Unit are joined"]');
    pair.value = 'member-of:out';
    pair.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    press(target, 'Preview');
    await settle();

    expect(onpreview).toHaveBeenCalledWith(
      expect.objectContaining({
        joins: [{ from: 'Name', to: 'Unit', verb: 'member-of' }],
      }),
    );
  });

  it('offers no press that writes until the plan has been read', async () => {
    const target = screen();
    await settle();
    setMode(target, 'Name', 'row');
    await settle();
    expect(labels(target)).toContain('Preview');
    expect(labels(target).some((label) => label.startsWith('Send '))).toBe(false);
  });

  it('counts both layers on the button, so the press is not a leap', async () => {
    onpreview.mockResolvedValue({
      entities: [
        { mode: 'row', column: 'Name', counts: { make: 2, join: 1, update: 0, skip: 1, error: 0 }, rows: [] },
      ],
      joins: [{ from: 'Name', to: 'Unit', verb: 'member-of', label: 'is a member of', rows: 3, blocked: [] }],
    });
    const target = screen();
    await settle();
    setMode(target, 'Name', 'row');
    await settle();
    press(target, 'Preview');
    await settle();
    expect(labels(target)).toContain('Send 6');
  });

  it('shows a row whose end is missing with its reason', async () => {
    onpreview.mockResolvedValue({
      entities: [
        {
          mode: 'value', column: 'Unit',
          counts: { make: 0, join: 0, update: 0, skip: 1, error: 0 },
          rows: [{
            key: '3rd Brigade', value: '3rd Brigade', action: 'skip',
            reason: 'the case holds 2 of this name',
            candidates: [{ id: 'e1', label: '3rd Brigade' }, { id: 'e2', label: '3rd Brigade' }],
          }],
        },
      ],
      joins: [{
        from: 'Name', to: 'Unit', verb: 'member-of', label: 'is a member of',
        rows: 0, blocked: [{ key: 'r1', reason: 'the case holds 2 of this name' }],
      }],
    });
    const target = screen();
    await settle();
    setMode(target, 'Unit', 'value');
    await settle();
    press(target, 'Preview');
    await settle();

    expect(flat(target)).toContain('the case holds 2 of this name');
    expect(flat(target)).toContain('1 without an end');
    // And the ambiguity is answerable here rather than only reportable.
    expect(target.querySelector('[aria-label="Attach 3rd Brigade to something the case holds"]'))
      .toBeTruthy();
  });
});
