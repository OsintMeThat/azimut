import { describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('./api.js', () => ({ api: { get, post } }));

const {
  MAX_CASE_POINTS,
  MAX_LOOKUPS,
  casePoints,
  geocodeValue,
  linkedRows,
  namesToRead,
  placeCell,
  pointCell,
  pointsToRead,
  reverseValue,
} = await import('./sheetGeo.js');

const TABLE = {
  columns: ['id', 'Place', 'Coordinates'],
  rows: [
    ['r1', 'Kherson, Ukraine', ''],
    ['r2', 'Kherson, Ukraine', ''],
    ['r3', 'Mykolaiv', ''],
    ['r4', 'Kherson, Ukraine', '46.63500, 32.61690'],
    ['r5', '', ''],
  ],
};
const ALL = [0, 1, 2, 3, 4];

describe('which values a forward pass would look up', () => {
  it('groups the rows by the value, so one lookup fills all of them', () => {
    // A column of four hundred rows holds forty places, and Nominatim is paced at about
    // one request a second: asking per row would be forty minutes for forty facts.
    const work = namesToRead(TABLE, 1, 2, ALL);
    expect(work.map((entry) => entry.value)).toEqual(['Kherson, Ukraine', 'Mykolaiv']);
    expect(work[0].rows).toEqual([0, 1]);
  });

  it('never asks about a row that already holds an answer', () => {
    // Overwriting a coordinate somebody read off a photograph with one a geocoder guessed
    // from a name is the worst thing this could do.
    expect(namesToRead(TABLE, 1, 2, ALL).flatMap((entry) => entry.rows)).not.toContain(3);
  });

  it('skips an empty cell, because a blank is not a place to look up', () => {
    expect(namesToRead(TABLE, 1, 2, ALL).flatMap((entry) => entry.rows)).not.toContain(4);
  });

  it('reads only the rows it was given, which are the ones on screen', () => {
    expect(namesToRead(TABLE, 1, 2, [2]).map((entry) => entry.value)).toEqual(['Mykolaiv']);
  });

  it('takes every row when no target column is chosen yet', () => {
    expect(namesToRead(TABLE, 1, -1, ALL).flatMap((entry) => entry.rows)).toContain(3);
  });
});

describe('which rows the case can answer without a geocoder', () => {
  const meta = {
    links: {
      r1: { Place: 'e_kherson' },
      r2: { Place: 'e_other' },
      r4: { Place: 'e_kherson' },
      r5: { Place: 'e_kherson' },
    },
  };

  it('takes the linked rows whose target cell is still empty', () => {
    const work = linkedRows(TABLE, meta, 1, 2, ALL);
    expect(work).toEqual([
      { row: 0, id: 'e_kherson' },
      { row: 1, id: 'e_other' },
    ]);
  });

  it('is rows and not values, because the link is on the cell', () => {
    // Two rows saying `Kherson` may point at two different entities, and grouping them
    // would put one row's place on the other's ground.
    const work = linkedRows(TABLE, meta, 1, -1, ALL);
    expect(work.map((entry) => entry.id)).toEqual(['e_kherson', 'e_other', 'e_kherson']);
  });

  it('skips a blank cell, even one a link was left on', () => {
    expect(linkedRows(TABLE, meta, 1, -1, ALL).map((entry) => entry.row)).not.toContain(4);
  });

  it('leaves an unlinked row to the geocoder', () => {
    expect(linkedRows(TABLE, { links: {} }, 1, 2, ALL)).toEqual([]);
    expect(linkedRows(TABLE, undefined, 1, 2, ALL)).toEqual([]);
  });

  it('asks the case for the points, deduplicated, and never throws', async () => {
    post.mockResolvedValueOnce({ points: { e_kherson: { lat: 46.635, lon: 32.6169 } } });
    const answer = await casePoints('c1', 's1', ['e_kherson', 'e_kherson', 'e_other']);
    expect(answer).toEqual({ e_kherson: { lat: 46.635, lon: 32.6169 } });
    expect(post).toHaveBeenCalledWith('/api/cases/c1/sheets/s1/points', {
      ids: ['e_kherson', 'e_other'],
    });

    // A case that cannot answer leaves every row to the geocoder, which is what this
    // pass did before it learned to ask.
    post.mockRejectedValueOnce(new Error('offline'));
    expect(await casePoints('c1', 's1', ['e_kherson'])).toEqual({});
    expect(await casePoints('c1', 's1', [])).toEqual({});
  });

  it('is bounded by the sheet working size, not by a stranger rate limit', () => {
    expect(MAX_CASE_POINTS).toBe(2000);
  });
});

describe('which rows a reverse pass would ask about', () => {
  const points = {
    columns: ['id', 'Coordinates', 'Place'],
    rows: [
      ['r1', '46.63500, 32.61690', ''],
      ['r2', '46.63500, 32.61690', 'Kherson'],
      ['r3', 'to be found', ''],
      ['r4', '91, 200', ''],
    ],
  };

  it('is rows and not values, because two rows are never the same point', () => {
    // Five decimals is a metre. Rounding two readings together to save a lookup would put
    // one row's answer on another row's ground.
    const work = pointsToRead(points, 1, 2, [0, 1, 2, 3]);
    expect(work.map((entry) => entry.row)).toEqual([0]);
    expect(work[0].point.lat).toBeCloseTo(46.635);
  });

  it('leaves a cell nothing can be read out of, and one off the globe', () => {
    expect(pointsToRead(points, 1, 2, [2, 3])).toEqual([]);
  });
});

describe('an answer as the cell a column holds', () => {
  it('writes a point in the app own spelling, to about a metre', () => {
    // No further: the answer is a guess about a name, and a sixth decimal would dress it
    // up as a survey.
    expect(pointCell({ lat: 46.6350086, lon: 32.6169 })).toBe('46.63501, 32.61690');
    expect(pointCell({ lat: 'nowhere' })).toBe('');
    expect(pointCell(null)).toBe('');
  });

  it('writes the town and the country, not a seven-part postal address', () => {
    expect(placeCell({ address: { city: 'Kherson', country: 'Ukraine' } })).toBe(
      'Kherson, Ukraine',
    );
    expect(placeCell({ address: { village: 'Posad-Pokrovske', country: 'Ukraine' } })).toBe(
      'Posad-Pokrovske, Ukraine',
    );
  });

  it('says the country alone rather than saying it twice', () => {
    expect(placeCell({ address: { country: 'Ukraine' } })).toBe('Ukraine');
  });

  it('falls back to the first part of the display name when there is no address', () => {
    expect(placeCell({ display_name: 'Kherson, Kherson Oblast, Ukraine' })).toBe('Kherson');
    expect(placeCell(null)).toBe('');
  });
});

describe('asking the geocoder', () => {
  it('goes through the routes the map already uses', async () => {
    get.mockResolvedValueOnce({ lat: 46.635, lon: 32.6169 });
    expect(await geocodeValue('Kherson, Ukraine')).toEqual({ lat: 46.635, lon: 32.6169 });
    expect(get).toHaveBeenCalledWith('/api/geo/geocode?q=Kherson%2C%20Ukraine');

    get.mockResolvedValueOnce({ address: { city: 'Kherson' } });
    await reverseValue(46.635, 32.6169);
    expect(get).toHaveBeenLastCalledWith('/api/geo/reverse?lat=46.635&lon=32.6169');
  });

  it('answers nothing rather than throwing, so one dead value does not stop the pass', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    expect(await geocodeValue('Kherson')).toBeNull();
    get.mockRejectedValueOnce(new Error('offline'));
    expect(await reverseValue(1, 2)).toBeNull();
  });

  it('caps a pass at something a browser tab can wait for', () => {
    // Past this it is a batch job, and a tab waiting four minutes on a paced geocoder is
    // a tab that looks broken.
    expect(MAX_LOOKUPS).toBe(60);
  });
});
