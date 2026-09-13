/**
 * Measure how big Google Earth draws its map, from its URL alone.
 *
 *     npm run calibrate:earth                  # every case below, headless
 *     npm run calibrate:earth -- --cases cher-1600,chamonix
 *     python scripts/build_earth_fixture.py    # registers the shots → tests/fixtures/earth-scale.json
 *
 * The map sites that state a tile level were measured by driving them
 * (`record.mjs`). Earth states a camera distance and a field of view, and a
 * drag is too blunt to check a formula against: it loses pixels to Earth's own
 * threshold and gains them to its glide. So nothing here is dragged. Each case
 * opens a URL, lets Earth place its camera on the ground with one wheel notch
 * over the middle of the window, then opens the same camera again a known step
 * east, a known step north, and at half the distance. The screenshots are
 * registered against each other by `scripts/build_earth_fixture.py`, and how
 * far the picture moved is the scale, with no gesture anywhere in it. The half
 * distance says where Earth draws its camera: a picture scaled about any other
 * pixel does not line up.
 *
 * Headless, because Earth puts up no consent wall, and on SwiftShader, because
 * a headless browser has no GPU. Both only make it slow: each case takes a
 * minute or so, most of it waiting for imagery to stop arriving.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where, how far out, in which window. Flat country and a mountain range,
 * three latitudes, three window shapes, two fields of view, and one case far
 * enough out that Earth's 3D mode would be a globe: its 2D map is not.
 */
export const CASES = [
  { id: 'cher-1600', lat: 47.388462, lon: 2.352785, d: 3000, w: 1600, h: 1000 },
  { id: 'cher-1200', lat: 47.388462, lon: 2.352785, d: 3000, w: 1200, h: 760 },
  { id: 'cher-square', lat: 47.388462, lon: 2.352785, d: 3000, w: 1000, h: 1000 },
  { id: 'cher-60y', lat: 47.388462, lon: 2.352785, d: 3000, w: 1600, h: 1000, y: 60 },
  { id: 'flevoland', lat: 52.455, lon: 5.59, d: 2000, w: 1600, h: 1000 },
  { id: 'chamonix', lat: 45.9237, lon: 6.8694, d: 6000, w: 1600, h: 1000 },
  { id: 'france-400km', lat: 47.388462, lon: 2.352785, d: 400000, w: 1600, h: 1000 },
];

/** How far each step moves the picture, in pixels: far enough that a tenth of
 *  a pixel of registration is a small share of it, near enough that most of
 *  the picture is in both shots. */
const STEP_PX = 140;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const earthUrl = ({ lat, lon, a, d, y }) =>
  `https://earth.google.com/web/@${lat.toFixed(8)},${lon.toFixed(8)},${a}a,${d}d,${y}y,0h,0t,0r`;

/** The camera block of the URL Earth is showing, as numbers. */
function cameraOf(url) {
  const at = /@(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)a,([\d.]+)d,([\d.]+)y/.exec(url);
  if (!at) throw new Error(`no camera in ${url}`);
  return { lat: +at[1], lon: +at[2], a: at[3], d: at[4], y: at[5] };
}

/** The same camera, give or take the rounding of Earth's own eight decimals. */
const sameCamera = (a, b) =>
  ['lat', 'lon', 'a', 'd'].every((key) => Math.abs(Number(a[key]) - Number(b[key])) < 1e-6);

/** Wait until the address bar and then the picture have both stopped moving. */
async function still(page) {
  let url = page.url();
  let quiet = 0;
  while (quiet < 2500) {
    await sleep(250);
    quiet = page.url() === url ? quiet + 250 : 0;
    url = page.url();
  }
  let last = null;
  for (let round = 0; round < 30; round += 1) {
    await sleep(1500);
    const shot = await page.screenshot();
    if (last && shot.equals(last)) return;
    last = shot;
  }
}

async function shoot(page, url, path) {
  await page.goto(url, { waitUntil: 'commit' });
  await sleep(3000);
  await page.mouse.move(2, 300); // off the map, so no hover label is in the picture
  await still(page);
  await page.screenshot({ path });
  return page.url();
}

async function measure(browser, spec, out) {
  const context = await browser.newContext({
    viewport: { width: spec.w, height: spec.h },
    locale: 'en-US',
  });
  const page = await context.newPage();
  const say = (line) => process.stdout.write(`  ${spec.id}: ${line}\n`);

  say('opening');
  await page.goto(earthUrl({ ...spec, a: 0, y: 35 }), { waitUntil: 'commit' });
  await sleep(4000);
  await still(page);
  // One notch over the middle of the window: Earth writes the ground's height
  // into `a` on any gesture, and a zoom about the camera leaves it in place.
  await page.mouse.move(spec.w / 2, spec.h / 2);
  await page.mouse.wheel(0, -120);
  await sleep(1000);
  await still(page);
  const placed = { ...cameraOf(page.url()), y: String(spec.y ?? 35) };
  say(`placed at ${placed.a} m, ${placed.d} m out`);

  const halfFov = ((Number(placed.y) / 2) * Math.PI) / 180;
  const metresPerPx = (2 * Number(placed.d) * Math.tan(halfFov)) / spec.h;
  const dLat = (STEP_PX * metresPerPx) / 111320;
  const dLon = dLat / Math.cos((placed.lat * Math.PI) / 180);
  const file = (name) => join(out, `${spec.id}-${name}.png`);

  const shots = {};
  for (const [name, camera] of [
    ['base', placed],
    ['east', { ...placed, lon: placed.lon + dLon }],
    ['north', { ...placed, lat: placed.lat + dLat }],
    ['half', { ...placed, d: String(Number(placed.d) / 2) }],
  ]) {
    say(name);
    const asked = earthUrl(camera);
    const landed = await shoot(page, asked, file(name));
    // Earth keeps the camera it was handed, to the eight decimals it writes; if
    // it ever moves one, the shot is of some other view and measures nothing
    if (!sameCamera(cameraOf(landed), cameraOf(asked))) {
      throw new Error(`Earth rewrote ${asked} as ${landed}`);
    }
    shots[name] = { url: landed.split('/data=')[0], image: `${spec.id}-${name}.png` };
  }
  await context.close();
  return { id: spec.id, window: { w: spec.w, h: spec.h }, dLat, dLon, shots };
}

function options(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    flags[argv[i].slice(2)] = next && !next.startsWith('--') ? next : 'yes';
  }
  return flags;
}

async function run() {
  const flags = options(process.argv.slice(2));
  const out = flags.out ?? join(tmpdir(), 'azimut-earth-calibration');
  const wanted = flags.cases ? flags.cases.split(',') : null;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const measured = [];
  const failed = [];
  for (const spec of CASES.filter((c) => !wanted || wanted.includes(c.id))) {
    try {
      measured.push(await measure(browser, spec, out));
    } catch (e) {
      failed.push(`${spec.id}: ${e.message}`);
    }
  }
  await browser.close();
  writeFileSync(join(out, 'earth-shots.json'), `${JSON.stringify({ measured }, null, 1)}\n`);
  process.stdout.write(`\n${measured.length} cases → ${out}\n`);
  if (failed.length) process.stdout.write(`did not finish:\n${failed.map((f) => `  ${f}`).join('\n')}\n`);
  process.stdout.write(`next: python scripts/build_earth_fixture.py ${out}\n`);
}

run().catch((e) => {
  process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
