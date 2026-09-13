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

  it('gives Earth the camera that shows the same level in a 1000 px window', () => {
    // Earth's view is 2·d·tan(y/2) metres tall, measured; z17 at 48.86° is
    // 0.6 m a pixel, so 1000 px of it is 600 m and d is 600 / (2·tan 17.5°)
    const earth = (zoom, lat = 48.8584) => mapLinks(lat, 2.2945, zoom).find((l) => l.id === 'google_earth');
    const camera = (link) => /@[^/]*/.exec(link.url)[0].split(',');
    const [, , a, d, y, h, t] = camera(earth(17));
    expect([a, y, h, t]).toEqual(['0a', '35y', '0h', '0t']);
    const metresPerPx = (156543.03392804097 * Math.cos((48.8584 * Math.PI) / 180)) / 2 ** 17;
    expect(parseFloat(d)).toBeCloseTo((metresPerPx * 1000) / (2 * Math.tan((17.5 * Math.PI) / 180)), -1);
    const distance = (link) => parseFloat(camera(link)[3]);
    expect(distance(earth(16)) / distance(earth(17))).toBeCloseTo(2, 2);
    // nearer the pole a level is less ground, so the camera comes down
    expect(distance(earth(17, 70))).toBeLessThan(distance(earth(17, 10)));
    // …and never under the 25 m Earth stops at
    expect(distance(earth(23))).toBe(25);
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
