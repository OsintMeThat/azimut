import { describe, expect, it } from 'vitest';
import {
  COMPARE_LAYERS,
  COMPARE_MODES,
  DIFFERENCE_KEY,
  availablePresets,
  compareMode,
  comparisonLayers,
  percentage,
  providerKind,
} from './compare.js';

describe('compare helpers', () => {
  it('offers four view modes with a key each, and Difference on the next key', () => {
    expect(COMPARE_MODES.map((mode) => mode.id)).toEqual(['side', 'swipe', 'opacity', 'blink']);
    expect(COMPARE_MODES.map((mode) => mode.key)).toEqual(['1', '2', '3', '4']);
    expect(DIFFERENCE_KEY).toBe('5');
  });

  it('reads a saved mode back, the old Difference mode as side by side', () => {
    expect(compareMode('swipe')).toBe('swipe');
    expect(compareMode('change')).toBe('side');
    expect(compareMode('analysis')).toBe('side');
    expect(compareMode(undefined)).toBe('side');
  });

  it('keeps layers ordered, unique and supported', () => {
    expect(comparisonLayers(['saved', 'roads', 'roads', 'buildings', 'labels'])).toEqual([
      'labels',
      'roads',
      'saved',
    ]);
    expect(comparisonLayers(null)).toEqual([]);
    expect(new Set(COMPARE_LAYERS.map((layer) => layer.group))).toEqual(
      new Set(['reference', 'events', 'case'])
    );
  });

  it('clamps percentages for CSS', () => {
    expect(percentage('73.4')).toBe(73);
    expect(percentage(-4)).toBe(0);
    expect(percentage(140)).toBe(100);
    expect(percentage('nope', 12)).toBe(12);
  });

  it('files providers under archives, imagery or maps', () => {
    expect(providerKind({ id: 'esri-wayback' })).toBe('archive');
    expect(providerKind({ id: 'sentinel2' })).toBe('archive');
    expect(providerKind({ id: 'osm', imagery: false })).toBe('map');
    expect(providerKind({ id: 'esri-world-imagery', imagery: true })).toBe('imagery');
  });

  it('offers only the starting points the catalogue can start', () => {
    const ids = (providers) => availablePresets(providers).map((preset) => preset.id);
    const free = [{ id: 'esri-wayback' }, { id: 'esri-world-imagery' }, { id: 'osm' }];
    expect(ids(free)).toEqual(['archive', 'map']);
    expect(ids([...free, { id: 'sentinel2', needs_key: true }])).toEqual(['archive', 'map']);
    expect(ids([...free, { id: 'sentinel2' }])).toEqual(['archive', 'sentinel', 'map']);
    // radar arrives once Settings has found its layer
    expect(ids([...free, { id: 'sentinel2' }, { id: 'sentinel1' }])).toEqual(['archive', 'sentinel', 'radar', 'map']);
    expect(providerKind({ id: 'sentinel1' })).toBe('archive');
  });
});
