import { describe, expect, it, vi } from 'vitest';
import { buildSeries } from '../../lib/map/detectSeries.js';
import {
  candidatesCsv, changesBlock, downloadCsv, fileName, figuresBlock, perPassBlock, seriesOffers, sourceLine, spotsCsv,
  spotsTable, wholeSection,
} from './seriesNote.js';

const AT = [54.55, 24.25];
const east = (m) => [AT[0] + m / (111320 * Math.cos((AT[1] * Math.PI) / 180)), AT[1]];
const result = (id, coordinates, area = 'apron', review = 'new') => ({ id, area_id: area, coordinates, review, strength: 'strong', area: 120.4 });
const run = (id, date, results) => ({
  id, title: 'Base', created_at: `${date}T20:00:00+00:00`, dates: ['2026-07-24', date],
  areas: ['apron', 'north'].map((area) => ({ area_id: area, status: 'ready', a: '2026-07-24', b: date })),
  results,
});
const ROWS = [
  run('r1', '2026-09-27', [result('p', AT), result('n', east(500), 'north', 'noted')]),
  run('r2', '2026-09-29', [result('p', east(5)), result('q', east(200))]),
];
const AREAS = [{ id: 'apron', name: 'Apron, west', colour: '#F6A81A' }, { id: 'north', name: 'North', colour: '#38bdf8' }];
const series = buildSeries(ROWS);
const source = sourceLine({ analyzer: 'AVIATION' });

describe('blocks for a note', () => {
  it('names where the figures come from', () => {
    expect(source).toBe('Sentinel-2 passes read by Azimut Detect (AVIATION)');
    expect(sourceLine({ sensor: 'sentinel1' })).toBe('Sentinel-1 passes read by Azimut Detect');
  });

  it('writes the key figures as tiles', () => {
    const text = figuresBlock(series, { title: 'Al Dhafra', source });
    expect(text.split('\n').slice(0, 4)).toEqual(['::: chart', 'kind: key figures', 'title: Al Dhafra', `source: ${source}`]);
    expect(text).toContain('| 2 | passes read, 27 Sep to 29 Sep 2026 |');
    expect(text).toContain('| 3 | spots, candidates within 40 m counted as one |');
    expect(text.endsWith(':::')).toBe(true);
  });

  it('writes candidates per pass as columns, or stacked by area in their colours', () => {
    const total = perPassBlock(series, { areas: AREAS, source });
    expect(total).toContain('kind: columns');
    expect(total).toContain('| 27 Sep | 2 |');
    const stacked = perPassBlock(series, { areas: AREAS, byArea: true, title: 'Per pass' });
    expect(stacked).toContain('kind: stacked columns');
    expect(stacked).toContain('colour by: Area');
    // a comma in a name would split the colours line
    expect(stacked).toContain('colours: Apron  west #f6a81a, North #38bdf8'.replace('  ', ' '));
    expect(stacked).toContain('| 29 Sep | North | 0 |');
  });

  it('writes what appeared and left only where there was a pass before', () => {
    const text = changesBlock(series);
    expect(text).toContain('| 29 Sep | Appeared | 1 |');
    expect(text).toContain('| 29 Sep | Left | 1 |');
    expect(text).not.toContain('27 Sep');
    expect(changesBlock(buildSeries([ROWS[0]]))).toBe('');
  });

  it('writes the spots as a table under the rule that made them', () => {
    const text = spotsTable(series, { areas: AREAS });
    expect(text.startsWith('> Spots: candidates within 40 m')).toBe(true);
    expect(text).toContain('| S1 | Apron west | 24.25000, 54.55002 | 27 Sep | 29 Sep | 2 of 2 | Regular | ●● |');
  });

  it('cuts a long spots table as every table put in a note is, the CSV holding the rest', () => {
    const text = spotsTable(series, { areas: AREAS, limit: 2 });
    expect(text).toContain('> Only the first 2 of 3 spots. The spots CSV holds every one.');
    expect(text).not.toContain('| S3 |');
  });

  it('puts the whole dashboard under one heading', () => {
    const text = wholeSection(series, { title: 'Al Dhafra', areas: AREAS, source });
    expect(text.startsWith('## Al Dhafra, 27 Sep to 29 Sep 2026')).toBe(true);
    expect(text.match(/::: chart/g)).toHaveLength(3);
    expect(wholeSection(buildSeries([]), {})).toBe('');
  });

  it('offers each part to the pinned note, and says when there is nothing yet', async () => {
    const offers = seriesOffers(() => ({ series, title: 'Al Dhafra', areas: AREAS, source }));
    expect(offers.map((offer) => offer.id)).toEqual(['series-all', 'series-figures', 'series-passes', 'series-changes', 'series-spots']);
    expect((await offers[2].put()).text).toContain('kind: columns');
    const empty = seriesOffers(() => ({ series: buildSeries([]) }));
    await expect(empty[1].put()).rejects.toThrow('no finished pass');
  });
});

describe('files', () => {
  it('writes one row per candidate with its spot and verdict', () => {
    const lines = candidatesCsv(series, { areas: AREAS }).trim().split('\n');
    expect(lines[0]).toBe('pass,reference,area,spot,latitude,longitude,strength,size_m2,verdict,run,candidate');
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe('2026-09-27,2026-07-24,North,S2,24.250000,54.554926,strong,120,kept here,r1,n');
  });

  it('writes one row per spot', () => {
    const lines = spotsCsv(series, { areas: AREAS }).trim().split('\n');
    expect(lines[0]).toBe('spot,area,latitude,longitude,first_seen,last_seen,passes_seen,passes_read,kind,each_pass');
    expect(lines[1]).toBe('S1,Apron west,24.250000,54.550025,2026-09-27,2026-09-29,2,2,Regular,●●');
  });

  it('names a file after its routine', () => {
    expect(fileName('Al Dhafra Air Base Routine', 'spots')).toBe('al-dhafra-air-base-routine-spots.csv');
    expect(fileName('', 'spots')).toBe('routine-spots.csv');
  });

  it('hands the file to the browser', () => {
    const click = vi.fn();
    const link = { click, remove: vi.fn() };
    const doc = { createElement: () => link, body: { append: vi.fn() } };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    downloadCsv('a,b\n', 'x.csv', doc);
    expect([link.download, link.href, click.mock.calls.length]).toEqual(['x.csv', 'blob:x', 1]);
  });
});
