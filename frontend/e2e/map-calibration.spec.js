/**
 * The calibration protocol, run against a map whose layout is already known.
 *
 * `frontend/calibration/record.mjs` drives the real map sites and writes down
 * what their address bars said; `tests/fixtures/map-sites.json` is the result,
 * and both test suites lean on it. So the protocol itself has to be worth
 * trusting — and against a real site there is nothing to check it with, since
 * the site is the only thing that knows where it drew its camera.
 *
 * Here there is. `calibration/fake-map.html` is a slippy map with a header and
 * a side panel of sizes we chose, served in place of openstreetmap.org so the
 * app's own parser reads it for real. Drive it with the same gestures the
 * recorder uses, solve for the camera with the same arithmetic the extension
 * uses, and the answer has to be the layout we built in.
 *
 * It runs on both engines and at two window sizes on purpose: the claim under
 * test is that the measurement does not depend on the browser, the window or
 * the screen, and the way to hold that claim is to make it every time.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { drive } from '../calibration/protocol.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const fake = readFileSync(join(here, '../calibration/fake-map.html'), 'utf8');
const mapmath = readFileSync(join(root, 'extension/mapmath.js'), 'utf8');

/** The extension's own arithmetic, in this process. */
const math = (() => {
  const scope = { window: {} };
  new Function('window', mapmath)(scope.window);
  return scope.window.AzimutMapMath;
})();

/** The fake's URL, read back. Our own page and our own form — the real ones are
 *  read by `engine/mapsites.py` and by nothing else. */
function viewOf(url) {
  const [, zoom, lat, lon] = /map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(url);
  return {
    lat: Number(lat),
    lon: Number(lon),
    zoom: Number(zoom),
    bearing: 0,
    projection: 'webmercator',
  };
}

/** A header and a side panel of our choosing, wearing OpenStreetMap's host. */
const CHROME = { head: 60, panel: 300 };
const site = {
  id: 'openstreetmap',
  site: 'openstreetmap',
  label: 'fake-map',
  notches: 1,
  url: `https://www.openstreetmap.org/?head=${CHROME.head}&panel=${CHROME.panel}#map=15/47.38846/2.35279`,
};

async function serve(page) {
  await page.route('https://www.openstreetmap.org/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: fake })
  );
}

/** Solve for the camera from each zoom the run recorded, as the panel does. */
function cameras(recording) {
  return recording.zooms.map((zoom) =>
    math.centreFromZoom(
      viewOf(recording.steps[zoom.from].url),
      viewOf(recording.steps[zoom.to].url),
      zoom.at
    )
  );
}

for (const shape of [
  { name: 'a full window', viewport: { width: 1280, height: 800 }, ratio: 1 },
  { name: 'a small window on a dense screen', viewport: { width: 720, height: 480 }, ratio: 1.25 },
]) {
  test.describe(shape.name, () => {
    test.use({ viewport: shape.viewport, deviceScaleFactor: shape.ratio });

    test('recovers the layout it was never told about', async ({ page }) => {
      await serve(page);
      const recording = await drive(page, site, { quiet: 300 });

      // the gestures actually moved the map: four URLs, all different
      expect(new Set(recording.steps.map((s) => s.url)).size).toBe(4);

      const truth = await page.evaluate(() => window.__TRUE_CENTRE__());
      for (const solved of cameras(recording)) {
        expect(solved).not.toBeNull();
        // A fifth decimal of latitude is about a metre, which is three pixels
        // at level 17 — this page rounds its URL the way OpenStreetMap does, so
        // that rounding is the floor under the answer and not the arithmetic.
        expect(Math.abs(solved.x - truth.x)).toBeLessThan(3);
        expect(Math.abs(solved.y - truth.y)).toBeLessThan(3);
      }

      // …and the layout we built in is the one that comes out
      const [first] = cameras(recording);
      expect(Math.abs(first.x - recording.window.w / 2 - CHROME.panel / 2)).toBeLessThan(3);
      expect(Math.abs(first.y - recording.window.h / 2 - CHROME.head / 2)).toBeLessThan(3);
    });

    test('writes down a window in CSS pixels, whatever the screen is made of', async ({ page }) => {
      await serve(page);
      await page.goto(site.url);
      const seen = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        ratio: window.devicePixelRatio,
      }));
      // The window the recording is written in is the CSS one, on both engines
      // and at either ratio — which is what makes a recording taken on one
      // machine mean anything on another.
      expect({ width: seen.width, height: seen.height }).toEqual(shape.viewport);
      expect(seen.ratio).toBe(shape.ratio);
    });
  });
}

test.describe('when a site moves its furniture', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('measures the new layout rather than the one on file', async ({ page }) => {
    await serve(page);
    const wide = await drive(page, site, { quiet: 300 });
    const moved = await drive(
      page,
      { ...site, url: 'https://www.openstreetmap.org/?head=0&panel=520#map=15/47.38846/2.35279' },
      { quiet: 300 }
    );
    const [before] = cameras(wide);
    const [after] = cameras(moved);
    expect(Math.abs(after.x - before.x - (520 - CHROME.panel) / 2)).toBeLessThan(4);
    expect(Math.abs(after.y - before.y + CHROME.head / 2)).toBeLessThan(4);
  });
});
