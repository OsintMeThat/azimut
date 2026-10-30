import { describe, expect, it } from 'vitest';
import {
  FREE_FAR_PROVIDER,
  farTile,
  flatReach,
  guardedTemplate,
  readGuarded,
  tileCentre,
  tileSource,
} from './quotaGuard.js';

/** A 1200 × 800 view over Bern at engine zoom 13, tilted. */
const VIEW = { lat: 46.95, lon: 7.45, zoom: 13, width: 1200, height: 800, pitch: 60 };

/** The XYZ tile under a point. */
function tileAt(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x, y };
}

describe('billed imagery past the flat view', () => {
  it('knows how far a flat view reaches', () => {
    // about 6.5 m a pixel at engine z13 there (512 px tiles), half a 1442 px diagonal
    expect(flatReach(VIEW)).toBeCloseTo(4703, -1);
  });

  it('keeps the ground near the centre on the chosen provider', () => {
    expect(farTile(tileAt(46.95, 7.45, 14), VIEW)).toBe(false);
    expect(farTile(tileAt(46.99, 7.47, 14), VIEW)).toBe(false);
  });

  it('sends the far ground of a tilted view to the free provider', () => {
    const far = tileAt(47.4, 7.45, 12); // 50 km north
    expect(farTile(far, VIEW)).toBe(true);
    expect(tileSource({ ...far, providerId: 'sentinel2' }, VIEW)).toEqual({
      far: true,
      provider: FREE_FAR_PROVIDER,
      url: `/api/tiles/${FREE_FAR_PROVIDER}/${far.z}/${far.x}/${far.y}`,
    });
  });

  it('never swaps anything on a map looking straight down', () => {
    expect(farTile(tileAt(47.4, 7.45, 12), { ...VIEW, pitch: 0 })).toBe(false);
  });

  it('counts a big tile near if any of it is', () => {
    // a z5 tile is a thousand km wide: its centre is far, its edge is here
    expect(farTile(tileAt(46.95, 7.45, 5), VIEW)).toBe(false);
  });

  it('round-trips the guarded address', () => {
    const template = guardedTemplate('m3', 'google-satellite');
    expect(template).toBe('azimut-billed://m3/google-satellite/{z}/{x}/{y}');
    expect(readGuarded('azimut-billed://m3/google-satellite/12/2133/1446')).toEqual({
      mapId: 'm3', providerId: 'google-satellite', z: 12, x: 2133, y: 1446,
    });
    expect(readGuarded('/api/tiles/esri/1/2/3')).toBeNull();
  });

  it('puts a tile centre where the grid says', () => {
    const { lat, lon } = tileCentre(1, 1, 0);
    expect(lon).toBeCloseTo(90, 9);
    expect(lat).toBeGreaterThan(60);
  });
});
