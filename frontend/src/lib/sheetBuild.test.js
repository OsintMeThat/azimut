import { describe, expect, it } from 'vitest';
import { canBuild, columnKinds, proposal } from './sheetBuild.js';

const TEMPLATE = {
  columns: ['_key', 'Title', 'Source media', 'Geolocation proof', 'Coordinates', 'Status', 'Notes'],
  rows: [],
};
const ROLES = {
  roles: {
    'Source media': { kind: 'url' },
    'Geolocation proof': { kind: 'url' },
    Coordinates: { kind: 'latlon' },
    Status: { kind: 'state' },
  },
};

describe('a sheet read as a geolocation index', () => {
  it('takes the declared role over anything the cells look like', () => {
    const kinds = columnKinds(TEMPLATE, ROLES);
    expect(kinds['Source media']).toBe('url');
    expect(kinds.Coordinates).toBe('latlon');
    expect(kinds.Title).toBe('');
  });

  it('reads a sheet nobody has declared roles on yet', () => {
    const table = {
      columns: ['_key', 'What', 'Clip', 'Picture', 'Where'],
      rows: [
        ['r1', 'Bridge', 'https://ex.org/a', 'https://ex.org/b', '48.85, 2.35'],
        ['r2', 'Depot', 'https://ex.org/c', 'https://ex.org/d', '50.45, 30.52'],
      ],
    };
    const kinds = columnKinds(table, {});
    expect(kinds.Clip).toBe('url');
    expect(kinds.Picture).toBe('url');
    expect(kinds.Where).toBe('latlon');
    expect(canBuild(kinds)).toBe(true);
  });

  // The button is the whole of the offer: a sheet that cannot feed a build must not show
  // one, or the analyst presses it to be told what they should have been shown.
  it('is not buildable with one address, or with no point', () => {
    expect(canBuild({ A: 'url', B: 'latlon' })).toBe(false);
    expect(canBuild({ A: 'url', B: 'url' })).toBe(false);
    expect(canBuild({})).toBe(false);
  });

  it('proposes the template s own columns without being told', () => {
    expect(proposal(TEMPLATE, ROLES)).toEqual({
      title: 'Title',
      source: 'Source media',
      proof: 'Geolocation proof',
      point: 'Coordinates',
      note: 'Notes',
      status: 'Status',
    });
  });

  it('tells the two addresses apart by order when their names do not say', () => {
    const table = { columns: ['_key', 'Event', 'First link', 'Second link', 'Point'], rows: [] };
    const meta = {
      roles: {
        'First link': { kind: 'url' },
        'Second link': { kind: 'url' },
        Point: { kind: 'latlon' },
      },
    };
    const picked = proposal(table, meta);
    expect(picked.source).toBe('First link');
    expect(picked.proof).toBe('Second link');
    expect(picked.title).toBe('Event');
  });
});
