// @vitest-environment happy-dom
/**
 * The map tools' arithmetic, replayed against real browsers.
 *
 * `tests/fixtures/map-sites.json` is a recording: nine map sites opened at a
 * known level, dragged a known number of pixels and zoomed about a known pixel,
 * with every URL they wrote about themselves kept. Nothing here is a table
 * written to suit the code — the numbers came out of Chromium.
 *
 * Two properties are checked, and between them they pin the whole drawing model:
 *
 * 1. **The centre solve is self-consistent.** Each site was zoomed twice, about
 *    two different pixels. Solving for the camera centre from each zoom
 *    separately must give the same answer — and it only can if the projection,
 *    the zoom the URL stated and the conversion that produced it are all right.
 *    A scale off by a percent shows up here as two centres tens of pixels apart.
 * 2. **It lands where the browser had it.** The solved centre must match the
 *    offset the site's own layout puts it at, which is the number recorded.
 *
 * The views are the ones `engine/mapsites.py` returns; the Python suite asserts
 * that separately against the same file, so a parser that drifts is caught on
 * that side rather than quietly moving the geometry here.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const source = readFileSync(join(root, 'extension/mapmath.js'), 'utf8');
const { recordings, rounding } = JSON.parse(
  readFileSync(join(root, 'tests/fixtures/map-sites.json'), 'utf8')
);

let ext;
beforeAll(() => {
  const scope = { window: {} };
  new Function('window', source)(scope.window);
  ext = scope.window.AzimutMapMath;
});

const withZooms = recordings.filter((r) => r.zooms.length >= 1);
const twoZooms = recordings.filter((r) => r.zooms.length >= 2);

describe('where each site draws its own centre', () => {
  it('has a recording for every site the app sends people to', () => {
    const sites = new Set(recordings.map((r) => r.site));
    expect([...sites].sort()).toEqual([
      'apple-maps',
      'bing-maps',
      'copernicus-browser',
      'google-maps',
      'openstreetmap',
      'satellites-pro',
      'yandex-maps',
      'zoom-earth',
    ]);
  });

  it.each(twoZooms.map((r) => [r.label, r]))(
    'solves the same centre from either zoom on %s',
    (_label, recording) => {
      const solved = recording.zooms.map((z) =>
        ext.centreFromZoom(
          recording.steps[z.from].view,
          recording.steps[z.to].view,
          z.at
        )
      );
      for (const centre of solved) expect(centre).not.toBeNull();
      // …and the two zooms were made far enough apart for that to mean
      // something. Two notches over the same pixel would agree for the same
      // reason a ruler agrees with itself. Stated as a share of the window, so
      // a recording taken in a smaller one is held to the same standard rather
      // than to the same number of pixels.
      const [first, second] = recording.zooms;
      const apart = Math.hypot(first.at.x - second.at.x, first.at.y - second.at.y);
      expect(apart).toBeGreaterThan(0.2 * Math.hypot(recording.window.w, recording.window.h));
      // Two pixels of slack, and only Google's satellite view needs any of it:
      // it states its scale as a whole number of metres, and half a metre in
      // 3231 comes out of the division below as about a pixel.
      expect(Math.abs(solved[0].x - solved[1].x)).toBeLessThan(2);
      expect(Math.abs(solved[0].y - solved[1].y)).toBeLessThan(2);
    }
  );

  it.each(withZooms.map((r) => [r.label, r]))(
    'puts the camera where the browser had it on %s',
    (_label, recording) => {
      const z = recording.zooms[0];
      const centre = ext.centreFromZoom(
        recording.steps[z.from].view,
        recording.steps[z.to].view,
        z.at
      );
      expect(Math.abs(centre.x - recording.centre.x)).toBeLessThan(1.5);
      expect(Math.abs(centre.y - recording.centre.y)).toBeLessThan(1.5);
    }
  );

  /**
   * The same answers, read as ground rather than as pixels — which is the
   * question an analyst actually asks.
   *
   * A pixel is worth 0.6 m at level 17 and 0.3 m at 18, the range this tool is
   * used in to pin a building down, so the budget is stated there. What sets
   * the floor is not the arithmetic but how finely each site writes its own
   * coordinates: Google writes seven decimals (a centimetre), Copernicus and
   * OpenStreetMap five (about a metre), and no measurement can be better than
   * the number it was taken from.
   */
  const METRES_PER_PIXEL = (lat, zoom) =>
    (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

  it.each(withZooms.map((r) => [r.label, r]))('is inside a metre of ground on %s', (_label, recording) => {
    const z = recording.zooms[0];
    const centre = ext.centreFromZoom(
      recording.steps[z.from].view,
      recording.steps[z.to].view,
      z.at
    );
    const off = Math.hypot(centre.x - recording.centre.x, centre.y - recording.centre.y);
    const { lat } = recording.steps[z.from].view;
    expect(off * METRES_PER_PIXEL(lat, 18)).toBeLessThan(1);
    expect(off * METRES_PER_PIXEL(lat, 17)).toBeLessThan(2);
  });

  it('is not the middle of the window on five of the eight', () => {
    // The whole point of measuring it. Drawn on the window's centre instead,
    // Yandex is out by 210 px at every zoom — 90 m of ground at level 15 — and
    // no pan can ever see it, because the offset slides with the map.
    const off = recordings.filter(
      (r) =>
        Math.abs(r.centre.x - r.window.w / 2) > 5 ||
        Math.abs(r.centre.y - r.window.h / 2) > 5
    );
    expect([...new Set(off.map((r) => r.site))].sort()).toEqual([
      'apple-maps',
      'bing-maps',
      'copernicus-browser',
      'openstreetmap',
      'yandex-maps',
    ]);
  });

  /**
   * The same site, driven again in a window of another size.
   *
   * This is the question a table cannot answer and a measurement can. Some of
   * this chrome is a fixed number of pixels and keeps its offset whatever the
   * window does; some of it is a layout that answers the window, and moves.
   * Nothing in the address bar says which, and the site is free to change its
   * mind between two releases.
   *
   * It is also what makes the browser's own zoom a non-question: at 125% the
   * layout viewport is simply fewer CSS pixels, so a zoomed browser is a
   * smaller window, and these are the two answers a smaller window gets.
   */
  const offset = (r) => ({ x: r.centre.x - r.window.w / 2, y: r.centre.y - r.window.h / 2 });
  const twice = [...new Set(recordings.map((r) => r.site))]
    .map((site) => [site, recordings.filter((r) => r.site === site)])
    .filter(([, group]) => new Set(group.map((r) => `${r.window.w}x${r.window.h}`)).size > 1);

  it('was driven at more than one window size on three of the sites', () => {
    expect(twice.map(([site]) => site).sort()).toEqual([
      'apple-maps',
      'openstreetmap',
      'yandex-maps',
    ]);
  });

  it.each(twice)('measures %s in each window rather than carrying one answer over', (_site, group) => {
    for (const recording of group) {
      const z = recording.zooms[0];
      const solved = ext.centreFromZoom(
        recording.steps[z.from].view,
        recording.steps[z.to].view,
        z.at
      );
      const want = offset(recording);
      expect(Math.abs(solved.x - recording.window.w / 2 - want.x)).toBeLessThan(1.5);
      expect(Math.abs(solved.y - recording.window.h / 2 - want.y)).toBeLessThan(1.5);
    }
  });

  it('says which browser and which browser zoom each answer came from', () => {
    // Provenance the recorder writes and the build carries (`protocol.mjs`,
    // `scripts/build_map_fixture.py`). The second half is the claim it is there
    // for: two runs of one site in the same CSS window have to agree about where
    // its camera is, whatever engine drew it and whatever the screen was made
    // of. It has nothing to compare until the matrix is filled in, and then it
    // has everything.
    const window = (r) => `${r.window.w}x${r.window.h}`;
    for (const recording of recordings) {
      expect(['chromium', 'firefox']).toContain(recording.browser);
      expect(recording.page_zoom).toBeGreaterThan(0);
    }
    for (const recording of recordings) {
      for (const other of recordings) {
        if (other === recording) continue;
        if (other.site !== recording.site || window(other) !== window(recording)) continue;
        expect(Math.abs(other.centre.x - recording.centre.x)).toBeLessThan(1.5);
        expect(Math.abs(other.centre.y - recording.centre.y)).toBeLessThan(1.5);
      }
    }
  });

  it('separates the chrome that keeps its pixels from the chrome that answers the window', () => {
    // Yandex's results panel is 420 px wide whatever the window is, so its
    // offset does not move. Apple's sidebar collapses on the way down, and its
    // offset moves by 70 px — which is 21 m of ground at level 18, on a tool
    // whose whole job is putting a mark on a building.
    const moved = Object.fromEntries(
      twice.map(([site, group]) => {
        const [a, b] = group.map(offset);
        return [site, Math.round(Math.hypot(a.x - b.x, a.y - b.y))];
      })
    );
    expect(moved).toEqual({ 'apple-maps': 70, openstreetmap: 0, 'yandex-maps': 0 });
  });

  it('refuses to answer from a zoom too small to divide by', () => {
    const [first] = twoZooms;
    const before = first.steps[first.zooms[0].from].view;
    const nudged = { ...before, zoom: before.zoom + 0.2, lon: before.lon + 0.001 };
    expect(ext.centreFromZoom(before, nudged, first.zooms[0].at)).toBeNull();
  });

  it('refuses a gesture that turned as it zoomed, where one offset had two bearings', () => {
    const [first] = twoZooms;
    const z = first.zooms[0];
    const before = { ...first.steps[z.from].view, bearing: 30 };
    expect(ext.centreFromZoom(before, first.steps[z.to].view, z.at)).toBeNull();
  });

  it('answers on a map held at a bearing, the offset turned back first', () => {
    // Being turned is a state, not a gesture: the same zoom on the same site
    // says the same thing about where its centre is, whichever way the compass
    // was pointing while it happened.
    const [first] = twoZooms;
    const z = first.zooms[0];
    const level = ext.centreFromZoom(first.steps[z.from].view, first.steps[z.to].view, z.at);
    const turn = (view) => ({ ...view, bearing: 30 });
    const turned = ext.centreFromZoom(turn(first.steps[z.from].view), turn(first.steps[z.to].view), z.at);
    expect(turned).not.toBeNull();
    // the held pixel is the same one, so the centre solved from it is too —
    // rotated, about that pixel, by the bearing the view was held at
    const spun = ext.turn(level.x - z.at.x, level.y - z.at.y, { bearing: 30 });
    expect(turned.x).toBeCloseTo(z.at.x + spun.dx, 6);
    expect(turned.y).toBeCloseTo(z.at.y + spun.dy, 6);
  });
});

describe('the drawing follows a drag', () => {
  /**
   * The recorded drags are the softer half of the recording: a synthetic
   * pointer loses a few pixels to each site's own drag threshold, and Apple
   * eases the map on after the button comes up — measured, it reported a tenth
   * more movement than the pointer made. So this asks the question those
   * artefacts cannot swallow: the point that was centred before the drag has to
   * land nearer where the pointer actually went than to any flip of it.
   *
   * That is what a wrong drawing looks like in practice. Yandex writes
   * longitude first; read as latitude, a pan lands at the mirrored offset and
   * fails here. So does a sign error, an axis swap, and a scale off by more
   * than the drag itself.
   */
  it.each(recordings.filter((r) => r.pan).map((r) => [r.label, r]))(
    'lands nearer the pointer than any flip of it on %s',
    (_label, recording) => {
      const { pan } = recording;
      const before = recording.steps[pan.from].view;
      const after = recording.steps[pan.to].view;
      // Copernicus rewrites its URL on a zoom but not on a pan, so it has
      // nothing to say here — the overlay carries that pan on the canvas
      // instead, which is `mapoverlay.js`'s business rather than this file's.
      if (before.lat === after.lat && before.lon === after.lon) return;
      const area = {
        x: recording.centre.x - recording.window.w / 2,
        y: recording.centre.y - recording.window.h / 2,
        w: recording.window.w,
        h: recording.window.h,
      };
      const landed = ext.toScreen(before, after, area);
      const middle = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
      const away = ({ x, y }) =>
        Math.hypot(landed.x - (middle.x + x), landed.y - (middle.y + y));
      const right = away({ x: pan.dx, y: pan.dy });
      for (const flip of [
        { x: -pan.dx, y: pan.dy },
        { x: pan.dx, y: -pan.dy },
        { x: -pan.dx, y: -pan.dy },
        { x: pan.dy, y: pan.dx },
      ]) {
        expect(right).toBeLessThan(away(flip));
      }
      // …and within a quarter of the drag, which no flip is
      expect(right).toBeLessThan(0.25 * Math.hypot(pan.dx, pan.dy));
    }
  );
});

describe('the one site that rounds the zoom it writes', () => {
  /**
   * Bing's wheel moves a third of a level and its URL carries one decimal, so
   * "15.3" is really 15.334. Read as stated, the drawing is scaled two and a
   * third percent wrong — nothing at the middle of the screen, five metres at
   * the edge of it at level 18, which is the difference between a building and
   * the one next door.
   *
   * The recording is six notches about one pixel, from a whole level. Each one
   * is solved from the one before it, the way the panel does it.
   */
  const middle = { x: rounding.centre.x, y: rounding.centre.y };

  it('recovers the third of a level the address bar rounded away', () => {
    let before = rounding.steps[0].view;
    const solved = [];
    for (const step of rounding.steps.slice(1)) {
      const zoom = ext.zoomFromAnchor(before, step.view, rounding.at, middle);
      solved.push({ stated: step.view.zoom, zoom });
      before = { ...step.view, zoom };
    }
    for (const [i, { zoom }] of solved.entries()) {
      expect(zoom).not.toBeNull();
      // the true level is the whole one it started from, plus a third a notch
      expect(zoom).toBeCloseTo(rounding.steps[0].view.zoom + (i + 1) * rounding.step, 1);
    }
    // …and the first of them is a full third of a level from what was written
    expect(solved[0].zoom - solved[0].stated).toBeGreaterThan(0.02);
  });

  it('refuses to correct from a view whose own zoom is a guess', () => {
    // the same pair read straight off the address bar: the answer is inside
    // half a level of what the site said, so it is a correction, not a rescue
    const [first, second, third] = rounding.steps;
    const straight = ext.zoomFromAnchor(second.view, third.view, rounding.at, middle);
    expect(Math.abs(straight - third.view.zoom)).toBeLessThan(0.5);
    expect(ext.zoomFromAnchor(first.view, second.view, { x: middle.x + 4, y: middle.y }, middle))
      .toBeNull(); // an anchor on top of the centre divides by nothing
  });

  it('still puts the camera where the browser had it, from the whole levels', () => {
    // 15 → 16 and 16 → 17: the two pairs the address bar states exactly
    for (const [from, to] of [[0, 3], [3, 6]]) {
      const centre = ext.centreFromZoom(
        rounding.steps[from].view,
        rounding.steps[to].view,
        rounding.at
      );
      expect(Math.abs(centre.x - rounding.centre.x)).toBeLessThan(1);
      expect(Math.abs(centre.y - rounding.centre.y)).toBeLessThan(1);
    }
  });
});
