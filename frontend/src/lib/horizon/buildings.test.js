import { describe, expect, it } from 'vitest';
import {
  DEFAULTS, aligned, alignment, credits, describeBuilding, downloading, formatSize, problems, question, readSettings,
  sourcesParam, splitBatch, summary, tilesToFetch,
} from './buildings.js';

describe('the buildings settings kept in this browser', () => {
  it('fall back on the defaults for anything missing, unknown or out of range', () => {
    expect(readSettings(null)).toEqual({ ...DEFAULTS, sources: { ...DEFAULTS.sources }, shift: [0, 0], lean: [0, 0] });
    expect(readSettings('{not json')).toMatchObject({ on: false, radius: 2000 });
    const kept = readSettings(JSON.stringify({
      on: true, radius: 5000, sources: { ign: false }, unknown: 'hide', roofs: 'photo', look: 'outline',
      showKinds: false, shift: [3.5, -1], lean: [0.2, 0],
    }));
    expect(kept).toEqual({
      on: true, radius: 5000, sources: { ign: false, osm: true, globfp: true }, unknown: 'hide', roofs: 'photo',
      look: 'outline', showKinds: false, shift: [3.5, -1], lean: [0.2, 0],
    });
    expect(readSettings(JSON.stringify({ radius: 3333, roofs: 'gold', shift: [1e9, 0], lean: 'x' }))).toMatchObject({
      radius: 2000, roofs: 'tint', shift: [0, 0], lean: [0, 0],
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
    const asking = status({ needs: [{ grid: 'a.zip', size: 40_363_448 }, { grid: 'b.zip', size: 5e6 }] });
    expect(question(asking, new Set())).toEqual({
      grids: ['a.zip', 'b.zip'], size: 45_363_448,
      text: 'Estimated heights here come from 3D-GloBFP: 45 MB to download once, kept on this machine.',
    });
    expect(question(asking, new Set(['a.zip', 'b.zip']))).toBeNull();
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
