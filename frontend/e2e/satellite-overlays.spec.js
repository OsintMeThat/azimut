import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * What the tool draws on the map, driven in a real browser.
 *
 * These paths had no browser coverage: the grid, the sky arc and the movable pin
 * were only ever asserted as strings in the source. They are also the paths that
 * a change of map engine rewrites, so this is the net that has to hold across
 * one — nothing here names the engine, only what an analyst can see and press.
 */

const tools = (page) => page.getByRole('button', { name: 'Grid Search' });

async function openGrid(page) {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await tools(page).click();
  await expect(page.getByRole('button', { name: 'Box' })).toBeVisible();
  // the view opens at z16, where a dragged box is under one default 500 m cell
  await page.getByTitle('Cell size in metres for the next grid').fill('50');
  return fixture;
}

/** Drag a box over the middle of the map. */
async function dragBox(page, from = [140, 130], to = [420, 330]) {
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
}

const coverage = (page) => page.locator('.grid-cov-text');

test('draws a grid over a dragged area and counts its cells', async ({ page }) => {
  await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await expect(page.getByText('Drag a box on the map. Esc to cancel.')).toBeVisible();

  await dragBox(page);

  // the lattice is painted on a canvas, so what says it exists is its own count
  await expect(coverage(page)).toBeVisible();
  const total = Number((await coverage(page).innerText()).split('/')[1].split(' ')[0]);
  expect(total).toBeGreaterThan(1);
  await expect(coverage(page)).toContainText('0/');
  await expect(coverage(page)).toContainText('· 0%');
});

test('marks a cell where it was clicked, and files that mark', async ({ page }) => {
  const fixture = await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await dragBox(page);
  await expect(coverage(page)).toContainText('0/');

  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + 200, box.y + 200);

  // one cell cleared: the click reached the shape on the canvas, and only it
  await expect(coverage(page)).toContainText('1/');
  await expect.poll(() => {
    const last = fixture.gridWrites.at(-1);
    return Object.values(last?.spec?.statuses ?? {});
  }).toEqual(['cleared']);
});

test('flags a cell on a right-click without cycling it', async ({ page }) => {
  const fixture = await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await dragBox(page);

  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + 200, box.y + 200, { button: 'right' });

  await expect(coverage(page)).toContainText('flagged');
  await expect.poll(() => {
    const last = fixture.gridWrites.at(-1);
    return Object.values(last?.spec?.statuses ?? {});
  }).toEqual(['flagged']);
});

test('sweeps with the keyboard, cell after cell', async ({ page }) => {
  await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await dragBox(page);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByText('clear · F flag · S skip')).toBeVisible();

  await page.keyboard.press('c');
  await expect(coverage(page)).toContainText('1/');
  await page.keyboard.press('f');
  await expect(coverage(page)).toContainText('2/');
  await expect(coverage(page)).toContainText('1 flagged');
  await page.keyboard.press('Escape');
  await expect(page.getByText('clear · F flag · S skip')).toHaveCount(0);
});

/** Is anything actually painted on the grid's canvas? */
const painted = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.leaflet-overlay-pane canvas');
    if (!canvas) return 0;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) lit += 1;
    return lit;
  });

test('hides the grid without closing it, then brings it back', async ({ page }) => {
  await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await dragBox(page);
  await expect.poll(() => painted(page)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Hide grid' }).click();
  // the lattice is gone from the imagery, and the grid is still open behind it
  await expect.poll(() => painted(page)).toBe(0);
  await expect(coverage(page)).toBeVisible();

  await page.getByRole('button', { name: 'Show grid' }).click();
  await expect.poll(() => painted(page)).toBeGreaterThan(0);
});

test('reshapes the area from its corner handles', async ({ page }) => {
  await openGrid(page);
  await page.getByRole('button', { name: 'Box' }).click();
  await dragBox(page);
  const before = Number((await coverage(page).innerText()).split('/')[1].split(' ')[0]);

  await page.getByRole('button', { name: 'Edit area' }).click();
  await expect(page.getByText('Drag the corners to reshape.')).toBeVisible();
  const handles = page.locator('.grid-handle');
  await expect(handles).toHaveCount(4);

  const handle = await handles.first().boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 140, handle.y - 120, { steps: 8 });
  await page.mouse.up();

  // the area really changed size, so the lattice was rebuilt over it
  await expect
    .poll(async () => Number((await coverage(page).innerText()).split('/')[1].split(' ')[0]))
    .not.toBe(before);
  await expect(handles).toHaveCount(4); // and the handles snapped to the new box
});

test('places a polygon area point by point', async ({ page }) => {
  await openGrid(page);
  await page.getByRole('button', { name: 'Polygon' }).click();
  const box = await page.locator('.map').boundingBox();
  // clear of the grid panel, which covers the top-left of the map
  for (const [x, y] of [[420, 200], [620, 240], [520, 420]]) {
    await page.mouse.click(box.x + x, box.y + y);
  }
  await expect(page.getByText('Click to add points· 3')).toBeVisible();
  await expect(page.locator('.grid-handle')).toHaveCount(3);

  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(coverage(page)).toBeVisible();
  await expect(page.locator('.grid-handle')).toHaveCount(0);
});

test('draws the sun and moon arcs for an anchored point, and scrubs the hour', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Sun and moon' }).click();

  // the day is asked for, then asked again once it comes back named
  await expect.poll(() => fixture.skyQueries.length).toBe(2);
  const marks = page.locator('.sky-body');
  await expect(marks).toHaveCount(1); // the sun is up at midday, the moon is not
  const arcs = page.locator('.leaflet-overlay-pane path');
  expect(await arcs.count()).toBeGreaterThan(4);

  const before = await marks.first().getAttribute('style');
  const slider = page.getByRole('slider', { name: 'Time of day' });
  await slider.focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');

  // the mark rode along its ray without asking the backend again
  await expect.poll(async () => (await marks.first().getAttribute('style')) !== before).toBe(true);
  expect(fixture.skyQueries).toHaveLength(2);
});

test('drops the sky layer when the mode closes', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Sun and moon' }).click();
  await expect(page.locator('.sky-body')).toHaveCount(1);

  await page.getByRole('button', { name: 'Sun and moon' }).click();
  await expect(page.locator('.sky-body')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
});

test('carries the coordinates on a dragged pin, and drops it on exit', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.getByTitle('Marker style').selectOption('pin');
  await page.getByTitle('Move the marker (coordinates follow it)').click();
  const pin = page.locator('.sat-marker');
  await expect(pin).toHaveCount(1);

  const readout = page.locator('.hud-coords');
  const before = await readout.innerText();
  const at = await pin.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 90, { steps: 8 });
  await page.mouse.up();

  // the readout is what a capture files, so it follows the pin, not the centre
  await expect.poll(async () => (await readout.innerText()) !== before).toBe(true);

  await page.getByTitle('Move the marker (coordinates follow it)').click();
  await expect(pin).toHaveCount(0);
});

test('measures a path clicked on the map, and clears it', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Measure tools' }).click();
  await page.getByRole('button', { name: 'Distance' }).click();

  const box = await page.locator('.map').boundingBox();
  await page.mouse.click(box.x + 160, box.y + 160);
  await page.mouse.click(box.x + 360, box.y + 260);

  // two dots and the line between them
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(3);
  await expect(page.locator('.measure-value')).toBeVisible();

  await page.getByRole('button', { name: 'Clear points' }).click();
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(0);
});
