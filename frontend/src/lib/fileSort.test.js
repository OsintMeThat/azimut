import { describe, expect, it } from 'vitest';
import { sortFileEntities } from './fileSort.js';

const entity = (id, label, extra = {}) => ({
  id,
  label,
  type: 'media',
  provenance: { at: '2026-01-01T00:00:00Z' },
  ...extra,
});

describe('sortFileEntities', () => {
  const rows = [
    entity('1', 'file 10', { type: 'note', provenance: { at: '2026-01-03T00:00:00Z' } }),
    entity('2', 'file 2', { type: 'media', provenance: { at: '2026-01-01T00:00:00Z' } }),
    entity('3', 'file 1', { type: 'proof', provenance: { at: '2026-01-02T00:00:00Z' } }),
  ];

  it('sorts names naturally in both directions', () => {
    expect(sortFileEntities(rows).map((e) => e.label)).toEqual(['file 1', 'file 2', 'file 10']);
    expect(sortFileEntities(rows, { direction: 'desc' }).map((e) => e.label)).toEqual([
      'file 10', 'file 2', 'file 1',
    ]);
  });

  it('sorts type, size and added values across the complete input', () => {
    expect(sortFileEntities(rows, { sort: 'type' }).map((e) => e.id)).toEqual(['2', '1', '3']);
    const sizes = { 1: 100, 2: 10, 3: 50 };
    expect(sortFileEntities(rows, { sort: 'size', sizeOf: (e) => sizes[e.id] }).map((e) => e.id)).toEqual([
      '2', '3', '1',
    ]);
    expect(sortFileEntities(rows, { sort: 'recent', direction: 'desc' }).map((e) => e.id)).toEqual([
      '1', '3', '2',
    ]);
  });

  it('keeps missing values last in either direction', () => {
    const withMissing = [...rows, entity('4', 'missing', { provenance: {} })];
    expect(sortFileEntities(withMissing, { sort: 'recent' }).at(-1).id).toBe('4');
    expect(sortFileEntities(withMissing, { sort: 'recent', direction: 'desc' }).at(-1).id).toBe('4');
  });
});
