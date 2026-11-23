import { beforeEach, describe, expect, it } from 'vitest';
import { createLayerMemory, createMapLayerMemory, keptLayers } from './layerMemory.js';

let data;
let storage;

beforeEach(() => {
  data = new Map();
  storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
});

const memory = () => createLayerMemory(() => storage);

describe('what a map may keep', () => {
  it('keeps every catalogue layer but the fire and night ones, which show a day', () => {
    expect(keptLayers(['firms', 'roads', 'nightlights', 'places', 'boundaries'])).toEqual(['boundaries', 'roads', 'places']);
  });

  it('drops a retired or unknown layer', () => {
    expect(keptLayers(['labels', 'roads', 7, null])).toEqual(['roads']);
  });

  it('keeps the names under the places apart from the reference place names', () => {
    expect(keptLayers(['places-names', 'placenames', 'places'])).toEqual(['placenames', 'places', 'places-names']);
  });
});

describe('a map’s switches', () => {
  it('opens a case that never said anything on the map’s defaults', () => {
    const satellite = createMapLayerMemory('satellite', ['boundaries', 'placenames', 'places', 'media'], memory());
    expect(satellite.recall('c1')).toEqual(['boundaries', 'placenames', 'places', 'media']);
    expect(satellite.recall(null)).toEqual(['boundaries', 'placenames', 'places', 'media']);
  });

  it('opens the case again on what was kept, per map and per case', () => {
    const kept = memory();
    const satellite = createMapLayerMemory('satellite', ['boundaries'], kept);
    const detect = createMapLayerMemory('detect', ['boundaries'], kept);

    satellite.keep('c1', ['roads', 'firms']);

    expect(satellite.recall('c1')).toEqual(['roads']);
    expect(detect.recall('c1')).toEqual(['boundaries']);
    expect(satellite.recall('c2')).toEqual(['boundaries']);
  });

  it('writes nothing for a case still on the defaults, so it keeps following them', () => {
    const satellite = createMapLayerMemory('satellite', ['boundaries', 'placenames'], memory());
    satellite.keep('c1', ['placenames', 'boundaries', 'nightlights']);
    expect(data.size).toBe(0);
  });

  it('opens a case with the names under its places as it was left, and without them by default', () => {
    const satellite = createMapLayerMemory('satellite', ['boundaries', 'places', 'media'], memory());
    expect(satellite.recall('c1')).not.toContain('places-names');
    satellite.keep('c1', ['boundaries', 'places', 'places-names', 'media']);
    expect(satellite.recall('c1')).toEqual(['boundaries', 'places', 'places-names', 'media']);
  });

  it('keeps going back to the defaults once the case said something', () => {
    const satellite = createMapLayerMemory('satellite', ['boundaries'], memory());
    satellite.keep('c1', ['roads']);
    satellite.keep('c1', ['boundaries']);
    expect(satellite.recall('c1')).toEqual(['boundaries']);
  });

  it('keeps nothing without a case', () => {
    createMapLayerMemory('satellite', [], memory()).keep(null, ['roads']);
    expect(data.size).toBe(0);
  });
});

describe('the store underneath', () => {
  it('reads a damaged entry as nothing kept', () => {
    data.set('azimut:map-layers:c1', '{not json');
    const kept = memory();
    expect(kept.layers('c1', 'satellite')).toBeNull();
    expect(kept.added('c1')).toEqual({});
    expect(kept.drawing('c1')).toEqual([]);
  });

  it('opens on the defaults when the browser keeps nothing', () => {
    storage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const satellite = createMapLayerMemory('satellite', ['boundaries'], memory());
    satellite.keep('c1', ['roads']);
    expect(satellite.recall('c1')).toEqual(['boundaries']);
    expect(() => memory().forget('c1')).not.toThrow();
  });

  it('keeps the added layers and the drawing marks beside the catalogue ones', () => {
    const kept = memory();
    kept.keepLayers('c1', 'satellite', ['roads']);
    kept.keepAdded('c1', { satellite: ['Sightings', 'Sightings', ''], detect: [] });
    kept.markDrawing('c1', 'Sightings', true);

    expect(kept.layers('c1', 'satellite')).toEqual(['roads']);
    expect(kept.added('c1')).toEqual({ satellite: ['Sightings'], detect: [] });
    expect(kept.drawing('c1')).toEqual(['Sightings']);

    kept.clearDrawing('c1');
    expect(kept.drawing('c1')).toEqual([]);
    expect(kept.added('c1')).toEqual({ satellite: ['Sightings'], detect: [] });
  });

  it('forgets everything of a deleted case, and only of that one', () => {
    const kept = memory();
    kept.keepLayers('c1', 'satellite', ['roads']);
    kept.keepLayers('c2', 'satellite', ['power']);

    kept.forget('c1');

    expect(kept.layers('c1', 'satellite')).toBeNull();
    expect(kept.layers('c2', 'satellite')).toEqual(['power']);
  });
});
