// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cornersOf, createFootprintState, insidePoint, polygonOf } from './footprint.svelte.js';

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

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

let api;
let notify;
let layer;
let surface;
let engine;
let saved;
let currentCase;

let createZone;

function store() {
  return createFootprintState({
    api,
    notify,
    caseId: () => currentCase,
    engine: () => engine,
    onSaved: saved,
    createZone,
    surface,
  });
}

beforeEach(() => {
  api = { patch: vi.fn(async () => ({})), post: vi.fn(async () => ({})) };
  notify = vi.fn();
  layer = { set: vi.fn(), patch: vi.fn(() => true), clear: vi.fn(), destroy: vi.fn() };
  createZone = vi.fn(async () => ({}));
  surface = vi.fn(() => layer);
  engine = { id: 'map' };
  saved = vi.fn(async () => {});
  currentCase = 'case-1';
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

  it('keeps the case that owned the draft when another case becomes current', async () => {
    const trace = store();
    trace.start(PLACE);
    for (const point of [A, B, C]) trace.addPoint(point);
    currentCase = 'case-2';

    await trace.save();

    expect(api.patch.mock.calls[0][0]).toBe('/api/cases/case-1/entities/e1');
    expect(saved).toHaveBeenCalledWith('case-1');
  });

  it('does not let an old save clear or announce a newer draft', async () => {
    const pending = deferred();
    api.patch = vi.fn(() => pending.promise);
    const trace = store();
    trace.start(PLACE);
    for (const point of [A, B, C]) trace.addPoint(point);
    const oldSave = trace.save();

    trace.start({ ...PLACE, id: 'e2', title: 'Treeline' });
    pending.resolve({});
    await oldSave;

    expect(trace.place.id).toBe('e2');
    expect(saved).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('Footprint saved', expect.anything(), expect.anything());
  });
});

const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const drawn = () => layer.set.mock.calls.at(-1)[0];

describe('a shape already traced', () => {
  it('opens with its corners, each a handle, and a dot on each side to add one', () => {
    const trace = store();
    trace.start({ ...PLACE, lat: 0.5, lon: 0.5, footprint: SQUARE });
    expect(trace.points).toEqual([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }]);
    const shapes = drawn();
    expect(shapes.filter((one) => one.id.startsWith('fp-corner'))).toHaveLength(4);
    expect(shapes.filter((one) => one.id.startsWith('fp-side'))).toHaveLength(4);
    expect(shapes.find((one) => one.id === 'fp-shape').kind).toBe('polygon');
  });

  it('moves a corner dragged without tearing the handles down under the hand', () => {
    const trace = store();
    trace.start({ ...PLACE, lat: 0.5, lon: 0.5, footprint: SQUARE });
    const sets = layer.set.mock.calls.length;
    drawn().find((one) => one.id === 'fp-corner-2').onDrag({ lat: 2, lon: 2 });
    expect(trace.points[2]).toEqual({ lat: 2, lon: 2 });
    expect(layer.patch).toHaveBeenCalledWith('fp-shape', { points: expect.arrayContaining([{ lat: 2, lon: 2 }]) });
    expect(layer.set.mock.calls.length).toBe(sets);
  });

  it('adds a corner where a side’s dot is dragged', () => {
    const trace = store();
    trace.start({ ...PLACE, lat: 0.5, lon: 0.5, footprint: SQUARE });
    const side = drawn().find((one) => one.id === 'fp-side-0');
    side.onDragStart();
    side.onDrag({ lat: -0.2, lon: 0.5 });
    expect(trace.points).toHaveLength(5);
    expect(trace.points[1]).toEqual({ lat: -0.2, lon: 0.5 });
  });

  it('removes the corner picked on Delete, and nothing when none is', () => {
    const trace = store();
    trace.start({ ...PLACE, lat: 0.5, lon: 0.5, footprint: SQUARE });
    expect(trace.removeSelected()).toBe(false);
    drawn().find((one) => one.id === 'fp-corner-3').onClick();
    expect(trace.selected).toBe(3);
    expect(drawn().find((one) => one.id === 'fp-corner-3').className).toContain('picked');
    expect(trace.removeSelected()).toBe(true);
    expect(trace.points).toHaveLength(3);
    expect(trace.selected).toBe(-1);
  });

  it('takes the last corner back on Undo, and says when there is none', () => {
    const trace = store();
    trace.start(PLACE);
    expect(trace.undo()).toBe(false);
    trace.addPoint(A);
    expect(trace.undo()).toBe(true);
  });
});

describe('a new zone', () => {
  it('is drawn first and named in the panel, and saved as a place with its area', async () => {
    const trace = store();
    expect(trace.startNew()).toBe(true);
    expect(trace.place).toMatchObject({ fresh: true, zone: true, id: null });
    for (const point of [A, B, C]) trace.addPoint(point);
    expect(trace.ready).toBe(false); // no name yet
    trace.title = '  North quay  ';
    expect(trace.ready).toBe(true);

    await trace.save();

    const [zone] = createZone.mock.calls[0];
    expect(zone.title).toBe('North quay');
    expect(zone.footprint).toEqual(polygonOf([A, B, C]));
    // its pin stands inside its own area
    expect(zone.at).toEqual(insidePoint([A, B, C]));
    expect(api.patch).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledWith('case-1');
    expect(notify).toHaveBeenCalledWith('Zone saved', 'ok', 2000);
    expect(trace.on).toBe(false);
  });

  it('is not started where nothing can file it', () => {
    createZone = null;
    expect(store().startNew()).toBe(false);
  });

  it('takes its pin along when reshaped away from it, where a place refuses', async () => {
    const zone = { ...PLACE, lat: 0.5, lon: 0.5, zone: true, footprint: SQUARE };
    const trace = store();
    trace.start(zone);
    for (const corner of ['fp-corner-0', 'fp-corner-1', 'fp-corner-2', 'fp-corner-3']) {
      const index = Number(corner.at(-1));
      drawn().find((one) => one.id === corner).onDrag({ lat: 5 + (index > 1 ? 1 : 0), lon: 5 + (index % 3 ? 1 : 0) });
    }
    expect(trace.covers).toBe(true);
    await trace.save();
    expect(api.post.mock.calls[0][0]).toBe('/api/cases/case-1/satellite/places/e1/move');
    expect(api.patch).toHaveBeenCalled();

    const place = store();
    place.start({ ...zone, zone: false });
    drawn().find((one) => one.id === 'fp-corner-0').onDrag({ lat: 5, lon: 5 });
    drawn().find((one) => one.id === 'fp-corner-1').onDrag({ lat: 5, lon: 6 });
    drawn().find((one) => one.id === 'fp-corner-2').onDrag({ lat: 6, lon: 6 });
    drawn().find((one) => one.id === 'fp-corner-3').onDrag({ lat: 6, lon: 5 });
    expect(place.covers).toBe(false);
  });
});

describe('the corners of a shape, and a point inside it', () => {
  it('reads a ring back unclosed, and nothing from what is not an area', () => {
    expect(cornersOf(SQUARE)).toHaveLength(4);
    expect(cornersOf({ type: 'MultiPolygon', coordinates: [SQUARE.coordinates] })).toHaveLength(4);
    expect(cornersOf(null)).toEqual([]);
    expect(cornersOf({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });

  it('stands inside a shape whose corners average outside it', () => {
    // a U: its corners' mean falls in the gap between the arms
    const u = [
      { lat: 0, lon: 0 }, { lat: 0, lon: 3 }, { lat: 3, lon: 3 }, { lat: 3, lon: 2 },
      { lat: 1, lon: 2 }, { lat: 1, lon: 1 }, { lat: 3, lon: 1 }, { lat: 3, lon: 0 },
    ];
    const at = insidePoint(u);
    const inside = (p) => (p.lat < 1 ? p.lon > 0 && p.lon < 3 : (p.lon > 0 && p.lon < 1) || (p.lon > 2 && p.lon < 3));
    expect(inside(at)).toBe(true);
  });
});
