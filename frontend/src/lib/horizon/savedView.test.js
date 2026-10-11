import { describe, expect, it } from 'vitest';
import {
  footprintRing,
  madeOf,
  photoKept,
  photoSpec,
  restoredView,
  sameWork,
  signature,
  suggestedTitle,
  viewSpec,
} from './savedView.js';

function fakeView(change = {}) {
  return {
    observer: { lat: 46.55861234, lon: 7.83531234, mode: 'ground', height: 1.7 },
    camera: { heading: 95.5, tilt: 2.004, roll: 0, fov: 58, projection: 'camera' },
    ground: 'imagery',
    lines: true,
    ridges: 3,
    visibility: 40000,
    near: 300,
    drapeSource: 'esri-wayback~31144',
    nearOn: false,
    nearReach: 5000,
    nearDate: '2026-08-14',
    peaksOn: true,
    shadowDepth: 0.7,
    skyOn: true,
    skyDate: '2026-07-14',
    skyTime: '17:30',
    target: { lat: 46.5775, lon: 7.9853, height: 10, busy: false, visible: true },
    ...change,
  };
}

const STROKES = [[{ u: 0.1, v: 0.4 }, { u: 0.3, v: 0.38 }]];

function fakeOverlay(change = {}) {
  return {
    source: { name: 'Ridge at dusk.jpg', kind: 'image', caseId: 'c1', path: 'media/Ridge at dusk.jpg' },
    time: 0,
    mix: 0.55,
    bend: -0.08,
    warped: false,
    corners: [],
    strokes: STROKES,
    traceTime: null,
    pins: [],
    ...change,
  };
}

describe('a view as the case keeps it', () => {
  it('rounds what the tab shows and keeps a heading under a whole turn', () => {
    const spec = viewSpec(fakeView({ camera: { heading: 359.999, tilt: 2.004, roll: 0, fov: 58 } }));
    expect(spec.eye).toEqual({ lat: 46.558612, lon: 7.835312, mode: 'ground', height: 1.7 });
    expect(spec.look).toEqual({ heading: 0, tilt: 2, roll: 0, fov: 58, projection: 'camera' });
    expect(spec.picture).toMatchObject({ ground: 'imagery', ridges: 3, visibility: 40000, imagery: 'esri-wayback~31144' });
    expect(spec.sky).toEqual({ on: true, date: '2026-07-14', time: '17:30' });
    expect(spec.target).toEqual({ lat: 46.5775, lon: 7.9853, height: 10 });
    expect(spec.photo).toBeNull();
  });

  it('is nothing while no eye stands anywhere', () => {
    expect(viewSpec(fakeView({ observer: null }))).toBeNull();
  });

  it('keeps Sentinel-2 near the eye only while it is laid', () => {
    expect(viewSpec(fakeView()).picture.sentinel).toBeNull();
    expect(viewSpec(fakeView({ nearOn: true })).picture.sentinel).toEqual({ reach: 5000, date: '2026-08-14' });
  });

  it('keeps the photo of the case and the work on it, never a file of this computer', () => {
    const photo = photoSpec(fakeOverlay({ warped: true, corners: [{ u: 0, v: 0 }, { u: 1.05, v: -0.02 }, { u: 1, v: 1 }, { u: 0, v: 1 }] }));
    expect(photo).toMatchObject({ path: 'media/Ridge at dusk.jpg', kind: 'image', title: 'Ridge at dusk.jpg', mix: 0.55, bend: -0.08 });
    expect(photo.corners[1]).toEqual({ u: 1.05, v: -0.02 });
    expect(photo.strokes).toBe(STROKES);
    expect(photo.locked).toBe(false);
    expect(photoSpec(fakeOverlay({ locked: true })).locked).toBe(true);
    expect(photoSpec(fakeOverlay()).corners).toBeNull();
    const local = fakeOverlay({ source: { name: 'x.jpg', kind: 'image', caseId: null, path: null } });
    expect(photoSpec(local)).toBeNull();
    expect(photoKept(local)).toBe(false);
    expect(photoKept(fakeOverlay())).toBe(true);
    expect(photoKept({ source: null })).toBe(true);
  });

  it('keeps what was known about the photo and the reach Fit found its skyline at', () => {
    expect(photoSpec(fakeOverlay())).toMatchObject({ hints: { zoom: 'any', facing: null, reach: 'auto' }, reach: null });
    const told = photoSpec(fakeOverlay({ hints: { zoom: 'telephoto', facing: { heading: 218.444, half: 30 }, reach: 10_000 }, reachFound: 20_000 }));
    expect(told.hints).toEqual({ zoom: 'telephoto', facing: { heading: 218.4 }, reach: 10_000 });
    expect(told.reach).toBe(20_000);
  });
});

describe('what counts as a change', () => {
  it('leaves the look out while no photo is laid: looking round is reading', () => {
    const before = signature(viewSpec(fakeView()));
    expect(signature(viewSpec(fakeView({ camera: { heading: 120, tilt: 0, roll: 0, fov: 30 } })))).toBe(before);
    expect(signature(viewSpec(fakeView({ ground: 'relief' })))).not.toBe(before);
    expect(signature(viewSpec(fakeView({ skyTime: '08:00' })))).not.toBe(before);
  });

  it('counts the look once a photo is laid: it is the alignment', () => {
    const laid = fakeOverlay();
    const before = signature(viewSpec(fakeView(), laid));
    expect(signature(viewSpec(fakeView({ camera: { heading: 96, tilt: 2, roll: 0, fov: 58 } }), laid))).not.toBe(before);
    expect(signature(viewSpec(fakeView(), fakeOverlay({ mix: 1 })))).not.toBe(before);
    // the moment on show and the trace are not written out here
    expect(signature(viewSpec(fakeView(), fakeOverlay({ time: 3, strokes: [] })))).toBe(before);
  });

  it('leaves the look to the pins of a pinned video', () => {
    const pins = [{ time: 1, heading: 90, tilt: 0, roll: 0, fov: 60 }];
    const video = fakeOverlay({ source: { name: 'clip.mp4', kind: 'video', caseId: 'c1', path: 'media/clip.mp4' }, pins });
    const before = signature(viewSpec(fakeView(), video));
    expect(signature(viewSpec(fakeView({ camera: { heading: 140, tilt: 0, roll: 0, fov: 60 } }), video))).toBe(before);
  });

  it('compares the trace and the pins as the arrays they are', () => {
    const overlay = fakeOverlay();
    expect(sameWork(overlay, { strokes: STROKES, pins: overlay.pins })).toBe(true);
    expect(sameWork(overlay, { strokes: [...STROKES], pins: overlay.pins })).toBe(false);
  });
});

describe('back from the case', () => {
  it('hands the view what it restores', () => {
    const spec = viewSpec(fakeView({ nearOn: true }));
    expect(restoredView(spec)).toMatchObject({
      observer: spec.eye,
      camera: spec.look,
      visibility: 40000,
      near: 300,
      ground: 'imagery',
      lines: true,
      ridges: 3,
      imagery: 'esri-wayback~31144',
      sentinel: { reach: 5000, date: '2026-08-14' },
      names: true,
      shadows: 0.7,
      sky: spec.sky,
    });
  });

  it('says what the terrain was, as the turn read it', () => {
    const made = madeOf({
      credits: [{ label: 'Mapterhorn', attribution: '© Mapterhorn', link: 'x' }],
      resolution: 9.55,
      refraction: 0.13,
      observer: { ground: 2950.04, altitude: 2951.74 },
    });
    expect(made).toEqual({
      terrain: [{ label: 'Mapterhorn', attribution: '© Mapterhorn' }],
      resolution_m: 9.6,
      refraction: 0.13,
      ground_m: 2950,
      altitude_m: 2951.7,
    });
    expect(madeOf(null)).toEqual({});
  });

  it('writes the ground taken in as longitude and latitude', () => {
    expect(footprintRing([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6.1234567 }])).toEqual([[2, 1], [4, 3], [6.123457, 5]]);
    expect(footprintRing([{ lat: 1, lon: 2 }])).toBeNull();
  });

  it('offers the photo as a new view\'s name, else where it stands', () => {
    expect(suggestedTitle(fakeView(), fakeOverlay())).toBe('Ridge at dusk');
    expect(suggestedTitle(fakeView(), { source: null })).toBe('View from 46.5586, 7.8353');
  });
});
