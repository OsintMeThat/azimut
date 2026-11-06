// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * New note, as the analyst meets it: the starts as tiles, a title that is only a
 * wish, and *From the case* asking its questions under the tiles and writing the
 * note the count describes.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() } }));
vi.mock('../../lib/notes/thumbs.js', () => ({ templateThumb: vi.fn(async () => 'data:image/png;base64,AAAA') }));

// what is near the view is said at once: every page is seen
class SeenAtOnce {
  constructor(callback) { this.callback = callback; }
  observe(node) { queueMicrotask(() => this.callback([{ target: node, isIntersecting: true }])); }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', SeenAtOnce);

const { noteAxisZone, forgetAxisZone } = await import('../../lib/caseAxis.svelte.js');
const { FROM_CASE_LOOK } = await import('../../lib/notes/fromCase.js');
const { default: NewNoteDialog } = await import('./NewNoteDialog.svelte');

const STARTS = [
  { id: 'blank', name: 'Blank', start: 'Note', note: 'An empty page', body: '', folder: '', look: null },
  { id: 'factcheck', name: 'Fact-check', start: 'Fact-check', note: 'A claim, tested', body: '## Claim\n', folder: '', look: { style: 'brief' } },
  { id: 't:1', name: 'House write-up', start: 'House write-up', note: 'Plain', body: '## House\n', folder: 'Leads', look: null },
];

const ITEM = {
  id: 'pr1', type: 'proof', label: 'Strike on the depot', description: 'Smoke over the tanks.', picture: true, media_kind: null,
  sources: [{ id: 'v1', label: 'Depot video', media_kind: 'video' }],
  points: [{ lat: 48.12345, lon: 37.12345, place: { id: 'pl1', label: 'Fuel depot', coords: false } }],
  shown: { kind: 'taken', raw: '2026-03-12', tz: null, day: '2026-03-12', last: '2026-03-12' },
  geolocated: { kind: 'geolocated', raw: '2026-03-20T09:00:00Z', tz: null, day: '2026-03-20', last: '2026-03-20' },
  day: '2026-03-12',
};

let answers;
let target;
let component;
let oncreate;
let onclose;

function answer(url) {
  const query = new URL(url, 'http://x').searchParams;
  return answers({ by: query.get('by'), from: query.get('from') ?? '' });
}

async function settle(ms = 260) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}

async function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  component = mount(NewNoteDialog, {
    target, props: { caseId: 'case-a', starts: STARTS, folders: ['Leads'], taken: [], oncreate, onclose, ...props },
  });
  await settle(0);
}

const dialog = () => document.body.querySelector('[role="dialog"]');
const tile = (id) => dialog().querySelector(`[role="radio"][data-start="${id}"]`);
const tileIds = () => [...dialog().querySelectorAll('[role="radio"][data-start]')].map((one) => one.dataset.start);
const pickedIds = () => [...dialog().querySelectorAll('[role="radio"][data-start][aria-checked="true"]')].map((one) => one.dataset.start);
const titleField = () => dialog().querySelector('#notebook-note-title');
const said = () => dialog().querySelector('[role="status"]').textContent.trim();
const button = (words) => [...dialog().querySelectorAll('button')].find((one) => one.textContent.trim() === words);
const fromCalls = () => get.mock.calls.map(([url]) => url).filter((url) => url.includes('/notes/from-case'));

function type(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

beforeEach(() => {
  forgetAxisZone();
  noteAxisZone('case-a', 'Europe/Kyiv');
  oncreate = vi.fn(async () => {});
  onclose = vi.fn();
  answers = ({ by, from }) => ({
    items: [ITEM], total: from && from > '2026-03-12' ? 0 : 34, undated: by === 'shown' ? 2 : 0,
    first: by === 'shown' ? '2026-03-01' : '2026-03-15', last: by === 'shown' ? '2026-03-14' : '2026-03-20', limit: 200,
  });
  get.mockImplementation(async (url) => (url.includes('/notes/from-case') ? answer(url) : { items: [] }));
});

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target?.remove();
  vi.clearAllMocks();
});

describe('the starts', () => {
  it('lists the blank page, From the case, then the ready notes and the analyst’s own, as radio buttons', async () => {
    await open();
    expect(dialog().querySelector('[role="radiogroup"]').getAttribute('aria-labelledby')).toBe('notebook-note-start');
    expect(tileIds()).toEqual(['blank', 'from-case', 'factcheck', 't:1']);
    expect(tile('factcheck').textContent).toContain('Fact-check');
    expect(tile('factcheck').textContent).toContain('A claim, tested');
    expect(tile('from-case').textContent).toContain('From the case');
    // every tile shows its first page
    await settle();
    expect(dialog().querySelectorAll('[role="radio"] img')).toHaveLength(4);
    expect(pickedIds()).toEqual(['blank']);
  });

  it('opens on the start asked for, and on the blank page when that is not one', async () => {
    await open({ start: 'factcheck' });
    expect(pickedIds()).toEqual(['factcheck']);
    await unmount(component);
    target.remove();
    await open({ start: 'gone' });
    expect(pickedIds()).toEqual(['blank']);
  });

  it('picks one at a time, by press or by the arrow keys', async () => {
    await open();
    tile('factcheck').click();
    flushSync();
    expect(pickedIds()).toEqual(['factcheck']);

    tile('factcheck').focus();
    press(tile('factcheck'), 'ArrowRight');
    flushSync();
    expect(pickedIds()).toEqual(['t:1']);
    expect(document.activeElement).toBe(tile('t:1'));
    // the ends meet
    press(tile('t:1'), 'ArrowRight');
    flushSync();
    expect(pickedIds()).toEqual(['blank']);
    press(tile('blank'), 'ArrowLeft');
    flushSync();
    expect(pickedIds()).toEqual(['t:1']);
  });

  it('reads nothing from the case until From the case is picked', async () => {
    await open();
    await settle();
    expect(fromCalls()).toHaveLength(0);
    tile('from-case').click();
    await settle();
    expect(fromCalls()).toHaveLength(1);
    tile('blank').click();
    await settle();
    expect(fromCalls()).toHaveLength(1);
  });
});

describe('the title', () => {
  it('shows the name the note would get, free against the notes there, and follows the start', async () => {
    await open({ taken: ['Note', 'Fact-check'] });
    expect(titleField().placeholder).toBe('Note 2');
    tile('factcheck').click();
    flushSync();
    expect(titleField().placeholder).toBe('Fact-check 2');
    tile('t:1').click();
    flushSync();
    expect(titleField().placeholder).toBe('House write-up');
  });

  it('is optional: Enter creates the note under the name shown', async () => {
    await open({ start: 'factcheck', taken: ['Fact-check'] });
    press(titleField(), 'Enter');
    await settle(0);
    expect(oncreate).toHaveBeenCalledWith({ title: 'Fact-check 2', folder: '', body: '## Claim\n', look: { style: 'brief' } });
  });

  it('is kept as typed when there is one', async () => {
    await open({ start: 'factcheck', taken: ['Fact-check'] });
    type(titleField(), '  Quay claim ');
    button('Create').click();
    await settle(0);
    expect(oncreate.mock.calls[0][0].title).toBe('Quay claim');
  });

  it('files a template where it says, and a blank page nowhere', async () => {
    await open();
    tile('t:1').click();
    flushSync();
    button('Create').click();
    await settle(0);
    expect(oncreate.mock.calls[0][0]).toEqual({ title: 'House write-up', folder: 'Leads', body: '## House\n', look: null });
  });
});

describe('creating', () => {
  it('says it is working, makes one note, and is ready again when it fails', async () => {
    let finish;
    oncreate = vi.fn(() => new Promise((resolve, reject) => { finish = reject; }));
    await open();
    button('Create').click();
    flushSync();
    expect(button('Creating…').disabled).toBe(true);
    // a second press while it works makes no second note
    button('Creating…').click();
    press(titleField(), 'Enter');
    expect(oncreate).toHaveBeenCalledTimes(1);
    finish(new Error('no'));
    await settle(0);
    expect(button('Create').disabled).toBe(false);
  });

  it('closes with Cancel', async () => {
    await open();
    button('Cancel').click();
    expect(onclose).toHaveBeenCalled();
    expect(oncreate).not.toHaveBeenCalled();
  });
});

describe('From the case', () => {
  it('asks its questions under the tiles: every day the geolocations cover, on the case clock, and the count', async () => {
    await open({ start: 'from-case' });
    await settle();
    expect(fromCalls()[0]).toBe('/api/cases/case-a/notes/from-case?by=shown&zone=Europe%2FKyiv');
    expect(dialog().querySelector('[aria-label="First day"]').textContent).toContain('2026-03-01');
    expect(dialog().querySelector('[aria-label="Last day"]').textContent).toContain('2026-03-14');
    expect(dialog().textContent).toContain('Days on the case’s clock: Kyiv (UTC+02:00)');
    expect(said()).toBe('34 geolocations. 2 more have no date of their own.');
    // the whole span counts the same as no bound: it is not read twice
    expect(fromCalls()).toHaveLength(1);
    expect(button('Create').disabled).toBe(false);
    // the tiles are still there to pick another start
    expect(tileIds()).toHaveLength(4);
  });

  it('has nothing of it on screen for another start', async () => {
    await open();
    expect(dialog().querySelector('[role="status"]')).toBeNull();
    tile('from-case').click();
    await settle();
    expect(said()).toBe('34 geolocations. 2 more have no date of their own.');
    tile('factcheck').click();
    flushSync();
    expect(dialog().querySelector('[role="status"]')).toBeNull();
    expect(button('Create').disabled).toBe(false);
  });

  it('waits for the count before it can create', async () => {
    await open({ start: 'from-case' });
    expect(said()).toBe('Counting…');
    expect(button('Create').disabled).toBe(true);
    press(titleField(), 'Enter');
    await settle(0);
    expect(oncreate).not.toHaveBeenCalled();
    await settle();
    expect(button('Create').disabled).toBe(false);
  });

  it('reads again as the reading changes, on the days that reading covers until a day is picked', async () => {
    await open({ start: 'from-case' });
    await settle();
    button('When they were geolocated').click();
    await settle();
    expect(fromCalls().at(-1)).toBe('/api/cases/case-a/notes/from-case?by=geolocated&zone=Europe%2FKyiv');
    expect(dialog().querySelector('[aria-label="First day"]').textContent).toContain('2026-03-15');
    expect(said()).toBe('34 geolocations.');
    expect(titleField().placeholder).toBe('Geolocated 15–20 March 2026');

    dialog().querySelector('[aria-label="First day"]').click();
    flushSync();
    dialog().querySelector('button[title="2026-03-18"]').click();
    await settle();
    expect(fromCalls().at(-1)).toBe('/api/cases/case-a/notes/from-case?by=geolocated&zone=Europe%2FKyiv&from=2026-03-18&to=2026-03-20');
    expect(said()).toBe('No geolocation in these days.');
    expect(button('Create').disabled).toBe(true);

    // a picked period stays when the reading changes back
    button('What they show').click();
    await settle();
    expect(fromCalls().at(-1)).toContain('by=shown&zone=Europe%2FKyiv&from=2026-03-18&to=2026-03-20');
  });

  it('keeps the period asked for when another start is picked and From the case comes back', async () => {
    await open({ start: 'from-case' });
    await settle();
    dialog().querySelector('[aria-label="First day"]').click();
    flushSync();
    dialog().querySelector('button[title="2026-03-05"]').click();
    await settle();
    tile('blank').click();
    await settle();
    tile('from-case').click();
    await settle();
    expect(dialog().querySelector('[aria-label="First day"]').textContent).toContain('2026-03-05');
    expect(fromCalls().at(-1)).toContain('from=2026-03-05&to=2026-03-14');
  });

  it('creates the note the count describes, under the period’s free name, as a report, in the folder picked', async () => {
    await open({ start: 'from-case', taken: ['Geolocations, 1–14 March 2026'] });
    await settle();
    expect(titleField().placeholder).toBe('Geolocations, 1–14 March 2026 2');
    button('A table').click();
    flushSync();
    button('Create').click();
    await settle(0);
    expect(oncreate).toHaveBeenCalledTimes(1);
    const [start] = oncreate.mock.calls[0];
    expect(start.title).toBe('Geolocations, 1–14 March 2026 2');
    expect(start.folder).toBe('');
    expect(start.look).toEqual(FROM_CASE_LOOK);
    expect(start.body.startsWith('# Geolocations, 1–14 March 2026 2\n')).toBe(true);
    expect(start.body).toContain('| 12 March 2026 | [[entity:pl1|Fuel depot]] | 48.12345, 37.12345 | Smoke over the tanks. | [[entity:pr1|Strike on the depot]], [[entity:v1|Depot video]] |');
  });

  it('writes the description of each geolocation, and gives the note the title typed', async () => {
    await open({ start: 'from-case' });
    await settle();
    type(titleField(), 'Depot strikes');
    button('Create').click();
    await settle(0);
    const [start] = oncreate.mock.calls[0];
    expect(start.title).toBe('Depot strikes');
    expect(start.body.startsWith('# Depot strikes\n')).toBe(true);
    expect(start.body).toContain('- Description: Smoke over the tanks.\n- Where: [[entity:pl1|Fuel depot]] 48.12345, 37.12345');
  });

  it('says when the case holds no geolocation, and has nothing to create', async () => {
    answers = () => ({ items: [], total: 0, undated: 0, first: null, last: null, limit: 200 });
    await open({ start: 'from-case' });
    await settle();
    expect(said()).toBe('This case holds no geolocation yet.');
    expect(button('Create').disabled).toBe(true);
    // another start is still there to make
    tile('blank').click();
    flushSync();
    expect(button('Create').disabled).toBe(false);
  });
});
