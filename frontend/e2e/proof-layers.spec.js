import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * The Elements list as an order, driven on the real panel.
 *
 * Which end of the list is the front is the whole of what this is about, and it
 * is only answerable in a running app: the list is turned round against the
 * array it reads, so an assertion on the source could agree with itself while
 * the rows on screen said the opposite of what pressing them does.
 */

const RED = '#ff5252';
const WHITE = '#ffffff';
const BLUE = '#40c4ff';

/** Draw one box at an offset, in a colour picked from the palette. */
async function box(page, box0, dx, color) {
  await page.getByTitle('Box (r)').click();
  if (color) {
    await page.getByTitle('Annotation colour').click();
    await page.getByLabel(`color ${color}`).click();
  }
  const cx = box0.x + box0.width / 2 + dx;
  const cy = box0.y + box0.height / 2;
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 20, { steps: 6 });
  await page.mouse.up();
}

const colours = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.shape-row .chip')].map((chip) => getComputedStyle(chip).backgroundColor));

/** The middle of a row's label, which is the part of it that starts a drag.
 *  Scrolled into view first: the mouse is driven in viewport coordinates, and
 *  the side column is taller than the window. */
async function labelAt(page, seat) {
  const label = page.locator('.shape-row .el-label').nth(seat);
  await label.scrollIntoViewIfNeeded();
  const at = await label.boundingBox();
  return { x: at.x + at.width / 2, y: at.y + at.height / 2 };
}

test('the list runs front-first, and its arrows say which way that is', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const canvas = await page.locator('.konva canvas').first().boundingBox();

  await box(page, canvas, -90, null); // red, drawn first: the one at the back
  await box(page, canvas, -30, WHITE);
  await box(page, canvas, 30, BLUE); // drawn last: the one in front

  await expect(page.locator('.shape-row')).toHaveCount(3);
  // The row on top is the mark on top of the picture, the way the Panels list
  // above it reads and the way every layer list anywhere reads.
  expect(await colours(page)).toEqual([
    'rgb(64, 196, 255)', 'rgb(255, 255, 255)', 'rgb(255, 82, 82)',
  ]);
  expect(await page.locator('.shape-row .el-label').first().textContent()).toContain('#1');

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  // …while the spec keeps the order it always had: last drawn, drawn last
  expect(fixture.proofSaves[0].spec.shapes.map((s) => s.color)).toEqual([RED, WHITE, BLUE]);

  // The bottom row is the one at the back, and bringing it forward moves it up
  const back = page.locator('.shape-row').last();
  await back.getByTitle(/^Bring forward/).click();
  expect(await colours(page)).toEqual([
    'rgb(64, 196, 255)', 'rgb(255, 82, 82)', 'rgb(255, 255, 255)',
  ]);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  expect(fixture.proofSaves[1].spec.shapes.map((s) => s.color)).toEqual([WHITE, RED, BLUE]);
  fixture.expectNoUnexpectedRequests();
});

test('a row dragged to the top puts its element in front of the rest', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const canvas = await page.locator('.konva canvas').first().boundingBox();

  await box(page, canvas, -90, null);
  await box(page, canvas, -30, WHITE);
  await box(page, canvas, 30, BLUE);
  await expect(page.locator('.shape-row')).toHaveCount(3);

  const from = await labelAt(page, 2); // the red box, at the back
  const to = await labelAt(page, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 8, { steps: 3 }); // past the threshold
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  expect(await colours(page)).toEqual([
    'rgb(255, 82, 82)', 'rgb(64, 196, 255)', 'rgb(255, 255, 255)',
  ]);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.shapes.map((s) => s.color)).toEqual([WHITE, BLUE, RED]);
  fixture.expectNoUnexpectedRequests();
});

test('a press that never moved picks the element instead of reordering it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const canvas = await page.locator('.konva canvas').first().boundingBox();

  await box(page, canvas, -60, null);
  await box(page, canvas, 20, WHITE);
  await expect(page.locator('.shape-row')).toHaveCount(2);

  const at = await labelAt(page, 1);
  await page.mouse.click(at.x, at.y);

  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  expect(await colours(page)).toEqual(['rgb(255, 255, 255)', 'rgb(255, 82, 82)']);
  fixture.expectNoUnexpectedRequests();
});
