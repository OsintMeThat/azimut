import { describe, expect, it } from 'vitest';
import {
  FROM_CASE_LOOK, FROM_CASE_SAMPLE, countWords, dayWords, fromCaseNote, periodTitle, spanWords, whenWords,
} from './fromCase.js';

const PROOF = {
  id: 'pr1', type: 'proof', label: 'Strike on the depot', picture: true, media_kind: null,
  description: 'Smoke over the fuel tanks,\n  seen from the east.',
  sources: [{ id: 'v1', label: 'Depot video', media_kind: 'video' }],
  points: [{ lat: 48.12345, lon: 37.12345, place: { id: 'pl1', label: 'Fuel depot', coords: false } }],
  shown: { kind: 'taken', raw: '2026-03-12T14:05:00+02:00', tz: 'Europe/Kyiv', day: '2026-03-12', last: '2026-03-12' },
  geolocated: { kind: 'geolocated', raw: '2026-03-14T09:00:00Z', tz: null, day: '2026-03-14', last: '2026-03-14' },
  day: '2026-03-12',
};
const PHOTO = {
  id: 'm1', type: 'media', label: 'Convoy | bridge', picture: true, media_kind: 'image',
  description: '',
  sources: [{ id: 'm1', label: 'Convoy | bridge', media_kind: 'image' }],
  points: [{ lat: 48.1302, lon: 37.1421, place: { id: 'pl2', label: '48.13020, 37.14210', coords: true } }],
  shown: { kind: 'published', raw: '2026-03-13', tz: null, day: '2026-03-13', last: '2026-03-13' },
  geolocated: { kind: 'geolocated', raw: '2026-03-15T22:30:00Z', tz: null, day: '2026-03-16', last: '2026-03-16' },
  day: '2026-03-13',
};

describe('the period in words', () => {
  it('writes a day, a run inside a month, across months and across years', () => {
    expect(dayWords('2026-03-01')).toBe('1 March 2026');
    expect(spanWords('2026-03-12', '2026-03-12')).toBe('12 March 2026');
    expect(spanWords('2026-03-01', '2026-03-14')).toBe('1–14 March 2026');
    expect(spanWords('2026-02-28', '2026-03-03')).toBe('28 February – 3 March 2026');
    expect(spanWords('2025-12-30', '2026-01-02')).toBe('30 December 2025 – 2 January 2026');
  });

  it('names the note by the period and by what it was read by', () => {
    expect(periodTitle('2026-03-01', '2026-03-14')).toBe('Geolocations, 1–14 March 2026');
    expect(periodTitle('2026-03-01', '2026-03-14', 'geolocated')).toBe('Geolocated 1–14 March 2026');
  });
});

describe('when a geolocation is from', () => {
  it('reads a time on the zone it was stated in, else on the case clock', () => {
    expect(whenWords(PROOF.shown, 'UTC')).toBe('12 March 2026, 14:05 (Europe/Kyiv)');
    expect(whenWords({ kind: 'taken', raw: '2026-03-12T21:30:00Z', tz: null }, 'Europe/Kyiv'))
      .toBe('12 March 2026, 23:30 (Europe/Kyiv)');
    expect(whenWords({ kind: 'taken', raw: '2026-03-12T21:30:00Z', tz: null }, 'UTC')).toBe('12 March 2026, 21:30 UTC');
  });

  it('says which date it is: posted, the file, the camera clock, the imagery', () => {
    expect(whenWords(PHOTO.shown)).toBe('posted 13 March 2026');
    expect(whenWords({ kind: 'captured', raw: '2026-03-08T07:30:00', tz: null })).toBe('8 March 2026, 07:30, camera clock');
    expect(whenWords({ kind: 'captured', raw: '2026-03-08T07:30:00.000000Z', tz: null }, 'Europe/Kyiv'))
      .toBe('8 March 2026, 09:30 (Europe/Kyiv), from the file');
    expect(whenWords({ kind: 'imagery', raw: '2026-03-02~', tz: null })).toBe('imagery of about 2 March 2026');
    expect(whenWords({ kind: 'taken', raw: '2026-03-20/2026-03-22', tz: null }))
      .toBe('between 20 March 2026 and 22 March 2026');
    expect(whenWords(null)).toBe('');
  });
});

describe('the note', () => {
  it('writes a figure each: the proof as the picture, where, when and the source', () => {
    const { title, body } = fromCaseNote({ items: [PROOF, PHOTO], total: 2 },
      { from: '2026-03-01', to: '2026-03-14', zone: 'Europe/Kyiv' });
    expect(title).toBe('Geolocations, 1–14 March 2026');
    expect(body).toBe([
      '# Geolocations, 1–14 March 2026',
      '',
      '## Summary',
      '',
      '<!--? What these geolocations show, in two or three sentences. -->',
      '',
      '## Findings',
      '',
      '### Strike on the depot',
      '',
      '[[media:pr1|Strike on the depot]]{width=75%}',
      '',
      '- Description: Smoke over the fuel tanks, seen from the east.',
      '- Where: [[entity:pl1|Fuel depot]] 48.12345, 37.12345',
      '- When: 12 March 2026, 14:05 (Europe/Kyiv)',
      '- Source: [[entity:v1|Depot video]]',
      '',
      '<!--? What it shows, and how it was matched. -->',
      '',
      '### Convoy | bridge',
      '',
      '[[media:m1|Convoy | bridge]]',
      '',
      // the line is there with nothing after it, a slot to fill in
      '- Description:',
      '- Where: [[entity:pl2|48.13020, 37.14210]]',
      '- When: posted 13 March 2026',
      '- Source: [[entity:m1|Convoy | bridge]]',
      '',
      '<!--? What it shows, and how it was matched. -->',
      '',
      '## Ruled out',
      '',
      '<!--? What was checked and did not hold. -->',
      '',
      '## Limits',
      '',
      '<!--? Imagery dates, gaps, what could not be confirmed. -->',
      '',
    ].join('\n'));
  });

  it('writes a table instead: day, place, coordinates, description and source, one row each', () => {
    const { body } = fromCaseNote({ items: [PROOF, PHOTO], total: 2 },
      { from: '2026-03-01', to: '2026-03-14', layout: 'table' });
    expect(body).toContain([
      '## Findings',
      '',
      '| Day | Place | Coordinates | Description | Source |',
      '| --- | --- | --- | --- | --- |',
      '| 12 March 2026 | [[entity:pl1|Fuel depot]] | 48.12345, 37.12345 | Smoke over the fuel tanks, seen from the east. | [[entity:pr1|Strike on the depot]], [[entity:v1|Depot video]] |',
      // a name's own `|` is kept out of the table's way
      // a place named by its own coordinates is not said twice, and no description leaves its cell empty
      '| 13 March 2026 (posted) |  | 48.13020, 37.14210 |  | [[entity:m1|Convoy bridge]] |',
      '',
      '## Ruled out',
    ].join('\n'));
    expect(body).not.toContain('### ');
  });

  it('writes a description in a table cell on one line, its pipes escaped', () => {
    const piped = { ...PHOTO, description: 'Left | right\nof the road' };
    const { body } = fromCaseNote({ items: [piped], total: 1 }, { layout: 'table' });
    expect(body).toContain('| 48.13020, 37.14210 | Left \\| right of the road |');
  });

  it('opens each figure on its description, the line there even when the item has none', () => {
    const { body } = fromCaseNote({ items: [PROOF, { ...PHOTO, description: undefined }], total: 2 });
    const lists = body.split('### ').slice(1).map((one) => one.split('\n').filter((line) => line.startsWith('- ')));
    expect(lists[0][0]).toBe('- Description: Smoke over the fuel tanks, seen from the east.');
    expect(lists[1][0]).toBe('- Description:');
    // the hint after the list stays
    expect(body).toContain('- Source: [[entity:v1|Depot video]]\n\n<!--? What it shows, and how it was matched. -->');
  });

  it('dates by when they were geolocated when asked, and says so', () => {
    const { title, body } = fromCaseNote({ items: [PROOF], total: 1 }, { from: '2026-03-14', to: '2026-03-16', by: 'geolocated' });
    expect(title).toBe('Geolocated 14–16 March 2026');
    expect(body).toContain('- When: 12 March 2026, 14:05 (Europe/Kyiv)\n- Geolocated: 14 March 2026\n- Source:');
    const table = fromCaseNote({ items: [PHOTO], total: 1 }, { by: 'geolocated', layout: 'table' }).body;
    expect(table).toContain('| Geolocated | Place | Coordinates | Description | Source |');
    expect(table).toContain('| 16 March 2026 |');
  });

  it('names a proof with no picture, leaves what is unknown to fill, and takes the name it is given', () => {
    const bare = { ...PROOF, picture: false, points: [], sources: [], shown: null };
    const { title, body } = fromCaseNote({ items: [bare], total: 1 }, { from: '2026-03-01', to: '2026-03-14', title: 'Geolocations, 1–14 March 2026 2' });
    expect(title).toBe('Geolocations, 1–14 March 2026 2');
    expect(body.startsWith('# Geolocations, 1–14 March 2026 2\n')).toBe(true);
    expect(body).toContain('[[entity:pr1|Strike on the depot]]\n\n- Description: Smoke over the fuel tanks, seen from the east.\n- Where:\n- When:\n- Source:\n');
  });

  it('says the cut when the period holds more than the note', () => {
    const { body } = fromCaseNote({ items: [PROOF], total: 340 }, { from: '2026-03-01', to: '2026-03-14' });
    expect(body).toContain('## Findings\n\n*Only the first 1 of 340 geolocations. Narrow the period for the rest.*\n\n### Strike');
    expect(fromCaseNote({ items: [PROOF], total: 1 }).body).not.toContain('Only the first');
  });

  it('shows a description in the page the tile draws', () => {
    expect(FROM_CASE_SAMPLE).toContain('### Strike on the depot\n\n- Description: ');
    expect(FROM_CASE_SAMPLE.match(/^- Description: /gm)).toHaveLength(2);
  });

  it('prints as a report ending on its sources', () => {
    expect(FROM_CASE_LOOK).toEqual({ style: 'report', sources: 'on' });
  });
});

describe('the count', () => {
  it('says how many, the cut, and what the reading cannot date', () => {
    expect(countWords({ total: 1, undated: 0 })).toBe('1 geolocation.');
    expect(countWords({ total: 34, undated: 0 })).toBe('34 geolocations.');
    expect(countWords({ total: 1240, undated: 0 })).toBe('1,240 geolocations, the note holds the first 200.');
    expect(countWords({ total: 0, undated: 3 })).toBe('No geolocation in these days. 3 more have no date of their own.');
    expect(countWords({ total: 2, undated: 1 }, 'geolocated')).toBe('2 geolocations. 1 more has no day it was placed.');
    expect(countWords(null)).toBe('');
  });
});
