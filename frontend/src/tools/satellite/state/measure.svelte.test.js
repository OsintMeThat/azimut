// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeasureState } from './measure.svelte.js';

/**
 * The measure tools' own rules, apart from the map they draw on.
 *
 * The arithmetic has its own tests (lib/measure.js); what is asserted here is
 * everything that decides *which* points the arithmetic is handed.
 */

const A = { lat: 0, lon: 0 };
const B = { lat: 0, lon: 1 };
const C = { lat: 1, lon: 1 };
const D = { lat: 1, lon: 0 };

let drawn;
let layer;
let surface;
let engine;

function store(units = 'metric') {
  return createMeasureState({ engine: () => engine, units: () => units, surface });
}

beforeEach(() => {
  drawn = [];
  layer = {
    set: vi.fn((shapes) => drawn.push(shapes)),
    clear: vi.fn(),
    destroy: vi.fn(),
  };
  surface = vi.fn(() => layer);
  engine = { id: 'map' };
});

describe('arming a mode', () => {
  it('drops the points the last mode left, so the readout names what is drawn', () => {
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    m.addPoint(B);
    expect(m.points).toHaveLength(2);

    m.setMode('area');
    expect(m.points).toEqual([]);
    expect(m.readout).toBe(null);
  });

  it('pressing the armed mode again disarms it', () => {
    const m = store();
    expect(m.setMode('angle')).toBe('angle');
    expect(m.setMode('angle')).toBe(null);
    expect(m.mode).toBe(null);
  });

  it('ignores map clicks while nothing is armed', () => {
    const m = store();
    expect(m.addPoint(A)).toBe(false);
    expect(m.points).toEqual([]);
    expect(surface).not.toHaveBeenCalled();
  });
});

describe('the shapes drawn', () => {
  it('draws one layer, not one per click', () => {
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    m.addPoint(B);
    m.addPoint(C);
    expect(surface).toHaveBeenCalledTimes(1);
  });

  it('joins distance points with a line and area points with a polygon', () => {
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    m.addPoint(B);
    expect(drawn.at(-1)[0].kind).toBe('line');

    m.setMode('area');
    m.addPoint(A);
    m.addPoint(B);
    m.addPoint(C);
    expect(drawn.at(-1)[0].kind).toBe('polygon');
  });

  it('marks every clicked point, so a path shows where it was bent', () => {
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    m.addPoint(B);
    m.addPoint(C);
    expect(drawn.at(-1).filter((shape) => shape?.kind === 'dot')).toHaveLength(3);
  });

  it('draws nothing at all before the map is up', () => {
    engine = null;
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    expect(surface).not.toHaveBeenCalled();
    // …and the point is still held, so the first draw has it
    expect(m.points).toEqual([A]);
  });
});

describe('the readout', () => {
  it('says nothing until a shape means something', () => {
    const m = store();
    m.setMode('distance');
    expect(m.readout).toBe(null);
    m.addPoint(A);
    expect(m.readout).toBe(null);
  });

  it('waits for the third point of an area rather than naming a line', () => {
    const m = store();
    m.setMode('area');
    m.addPoint(A);
    m.addPoint(B);
    expect(m.readout).toBe('…');
    m.addPoint(C);
    expect(m.readout).not.toBe('…');
  });

  it('follows the units it is asked for', () => {
    const metric = store('metric');
    metric.setMode('distance');
    metric.addPoint(A);
    metric.addPoint(B);
    const imperial = store('imperial');
    imperial.setMode('distance');
    imperial.addPoint(A);
    imperial.addPoint(B);
    expect(metric.readout).not.toBe(imperial.readout);
  });
});

describe('an angle', () => {
  it('is exactly three points: a fourth click starts a fresh one', () => {
    const m = store();
    m.setMode('angle');
    m.addPoint(A);
    m.addPoint(B);
    m.addPoint(C);
    const three = m.readout;
    expect(three).not.toBe('…');

    m.addPoint(D);
    expect(m.points).toEqual([D]);
    expect(m.readout).toBe(null);
  });
});

describe('the panel', () => {
  it('disarms the tool when it closes, so nothing keeps eating map clicks', () => {
    const m = store();
    m.togglePanel();
    m.setMode('distance');
    m.addPoint(A);

    m.togglePanel();
    expect(m.panelOpen).toBe(false);
    expect(m.mode).toBe(null);
    expect(m.points).toEqual([]);
  });

  it('opening it arms nothing by itself', () => {
    const m = store();
    m.togglePanel();
    expect(m.mode).toBe(null);
  });
});

describe('teardown', () => {
  it('takes its layer off the map', () => {
    const m = store();
    m.setMode('distance');
    m.addPoint(A);
    m.destroy();
    expect(layer.destroy).toHaveBeenCalled();
  });

  it('is safe on a store that never drew anything', () => {
    expect(() => store().destroy()).not.toThrow();
  });
});
