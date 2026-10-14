import { describe, expect, it } from 'vitest';
import {
  asOf, changes, editMoment, inForce, isTracked, lifeline, moment, momentLabel, moments, previousState, seenAt,
  stateAt, stepMoment,
} from './layerHistory.js';

const square = (x, size = 1) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + size, 0], [x + size, size], [x, size], [x, 0]]] });
const line = (y) => ({ type: 'LineString', coordinates: [[0, y], [1, y]] });
const tracked = (states, extra = {}) => ({ type: 'Feature', geometry: states.findLast((s) => !s.gone)?.geometry,
  properties: { key: 'k', name: 'Front', states, ...extra } });

const front = tracked([
  { at: '2026-10-03', geometry: line(0) },
  { at: '2026-10-12', geometry: line(1), status: 'damaged' },
  { at: '2026-10-20', gone: true },
]);

describe('moments', () => {
  it('checks a day or a day and a time, and nothing else', () => {
    expect(moment('2026-10-12')).toBe('2026-10-12');
    expect(moment('2026-10-12T14:05')).toBe('2026-10-12T14:05');
    for (const bad of ['2026-02-30', '2026-10-12T24:00', '12/10/2026', '', null]) expect(moment(bad)).toBeNull();
  });

  it('labels a day, a time, and always', () => {
    expect(momentLabel('2026-10-12')).toBe('12 Oct 2026');
    expect(momentLabel('2026-10-12T09:30')).toBe('12 Oct 2026 · 09:30');
    expect(momentLabel('')).toBe('Always');
  });

  it('lists every moment the layer changes at, plain days included, and steps through them', () => {
    const plain = { type: 'Feature', geometry: line(5), properties: { date: '2026-10-05', date_end: '2026-10-07' } };
    const list = moments({ features: [front, plain] });
    expect(list).toEqual(['2026-10-03', '2026-10-05', '2026-10-07', '2026-10-12', '2026-10-20']);
    expect(stepMoment(list, '2026-10-05', 1)).toBe('2026-10-07');
    expect(stepMoment(list, '2026-10-06', -1)).toBe('2026-10-05');
    expect(stepMoment(list, null, -1)).toBe('2026-10-20');
    expect(stepMoment(list, '2026-10-20', 1)).toBeNull();
  });

  it('is on only for a personal layer switched on', () => {
    expect(isTracked({ editable: true, track: { on: true } })).toBe(true);
    expect(isTracked({ editable: true, track: { on: false } })).toBe(false);
    expect(isTracked({ editable: false, track: { on: true } })).toBe(false);
  });
});

describe('a feature at a moment', () => {
  it('stands in the last state written at or before it, and nowhere before its first or after it went', () => {
    expect(stateAt(front, '2026-10-01')).toBeNull();
    expect(stateAt(front, '2026-10-03').geometry).toEqual(line(0));
    expect(stateAt(front, '2026-10-11T23:59').geometry).toEqual(line(0));
    const twelfth = stateAt(front, '2026-10-12');
    expect(twelfth.geometry).toEqual(line(1));
    expect(twelfth.properties.status).toBe('damaged');
    expect(twelfth.properties.states).toBeUndefined();
    expect(stateAt(front, '2026-10-20')).toBeNull();
  });

  it('reads a plain feature by its days, and an undated one as always there', () => {
    const plain = { geometry: line(0), properties: { date: '2026-10-05', date_end: '2026-10-07' } };
    expect(stateAt(plain, '2026-10-04')).toBeNull();
    expect(stateAt(plain, '2026-10-07T22:00')).toBe(plain);
    expect(stateAt(plain, '2026-10-08')).toBeNull();
    const always = { geometry: line(0), properties: {} };
    expect(stateAt(always, '1900-01-01')).toBe(always);
  });

  it('holds a day state from the start of its day, before every time of it', () => {
    const states = [{ at: '2026-10-12', geometry: line(0) }, { at: '2026-10-12T09:30', geometry: line(1) }];
    expect(inForce(states, '2026-10-12T09:00').geometry).toEqual(line(0));
    expect(inForce(states, '2026-10-12T09:30').geometry).toEqual(line(1));
  });

  it('knows the state before the one in force, which the trail draws', () => {
    expect(previousState(front, '2026-10-15').geometry).toEqual(line(0));
    expect(previousState(front, '2026-10-05')).toBeNull();
    expect(previousState(front, '2026-10-25')).toBeNull();
  });
});

describe('editing at the cursor', () => {
  it('writes a new state at the cursor, or corrects the one in force', () => {
    expect(editMoment(front, '2026-10-15', 'new')).toBe('2026-10-15');
    expect(editMoment(front, '2026-10-15', 'fix')).toBe('2026-10-12');
    const plain = { geometry: line(0), properties: {} };
    expect(editMoment(plain, '2026-10-15', 'fix')).toBeNull();
    expect(editMoment(front, null, 'new')).toBeNull();
  });

  it('lists the lifeline with the state at the cursor marked', () => {
    expect(lifeline(front, '2026-10-15').map((state) => [state.at, state.current, state.gone]))
      .toEqual([['2026-10-03', false, false], ['2026-10-12', true, false], ['2026-10-20', false, true]]);
    // with no cursor the latest drawn state is current
    expect(lifeline(front, null).find((state) => state.current).at).toBe('2026-10-12');
  });
});

describe('the layer as it stood', () => {
  const area = tracked([{ at: '2026-10-03', geometry: square(0) }, { at: '2026-10-12', geometry: square(0.5) }]);

  it('draws what stood then, and nothing more by default', () => {
    const drawn = asOf({ features: [front, area] }, '2026-10-05');
    expect(drawn.features.map((feature) => feature.geometry)).toEqual([line(0), square(0)]);
  });

  it('adds the previous state as a trail under the features', () => {
    const drawn = asOf({ features: [front] }, '2026-10-15', { trail: true });
    expect(drawn.features[0].properties.$trail).toBe(true);
    expect(drawn.features[0].geometry).toEqual(line(0));
    expect(drawn.features[1].geometry).toEqual(line(1));
  });

  it('reads the layer now when no moment is given', () => {
    const drawn = asOf({ features: [area] }, null, { trail: true });
    expect(drawn.features.at(-1).geometry).toEqual(square(0.5));
    expect(drawn.features[0].properties.$trail).toBe(true);
  });

  it('hatches what an area took and gave since its previous state', () => {
    const drawn = asOf({ features: [area] }, '2026-10-12', { since: 'previous' });
    const byChange = Object.fromEntries(drawn.features.filter((f) => f.properties.$change).map((f) => [f.properties.$change, f]));
    expect(Object.keys(byChange).sort()).toEqual(['gained', 'lost']);
    const ring = (feature) => feature.geometry.coordinates[0][0];
    expect(Math.min(...ring(byChange.gained).map(([x]) => x))).toBeCloseTo(1);
    expect(Math.max(...ring(byChange.lost).map(([x]) => x))).toBeCloseTo(0.5);
  });

  it('counts an area that was not there at the reference as all gained', () => {
    const drawn = asOf({ features: [area] }, '2026-10-12', { since: '2026-10-01' });
    const changed = drawn.features.filter((f) => f.properties.$change);
    expect(changed.map((f) => f.properties.$change)).toEqual(['gained']);
  });

  it('leaves lines out of the gains and losses', () => {
    expect(changes(front, line(0), line(1))).toEqual([]);
  });
});

describe('what an editor works on at a moment', () => {
  it('reshapes each tracked feature as it stood, keeps its history, and marks what was not there', () => {
    const plain = { type: 'Feature', geometry: line(5), properties: { key: 'p', date: '2026-10-15' } };
    const [front, later] = seenAt([tracked([
      { at: '2026-10-03', geometry: line(0) }, { at: '2026-10-12', geometry: line(1), status: 'damaged' }]), plain], '2026-10-05');
    expect(front.geometry).toEqual(line(0));
    expect(front.properties.status).toBeUndefined();
    expect(front.properties.states).toHaveLength(2);
    expect(later.properties.$absent).toBe(true);
    const list = [plain];
    expect(seenAt(list, null)).toBe(list);
  });
});

describe('the day the layer is read on', () => {
  const point = (properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { key: Math.random(), ...properties } });
  const read = (features, at, options) => asOf({ features }, at, options).features;

  it('rings what appeared or changed that very day, and nothing at now', () => {
    const [moved, born, old] = read([front, point({ date: '2026-10-12' }), point({ date: '2026-10-01' })], '2026-10-12');
    expect(moved.properties.$new).toBe(true);
    expect(born.properties.$new).toBe(true);
    expect(old.properties.$new).toBeUndefined();
    expect(read([point({ date: '2026-10-12' })], null)[0].properties.$new).toBeUndefined();
  });

  it('keeps a lasting thing as it is, fades an event after its day and lets it go after its window', () => {
    const strike = point({ date: '2026-10-05', event: true });
    const post = point({ date: '2026-10-05' });
    expect(read([strike], '2026-10-05')[0].properties.$fade).toBeUndefined();
    expect(read([strike], '2026-10-08')[0].properties.$fade).toBe(true);
    expect(read([strike, post], '2026-10-20')).toHaveLength(1);
    expect(read([strike], '2026-10-20', { window: 30 })).toHaveLength(1);
    expect(read([post], '2026-10-20')[0].properties.$fade).toBeUndefined();
  });

  it("reads events at now against the layer's last change, not the calendar", () => {
    const strike = point({ date: '2025-01-10', event: true });
    const last = point({ date: '2025-01-12' });
    const [kept] = read([strike, last], null);
    expect(kept.properties.$fade).toBe(true);
  });
});
