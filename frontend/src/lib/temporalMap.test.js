import { describe, expect, it } from 'vitest';
import { groupTemporalMapItems, temporalMapQuery } from './temporalMap.js';

describe('the temporary Timeline map layer', () => {
  it('asks for one fact-time window', () => {
    expect(temporalMapQuery('case-a', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'))
      .toBe('/api/cases/case-a/timeline/map?from=2026-08-01T00%3A00%3A00Z&to=2026-09-01T00%3A00%3A00Z');
  });

  it('stacks claims at the same place and ignores places without coordinates', () => {
    const place = { id: 'place-a', label: 'Harbour', lat: 50, lon: 2 };
    const groups = groupTemporalMapItems([
      { id: 'claim-a', place_entities: [place] },
      { id: 'claim-b', place_entities: [place, { id: 'unknown', label: 'Unknown' }] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(['claim-a', 'claim-b']);
  });
});
