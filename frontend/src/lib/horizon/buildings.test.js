import { describe, expect, it } from 'vitest';
import {
  DEFAULTS, aligned, alignment, buildingsSpec, caveat, credits, describeBuilding, downloading, formatSize, problems, question,
  readSettings, settingsOfSpec, sourcesParam, splitBatch, summary, tilesToFetch,
} from './buildings.js';

describe('buildings as a saved view keeps them', () => {
  it('come back as the settings they were saved from', () => {
    const settings = { ...readSettings(null), on: true, radius: 10000, unknownHeight: 6, roofs: 'photo', shift: [2, -1] };
    expect(settingsOfSpec(buildingsSpec(settings))).toEqual(settings);
  });

  it('are off for a view that kept none, and out-of-range values fall back to the defaults', () => {
    expect(settingsOfSpec(null)).toEqual({ on: false });
    const back = settingsOfSpec({ radius: 3000, sources: ['osm'], unknown_height: 900, shift: [99, 0] });
    expect(back).toMatchObject({ on: true, radius: DEFAULTS.radius, unknownHeight: DEFAULTS.unknownHeight, shift: [0, 0] });
    expect(back.sources).toEqual({ ign: false, nl3dbag: false, nrw: false, nyc: false, osm: true, overture: false, globfp: false, google: false });
  });
});

describe('the buildings settings kept in this browser', () => {
  it('fall back on the defaults for anything missing, unknown or out of range', () => {
    expect(readSettings(null)).toEqual({ ...DEFAULTS, sources: { ...DEFAULTS.sources }, shift: [0, 0], lean: [0, 0] });
    expect(readSettings('{not json')).toMatchObject({ on: false, radius: 2000 });
    const kept = readSettings(JSON.stringify({
      on: true, radius: 5000, sources: { ign: false }, unknown: 'hide', roofs: 'photo', look: 'outline',
      showKinds: false, shift: [3.5, -1], lean: [0.2, 0], unknownHeight: 7,
    }));
    expect(kept).toEqual({
      on: true, radius: 5000, sources: { ign: false, nl3dbag: true, nrw: true, nyc: true, osm: true, overture: true, globfp: true, google: true }, unknown: 'hide', unknownHeight: 7, roofs: 'photo',
      look: 'outline', showKinds: false, shift: [3.5, -1], lean: [0.2, 0],
    });
    expect(readSettings(JSON.stringify({ radius: 3333, roofs: 'gold', shift: [1e9, 0], lean: 'x', unknownHeight: 900 }))).toMatchObject({
      radius: 2000, roofs: 'tint', shift: [0, 0], lean: [0, 0], unknownHeight: 3,
    });
  });

  it('name the sources switched on, in the app’s order', () => {
    expect(sourcesParam({ globfp: true, ign: false, osm: true })).toBe('osm,globfp');
  });
});

describe('the image moved to meet the footprints', () => {
  it('moves the ground by the shift, and looks a roof’s photo up back by it and out by its lean', () => {
    const at60 = alignment({ shift: [2, 3], lean: [0.5, -0.25] }, 60);
    expect(at60.groundShift).toEqual([2, 3]);
    // Mercator metres are ground metres stretched by 1 / cos(latitude): twice at 60°
    expect(at60.imageShift[0]).toBeCloseTo(-4, 9);
    expect(at60.imageShift[1]).toBeCloseTo(6, 9);
    expect(at60.imageLean[0]).toBeCloseTo(1, 9);
    expect(at60.imageLean[1]).toBeCloseTo(0.5, 9);
    expect(aligned({ shift: [0, 0], lean: [0, 0] })).toBe(false);
    expect(aligned({ shift: [0, 0], lean: [0, 0.1] })).toBe(true);
  });
});

const status = (extra = {}) => ({
  tiles: [], pending: 0, counts: { measured: 0, estimated: 0, range: 0, unknown: 0 }, sources: [], failed: [],
  needs: [], downloads: [], ...extra,
});

describe('what the Layers row says about the area', () => {
  it('counts the buildings and says where their heights come from, unknowns always named', () => {
    expect(summary(status({ counts: { measured: 18083, estimated: 0, range: 0, unknown: 681 } }))).toBe(
      '18,764 buildings · heights 96% measured, 4% unknown'
    );
    expect(summary(status({ counts: { measured: 12, estimated: 41613, range: 0, unknown: 3 } }))).toBe(
      '41,628 buildings · heights <1% measured, >99% estimated, <1% unknown'
    );
    expect(summary(status())).toBe('No buildings known here');
    expect(summary(status({ pending: 3 }))).toBe('');
    expect(summary(null)).toBe('');
  });

  it('notes under the view what the heights rest on, with what an unknown one is drawn as', () => {
    const mixed = status({ counts: { measured: 30, estimated: 50, range: 10, unknown: 10 } });
    expect(caveat(mixed, DEFAULTS)).toEqual({
      heights: '100 buildings · heights 30% measured, 50% estimated, 10% a range of storeys, 10% unknown (drawn at 3 m)',
      note: 'Open data: heights and footprints can be wrong or out of date.',
    });
    expect(caveat(mixed, { ...DEFAULTS, unknown: 'hide' }).heights).toMatch(/10% unknown \(hidden\)$/);
    expect(caveat(mixed, { ...DEFAULTS, unknownHeight: 6 }).heights).toMatch(/\(drawn at 6 m\)$/);
    // every height measured: nothing to say of unknown ones, the open-data note still stands
    const measured = caveat(status({ counts: { measured: 8, estimated: 0, range: 0, unknown: 0 } }), DEFAULTS);
    expect(measured.heights).toBe('8 buildings · heights 100% measured');
    expect(measured.note).toMatch(/^Open data/);
    expect(caveat(status(), DEFAULTS)).toBeNull();
    expect(caveat(null, DEFAULTS)).toBeNull();
  });

  it('credits each source with its licence and the years its data spans', () => {
    const lines = credits(status({
      sources: [
        { id: 'ign', label: 'BD TOPO® (IGN)', licence: 'Licence Ouverte 2.0', link: 'l', oldest: '2010-07-15', newest: '2026-05-29' },
        { id: 'globfp', label: '3D-GloBFP', licence: 'CC BY 4.0', link: 'g', oldest: '2020', newest: '2020' },
      ],
    }));
    expect(lines.map((l) => l.text)).toEqual(['BD TOPO® (IGN), Licence Ouverte 2.0, 2010–2026', '3D-GloBFP, CC BY 4.0, 2020']);
  });

  it('asks before a download, with its size, and stops asking once declined', () => {
    const asking = status({
      needs: [
        { grid: 'a.zip', size: 40_363_448, source: 'globfp' },
        { grid: 'b.zip', size: 5e6, source: 'globfp' },
        { grid: 'r.tif', size: 25e6, source: 'google' },
      ],
    });
    const asked = question(asking, new Set());
    expect(asked.groups).toEqual([
      { source: 'globfp', name: '3D-GloBFP', grids: ['a.zip', 'b.zip'], size: 45_363_448 },
      { source: 'google', name: 'Google 2.5D', grids: ['r.tif'], size: 25e6 },
    ]);
    expect(asked.text).toBe(
      'To download here: 3D-GloBFP (about 2020) 45 MB, Google 2.5D (2023, about 1.5 m off) 25 MB. Each is downloaded once and kept on this machine.'
    );
    expect(question(asking, new Set(['a.zip', 'b.zip', 'r.tif']))).toBeNull();
    expect(formatSize(1_949_000_000)).toBe('1.9 GB');
    expect(formatSize(400)).toBe('1 kB');
  });

  it('says what downloads and what failed', () => {
    const s = status({
      downloads: [{ grid: 'a', done: 12e6, total: 38e6, error: '' }, { grid: 'b', done: 0, total: 1, error: 'HTTP 503' }],
      failed: [{ source: 'osm', reason: 'OpenStreetMap buildings could not be read just now (timeout)' }],
    });
    expect(downloading(s)).toBe('3D-GloBFP 12 MB of 38 MB');
    expect(problems(s)).toEqual(['OpenStreetMap buildings could not be read just now (timeout)', 'HTTP 503']);
  });
});

describe('the tiles the view fetches', () => {
  it('fetches ready tiles it does not hold at their version', () => {
    const s = status({
      tiles: [
        { key: '14/1/1', ready: true, version: 'a' },
        { key: '14/1/2', ready: true, version: 'b' },
        { key: '14/1/3', ready: false, version: '' },
      ],
    });
    const held = new Map([['14/1/1', { version: 'a' }], ['14/1/2', { version: 'old' }]]);
    expect(tilesToFetch(s, held).map((t) => t.key)).toEqual(['14/1/2']);
  });

  it('splits a batch into its tiles, an empty one as not ready', () => {
    const body = new Uint8Array([3, 0, 0, 0, 7, 8, 9, 0, 0, 0, 0]);
    const got = splitBatch(body.buffer, ['a', 'b']);
    expect(Array.from(new Uint8Array(got.get('a')))).toEqual([7, 8, 9]);
    expect(got.get('b')).toBeNull();
  });
});

describe('the building under the pointer', () => {
  it('says its height, whose height and whose footprint, with their dates', () => {
    expect(describeBuilding({
      height: 16.71, kind: 'estimated', source: 'osm', date: '2026-10-04', height_source: 'globfp', height_date: '2020',
    })).toBe('16.7 m, estimated · height from 3D-GloBFP (2020) · footprint from OpenStreetMap (2026-10-04)');
    expect(describeBuilding({ height: null, kind: 'unknown', source: 'osm', date: '' })).toBe(
      'Height unknown · footprint from OpenStreetMap'
    );
  });
});
