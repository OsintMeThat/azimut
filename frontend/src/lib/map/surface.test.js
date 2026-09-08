// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The surface is exercised against a stubbed engine, because what it must get
 * right is the *translation*: which style words become which, which shape kind
 * becomes which object, and — the reason the module exists — that changing one
 * shape of a thousand does not rebuild the other 999.
 */
let created;
let createSurface;

function record(kind) {
  return (...args) => {
    const layer = {
      kind,
      args,
      style: null,
      moved: null,
      icon: null,
      handlers: {},
      options: {},
      tip: null,
      added: 0,
      on(name, handler) {
        this.handlers[name] = handler;
        return this;
      },
      bindTooltip(text, options) {
        this.tip = { text, options };
        return this;
      },
      bindPopup(build, options) {
        this.popup = { build, options };
        return this;
      },
      closePopup() {
        this.closed = (this.closed ?? 0) + 1;
      },
      getElement() {
        return this.element;
      },
      addTo(group) {
        this.added += 1;
        group.children.push(this);
        return this;
      },
      setStyle(style) {
        this.style = style;
      },
      setIcon(icon) {
        this.icon = icon;
      },
      setLatLngs(points) {
        this.moved = points;
      },
      setBounds(bounds) {
        this.moved = bounds;
      },
      setLatLng(at) {
        this.moved = at;
      },
    };
    created.push(layer);
    return layer;
  };
}

beforeEach(async () => {
  created = [];
  vi.resetModules();
  vi.doMock('leaflet', () => ({
    default: {
      polyline: record('polyline'),
      polygon: record('polygon'),
      rectangle: record('rectangle'),
      circleMarker: record('circleMarker'),
      circle: record('circle'),
      geoJSON: record('geoJSON'),
      marker: record('marker'),
      divIcon: (options) => ({ icon: options }),
      canvas: (options) => ({ canvas: options }),
      layerGroup: () => ({
        children: [],
        clearLayers() {
          this.children = [];
        },
        addTo(map) {
          map.layers.add(this);
          return this;
        },
        remove() {},
      }),
      DomEvent: { stop: vi.fn() },
    },
  }));
  ({ createSurface } = await import('./surface.js'));
});

afterEach(() => {
  vi.doUnmock('leaflet');
  vi.resetModules();
});

function stubEngine() {
  const layers = new Set();
  return {
    layers,
    leaflet: {
      layers,
      hasLayer: (layer) => layers.has(layer),
      removeLayer: (layer) => layers.delete(layer),
    },
  };
}

const last = () => created.at(-1);

describe('styles keep their own words', () => {
  it('translates stroke and fill into what the engine calls them', () => {
    createSurface(stubEngine()).set([
      {
        kind: 'line',
        points: [{ lat: 1, lon: 2 }],
        style: { stroke: '#fff', strokeWidth: 2.5, strokeOpacity: 0.9, dash: '6 6' },
      },
    ]);
    expect(last().args[1]).toMatchObject({
      color: '#fff',
      weight: 2.5,
      opacity: 0.9,
      dashArray: '6 6',
      fill: false,
    });
  });

  it('passes on only what the caller stated', () => {
    // an engine merges these over its own defaults, so `opacity: undefined` is
    // not "leave it alone", it is "paint with undefined"
    createSurface(stubEngine()).set([
      { kind: 'line', points: [{ lat: 1, lon: 2 }], style: { stroke: '#fff' } },
    ]);
    const options = last().args[1];
    expect(options).not.toHaveProperty('weight');
    expect(options).not.toHaveProperty('opacity');
    expect(options).not.toHaveProperty('dashArray');
  });

  it('clears a dash that was set and then dropped', () => {
    createSurface(stubEngine()).set([
      { kind: 'line', points: [{ lat: 1, lon: 2 }], style: { stroke: '#fff', dash: null } },
    ]);
    expect(last().args[1].dashArray).toBeNull();
  });

  it('reads a fill colour as "there is a fill"', () => {
    createSurface(stubEngine()).set([
      { kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 }, style: { fill: '#2b3040', fillOpacity: 0.62 } },
    ]);
    expect(last().args[1]).toMatchObject({ fill: true, fillColor: '#2b3040', fillOpacity: 0.62 });
  });

  it('keeps a transparent fill, which is not the same as no fill', () => {
    // an unchecked grid cell is a bright outline over nothing: fill true, zero
    // opacity, so the imagery reads through and the lattice still shows
    createSurface(stubEngine()).set([
      { kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 }, style: { fill: '#fff', fillOpacity: 0 } },
    ]);
    expect(last().args[1]).toMatchObject({ fill: true, fillOpacity: 0 });
  });

  it('lets a shape refuse the pointer', () => {
    createSurface(stubEngine()).set([
      { kind: 'polygon', points: [{ lat: 1, lon: 2 }], style: { interactive: false } },
    ]);
    expect(last().args[1].interactive).toBe(false);
  });
});

describe('shapes', () => {
  it('gives the engine an extent in the order it wants', () => {
    createSurface(stubEngine()).set([
      { kind: 'rect', bounds: { north: 4, south: 1, east: 8, west: 2 } },
    ]);
    expect(last().args[0]).toEqual([
      [1, 2],
      [4, 8],
    ]);
  });

  it('tells a pixel dot from a radius on the ground', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ kind: 'dot', at: { lat: 1, lon: 2 }, style: { radius: 4 } }]);
    expect(last().kind).toBe('circleMarker');
    expect(last().args[1].radius).toBe(4);
    surface.set([{ kind: 'circle', at: { lat: 1, lon: 2 }, radiusM: 250 }]);
    expect(last().kind).toBe('circle');
    expect(last().args[1].radius).toBe(250);
  });

  it('draws a mark as HTML at a position', () => {
    createSurface(stubEngine()).set([
      {
        kind: 'marker',
        at: { lat: 1, lon: 2 },
        html: '<svg/>',
        className: 'sky-body',
        size: [20, 20],
        anchor: [10, 10],
        keyboard: false,
        zIndex: 1200,
      },
    ]);
    expect(last().args[0]).toEqual([1, 2]);
    expect(last().args[1]).toMatchObject({ keyboard: false, zIndexOffset: 1200, draggable: false });
    expect(last().args[1].icon.icon).toEqual({
      className: 'sky-body',
      html: '<svg/>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  });

  it('refuses a shape it does not know, rather than drawing nothing', () => {
    expect(() => createSurface(stubEngine()).set([{ kind: 'blob' }])).toThrow(/unknown shape/);
  });

  it('binds a tip, sticky when asked', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ kind: 'line', points: [{ lat: 1, lon: 2 }], tip: 'Sun 14:20' }]);
    expect(last().tip).toEqual({ text: 'Sun 14:20', options: { sticky: false } });
    surface.set([{ kind: 'line', points: [{ lat: 1, lon: 2 }], tip: { text: 'az 210°', sticky: true } }]);
    expect(last().tip.options.sticky).toBe(true);
  });

  it('draws a lattice on one canvas, not on a node per cell', () => {
    // hundreds of SVG nodes is what makes a pan stutter
    createSurface(stubEngine(), { renderer: 'canvas' }).set([
      { kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 } },
    ]);
    expect(last().args[1].renderer).toEqual({ canvas: { padding: 0.5 } });
  });
});

describe('answering the pointer', () => {
  it('keeps a shape’s click off the map underneath', async () => {
    // a cell cycles its own status; the map's click handler drops a polygon
    // vertex or plants the sky anchor, and must not fire behind it
    const L = (await import('leaflet')).default;
    const onClick = vi.fn();
    createSurface(stubEngine()).set([
      { id: '3:4', kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 }, onClick },
    ]);
    expect(last().options.bubblingMouseEvents).toBe(false);
    last().handlers.click({ stop: 'event' });
    expect(L.DomEvent.stop).toHaveBeenCalledWith({ stop: 'event' });
    expect(onClick).toHaveBeenCalledWith('3:4');
  });

  it('hands a drag the position in the app’s own terms', () => {
    const onDrag = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    createSurface(stubEngine()).set([
      { id: 'sw', kind: 'marker', at: { lat: 1, lon: 2 }, draggable: true, onDrag, onDragStart, onDragEnd },
    ]);
    const marker = last();
    marker.getLatLng = () => ({ lat: 9, lng: 8 });
    marker.handlers.dragstart();
    marker.handlers['drag move']();
    marker.handlers.dragend();
    expect(onDragStart).toHaveBeenCalledWith('sw');
    expect(onDrag).toHaveBeenCalledWith({ lat: 9, lon: 8 }, 'sw');
    expect(onDragEnd).toHaveBeenCalledWith('sw');
  });

  it('leaves a shape that answers nothing bubbling as the engine does', () => {
    createSurface(stubEngine()).set([{ kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 } }]);
    expect(last().options).not.toHaveProperty('bubblingMouseEvents');
  });
});

describe('changing one shape', () => {
  const cells = [
    { id: 'a', kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 }, style: { stroke: '#fff' } },
    { id: 'b', kind: 'rect', bounds: { north: 2, south: 1, east: 1, west: 0 }, style: { stroke: '#fff' } },
  ];

  it('restyles it without rebuilding the others', () => {
    const surface = createSurface(stubEngine());
    surface.set(cells);
    const built = created.length;
    expect(surface.patch('b', { style: { stroke: '#33c9ff', strokeWidth: 2.5 } })).toBe(true);
    expect(created).toHaveLength(built); // nothing new was drawn
    expect(created[1].style).toMatchObject({ color: '#33c9ff', weight: 2.5 });
    expect(created[0].style).toBeNull();
  });

  it('moves an outline while a handle is dragged', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ id: 'outline', kind: 'polygon', points: [{ lat: 1, lon: 2 }] }]);
    surface.patch('outline', { points: [{ lat: 3, lon: 4 }, { lat: 5, lon: 6 }] });
    expect(last().moved).toEqual([
      [3, 4],
      [5, 6],
    ]);
    surface.patch('outline', { bounds: { north: 4, south: 1, east: 8, west: 2 } });
    expect(last().moved).toEqual([
      [1, 2],
      [4, 8],
    ]);
  });

  it('swaps a mark’s glyph for its new style', () => {
    const surface = createSurface(stubEngine());
    surface.set([{ id: 'pin', kind: 'marker', at: { lat: 1, lon: 2 }, html: '<a/>' }]);
    surface.patch('pin', { icon: { className: 'sat-marker', html: '<b/>', size: [24, 24], anchor: [12, 12] } });
    expect(last().icon.icon.html).toBe('<b/>');
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

  it('skips a hole in the shape list', () => {
    // a path that is not drawn yet is a null in the array, not a branch at
    // every call site
    const surface = createSurface(stubEngine());
    surface.set([null, cells[0]]);
    expect(created).toHaveLength(1);
  });
});

describe('cards on a mark', () => {
  function withCard(hooks) {
    const content = vi.fn(() => 'the card');
    const surface = createSurface(stubEngine(), hooks);
    surface.set([
      {
        id: 'mark-1',
        kind: 'marker',
        at: { lat: 1, lon: 2 },
        popup: { content, className: 'saved-popup', minWidth: 296, maxWidth: 330 },
      },
    ]);
    return { surface, content, marker: last() };
  }

  it('builds the card when it opens, not when the mark is drawn', () => {
    // a layer of two hundred marks must not mount two hundred cards
    const { content, marker } = withCard();
    expect(content).not.toHaveBeenCalled();
    expect(marker.args[1]).toBeDefined();
    expect(marker.popup.options).toMatchObject({
      className: 'saved-popup',
      minWidth: 296,
      maxWidth: 330,
      autoPanPadding: [24, 24],
    });
    expect(marker.popup.build()).toBe('the card');
    expect(content).toHaveBeenCalledTimes(1);
  });

  it('says when a card opened and when it closed', () => {
    // the layer defers rebuilding while a card is open: it is a surface the
    // analyst works in, not a tooltip
    const onPopupOpen = vi.fn();
    const onPopupClose = vi.fn();
    const { marker } = withCard({ onPopupOpen, onPopupClose });
    marker.handlers.popupopen();
    expect(onPopupOpen).toHaveBeenCalledWith('mark-1');
    marker.handlers.popupclose();
    expect(onPopupClose).toHaveBeenCalledWith('mark-1');
  });

  it('closes the open card, wherever it is', () => {
    const { surface, marker } = withCard();
    surface.closePopup(); // nothing open: not an error
    marker.handlers.popupopen();
    surface.closePopup();
    expect(marker.closed).toBe(1);
    // and once closed, closing again reaches nothing
    marker.handlers.popupclose();
    surface.closePopup();
    expect(marker.closed).toBe(1);
  });

  it('hands out a mark’s own element, for the hover the panel shares', () => {
    const { surface, marker } = withCard();
    marker.element = 'the node';
    expect(surface.element('mark-1')).toBe('the node');
    expect(surface.element('nope')).toBeUndefined();
  });

  it('places a tip where the caller asked', () => {
    createSurface(stubEngine()).set([
      {
        kind: 'marker',
        at: { lat: 1, lon: 2 },
        tip: { text: 'Quai sud', direction: 'top', offset: [0, -12] },
      },
    ]);
    expect(last().tip.options).toEqual({ sticky: false, direction: 'top', offset: [0, -12] });
  });
});

describe('the eye toggle', () => {
  it('keeps the shapes and takes the layer off the map', () => {
    const engine = stubEngine();
    const surface = createSurface(engine);
    surface.set([{ id: 'a', kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 } }]);
    expect(engine.layers.size).toBe(1);
    surface.visible(false);
    expect(engine.layers.size).toBe(0);
    expect(surface.has('a')).toBe(true); // the grid is still open, just unseen
    surface.visible(true);
    expect(engine.layers.size).toBe(1);
  });

  it('stays off while hidden, however much is drawn on it', () => {
    const engine = stubEngine();
    const surface = createSurface(engine);
    surface.visible(false);
    surface.set([{ kind: 'rect', bounds: { north: 1, south: 0, east: 1, west: 0 } }]);
    expect(engine.layers.size).toBe(0);
  });
});
