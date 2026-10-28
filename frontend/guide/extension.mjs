/**
 * The capture extension, photographed at work for the guide's Extension tabs.
 *
 * A browser of its own loads a copy of `extension/`, paired with the private Azimut the
 * other pictures are taken in, over a map site served from here: the address is
 * OpenStreetMap's, so the extension reads it as it reads the real site, and the tiles
 * are OpenStreetMap's own, fetched as that site fetches them. Only the page around them
 * is a stand-in, a plain header where the site has its own, so the map's middle falls
 * where `engine/mapsites.py` expects it.
 *
 * The copy differs from what ships in three ways, all of them about being driven rather
 * than clicked: the site is granted to it up front, where a press on the toolbar button
 * grants it to the real one; its popup is opened in a tab, so it is told which tab is
 * the map; and the panel's shadow root is open, so the anchors inside it can be found.
 *
 * A stage gets the map tab. A popup does not show in a picture of a tab, so it is
 * photographed on its own and laid over the map where a browser drops it.
 */

import { chromium } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://www.openstreetmap.org';
/** OpenStreetMap's header, which `engine/mapsites.py` shifts the centre by half of. */
const HEADER = 55;

/** Where a coordinate sits in the world, in pixels at `zoom`. */
function world(lat, lon, zoom) {
  const size = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size };
}

/**
 * The stand-in page: a header, then the map, its tiles one level finer than the address
 * says and drawn at half size, so they stay sharp on a screen of twice the density.
 */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>OpenStreetMap</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f2efe9; font: 13px system-ui, sans-serif; }
  header { position: fixed; inset: 0 0 auto; height: ${HEADER - 1}px; background: #fff; border-bottom: 1px solid #ccc; }
  #map { position: fixed; top: ${HEADER}px; left: 0; right: 0; bottom: 0; overflow: hidden; }
  #map img { position: absolute; width: 128px; height: 128px; }
  .credit { position: fixed; right: 0; bottom: 0; padding: 2px 6px; background: rgba(255, 255, 255, 0.8); color: #333; font-size: 11px; }
</style></head>
<body><header></header><div id="map"></div><div class="credit">© OpenStreetMap contributors</div>
<script>
  const [, zoom, lat, lon] = location.hash.match(/map=([\\d.]+)\\/([-\\d.]+)\\/([-\\d.]+)/).map(Number);
  const map = document.getElementById('map');
  const fine = zoom + 1;
  const size = 256 * 2 ** fine;
  const s = Math.sin((lat * Math.PI) / 180);
  const cx = ((lon + 180) / 360) * size;
  const cy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size;
  const w = map.clientWidth, h = map.clientHeight;
  for (let tx = Math.floor((cx - w) / 256); tx <= Math.floor((cx + w) / 256); tx += 1) {
    for (let ty = Math.floor((cy - h) / 256); ty <= Math.floor((cy + h) / 256); ty += 1) {
      const left = (tx * 256 - cx) / 2 + w / 2;
      const top = (ty * 256 - cy) / 2 + h / 2;
      if (left < -128 || top < -128 || left > w || top > h) continue;
      const img = document.createElement('img');
      img.src = 'https://tile.openstreetmap.org/' + fine + '/' + tx + '/' + ty + '.png';
      img.style.left = left + 'px';
      img.style.top = top + 'px';
      map.appendChild(img);
    }
  }
</script></body></html>`;

/** Make the copy of the extension the pictures are taken with (see the header). */
function driveableCopy(source, scratch) {
  const copy = join(scratch, 'extension');
  cpSync(source, copy, { recursive: true });
  const manifestPath = join(copy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), `${SITE}/*`];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const overlay = join(copy, 'mapoverlay.js');
  const opened = readFileSync(overlay, 'utf8').replace('attachShadow({ mode: "closed" })', 'attachShadow({ mode: "open" })');
  if (!opened.includes('mode: "open"')) throw new Error('mapoverlay.js no longer attaches its shadow root as the guide expects');
  writeFileSync(overlay, opened);
  writeFileSync(
    join(copy, 'guide-tab.js'),
    `const query = chrome.tabs.query.bind(chrome.tabs);\n` +
      `chrome.tabs.query = (q) => (q && q.active && q.currentWindow ? query({ url: '${SITE}/*' }) : query(q));\n`
  );
  const popupPath = join(copy, 'popup.html');
  const popup = readFileSync(popupPath, 'utf8').replace(
    '<script type="module" src="popup.js">',
    '<script src="guide-tab.js"></script>\n  <script type="module" src="popup.js">'
  );
  writeFileSync(popupPath, popup);
  return copy;
}

/**
 * Open the browser with the extension, paired with the app at `api` and on `caseId`,
 * and the map site on `view` (`{ lat, lon, zoom }`) in a `window`-sized tab.
 */
export async function openExtension({ source, scratch, api, token, caseId, view, window }) {
  const path = driveableCopy(source, scratch);
  const context = await chromium.launchPersistentContext(mkdtempSync(join(scratch, 'profile-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    viewport: window,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await context.route(`${SITE}/**`, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  const [worker] = context.serviceWorkers().length ? context.serviceWorkers() : [await context.waitForEvent('serviceworker')];
  const id = new URL(worker.url()).host;
  await worker.evaluate(
    (stored) => chrome.storage.local.set(stored),
    { backendUrl: api, token, lastCaseId: caseId, captureMarks: true }
  );

  const map = await context.newPage();
  map.setDefaultTimeout(20_000);
  await map.goto(`${SITE}/#map=${view.zoom}/${view.lat}/${view.lon}`);
  await map.waitForFunction(() => [...document.images].every((img) => img.complete));

  /** Where `{ lat, lon }` is drawn in the map tab, in page pixels. */
  const at = (point) => {
    const centre = world(view.lat, view.lon, view.zoom);
    const there = world(point.lat, point.lon, view.zoom);
    return { x: there.x - centre.x + window.width / 2, y: there.y - centre.y + HEADER + (window.height - HEADER) / 2 };
  };

  return {
    map,
    at,
    /** The map tab as it first opened, without what a stage laid or drew on it. */
    async fresh() {
      await map.reload();
      await map.waitForFunction(() => [...document.images].every((img) => img.complete));
    },
    /** The popup, opened as a pressed toolbar button opens it, settled on the map's reading. */
    async popup() {
      const page = await context.newPage();
      await page.setViewportSize({ width: 340, height: 600 });
      await page.goto(`chrome-extension://${id}/popup.html`);
      await page.locator('#state-map').waitFor();
      await page.waitForFunction(() => document.getElementById('lat').value && document.getElementById('case').value);
      return page;
    },
    close: () => context.close(),
  };
}

/**
 * Lay `popup` over the map tab where a browser drops it, under the toolbar on the right,
 * and stand its anchors over it, so the map tab is photographed as one picture.
 */
export async function layPopup(map, popup) {
  const body = popup.locator('body');
  const box = await body.boundingBox();
  const png = await body.screenshot({ animations: 'disabled', caret: 'hide' });
  const anchors = await popup.evaluate(() =>
    [...document.querySelectorAll('[data-guide]')]
      .map((el) => ({ name: el.dataset.guide, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .map(({ name, box }) => ({ name, x: box.x, y: box.y, w: box.width, h: box.height }))
  );
  await map.evaluate(
    ({ src, width, height, anchors }) => {
      const left = window.innerWidth - width - 16;
      const top = 8;
      const img = document.createElement('img');
      img.id = 'guide-popup';
      img.src = src;
      Object.assign(img.style, {
        position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        borderRadius: '8px', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.25)', zIndex: 10,
      });
      document.body.appendChild(img);
      for (const one of anchors) {
        const mark = document.createElement('div');
        mark.dataset.guide = one.name;
        Object.assign(mark.style, {
          position: 'fixed', left: `${left + one.x}px`, top: `${top + one.y}px`, width: `${one.w}px`, height: `${one.h}px`,
          pointerEvents: 'none', zIndex: 11,
        });
        document.body.appendChild(mark);
      }
      return img.decode();
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, width: box.width, height: box.height, anchors }
  );
}

/**
 * Stand the anchors drawn inside the panel's shadow root over it in the page itself,
 * where the shots measure them.
 */
export async function liftAnchors(map, names) {
  const boxes = [];
  for (const name of names) {
    const box = await map.locator(`[data-guide="${name}"]`).first().boundingBox();
    if (box) boxes.push({ name, ...box });
  }
  await map.evaluate((boxes) => {
    for (const one of boxes) {
      const mark = document.createElement('div');
      mark.dataset.guide = one.name;
      Object.assign(mark.style, {
        position: 'fixed', left: `${one.x}px`, top: `${one.y}px`, width: `${one.width}px`, height: `${one.height}px`,
        pointerEvents: 'none',
      });
      document.body.appendChild(mark);
    }
  }, boxes);
}
