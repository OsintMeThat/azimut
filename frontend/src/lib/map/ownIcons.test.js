import { describe, expect, it } from 'vitest';
import { iconVersion, layerIconUrl } from './ownIcons.js';

describe("a layer's icon address", () => {
  it('names the case, the layer and the key, and the version when given', () => {
    expect(layerIconUrl('c1', 'Yemen War', 'abc')).toBe('/api/cases/c1/map-layers/Yemen%20War/icons/abc');
    expect(layerIconUrl('c1', 'Yemen War', 'abc', 'f00')).toBe('/api/cases/c1/map-layers/Yemen%20War/icons/abc?v=f00');
  });

  it("moves with a source's snapshot, and never for a personal layer", () => {
    const before = iconVersion({ sha256: 'a'.repeat(64) });
    expect(before).toBe('a'.repeat(16));
    expect(iconVersion({ sha256: 'b'.repeat(64) })).not.toBe(before);
    // a personal layer's hash moves with every edit, and its pictures never change under a key
    expect(iconVersion({ editable: true, sha256: 'a'.repeat(64) })).toBe('');
    expect(iconVersion(null)).toBe('');
  });
});
