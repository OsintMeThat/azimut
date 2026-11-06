import { describe, expect, it } from 'vitest';
import { keptHeader, keptOffer, keptRows, keptTable } from './keptTable.js';

const recipe = {
  id: 'burn', name: 'Burn scars', method: 'surface',
  parameters: { sensitivity: 60, min_area: 5000, max_area: 0, ignore_clouds: true, ignore_shadows: true, cloud_margin: 5, index: 'nbr' },
};
const methods = [{ id: 'surface', single: false, measure: '{index} {before} → {after}' }];
const pass = (date) => ({ provider: 'sentinel2', date });
const row = (id, review, extra = {}) => ({
  id, review, phenomenon: 'Surface change', coordinates: [44.1912, 15.3694], area: 12000, strength: 'strong',
  bbox: [44.1912, 15.3694, 44.1922, 15.3702], measure: { before: 0.61, after: -0.28 },
  sources: { a: pass('2026-03-02'), b: pass('2026-03-14') }, ...extra,
});
const run = {
  id: 'abc', title: 'Port fire', status: 'ready',
  input: { title: 'Port fire', zones: [{ id: 'z1', name: 'North quay' }, { id: 'z2', name: 'Depot' }], recipe, a: pass('2026-03-02'), b: pass('2026-03-14') },
  results: [
    row('0-1', 'kept', { entity_id: 'e_pin', title: 'Burn at the north quay' }),
    row('0-2', 'noted', { coordinates: [44.2, 15.38] }),
    row('0-3', 'new', { coordinates: [44.3, 15.39] }),
    row('0-4', 'new'),
  ],
};

describe('the kept candidates of a run, as a table for a note', () => {
  it('holds what was kept or pinned, never the queue', () => {
    expect(keptRows(run.results).map((one) => one.id)).toEqual(['0-1', '0-2']);
    const text = keptTable({ run, methods });
    expect(text).not.toContain('44.30000');
    // a pin is a chip, a candidate kept here is the name the run gave it
    expect(text).toContain('[[entity:e_pin|Burn at the north quay]]');
    expect(text).toContain('| Surface change |');
  });

  it('quotes what the run read above the table, and counts what was kept of what was found', () => {
    expect(keptHeader({ run, methods })).toEqual([
      'Detect run “Port fire”: North quay, Depot',
      'Analyzer: Burn scars',
      'Passes: A 2 Mar 2026, B 14 Mar 2026',
      'Threshold: sensitivity 60 of 100, from 5000 m²',
      'Cloud mask: clouds and shadows ignored, 5 px margin',
      '2 kept of 4 candidates, 1 pinned in the case',
    ]);
    const lines = keptTable({ run, methods }).split('\n');
    expect(lines.slice(0, 6).every((line) => line.startsWith('> '))).toBe(true);
    expect(lines).toContain('| Candidate | Coordinates | Size | Reading | Dates |');
  });

  it('writes each row with its coordinates, size, measure and the passes it was read between', () => {
    const lines = keptTable({ run, methods }).split('\n');
    const pinned = lines.find((line) => line.includes('e_pin'));
    expect(pinned).toContain('15.36940, 44.19120');
    expect(pinned).toContain('1.20 ha, ≈ ');
    expect(pinned).toContain('Strong · NBR 0.61 → -0.28');
    expect(pinned).toContain('2 Mar 2026 → 14 Mar 2026');
  });

  it('says one pass for a method that reads one, and names no cloud mask for radar', () => {
    const radar = { ...run, input: { ...run.input, recipe: { ...recipe, parameters: {} }, b: { provider: 'sentinel1', date: '2026-03-14' } } };
    const header = keptHeader({ run: radar, single: true });
    expect(header).toContain('Pass: 14 Mar 2026');
    expect(header.some((line) => line.startsWith('Cloud mask'))).toBe(false);
    expect(keptHeader({ run: { ...run, input: { ...run.input, recipe: { ...recipe, parameters: { ...recipe.parameters, ignore_clouds: false, ignore_shadows: false } } } } })
      .some((line) => line === 'Cloud mask: off')).toBe(true);
  });

  it('names the cut when more were kept than a report holds', () => {
    const many = { ...run, results: Array.from({ length: 7 }, (_, index) => row(`k${index}`, 'noted')) };
    const text = keptTable({ run: many, methods, limit: 5 });
    expect(text).toContain('> Only the first 5 of 7 kept candidates. Dismiss the ones that are not findings for the rest.');
    expect(text.split('\n').filter((line) => line.startsWith('| Surface change'))).toHaveLength(5);
  });

  it('is empty when nothing was kept, and the offer refuses in a sentence', async () => {
    const nothing = { ...run, results: [row('0-3', 'new')] };
    expect(keptTable({ run: nothing, methods })).toBe('');
    await expect(keptOffer({ read: () => ({ run: nothing, methods }) }).put({})).rejects.toThrow('Keep or pin a candidate first');
    const offer = keptOffer({ read: () => ({ run, methods }) });
    expect(offer).toMatchObject({ id: 'kept', label: 'The kept candidates' });
    expect((await offer.put({})).text).toContain('| Candidate | Coordinates |');
  });
});
