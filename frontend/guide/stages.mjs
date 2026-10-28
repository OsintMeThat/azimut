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

import { CAMERA, CAMERA_PLACE, CHANNEL, TERMINAL } from './demo.mjs';
import { AIRBASE, airbaseAnalyzer } from './airbase.mjs';
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
  {
    shot: 'detect-library',
    from: 'detect',
    window: TALL,
    map: true,
    after: false,
    focus: ['[data-guide="detect.tabs"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.analyzers"]').click();
      await seen(page, '[data-guide="detect.library"]').waitFor();
    },
  },
  {
    shot: 'detect-analyzer-new',
    from: 'detect-library',
    window: TALL,
    map: true,
    after: false,
    focus: ['[data-guide="detect.tabs"]'],
    async run({ page }) {
      await seen(page, '[data-guide="detect.library-new"]').click();
      await page.locator('[data-guide="detect.reads"] button', { hasText: 'Two dates' }).filter({ visible: true }).first().click();
    },
  },
  {
    shot: 'detect-builder',
    from: 'detect-analyzer-new',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 6000,
    after: false,
    async run({ go, page, passes }) {
      if (!passes) {
        throw new Error('the airbase passes are not cached (airbase.mjs): reading them would spend Copernicus quota');
      }
      // the film's analyzer, filed as the library files one, then opened from the library
      const filed = await page.evaluate(async (recipe) => {
        const answer = await fetch('/api/compare/analyzers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(recipe),
        });
        return answer.ok;
      }, airbaseAnalyzer());
      if (!filed) throw new Error('the airbase analyzer was refused');
      // The bench asks the Copernicus configuration which layers it serves before it
      // draws a pass. The run's stand-in id has none to ask, so the question is answered
      // as the account the passes were cached from answered it: the standard layers and
      // its colour infrared one. The passes themselves come from the cached tiles.
      await page.route('**/api/satellite/sentinel/layers?check=true', async (route) => {
        const plain = route.request().url().replace('?check=true', '');
        const answer = await (await route.fetch({ url: plain })).json();
        const layers = [...answer.layers, { id: 'COLOR_INFRARED', label: 'Color infrared', hint: 'Near infrared (B08) shown red.' }];
        await route.fulfill({ json: { ...answer, layers, source: 'instance' } }).catch(() => {});
      });
      await go(`detect?ll=${AIRBASE.lat},${AIRBASE.lon}&z=${AIRBASE.zoom}`);
      await seen(page, '[data-guide="detect.analyzers"]').click();
      await page.getByRole('button', { name: 'Edit Aircraft activity' }).filter({ visible: true }).first().click();
      // the check on the map: both passes, read from the cache
      await page.locator('.builder [role="tab"]', { hasText: 'Checks' }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Put the check Apron check on the map' }).filter({ visible: true }).first().click();
      await seen(page, '[data-guide="detect.bench"]').waitFor();
      await page.locator('.builder [role="tab"]', { hasText: 'Rules' }).filter({ visible: true }).first().click();
      await seen(page, '[data-guide="detect.rules"]').waitFor();
    },
  },
  {
    shot: 'detect-check',
    from: 'detect-builder',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 5000,
    after: false,
    async run({ page }) {
      await seen(page, '[data-guide="detect.checks"]').click();
      await seen(page, '[data-guide="detect.pins"]').waitFor();
      await page.locator('[data-guide="detect.bench"] button', { hasText: 'Split' }).first().click();
    },
  },
  {
    shot: 'detect-seeit',
    from: 'detect-check',
    window: FILM,
    map: true,
    crop: 'full',
    settle: 8000,
    after: false,
    async run({ page }) {
      await page.locator('.builder [role="tab"]', { hasText: 'Rules' }).filter({ visible: true }).first().click();
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
    focus: ['[data-guide="sheet.new-menu"]'],
    async run({ page }) {
      await seen(page, '[data-guide="sheet.new"]').click();
    },
  },
];

export const DEFAULT_WINDOW = TOOLS;
