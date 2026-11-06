import { describe, expect, it } from 'vitest';
import { FREE_IMAGERY } from './imageryTerms.js';

describe('what the free imagery may be used for', () => {
  it('says it for each source in one plain sentence or two, with the page it comes from', () => {
    expect(FREE_IMAGERY.map((source) => source.id)).toEqual(['esri', 'eox', 'osm']);
    for (const source of FREE_IMAGERY) {
      expect(source.name).toBeTruthy();
      expect(source.reuse.length).toBeGreaterThan(40);
      expect(source.link).toMatch(/^https:\/\//);
      expect(source.reuse).not.toMatch(/—/); // no em-dash appositives in the copy
    }
  });

  it("names what Esri's terms leave out, which is the default basemap's rule to know", () => {
    const esri = FREE_IMAGERY.find((source) => source.id === 'esri');
    expect(esri.reuse).toContain('a report or presentation for a client');
    expect(esri.reuse).toContain("needs Esri's permission");
  });
});
