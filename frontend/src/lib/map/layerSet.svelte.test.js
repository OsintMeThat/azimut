import { describe, expect, it, vi } from 'vitest';
import { PICTURE } from './firms.js';
import { createLayerSet } from './layerSet.svelte.js';

const keyed = (over = {}) => ({ keyed: true, state: 'ok', paused: null, sensors: [{ id: 'viirs', label: 'VIIRS' }], ...over });

describe('one map’s layers', () => {
  it('starts on what the tool asked for, in the catalogue’s order', () => {
    const layers = createLayerSet({ fireKey: keyed(), initial: ['placenames', 'boundaries', 'labels'] });
    expect(layers.ids).toEqual(['boundaries', 'placenames']);
    expect(layers.overlays).toEqual(['boundaries', 'placenames']);
  });

  it('lists every catalogue layer as a chip, whatever is on', () => {
    const layers = createLayerSet({ fireKey: keyed() });
    expect(layers.rows().map((row) => row.id)).toEqual([
      'boundaries', 'placenames', 'roads', 'railway', 'power', 'seamarks', 'gpstraces', 'firms', 'nightlights', 'saved',
    ]);
  });

  it('switches a layer from its chip', () => {
    const layers = createLayerSet({ fireKey: keyed() });
    layers.rows().find((row) => row.id === 'railway').toggle();
    expect(layers.ids).toEqual(['railway']);
    expect(layers.rows().find((row) => row.id === 'railway').on).toBe(true);
  });

  it('greys a layer meant for imagery over a street map, and draws it nowhere', () => {
    const layers = createLayerSet({ fireKey: keyed(), initial: ['roads', 'boundaries'], imagery: () => false });
    expect(layers.rows().find((row) => row.id === 'roads')).toMatchObject({ disabled: true, title: 'Only useful over satellite imagery' });
    expect(layers.overlays).toEqual(['boundaries']);
  });

  it('leaves the case’s saved work to the tool, which draws it itself', () => {
    const layers = createLayerSet({ fireKey: keyed(), initial: ['saved'] });
    expect(layers.overlays).toEqual([]);
    expect(layers.rows({ saved: { count: 4 } }).find((row) => row.id === 'saved')).toMatchObject({ on: true, count: 4 });
  });

  it('keeps the fire layer locked and says how to unlock it while there is no key', () => {
    const onsettings = vi.fn();
    const layers = createLayerSet({ fireKey: keyed({ keyed: false, state: 'missing' }), initial: ['firms'], onsettings });
    const row = layers.rows().find((entry) => entry.id === 'firms');
    expect(row.disabled).toBe(true);
    expect(row.lock).toMatchObject({ text: 'needs a free key', action: 'Add a FIRMS key' });
    row.lock.run();
    expect(onsettings).toHaveBeenCalled();
    expect(layers.overlays).toEqual([]);
  });

  it('asks for the fires of the picture’s day on a map that follows it', () => {
    let day = '2024-03-12';
    const layers = createLayerSet({ fireKey: keyed(), follow: "Picture's day", pictureDay: () => day });
    layers.toggle('firms');
    expect(layers.overlays).toEqual([
      { id: 'firms', params: { sensor: 'viirs', window: 'dates', first: '2024-03-12', last: '2024-03-12' } },
    ]);
    expect(layers.rows().find((row) => row.id === 'firms').summary).toBe("VIIRS · 2024-03-12, the picture's day");
    day = '';
    expect(layers.overlays[0].params.window).toBe('24h');
    expect(layers.rows().find((row) => row.id === 'firms').summary).toBe('VIIRS · 24 h, the picture has no date');
  });

  it('asks for the last day on a map with no picture date to follow', () => {
    const layers = createLayerSet({ fireKey: keyed(), initial: [] });
    layers.toggle('firms');
    expect(layers.overlays[0].params.window).toBe('24h');
    const showing = layers.rows().find((row) => row.id === 'firms').controls[1];
    expect(showing.options.some((option) => option.id === PICTURE)).toBe(false);
  });

  it('draws the night of the picture, and says when it predates the sensor', () => {
    let day = '2025-06-02';
    const layers = createLayerSet({ fireKey: keyed(), follow: "Picture's day", pictureDay: () => day });
    layers.toggle('nightlights');
    expect(layers.overlays).toEqual([{ id: 'nightlights', params: { source: 'noaa20', day: '2025-06-02' } }]);
    day = '2019-05-01';
    expect(layers.overlays).toEqual([]);
    expect(layers.rows().find((row) => row.id === 'nightlights').note).toBe("The picture's day is outside NOAA-20's record.");
  });

  it('keeps only the reference layers, so nothing reaches NASA on the next visit', () => {
    const layers = createLayerSet({ fireKey: keyed(), initial: ['boundaries', 'firms', 'nightlights', 'saved'] });
    expect(layers.kept).toEqual(['boundaries']);
    layers.restore(['firms', 'roads', 'nightlights', 'saved', 'labels']);
    expect(layers.ids).toEqual(['roads']);
  });
});
