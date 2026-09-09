// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashArray, dashKey, metreRing, shapeGeometry, styleProperties } from './surface.js';

/**
 * The surface is exercised against a stubbed map, because what it must get
 * right is the *translation*: which style words become which properties, which
 * shape kind becomes which geometry, and — the reason the module exists — that
 * changing one shape of a thousand does not rebuild the other 999.
 *
 * The geometry and the style translation are pure, so those are read straight
 * off the functions; the rest is read off the calls a stubbed map recorded.
 */

describe('styles keep their own words', () => {
  it('translates them into the properties the paint expressions read', () => {
    expect(
      styleProperties({ stroke: '#fff', strokeWidth: 2.5, strokeOpacity: 0.9 })
    ).toMatchObject({ stroke: '#fff', strokeWidth: 2.5, strokeOpacity: 0.9 });
  });

  it('resolves every value the layers ask for', () => {
    // `['get', 'strokeOpacity']` on a shape that never mentioned it reads as 0,
    // which paints nothing at all — so nothing is left to an expression default
    const properties = styleProperties({ stroke: '#fff' });
    expect(properties.strokeWidth).toBe(3);
    expect(properties.strokeOpacity).toBe(1);
    expect(properties.radius).toBe(10);
    expect(properties.interactive).toBe(true);
  });

  it('reads a fill colour as "there is a fill", and its absence as none', () => {
    expect(styleProperties({ fill: '#2b3040', fillOpacity: 0.62 })).toMatchObject({
      fill: '#2b3040',
      fillOpacity: 0.62,
    });
    // the fill layer filters on having the key at all, so an unfilled shape
    // must not carry a transparent one
    expect(styleProperties({ stroke: '#fff' })).not.toHaveProperty('fill');
    expect(styleProperties({ stroke: '#fff' })).not.toHaveProperty('fillOpacity');
  });

  it('keeps a transparent fill, which is not the same as no fill', () => {
    // an unchecked grid cell is a bright outline over nothing: a fill at zero
    // opacity, so the imagery reads through and the cell still answers a click
    expect(styleProperties({ fill: '#fff', fillOpacity: 0 })).toMatchObject({
      fill: '#fff',
      fillOpacity: 0,
    });
  });

  it('lets a shape refuse the pointer', () => {
    expect(styleProperties({ interactive: false }).interactive).toBe(false);
  });

  it('leaves a shape with no dash out of every dashed layer', () => {
    expect(styleProperties({ stroke: '#fff' })).not.toHaveProperty('dashKey');
    expect(styleProperties({ stroke: '#fff', dash: null })).not.toHaveProperty('dashKey');
  });
});

describe('a dash pattern', () => {
  it('carries the stroke width, because the engine scales it by that', () => {
    // callers write pixels, as the old engine took them
    expect(dashKey('6 6', 3.5)).toBe('6-6@3.5');
    expect(dashKey('5,4', 1.5)).toBe('5-4@1.5');
  });

  it('comes back in the units the engine wants', () => {
    // 6 px of dash on a 3.5 px stroke is 1.714 stroke widths
    expect(dashArray('6-6@3.5')).toEqual([6 / 3.5, 6 / 3.5]);
    expect(dashArray('5-4@1.5')).toEqual([5 / 1.5, 4 / 1.5]);
  });
});

describe('shapes become geometry', () => {
  it('writes a line as its points, longitude first', () => {
    expect(
      shapeGeometry({ kind: 'line', points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] })
    ).toEqual({ type: 'LineString', coordinates: [[2, 1], [4, 3]] });
  });

  it('closes a polygon the caller left open', () => {
    const ring = shapeGeometry({
      kind: 'polygon',
      points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 1, lon: 1 }],
    });
    expect(ring.coordinates[0]).toEqual([[0, 0], [0, 1], [1, 1], [0, 0]]);
  });

  it('writes an extent as its four corners', () => {
    expect(shapeGeometry({ kind: 'rect', bounds: { north: 4, south: 1, east: 8, west: 2 } })).toEqual(
      {
        type: 'Polygon',
        coordinates: [[[2, 1], [8, 1], [8, 4], [2, 4], [2, 1]]],
      }
    );
  });

  it('tells a pixel dot from a radius on the ground', () => {
    expect(shapeGeometry({ kind: 'dot', at: { lat: 1, lon: 2 } })).toEqual({
      type: 'Point',
      coordinates: [2, 1],
    });
    // a circle in metres is a claim about the ground, so it is traced on it
    const circle = shapeGeometry({ kind: 'circle', at: { lat: 48.85, lon: 2.29 }, radiusM: 500 });
    expect(circle.type).toBe('Polygon');
    expect(circle.coordinates[0]).toHaveLength(65);
    expect(circle.coordinates[0][0]).toEqual(circle.coordinates[0].at(-1));
  });

  it('traces a ring that really is that far away', () => {
    const [, north] = metreRing({ lat: 0, lon: 0 }, 1000).coordinates[0][0];
    // 1 km north of the equator is about 0.009°
    expect(north).toBeCloseTo(0.009, 3);
  });

  it('passes a footprint through as the geometry it already is', () => {
    const geometry = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
    expect(shapeGeometry({ kind: 'geojson', geometry })).toBe(geometry);
  });

  it('refuses a shape it does not know, rather than drawing nothing', () => {
    expect(() => shapeGeometry({ kind: 'blob' })).toThrow(/unknown shape/);
  });
});

// --- the stateful half -------------------------------------------------------

let createSurface;
let marks;
let cards;

/** A Marker/Popup pair that records what was asked of it. */
function stubClasses() {
  marks = [];
  cards = [];
  class Marker {
    constructor(options) {
      this.options = options;
      this.element = options.element;
      this.handlers = {};
      this.lngLat = null;
      this.offset = options.offset;
      this.removed = 0;
      marks.push(this);
    }
    setLngLat(at) {
      this.lngLat = at;
      return this;
    }
    getLngLat() {
      return { lat: this.lngLat[1], lng: this.lngLat[0] };
    }
    getElement() {
      return this.element;
    }
    setOffset(offset) {
      this.offset = offset;
      return this;
    }
    addTo() {
      this.added = true;
      return this;
    }
    on(name, handler) {
      this.handlers[name] = handler;
      return this;
    }
    remove() {
      this.removed += 1;
      return this;
    }
  }
  class Popup {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.open = false;
      this.node = null;
      this.element = document.createElement('div');
      cards.push(this);
    }
    setLngLat(at) {
      this.lngLat = at;
      this.tracking = false;
      return this;
    }
    setDOMContent(node) {
      this.node = node;
      return this;
    }
    setText(text) {
      this.text = text;
      return this;
    }
    setOffset(offset) {
      this.offset = offset;
      return this;
    }
    trackPointer() {
      this.tracking = true;
      return this;
    }
    getElement() {
      return this.element;
    }
    isOpen() {
      return this.open;
    }
    on(name, handler) {
      this.handlers[name] = handler;
      return this;
    }
    addTo() {
      this.open = true;
      return this;
    }
    remove() {
      if (this.open) this.handlers.close?.();
      this.open = false;
      return this;
    }
  }
  return { Marker, Popup };
}

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('maplibre-gl', () => stubClasses());
  ({ createSurface } = await import('./surface.js'));
});

afterEach(() => {
  vi.doUnmock('maplibre-gl');
  vi.resetModules();
});

/** A MapLibre map, as far as surface.js reaches into it. */
function stubMap() {
  const layers = [];
  const sources = new Map();
  const calls = { setData: [], updateData: [], on: [], off: [], visibility: [] };
  return {
    calls,
    layers,
    addSource: (id) =>
      sources.set(id, {
        setData: (data) => calls.setData.push([id, data]),
        updateData: (diff) => calls.updateData.push([id, diff]),
      }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (layer, beforeId) => {
      const at = beforeId ? layers.findIndex((l) => l.id === beforeId) : -1;
      if (at === -1) layers.push(layer);
      else layers.splice(at, 0, layer);
    },
    getLayer: (id) => layers.find((l) => l.id === id),
    removeLayer: (id) => {
      const at = layers.findIndex((l) => l.id === id);
      if (at !== -1) layers.splice(at, 1);
    },
    getStyle: () => ({ layers }),
    setLayoutProperty: (id, key, value) => calls.visibility.push([id, key, value]),
    getCanvas: () => ({ style: {} }),
    on: (...args) => calls.on.push(args),
    off: (...args) => calls.off.push(args),
  };
}

function stubEngine(map = stubMap()) {
  const claims = [];
  return {
    impl: map,
    claims,
    claimClicks: (layers, filter) => {
      const claim = { layers, filter };
      claims.push(claim);
      return () => claims.splice(claims.indexOf(claim), 1);
    },
  };
}

/** The features the surface last pushed. */
const pushed = (map) => map.calls.setData.at(-1)[1].features;

const CELL = (id, north) => ({
  id,
  kind: 'rect',
  bounds: { north, south: north - 1, east: 1, west: 0 },
  style: { stroke: '#fff', fill: '#fff', fillOpacity: 0 },
});

describe('what the surface puts on the map', () => {
  it('builds one source and one layer per kind of paint', () => {
    const map = stubMap();
    createSurface(stubEngine(map)).set([CELL('a', 1)]);
    expect(map.layers.map((l) => l.type)).toEqual(['fill', 'line', 'circle']);
    expect(map.layers.every((l) => l.source.endsWith('-shapes'))).toBe(true);
  });

  it('paints a filled outline from both the fill and the line layer', () => {
    const map = stubMap();
    createSurface(stubEngine(map)).set([CELL('a', 1)]);
    const [fill, line] = map.layers;
    expect(fill.filter).toEqual(['has', 'fill']);
    expect(line.filter).toEqual(['all', ['has', 'stroke'], ['!', ['has', 'dashKey']]]);
  });

  it('keeps the circle layer to real points', () => {
    // a circle layer paints one on *every vertex* of every line and polygon
    const map = stubMap();
    createSurface(stubEngine(map)).set([CELL('a', 1)]);
    expect(map.layers.at(-1).filter).toEqual(['==', ['geometry-type'], 'Point']);
  });

  it('makes a layer for each dash pattern it is handed, once', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set([
      { id: 'ray', kind: 'line', points: [{ lat: 1, lon: 2 }], style: { strokeWidth: 3.5, dash: '6 6' } },
      { id: 'ring', kind: 'line', points: [{ lat: 1, lon: 2 }], style: { strokeWidth: 3.5, dash: '6 6' } },
    ]);
    const dashed = map.layers.filter((l) => l.paint?.['line-dasharray']);
    expect(dashed).toHaveLength(1);
    expect(dashed[0].paint['line-dasharray']).toEqual([6 / 3.5, 6 / 3.5]);
    // and the dashed stroke goes under the solid ones, as it was drawn before
    expect(map.layers.map((l) => l.type)).toEqual(['fill', 'line', 'line', 'circle']);
  });

  it('skips a hole in the shape list', () => {
    // a path that is not drawn yet is a null in the array, not a branch at
    // every call site
    const map = stubMap();
    createSurface(stubEngine(map)).set([null, CELL('a', 1)]);
    expect(pushed(map)).toHaveLength(1);
  });

  it('names every feature, so one can be changed without the rest', () => {
    const map = stubMap();
    createSurface(stubEngine(map)).set([CELL('a', 1), { kind: 'dot', at: { lat: 1, lon: 2 } }]);
    const features = pushed(map);
    expect(features.map((f) => f.properties.sid)).toEqual(['a', 'anon-0']);
    expect(features.every((f) => Number.isInteger(f.id))).toBe(true);
  });
});

describe('a mark is HTML at a position', () => {
  const MARK = {
    id: 'sky',
    kind: 'marker',
    at: { lat: 1, lon: 2 },
    html: '<i class="glyph"></i>',
    className: 'sky-body',
    size: [20, 20],
    anchor: [10, 10],
    keyboard: false,
  };

  it('puts the caller’s glyph on it, at the coordinate they named', () => {
    createSurface(stubEngine()).set([MARK]);
    const mark = marks[0];
    expect(mark.lngLat).toEqual([2, 1]);
    expect(mark.element.className).toContain('sky-body');
    expect(mark.element.innerHTML).toBe('<i class="glyph"></i>');
    expect(mark.element.style.width).toBe('20px');
  });

  it('sits the anchor the caller named on the coordinate', () => {
    const surface = createSurface(stubEngine());
    // a pin's tip is the bottom middle of its box
    surface.set([{ ...MARK, size: [24, 32], anchor: [12, 32] }]);
    expect(marks[0].offset).toEqual([0, -16]);
    surface.set([MARK]);
    expect(marks.at(-1).offset).toEqual([0, 0]);
  });

  it('takes the keyboard only when it is a control', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ ...MARK, keyboard: false, onClick: () => {} }]);
    expect(marks.at(-1).element.tabIndex).toBe(-1);
    surface.set([{ ...MARK, keyboard: true, onClick: () => {} }]);
    expect(marks.at(-1).element.tabIndex).toBe(0);
    expect(marks.at(-1).element.getAttribute('role')).toBe('button');
    // a mark that answers nothing is not a control, whatever it says
    surface.set([{ ...MARK, keyboard: true }]);
    expect(marks.at(-1).element.tabIndex).toBe(-1);
  });

  it('keeps a mark’s click off the map underneath', () => {
    // a mark opens its card; the map's click handler drops a polygon vertex or
    // plants the sky anchor, and must not fire behind it
    const onClick = vi.fn();
    createSurface(stubEngine()).set([{ ...MARK, onClick }]);
    const event = new window.MouseEvent('click', { bubbles: true });
    const stopped = vi.spyOn(event, 'stopPropagation');
    marks[0].element.dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith('sky');
  });

  it('hands a drag the position in the app’s own terms', () => {
    const onDrag = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    createSurface(stubEngine()).set([
      { id: 'sw', kind: 'marker', at: { lat: 1, lon: 2 }, draggable: true, onDrag, onDragStart, onDragEnd },
    ]);
    const mark = marks[0];
    expect(mark.options.draggable).toBe(true);
    mark.lngLat = [8, 9];
    mark.handlers.dragstart();
    mark.handlers.drag();
    mark.handlers.dragend();
    expect(onDragStart).toHaveBeenCalledWith('sw');
    expect(onDrag).toHaveBeenCalledWith({ lat: 9, lon: 8 }, 'sw');
    expect(onDragEnd).toHaveBeenCalledWith('sw');
  });

  it('says when the pointer arrives and leaves', () => {
    const onOver = vi.fn();
    const onOut = vi.fn();
    createSurface(stubEngine()).set([{ ...MARK, onOver, onOut }]);
    marks[0].element.dispatchEvent(new window.MouseEvent('mouseenter'));
    marks[0].element.dispatchEvent(new window.MouseEvent('mouseleave'));
    expect(onOver).toHaveBeenCalledWith('sky');
    expect(onOut).toHaveBeenCalledWith('sky');
  });

  it('hands out a mark’s own element, for the hover the panel shares', () => {
    const surface = createSurface(stubEngine());
    surface.set([MARK]);
    expect(surface.element('sky')).toBe(marks[0].element);
    expect(surface.element('nope')).toBeUndefined();
  });
});

describe('changing one shape', () => {
  const cells = [CELL('a', 1), CELL('b', 2)];

  it('restyles it without rebuilding the others', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set(cells);
    const pushes = map.calls.setData.length;
    expect(surface.patch('b', { style: { stroke: '#33c9ff', strokeWidth: 2.5 } })).toBe(true);
    expect(map.calls.setData).toHaveLength(pushes); // nothing was redrawn
    const [source, { update }] = map.calls.updateData.at(-1);
    expect(source).toBe(map.layers[0].source);
    expect(update).toHaveLength(1);
    expect(update[0].id).toBe(pushed(map)[1].id);
    expect(update[0].addOrUpdateProperties).toEqual(
      expect.arrayContaining([
        { key: 'stroke', value: '#33c9ff' },
        { key: 'strokeWidth', value: 2.5 },
      ])
    );
  });

  it('takes a fill off the feature when the new style has none', () => {
    // the fill layer filters on the key, so a leftover one keeps painting
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set(cells);
    surface.patch('a', { style: { stroke: '#fff' } });
    expect(map.calls.updateData.at(-1)[1].update[0].removeProperties).toEqual([
      'fill',
      'fillOpacity',
      'dashKey',
    ]);
  });

  it('makes the layer a newly dashed shape needs', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set(cells);
    surface.patch('a', { style: { stroke: '#fff', strokeWidth: 2, dash: '4 4' } });
    expect(map.layers.filter((l) => l.paint?.['line-dasharray'])).toHaveLength(1);
  });

  it('moves an outline while a handle is dragged', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    const moved = () => map.calls.updateData.at(-1)[1].update[0].newGeometry;
    surface.set([
      { id: 'ring', kind: 'polygon', points: [{ lat: 1, lon: 2 }] },
      { id: 'box', kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 } },
      { id: 'here', kind: 'dot', at: { lat: 1, lon: 2 } },
    ]);
    // the field a kind moves by is the kind's own: vertices, an extent, a point
    surface.patch('ring', { points: [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }] });
    expect(moved().coordinates[0]).toEqual([
      [4, 3],
      [6, 5],
      [4, 3],
    ]);
    surface.patch('box', { bounds: { north: 4, south: 1, east: 8, west: 2 } });
    expect(moved().coordinates[0][0]).toEqual([2, 1]);
    surface.patch('here', { at: { lat: 7, lon: 8 } });
    expect(moved()).toEqual({ type: 'Point', coordinates: [8, 7] });
  });

  it('keeps a moved shape where it was moved to, for the next move', () => {
    // a polygon handle is dragged again from where it landed, not from the
    // vertices the shape was declared with
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set([{ id: 'ring', kind: 'polygon', points: [{ lat: 1, lon: 2 }] }]);
    surface.patch('ring', { points: [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }] });
    surface.patch('ring', { style: { stroke: '#000' } });
    // the restyle carries no geometry, and the one it had is untouched
    expect(map.calls.updateData.at(-1)[1].update[0]).not.toHaveProperty('newGeometry');
  });

  it('swaps a mark’s glyph for its new style, keeping the engine’s own classes', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ id: 'pin', kind: 'marker', at: { lat: 1, lon: 2 }, className: 'old', html: '<a></a>' }]);
    // the engine puts its own positioning class on the element after we dress it
    marks[0].element.classList.add('maplibregl-marker');
    surface.patch('pin', {
      icon: { className: 'sat-marker', html: '<b></b>', size: [24, 32], anchor: [12, 32] },
    });
    expect(marks[0].element.innerHTML).toBe('<b></b>');
    expect([...marks[0].element.classList]).toEqual(['maplibregl-marker', 'sat-marker']);
    expect(marks[0].offset).toEqual([0, -16]);
  });

  it('says when there is no such shape, instead of throwing at a caller', () => {
    const surface = createSurface(stubEngine());
    surface.set(cells);
    expect(surface.patch('nope', { style: {} })).toBe(false);
    expect(surface.has('a')).toBe(true);
    expect(surface.has('nope')).toBe(false);
  });

  it('forgets the ids it no longer holds', () => {
    const surface = createSurface(stubEngine());
    surface.set(cells);
    surface.set([cells[0]]);
    expect(surface.has('b')).toBe(false);
    surface.clear();
    expect(surface.has('a')).toBe(false);
  });
});

describe('a shape that answers the pointer', () => {
  it('holds the map’s own click back, over the shapes that really answer', () => {
    const engine = stubEngine();
    createSurface(engine).set([{ ...CELL('a', 1), onClick: () => {} }]);
    expect(engine.claims).toHaveLength(1);
    expect(engine.claims[0].filter).toEqual(['!=', ['get', 'interactive'], false]);
  });

  it('claims nothing when nothing on it answers', () => {
    const engine = stubEngine();
    createSurface(engine).set([CELL('a', 1)]);
    expect(engine.claims).toHaveLength(0);
  });

  it('releases the claim when it is cleared', () => {
    const engine = stubEngine();
    const surface = createSurface(engine);
    surface.set([{ ...CELL('a', 1), onClick: () => {} }]);
    surface.clear();
    expect(engine.claims).toHaveLength(0);
  });

  it('answers a click once, not once per layer it is painted in', () => {
    // a filled, outlined cell is in two layers; twice would cycle it past the
    // status the analyst meant
    const map = stubMap();
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    createSurface(stubEngine(map)).set([{ ...CELL('a', 1), onClick, onContextMenu }]);
    const bound = map.calls.on.filter(([type]) => type === 'click');
    expect(bound).toHaveLength(1);
    expect(bound[0][1]).toEqual(expect.arrayContaining(map.layers.map((l) => l.id)));
    bound[0][2]({ features: [{ properties: { sid: 'a', interactive: true } }] });
    expect(onClick).toHaveBeenCalledTimes(1);
    map.calls.on.find(([type]) => type === 'contextmenu')[2]({
      features: [{ properties: { sid: 'a', interactive: true } }],
    });
    expect(onContextMenu).toHaveBeenCalledWith('a');
  });

  it('ignores a shape drawn only to say how loosely a mark is placed', () => {
    const map = stubMap();
    const onClick = vi.fn();
    createSurface(stubEngine(map)).set([{ ...CELL('a', 1), onClick }]);
    map.calls.on.find(([type]) => type === 'click')[2]({
      features: [{ properties: { sid: 'a', interactive: false } }],
    });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('the reading a shape gives under the cursor', () => {
  it('follows the cursor when the caller asked it to', () => {
    const map = stubMap();
    createSurface(stubEngine(map)).set([
      { id: 'ray', kind: 'line', points: [{ lat: 1, lon: 2 }], tip: { text: 'az 210°', sticky: true } },
    ]);
    map.calls.on.find(([type]) => type === 'mousemove')[2]({
      features: [{ properties: { sid: 'ray', interactive: true } }],
      lngLat: { lat: 1, lng: 2 },
    });
    const tip = cards.at(-1);
    expect(tip.text).toBe('az 210°');
    expect(tip.tracking).toBe(true);
    expect(tip.options.className).toBe('map-tip');
    expect(tip.options.closeButton).toBe(false);
  });

  it('hangs on the side the caller named, and goes with the pointer', () => {
    const surface = createSurface(stubEngine());
    surface.set([
      {
        id: 'point',
        kind: 'marker',
        at: { lat: 1, lon: 2 },
        tip: { text: 'Quai sud', direction: 'top', offset: [0, -12] },
      },
    ]);
    marks[0].element.dispatchEvent(new window.MouseEvent('mouseenter'));
    // 'top' is where the reading goes, so the card's own anchor is its bottom
    expect(cards.at(-1).options.anchor).toBe('bottom');
    expect(cards.at(-1).offset).toEqual([0, -12]);
    expect(cards.at(-1).isOpen()).toBe(true);
    marks[0].element.dispatchEvent(new window.MouseEvent('mouseleave'));
    expect(cards.at(-1).isOpen()).toBe(false);
  });

  it('takes a bare string as the reading itself', () => {
    const map = stubMap();
    createSurface(stubEngine(map)).set([
      { id: 'tick', kind: 'line', points: [{ lat: 1, lon: 2 }], tip: 'Sun 14:20' },
    ]);
    map.calls.on.find(([type]) => type === 'mousemove')[2]({
      features: [{ properties: { sid: 'tick', interactive: true } }],
      lngLat: { lat: 1, lng: 2 },
    });
    expect(cards.at(-1).text).toBe('Sun 14:20');
    expect(cards.at(-1).tracking).toBe(false);
  });
});

describe('cards on a mark', () => {
  function withCard(hooks) {
    const content = vi.fn(() => document.createElement('p'));
    const surface = createSurface(stubEngine(), hooks);
    surface.set([
      {
        id: 'mark-1',
        kind: 'marker',
        at: { lat: 1, lon: 2 },
        popup: { content, className: 'saved-popup', minWidth: 296, maxWidth: 330 },
      },
    ]);
    return { surface, content, mark: marks[0] };
  }

  const openCard = (mark) => mark.element.dispatchEvent(new window.MouseEvent('click'));

  it('builds the card when it opens, not when the mark is drawn', () => {
    // a layer of two hundred marks must not mount two hundred cards
    const { content, mark } = withCard();
    expect(content).not.toHaveBeenCalled();
    openCard(mark);
    expect(content).toHaveBeenCalledTimes(1);
    const card = cards.at(-1);
    expect(card.options).toMatchObject({ className: 'saved-popup', maxWidth: '330px' });
    expect(card.node.tagName).toBe('P');
    expect(card.element.style.getPropertyValue('--popup-min-width')).toBe('296px');
  });

  it('says when a card opened and when it closed', () => {
    // the layer defers rebuilding while a card is open: it is a surface the
    // analyst works in, not a tooltip
    const onPopupOpen = vi.fn();
    const onPopupClose = vi.fn();
    const { mark } = withCard({ onPopupOpen, onPopupClose });
    openCard(mark);
    expect(onPopupOpen).toHaveBeenCalledWith('mark-1');
    cards.at(-1).remove();
    expect(onPopupClose).toHaveBeenCalledWith('mark-1');
  });

  it('closes the open card, wherever it is', () => {
    const { surface, mark } = withCard();
    surface.closePopup(); // nothing open: not an error
    openCard(mark);
    const card = cards.at(-1);
    surface.closePopup();
    expect(card.isOpen()).toBe(false);
    surface.closePopup(); // and closing again reaches nothing
  });

  it('puts the card away when the same mark is pressed again', () => {
    // the mark stops its own click, so the map's close-on-click cannot do it
    const { mark } = withCard();
    openCard(mark);
    const card = cards.at(-1);
    openCard(mark);
    expect(card.isOpen()).toBe(false);
    expect(cards.filter((c) => c.isOpen())).toHaveLength(0);
    openCard(mark);
    expect(cards.at(-1).isOpen()).toBe(true);
  });

  it('opens one card at a time', () => {
    const surface = createSurface(stubEngine());
    const popup = (id) => ({
      id,
      kind: 'marker',
      at: { lat: 1, lon: 2 },
      popup: { content: () => document.createElement('p'), maxWidth: 320 },
    });
    surface.set([popup('one'), popup('two')]);
    openCard(marks[0]);
    openCard(marks[1]);
    expect(cards.filter((c) => c.isOpen())).toHaveLength(1);
  });

  it('takes the card down when the shapes are replaced', () => {
    const { surface, mark } = withCard();
    openCard(mark);
    surface.set([]);
    expect(cards.at(-1).isOpen()).toBe(false);
  });
});

describe('the eye toggle', () => {
  it('keeps the shapes and hides them', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set([CELL('a', 1)]);
    surface.visible(false);
    expect(map.calls.visibility.map(([, , value]) => value)).toEqual(['none', 'none', 'none']);
    expect(surface.has('a')).toBe(true); // the grid is still open, just unseen
    map.calls.visibility.length = 0;
    surface.visible(true);
    expect(map.calls.visibility.every(([, , value]) => value === 'visible')).toBe(true);
  });

  it('hides a mark with the shapes, since it is not a layer', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ id: 'm', kind: 'marker', at: { lat: 1, lon: 2 } }]);
    surface.visible(false);
    expect(marks[0].element.style.display).toBe('none');
    surface.visible(true);
    expect(marks[0].element.style.display).toBe('');
  });

  it('stays hidden however much is drawn on it', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.visible(false);
    surface.set([CELL('a', 1), { id: 'm', kind: 'marker', at: { lat: 1, lon: 2 } }]);
    expect(map.calls.visibility.every(([, , value]) => value === 'none')).toBe(true);
    expect(marks[0].element.style.display).toBe('none');
  });
});

describe('teardown', () => {
  it('takes its layers, its source and its listeners with it', () => {
    const map = stubMap();
    const engine = stubEngine(map);
    const surface = createSurface(engine);
    surface.set([{ ...CELL('a', 1), onClick: () => {} }, { id: 'm', kind: 'marker', at: { lat: 1, lon: 2 } }]);
    surface.destroy();
    expect(map.layers).toEqual([]);
    expect(map.getSource(`${map.calls.setData[0][0]}`)).toBeUndefined();
    expect(map.calls.off).toHaveLength(map.calls.on.length);
    expect(marks[0].removed).toBe(1);
    expect(engine.claims).toHaveLength(0);
  });

  it('can be drawn on again after it was torn down', () => {
    const map = stubMap();
    const surface = createSurface(stubEngine(map));
    surface.set([CELL('a', 1)]);
    surface.destroy();
    surface.set([CELL('b', 2)]);
    expect(map.layers.map((l) => l.type)).toEqual(['fill', 'line', 'circle']);
    expect(surface.has('b')).toBe(true);
  });
});
