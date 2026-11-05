// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * From the case, as the analyst meets it: the dialog opens on every day the case's
 * geolocations cover with the count said, follows the period and the reading, and
 * Create hands over the note the count describes.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api.js', () => ({ api: { get, post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() } }));

const { noteAxisZone, forgetAxisZone } = await import('../../lib/caseAxis.svelte.js');
const { FROM_CASE_LOOK } = await import('../../lib/notes/fromCase.js');
const { default: FromCaseDialog } = await import('./FromCaseDialog.svelte');

const ITEM = {
  id: 'pr1', type: 'proof', label: 'Strike on the depot', picture: true, media_kind: null,
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
  const by = query.get('by');
  const from = query.get('from') ?? '';
  return answers({ by, from, to: query.get('to') ?? '', zone: query.get('zone') });
}

async function settle(ms = 260) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flushSync();
}

async function open(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  component = mount(FromCaseDialog, { target, props: { caseId: 'case-a', taken: [], oncreate, onclose, ...props } });
  await settle();
}

const dialog = () => document.body.querySelector('[role="dialog"]');
const said = () => dialog().querySelector('[role="status"]').textContent.trim();
const button = (words) => [...dialog().querySelectorAll('button')].find((one) => one.textContent.trim() === words);
const fromCalls = () => get.mock.calls.map(([url]) => url).filter((url) => url.includes('/notes/from-case'));

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

describe('From the case', () => {
  it('opens on every day the geolocations cover, on the case clock, and says the count', async () => {
    await open();
    expect(fromCalls()[0]).toBe('/api/cases/case-a/notes/from-case?by=shown&zone=Europe%2FKyiv');
    expect(dialog().querySelector('[aria-label="First day"]').textContent).toContain('2026-03-01');
    expect(dialog().querySelector('[aria-label="Last day"]').textContent).toContain('2026-03-14');
    expect(dialog().textContent).toContain('Days on the case’s clock: Kyiv (UTC+02:00)');
    expect(said()).toBe('34 geolocations. 2 more have no date of their own.');
    // the whole span counts the same as no bound: it is not read twice
    expect(fromCalls()).toHaveLength(1);
    expect(button('Create').disabled).toBe(false);
  });

  it('reads again as the reading changes, on the days that reading covers until a day is picked', async () => {
    await open();
    button('When they were geolocated').click();
    await settle();
    expect(fromCalls().at(-1)).toBe('/api/cases/case-a/notes/from-case?by=geolocated&zone=Europe%2FKyiv');
    expect(dialog().querySelector('[aria-label="First day"]').textContent).toContain('2026-03-15');
    expect(said()).toBe('34 geolocations.');

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

  it('creates the note the count describes, under a free name, as a report', async () => {
    await open({ taken: ['Geolocations, 1–14 March 2026'] });
    button('A table').click();
    flushSync();
    button('Create').click();
    await settle(0);
    expect(oncreate).toHaveBeenCalledTimes(1);
    const [start] = oncreate.mock.calls[0];
    expect(start.name).toBe('Geolocations, 1–14 March 2026 2');
    expect(start.look).toEqual(FROM_CASE_LOOK);
    expect(start.body.startsWith('# Geolocations, 1–14 March 2026 2\n')).toBe(true);
    expect(start.body).toContain('| 12 March 2026 | [[entity:pl1|Fuel depot]] | 48.12345, 37.12345 |');
  });

  it('says when the case holds no geolocation, and has nothing to create', async () => {
    answers = () => ({ items: [], total: 0, undated: 0, first: null, last: null, limit: 200 });
    await open();
    expect(said()).toBe('This case holds no geolocation yet.');
    expect(button('Create').disabled).toBe(true);
    button('Cancel').click();
    expect(onclose).toHaveBeenCalled();
  });
});
