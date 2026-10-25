import { describe, expect, it, vi } from 'vitest';
import { ADMIN_LEVELS, GROUNDS, NAME_LAYER_IDS, nameOf, PALETTES, PLAIN_GROUNDS, TINTS, darkGround, derived, shieldImage, fontStack, groundPalette, hillshadePaint, hideImageryRelief, mix, plainLayers, present,
  readsHeights, selfShaded, setContours, shadeStrength, showImageryRelief, showPlain, styled, topographic } from './plainBasemap.js';
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
    images: new Map(),
    hasImage(id) { return this.images.has(id); },
    addImage(id, image, options) { this.images.set(id, { image, options }); },
    removeImage(id) { this.images.delete(id); },
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
    showPlain(map, { ground: 'plain-topo', relief, shade: false });
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
    showPlain(map, { ground: 'plain-staff', relief, tints: false, contours: false, peaks: false });
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

describe('the gallery of grounds', () => {
  it('draws every style in a palette and tints it has, the topographic ones alone tracing contour lines', () => {
    for (const [id, style] of Object.entries(GROUNDS)) {
      expect(id.startsWith('plain'), id).toBe(true);
      expect(PALETTES[style.palette], id).toBeDefined();
      if (style.tints) expect(TINTS[style.tints], id).toBeDefined();
      for (const key of ['ground', 'water', 'wood', 'urban', 'road', 'border', 'name', 'halo', 'shade']) expect(PALETTES[style.palette][key], `${id} ${key}`).toBeTruthy();
    }
    expect(PLAIN_GROUNDS.map(([id]) => id)).toEqual(Object.keys(GROUNDS));
    expect(Object.keys(GROUNDS).filter(topographic)).toEqual(['plain-topo', 'plain-staff']);
    // an unknown id, or imagery, reads as the plain ground and traces nothing
    expect(groundPalette('esri-world-imagery')).toBe('light');
    expect(topographic('esri-world-imagery')).toBe(false);
  });

  it('says which grounds shade their own relief, read the heights, and take light words', () => {
    expect(selfShaded('plain-news') && selfShaded('plain-relief') && !selfShaded('plain') && !selfShaded('plain-grey')).toBe(true);
    expect(readsHeights('plain', [])).toBe(false);
    expect(readsHeights('plain', ['relief'])).toBe(true);
    expect(readsHeights('plain-relief', [])).toBe(true);
    // imagery reads them only for the shading asked over it
    expect(readsHeights('esri-world-imagery', [])).toBe(false);
    expect(readsHeights('esri-world-imagery', ['relief'])).toBe(true);
    expect(darkGround('plain-dark') && darkGround('plain-tactical') && darkGround('esri-world-imagery')).toBe(true);
    expect(darkGround('plain') || darkGround('plain-toner') || darkGround('plain-news')).toBe(false);
  });

  it('shades a self-shaded ground at its own strength, by four lights when it says so', () => {
    expect(shadeStrength('plain', {})).toBe(0);
    expect(shadeStrength('plain', { shaded: true })).toBe(0.35);
    expect(shadeStrength('plain-news', {})).toBe(0.45);
    expect(shadeStrength('plain-relief', { intensity: 2 })).toBe(1);
    const map = fakeMap();
    showPlain(map, { ground: 'plain-relief', relief, shade: false });
    const shade = map.getLayer('plate-plain-relief');
    expect(shade.paint['hillshade-method']).toBe('multidirectional');
    expect(shade.paint['hillshade-illumination-direction']).toHaveLength(4);
    expect(shade.paint['hillshade-shadow-color']).toEqual(Array(4).fill(PALETTES.relief.shade));
    // its heights are tinted, and it traces no contour lines
    expect(map.getLayer('plate-plain-tints').paint['color-relief-color'].slice(3, 5)).toEqual(TINTS.relief[0]);
    expect(map.getLayersOrder().some((id) => /contour|peak/.test(id))).toBe(false);
    // a plain ground's one light keeps the shading as it was
    expect(hillshadePaint(PALETTES.light, 0.35)).toEqual({ 'hillshade-shadow-color': PALETTES.light.shade, 'hillshade-exaggeration': 0.35,
      'hillshade-highlight-color': '#ffffff' });
  });

  it('reads no heights for a plain ground that neither shades nor tints them', () => {
    const map = fakeMap();
    showPlain(map, { ground: 'plain-grey', relief: null, shade: false });
    expect(map.getSource('plate-plain-relief')).toBeUndefined();
    expect(map.getLayer('plate-plain-relief')).toBeUndefined();
  });

  it('draws a coast as lines going out into the water, or as a glow', () => {
    const lines = plainLayers(PALETTES.news, { style: GROUNDS['plain-news'] }).filter((layer) => /coast-\d/.test(layer.id));
    expect(lines).toHaveLength(3);
    expect(lines.map((layer) => layer.paint['line-offset'])).toEqual([1.5, 4, 7]);
    expect(lines.every((layer) => layer['source-layer'] === 'water' && layer.filter[2][1].includes('MultiPolygon'))).toBe(true);
    const glow = plainLayers(PALETTES.tactical, { style: GROUNDS['plain-tactical'] }).filter((layer) => layer.id.includes('coast'));
    expect(glow.map((layer) => layer.id)).toEqual(['plate-plain-coast-glow']);
    expect(plainLayers(PALETTES.light).some((layer) => layer.id.includes('coast'))).toBe(false);
  });
});

describe('the words of a plain ground', () => {
  const layer = (layers, id) => layers.find((entry) => entry.id === `plate-plain-${id}`);

  it('writes the countries and regions in spaced capitals, the water in italic, the rivers along their course', () => {
    const layers = plainLayers(PALETTES.light, { font: 'Inter' });
    expect(layer(layers, 'country').layout['text-transform']).toBe('uppercase');
    expect(layer(layers, 'country').layout['text-font'][0]).toBe('"Inter Bold"');
    expect(layer(layers, 'region').maxzoom).toBe(8);
    expect(layer(layers, 'water-name').layout['text-font'][0]).toBe('"Inter Italic"');
    expect(layer(layers, 'river-name').layout['symbol-placement']).toBe('line');
    // a capital in its bold, other places in the plain face
    expect(layer(layers, 'place').layout['text-font']).toEqual(['case', ['==', ['get', 'capital'], 2], ['literal', ['"Inter Bold"', 'Inter', 'sans-serif']], ['literal', ['Inter', 'sans-serif']]]);
    // without names, none of them
    expect(plainLayers(PALETTES.light, { names: false }).some((entry) => /name|country|region|place/.test(entry.id))).toBe(false);
  });

  it("leads a face's stack with the variant the engine reads its weight and slant from", () => {
    expect(styled(['"Source Serif 4"', 'sans-serif'], 'Italic')).toEqual(['"Source Serif 4 Italic"', '"Source Serif 4"', 'sans-serif']);
  });

  it('draws less or more by its detail', () => {
    const ids = (density) => plainLayers(PALETTES.light, { density }).map((entry) => entry.id);
    expect(ids('low')).not.toContain('plate-plain-building');
    expect(ids('low')).not.toContain('plate-plain-road-minor');
    expect(ids('normal')).toContain('plate-plain-road-minor');
    expect(layer(plainLayers(PALETTES.light, { density: 'high' }), 'road-minor').minzoom).toBe(10);
    expect(layer(plainLayers(PALETTES.light, { density: 'high' }), 'place').filter[2][1]).toContain('hamlet');
  });
});

describe('the names the analyst takes off a ground', () => {
  it('reads a name as the map writes it, in its language', () => {
    expect(nameOf({ name: 'Київ', 'name:latin': 'Kyiv', 'name:fr': 'Kiev' }, 'fr')).toBe('Kiev');
    expect(nameOf({ name: 'Київ', 'name:latin': 'Kyiv' }, 'fr')).toBe('Kyiv');
    expect(nameOf({ name: 'Київ', 'name:latin': 'Kyiv' }, 'local')).toBe('Київ');
    expect(nameOf({ name: 'Київ', 'name:latin': '' }, 'latin')).toBe('Київ');
    expect(nameOf({}, 'latin')).toBe('');
  });

  it('leaves the names hidden off every layer that writes names, and only those', () => {
    const layers = plainLayers(PALETTES.light, { hidden_names: ['Kyiv', 'Dnipro'] });
    const named = layers.filter((layer) => NAME_LAYER_IDS.includes(layer.id));
    expect(named.length).toBeGreaterThan(3);
    for (const layer of named) expect(JSON.stringify(layer.filter)).toContain('["literal",["Kyiv","Dnipro"]]');
    const others = layers.filter((layer) => !NAME_LAYER_IDS.includes(layer.id));
    for (const layer of others) expect(JSON.stringify(layer.filter ?? null)).not.toContain('Kyiv');
    // none hidden: the layers as they always were
    expect(plainLayers(PALETTES.light, {})).toEqual(plainLayers(PALETTES.light, { hidden_names: [] }));
  });
});

describe('a ground\'s presence', () => {
  it('draws everything but the land nearer the land, the names half as far', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#123456', '#ffffff', 0)).toBe('#123456');
    expect(present(PALETTES.light, 1)).toBe(PALETTES.light);
    const quiet = present(PALETTES.light, 0.5);
    expect(quiet.ground).toBe(PALETTES.light.ground);
    expect(quiet.water).toBe(mix(PALETTES.light.water, PALETTES.light.ground, 0.5));
    expect(quiet.name).toBe(mix(PALETTES.light.name, PALETTES.light.ground, 0.25));
    // never quieter than a fifth
    expect(present(PALETTES.light, 0)).toEqual(present(PALETTES.light, 0.2));
  });

  it('is what the ground is drawn in', () => {
    const map = fakeMap();
    showPlain(map, { ground: 'plain', presence: 0.4 });
    expect(map.getLayer('plate-plain-water').paint['fill-color']).toBe(present(PALETTES.light, 0.4).water);
  });
});

describe('the relief over imagery', () => {
  it('stands just over the picture, by four lights, and goes when asked', () => {
    const map = fakeMap();
    map.addLayer({ id: 'imagery' });
    map.addLayer({ id: 'roads-overlay' });
    showImageryRelief(map, { relief, over: 'imagery', strength: 0.35 });
    expect(map.getLayersOrder()).toEqual(['imagery', 'plate-imagery-relief', 'roads-overlay']);
    expect(map.getLayer('plate-imagery-relief').paint['hillshade-method']).toBe('multidirectional');
    hideImageryRelief(map);
    expect(map.getLayersOrder()).toEqual(['imagery', 'roads-overlay']);
    expect(map.getSource('plate-imagery-heights')).toBeUndefined();
    // no heights known, or no picture yet: nothing is laid
    showImageryRelief(map, { relief: null, over: 'imagery' });
    showImageryRelief(map, { relief, over: 'nothing' });
    expect(map.getLayersOrder()).toEqual(['imagery', 'roads-overlay']);
  });
});

describe('what an investigation reads on a plain ground', () => {
  const ids = (options) => plainLayers(PALETTES.light, options).map((entry) => entry.id.replace('plate-plain-', ''));
  const find = (options, id) => plainLayers(PALETTES.light, options).find((entry) => entry.id === `plate-plain-${id}`);

  it('draws airfields, military ground, fields and the road numbers, each left out on its own', () => {
    const all = ids({});
    for (const id of ['runway', 'taxiway', 'apron', 'airfield-name', 'military', 'military-edge', 'cover-fields', 'cover-sand', 'cover-ice', 'cover-marsh', 'ref', 'ferry', 'pier']) {
      expect(all, id).toContain(id);
    }
    expect(ids({ airfields: false }).some((id) => /runway|taxiway|apron|airfield/.test(id))).toBe(false);
    expect(ids({ military: false }).some((id) => id.startsWith('military'))).toBe(false);
    expect(ids({ cover: false }).some((id) => id.startsWith('cover'))).toBe(false);
    expect(ids({ refs: false })).not.toContain('ref');
    // no roads, no numbers on them
    expect(ids({ roads: false })).not.toContain('ref');
    // the fields lie under the towns, the runways over the water and under the roads
    expect(all.indexOf('cover-fields')).toBeLessThan(all.indexOf('urban'));
    expect(all.indexOf('runway')).toBeGreaterThan(all.indexOf('water'));
    expect(all.indexOf('runway')).toBeLessThan(all.indexOf('road'));
  });

  it('draws the borders to the depth asked, the disputed ones dotted and the ones at sea faint', () => {
    expect(ADMIN_LEVELS).toEqual({ countries: 2, regions: 4, districts: 6 });
    expect(find({ admin: 'countries' }, 'border').filter[1]).toEqual(['<=', ['get', 'admin_level'], 2]);
    expect(find({}, 'border').filter[1]).toEqual(['<=', ['get', 'admin_level'], 4]);
    expect(ids({})).not.toContain('border-district');
    expect(find({ admin: 'districts' }, 'border-district').minzoom).toBe(8);
    expect(find({}, 'border').filter).toContainEqual(['!=', ['get', 'disputed'], 1]);
    expect(find({}, 'border-disputed').paint['line-dasharray']).toEqual([1, 2.5]);
    expect(find({}, 'border-sea').filter).toContainEqual(['==', ['get', 'maritime'], 1]);
  });

  it('lends each style quiet colours for what it holds none of, a dark ground staying dark', () => {
    const light = derived(PALETTES.light);
    const dark = derived(PALETTES.dark);
    for (const value of [...Object.values(light), ...Object.values(dark)]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    const lightness = (hex) => [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);
    expect(lightness(dark.runway)).toBeLessThan(lightness(light.runway));
    expect(lightness(dark.shield)).toBeLessThan(300);
  });

  it('writes the road numbers on a shield it draws itself, and takes it away with the ground', () => {
    const picture = shieldImage('#ffffff', '#000000');
    expect(picture.data).toHaveLength(picture.width * picture.height * 4);
    // the corner is see-through, the rim dark, the middle light
    expect(picture.data[3]).toBe(0);
    const at = (x, y) => [...picture.data.slice((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3)];
    expect(at(0, 10)).toEqual([0, 0, 0]);
    expect(at(12, 10)).toEqual([255, 255, 255]);
    const map = fakeMap();
    showPlain(map, { ground: 'plain' });
    expect(map.images.has('plate-plain-shield')).toBe(true);
    expect(map.getLayer('plate-plain-ref').layout['icon-image']).toBe('plate-plain-shield');
    showPlain(map, { ground: 'plain', refs: false });
    expect(map.images.has('plate-plain-shield')).toBe(false);
  });
});
