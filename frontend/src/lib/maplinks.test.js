import { describe, it, expect } from 'vitest';
import { mapLinks } from './maplinks.js';

describe('mapLinks', () => {
  const links = mapLinks(48.8584, 2.2945, 16);
  const byId = Object.fromEntries(links.map((l) => [l.id, l]));

  it('covers the external maps not embeddable in-tool', () => {
    expect(links.map((l) => l.id).sort()).toEqual(
      [
        'apple',
        'bing',
        'google',
        'google_earth',
        'google_sat',
        'sentinel',
        'yandex',
        'zoom_earth',
      ].sort()
    );
  });

  it('deliberately excludes the in-tool tile providers (Esri, OSM) and duplicates', () => {
    expect(byId.esri).toBeUndefined();
    expect(byId.osm).toBeUndefined();
    // Satellites.pro was dropped: its basemaps are the other links' imagery
    expect(byId.satellites_pro).toBeUndefined();
  });

  it('embeds the coordinates in each URL', () => {
    for (const { url } of links) {
      expect(url).toContain('48.8584');
      expect(url).toContain('2.2945');
    }
  });

  it('rounds zoom and uses lon,lat order for Yandex', () => {
    expect(byId.google.url).toContain(',16z');
    expect(byId.yandex.url).toContain('ll=2.2945,48.8584');
  });

  it('every entry has a label and an https url', () => {
    for (const { label, url } of links) {
      expect(label).toBeTruthy();
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});
