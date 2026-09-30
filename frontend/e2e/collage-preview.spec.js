import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

// The collage list's preview is drawn by the browser from the open layout, warp
// included, which only a real canvas can show.

// A warped piece wider than a preview: its bounds are 1000×500, so it lands 480×240.
const WARPED = [[0, 0], [1000, 40], [960, 500], [20, 460]];

const strip = {
  name: 'Strip',
  title: 'Strip',
  spec: {
    width: 1200, height: 600, transparent: true,
    nodes: [{
      id: 'nd_1', frameId: null, save: { path: PANEL_PATH, time: null, ops: [] },
      w: 640, h: 360, quad: WARPED, frameOps: [], crop: null,
    }],
  },
};

/** The PNG inside a multipart body. */
function pngOf(body) {
  const start = body.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const end = body.indexOf(Buffer.from('IEND')) + 8;
  return body.subarray(start, end);
}

test('draws a warped collage into the preview it files', async ({ page }) => {
  await installAppFixture(page, {
    collages: [{ name: 'Strip', title: 'Strip', pieces: 1, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip`, (route) => route.fulfill({ json: strip }));
  const previews = [];
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip/thumb`, (route) => {
    previews.push(pngOf(route.request().postDataBuffer()));
    return route.fulfill({ json: { thumb: '.collages/Strip.webp' } });
  });

  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Strip/ }).click();
  await expect.poll(() => previews.length, { timeout: 8000 }).toBe(1);

  const read = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    return {
      width: image.width,
      height: image.height,
      middle: alpha(240, 120),
      // Above the top edge, which rises from (0,0) to (1000,40): outside the piece.
      outside: alpha(470, 1),
    };
  }, previews[0].toString('base64'));

  expect(read).toEqual({ width: 480, height: 240, middle: 255, outside: 0 });

  // The list the Collages window reads back now carries it, and the row shows it.
  await page.route(`**/api/cases/${CASE_ID}/collages`, (route) => route.fulfill({
    json: [{ name: 'Strip', title: 'Strip', pieces: 1, updated_at: '2026-09-20T10:00:00Z', thumb: '.collages/Strip.webp', thumb_v: 1 }],
  }));
  await page.route(`**/files/${CASE_ID}/.collages/Strip.webp*`, (route) =>
    route.fulfill({ contentType: 'image/png', body: previews[0] }));
  await page.getByRole('button', { name: 'Collages' }).click();
  const shown = page.locator('.row-preview img');
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((img) => img.naturalWidth)).toBe(480);
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-rows.png') });
});

test('lays the collages out as cards, marking the one whose picture is in the case', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    collages: [
      {
        name: 'Harbour strip', title: 'Harbour strip', pieces: 3, updated_at: '2026-09-21T10:00:00Z', filed: true,
        outline: { width: 300, height: 100, quads: [
          [[0, 0], [100, 0], [100, 100], [0, 100]],
          [[100, 5], [200, 0], [200, 100], [100, 95]],
          [[200, 0], [300, 0], [300, 100], [200, 100]],
        ] },
      },
      {
        name: 'Wall', title: 'Wall', pieces: 1, updated_at: '2026-09-20T10:00:00Z', filed: false,
        outline: { width: 80, height: 120, quads: [[[0, 0], [80, 0], [80, 120], [0, 120]]] },
      },
    ],
  });

  await page.goto('/#collage');
  const cards = page.locator('.card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('svg polygon')).toHaveCount(3);
  await expect(cards.nth(0).locator('.filed')).toBeVisible();
  await expect(cards.nth(1).locator('.filed')).toHaveCount(0);
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(Math.abs(a.y - b.y)).toBeLessThan(1); // side by side, a grid rather than rows
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT });

  await page.getByRole('textbox', { name: 'Search collages…' }).fill('harbour');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Harbour strip');
  fixture.expectNoUnexpectedRequests();
});

test('closes an open collage back to the list', async ({ page }) => {
  await installAppFixture(page, {
    collages: [{ name: 'Strip', title: 'Strip', pieces: 1, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip`, (route) => route.fulfill({ json: strip }));
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip/thumb`, (route) =>
    route.fulfill({ json: { thumb: '.collages/Strip.webp' } }));

  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Strip/ }).click();
  await expect(page.getByRole('textbox', { name: 'Collage name' })).toHaveValue('Strip');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-open.png') });

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Collages' })).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(1);
});

test('keeps the controls in reach over a case of many files', async ({ page }) => {
  const works = Array.from({ length: 40 }, (_, i) => ({
    name: `clip-${i}`, title: `clip_${String(i).padStart(2, '0')}_8f3a.mp4`, source: `media/clip-${i}.mp4`, frames: 3, kind: 'video',
  }));
  await installAppFixture(page, {
    inspectWorks: works,
    collages: [{ name: 'Strip', title: 'Strip', pieces: 1, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip`, (route) => route.fulfill({ json: strip }));
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip/thumb`, (route) =>
    route.fulfill({ json: { thumb: '.collages/Strip.webp' } }));

  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Strip/ }).click();
  await page.locator('img.node').first().click();

  await expect(page.locator('.identity .source')).toHaveText('panel.svg');
  await expect(page.locator('.group-head')).toHaveCount(40);
  // The files scroll on their own: the selected piece's controls stay on screen
  // below forty of them.
  await expect(page.getByRole('button', { name: 'Remove' })).toBeInViewport();
  await page.getByRole('textbox', { name: 'Search…' }).fill('clip_07');
  await expect(page.locator('.group-head')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search…' }).fill('');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-panel.png') });
});
