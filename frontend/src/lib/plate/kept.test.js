import { describe, expect, it } from 'vitest';
import { featureId, firstDay, hiddenName, isDated, keptMoments, keptOf, spanTo, withHidden } from './kept.js';

const point = (lon, lat = 48.86) => ({ type: 'Point', coordinates: [lon, lat] });
const tracked = (key, name, states) => ({ type: 'Feature', geometry: states.at(-1).geometry, properties: { key, name, states } });
const plain = (name, date, lon) => ({ type: 'Feature', geometry: point(lon), properties: { name, ...(date ? { date } : {}) } });

const layer = () => ({ type: 'FeatureCollection', features: [
  tracked('post', 'Post', [{ at: '2026-10-03', geometry: point(2.3) }, { at: '2026-10-09', geometry: point(2.31) }]),
  tracked('gate', 'Gate', [{ at: '2026-10-07', geometry: point(2.32) }]),
  tracked('wall', 'Wall', [{ at: '', geometry: point(2.33) }, { at: '2026-10-08', geometry: point(2.34) }]),
  plain('Strike', '2026-10-04', 2.35),
  plain('Depot', '', 2.36),
] });
const names = (collection) => collection.features.map((feature) => feature.properties.name);

describe('how a plate names a feature', () => {
  it('by its key, or a source\'s by its name and where it stands', () => {
    expect(featureId(layer().features[0])).toBe('post');
    expect(featureId(plain('Strike', '', 2.351234567))).toBe('~Strike@2.35123,48.86000');
    expect(featureId({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2, 30], [3, 4]] }, properties: {} })).toBe('~@1.00000,2.00000');
    expect(featureId({ type: 'Feature', geometry: null, properties: {} })).toBe('');
  });

  it('dates it by its first state, or the day its source gives it; never for one that is always there', () => {
    const [post, , wall, strike, depot] = layer().features;
    expect([firstDay(post), firstDay(wall), firstDay(strike), firstDay(depot)]).toEqual(['2026-10-03', '', '2026-10-04', '']);
    expect(firstDay(tracked('t', 'T', [{ at: '2026-10-05T14:30', geometry: point(1) }]))).toBe('2026-10-05');
  });
});

describe('what a plate\'s map keeps of a layer', () => {
  it('is the layer itself while it leaves nothing out', () => {
    const collection = layer();
    expect(keptOf(collection, { name: 'front', hidden_features: [], start: null })).toBe(collection);
    expect(keptOf(collection, undefined)).toBe(collection);
    expect(keptOf(null, { hidden_features: ['post'] })).toBeNull();
  });

  it('leaves out each feature hidden on it, by key or by name and place', () => {
    const kept = keptOf(layer(), { hidden_features: ['gate', '~Strike@2.35000,48.86000'] });
    expect(names(kept)).toEqual(['Post', 'Wall', 'Depot']);
  });

  it('leaves out what began before its first day, whatever came of it since, and keeps what is always there', () => {
    expect(names(keptOf(layer(), { start: '2026-10-05' }))).toEqual(['Gate', 'Wall', 'Depot']);
    expect(names(keptOf(layer(), { start: '2026-10-03' }))).toEqual(['Post', 'Gate', 'Wall', 'Strike', 'Depot']);
  });

  it('leaves out what began after its last day, keeps what began on it, and runs a period between both', () => {
    expect(names(keptOf(layer(), { end: '2026-10-05' }))).toEqual(['Post', 'Wall', 'Strike', 'Depot']);
    expect(names(keptOf(layer(), { end: '2026-10-07' }))).toEqual(['Post', 'Gate', 'Wall', 'Strike', 'Depot']);
    expect(names(keptOf(layer(), { start: '2026-10-04', end: '2026-10-07' }))).toEqual(['Gate', 'Wall', 'Strike', 'Depot']);
    expect(names(keptOf(layer(), { start: '2026-10-04', end: '2026-10-04' }))).toEqual(['Wall', 'Strike', 'Depot']);
  });

  it('hands back the same reading for the same filter, so a map that drew it is spared drawing it again', () => {
    const collection = layer();
    const entry = { hidden_features: ['gate'], start: '2026-10-04' };
    expect(keptOf(collection, { ...entry })).toBe(keptOf(collection, entry));
    expect(keptOf(collection, { ...entry, start: '2026-10-05' })).not.toBe(keptOf(collection, entry));
    expect(keptOf(collection, { ...entry, end: '2026-10-08' })).not.toBe(keptOf(collection, entry));
  });

  it('moves no day for what it hides: the days start at its first one', () => {
    const collection = layer();
    expect(keptMoments(collection, null)).toEqual(['2026-10-03', '2026-10-04', '2026-10-07', '2026-10-08', '2026-10-09']);
    expect(keptMoments(collection, { start: '2026-10-05' })).toEqual(['2026-10-07', '2026-10-08']);
    expect(keptMoments(collection, { hidden_features: ['post', 'wall'] })).toEqual(['2026-10-04', '2026-10-07']);
    expect(keptMoments(null, { start: '2026-10-05' })).toEqual([]);
    // what began by the last day still changes after it, and plays those days
    expect(keptMoments(collection, { end: '2026-10-05' })).toEqual(['2026-10-03', '2026-10-04', '2026-10-08', '2026-10-09']);
    expect(isDated(collection)).toBe(true);
    expect(isDated({ features: [plain('Depot', '', 1)] })).toBe(false);
  });
});

describe('the days a map draws a layer between', () => {
  it('sets either end, pulling the other along when they would cross', () => {
    expect(spanTo({}, 'start', '2026-10-05')).toEqual({ start: '2026-10-05', end: null });
    expect(spanTo({ start: '2026-10-05' }, 'end', '2026-10-20')).toEqual({ start: '2026-10-05', end: '2026-10-20' });
    expect(spanTo({ start: '2026-10-05', end: '2026-10-20' }, 'start', '2026-10-25')).toEqual({ start: '2026-10-25', end: '2026-10-25' });
    expect(spanTo({ start: '2026-10-05', end: '2026-10-20' }, 'end', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-01' });
  });

  it('opens either end again without touching the other', () => {
    expect(spanTo({ start: '2026-10-05', end: '2026-10-20' }, 'start', '')).toEqual({ start: null, end: '2026-10-20' });
    expect(spanTo({ start: '2026-10-05', end: '2026-10-20' }, 'end', null)).toEqual({ start: '2026-10-05', end: null });
  });
});

describe('hiding a feature on one map', () => {
  it('adds it to its layer\'s list once, and takes it back off', () => {
    const layers = [{ name: 'front', hidden: [] }, { name: 'strikes', hidden: [], hidden_features: ['a'] }];
    const hidden = withHidden(withHidden(layers, 'front', 'post', true), 'front', 'post', true);
    expect(hidden[0].hidden_features).toEqual(['post']);
    expect(hidden[1]).toBe(layers[1]);
    expect(withHidden(hidden, 'front', 'post', false)[0].hidden_features).toEqual([]);
  });

  it('says what a hidden feature is called, even once its source has lost it', () => {
    const collection = layer();
    expect(hiddenName(collection, 'gate')).toBe('Gate');
    expect(hiddenName(collection, '~Strike@2.35000,48.86000')).toBe('Strike');
    expect(hiddenName(null, '~Old post@1.00000,2.00000')).toBe('Old post');
    expect(hiddenName(collection, 'gone')).toBe('');
  });
});
