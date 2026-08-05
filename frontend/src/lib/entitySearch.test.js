/**
 * The in-memory predicate must answer the same term as the server's index.
 *
 * A small case filters here and a large one filters server-side. Before this the
 * board compared the label alone, so a plate was findable in a case of two hundred
 * rows and invisible in a case of ten — the same box, two answers, decided by a
 * threshold nobody can see.
 */
import { describe, expect, it, vi } from 'vitest';

const FIELDS = {
  vehicle: [
    { key: 'plate', label: 'Plate', kind: 'text' },
    { key: 'make', label: 'Make', kind: 'text' },
  ],
  claim: [
    { key: 'verbatim', label: 'As the source put it', kind: 'longtext' },
    { key: 'confidence', label: 'Confidence', kind: 'choice' },
  ],
  place: [
    { key: 'radius_m', label: 'Uncertainty radius (m)', kind: 'number' },
    { key: 'footprint', label: 'Footprint', kind: 'geojson' },
  ],
  bookmark: [{ key: 'archive_url', label: 'Archived copy', kind: 'url' }],
};

vi.mock('./entityTypes.svelte.js', () => ({
  entityFields: (type) => FIELDS[type] ?? [],
}));

const { entitySearchText, matchesEntity } = await import('./entitySearch.js');

describe('entity search', () => {
  it('matches the label, the type, the folder and the notes', () => {
    const entity = {
      label: 'Truck 12',
      type: 'vehicle',
      attrs: { folder: 'Sources/Convoy', notes: 'seen twice at the depot' },
    };

    for (const term of ['truck', 'vehicle', 'convoy', 'depot']) {
      expect(matchesEntity(entity, term)).toBe(true);
    }
    expect(matchesEntity(entity, 'harbour')).toBe(false);
  });

  it('matches the declared text fields the vocabulary names', () => {
    const truck = { label: 'Truck 12', type: 'vehicle', attrs: { plate: 'AB-123-CD', make: 'Kamaz' } };
    const claim = { label: 'Filmed at the quay', type: 'claim', attrs: { verbatim: 'on the north jetty' } };
    const mark = { label: 'Port notice', type: 'bookmark', attrs: { archive_url: 'https://web.archive.org/x' } };

    expect(matchesEntity(truck, 'AB-123')).toBe(true);
    expect(matchesEntity(truck, 'kamaz')).toBe(true);
    expect(matchesEntity(claim, 'north jetty')).toBe(true);
    expect(matchesEntity(mark, 'web.archive.org')).toBe(true);
  });

  it('leaves numbers, shapes and stored grades out, exactly as the index does', () => {
    // "500" against every radius in a case buries the rows that actually say 500.
    const place = {
      label: 'Quay 4',
      type: 'place',
      attrs: { radius_m: 500, footprint: { type: 'Polygon', coordinates: [] } },
    };
    const claim = { label: 'A statement', type: 'claim', attrs: { confidence: 'probable' } };

    expect(matchesEntity(place, '500')).toBe(false);
    expect(matchesEntity(place, 'polygon')).toBe(false);
    expect(matchesEntity(claim, 'probable')).toBe(false);
    expect(matchesEntity(place, 'quay 4')).toBe(true);
  });

  it('matches everything on an empty term, and survives a missing entity', () => {
    expect(matchesEntity({ label: 'x', type: 'vehicle' }, '   ')).toBe(true);
    expect(matchesEntity(null, 'anything')).toBe(false);
    expect(entitySearchText(undefined)).toBe('');
  });

  it('skips a declared field the entity never filled', () => {
    const bare = { label: 'Truck 12', type: 'vehicle', attrs: { plate: '', make: null } };

    expect(entitySearchText(bare)).toBe('truck 12\nvehicle');
  });
});
