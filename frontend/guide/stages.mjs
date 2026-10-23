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
 *   after   how a picture taken from another one is undone (Escape, by default)
 */

const TOOLS = { width: 1000, height: 700 };
const WIDE = { width: 1100, height: 720 };
const LARGE = { width: 1200, height: 760 };
const TALL = { width: 1100, height: 900 };
/** Wide enough for Board's Details to open beside the rows rather than over them. */
const ROOMY = { width: 1360, height: 800 };

const PIER_VIEW = 'll=33.7553,-118.2372&z=16';

/** The one element of these on screen: tools stay mounted, hidden, once visited. */
const seen = (page, selector) => page.locator(selector).filter({ visible: true }).first();

/** The card of one file in a grid of cards. */
const card = (page, name) => page.locator('.canvas-body .media-card', { hasText: name }).filter({ visible: true }).first();

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
      await page.locator('[data-guide="palette.search"] input').fill('pier');
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
    shot: 'settings',
    async run({ go, page }) {
      await go('settings');
      await page.locator('.canvas-body button', { hasText: 'Imagery' }).first().click();
    },
  },
  {
    shot: 'media',
    async run({ go }) {
      await go('media');
    },
  },
  {
    shot: 'media-open-in',
    from: 'media',
    focus: ['[data-guide="media.open-in-menu"]', '[title="Open in…"][aria-expanded="true"]'],
    async run({ page }) {
      await card(page, 'harbour_smoke_0412').locator('[title="Open in…"]').click();
    },
  },
  {
    shot: 'files',
    async run({ go, page }) {
      await go('files');
      await page.locator('[data-guide="files.tree"] .trow', { hasText: 'Sources' }).first().click();
      await page.locator('.grid-pane .tile.folder', { hasText: 'pier_watch' }).first().dblclick();
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
      await page.locator('.canvas-body').getByText('harbour_smoke_0412', { exact: true }).first().click();
    },
  },
  {
    shot: 'inspect',
    window: WIDE,
    async run({ go, page }) {
      await go('inspect');
      await page.locator('.canvas-body').getByText('convoy_dashcam', { exact: true }).first().click();
      await page.locator('[data-guide="inspect.strip"] img').first().waitFor();
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
    shot: 'collage',
    window: WIDE,
    async run({ go, page }) {
      await go('collage');
      await page.locator('.canvas-body').getByText('Harbour strip', { exact: true }).first().click();
    },
  },
  {
    shot: 'satellite',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`satellite?${PIER_VIEW}&p=usgs-imagery`);
      const row = page.locator('[data-guide="sat.panel"] .row, [data-guide="sat.panel"] li, [data-guide="sat.panel"] div', { hasText: 'Pier observations' }).last();
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
    shot: 'satellite-layers',
    from: 'satellite',
    window: WIDE,
    map: true,
    async run({ page }) {
      await seen(page, '[data-guide="sat.panel"] [title="Show the panel"]').click();
    },
  },
  {
    shot: 'compare',
    window: WIDE,
    map: true,
    async run({ go, page }) {
      await go(`compare?${PIER_VIEW}`);
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Pier T, imagery against the map').filter({ visible: true }).first().click();
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
    async run({ go, page }) {
      await go(`detect?${PIER_VIEW}`);
      await pickImagery(page, 'USGS Imagery').catch(() => {});
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
    shot: 'horizon',
    window: LARGE,
    map: true,
    settle: 20_000,
    async run({ go, page }) {
      await go('horizon');
      await page.locator('.canvas-body button', { hasText: 'Open' }).filter({ visible: true }).first().click();
      await page.getByText('Half Dome from Glacier Point').filter({ visible: true }).first().click();
      // the demo imagery stops at zoom 16, and Horizon says so where a reader would not
      await page.addStyleTag({ content: '.horizon-panel .problem { display: none !important; }' });
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
    shot: 'coordinates',
    async run({ go, page }) {
      await go('coordinates');
      await page.locator('[data-guide="coords.paste"] input').fill('33.7545, -118.2368');
      await page.locator('[data-guide="coords.paste"] button[type="submit"]').click();
      const sky = page.locator('[data-guide="coords.sky"]');
      await sky.locator('input').first().fill('14/03/2026');
      await sky.locator('input').nth(1).fill('21:40');
      await sky.locator('input').nth(1).press('Enter');
    },
  },
  {
    shot: 'proof',
    window: TALL,
    async run({ go, page }) {
      await go('media');
      await card(page, 'harbour_smoke_0412').locator('[title="Open in…"]').click();
      await page.locator('[role="menuitem"]', { hasText: /proof/i }).first().click();
      await page.locator('[data-guide="proof.panels"] button', { hasText: 'Add panel' }).click();
      await page.locator('[role="dialog"]').getByText('33.754500, -118.236800').first().click();
      await page.locator('[data-guide="proof.coords"] input').first().fill('33.7545, -118.2368');
      await page.locator('[data-guide="proof.coords"] input').nth(1).fill('Pier T, berth 4');
      await page.getByPlaceholder('A formation of 13 helicopters heading east').fill('Smoke over the crane row at berth 4, seen from the Pier T quay.');
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
      await page.getByPlaceholder('A formation of 13 helicopters was spotted heading East').fill('Smoke rising over the crane row at Pier T');
    },
  },
  {
    shot: 'plate',
    window: WIDE,
    settle: 6000,
    async run({ go, page }) {
      await go('plate');
      // a new plate starts on the Map's ground, with the layers the Satellite stage put on
      await seen(page, '.canvas-body button:has-text("New plate")').click();
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
      await page.locator('.canvas-body').getByText('Pier T, berth 4', { exact: true }).filter({ visible: true }).first().click();
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
