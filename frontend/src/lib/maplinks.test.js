import { describe, it, expect } from 'vitest';
import { mapLinks } from './maplinks.js';

/**
 * The forms asserted here are the ones a browser was actually driven through
 * (`docs/MAP_SITES.md`): opened at a known level, panned a known number of
 * pixels, and read back out of the address bar. What the test guards is the
 * three ways an "Open in…" link lands somewhere else than the view it came
 * from — the wrong axis order, the wrong layer, or a scale that is not a zoom.
 */
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
        'satellites_pro',
        'sentinel',
        'yandex',
        'zoom_earth',
      ].sort()
    );
  });

  it('deliberately excludes the in-tool tile providers (Esri, OSM)', () => {
    expect(byId.esri).toBeUndefined();
    expect(byId.osm).toBeUndefined();
  });

  it('embeds the coordinates in each URL', () => {
    for (const { url } of links) {
      expect(url).toContain('48.8584');
      expect(url).toContain('2.2945');
    }
  });

  it('carries the view zoom to every site that takes one', () => {
    expect(byId.google.url).toContain(',16z');
    expect(byId.google_sat.url).toContain(',16z');
    expect(byId.apple.url).toContain('z=16');
    expect(byId.bing.url).toContain('lvl=16');
    expect(byId.yandex.url).toContain('z=16');
    expect(byId.sentinel.url).toContain('zoom=16');
    expect(byId.zoom_earth.url).toContain(',16z');
    expect(byId.satellites_pro.url).toMatch(/,16$/);
  });

  it('writes longitude first for Yandex, and only for Yandex', () => {
    expect(byId.yandex.url).toContain('ll=2.2945,48.8584');
    expect(byId.apple.url).toContain('ll=48.8584,2.2945');
  });

  it('asks for the satellite layer rather than the site default', () => {
    // Google needs the data code; Zoom Earth opens on live weather without the
    // path; Apple needs map=satellite
    expect(byId.google_sat.url).toContain('/data=!3m1!1e3');
    expect(byId.zoom_earth.url).toContain('/maps/satellite/');
    expect(byId.apple.url).toContain('map=satellite');
    expect(byId.yandex.url).toContain('l=sat');
    expect(byId.bing.url).toContain('style=h');
  });

  it('gives Earth a camera distance that follows the zoom', () => {
    // Earth states no zoom: `d` is a distance, and it halves per level
    const near = mapLinks(48.8584, 2.2945, 17).find((l) => l.id === 'google_earth');
    const far = mapLinks(48.8584, 2.2945, 16).find((l) => l.id === 'google_earth');
    const distance = (link) => Number(/,(\d+)d,/.exec(link.url)[1]);
    expect(distance(far) / distance(near)).toBeCloseTo(2, 2);
    expect(distance(near)).toBeGreaterThan(100);
    expect(distance(near)).toBeLessThan(2000);
  });

  it('never sends Google a viewport height where a zoom belongs', () => {
    // `,2000m` is a span in metres, not a level: it used to pin every satellite
    // link to the same 2 km view whatever the map was showing
    for (const { url } of links) expect(url).not.toMatch(/,\d+m\//);
  });

  it('every entry has a label and an https url', () => {
    for (const { label, url } of links) {
      expect(label).toBeTruthy();
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});
