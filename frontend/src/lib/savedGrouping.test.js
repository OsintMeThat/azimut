import { describe, it, expect } from 'vitest';
import { groupKey } from './savedGrouping.js';

describe('groupKey', () => {
  it('buckets plain media entities under Media Library', () => {
    expect(groupKey({ type: 'media', provenance: { by: 'media-library' } })).toBe('media-library');
  });

  it('buckets satellite captures under Media Library, not Satellite', () => {
    // a capture is a filed image first — the fact that the satellite tool
    // produced it (provenance.by === 'satellite') shouldn't override that
    expect(groupKey({ type: 'capture', provenance: { by: 'satellite' } })).toBe('media-library');
  });

  it('buckets a non-image entity by its producing tool', () => {
    expect(groupKey({ type: 'place', provenance: { by: 'satellite' } })).toBe('satellite');
    expect(groupKey({ type: 'proof', provenance: { by: 'proof-composer' } })).toBe('proof-composer');
  });

  it('falls back to "user" for an unknown or missing producing tool', () => {
    expect(groupKey({ type: 'note', provenance: { by: 'user' } })).toBe('user');
    expect(groupKey({ type: 'note' })).toBe('user');
    expect(groupKey({ type: 'place', provenance: { by: 'some-future-tool' } })).toBe('user');
  });
});
