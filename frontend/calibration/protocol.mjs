/**
 * The protocol the map sites were calibrated with, written down so it can be
 * run again.
 *
 * The map tools draw over someone else's map from what its address bar says,
 * and two things about each site have to be known for that to land on the
 * ground: what its URL means (`engine/mapsites.py`) and where in the window it
 * draws the coordinate that URL names (`extension/mapmath.js`, `centreFromZoom`).
 * Neither is documented by anybody. Both were measured, in a browser, and
 * `tests/fixtures/map-sites.json` is that measurement.
 *
 * A measurement ages. Sites move their panels, change their URL forms and
 * re-lay-out for narrow windows, and the day one does, the drawing is quietly
 * wrong rather than loudly broken. So the measurement is not a one-off: this is
 * the gesture sequence that produced the fixture, and `record.mjs` runs it
 * again — same place, same drags, same notches, at every window size and
 * browser zoom the matrix names.
 *
 * What it does *not* do is decide anything. It drives and it writes down what
 * the address bar said; turning that into views is `engine/mapsites.py`'s job,
 * through `scripts/build_map_fixture.py`, because a second URL parser is the
 * one thing this project cannot afford.
 */

import { mapLinks } from '../src/lib/maplinks.js';

/** Where every recording is taken: open country in the Cher, far from anything
 *  a map site puts a panel over, and the same point the fixture already holds
 *  so a new run can be diffed against the old one. */
export const PLACE = { lat: 47.388462, lon: 2.352785, zoom: 15 };

/**
 * The windows to record in, and the browser zoom to record them at.
 *
 * `w`/`h` is the window as the operating system sees it; the browser's own zoom
 * divides that into CSS pixels, which is the only unit the drawing works in. So
 * a 1600 px window at 125% is a 1280 px viewport, and the pair at 1500×950 and
 * 1200×760 below is deliberate: both come out at 1200×760 CSS pixels, from
 * different device ratios. Where a site's own layout is concerned they are the
 * same window, and the fixture says so.
 */
export const VIEWPORTS = [
  { w: 1600, h: 1000, pageZoom: 1 },
  { w: 1600, h: 1000, pageZoom: 1.25 },
  { w: 1500, h: 950, pageZoom: 1.25 }, // 1200×760 CSS, at 1.25 dots to the pixel
  { w: 1200, h: 760, pageZoom: 1 }, //    1200×760 CSS, at 1
  { w: 1200, h: 760, pageZoom: 1.25 },
  { w: 900, h: 600, pageZoom: 1 },
  { w: 900, h: 600, pageZoom: 1.25 },
];

/** How far a level is, in wheel notches, on each site.
 *
 * Bing's wheel moves a third of a level — the reason `zoomFromAnchor` exists —
 * so it takes three to arrive somewhere its URL states exactly. Everyone else
 * steps a whole level a notch. A site that changes this shows up in the build
 * as a zoom too small to solve from, naming itself. */
const NOTCHES = { 'bing-maps': 3 };

/** Which `mapLinks` entry opens which site of `engine/mapsites.py`, and what
 *  the recording is called. Earth is driven like the rest and left out of the
 *  fixture by the build: a free camera states no scale to check. */
const FROM_LINKS = [
  ['google', 'google-maps', 'google-maps'],
  ['google_sat', 'google-maps', 'google-maps satellite'],
  ['apple', 'apple-maps', 'apple-maps'],
  ['bing', 'bing-maps', 'bing-maps'],
  ['yandex', 'yandex-maps', 'yandex-maps'],
  ['sentinel', 'copernicus-browser', 'copernicus-browser'],
  ['zoom_earth', 'zoom-earth', 'zoom-earth'],
  ['satellites_pro', 'satellites-pro', 'satellites-pro'],
  ['google_earth', 'google-earth', 'google-earth'],
];

/** The map the extension draws on that the app never links out to, because it
 *  is already a tile provider inside it. Its opening URL is written here for
 *  that reason: nothing else in the app writes one. */
const EXTRA = [
  {
    id: 'openstreetmap',
    site: 'openstreetmap',
    label: 'openstreetmap',
    url: `https://www.openstreetmap.org/#map=${PLACE.zoom}/${PLACE.lat}/${PLACE.lon}`,
  },
];

/** The sites to drive: the app's own "Open in…" panel, as it writes them — so a
 *  link the app hands out that stopped working is caught here too — plus the one
 *  it does not link to. */
export function sites() {
  const links = new Map(mapLinks(PLACE.lat, PLACE.lon, PLACE.zoom).map((l) => [l.id, l]));
  return [
    ...FROM_LINKS.map(([id, site, label]) => ({ id, site, label, url: links.get(id).url })),
    ...EXTRA,
  ].map((site) => ({ ...site, notches: NOTCHES[site.site] ?? 1 }));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Wait for the address bar to stop moving.
 *
 * These maps rewrite their own URL when a gesture ends, some of them a few
 * hundred milliseconds after it ends, and one of them (Copernicus) not at all
 * for a pan. So this waits for quiet rather than for a change, and reports
 * whether anything moved.
 *
 * The long timeout is for the operator: a first visit can land on a consent
 * wall, a cookie banner or a login, and none of that is something a script
 * should click on someone's behalf. The run is headed, it says what it is
 * waiting for, and it waits.
 */
export async function settle(page, { quiet = 900, timeout = 120_000, say } = {}) {
  const started = Date.now();
  let last = page.url();
  let still = 0;
  let warned = false;
  for (;;) {
    await sleep(150);
    const now = page.url();
    if (now === last) {
      still += 150;
      if (still >= quiet) return now;
    } else {
      last = now;
      still = 0;
    }
    if (!warned && Date.now() - started > 8000) {
      warned = true;
      say?.(`still waiting on ${new URL(last).host} — dismiss whatever it is showing`);
    }
    if (Date.now() - started > timeout) return last;
  }
}

/**
 * Drag the map by a known number of pixels.
 *
 * The pause before the button comes up is the whole reason this is a function
 * and not two lines: these maps glide on after a fast release, and a pan that
 * ends in a glide reports a move the pointer never made. Held still first, the
 * map lands where it was left.
 */
async function panBy(page, from, by) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(from.x + (by.dx * step) / 12, from.y + (by.dy * step) / 12);
    await sleep(16);
  }
  await sleep(400); // let go still, or the glide is measured instead of the drag
  await page.mouse.up();
}

/** Zoom about one pixel, in the notches that site takes to move a whole level. */
async function zoomAt(page, at, notches) {
  await page.mouse.move(at.x, at.y);
  for (let notch = 0; notch < notches; notch += 1) {
    await page.mouse.wheel(0, -120);
    await sleep(180);
  }
}

/**
 * One site, zoomed a notch at a time over a single pixel.
 *
 * For the one site that rounds the zoom it writes. Bing's wheel moves a third of
 * a level and its URL carries one decimal, so two notches out of every three
 * land on a number the address bar cannot state — two and a third percent of
 * scale, five metres at the edge of a 1600 px window at level 18. The tools work
 * the fraction out from the pixel the zoom held still (`mapmath.js`,
 * `zoomFromAnchor`), and this is the recording that says they still can.
 *
 * Driven from a whole level so the run starts somewhere exact, and long enough
 * to cross two more of them: the whole ones are what the solve is anchored on
 * and the ones between are what it has to recover.
 */
export async function driveNotches(page, site, { at, count = 6, say = () => {}, quiet } = {}) {
  const view = page.viewportSize();
  const spot = at ?? { x: Math.round(view.width * 0.72), y: Math.round(view.height * 0.38) };
  const steps = [];
  await page.goto(site.url, { waitUntil: 'commit' });
  steps.push({ url: await settle(page, { say, quiet }) });
  for (let notch = 0; notch < count; notch += 1) {
    say(`${site.label}: notch ${notch + 1} of ${count} over ${spot.x}, ${spot.y}`);
    await zoomAt(page, spot, 1);
    steps.push({ url: await settle(page, { say, quiet }) });
  }
  return {
    site: site.site,
    window: { w: view.width, h: view.height },
    at: spot,
    step: 1 / site.notches,
    steps,
  };
}

/**
 * The biggest canvas on the page, if it covers enough of the window to be the
 * map — an independent witness to where the map is, owed to nobody's
 * arithmetic.
 *
 * It is a witness and not the answer: a site is free to draw its camera
 * somewhere other than the middle of its own canvas, and several stretch the
 * canvas under their chrome. So the fixture keeps it, and the tests ask only
 * that the solved centre falls inside it.
 */
async function canvasRect(page) {
  return page.evaluate(() => {
    const area = window.innerWidth * window.innerHeight;
    let best = null;
    for (const node of document.querySelectorAll('canvas')) {
      const box = node.getBoundingClientRect();
      if (box.width * box.height < area * 0.25) continue;
      if (!best || box.width * box.height > best.w * best.h) {
        best = { x: box.left, y: box.top, w: box.width, h: box.height };
      }
    }
    return best;
  });
}

/**
 * One site, driven once: open, drag, zoom about one pixel, zoom about another.
 *
 * The two zooms are the measurement. Each one holds a pixel still while the
 * camera moves underneath it, which is enough to solve for the pixel the camera
 * is drawn at, and two of them far apart are what say the answer is real rather
 * than a coincidence of one gesture.
 *
 * Returns the raw observation only: URLs, pixels, and the window they were made
 * in. Nothing here parses a URL.
 */
export async function drive(page, site, { say = () => {}, quiet } = {}) {
  const view = page.viewportSize();
  const steps = [];
  const record = (url) => steps.push({ url });

  say(`${site.label}: opening`);
  await page.goto(site.url, { waitUntil: 'commit' });
  record(await settle(page, { say, quiet }));

  const by = { dx: -Math.round(view.width * 0.2), dy: Math.round(view.height * 0.2) };
  say(`${site.label}: dragging ${by.dx}, ${by.dy}`);
  await panBy(page, { x: Math.round(view.width * 0.62), y: Math.round(view.height * 0.55) }, by);
  record(await settle(page, { say, quiet }));

  // Both zooms are taken in the right half and clear of the top, because a
  // gesture over a site's own chrome is not a gesture on its map: Yandex keeps
  // 420 px of results down the left and Bing an 81 px header across the top,
  // and a notch there moves nothing. Far enough apart to be two measurements,
  // and neither of them anywhere a panel has ever been.
  const zooms = [];
  for (const spot of [
    { x: 0.62, y: 0.3 },
    { x: 0.8, y: 0.74 },
  ]) {
    const at = { x: Math.round(view.width * spot.x), y: Math.round(view.height * spot.y) };
    say(`${site.label}: ${site.notches} notch(es) over ${at.x}, ${at.y}`);
    await zoomAt(page, at, site.notches);
    const from = steps.length - 1;
    record(await settle(page, { say, quiet }));
    zooms.push({ from, to: steps.length - 1, at });
  }

  return {
    site: site.site,
    label: site.label,
    link: site.url,
    window: { w: view.width, h: view.height },
    pan: { from: 0, to: 1, ...by },
    zooms,
    canvas: await canvasRect(page),
    steps,
  };
}
