import { describe, expect, it } from 'vitest';
import {
  asOf, changedBy, changes, changesOn, foldRows, inForce, isTracked, lifeline, lifeRows, moment, momentLabel, momentNow, moments,
  previousState, seenAt, shortMoment, spanLabel, spanOf, stateAt, stepMoment,
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

  it("says the moment it is on a layer's clock, to the day or to the minute", () => {
    const at = new Date('2026-10-16T22:30:00Z');
    expect(momentNow({ zone: 'UTC' }, at)).toBe('2026-10-16');
    // past midnight in Paris while UTC is still on the 16th
    expect(momentNow({ zone: 'Europe/Paris' }, at)).toBe('2026-10-17');
    expect(momentNow({ zone: 'Europe/Paris', precision: 'time' }, at)).toBe('2026-10-17T00:30');
    expect(momentNow({ zone: 'America/New_York', precision: 'time' }, at)).toBe('2026-10-16T18:30');
    // no clock, or one this browser does not know, reads on UTC
    expect(momentNow(null, at)).toBe('2026-10-16');
    expect(momentNow({ zone: 'Nowhere/Atlantis' }, at)).toBe('2026-10-16');
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

  it('rings what appeared or changed that very day, and nothing with no moment', () => {
    const [moved, born, old] = read([front, point({ date: '2026-10-12' }), point({ date: '2026-10-01' })], '2026-10-12');
    expect(moved.properties.$new).toBe(true);
    expect(born.properties.$new).toBe(true);
    expect(old.properties.$new).toBeUndefined();
    expect(read([point({ date: '2026-10-12' })], null)[0].properties.$new).toBeUndefined();
  });

  it('keeps a lasting thing as it is, and an event faded after its day for good unless given a window', () => {
    const strike = point({ date: '2026-10-05', event: true });
    const post = point({ date: '2026-10-05' });
    expect(read([strike], '2026-10-05')[0].properties.$fade).toBeUndefined();
    expect(read([strike], '2026-10-08')[0].properties.$fade).toBe(true);
    // no window: a year on, the strike is still there, faded
    expect(read([strike], '2027-10-05')[0].properties.$fade).toBe(true);
    expect(read([strike, post], '2026-10-20', { window: 7 })).toHaveLength(1);
    expect(read([strike], '2026-10-20', { window: 30 })).toHaveLength(1);
    expect(read([post], '2026-10-20')[0].properties.$fade).toBeUndefined();
  });

  it("reads events with no moment against the layer's last change, not the calendar", () => {
    const strike = point({ date: '2025-01-10', event: true });
    const last = point({ date: '2025-01-12' });
    const [kept] = read([strike, last], null);
    expect(kept.properties.$fade).toBe(true);
  });
});

describe('a reading kept', () => {
  const point = (properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { key: Math.random(), ...properties } });

  it('hands back the same reading for a day where nothing moved, and a new one when something did', () => {
    const layer = { features: [front, point({ date: '2026-10-01' })] };
    const fifth = asOf(layer, '2026-10-05');
    expect(asOf(layer, '2026-10-08')).toBe(fifth);
    // the 12th moves the front and rings it, the 13th only takes the ring off
    const twelfth = asOf(layer, '2026-10-12');
    expect(twelfth).not.toBe(fifth);
    expect(asOf(layer, '2026-10-13')).not.toBe(twelfth);
    expect(asOf(layer, '2026-10-14')).toBe(asOf(layer, '2026-10-13'));
    // what the map draws of the past is part of the reading
    expect(asOf(layer, '2026-10-05', { trail: true })).not.toBe(fifth);
  });

  it('takes an event fading or going as a change', () => {
    const layer = { features: [point({ date: '2026-10-05', event: true })] };
    const day = asOf(layer, '2026-10-05');
    const faded = asOf(layer, '2026-10-06');
    expect(faded).not.toBe(day);
    expect(asOf(layer, '2026-10-09')).toBe(faded);
    expect(asOf(layer, '2026-10-20').features).toHaveLength(1);
    expect(asOf(layer, '2026-10-20', { window: 7 }).features).toHaveLength(0);
  });

  it('reads every day of a busy layer as a fresh reading would', () => {
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const features = Array.from({ length: 40 }, (_, index) => {
      if (index % 4 === 3) return point({ date: `2026-10-${String(1 + Math.floor(random() * 20)).padStart(2, '0')}`, event: index % 8 === 3 });
      const states = [];
      for (let day = 1 + Math.floor(random() * 6); day <= 28; day += 3 + Math.floor(random() * 9)) {
        states.push(random() < 0.15 ? { at: `2026-10-${String(day).padStart(2, '0')}`, gone: true }
          : { at: `2026-10-${String(day).padStart(2, '0')}${random() < 0.3 ? 'T14:00' : ''}`, geometry: square(random()) });
      }
      return tracked(states);
    });
    const layer = { features };
    for (const options of [{}, { trail: true }, { trail: true, since: 'previous' }, { since: '2026-10-10', window: 3 }]) {
      for (let day = 1; day <= 30; day += 1) {
        for (const at of [`2026-10-${String(day).padStart(2, '0')}`, `2026-10-${String(day).padStart(2, '0')}T18:00`]) {
          expect(asOf(layer, at, options)).toEqual(asOf(structuredClone(layer), at, options));
        }
      }
      expect(asOf(layer, null, options)).toEqual(asOf(structuredClone(layer), null, options));
    }
  });
});

describe('when a feature shows, as the editor says it', () => {
  const plain = (properties = {}) => ({ type: 'Feature', geometry: line(0), properties: { key: 'p', ...properties } });

  it('reads a plain feature from its days and a history from its states', () => {
    expect(spanOf(plain())).toEqual({ start: '', end: '', ends: 'last', changes: 0, unknown: false });
    expect(spanOf(plain({ date: '2026-10-03', date_end: '2026-10-09' }))).toEqual({ start: '2026-10-03', end: '2026-10-09', ends: 'last', changes: 0, unknown: false });
    expect(spanOf(front)).toEqual({ start: '2026-10-03', end: '2026-10-20', ends: 'gone', changes: 1, unknown: false });
    const always = tracked([{ at: '', geometry: line(0) }, { at: '2026-10-12', geometry: line(1) }]);
    expect(spanOf(always)).toEqual({ start: '', end: '', ends: 'gone', changes: 1, unknown: false });
  });

  it('says an end nobody knows only of a feature with no end', () => {
    expect(spanOf(plain({ date: '2026-10-03', end_unknown: true })).unknown).toBe(true);
    expect(spanOf(plain({ date: '2026-10-03', date_end: '2026-10-09', end_unknown: true })).unknown).toBe(false);
    expect(spanOf({ ...front, properties: { ...front.properties, end_unknown: true } }).unknown).toBe(false);
    expect(spanLabel(spanOf(plain({ date: '2026-10-13', end_unknown: true })), { year: 2026 })).toBe('13 Oct → ?');
    expect(spanLabel(spanOf(plain({ end_unknown: true })), { year: 2026 })).toBe('Always → ?');
  });

  it('says it in a few words, the year only when it is not this one', () => {
    const year = 2026;
    expect(spanLabel(spanOf(plain()), { year })).toBe('Always');
    expect(spanLabel({ start: '2026-10-12', end: '' }, { year })).toBe('From 12 Oct');
    expect(spanLabel({ start: '', end: '2026-10-20' }, { year })).toBe('Until 20 Oct');
    expect(spanLabel({ start: '2025-12-30', end: '2026-01-02' }, { year })).toBe('30 Dec 2025 → 2 Jan');
    expect(spanLabel({ start: '2026-10-12', end: '' }, { year, event: true })).toBe('12 Oct');
    expect(spanLabel({ start: '', end: '' }, { year, event: true })).toBe('No day');
    expect(shortMoment('2026-10-12T14:00', year)).toBe('12 Oct 14:00');
  });

  it('says what each state brought', () => {
    expect(lifeline(front, null).map((row) => row.what)).toEqual(['Appears', 'Reshaped · Damaged', 'Gone']);
    const marker = { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { key: 'm', states: [
      { at: '', geometry: { type: 'Point', coordinates: [0, 0] } },
      { at: '2026-10-05', gone: true },
      { at: '2026-10-08', geometry: { type: 'Point', coordinates: [0, 0] } },
      { at: '2026-10-09', geometry: { type: 'Point', coordinates: [1, 1] } },
      { at: '2026-10-10', geometry: { type: 'Point', coordinates: [1, 1] }, status: 'destroyed' },
    ] } };
    expect(lifeline(marker, null).map((row) => row.what)).toEqual(['Shown', 'Gone', 'Back', 'Moved', 'Destroyed']);
  });

  it('marks the state a dated edit rewrites, or where a new one goes', () => {
    const shown = (rows) => rows.map((row) => [row.at, row.editing, row.ghost]);
    // with no moment, or with no date, an edit counts on every day alike: no row is its own
    expect(shown(lifeRows(front, null))).toEqual([['2026-10-03', false, false], ['2026-10-12', false, false], ['2026-10-20', false, false]]);
    expect(shown(lifeRows(front, '2026-10-15', 'fix'))).toEqual(shown(lifeRows(front, null)));
    // a day between two states: a new one there
    expect(shown(lifeRows(front, '2026-10-15', 'new'))).toEqual([
      ['2026-10-03', false, false], ['2026-10-12', false, false], ['2026-10-15', false, true], ['2026-10-20', false, false]]);
    // on a state's own day the edit rewrites it
    expect(lifeRows(front, '2026-10-12', 'new').filter((row) => row.editing).map((row) => row.at)).toEqual(['2026-10-12']);
    // where it is not shown, nothing is edited
    expect(lifeRows(front, '2026-10-25', 'new').some((row) => row.editing || row.ghost)).toBe(false);
  });

  it('knows what a feature changed by date, which an edit with no date leaves alone', () => {
    expect(changedBy(front)).toEqual({ shape: '2026-10-12', status: '2026-10-12' });
    const struck = tracked([{ at: '', geometry: line(0) }, { at: '2026-10-08', geometry: line(0), status: 'destroyed' }, { at: '2026-10-09', gone: true }]);
    expect(changedBy(struck)).toEqual({ shape: '', status: '2026-10-08' });
    expect(changedBy(plain({ date: '2026-10-03' }))).toEqual({ shape: '', status: '' });
  });

  it('shows a plain feature the history a dated edit would give it', () => {
    expect(lifeRows(plain(), null)).toHaveLength(1);
    expect(lifeRows(plain(), '2026-10-15', 'fix')).toHaveLength(1);
    expect(lifeRows(plain(), '2026-10-15', 'new').map((row) => [row.at, row.what, row.ghost])).toEqual([['', 'Shown', false], ['2026-10-15', 'Next edit', true]]);
    expect(lifeRows(plain({ date: '2026-10-20' }), '2026-10-15', 'new')).toHaveLength(1);
  });

  it('knows what happens on the day the layer is shown at', () => {
    expect(changesOn(front, '2026-10-12T09:00')).toBe(true);
    expect(changesOn(front, '2026-10-20')).toBe(true);
    expect(changesOn(front, '2026-10-15')).toBe(false);
    expect(changesOn(plain({ date: '2026-10-15' }), '2026-10-15')).toBe(true);
    expect(changesOn(plain(), '2026-10-15')).toBe(false);
    expect(changesOn(front, null)).toBe(false);
  });
});

describe('a long history', () => {
  const day = (index) => `2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`;
  const many = (count, extra = {}) => Array.from({ length: count }, (_, index) => ({ at: day(index), what: 'Moved', current: false, ...(extra[index] ?? {}) }));

  it('keeps a short one whole', () => {
    const rows = many(7, { 6: { current: true } });
    expect(foldRows(rows)).toBe(rows);
  });

  it('keeps the first, the last and the dates round the edit, counting the rest', () => {
    const rows = many(100, { 50: { editing: true }, 99: { current: true } });
    const shown = foldRows(rows);
    expect(shown.map((row) => (row.fold ? `+${row.fold}` : row.at))).toEqual([day(0), '+48', day(49), day(50), day(51), '+47', day(99)]);
    expect(shown[1].at).toBe(day(1));
  });

  it('falls back to the date shown, then to the last, and never folds a lone date', () => {
    expect(foldRows(many(9, { 2: { current: true } })).map((row) => (row.fold ? `+${row.fold}` : row.at)))
      .toEqual([day(0), day(1), day(2), day(3), '+4', day(8)]);
    expect(foldRows(many(9)).map((row) => (row.fold ? `+${row.fold}` : row.at)))
      .toEqual([day(0), '+6', day(7), day(8)]);
  });
});
