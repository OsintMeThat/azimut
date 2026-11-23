import { describe, expect, it } from 'vitest';
import { OVERLAY_IDS } from './basemap.js';
import { CASE_POINT_LAYERS, knownLayers, LAYER_GROUPS, LAYERS, layerInfo } from './layerCatalog.js';

describe('the layer catalogue', () => {
  it('names every overlay the surface can draw, and the case’s own two layers', () => {
    const drawn = LAYERS.map((layer) => layer.id).filter((id) => !CASE_POINT_LAYERS.includes(id));
    expect(CASE_POINT_LAYERS).toEqual(['places', 'media']);
    expect(new Set(drawn)).toEqual(new Set(OVERLAY_IDS));
  });

  it('files each layer under a heading the menu lists', () => {
    const groups = new Set(LAYER_GROUPS.map((group) => group.id));
    for (const layer of LAYERS) {
      expect(groups.has(layer.group)).toBe(true);
      expect(layer.label).toBeTruthy();
      expect(layer.title).toBeTruthy();
    }
  });

  it('keeps a stored list ordered, unique and known', () => {
    // 'labels' was retired: a session saved with it opens without it
    expect(knownLayers(['places', 'roads', 'roads', 'buildings', 'labels'])).toEqual(['roads', 'places']);
    // the one Saved work layer became the case's two: a case kept with it keeps both
    expect(knownLayers(['saved', 'roads'])).toEqual(['roads', 'places', 'media']);
    expect(knownLayers(['saved', 'places'])).toEqual(['places', 'media']);
    expect(knownLayers(null)).toEqual([]);
  });

  it('says nothing about a layer nobody offers', () => {
    expect(layerInfo('roads').imageryOnly).toBe(true);
    expect(layerInfo('labels')).toBeNull();
  });
});
