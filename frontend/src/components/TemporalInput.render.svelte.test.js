// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** The full editor's date and time, typed as the clock of the place it happened at. */

const get = vi.fn(async (url) => {
  const lon = Number(new URL(url, 'http://x').searchParams.get('lon'));
  return { name: lon > 20 ? 'Europe/Kyiv' : 'Europe/Lisbon' };
});
vi.mock('../lib/api.js', () => ({ api: { get } }));
vi.mock('../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case-t' } } }));

const { default: TemporalInput } = await import('./TemporalInput.svelte');
const { forgetZones } = await import('../lib/localZone.js');
const { forgetAxisZone, noteAxisZone } = await import('../lib/caseAxis.svelte.js');

const KHARKIV = { id: 'k', type: 'place', label: 'Kharkiv', attrs: { lat: 49.99, lon: 36.23 } };
const LISBON = { id: 'p', type: 'place', label: 'Lisbon', attrs: { lat: 38.72, lon: -9.14 } };

let live = null;
let target = null;
let changes = [];
let zoneChanges = [];

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  changes = [];
  zoneChanges = [];
  // The editor hands every change back as the value, as TemporalClaimEditor does.
  const held = $state({ value: props.value ?? '', zone: props.zone ?? null });
  live = mount(TemporalInput, {
    target,
    props: {
      id: 'when',
      places: props.places,
      get value() {
        return held.value;
      },
      onchange: (value) => {
        changes.push(value);
        held.value = value;
      },
      get zone() {
        return held.zone;
      },
      onzonechange: props.zoned
        ? (zone) => {
          zoneChanges.push(zone);
          held.zone = zone;
        }
        : null,
    },
  });
  await settle();
}

function set(element, value, event = 'input') {
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true }));
  flushSync();
}

const format = () => target.querySelector('select[aria-label="Date format"]');
const datetime = () => target.querySelector('input[type="datetime-local"]');
const dateInput = () => target.querySelector('input.date-value');
const clock = () => target.querySelector('.clock-trigger');
const clockSays = () => clock()?.getAttribute('aria-label');

/** Open the Clock and press the row whose name is `words`, searching for it first. */
function pick(words, search = '') {
  clock().click();
  flushSync();
  if (search) set(document.querySelector('.clock-menu .search-input'), search);
  const rows = [...document.querySelectorAll('.clock-menu .rows > button')];
  const row = rows.find((button) => button.querySelector('span').textContent === words);
  if (!row) throw new Error(`no ${words} among ${rows.map((button) => button.textContent).join(', ')}`);
  row.click();
  flushSync();
}

function offered() {
  clock().click();
  flushSync();
  const names = [...document.querySelectorAll('.clock-menu .rows > button span')].map((span) => span.textContent);
  clock().click();
  flushSync();
  return names;
}

beforeEach(() => {
  forgetZones();
  get.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('a time at a placed claim', () => {
  it('is read on the place clock while none is picked, with that day’s offset', async () => {
    await open({ places: [KHARKIV] });
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();

    expect(changes.at(-1)).toBe('2026-08-11T17:05:00+03:00');
    expect(clockSays()).toBe('Clock: Kharkiv UTC+03:00');
    expect(target.textContent).toContain('11 Aug 2026, 17:05:00 Europe/Kyiv (UTC+03:00)');

    set(datetime(), '2026-01-11T17:05');
    await settle();
    expect(changes.at(-1)).toBe('2026-01-11T17:05:00+02:00');
  });

  it('keeps a clock the analyst picked, an unknown one included', async () => {
    await open({ places: [KHARKIV] });
    set(format(), 'timestamp', 'change');
    pick('Clock unknown');
    set(datetime(), '2026-08-11T17:05');
    await settle();
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00');
    expect(clockSays()).toBe('Clock: Clock unknown');
  });

  it('never rewrites a stored time because the editor was opened', async () => {
    await open({ places: [KHARKIV], value: '2026-08-11T17:05:00' });
    await settle();
    expect(changes).toEqual([]);
    expect(clockSays()).toBe('Clock: Clock unknown');
  });

  it('reads on UTC when the places disagree, and offers each of them', async () => {
    await open({ places: [KHARKIV, LISBON] });
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();

    expect(changes.at(-1)).toBe('2026-08-11T17:05:00Z');
    expect(offered()).toEqual(expect.arrayContaining(['Local at Kharkiv', 'Local at Lisbon', 'UTC', 'Clock unknown']));
    pick('Local at Lisbon');
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00+01:00');
  });

  it('reads a value with no place on the case’s clock', async () => {
    noteAxisZone('case-t', 'Asia/Aden');
    try {
      await open({ places: [], zoned: true });
      set(dateInput(), '2026-09-10');
      await settle();
      expect(zoneChanges.at(-1)).toBe('Asia/Aden');
      set(format(), 'timestamp', 'change');
      set(datetime(), '2026-09-10T08:00');
      await settle();
      expect(changes.at(-1)).toBe('2026-09-10T08:00:00+03:00');
    } finally {
      forgetAxisZone();
    }
  });

  it('reads a time with no place on UTC while the case has no clock, and says so', async () => {
    await open({ places: [] });
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00Z');
    expect(clockSays()).toBe('Clock: UTC');
  });

  it('keeps a written offset until another clock is picked', async () => {
    await open({ places: [], value: '2026-08-11T17:05:00+04:30' });
    expect(clockSays()).toBe('Clock: UTC+04:30');
    pick('Tokyo', 'tokyo');
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00+09:00');
  });
});

describe('the day a date is', () => {
  it('reads a day typed for a place as that place\'s day, and says so', async () => {
    await open({ places: [KHARKIV], zoned: true });
    set(dateInput(), '2024-03-12');
    await settle();

    expect(changes.at(-1)).toBe('2024-03-12');
    expect(zoneChanges.at(-1)).toBe('Europe/Kyiv');
    expect(clockSays()).toBe('Clock: Kharkiv UTC+02:00');
    expect(target.textContent).toContain('12 Mar 2024 (Europe/Kyiv)');

    pick('UTC');
    expect(zoneChanges.at(-1)).toBe(null);
    expect(clockSays()).toBe('Clock: UTC');
  });

  it('gives a day any zone in the world, with no place tied to it', async () => {
    await open({ places: [], zoned: true });
    set(dateInput(), '2026-09-10');
    await settle();
    expect(clockSays()).toBe('Clock: UTC');

    pick('Tokyo', 'tokyo');
    expect(zoneChanges.at(-1)).toBe('Asia/Tokyo');
    expect(clockSays()).toBe('Clock: Tokyo UTC+09:00');
    expect(target.textContent).toContain('10 Sep 2026 (Asia/Tokyo)');
  });

  it('opens a stored day on its stated zone without re-reading it', async () => {
    await open({ places: [], value: '2024-03-12', zone: 'Asia/Tokyo', zoned: true });
    expect(changes).toEqual([]);
    expect(zoneChanges).toEqual([]);
    expect(clockSays()).toBe('Clock: Tokyo UTC+09:00');
  });

  it('opens a local time stated in a zone on that clock, and leaves it as written', async () => {
    await open({ places: [], value: '2024-07-12T14:30:00', zone: 'Europe/Kyiv', zoned: true });
    expect(changes).toEqual([]);
    expect(clockSays()).toBe('Clock: Kyiv UTC+03:00');
  });

  it('carries the clock from a day to a time when the format changes', async () => {
    await open({ places: [], zoned: true });
    set(dateInput(), '2026-09-10');
    await settle();
    pick('Tokyo', 'tokyo');
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-09-10T08:00');
    await settle();
    expect(changes.at(-1)).toBe('2026-09-10T08:00:00+09:00');
  });

  it('has no clock row for a date as a bare field, and one for a time', async () => {
    await open({ places: [KHARKIV], value: '2024-03-12' });
    expect(clock()).toBeNull();
    set(format(), 'timestamp', 'change');
    expect(clock()).not.toBeNull();
  });
});
