import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import PlaceSearch from './PlaceSearch.svelte';

const source = readFileSync(new URL('./PlaceSearch.svelte', import.meta.url), 'utf8');

const props = { value: '', savedRows: [], centre: { lat: 50, lon: 30 }, onpick() {}, onsubmit() {} };

describe('the bar itself', () => {
  it('renders a combobox with the Go button beside it', () => {
    const { body } = render(PlaceSearch, { props });
    expect(body).toContain('role="combobox"');
    expect(body).toContain('aria-autocomplete="list"');
    expect(body).toContain('Go');
  });

  it('still names both things it accepts', () => {
    const { body } = render(PlaceSearch, { props });
    expect(body).toContain('A place, or 50.4501, 30.5234');
    expect(body).toContain('decimal, DMS, MGRS, plus code');
  });

  it('shows no list until there is something to list', () => {
    const { body } = render(PlaceSearch, { props });
    expect(body).not.toContain('role="listbox"');
  });
});

describe('what typing costs', () => {
  it('asks the offline route on the keystroke and the geocoder only after a pause', () => {
    expect(source).toContain('const LOCAL_DELAY = 120');
    expect(source).toContain('const REMOTE_DELAY = 650');
    expect(source).toContain('setTimeout(() => askLocal(query), LOCAL_DELAY)');
    expect(source).toContain('setTimeout(() => askRemote(query), REMOTE_DELAY)');
  });

  it('keeps the geocoder out of short queries entirely', () => {
    expect(source).toContain('query.length >= REMOTE_MIN_CHARS');
  });

  it('cancels the pending calls on every keystroke', () => {
    expect(source).toContain('clearTimeout(localTimer)');
    expect(source).toContain('clearTimeout(remoteTimer)');
  });

  it('drops an answer to a query that is no longer what is typed', () => {
    expect(source).toContain('if (localFor !== query) return');
    expect(source).toContain('if (remoteFor !== query) return');
  });

  it('leaves the list alone when the geocoder request was dropped rather than answered', () => {
    expect(source).toContain('if (!body.busy) places = body.places ?? []');
  });

  it('survives a failed suggestion without breaking the bar', () => {
    expect(source).toContain('/* the bar still works without suggestions */');
  });
});

describe('choosing', () => {
  it('walks the list with the arrows and closes on Escape', () => {
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'Escape'");
  });

  it('falls back to the old behaviour when Enter is pressed with nothing highlighted', () => {
    expect(source).toContain('if (at >= 0 && rows[at]) choose(rows[at]);');
    expect(source).toContain('onsubmit(value)');
  });

  it('remembers what was picked', () => {
    expect(source).toContain('recents = pushRecent(item)');
  });
});
