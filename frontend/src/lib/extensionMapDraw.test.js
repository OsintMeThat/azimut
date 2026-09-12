// @vitest-environment happy-dom
/**
 * The extension's canvas layer (extension/mapdraw.js).
 *
 * It has one rule with a claim in it, and the rest is paint: a shape whose
 * points do not all project is dropped rather than drawn short. Half a measured
 * path is not most of a measurement — it is a wrong one, drawn confidently, in
 * a tool whose output is meant to end up in a case file.
 *
 * The paint is worth pinning too, because the whole point of it is to be the
 * app's: a lattice of hundreds of cells must not carry the dark casing that
 * makes a single measured line readable, or it reads as a black grid over the
 * imagery.
 *
 * The canvas is faked because happy-dom has no 2D context. What is asserted is
 * the sequence of calls, which is what says whether something was drawn.
 */
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');

let ext;
let calls;

/** A 2D context that records what it was asked to do. */
function fakeContext() {
  const record = (name) => (...args) => calls.push([name, ...args]);
  const ctx = {
    measureText: () => ({ width: 20 }),
  };
  for (const name of [
    'setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath',
    'stroke', 'fill', 'fillRect', 'fillText', 'strokeRect', 'arc', 'ellipse',
    'roundRect', 'save', 'restore', 'setLineDash', 'translate', 'rotate', 'scale',
  ]) {
    ctx[name] = record(name);
  }
  return ctx;
}

beforeAll(() => {
  const scope = { window: globalThis.window };
  new Function('window', read('maptheme.js'))(scope.window);
  new Function('window', read('mapdraw.js'))(scope.window);
  ext = scope.window.AzimutMapDraw;
  window.HTMLCanvasElement.prototype.getContext = fakeContext;
  // the icon glyphs are drawn as paths; happy-dom has no Path2D
  globalThis.Path2D = class {
    constructor(d) {
      this.d = d;
    }
  };
});

let layer;

beforeEach(() => {
  calls = [];
  document.body.innerHTML = '';
  layer = ext.createDrawLayer(document.body);
});

const named = (name) => calls.filter(([call]) => call === name);

/** Straight through: one degree is one pixel, so the test states pixels. */
const flat = (point) => ({ x: point.lon, y: point.lat });

const LINE = { kind: 'line', stroke: '#f5a623', strokeWidth: 2.5 };

describe('drawing over someone else’s map', () => {
  it('sits over the page without taking its clicks', () => {
    expect(layer.canvas.style.position).toBe('fixed');
    expect(layer.canvas.style.pointerEvents).toBe('none');
  });

  it('traces a line through every point it was given', () => {
    layer.render([{ ...LINE, points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }], flat);
    expect(named('moveTo')).toEqual([['moveTo', 2, 1]]);
    expect(named('lineTo')).toEqual([['lineTo', 4, 3]]);
    expect(named('stroke')).toHaveLength(1);
  });

  it('casings a line only when it is asked to', () => {
    // the measure gets a dark casing so it reads over snow and over a blown-out
    // roof; a lattice of cells asking for the same thing draws a black grid
    layer.render([{ ...LINE, casing: true, points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }], flat);
    expect(named('stroke')).toHaveLength(2);
  });

  it('drops a shape one of whose points projects nowhere', () => {
    const broken = (point) => (point.lat === 3 ? { x: NaN, y: NaN } : flat(point));
    layer.render([{ ...LINE, points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }], broken);
    expect(named('moveTo')).toEqual([]);
    expect(named('stroke')).toEqual([]);
  });

  it('drops a shape that projects absurdly far off screen', () => {
    const far = (point) => (point.lat === 3 ? { x: ext.FAR + 1, y: 0 } : flat(point));
    layer.render([{ ...LINE, points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }], far);
    expect(named('stroke')).toEqual([]);
  });

  it('closes a polygon and fills it', () => {
    layer.render(
      [{
        kind: 'polygon',
        stroke: '#f5a623',
        fill: '#f5a623',
        fillOpacity: 0.15,
        points: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }],
      }],
      flat
    );
    expect(named('fill')).toHaveLength(1);
    expect(named('closePath')).toHaveLength(2); // once to fill, once to stroke
  });

  it('leaves an unchecked cell unfilled', () => {
    // the app's unchecked style is a bright thin outline and no fill at all;
    // filling it at zero opacity would still cost a fill per cell
    layer.render(
      [{ kind: 'cell', bounds: { south: 0, west: 0, north: 1, east: 1 }, stroke: '#fff', fill: '#fff', fillOpacity: 0 }],
      flat
    );
    expect(named('fill')).toEqual([]);
    expect(named('stroke')).toHaveLength(1);
  });

  it('draws a cell as its four projected corners', () => {
    layer.render(
      [{ kind: 'cell', bounds: { south: 0, west: 0, north: 1, east: 2 }, stroke: '#fff' }],
      flat
    );
    expect(named('moveTo')).toEqual([['moveTo', 0, 1]]);
    expect(named('lineTo')).toEqual([
      ['lineTo', 2, 1],
      ['lineTo', 2, 0],
      ['lineTo', 0, 0],
    ]);
  });

  it('draws a saved mark as the app’s turned teardrop', () => {
    layer.render([{ kind: 'mark', at: { lat: 100, lon: 50 }, glyph: 'pin', count: 1 }], flat);
    expect(named('rotate')[0]).toEqual(['rotate', -Math.PI / 4]);
    expect(named('roundRect')).toHaveLength(1);
    expect(named('fillText')).toEqual([]); // no count badge for a lone mark
  });

  /**
   * The sharp corner of the teardrop is what points at the coordinate, and a
   * rotation puts that corner half a diagonal below the middle of the box. Drawn
   * around the point, as it was, every mark claimed a spot 17 px south of the
   * one it was filed at — ten metres at zoom 18.
   */
  it('stands the teardrop above the point, so its corner is on it', () => {
    layer.render([{ kind: 'mark', at: { lat: 100, lon: 50 }, glyph: 'pin', count: 1 }], flat);
    expect(named('translate')).toContainEqual(['translate', 50, 100 - ext.MARK_TIP]);
    expect(ext.MARK_TIP).toBeCloseTo((ext.MARK / 2) * Math.SQRT2, 6);
  });

  it('counts what is stacked under a mark', () => {
    layer.render([{ kind: 'mark', at: { lat: 1, lon: 2 }, glyph: 'pin', count: 7 }], flat);
    expect(named('fillText')).toContainEqual(expect.arrayContaining(['fillText', '7']));
  });

  it('names a mark only when it is given a name', () => {
    layer.render([{ kind: 'mark', at: { lat: 1, lon: 2 }, glyph: 'pin', count: 1, label: 'Gate' }], flat);
    expect(named('fillText')).toContainEqual(expect.arrayContaining(['fillText', 'Gate']));
  });

  it('shortens a name rather than letting it run across the map', () => {
    const long = 'x'.repeat(80);
    layer.render([{ kind: 'dot', at: { lat: 1, lon: 2 }, fill: '#fff', label: long }], flat);
    const [, text] = named('fillText')[0];
    expect(text).toHaveLength(ext.LABEL_MAX);
    expect(text.endsWith('…')).toBe(true);
  });

  it('draws the moon as its lit fraction', () => {
    layer.render(
      [{ kind: 'body', at: { lat: 1, lon: 2 }, bodyKind: 'moon', colour: '#4a93cc', illuminated: 0.5, waxing: true }],
      flat
    );
    expect(named('ellipse')).toHaveLength(1);
    // a waxing moon is drawn lit-side-right, so nothing is turned
    expect(named('rotate')).toEqual([]);
  });

  it('turns the lit side over for a waning moon', () => {
    layer.render(
      [{ kind: 'body', at: { lat: 1, lon: 2 }, bodyKind: 'moon', colour: '#4a93cc', illuminated: 0.5, waxing: false }],
      flat
    );
    expect(named('rotate')).toEqual([['rotate', Math.PI]]);
  });

  it('draws the sun as a disc, with no terminator', () => {
    layer.render(
      [{ kind: 'body', at: { lat: 1, lon: 2 }, bodyKind: 'sun', colour: '#bd8721' }],
      flat
    );
    expect(named('ellipse')).toEqual([]);
    expect(named('arc').length).toBeGreaterThan(1);
  });

  it('says nothing when there is nothing to say', () => {
    layer.render([{ kind: 'dot', at: { lat: 1, lon: 2 }, fill: '#fff' }], flat);
    expect(named('fillText')).toEqual([]);
  });

  it('clears before each pass, at the device’s pixel ratio', () => {
    layer.render([], flat);
    expect(named('clearRect')).toHaveLength(1);
    const ratio = window.devicePixelRatio || 1;
    expect(layer.canvas.width).toBe(Math.round(window.innerWidth * ratio));
  });

  it('takes itself off the page when the panel closes', () => {
    layer.destroy();
    expect(document.body.querySelector('canvas')).toBe(null);
  });
});
