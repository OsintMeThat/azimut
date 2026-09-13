// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFootprintState, polygonOf } from './footprint.svelte.js';

/**
 * Tracing a footprint, apart from the map it is drawn on.
 *
 * What matters here is that a shape is one place's claim: it is never traced
 * for nobody, never written before Save, and never sent as something the store
 * would refuse.
 */

// The pin sits inside the triangle A-B-C below, which is where a place's own shape
// has to be traced.
const PLACE = { id: 'e1', kind: 'place', title: 'North quay', lat: 0.3, lon: 0.7, footprint: null };
const A = { lat: 0, lon: 0 };
const B = { lat: 0, lon: 1 };
const C = { lat: 1, lon: 1 };

let api;
let notify;
let layer;
let surface;
let engine;
let saved;

function store() {
  return createFootprintState({
    api,
    notify,
    caseId: () => 'case-1',
    engine: () => engine,
    onSaved: saved,
    surface,
  });
}

beforeEach(() => {
  api = { patch: vi.fn(async () => ({})) };
  notify = vi.fn();
  layer = { set: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
  surface = vi.fn(() => layer);
  engine = { id: 'map' };
  saved = vi.fn(async () => {});
});

describe('a ring as GeoJSON', () => {
  it('is lon-first and closed, which is what the store validates', () => {
    expect(polygonOf([A, B, C])).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    });
  });

  it('is nothing at all below three corners, because that is not an area', () => {
    expect(polygonOf([A, B])).toBe(null);
    expect(polygonOf([])).toBe(null);
  });
});

describe('tracing', () => {
  it('is off until a place asks for it, and swallows no clicks meanwhile', () => {
    const trace = store();
    expect(trace.on).toBe(false);
    expect(trace.addPoint(A)).toBe(false);
  });

  it('names the place it is tracing for', () => {
    const trace = store();
    trace.start(PLACE);
    expect(trace.on).toBe(true);
    expect(trace.place.title).toBe('North quay');
  });

  it('refuses to start on a row that is not an entity', () => {
    const trace = store();
    expect(trace.start({ title: 'nothing' })).toBe(false);
    expect(trace.on).toBe(false);
  });

  it('takes the map clicks and draws them, back to front', () => {
    const trace = store();
    trace.start(PLACE);
    expect(trace.addPoint(A)).toBe(true);
    trace.addPoint(B);
    trace.addPoint(C);
    expect(trace.points).toHaveLength(3);
    expect(trace.complete).toBe(true);
    trace.undo();
    expect(trace.points).toEqual([A, B]);
    expect(trace.complete).toBe(false);
    expect(layer.set).toHaveBeenCalled();
  });

  it('starting on a second place drops the first draft rather than mixing them', () => {
    const trace = store();
    trace.start(PLACE);
    trace.addPoint(A);
    trace.start({ ...PLACE, id: 'e2', title: 'Treeline' });
    expect(trace.points).toEqual([]);
    expect(trace.place.id).toBe('e2');
  });
});

describe('what gets written', () => {
  it('writes nothing before Save, and nothing at all on Cancel', async () => {
    const trace = store();
    trace.start(PLACE);
    trace.addPoint(A);
    trace.addPoint(B);
    trace.addPoint(C);
    trace.cancel();
    expect(api.patch).not.toHaveBeenCalled();
    expect(trace.on).toBe(false);
  });

  it('merges the shape onto the place, leaving everything else it holds', async () => {
    const trace = store();
    trace.start(PLACE);
    for (const point of [A, B, C]) trace.addPoint(point);
    await trace.save();
    // the radius goes with it: the map draws one of the two, and a circle nobody can
    // see behind the shape that replaced it is a precision nobody can read
    expect(api.patch).toHaveBeenCalledWith('/api/cases/case-1/entities/e1', {
      attrs: { footprint: polygonOf([A, B, C]), radius_m: null },
    });
    // and the case is re-read, so the shape appears under its pin
    expect(saved).toHaveBeenCalled();
    expect(trace.on).toBe(false);
  });

  it('sends nothing traced beside the place it belongs to', async () => {
    // The shape and the pin are each drawn where they were put, and nothing said the
    // two disagreed: saved, the place claimed an area it does not sit in.
    const trace = store();
    trace.start({ ...PLACE, lat: 40, lon: 40 });
    for (const point of [A, B, C]) trace.addPoint(point);
    expect(trace.complete).toBe(true);
    expect(trace.covers).toBe(false);

    await trace.save();

    expect(api.patch).not.toHaveBeenCalled();
    expect(trace.on).toBe(true); // theirs to move, not thrown away
  });

  it('takes a shape for a place that carries no point of its own', async () => {
    // `null` numbers as 0, which would put the place off West Africa and refuse
    // every shape drawn anywhere else
    for (const row of [{ id: 'e9', title: 'From a sheet' }, { id: 'e9', lat: null, lon: null }]) {
      const trace = store();
      trace.start(row);
      for (const point of [A, B, C]) trace.addPoint(point);
      expect(trace.covers).toBe(true);

      await trace.save();

      expect(api.patch).toHaveBeenCalled();
    }
  });

  it('sends nothing that is not an area', async () => {
    const trace = store();
    trace.start(PLACE);
    trace.addPoint(A);
    trace.addPoint(B);
    await trace.save();
    expect(api.patch).not.toHaveBeenCalled();
    expect(trace.on).toBe(true); // still theirs to finish
  });

  it('keeps the draft when the save fails, so the work is not lost', async () => {
    api.patch = vi.fn(async () => {
      throw new Error('disk is full');
    });
    const trace = store();
    trace.start(PLACE);
    for (const point of [A, B, C]) trace.addPoint(point);
    await trace.save();
    expect(notify.mock.calls[0][0]).toContain('disk is full');
    expect(trace.points).toHaveLength(3);
    expect(trace.on).toBe(true);
  });
});
