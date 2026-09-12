/**
 * Re-measure the map sites, in a real browser.
 *
 *     npm run calibrate:maps                 # the whole matrix, headed
 *     npm run calibrate:maps -- --sites yandex,apple --browsers chromium
 *     npm run calibrate:maps -- --viewports 1600x1000@1
 *
 * Writes `tests/fixtures/map-sites.raw.json`: the URLs each site wrote about
 * itself after each gesture, and nothing else. `scripts/build_map_fixture.py`
 * turns that into `tests/fixtures/map-sites.json` by parsing it with the app's
 * own parser, which is the only thing allowed to read a map URL.
 *
 * It is headed on purpose. A first visit to half these sites lands on a consent
 * wall, and clicking one on an analyst's behalf is not a script's business — so
 * the run says what it is waiting for and waits. `--profile` keeps a browser
 * profile between runs, so each wall is dismissed once rather than every time.
 *
 * Nothing about it is fast, and it is not meant to be: this is a measurement,
 * taken by hand, the day a site has moved or before a release that cares. The
 * whole matrix is ten runs across seven windows and two browsers, which is
 * about an hour of driving plus whatever the consent walls ask of you. Every
 * entry is merged into the file by key, so a run that covers one site at one
 * size leaves the rest of the recording alone and can be picked up again.
 */

import { chromium, firefox } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { PLACE, VIEWPORTS, drive, driveNotches, sites } from './protocol.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const OUT = join(root, 'tests/fixtures/map-sites.raw.json');

const ENGINES = { chromium, firefox };

function options(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    flags[name] = next && !next.startsWith('--') ? next : 'yes';
  }
  return flags;
}

const flags = options(process.argv.slice(2));
const wanted = {
  browsers: (flags.browsers ?? 'chromium,firefox').split(','),
  sites: flags.sites ? flags.sites.split(',') : null,
  viewports: flags.viewports
    ? flags.viewports.split(',').map((text) => {
        const [size, zoom] = text.split('@');
        const [w, h] = size.split('x').map(Number);
        return { w, h, pageZoom: Number(zoom ?? 1) };
      })
    : VIEWPORTS,
  headless: flags.headless === 'yes',
  rounding: flags.rounding === 'yes',
  profile: flags.profile ?? join(root, '.calibration-profile'),
  out: flags.out ? resolve(process.cwd(), flags.out) : OUT,
};

const key = (entry) =>
  `${entry.browser}|${entry.window.w}x${entry.window.h}@${entry.pageZoom}|${entry.label}`;

function existing(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const say = (line) => process.stdout.write(`  ${line}\n`);

async function run() {
  const table = sites().filter((site) => !wanted.sites || wanted.sites.includes(site.id));
  const before = existing(wanted.out);
  const held = new Map((before?.recorded ?? []).map((e) => [key(e), e]));
  let rounding = before?.rounding ?? null;
  const failed = [];

  // The rounding run measures a site's own wheel step, which no window size can
  // change, so it is taken once rather than across the matrix.
  const viewports = wanted.rounding ? wanted.viewports.slice(0, 1) : wanted.viewports;
  for (const browser of wanted.rounding ? wanted.browsers.slice(0, 1) : wanted.browsers) {
    const engine = ENGINES[browser];
    if (!engine) throw new Error(`no browser called "${browser}"`);
    for (const viewport of viewports) {
      // The browser's own zoom is a smaller viewport at a higher device ratio,
      // which is exactly what it is: CSS pixels are what a page is laid out in,
      // and 125% means fewer of them in the same window.
      const width = Math.round(viewport.w / viewport.pageZoom);
      const height = Math.round(viewport.h / viewport.pageZoom);
      process.stdout.write(
        `\n${browser} ${viewport.w}×${viewport.h} at ${viewport.pageZoom}× → ${width}×${height} CSS px\n`
      );
      mkdirSync(wanted.profile, { recursive: true });
      const context = await engine.launchPersistentContext(`${wanted.profile}/${browser}`, {
        headless: wanted.headless,
        viewport: { width, height },
        deviceScaleFactor: viewport.pageZoom,
        args: browser === 'chromium' ? [`--window-size=${viewport.w},${viewport.h}`] : [],
      });
      const page = context.pages()[0] ?? (await context.newPage());
      if (wanted.rounding) {
        // The one site that rounds the zoom it writes, notch by notch.
        for (const site of table.filter((s) => s.notches > 1)) {
          try {
            rounding = { browser, pageZoom: viewport.pageZoom, ...(await driveNotches(page, site, { say })) };
            say(`${site.label}: ${rounding.steps.length} URLs, one notch apart`);
          } catch (e) {
            failed.push(`${browser} rounding ${site.label}: ${e.message}`);
          }
        }
        await context.close();
        continue;
      }
      for (const site of table) {
        try {
          const seen = await drive(page, site, { say });
          const entry = {
            browser,
            pageZoom: viewport.pageZoom,
            deviceScaleFactor: viewport.pageZoom,
            ...seen,
          };
          held.set(key(entry), entry);
          // A site that wrote the same URL four times did not move: its map
          // failed to load, or something is over it waiting to be dismissed.
          // Said here rather than left for the build, because the browser is
          // still open and the operator is still watching.
          const moved = new Set(seen.steps.map((step) => step.url)).size;
          say(`${site.label}: ${seen.steps.length} URLs, ${moved} of them different`);
          if (moved < 3) {
            failed.push(`${browser} ${width}×${height} ${site.label}: the address bar barely moved`);
            say(`${site.label}: it did not move — drive it by hand and see what it is showing`);
          }
        } catch (e) {
          failed.push(`${browser} ${width}×${height} ${site.label}: ${e.message}`);
          say(`${site.label}: FAILED — ${e.message}`);
        }
      }
      await context.close();
    }
  }

  const recorded = [...held.values()].sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      b.window.w - a.window.w ||
      a.pageZoom - b.pageZoom ||
      a.browser.localeCompare(b.browser)
  );
  writeFileSync(
    wanted.out,
    `${JSON.stringify(
      {
        what: 'Every URL these map sites wrote about themselves, driven through one gesture sequence.',
        how: 'frontend/calibration/protocol.mjs — open, drag a known number of pixels, zoom about two known pixels. Run it again with `npm run calibrate:maps`.',
        why: 'The raw half of tests/fixtures/map-sites.json. Nothing here has been parsed: scripts/build_map_fixture.py does that, with the app’s own parser.',
        place: PLACE,
        recorded,
        ...(rounding ? { rounding } : {}),
      },
      null,
      1
    )}\n`
  );
  process.stdout.write(`\n${recorded.length} recordings → ${wanted.out}\n`);
  if (failed.length) {
    process.stdout.write(`${failed.length} did not finish:\n${failed.map((f) => `  ${f}`).join('\n')}\n`);
  }
  process.stdout.write('next: python scripts/build_map_fixture.py\n');
}

run().catch((e) => {
  process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
