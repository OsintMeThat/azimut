// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeInterval, formatTemporalValue } from './timeline.js';
import {
  isNoteKey, noteDatesFor, noteEntityFor, noteHere, offerNote, offerPuts, pairOffers, placeOf, putsFor, withdrawNote,
} from './noteHere.svelte.js';

const relation = (place, { type = 'located-at', status = 'confirmed', direction = 'out' } = {}) => ({
  entity: { id: place, type: 'place', label: place, attrs: {}, provenance: { status: 'confirmed' } },
  link: { type, provenance: { status } },
  direction,
});

beforeEach(() => {
  for (const tool of Object.keys(noteHere.byTool)) withdrawNote(tool);
});

describe('what a tool offers the Add event bar', () => {
  it('keeps each tool’s selection to that tool', () => {
    offerNote('media', { id: 'm1', label: 'VID_0312', type: 'media', attrs: { path: 'a.mp4' } });
    offerNote('satellite', { id: 'p1', label: 'Crossroads', type: 'place' });
    expect(noteEntityFor('media')).toEqual({ id: 'm1', label: 'VID_0312', type: 'media', attrs: { path: 'a.mp4' } });
    expect(noteEntityFor('satellite').id).toBe('p1');
    expect(noteEntityFor('proof')).toBeNull();
  });

  it('takes it back when nothing is selected or the tool goes', () => {
    offerNote('media', { id: 'm1', type: 'media' });
    offerNote('media', null);
    expect(noteEntityFor('media')).toBeNull();
    offerNote('media', { id: 'm1', type: 'media' });
    withdrawNote('media');
    expect(noteEntityFor('media')).toBeNull();
  });
});

describe('what a tool can put in the pinned note', () => {
  const view = { id: 'view', label: 'This view', hint: 'The map as it is', icon: 'image', picture: true, put: async () => ({ text: 'x' }) };

  it('is read when asked, from the tool that offered it', () => {
    let reads = 0;
    offerPuts('satellite', () => { reads += 1; return [view]; });
    expect(reads).toBe(0);
    expect(putsFor('satellite')).toEqual([view]);
    expect(reads).toBe(1);
    expect(putsFor('compare')).toEqual([]);
  });

  it('keeps only offers that can be put', () => {
    offerPuts('sheet', [view, { id: 'half', label: 'No put' }, null, { label: 'No id', put: async () => ({}) }]);
    expect(putsFor('sheet').map((offer) => offer.id)).toEqual(['view']);
  });

  it('goes with the tool, and a failing reader offers nothing', () => {
    offerPuts('timeline', [view]);
    withdrawNote('timeline');
    expect(putsFor('timeline')).toEqual([]);
    offerPuts('timeline', () => { throw new Error('not ready'); });
    expect(putsFor('timeline')).toEqual([]);
    offerPuts('timeline', null);
    expect(putsFor('timeline')).toEqual([]);
  });
});

describe('the place a file is seated at', () => {
  it('is its one confirmed place', () => {
    expect(placeOf({ relations: [relation('p1')] })).toMatchObject({ id: 'p1', slot: 'at' });
    expect(placeOf({ relations: [relation('p1', { type: 'depicts' }), relation('p1')] })).toMatchObject({ id: 'p1' });
  });

  it('is nothing when there are two, or one a tool only suggested', () => {
    // seating a suggestion would confirm it without the analyst having decided it
    expect(placeOf({ relations: [relation('p1'), relation('p2')] })).toBeNull();
    expect(placeOf({ relations: [relation('p1', { status: 'suggested' })] })).toBeNull();
    expect(placeOf({ relations: [relation('p1', { direction: 'in' })] })).toBeNull();
    expect(placeOf(null)).toBeNull();
  });
});

describe('the shortcut', () => {
  const key = (init, target = document.body) => ({ altKey: true, code: 'KeyN', target, ...init });

  it('is Alt+N, whatever letter the layout types for it', () => {
    expect(isNoteKey(key({ key: '˜' }))).toBe(true);
    expect(isNoteKey(key({ ctrlKey: true }))).toBe(false);
    expect(isNoteKey(key({ metaKey: true }))).toBe(false);
    expect(isNoteKey(key({ altKey: false }))).toBe(false);
    expect(isNoteKey(key({ code: 'KeyM' }))).toBe(false);
  });

  it('never fires from inside a field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(isNoteKey(key({}, input))).toBe(false);
    input.remove();
  });
});

describe('the dates a place offers', () => {
  const label = (value) => formatTemporalValue(value).label;

  it('offers a pair its span first, then each picture', () => {
    const offers = pairOffers(
      { value: '2026-03-11', exact: true },
      { value: '2026-03-19', exact: true },
      { interval: changeInterval, label }
    );
    expect(offers.map((offer) => [offer.value, offer.words])).toEqual([
      ['2026-03-11/2026-03-19', 'between 11 Mar 2026 and 19 Mar 2026'],
      ['2026-03-11', 'A 11 Mar 2026'],
      ['2026-03-19', 'B 19 Mar 2026'],
    ]);
  });

  it('marks a release date as an estimate', () => {
    const [between, first] = pairOffers(
      { value: '2024-05-03', exact: false },
      { value: '2026-09-02', exact: true },
      { interval: changeInterval, label }
    );
    expect(first).toMatchObject({ value: '2024-05-03~', words: 'A ~3 May 2024' });
    expect(between.value).toBe('2024-05-03~/2026-09-02');
  });

  it('reads a tool’s dates when the bar asks, not when the tool moves', () => {
    let calls = 0;
    offerNote('compare', null, { dates: () => { calls += 1; return [{ kind: 'between', value: '2026-03-11/2026-03-19' }]; } });
    expect(calls).toBe(0);
    expect(noteDatesFor('compare')).toHaveLength(1);
    expect(calls).toBe(1);
    withdrawNote('compare');
    expect(noteDatesFor('compare')).toEqual([]);
  });
});

describe('a confirmed place, as the server reads one', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const { cases } = JSON.parse(readFileSync(join(here, '../../../tests/fixtures/place_edges.json'), 'utf8'));

  // `satellite.road_status` reads the same fixture (tests/test_note_from_case.py)
  it.each(cases)('an edge %s to a place %s is confirmed: %s (%s)', (link, place, confirmed) => {
    const chain = { relations: [{
      direction: 'out',
      link: { type: 'located-at', ...(link ? { provenance: { status: link } } : {}) },
      entity: { id: 'pl1', type: 'place', label: 'Quay', ...(place ? { provenance: { status: place } } : {}) },
    }] };
    expect(placeOf(chain) !== null).toBe(confirmed);
  });
});
