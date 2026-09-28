// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** The full editor's date and time, typed as the clock of the place it happened at. */

const get = vi.fn(async (url) => {
  const lon = Number(new URL(url, 'http://x').searchParams.get('lon'));
  return { name: lon > 20 ? 'Europe/Kyiv' : 'Europe/Lisbon' };
});
vi.mock('../lib/api.js', () => ({ api: { get } }));

const { default: TemporalInput } = await import('./TemporalInput.svelte');
const { forgetZones } = await import('../lib/localZone.js');

const KHARKIV = { id: 'k', type: 'place', label: 'Kharkiv', attrs: { lat: 49.99, lon: 36.23 } };
const LISBON = { id: 'p', type: 'place', label: 'Lisbon', attrs: { lat: 38.72, lon: -9.14 } };

let live = null;
let target = null;
let changes = [];

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  changes = [];
  // The editor hands every change back as the value, as TemporalClaimEditor does.
  const held = $state({ value: props.value ?? '' });
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
const zone = () => target.querySelector('select[aria-label="Timezone"]');
const datetime = () => target.querySelector('input[type="datetime-local"]');

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
  it('is read on the place clock while no zone is chosen, with that day’s offset', async () => {
    await open({ places: [KHARKIV] });
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();

    expect(changes.at(-1)).toBe('2026-08-11T17:05:00+03:00');
    expect(zone().value).toBe('place:Europe/Kyiv');
    expect(target.textContent).toContain('17:05 at Kharkiv (Europe/Kyiv, UTC+03:00)');

    set(datetime(), '2026-01-11T17:05');
    await settle();
    expect(changes.at(-1)).toBe('2026-01-11T17:05:00+02:00');
  });

  it('keeps a zone the analyst chose, Unknown included', async () => {
    await open({ places: [KHARKIV] });
    set(format(), 'timestamp', 'change');
    set(zone(), 'local', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00');
  });

  it('never rewrites a stored time because the editor was opened', async () => {
    await open({ places: [KHARKIV], value: '2026-08-11T17:05:00' });
    await settle();
    expect(changes).toEqual([]);
    expect(zone().value).toBe('local');
  });

  it('offers each zone when the places disagree, and takes none', async () => {
    await open({ places: [KHARKIV, LISBON] });
    set(format(), 'timestamp', 'change');
    set(datetime(), '2026-08-11T17:05');
    await settle();

    expect(changes.at(-1)).toBe('2026-08-11T17:05:00');
    const offered = [...zone().options].map((option) => option.textContent.trim());
    expect(offered).toContain('Local at Kharkiv');
    expect(offered).toContain('Local at Lisbon');
    set(zone(), 'place:Europe/Lisbon', 'change');
    expect(changes.at(-1)).toBe('2026-08-11T17:05:00+01:00');
  });
});
