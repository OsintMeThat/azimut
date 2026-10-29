/**
 * How each of the guide's pictures is staged in the demo case.
 *
 * One entry per picture `lib/guide.js` names, in the order they are taken: a stage may
 * lean on the one before it (a proof saved here is the thread posted next). Each one
 * brings the app into the state its page explains with the clicks an analyst would make,
 * and says what part of the window the picture keeps:
 *
 *   window  the browser size, so the tool is laid out as on a laptop
 *   clip    the element the picture is cut from (the tool, by default)
 *   crop    'anchors' (default) keeps the frames and a margin; 'full' keeps the clip
 *   focus   more elements the crop must hold, such as a menu that opened
 *   sidebar true keeps the case sidebar open
 *   after   false leaves what a picture taken from another one opened, which Escape
 *           otherwise closes for the next
 *   browser 'extension' takes the picture in the browser that has the capture
 *           extension loaded, over a map site (extension.mjs)
 */

import { readFileSync } from 'node:fs';

import { CAMERA, CAMERA_PLACE, CHANNEL, TERMINAL } from './demo.mjs';
import { AIRBASE, MARKS, PASSES } from './airbase.mjs';
import { layPopup, liftAnchors } from './extension.mjs';

const TOOLS = { width: 1000, height: 700 };
const WIDE = { width: 1100, height: 720 };
const LARGE = { width: 1200, height: 760 };
/** The size the Detect film was made at, the map wide beside its column. */
const FILM = { width: 1600, height: 900 };
/** Room for a tall column, kept landscape so the guide shows the picture whole. */
const TALL = { width: 1400, height: 880 };
/** Settings with every section of a tab on screen. */
const SETTINGS = { width: 1440, height: 900 };
/** Wide enough for Board's Details to open beside the rows rather than over them. */
const ROOMY = { width: 1360, height: 800 };

const CHANNEL_VIEW = `ll=${CHANNEL.lat},${CHANNEL.lon}&z=16`;
/** Al Udeid Air Base, where the analyzer journey stands from its first picture to its last. */
const AIRBASE_VIEW = `ll=${AIRBASE.lat},${AIRBASE.lon}&z=${AIRBASE.zoom}`;
/** How a capture's coordinates read in a picker, as the capture of the channel is listed. */
const CAPTURED = `${CHANNEL.lat.toFixed(6)}, ${CHANNEL.lon.toFixed(6)}`;

/** The one element of these on screen: tools stay mounted, hidden, once visited. */
const seen = (page, selector) => page.locator(selector).filter({ visible: true }).first();

/** The card of one file in a grid of cards. */
const card = (page, name) => page.locator('.canvas-body .media-card', { hasText: name }).filter({ visible: true }).first();

/**
 * What agrees between the photo and the capture of the channel, as fractions of each
 * picture: the bridge's east tower, and the green Evergreen cranes in front of it.
 * Read off the two pictures, the capture's at the zoom it was taken at (`demo.mjs`).
 */
const MATCHES = [
  { photo: [0.69, 0.09, 0.76, 0.36], capture: [0.66, 0.13, 0.74, 0.26] },
  { photo: [0.6, 0.22, 0.9, 0.62], capture: [0.58, 0.31, 0.71, 0.5] },
];

/** The two pictures of a proof on screen, photo first, read off the canvas it is drawn on. */
async function proofPictures(page) {
  const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
  const boxes = await page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) return [];
    return stage
      .find('Image')
      .map((node) => node.getClientRect())
      .filter((r) => r.width > 120 && r.height > 80)
      .sort((a, b) => a.x - b.x || a.y - b.y);
  });
  return boxes.slice(0, 2).map((r) => ({ x: canvas.x + r.x, y: canvas.y + r.y, w: r.width, h: r.height }));
}

async function drawBox(page, picture, [x0, y0, x1, y1]) {
  await page.mouse.move(picture.x + picture.w * x0, picture.y + picture.h * y0);
  await page.mouse.down();
  await page.mouse.move(picture.x + picture.w * x1, picture.y + picture.h * y1, { steps: 6 });
  await page.mouse.up();
}

/** Where a coordinate stands on the world, 0 to 1 each way, in web Mercator. */
function mercator({ lat, lon }) {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

/**
 * Where `point` is drawn on the map of the tool in view, in page pixels: the map's middle
 * is `view`, and the zoom in the app's address counts 256-pixel tiles, as the map sites do.
 */
async function onMap(page, view, point) {
  const box = await page.locator('[data-guide="map.ground"]').filter({ visible: true }).first().boundingBox();
  const size = 256 * 2 ** view.zoom;
  const [middle, there] = [mercator(view), mercator(point)];
  return {
    x: box.x + box.width / 2 + (there.x - middle.x) * size,
    y: box.y + box.height / 2 + (there.y - middle.y) * size,
  };
}

/** The view a measure from the camera to the berth fits in. */
const SIGHT = {
  lat: (CAMERA.lat + TERMINAL.lat) / 2,
  lon: (CAMERA.lon + TERMINAL.lon) / 2,
  zoom: 16,
};

/**
 * A reader's own icon pack, for Settings, Icons: the app's pictograms
 * (components/Icon.svelte) on coloured tiles, in the groups a pack's folders make.
 */
const PICTOGRAMS = (() => {
  const source = readFileSync(new URL('../src/components/Icon.svelte', import.meta.url), 'utf8');
  const path = (glyph) => new RegExp(`\\n\\s+${glyph}: '([^']+)'`).exec(source)?.[1];
  return [
    ['Vessel', 'ship', 'Movement', '#0e7490'],
    ['Aircraft', 'plane', 'Movement', '#0e7490'],
    ['Vehicle', 'car', 'Movement', '#0e7490'],
    ['Person', 'user', 'Movement', '#0e7490'],
    ['Building', 'building', 'Places', '#4d7c0f'],
    ['Checkpoint', 'flag', 'Places', '#4d7c0f'],
    ['Camera position', 'camera', 'Places', '#4d7c0f'],
    ['Fire', 'flame', 'Events', '#b45309'],
    ['Sighting', 'eye', 'Events', '#b45309'],
    ['Target', 'crosshair', 'Events', '#b45309'],
  ]
    .map(([name, glyph, group, colour]) => ({ name, d: path(glyph), group, colour }))
    .filter((icon) => icon.d);
})();

/** The pack filed as Settings files one: each icon drawn in the browser and sent as a PNG. */
async function fileIcons(page) {
  const filed = await page.evaluate(async (icons) => {
    const form = new FormData();
    for (const icon of icons) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = icon.colour;
      ctx.beginPath();
      ctx.roundRect(4, 4, 120, 120, 26);
      ctx.fill();
      ctx.translate(22, 22);
      ctx.scale(84 / 24, 84 / 24);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(icon.d));
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
      form.append('files', blob, `${icon.name}.png`);
      form.append('groups', icon.group);
    }
    return (await fetch('/api/icons', { method: 'POST', body: form })).ok;
  }, PICTOGRAMS);
  if (!filed) throw new Error('the icon pack was refused');
}

async function pickImagery(page, label) {
  const chip = page.locator('[data-guide="map.imagery"] .chip').filter({ visible: true }).first();
  await chip.click();
  await page.getByRole('menuitem', { name: label }).or(page.locator('button', { hasText: label })).filter({ visible: true }).first().click();
}

export const STAGES = [
  {
    shot: 'start',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    sidebar: true,
    async run({ go }) {
      await go('media');
    },
  },
  {
    shot: 'start-goto',
    from: 'start',
    window: LARGE,
    clip: '.shell',
    crop: 'full',
    sidebar: true,
    async run({ page }) {
      await page.keyboard.press('Control+k');
      await page.locator('[data-guide="palette.search"] input').fill('channel');
    },
  },
  {
    shot: 'extension',
    async run({ go, page }) {
      await go('settings');
      await page.locator('.canvas-body button', { hasText: 'Capture extension' }).first().click();
      // the folder is wherever the demo workspace was made: show the default instead
      await page.locator('[data-guide="ext.folder"] .row-hint').evaluate((el) => {
        el.textContent = '~/Azimut/.azimut/extension';
      });
    },
  },
  {
    shot: 'extension-capture',
    browser: 'extension',
    window: LARGE,
    // cut to the popup and the map beside it, so its numbers have the room to stand
    clip: 'body',
    focus: ['#guide-popup'],
    async run({ ext }) {
      await ext.fresh();
      const popup = await ext.popup();
      // the map is north up, and a bearing typed in is what the arrow waits for
      await popup.locator('#bearing').fill('0');
      await layPopup(ext.map, popup);
      await popup.close();
    },
  },
  {
    shot: 'extension-tools',
    browser: 'extension',
    window: LARGE,
    clip: 'body',
    crop: 'full',
    settle: 2500,
    async run({ ext }) {
      const { map } = ext;
      await ext.fresh();
      const popup = await ext.popup();
      // the popup closes itself once the panel is up
      await popup.locator('#map-tools').click();
      await map.locator('[data-guide="ext.measure"]').waitFor();
      // the photo held over the map, then a line from where it was taken to the berth
      await map.locator('[data-guide="ext.refs"]').click();
      await map.locator('[data-act="ref-add"]').click();
      await map.locator('.pick-item[title^="bridge_channel"]').click();
      // the picture is decoded onto the window's canvas once its bytes are in
      await map.locator('[data-guide="ext.ref"] canvas').waitFor();
      await map.waitForTimeout(1500);
      await map.locator('[data-guide="ext.measure"]').click();
      await map.locator('[data-act="measure-distance"]').click();
      for (const point of [CAMERA, TERMINAL]) {
        const { x, y } = ext.at(point);
        await map.mouse.click(x, y);
      }
      await map.mouse.move(1, 1);
      await liftAnchors(map, ['ext.measure', 'ext.points', 'ext.sky', 'ext.grid', 'ext.refs', 'ext.ref', 'ext.fires']);
    },
  },
  {
    shot: 'settings',
    window: SETTINGS,
    focus: ['[data-guide="settings.nav"]'],
    async run({ go }) {
      await go('settings');
    },
  },
  ...[
    ['settings-publishing', 'Publishing', 'settings.signature'],
    ['settings-imagery', 'Imagery', 'settings.eco'],
    ['settings-templates', 'Templates', 'settings.plate-templates'],
    ['settings-icons', 'Icons', 'settings.icons-library'],
    ['settings-storage', 'Storage', 'settings.backup'],
    ['settings-system', 'System', 'settings.downloaders'],
  ].map(([shot, section, last]) => ({
    shot,
    from: 'settings',
    window: SETTINGS,
    after: false,
    focus: ['[data-guide="settings.nav"]'],
    async run({ page }) {
      // the demo workspace is a throwaway folder named by the environment: shown as a
      // reader's own installation would be
      if (section === 'Icons') await fileIcons(page);
      if (section === 'Storage') {
        await page.route('**/api/settings/workspace', async (route) => {
          const answer = await (await route.fetch()).json();
          await route.fulfill({ json: { ...answer, environment: false, root: '~/Azimut' } }).catch(() => {});
        });
      }
      await page.locator('[data-guide="settings.nav"] button', { hasText: section }).first().click();
      await seen(page, `[data-guide="${last}"]`).waitFor();
      if (section === 'Storage') {
        await page.waitForTimeout(500);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    },
  })),
  {
    shot: 'media',
    crop: 'full',
    async run({ go }) {
      await go('media');
    },
  },
  {
    shot: 'media-open-in',
    from: 'media',
    focus: ['[data-guide="media.open-in-menu"]', '[title="Open in…"][aria-expanded="true"]'],
    async run({ page }) {
      await card(page, 'bridge_channel').locator('[title="Open in…"]').click();
    },
  },
  {
    shot: 'media-viewer',
    from: 'media',
    // the viewer covers everything under the top bar
    clip: 'body',
    crop: 'full',
    async run({ page }) {
      await card(page, 'bridge_channel').locator('.thumb').click();
      await seen(page, '[data-guide="media.viewer"] img').waitFor();
    },
  },
  {
    shot: 'files',
    async run({ go, page }) {
      await go('files');
      await page.locator('[data-guide="files.tree"] .trow', { hasText: 'Sources' }).first().click();
      await page.locator('.grid-pane .tile.folder', { hasText: 'harbor_watch' }).first().dblclick();
    },
  },
  {
    shot: 'files-menu',
    from: 'files',
    focus: ['[data-guide="files.menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="files.tile"]').click({ button: 'right' });
    },
  },
  {
    shot: 'reverse',
    async run({ go, page }) {
      await go('reverse');
      await page.locator('.canvas-body').getByText('bridge_channel', { exact: true }).first().click();
    },
  },
  {
    shot: 'inspect',
    window: WIDE,
    async run({ go, page }) {
      await go('inspect');
      await page.locator('.canvas-body').getByText('channel_departure', { exact: true }).first().click();
      // the video's own picture first, then the frames cut from it, then their save
      await page.locator('[data-guide="inspect.strip"] img').nth(2).waitFor({ timeout: 60_000 });
      await seen(page, '[data-guide="inspect.save"]').waitFor({ timeout: 60_000 });
    },
  },
  {
    shot: 'inspect-adjust',
    from: 'inspect',
    window: WIDE,
    async run({ page }) {
      await seen(page, '[data-guide="inspect.tabs"]').locator('button', { hasText: 'Adjust' }).click();
    },
  },
  {
    shot: 'inspect-analyze',
    window: WIDE,
    crop: 'full',
    async run({ go, page }) {
      await go('inspect');
      // the photo itself, a JPEG, where error levels mean something
      await page.locator('.canvas-body').getByText('bridge_channel', { exact: true }).first().click();
      await seen(page, '[data-guide="inspect.tabs"]').locator('button', { hasText: 'Analyze' }).click();
      await seen(page, '[data-guide="inspect.analyze"] .runs button').click();
      await seen(page, '[data-guide="inspect.analyze"] input[type="checkbox"]').waitFor({ timeout: 60_000 });
      // laid at half strength, so the photo reads under the patches that light up
      await seen(page, '[data-guide="inspect.analyze"] input[type="range"]').evaluate((range) => {
        range.value = '0.55';
        range.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  },
  {
    shot: 'collage',
    window: WIDE,
    async run({ go, page }) {
      await go('collage');
      await page.locator('.canvas-body').getByText('The bridge from both banks', { exact: true }).first().click();
    },
  },
  {
    shot: 'collage-straighten',
    from: 'collage',
    window: WIDE,
    focus: ['[data-guide="collage.straighten"]'],
    async run({ page }) {
      await page.locator('[data-guide="collage.straighten"] button', { hasText: 'Draw the line' }).click();
      // along the bridge deck of the first photo, which is level
      const piece = await seen(page, '.canvas-body img.node').boundingBox();
      for (const [x, y] of [[0.06, 0.352], [0.3, 0.348], [0.55, 0.352], [0.8, 0.358], [0.97, 0.362]]) {
        await page.mouse.click(piece.x + piece.width * x, piece.y + piece.height * y);
      }
    },
  },
  {
    shot: 'satellite',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`satellite?${CHANNEL_VIEW}&p=usgs-imagery`);
      const row = page.locator('[data-guide="sat.panel"] .row, [data-guide="sat.panel"] li, [data-guide="sat.panel"] div', { hasText: 'Channel observations' }).last();
      await row.locator('button').first().click();
      // folded, so the map has the room; its number opens it
      await seen(page, '[data-guide="sat.panel"] [title="Hide the panel"]').click();
    },
  },
  {
    shot: 'satellite-menu',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="map.menu"]'],
    async run({ page }) {
      const box = await page.locator('[data-guide="map.ground"]').filter({ visible: true }).first().boundingBox();
      // low enough under the search bar for the whole menu to open below the click
      await page.mouse.click(box.x + box.width * 0.4, box.y + 150, { button: 'right' });
    },
  },
  {
    shot: 'satellite-capture',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="sat.capture-menu"]', '[data-guide="sat.capture"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sat.capture"]').locator('button').last().click();
    },
  },
  {
    shot: 'satellite-refs',
    from: 'satellite',
    window: WIDE,
    map: true,
    focus: ['[data-guide="map.ref"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sat.tools"] [aria-label="Add reference"]').click();
      await seen(page, '.ref-pick[title^="bridge_channel"]').click();
      await seen(page, '[data-guide="map.ref"] img').waitFor();
    },
    // the window would sit over the pictures taken after this one
    async after({ page }) {
      await seen(page, '[data-guide="map.ref"] [title="Close"]').click();
    },
  },
  {
    shot: 'satellite-layers',
    from: 'satellite',
    window: WIDE,
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="sat.panel"] [title="Show the panel"]').click();
    },
  },
  {
    shot: 'satellite-mylayer',
    from: 'satellite',
    window: WIDE,
    map: true,
    after: false,
    focus: ['[data-guide="sat.panel"]'],
    async run({ page }) {
      const show = page.locator('[data-guide="sat.panel"] [title="Show the panel"]').filter({ visible: true });
      if (await show.count()) await show.first().click();
      const row = page.locator('[data-guide="sat.mylayers"] .row, [data-guide="sat.mylayers"] li, [data-guide="sat.mylayers"] div', { hasText: 'Channel survey' }).last();
      await row.locator('[title="Edit this layer"]').click();
      await seen(page, '[data-guide="layer.tools"]').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-guide="layer.panel"] .note')?.textContent?.includes('Opening'));
    },
  },
  {
    shot: 'satellite-measure',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      // the layer left open by the picture before is put down first
      const done = page.locator('[data-guide="layer.panel"] .done').filter({ visible: true });
      if (await done.count()) await done.first().click();
      await go(`satellite?ll=${SIGHT.lat},${SIGHT.lon}&z=${SIGHT.zoom}&p=usgs-imagery`);
      const hide = page.locator('[data-guide="sat.panel"] [title="Hide the panel"]').filter({ visible: true });
      if (await hide.count()) await hide.first().click();
      await page.waitForTimeout(1500);
      await seen(page, '[data-guide="map.measure-tool"]').click();
      // from where the photo was taken to the berth it looks at, then what the lens took in
      const from = await onMap(page, SIGHT, CAMERA);
      const to = await onMap(page, SIGHT, TERMINAL);
      await page.mouse.click(from.x, from.y);
      await page.mouse.dblclick(to.x, to.y);
      await page.locator('[data-guide="map.measure"] button', { hasText: 'Cone' }).click();
      // the photo was taken with a long lens
      const opening = page.locator('[data-guide="map.measure"] input[type="number"]').first();
      await opening.fill('30');
      await opening.press('Enter');
    },
  },
  {
    shot: 'compare',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`compare?${CHANNEL_VIEW}`);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Main Channel, imagery against the map').filter({ visible: true }).first().click();
      // the empty comparison it opened on counts as unsaved work
      const discard = page.getByRole('button', { name: 'Discard changes' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
    },
  },
  {
    shot: 'compare-new',
    from: 'compare',
    window: WIDE,
    map: true,
    focus: ['[data-guide="compare.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="compare.new"]').click();
    },
  },
  {
    shot: 'detect',
    window: WIDE,
    map: true,
    crop: 'full',
    async run({ go, page }) {
      await go(`detect?${CHANNEL_VIEW}`);
      await pickImagery(page, 'USGS Imagery').catch(() => {});
      await seen(page, '[data-guide="detect.tabs"] [aria-label="Areas"]').click();
      await seen(page, '[data-guide="detect.area"]').waitFor();
    },
  },
  {
    shot: 'detect-new',
    from: 'detect',
    window: WIDE,
    map: true,
    focus: ['[data-guide="detect.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.new"]').locator('button').first().click();
    },
  },
  // The analyzer journey is one story at one place: aircraft on the apron of Al Udeid
  // Air Base, the Detect film's ground, made in one sitting with the clicks an analyst
  // makes. Every picture has the same window and the same ground, from the button that
  // opens the library to the analyzer filed in it.
  {
    shot: 'detect-library',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ go, page }) {
      // Detect opens where the map tabs last looked, a camera the window keeps, so the
      // Satellite tab looks there first and Detect is opened from its tab; the public
      // imagery has no aerial photographs at the airbase, so the map is OpenStreetMap
      // until a pass is drawn on it
      await go(`satellite?${AIRBASE_VIEW}`);
      await page.locator('[data-map-ready="true"]').filter({ visible: true }).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await page.locator('.tabstrip').getByRole('button', { name: 'Detect', exact: true }).click();
      await pickImagery(page, 'OpenStreetMap').catch(() => {});
      await seen(page, '[data-guide="detect.analyzers"]').click();
      await seen(page, '[data-guide="detect.library"]').waitFor();
    },
  },
  {
    shot: 'detect-analyzer-new',
    from: 'detect-library',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      await seen(page, '[data-guide="detect.library-new"]').click();
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Two dates' }).filter({ visible: true }).first().click();
    },
  },
  {
    shot: 'detect-first-rule',
    from: 'detect-analyzer-new',
    window: FILM,
    map: true,
    crop: 'full',
    after: false,
    async run({ page }) {
      // from a blank rule, named and set as the film's first one
      await seen(page, '[data-guide="detect.start-from"] button.own').click();
      await seen(page, 'input[aria-label="Analyzer name"]').fill('Aircraft activity');
      await seen(page, 'select[aria-label="Rule 1 measures"]').selectOption('colour');
      await page.locator('[aria-label="Rule 1 comparison"] button', { hasText: 'At least' }).filter({ visible: true }).first().click();
      await seen(page, 'input[aria-label="Rule 1 value"]').fill('4.5');
      await page.keyboard.press('Tab');
      await page.evaluate(() => document.activeElement?.blur?.());
    },
  },
  {
    shot: 'detect-check',
    from: 'detect-first-rule',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 6000,
    after: false,
    async run({ page, passes }) {
      if (!passes) {
        throw new Error('the airbase passes are not cached (airbase.mjs): reading them would spend Copernicus quota');
      }
      // The run's stand-in Copernicus id can ask the catalogue nothing, so the two
      // questions a new check asks are answered from what the cache holds: the passes
      // over the airbase, the two the film read (the catalogue's cloud figure was not
      // kept, so none is said), and the layers its account served, colour infrared
      // among them. The passes themselves come from the cached tiles.
      await page.route('**/api/satellite/sentinel/acquisitions', async (route) => {
        const dates = [...PASSES].reverse().map((date) => ({ date, cloud: null, granules: 1, coverage: 1 }));
        await route.fulfill({ json: { dates, truncated: false } }).catch(() => {});
      });
      await page.route('**/api/satellite/sentinel/layers?check=true', async (route) => {
        const plain = route.request().url().replace('?check=true', '');
        const answer = await (await route.fetch({ url: plain })).json();
        const layers = [...answer.layers, { id: 'COLOR_INFRARED', label: 'Color infrared', hint: 'Near infrared (B08) shown red.' }];
        await route.fulfill({ json: { ...answer, layers, source: 'instance' } }).catch(() => {});
      });
      await seen(page, '[data-guide="detect.checks"]').click();
      await page.locator('.builder button', { hasText: 'New check' }).filter({ visible: true }).first().click();
      const drawer = page.locator('section[aria-label="Passes of the new check"]');
      await drawer.locator('button', { hasText: /Find passes|Look again/ }).first().click();
      await drawer.locator(`[aria-label="Use ${PASSES[0]}"] button`, { hasText: 'Before' }).click();
      await drawer.locator(`[aria-label="Use ${PASSES[1]}"] button`, { hasText: 'After' }).click();
      await drawer.locator('button', { hasText: 'Place the pins' }).click();
      await seen(page, 'input[aria-label="Name of the new check"]').fill('Apron check');
      // the film's pins, dropped where they stand on the ground
      for (const expect of ['found', 'empty']) {
        // a pin button toggles, and the first comes armed once the passes are picked
        const arm = page.locator('[aria-label="Pin to drop on the map"] button', { hasText: expect === 'found' ? 'Should be found' : 'Should stay empty' });
        if ((await arm.getAttribute('aria-pressed')) !== 'true') await arm.click();
        for (const mark of MARKS.filter((one) => one.expect === expect)) {
          const [lon, lat] = mark.point;
          const { x, y } = await onMap(page, AIRBASE, { lat, lon });
          await page.mouse.click(x, y);
          await page.waitForTimeout(120);
        }
      }
      await page.locator('[data-guide="detect.bench"] button', { hasText: 'Finish' }).click();
      await seen(page, '[data-guide="detect.pins"]').waitFor();
      // put on the map again, the map frames the check's pins, as a reader opening it would
      const put = page.getByRole('button', { name: 'Put the check Apron check on the map' }).filter({ visible: true }).first();
      if ((await put.getAttribute('aria-pressed')) === 'true') await put.click();
      await put.click();
      await page.locator('[data-guide="detect.bench"] button', { hasText: 'Split' }).first().click();
    },
  },
  {
    shot: 'detect-builder',
    from: 'detect-check',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      // the film's second rule: near infrared dropping against the ground round it
      await page.locator('.builder [role="tab"]', { hasText: 'Rules' }).filter({ visible: true }).first().click();
      await page.locator('.builder button', { hasText: 'Add a rule' }).filter({ visible: true }).first().click();
      await seen(page, 'select[aria-label="Rule 2 measures"]').selectOption('band');
      await seen(page, 'select[aria-label="Rule 2 band"]').selectOption('B08');
      await page.locator('[aria-label="Rule 2 reads"] button', { hasText: 'Change' }).filter({ visible: true }).first().click();
      await page.locator('[aria-label="Rule 2 comparison"] button', { hasText: 'Dropped' }).filter({ visible: true }).first().click();
      await seen(page, 'input[aria-label="Rule 2 value"]').fill('5');
      await page.keyboard.press('Tab');
      await page.getByRole('checkbox', { name: 'Against the ground around it' }).nth(1).check();
      await page.evaluate(() => document.activeElement?.blur?.());
      // the panel back up to its tabs, the second rule's sentence still in view under them
      await seen(page, '[data-guide="detect.checks"]').evaluate((tab) => tab.scrollIntoView({ block: 'start' }));
      await seen(page, '[data-guide="detect.rules"]').waitFor();
    },
  },
  {
    shot: 'detect-seeit',
    from: 'detect-builder',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 8000,
    after: false,
    async run({ page }) {
      // both passes in colour infrared, where the second rule's band shows red
      await seen(page, '[data-guide="detect.display"] button.select').click();
      await page.getByRole('menuitemradio', { name: /Color infrared/ }).filter({ visible: true }).first().click();
      await page.waitForFunction(
        () => document.querySelector('[data-guide="detect.display"]')?.textContent?.includes('Color infrared'),
        null,
        { timeout: 60_000 }
      );
    },
  },
  {
    shot: 'detect-tested',
    from: 'detect-seeit',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      // back on the passes in true colour, then the check read through every rule
      await seen(page, '[data-guide="detect.display"] button.select').click();
      await page.getByRole('menuitemradio', { name: /True colour/ }).filter({ visible: true }).first().click();
      await seen(page, '[data-guide="detect.test"]').click();
      await page.waitForFunction(
        () => /found/.test(document.querySelector('[data-guide="detect.verdict"]')?.textContent ?? ''),
        null,
        { timeout: 120_000 }
      );
    },
  },
  {
    shot: 'detect-mine',
    from: 'detect-tested',
    window: FILM,
    map: true,
    focus: ['[data-guide="detect.tabs"]', 'section[aria-label="My analyzers"]', '[data-guide="detect.library"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.builder-save"]').click();
      await seen(page, 'section[aria-label="My analyzers"] .entry').waitFor();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      // the check left the map: the base map the public imagery does not cover is
      // drawn from OpenStreetMap instead
      await pickImagery(page, 'OpenStreetMap').catch(() => {});
    },
  },
  {
    shot: 'horizon',
    window: LARGE,
    map: true,
    settle: 20_000,
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Half Dome from Glacier Point').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.side"]').click();
    },
  },
  {
    shot: 'horizon-side',
    from: 'horizon',
    window: LARGE,
    map: true,
    settle: 6000,
    async run({ page }) {
      await seen(page, '[data-guide="horizon.side"]').click();
    },
  },
  {
    shot: 'horizon-overlay',
    window: LARGE,
    map: true,
    settle: 20_000,
    crop: 'full',
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Glacier Point, the 1901 photo').filter({ visible: true }).first().click();
      await seen(page, '[data-guide="horizon.overlay"]').waitFor({ timeout: 60_000 });
    },
  },
  {
    shot: 'coordinates',
    async run({ go, page }) {
      await go('coordinates');
      await page.locator('[data-guide="coords.paste"] input').fill(`${CAMERA.lat}, ${CAMERA.lon}`);
      await page.locator('[data-guide="coords.paste"] button[type="submit"]').click();
      const sky = page.locator('[data-guide="coords.sky"]');
      await sky.locator('input').first().fill('03/02/2009');
      await sky.locator('input').nth(1).fill('11:40');
      await sky.locator('input').nth(1).press('Enter');
    },
  },
  {
    shot: 'proof',
    window: TALL,
    async run({ go, page }) {
      await go('media');
      await card(page, 'bridge_channel').locator('[title="Open in…"]').click();
      await page.locator('[role="menuitem"]', { hasText: /proof/i }).first().click();
      await page.locator('[data-guide="proof.panels"] button', { hasText: 'Add panel' }).click();
      await page.locator('[role="dialog"]').getByText(CAPTURED).first().click();
      await page.locator('[data-guide="proof.coords"] input').first().fill(`${CAMERA.lat}, ${CAMERA.lon}`);
      await page.locator('[data-guide="proof.coords"] input').nth(1).fill(CAMERA_PLACE);
      await page.getByPlaceholder('A formation of 13 helicopters heading east').fill('The YM Success under the Vincent Thomas Bridge, seen from the west bank of the Main Channel.');
      // the day the photo was taken, as the case dates it
      const when = page.locator('#proof-when');
      await when.fill('03/02/2009');
      await when.press('Enter');
      await page.evaluate(() => document.activeElement?.blur?.());
      // what agrees, boxed on both pictures in one colour per feature
      const [photo, capture] = await proofPictures(page);
      if (!capture) throw new Error('the proof did not draw its two pictures');
      const tools = page.locator('[data-guide="proof.tools"]');
      const box = tools.locator('button[title="Box (r)"]');
      // a box drawn hands the cursor back, so the tool is taken up again for each one
      const arm = async () => {
        if ((await box.getAttribute('aria-pressed')) !== 'true') await box.click();
      };
      for (const [index, match] of MATCHES.entries()) {
        await arm();
        await tools.locator('[title="Annotation colour"]').click();
        await tools.locator('.flyout-colors.open .color-btn').nth(index).click();
        await drawBox(page, photo, match.photo);
        await arm();
        await drawBox(page, capture, match.capture);
      }
      // the last box let go, so no handles show
      const canvas = await seen(page, '[data-guide="proof.canvas"] .konva').boundingBox();
      await page.mouse.click(canvas.x + 6, canvas.y + 6);
    },
  },
  {
    shot: 'proof-result',
    // wider than the composer's picture, so the page it fits fills more of it
    window: { width: 1500, height: 900 },
    clip: '[data-guide="proof.canvas"]',
    focus: ['#guide-proof-page'],
    async run({ page }) {
      // the page fitted to its frame, then cut to it: its pictures and the line under them
      await page.keyboard.press('f');
      await page.waitForTimeout(400);
      const pictures = await proofPictures(page);
      const left = Math.min(...pictures.map((p) => p.x));
      const top = Math.min(...pictures.map((p) => p.y));
      const right = Math.max(...pictures.map((p) => p.x + p.w));
      const bottom = Math.max(...pictures.map((p) => p.y + p.h));
      await page.evaluate(
        ({ left, top, width, height }) => {
          const page = document.createElement('div');
          page.id = 'guide-proof-page';
          Object.assign(page.style, {
            position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
            pointerEvents: 'none',
          });
          document.body.appendChild(page);
        },
        { left, top, width: right - left, height: bottom - top + 24 }
      );
    },
  },
  {
    shot: 'post',
    window: TALL,
    async run({ page }) {
      // the proof just composed goes on to the thread, as To Post sends it
      await page.locator('[data-guide="proof.save"]', { hasText: 'To Post' }).click();
      // saving asks to check the point taken from the imagery once
      const keep = page.getByRole('button', { name: 'Use this point' });
      await keep.waitFor({ timeout: 8000 }).then(() => keep.click()).catch(() => {});
      await page.locator('[data-guide="post.first"]').waitFor();
      await page.getByPlaceholder('A formation of 13 helicopters was spotted heading East').fill('Where this photo of the Vincent Thomas Bridge was taken');
    },
  },
  {
    shot: 'plate',
    window: WIDE,
    settle: 6000,
    async run({ go, page }) {
      await go('plate');
      // a new plate starts on the Map's ground, with the layers the Satellite stage put on,
      // its questions answered as they stand
      await seen(page, '.canvas-body button:has-text("New plate")').click();
      await seen(page, '[role="dialog"] button:has-text("Create plate")').click();
      // the plate puts the sidebar away itself once its page is laid out
      await seen(page, '[data-guide="plate.page"]').waitFor();
      await page.waitForTimeout(1500);
    },
  },
  {
    shot: 'plate-add',
    from: 'plate',
    window: WIDE,
    focus: ['[data-guide="plate.add-groups"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.add"]').click();
    },
  },
  {
    shot: 'plate-home',
    from: 'plate',
    window: WIDE,
    focus: ['[data-guide="plate.ready"]'],
    async run({ page }) {
      await seen(page, '[data-guide="plate.home"]').click();
      await seen(page, '[data-guide="plate.ready"]').waitFor();
    },
  },
  {
    shot: 'plate-made',
    from: 'plate-home',
    window: { width: 1500, height: 940 },
    // the paper alone, as it leaves the app
    clip: '[data-guide="plate.page"] .page',
    crop: 'full',
    settle: 9000,
    async run({ page }) {
      // the Locator on the case's survey layer, in the Tactical look: the place, a closer
      // look at the cranes, and where it lies on a globe
      await seen(page, '[data-guide="plate.ready"] button.open:has-text("Locator")').click();
      await seen(page, '[data-guide="plate.page"] .page').waitFor();
      await seen(page, '[data-guide="plate.looks"] button:has-text("Tactical")').click();
      const rows = page.locator('[data-guide="plate.list"] button.row');
      // the closer look comes on Esri imagery, which no picture shows (photos/CREDITS.md):
      // on the look's own ground instead
      await rows.filter({ hasText: 'Detail' }).first().click();
      await seen(page, '[aria-label="Ground"] button[title="Tactical, dark blue"]').click();
      // drawn lines, so a closer look wide enough to hold the quay, its roads and its sheds
      await seen(page, 'input[aria-label="Zoom"]').fill('16.2');
      await page.keyboard.press('Tab');
      // the title names the place rather than the case
      await rows.filter({ hasText: 'Demo case' }).first().click();
      await seen(page, 'textarea[aria-label="Text"]').fill('Main Channel, Port of Los Angeles');
      // nothing picked as it leaves: a press round the paper drops the pick
      await page.locator('[data-guide="plate.page"]').click({ position: { x: 16, y: 16 } });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    },
  },
  {
    shot: 'notebook',
    window: WIDE,
    async run({ go }) {
      await go('notebook');
    },
  },
  {
    shot: 'timeline',
    window: WIDE,
    async run({ go }) {
      await go('timeline');
    },
  },
  {
    shot: 'board',
    window: ROOMY,
    // the whole index, never a strip cut after its first rows
    crop: 'full',
    async run({ go }) {
      await go('board');
    },
  },
  {
    shot: 'board-details',
    from: 'board',
    window: ROOMY,
    crop: 'full',
    async run({ page }) {
      await page.locator('.canvas-body').getByText(CAMERA_PLACE, { exact: true }).filter({ visible: true }).first().click();
      await seen(page, '[data-guide="board.details"]').waitFor();
    },
  },
  {
    shot: 'graph',
    window: WIDE,
    settle: 2000,
    async run({ go, page }) {
      await go('graph');
      // the drawing settles after the page does: wait for it, then fit it to the frame
      await page.waitForTimeout(3000);
      await seen(page, '[data-guide="graph.canvas"]').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('0');
    },
  },
  {
    shot: 'sheet',
    window: WIDE,
    async run({ go, page }) {
      await go('sheet');
      await page.locator('.canvas-body').getByText('Files to geolocate', { exact: true }).first().click();
    },
  },
  {
    shot: 'sheet-new',
    from: 'sheet',
    window: WIDE,
    // the sheet whole, its title too, under the menu
    crop: 'full',
    focus: ['[data-guide="sheet.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sheet.new"]').click();
    },
  },
];

export const DEFAULT_WINDOW = TOOLS;
