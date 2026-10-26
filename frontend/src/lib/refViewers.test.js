import { describe, it, expect } from 'vitest';
import {
  createViewer,
  nextZ,
  restack,
  clampWindow,
  clampSize,
  clampPan,
  zoomAt,
  clampOpacity,
  flipFade,
  clampDock,
  nextSlowRate,
  factDate,
  mediaFacts,
  hasFacts,
  snapWindow,
  settledCorner,
  cornerSpot,
  placeOf,
  PLACES,
  MIN_SCALE,
  MAX_SCALE,
  MIN_W,
  MIN_H,
  MIN_OPACITY,
  FADE_TO,
  DOCK_MIN_W,
} from './refViewers.js';

describe('createViewer', () => {
  it('seeds sane defaults and prefers title over filename', () => {
    const v = createViewer('a', { path: 'm/x.jpg', title: 'Shot', filename: 'x.jpg' });
    expect(v.id).toBe('a');
    expect(v.path).toBe('m/x.jpg');
    expect(v.kind).toBe('image');
    expect(v.title).toBe('Shot');
    expect(v.scale).toBe(1);
    expect(v.ox).toBe(0);
    expect(v.collapsed).toBe(false);
  });

  it('falls back to filename, then empty title', () => {
    expect(createViewer('a', { path: 'p', filename: 'x.jpg' }).title).toBe('x.jpg');
    expect(createViewer('a', { path: 'p' }).title).toBe('');
  });

  it('marks videos, defaulting anything else to image', () => {
    expect(createViewer('a', { path: 'p', kind: 'video' }).kind).toBe('video');
    expect(createViewer('a', { path: 'p', kind: 'image' }).kind).toBe('image');
    expect(createViewer('a', { path: 'p' }).kind).toBe('image');
  });

  it('honours spawn overrides', () => {
    const v = createViewer('a', { path: 'p' }, { x: 10, y: 20, z: 4 });
    expect([v.x, v.y, v.z]).toEqual([10, 20, 4]);
  });

  it('opens solid, floating, with its details folded and the clip at normal speed', () => {
    const v = createViewer('a', { path: 'p', notes: 'Gate' });
    expect(v).toMatchObject({ opacity: 1, fadeTo: FADE_TO, docked: false, info: false, rate: 1, muted: false });
    expect(v.facts.notes).toBe('Gate');
    expect(v.still).toBe(null);
    expect(createViewer('a', { path: 'p' }, { docked: true }).docked).toBe(true);
  });

  it('holds a kept frame as the picture it shows', () => {
    expect(createViewer('a', { path: 'p', still: 'data:image/jpeg;base64,AA' }).still).toBe('data:image/jpeg;base64,AA');
  });
});

describe('nextZ', () => {
  it('is one above the top-most window (1 for an empty set)', () => {
    expect(nextZ([])).toBe(1);
    expect(nextZ([{ z: 1 }, { z: 5 }, { z: 3 }])).toBe(6);
  });
});

describe('restack', () => {
  it('puts the focused window on top and re-numbers 1..n gap-free', () => {
    const vs = [
      { id: 'a', z: 2 },
      { id: 'b', z: 5 },
      { id: 'c', z: 9 },
    ];
    const z = restack(vs, 'a');
    expect(z.get('b')).toBe(1);
    expect(z.get('c')).toBe(2);
    expect(z.get('a')).toBe(3); // focused → highest
  });

  it('handles a single window', () => {
    expect(restack([{ id: 'a', z: 7 }], 'a').get('a')).toBe(1);
  });
});

describe('clampWindow', () => {
  const bounds = { w: 1000, h: 600 };
  it('keeps the window inside the bounds', () => {
    expect(clampWindow(-20, -10, 320, 260, bounds)).toEqual({ x: 0, y: 0 });
    expect(clampWindow(9999, 9999, 320, 260, bounds)).toEqual({ x: 680, y: 340 });
  });
  it('pins to 0 when the window is larger than the bounds', () => {
    expect(clampWindow(50, 50, 1200, 800, bounds)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampSize', () => {
  const bounds = { w: 1000, h: 600 };
  it('enforces the minimum size', () => {
    expect(clampSize(10, 10, 0, 0, bounds)).toEqual({ w: MIN_W, h: MIN_H });
  });
  it('caps growth to what fits from (x, y)', () => {
    expect(clampSize(9999, 9999, 700, 400, bounds)).toEqual({ w: 300, h: 200 });
  });
});

describe('clampPan', () => {
  it('pins offset to 0 at fit scale', () => {
    expect(clampPan(-50, -50, 1, 300, 200)).toEqual({ ox: 0, oy: 0 });
    expect(clampPan(50, 50, 1, 300, 200)).toEqual({ ox: 0, oy: 0 });
  });
  it('allows panning up to the overflow when zoomed in', () => {
    // scale 2 over a 300px width overflows by 300px → offset ∈ [-300, 0]
    expect(clampPan(-500, 0, 2, 300, 200).ox).toBe(-300);
    expect(clampPan(100, 0, 2, 300, 200).ox).toBe(0);
    expect(clampPan(-120, -80, 2, 300, 200)).toEqual({ ox: -120, oy: -80 });
  });
});

describe('zoomAt', () => {
  const size = { w: 300, h: 200 };

  it('keeps the point under the cursor fixed while zooming in', () => {
    const view = { scale: 1, ox: 0, oy: 0 };
    const cursor = { x: 150, y: 100 }; // centre
    const r = zoomAt(view, 2, cursor, size);
    expect(r.scale).toBe(2);
    // image point under a centred cursor stays centred: c - f*(c-ox) = 150-2*150=-150
    expect(r.ox).toBe(-150);
    expect(r.oy).toBe(-100);
  });

  it('clamps to the max scale', () => {
    const r = zoomAt({ scale: MAX_SCALE, ox: 0, oy: 0 }, 2, { x: 0, y: 0 }, size);
    expect(r.scale).toBe(MAX_SCALE);
  });

  it('clamps to the min scale and re-pins the offset to 0', () => {
    const r = zoomAt({ scale: 1, ox: 0, oy: 0 }, 0.5, { x: 150, y: 100 }, size);
    expect(r.scale).toBe(MIN_SCALE);
    expect(r).toMatchObject({ ox: 0, oy: 0 });
  });

  it('never opens a gap at the edge (offset stays clamped)', () => {
    // zoom about the top-left corner would push the image right (ox > 0) — clamp to 0
    const r = zoomAt({ scale: 1, ox: 0, oy: 0 }, 2, { x: 0, y: 0 }, size);
    expect(r.ox).toBe(0);
    expect(r.oy).toBe(0);
  });
});

describe('the fade', () => {
  it('keeps an opacity between its floor and solid, in 5% steps', () => {
    expect(clampOpacity(0.33)).toBe(0.35);
    expect(clampOpacity(0)).toBe(MIN_OPACITY);
    expect(clampOpacity(3)).toBe(1);
    expect(clampOpacity('nope')).toBe(1);
  });

  it('flips solid to the last see-through value and back, remembering it', () => {
    expect(flipFade({ opacity: 1, fadeTo: 0.3 })).toEqual({ opacity: 0.3, fadeTo: 0.3 });
    expect(flipFade({ opacity: 0.4, fadeTo: 0.3 })).toEqual({ opacity: 1, fadeTo: 0.4 });
    // before anything has been picked it goes half way
    expect(flipFade({ opacity: 1 })).toEqual({ opacity: FADE_TO, fadeTo: FADE_TO });
  });
});

describe('settling a window', () => {
  const map = { w: 1000, h: 700 };

  it('settles against an edge it comes near, at the margin', () => {
    expect(snapWindow(10, 200, 320, 260, map)).toEqual({ x: 8, y: 200 });
    expect(snapWindow(670, 200, 320, 260, map)).toEqual({ x: 672, y: 200 });
  });

  it('goes into a corner near two edges', () => {
    expect(snapWindow(990, 690, 320, 260, map)).toEqual({ x: 672, y: 432 });
    expect(snapWindow(-50, -50, 320, 260, map)).toEqual({ x: 8, y: 8 });
  });

  it('leaves a window alone away from the edges', () => {
    expect(snapWindow(300, 200, 320, 260, map)).toEqual({ x: 300, y: 200 });
  });

  it('does not invent a margin a window too big for it cannot have', () => {
    expect(snapWindow(2, 0, 995, 260, map).x).toBe(2);
  });

  it('names the corner a window settled into, and only a corner', () => {
    expect(settledCorner(8, 8, 320, 260, map)).toBe('tl');
    expect(settledCorner(672, 432, 320, 260, map)).toBe('br');
    expect(settledCorner(8, 200, 320, 260, map)).toBe(null); // one edge is not a corner
  });
});

describe('a pinned window', () => {
  const map = { w: 1076, h: 782 };
  // the Satellite map's own controls, as measured on a 1440 by 860 screen
  const CONTROLS = [
    { x: 12, y: 12, w: 368, h: 41 }, // the place search
    { x: 12, y: 61, w: 38, h: 141 }, // the rail
    { x: 12, y: 210, w: 30, h: 60 }, // the zoom buttons
    { x: 805, y: 12, w: 259, h: 34 }, // imagery chip
    { x: 992, y: 54, w: 72, h: 30 }, // the compass
    { x: 1030, y: 92, w: 34, h: 30 }, // 3D
    { x: 12, y: 713, w: 223, h: 35 }, // the readouts
    { x: 707, y: 699, w: 357, h: 49 }, // Save place and Capture
  ];
  const overlaps = (spot, w, h) =>
    CONTROLS.some((o) => !(spot.x >= o.x + o.w || spot.x + w <= o.x || spot.y >= o.y + o.h || spot.y + h <= o.y));

  it('sits in its corner, clear of every control the map has there', () => {
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const spot = cornerSpot(corner, 320, 260, map, CONTROLS);
      expect(overlaps(spot, 320, 260), corner).toBe(false);
      expect(spot.x >= 0 && spot.y >= 0 && spot.x + 320 <= map.w && spot.y + 260 <= map.h, corner).toBe(true);
    }
  });

  it('goes beside the rail and under the search rather than far below them', () => {
    expect(cornerSpot('tl', 320, 260, map, CONTROLS)).toEqual({ x: 58, y: 61 });
  });

  it('is the corner itself on a map with nothing in it', () => {
    expect(cornerSpot('br', 320, 260, map)).toEqual({ x: 748, y: 514 });
  });

  it('goes in the corner when it is too big to fit anywhere clear', () => {
    expect(cornerSpot('tl', 1070, 780, map, CONTROLS)).toEqual({ x: 6, y: 2 });
  });
});

describe('the six places', () => {
  it('are the two columns, then the four corners', () => {
    expect(PLACES.map((place) => place.id)).toEqual(['left', 'right', 'tl', 'tr', 'bl', 'br']);
  });

  it('say where a window is, and nothing while it is free', () => {
    expect(placeOf({ docked: 'left', corner: false }).label).toBe('Column on the left');
    expect(placeOf({ docked: false, corner: 'br' }).label).toBe('Bottom right corner');
    expect(placeOf({ docked: false, corner: false })).toBe(null);
  });
});

describe('the dock', () => {
  it('stays above its floor and leaves the map at least half', () => {
    expect(clampDock(340, 1600)).toBe(340);
    expect(clampDock(40, 1600)).toBe(DOCK_MIN_W);
    expect(clampDock(1400, 1600)).toBe(800);
    // a row too narrow to halve still gets a usable column
    expect(clampDock(340, 300)).toBe(DOCK_MIN_W);
  });
});

describe('slow motion', () => {
  it('walks down the speeds and comes back to normal after the slowest', () => {
    expect([1, 0.5, 0.25, 0.1].map(nextSlowRate)).toEqual([0.5, 0.25, 0.1, 1]);
    expect(nextSlowRate(2)).toBe(1); // a speed set elsewhere starts the walk over
  });
});

describe('what a window unfolds', () => {
  it('reads a date as it is written, never moved to another clock', () => {
    expect(factDate('20260313')).toBe('13 Mar 2026');
    expect(factDate('2026-03-12')).toBe('12 Mar 2026');
    expect(factDate('2026-03-12T14:02:09')).toBe('12 Mar 2026, 14:02');
    expect(factDate('2026-03-12T14:02:09Z')).toBe('12 Mar 2026, 14:02 UTC');
    expect(factDate('2026-03-12T14:02:09.120+03:00')).toBe('12 Mar 2026, 14:02 UTC+03:00');
    expect(factDate('spring 2026')).toBe('spring 2026'); // left as stated
    expect(factDate('2026-13-01')).toBe('2026-13-01');
    expect(factDate(null)).toBe('');
  });

  it('names where it came from and who posted it, links only the web', () => {
    const facts = mediaFacts({
      taken_at: '2026-03-12T14:02:09',
      notes: '  North wall  ',
      source: { webpage_url: 'https://www.x.com/a/status/1', uploader: 'someone', upload_date: '20260313' },
    });
    expect(facts).toEqual({
      captured: '12 Mar 2026, 14:02',
      published: '13 Mar 2026',
      source: { url: 'https://www.x.com/a/status/1', label: 'x.com · someone' },
      notes: 'North wall',
    });
    expect(mediaFacts({ source: { url: 'javascript:alert(1)' } }).source).toBe(null);
    expect(mediaFacts({ source: { url: 'not a url' } }).source).toBe(null);
  });

  it('falls back on the time a capture was taken in the browser', () => {
    expect(mediaFacts({ source: { captured_at: '2026-03-12T09:00:00Z' } }).captured).toBe('12 Mar 2026, 09:00 UTC');
  });

  it('says when there is nothing to unfold', () => {
    expect(hasFacts(mediaFacts({ path: 'p', source: { type: 'upload' } }))).toBe(false);
    expect(hasFacts(mediaFacts({ notes: 'Gate' }))).toBe(true);
    expect(hasFacts(null)).toBe(false);
  });
});
