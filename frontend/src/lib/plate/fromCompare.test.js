import { describe, expect, it } from 'vitest';
import { FALLBACK_GROUND, compareView, comparisonOnPlate, lostSaid, pairBoxes, pairOnComparison, plateBearing, sideDay, sideGround } from './fromCompare.js';
import { fromTemplate } from './page.js';
import { readyTemplate } from './gallery.js';
import { toMercator } from '../map/groundFrame.js';
import { PX_PER_MM } from './page.js';

const offered = ['plain', 'esri-world-imagery', 'esri-wayback', 's2cloudless', 'sentinel2', 'osm', 'opentopomap'];
let count = 0;
const newId = (kind) => `${kind}-${++count}`;
const theme = { paper: '#ffffff', ink: '#15181e', accent: '#c8102e' };

describe('a comparison laid on a plate', () => {
  it('turns Compare\'s bearing the plate\'s way, folded from -180 to 180', () => {
    expect(plateBearing(0)).toBe(0);
    expect(plateBearing(30)).toBe(-30);
    expect(plateBearing(330)).toBe(30);
    expect(plateBearing(180)).toBe(-180);
    expect(plateBearing(undefined)).toBe(0);
  });

  it('looks where the camera does, a step further out, when no frame was drawn', () => {
    expect(compareView({ camera: { lat: 47.5, lon: 34.6, zoom: 16.4, bearing: 20 } }, [0, 0, 100, 75]))
      .toEqual({ lat: 47.5, lon: 34.6, zoom: 15.4, bearing: -20 });
    expect(compareView({ camera: { lat: 0, lon: 0, zoom: 0.4, bearing: 0 } }, [0, 0, 100, 75]).zoom).toBe(0);
  });

  it('fills a map with the export frame, its middle in the middle, turned as it was drawn', () => {
    const frame = { points: [[34.60, 47.51], [34.62, 47.50]], angle: 0 };
    const box = [0, 0, 120, 90];
    const view = compareView({ camera: { lat: 0, lon: 0, zoom: 3, bearing: 0 }, frame }, box);
    expect(view.lon).toBeCloseTo(34.61, 4);
    expect(view.lat).toBeCloseTo(47.505, 3);
    // the frame's width, at that zoom, spans the map's width or less, and nearly all of one side
    const [x1] = toMercator(34.60, 47.51);
    const [x2] = toMercator(34.62, 47.50);
    const pixels = ((x2 - x1) * 512 * 2 ** view.zoom) / 40075016.686;
    expect(pixels).toBeLessThanOrEqual(120 * PX_PER_MM);
    expect(pixels).toBeGreaterThan(120 * PX_PER_MM * 0.6);
    expect(compareView({ camera: { lat: 0, lon: 0, zoom: 3, bearing: 0 }, frame: { ...frame, angle: 90 } }, box).bearing).toBe(-90);
  });

  it('keeps a side\'s ground and day where a plate draws it, and lays the rest on World Imagery', () => {
    expect(sideGround({ provider: 'esri-wayback', wayback_release: 41 }, offered)).toEqual({ ground: { basemap: 'esri-wayback', release: 41 }, lost: '' });
    expect(sideGround({ provider: 'sentinel2', sentinel: { layer: 'TRUE_COLOR', date: '2025-10-03', maxcc: 30 } }, offered))
      .toEqual({ ground: { basemap: 'sentinel2', acquired: '2025-10-03', product: '', maxcc: 30 }, lost: '' });
    expect(sideGround({ provider: 'sentinel2', sentinel: { layer: 'FALSE_COLOR', date: '', maxcc: 100 } }, offered).ground)
      .toEqual({ basemap: 'sentinel2', acquired: null, product: 'FALSE_COLOR', maxcc: 100 });
    // a layer name a plate could not keep falls back to true colour
    expect(sideGround({ provider: 'sentinel2', sentinel: { layer: 'custom script/1' } }, offered).ground.product).toBe('');
    expect(sideGround({ provider: 'sentinel1-radar' }, offered)).toEqual({ ground: { basemap: FALLBACK_GROUND }, lost: 'sentinel1-radar' });
    // Sentinel-2 without its account is not offered, so it falls back too and says so
    expect(sideGround({ provider: 'sentinel2' }, offered.filter((id) => id !== 'sentinel2')).lost).toBe('sentinel2');
    expect(sideGround(undefined, offered)).toEqual({ ground: { basemap: FALLBACK_GROUND }, lost: '' });
  });

  it('sets the pair in the middle of the page, side by side or one over the other, never overlapping', () => {
    for (const [width, height] of [[297, 210], [210, 297], [338.7, 190.5], [100, 100]]) {
      const [a, b] = pairBoxes(width, height);
      for (const [x, y, w, h] of [a, b]) {
        expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(width + 0.1); expect(y + h).toBeLessThanOrEqual(height + 0.1);
      }
      const apart = a[0] + a[2] <= b[0] || a[1] + a[3] <= b[1];
      expect(apart).toBe(true);
      expect(width >= height ? a[1] === b[1] : a[0] === b[0]).toBe(true);
    }
  });

  it('makes two grouped maps and a badge on each, saying each day or Before and After, and what a plate could not draw', () => {
    const session = { title: 'Energodar', spec: { camera: { lat: 47.5, lon: 34.6, zoom: 16, bearing: 0 },
      a: { provider: 'esri-wayback', wayback_release: 41 }, b: { provider: 'firms' } } };
    const layers = [{ name: 'front', hidden: [], stroke: 1, icons: 1 }];
    const made = comparisonOnPlate(session, { width: 297, height: 210, offered, layers, theme, newId, group: 'g1',
      dayOf: (map) => (map.basemap === 'esri-wayback' ? '12 Mar 2024' : '') });
    expect(made.elements.map((element) => element.kind)).toEqual(['map', 'map', 'text', 'text']);
    expect(made.elements.every((element) => element.group === 'g1')).toBe(true);
    const [before, after, first, second] = made.elements;
    expect([before.name, after.name]).toEqual(['Energodar, before', 'Energodar, after']);
    expect([before.basemap, before.release, after.basemap]).toEqual(['esri-wayback', 41, 'esri-world-imagery']);
    expect(before.view).toEqual(after.view);
    expect(before.view).not.toBe(after.view);
    expect(before.layers).toEqual(layers);
    expect(before.layers).not.toBe(layers);
    expect([first.text, second.text]).toEqual(['12 Mar 2024', 'After']);
    expect(first.role).toBe('badge');
    expect(first.box[0]).toBe(before.box[0] + 3);
    expect(made.lost).toEqual(['firms']);
  });
});

describe('Before and after set on a comparison', () => {
  const session = { title: 'Energodar', spec: { camera: { lat: 47.5, lon: 34.6, zoom: 16, bearing: 30 },
    a: { provider: 'sentinel2', sentinel: { layer: 'TRUE_COLOR', date: '2022-03-04', maxcc: 20 } }, b: { provider: 'esri-wayback', wayback_release: 41 } } };
  const ready = () => fromTemplate(readyTemplate('before-after'), { view: { lat: 0, lon: 0, zoom: 3, bearing: 0 }, layers: ['front'] }).elements;

  it('lays its two maps on the sides\' grounds and days, where the comparison looks, each badge saying its day', () => {
    const elements = ready();
    const made = pairOnComparison(elements, session, { offered, dayOf: (map) => ({ sentinel2: '4 Mar 2022', 'esri-wayback': '12 Mar 2024' })[map.basemap] ?? '' });
    const before = made.elements.find((element) => element.id === 'before');
    const after = made.elements.find((element) => element.id === 'after');
    expect(before).toMatchObject({ basemap: 'sentinel2', acquired: '2022-03-04', product: '', maxcc: 20 });
    expect(after).toMatchObject({ basemap: 'esri-wayback', release: 41 });
    expect(before.view).toEqual(compareView(session.spec, before.box));
    expect(before.view.bearing).toBe(-30);
    // what the recipe set beside the ground stays: the box, the frame, the layers
    expect(before.box).toEqual(elements.find((element) => element.id === 'before').box);
    expect(before.layers.map((entry) => entry.name)).toEqual(['front']);
    expect(made.elements.find((element) => element.id === 'before-badge').text).toBe('4 Mar 2022');
    expect(made.elements.find((element) => element.id === 'after-badge').text).toBe('12 Mar 2024');
    expect(made.elements.map((element) => element.id)).toEqual(elements.map((element) => element.id));
    expect(made.lost).toEqual([]);
  });

  it('keeps a badge\'s words for a side with no day, lets the recipe\'s ground go, and says what it could not draw', () => {
    const elements = ready().map((element) => (element.id === 'before' ? { ...element, release: 12 } : element));
    const made = pairOnComparison(elements, { spec: { camera: session.spec.camera, a: { provider: 'sentinel1-radar' }, b: { provider: 'esri-world-imagery' } } }, { offered });
    const before = made.elements.find((element) => element.id === 'before');
    expect(before.basemap).toBe(FALLBACK_GROUND);
    expect(before.release).toBeUndefined();
    expect(made.elements.find((element) => element.id === 'before-badge').text).toBe('Before');
    expect(made.elements.find((element) => element.id === 'after-badge').text).toBe('After');
    expect(made.lost).toEqual(['sentinel1-radar']);
  });

  it('writes a side\'s day as the Layers tab does, and nothing for a pass not picked yet', () => {
    const read = { grounds: [['esri-wayback', 'Wayback']], releases: [{ release: 41, date: '2024-03-12' }], years: [] };
    expect(sideDay({ basemap: 'esri-wayback', release: 41 }, read)).toBe('12 Mar 2024');
    expect(sideDay({ basemap: 'sentinel2', acquired: '2022-03-04' }, read)).toBe('4 Mar 2022');
    expect(sideDay({ basemap: 'sentinel2', acquired: null }, read)).toBe('');
    expect(sideDay({ basemap: 'esri-world-imagery' }, read)).toBe('');
  });

  it('names what it laid on World Imagery once, and the account a side waits for', () => {
    const providers = [{ id: 'sentinel1-radar', label: 'Sentinel-1 radar' }, { id: 'sentinel2', label: 'Sentinel-2', needs_key: true }];
    expect(lostSaid([], providers)).toBe('');
    expect(lostSaid(['sentinel1-radar', 'sentinel1-radar'], providers)).toBe('Sentinel-1 radar laid on World Imagery: a plate cannot draw it');
    expect(lostSaid(['firms', 'sentinel2'], providers))
      .toBe('firms and Sentinel-2 laid on World Imagery: a plate cannot draw them until its account is set up in Settings › Imagery');
  });
});
