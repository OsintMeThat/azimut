import { describe, expect, it, vi } from 'vitest';
import { PALETTES, TINTS, fontStack, groundPalette, plainLayers, setContours, showPlain, topographic } from './plainBasemap.js';
import { FONTS } from './page.js';

/** A map that keeps its sources and layers, in order. */
function fakeMap() {
  const layers = [];
  const sources = new Map();
  return {
    layers, sources,
    getLayersOrder: () => layers.map((layer) => layer.id),
    getLayer: (id) => layers.find((layer) => layer.id === id),
    addLayer: (layer, before) => { const at = before ? layers.findIndex((item) => item.id === before) : -1; if (at < 0) layers.push(layer); else layers.splice(at, 0, layer); },
    removeLayer: (id) => layers.splice(layers.findIndex((layer) => layer.id === id), 1),
    addSource: (id, source) => sources.set(id, { ...source, setData: vi.fn() }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
  };
}

const relief = { tiles: '/api/terrain/tiles/{z}/{x}/{y}', tile_size: 512, max_zoom: 12, encoding: 'terrarium', sources: [{ attribution: '© Mapterhorn' }] };

describe('the topographic grounds', () => {
  it('are told apart from the plain ones by their palette', () => {
    expect(groundPalette('plain-topo')).toBe('topo');
    expect(groundPalette('plain-staff')).toBe('staff');
    expect(groundPalette('plain-dark')).toBe('dark');
    expect(groundPalette('plain')).toBe('light');
    expect(topographic('plain-topo') && topographic('plain-staff') && !topographic('plain')).toBe(true);
  });

  it('tint the heights, shade them, trace the contour lines and name the summits, over the land and under the names', () => {
    const map = fakeMap();
    showPlain(map, { palette: 'topo', relief, shade: false });
    const order = map.getLayersOrder();
    const at = (id) => order.indexOf(`plate-plain-${id}`);
    expect(at('tints')).toBeGreaterThan(at('ground'));
    expect(at('tints')).toBeLessThan(at('wood'));
    // a topographic ground is shaded whether or not the shading is asked for
    expect(at('relief')).toBeGreaterThan(-1);
    expect(at('contour')).toBeGreaterThan(at('road'));
    expect(at('contour-label')).toBeGreaterThan(at('contour-index'));
    expect(at('peak')).toBeGreaterThan(at('place'));
    const tints = map.getLayer('plate-plain-tints');
    expect(tints.type).toBe('color-relief');
    expect(tints.paint['color-relief-color'].slice(3, 5)).toEqual(TINTS.topo[0]);
    // the contour lines are traced afterwards, for the view
    setContours(map, { type: 'FeatureCollection', features: [{ type: 'Feature' }] });
    expect(map.getSource('plate-plain-contours').setData).toHaveBeenCalled();
  });

  it('leaves out what the plate unticks, and a plain ground stays as it was', () => {
    const map = fakeMap();
    showPlain(map, { palette: 'staff', relief, tints: false, contours: false, peaks: false });
    expect(map.getLayersOrder().some((id) => /tints|contour|peak/.test(id))).toBe(false);
    expect(map.getSource('plate-plain-contours')).toBeUndefined();
    const plain = plainLayers(PALETTES.light).map((layer) => layer.id);
    expect(plain.some((id) => /contour|peak/.test(id))).toBe(false);
    expect(plainLayers(PALETTES.light).find((layer) => layer.id === 'plate-plain-wood').paint['fill-opacity']).toBe(0.8);
  });

  it('keeps the railways when the roads go, and the other way round', () => {
    const ids = (options) => plainLayers(PALETTES.light, options).map((layer) => layer.id);
    expect(ids({ roads: false })).toContain('plate-plain-rail');
    expect(ids({ roads: false })).not.toContain('plate-plain-road');
    expect(ids({ rails: false })).toContain('plate-plain-road');
    expect(ids({ rails: false })).not.toContain('plate-plain-rail');
  });
});

describe('the font stack the engine writes names in', () => {
  it('keeps the quotes a family name needs, so the canvas reads it as a font', () => {
    expect(fontStack('"Source Serif 4", "Noto Sans Arabic"')).toEqual(['"Source Serif 4"', 'Noto Sans Arabic', 'sans-serif']);
    expect(fontStack('Inter, "Noto Sans Arabic"')).toEqual(['Inter', 'Noto Sans Arabic', 'sans-serif']);
  });

  it('gives every face a plate offers a stack a canvas font takes whole', () => {
    // a name the canvas cannot read leaves its font at the 10px default, every place name with it
    const readable = /^"[^"]+"$|^-?[A-Za-z_][\w-]*(\s+-?[A-Za-z_][\w-]*)*$/;
    for (const { family } of Object.values(FONTS)) {
      for (const name of fontStack(family)) expect(name).toMatch(readable);
    }
  });
});
