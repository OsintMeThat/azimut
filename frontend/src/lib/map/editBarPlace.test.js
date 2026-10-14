import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACE, INSET, SNAP, TOP_INSET, barBox, loadPlace, loadTips, savePlace, saveTips, snapPlace, stepAside, upright } from './editBarPlace.js';

const frame = { width: 1000, height: 600 };
const wide = { width: 400, height: 38 };
const tall = { width: 38, height: 300 };
const memory = () => { const held = new Map(); return { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => held.set(key, value) }; };

describe('the edit bar’s place', () => {
  it('opens docked at the top, centred under the tool’s own row', () => {
    expect(barBox(frame, wide, DEFAULT_PLACE)).toEqual({ left: 300, top: TOP_INSET, width: 400, height: 38 });
    expect(upright(DEFAULT_PLACE)).toBe(false);
  });

  it('docks on the edge it is dropped near, upright on the sides', () => {
    expect(snapPlace(frame, { left: 20, top: 200, ...tall })).toEqual({ edge: 'left', x: 0.039, y: 0.583 });
    expect(snapPlace(frame, { left: 300, top: 600 - 38 - INSET - 5, ...wide }).edge).toBe('bottom');
    expect(snapPlace(frame, { left: 1000 - 38 - INSET - SNAP + 1, top: 100, ...tall }).edge).toBe('right');
    // in the middle, it stays where it was let go
    expect(snapPlace(frame, { left: 300, top: 250, ...wide })).toEqual({ edge: null, x: 0.5, y: 0.448 });
    expect(upright({ edge: 'right' })).toBe(true);
    const box = barBox(frame, tall, { edge: 'right', x: 0.9, y: 0.5 });
    expect(box).toMatchObject({ left: 1000 - 38 - INSET, top: 150 });
  });

  it('stays whole inside its map however small the map gets', () => {
    expect(barBox({ width: 500, height: 300 }, wide, { edge: null, x: 0.99, y: 0.99 })).toMatchObject({ left: 500 - 400 - INSET, top: 300 - 38 - INSET });
    expect(barBox(frame, wide, { edge: 'top', x: 0, y: 0 }).left).toBe(INSET);
  });

  it('steps off the zoom buttons along its edge, and off the panel', () => {
    const zoom = { left: 12, top: 58, right: 41, bottom: 120 };
    // docked left over the zoom buttons: it goes under them, still on the left edge
    expect(barBox(frame, tall, { edge: 'left', x: 0, y: 0.1 }, [zoom])).toMatchObject({ left: INSET, top: 128 });
    // the layer's panel takes the right side, top to bottom: no room on the edge, it goes beside it
    const panel = { left: 700, top: 70, right: 988, bottom: 580 };
    const beside = barBox(frame, tall, { edge: 'right', x: 1, y: 0.5 }, [panel]);
    expect(beside).toMatchObject({ left: 700 - 8 - 38, top: 150 });
    // nowhere to go: left where it was
    expect(stepAside({ left: 0, top: 0, width: 100, height: 100 }, { width: 100, height: 100 }, [{ left: 0, top: 0, right: 100, bottom: 100 }]))
      .toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('is kept in this browser and falls back to the default on anything odd', () => {
    const storage = memory();
    expect(loadPlace(storage)).toEqual(DEFAULT_PLACE);
    savePlace({ edge: 'left', x: 0, y: 0.4 }, storage);
    expect(loadPlace(storage)).toEqual({ edge: 'left', x: 0, y: 0.4 });
    storage.setItem('azimut:layer-bar', '{"edge":"middle","x":0.5,"y":0.5}');
    expect(loadPlace(storage)).toEqual(DEFAULT_PLACE);
    storage.setItem('azimut:layer-bar', 'not json');
    expect(loadPlace(storage)).toEqual(DEFAULT_PLACE);
    expect(loadPlace({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PLACE);
  });

  it('keeps its tips on until they are switched off', () => {
    const storage = memory();
    expect(loadTips(storage)).toBe(true);
    saveTips(false, storage);
    expect(loadTips(storage)).toBe(false);
    saveTips(true, storage);
    expect(loadTips(storage)).toBe(true);
    expect(loadTips({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
  });
});
