import { describe, expect, it } from 'vitest';
import { shareView } from './sharedView.js';

const PLACE = { lat: 12.7615, lon: 43.6571, zoom: 16, bearing: 30 };

function appWindow(tool = 'satellite', { on = true, mapView = null } = {}) {
  const state = { tool, mapView };
  const prefs = { on };
  return { state, prefs, share: (name) => shareView(name, { state, enabled: () => prefs.on }) };
}

describe('writing the window camera', () => {
  it('takes the settle of the map on screen, and says which tab wrote it', () => {
    const { state, share } = appWindow('detect');
    share('detect').settled(PLACE);
    expect(state.mapView).toEqual({ ...PLACE, by: 'detect' });
  });

  it('takes the rest of a map a tab switch hid mid-glide', () => {
    const { state, share } = appWindow('satellite');
    share('compare').settled(PLACE);
    expect(state.mapView).toEqual({ ...PLACE, by: 'compare' });
  });

  it('keeps the last ground looked at with the preference off, for when it comes back on', () => {
    const { state, share } = appWindow('satellite', { on: false });
    share('satellite').settled(PLACE);
    expect(state.mapView).toEqual({ ...PLACE, by: 'satellite' });
  });

  it('does not write a map landing short of the shared zoom at its own ceiling', () => {
    const shared = { ...PLACE, zoom: 20, by: 'satellite' };
    const { state, share } = appWindow('detect', { mapView: shared });
    share('detect').settled({ ...PLACE, zoom: 18 }, 18);
    expect(state.mapView).toBe(shared);
  });

  it('writes a zoom made on the same spot below the ceiling', () => {
    const shared = { ...PLACE, zoom: 20, by: 'satellite' };
    const { state, share } = appWindow('detect', { mapView: shared });
    share('detect').settled({ ...PLACE, zoom: 15 }, 18);
    expect(state.mapView).toEqual({ ...PLACE, zoom: 15, by: 'detect' });
  });

  it('writes a turn made in place', () => {
    const { state, share } = appWindow('compare', { mapView: { ...PLACE, by: 'satellite' } });
    share('compare').settled({ ...PLACE, bearing: 90 });
    expect(state.mapView).toEqual({ ...PLACE, bearing: 90, by: 'compare' });
  });

  it('leaves the camera alone when a tab settles where it already is', () => {
    const shared = { ...PLACE, by: 'satellite' };
    const { state, share } = appWindow('detect', { mapView: shared });
    share('detect').settled({ ...PLACE, lat: PLACE.lat + 1e-7 });
    expect(state.mapView).toBe(shared);
  });
});

describe('taking the window camera', () => {
  it('moves a tab that shows to where another map left the window', () => {
    const shared = { ...PLACE, by: 'satellite' };
    const { share } = appWindow('detect', { mapView: shared });
    expect(share('detect').pending({ lat: 0, lon: 0, zoom: 3, bearing: 0 })).toBe(shared);
  });

  it('never hands a tab back its own camera', () => {
    const { share } = appWindow('detect', { mapView: { ...PLACE, by: 'detect' } });
    expect(share('detect').pending({ lat: 0, lon: 0, zoom: 3, bearing: 0 })).toBe(null);
  });

  it('follows the chain, which writes as nobody on the window', () => {
    const shared = { ...PLACE, by: 'link' };
    const { share } = appWindow('satellite', { mapView: shared });
    expect(share('satellite').pending({ lat: 0, lon: 0, zoom: 3, bearing: 0 })).toBe(shared);
  });

  it('stays put when it is already there', () => {
    const { share } = appWindow('compare', { mapView: { ...PLACE, by: 'satellite' } });
    expect(share('compare').pending({ ...PLACE })).toBe(null);
  });

  it('asks a turned map to turn as well', () => {
    const shared = { ...PLACE, by: 'satellite' };
    const { share } = appWindow('compare', { mapView: shared });
    expect(share('compare').pending({ ...PLACE, bearing: 0 })).toBe(shared);
  });

  it('gives a window with no camera yet the camera of the first map on screen', () => {
    const { state, share } = appWindow('satellite');
    expect(share('satellite').pending({ ...PLACE })).toBe(null);
    expect(state.mapView).toEqual({ ...PLACE, by: 'satellite' });
    // …which a hidden tab showing nothing yet does not do
    const hidden = appWindow('compare');
    hidden.share('satellite').pending({ ...PLACE });
    expect(hidden.state.mapView).toBe(null);
  });

  it('moves nothing with the preference off, or for a tab that is not on screen', () => {
    const shared = { ...PLACE, by: 'satellite' };
    const off = appWindow('detect', { on: false, mapView: shared });
    expect(off.share('detect').pending({ lat: 0, lon: 0, zoom: 3 })).toBe(null);
    const hidden = appWindow('satellite', { mapView: shared });
    expect(hidden.share('detect').pending({ lat: 0, lon: 0, zoom: 3 })).toBe(null);
  });

  it('says when another map left the window camera, which a tab arriving follows', () => {
    const shared = { ...PLACE, by: 'satellite' };
    expect(appWindow('detect', { mapView: shared }).share('detect').ledElsewhere()).toBe(true);
    expect(appWindow('detect', { mapView: { ...PLACE, by: 'link' } }).share('detect').ledElsewhere()).toBe(true);
    // its own camera, none yet, or the preference off: its own ground stands
    expect(appWindow('detect', { mapView: { ...PLACE, by: 'detect' } }).share('detect').ledElsewhere()).toBe(false);
    expect(appWindow('detect').share('detect').ledElsewhere()).toBe(false);
    expect(appWindow('detect', { on: false, mapView: shared }).share('detect').ledElsewhere()).toBe(false);
  });

  it('opens a new map on the window camera, and only with the preference on', () => {
    const shared = { ...PLACE, by: 'satellite' };
    expect(appWindow('detect', { mapView: shared }).share('detect').opening()).toBe(shared);
    expect(appWindow('detect', { on: false, mapView: shared }).share('detect').opening()).toBe(null);
    expect(appWindow('detect').share('detect').opening()).toBe(null);
  });
});
