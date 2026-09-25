import { describe, expect, it } from 'vitest';
import {
  GIF_EDGE,
  MAX_EVOLUTION_FRAMES,
  SHEET_PIXELS,
  allKeys,
  chosenEntries,
  defaultKeys,
  evolutionArchive,
  evolutionFrame,
  pickerMonth,
  pictureLabel,
  pictureScale,
  pictureTiles,
  playOrder,
  rangeKeys,
  samePixels,
  sheetCellScale,
  sheetColumns,
  sideEntry,
  spreadKeys,
  thinKeys,
  timelinePositions,
} from './evolution.js';
import { apply, invert, screenToMercator, scale, compose, toMercator } from './groundFrame.js';

const side = (provider, extra = {}) => ({ present: true, provider, ...extra });
const row = (key, date, extra = {}) => ({ key, date, usable: true, ...extra });

const ROWS = [
  row('2025-01-03', '2025-01-03', { cloud: 40 }),
  row('2025-01-20', '2025-01-20', { cloud: 5 }),
  row('2025-02-11', '2025-02-11', { cloud: 90, usable: false }),
  row('2025-03-02', '2025-03-02', { cloud: 12 }),
  row('2026-04-09', '2026-04-09', { cloud: 3 }),
];

describe('evolution archive', () => {
  it('plays an archive both sides share, and Wayback against World Imagery', () => {
    expect(evolutionArchive(side('sentinel2'), side('sentinel2'))).toBe('sentinel2');
    expect(evolutionArchive(side('esri-wayback'), side('esri-wayback'))).toBe('esri-wayback');
    expect(evolutionArchive(side('esri-wayback'), side('esri-world-imagery'))).toBe('esri-wayback');
    expect(evolutionArchive(side('esri-world-imagery'), side('esri-wayback'))).toBe('esri-wayback');
  });

  it('plays nothing on a pair with no shared history', () => {
    expect(evolutionArchive(side('sentinel1'), side('sentinel1'))).toBeNull();
    expect(evolutionArchive(side('esri-world-imagery'), side('esri-world-imagery'))).toBeNull();
    expect(evolutionArchive(side('sentinel2'), side('esri-wayback'))).toBeNull();
    expect(evolutionArchive(side('sentinel2'), { ...side('sentinel2'), present: false })).toBeNull();
  });

  it('reads World Imagery as the newest release, whatever release its side last held', () => {
    const rows = [row('r1', '2020-01-01', { release: 1 }), row('r2', '2024-01-01', { release: 2 })];
    expect(sideEntry(rows, 'esri-wayback', side('esri-world-imagery', { wayback_release: 1 }))).toBe(rows[1]);
    expect(sideEntry(rows, 'esri-wayback', side('esri-wayback', { wayback_release: 1 }))).toBe(rows[0]);
    expect(sideEntry(rows, 'esri-wayback', side('esri-wayback', { wayback_release: null }))).toBe(rows[1]);
  });

  it('reads a release that republished a picture as the release that first published it', () => {
    const rows = [
      row('r5', '2009-06-01', { release: 5, released: '2012-01-01', note: 'taken' }),
      row('r15', '2020-01-01', { release: 15, released: '2020-01-01' }),
      row('r30', '2026-09-01', { release: 30, released: '2026-09-01' }),
    ];
    const at = (day) => sideEntry(rows, 'esri-wayback', side('esri-wayback', { wayback_release: 20, wayback_date: day }));
    expect(at('2025-06-01')).toBe(rows[1]);
    expect(at('2020-01-01')).toBe(rows[1]);
    expect(at('2015-03-03')).toBe(rows[0]);
    expect(at('2011-01-01')).toBeNull();
    expect(at('')).toBeNull();
  });
});

describe('choosing the pictures', () => {
  it('opens on A to B, both ends in, a picture over the cloud ceiling left out', () => {
    expect(rangeKeys(ROWS, ROWS[3], ROWS[0])).toEqual(['2025-01-03', '2025-01-20', '2025-03-02']);
    // A side the list does not hold stands at its end.
    expect(rangeKeys(ROWS, null, ROWS[1])).toEqual(['2025-01-03', '2025-01-20']);
    expect(rangeKeys(ROWS, ROWS[3], null)).toEqual(['2025-03-02', '2026-04-09']);
    expect(defaultKeys(ROWS, ROWS[0], ROWS[3])).toEqual(['2025-01-03', '2025-01-20', '2025-03-02']);
  });

  it('opens on every usable picture when A and B show one', () => {
    expect(defaultKeys(ROWS, ROWS[1], ROWS[1])).toEqual(allKeys(ROWS));
    expect(allKeys(ROWS)).not.toContain('2025-02-11');
  });

  it('spreads a long list down to the most one export holds, both ends kept', () => {
    const keys = Array.from({ length: 100 }, (_, index) => `k${index}`);
    const spread = spreadKeys(keys);
    expect(spread).toHaveLength(MAX_EVOLUTION_FRAMES);
    expect(new Set(spread).size).toBe(MAX_EVOLUTION_FRAMES);
    expect([spread[0], spread.at(-1)]).toEqual(['k0', 'k99']);
    expect(spreadKeys(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps the clearest picture of each month or year', () => {
    const keys = ROWS.map((entry) => entry.key);
    expect(thinKeys(ROWS, keys, 'month')).toEqual(['2025-01-20', '2025-02-11', '2025-03-02', '2026-04-09']);
    expect(thinKeys(ROWS, keys, 'year')).toEqual(['2025-01-20', '2026-04-09']);
    // Wayback says nothing of cloud: the first of the month stands.
    const releases = [row('r1', '2024-05-01'), row('r2', '2024-05-20')];
    expect(thinKeys(releases, ['r1', 'r2'], 'month')).toEqual(['r1']);
  });

  it('plays the chosen rows by the day each was taken, however they were ticked', () => {
    expect(chosenEntries(ROWS, ['2026-04-09', '2025-01-03']).map((entry) => entry.key))
      .toEqual(['2025-01-03', '2026-04-09']);
    // A later Wayback release can carry an older picture.
    const releases = [row('r1', '2011-01-15'), row('r2', '2014-02-20'), row('r3', '2010-12-18')];
    expect(playOrder(releases).map((entry) => entry.key)).toEqual(['r3', 'r1', 'r2']);
    expect(chosenEntries(releases, ['r1', 'r3']).map((entry) => entry.key)).toEqual(['r3', 'r1']);
  });

  it('opens the Sentinel-2 picker on a month between 2015 and now', () => {
    expect(pickerMonth('2019-04', '2026-09')).toBe('2019-04');
    expect(pickerMonth('2011-01', '2026-09')).toBe('2015-06');
    expect(pickerMonth('2030-01', '2026-09')).toBe('2026-09');
    expect(pickerMonth('2019-13', '2026-09')).toBeNull();
    expect(pickerMonth('', '2026-09')).toBeNull();
  });

  it('dates a Wayback picture as Esri estimates it, or as its release', () => {
    expect(pictureLabel('esri-wayback', { date: '2023-07-02', note: 'taken' })).toBe('~2023-07-02');
    expect(pictureLabel('esri-wayback', { date: '2023-07-02', note: '' })).toBe('Release 2023-07-02');
    expect(pictureLabel('esri-wayback', { date: '', note: '' })).toBe('Release, undated');
    expect(pictureLabel('sentinel2', { date: '2023-07-02', note: '3% cloud' })).toBe('2023-07-02');
  });
});

describe('the ground of an evolution', () => {
  const VIEW = { lng: 2.35, lat: 48.85, zoom: 16, bearing: 0, width: 1200, height: 800 };

  it('is the view, with no export frame', () => {
    expect(evolutionFrame(VIEW, null)).toEqual(VIEW);
  });

  it('is the export frame at the view scale, upright as it was drawn, off screen or not', () => {
    const [x, y] = toMercator(2.35, 48.85);
    const perPixel = (2 * Math.PI * 6378137) / (512 * 2 ** 16);
    const [west, south] = [x - 150 * perPixel, y - 100 * perPixel];
    const [east, north] = [x + 150 * perPixel, y + 100 * perPixel];
    const back = (mx, my) => [(mx / 6378137) * (180 / Math.PI), (2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2) * (180 / Math.PI)];
    const frame = evolutionFrame(VIEW, { points: [back(west, north), back(east, south)], angle: 30 });
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.bearing).toBe(30);
    expect(frame.lng).toBeCloseTo(2.35, 6);
    expect(frame.lat).toBeCloseTo(48.85, 6);
    expect(frame.zoom).toBe(16);
  });

  it('is drawn at the screen density, held under the GIF edge', () => {
    expect(pictureScale({ width: 800, height: 600 }, GIF_EDGE, 1)).toBe(1);
    expect(pictureScale({ width: 800, height: 600 }, GIF_EDGE, 2)).toBe(1.6);
    expect(pictureScale({ width: 2560, height: 1400 }, GIF_EDGE, 1)).toBe(0.5);
  });

  it('shares a sheet out, and keeps a tall one under the pixels the plates route takes', () => {
    expect(sheetColumns(2)).toBe(2);
    expect(sheetColumns(12)).toBe(4);
    expect(sheetColumns(40)).toBe(6);
    const wide = { width: 1200, height: 800 };
    expect(sheetCellScale(wide, 4, 1)).toBeCloseTo((2400 - 24) / 2 / 1200, 6);
    const tall = { width: 400, height: 1400 };
    const cell = sheetCellScale(tall, 40, 2);
    const pixels = 6 * 7 * (400 * cell) * (1400 * cell);
    expect(pixels).toBeLessThanOrEqual(SHEET_PIXELS * 1.0001);
  });
});

describe('the tiles of a picture', () => {
  const PROVIDER = { tile_size: 256, max_zoom: 19 };
  const FRAME = { lng: 2.35, lat: 48.85, zoom: 16, bearing: 0, width: 600, height: 400 };

  it('asks about one tile pixel per output pixel, and lays each exactly on the ground', () => {
    const plan = pictureTiles(FRAME, PROVIDER, 1);
    // engine zoom 16 on 512 px tiles is XYZ 17 on 256 px ones
    expect(plan.z).toBe(17);
    expect([plan.width, plan.height]).toEqual([600, 400]);
    const toOutput = invert(compose(screenToMercator(FRAME), scale(1)));
    for (const tile of plan.tiles) {
      const span = (2 * Math.PI * 6378137) / 2 ** tile.z;
      const corner = [tile.x * span - Math.PI * 6378137, Math.PI * 6378137 - tile.y * span];
      const [ex, ey] = apply(toOutput, ...corner);
      const [gx, gy] = apply(tile.matrix, 0, 0);
      expect(gx).toBeCloseTo(ex, 6);
      expect(gy).toBeCloseTo(ey, 6);
      expect(tile.matrix.a).toBeCloseTo(1, 9);
    }
    // 600 × 400 output px of 256 px tiles: 3 or 4 across, 2 or 3 down
    expect(plan.tiles.length).toBeGreaterThanOrEqual(6);
    expect(plan.tiles.length).toBeLessThanOrEqual(12);
  });

  it('stops at the native level, where the proxy magnifies for free', () => {
    const plan = pictureTiles(FRAME, { tile_size: 512, max_zoom: 18, max_native_zoom: 14 }, 1);
    expect(plan.z).toBe(13);
    expect(plan.tiles.every((tile) => tile.size === 512)).toBe(true);
  });

  it('lists only the tiles a turned frame touches', () => {
    const upright = pictureTiles({ ...FRAME, width: 1200, height: 60 }, PROVIDER, 1);
    const turned = pictureTiles({ ...FRAME, width: 1200, height: 60, bearing: 45 }, PROVIDER, 1);
    const box = (Math.ceil((1200 + 60) / Math.SQRT2 / 256) + 1) ** 2;
    expect(turned.tiles.length).toBeLessThan(box);
    expect(upright.tiles.length).toBeLessThanOrEqual(8);
  });

  it('wraps a view counted past the date line', () => {
    const plan = pictureTiles({ ...FRAME, lng: 180.0001, lat: 0 }, PROVIDER, 1);
    const count = 2 ** plan.z;
    expect(plan.tiles.every((tile) => tile.x >= 0 && tile.x < count)).toBe(true);
  });
});

describe('telling pictures apart', () => {
  it('finds a repeated release by its pixels', () => {
    expect(samePixels(new Uint8ClampedArray([1, 2, 3]), new Uint8ClampedArray([1, 2, 3]))).toBe(true);
    expect(samePixels(new Uint8ClampedArray([1, 2, 3]), new Uint8ClampedArray([1, 2, 4]))).toBe(false);
    expect(samePixels(null, new Uint8ClampedArray([1]))).toBe(false);
  });

  it('places each picture on the line by its day', () => {
    expect(timelinePositions(['2020-01-01', '2020-01-11', '2020-01-21'])).toEqual([0, 0.5, 1]);
    expect(timelinePositions(['2020-01-01', '2020-01-01'])).toEqual([0, 0]);
    expect(timelinePositions(['', ''])).toEqual([0, 1]);
  });
});
