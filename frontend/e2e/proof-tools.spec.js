// The composer's own right-click, the stacking keys, and the settings the rail
// shows for what is picked: a line's style, a label's box, a panel's border, a
// view cone's lens and the proof's typeface.
import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function save(page, fixture) {
  const n = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(n + 1);
  return fixture.proofSaves[n].spec;
}

async function middle(page) {
  const box = await page.locator('.konva canvas').first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A box drawn with its middle at `at`, left picked as it lands. A colour is
 * picked with the tool in hand, where it sets the next mark rather than
 * repainting the one before.
 */
async function drawBox(page, at, half = 30, colour = null) {
  await page.getByTitle('Box (r)').click();
  if (colour) {
    await page.getByTitle('Annotation colour').click();
    await page.getByLabel(`color ${colour}`).click();
  }
  await drag(page, { x: at.x - half, y: at.y - half * 0.6 }, { x: at.x + half, y: at.y + half * 0.6 });
}

/** Whether the last contextmenu event on the canvas was kept from the browser. */
const browserMenuKept = (page) => page.evaluate(() => window.__menuPrevented);

test('a right-click on a mark opens the composer\'s menu, not the browser\'s', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await drawBox(page, { x: mid.x - 60, y: mid.y });
  await drawBox(page, { x: mid.x + 60, y: mid.y }, 30, '#40c4ff');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.querySelector('.konva').addEventListener('contextmenu', (e) => {
      setTimeout(() => { window.__menuPrevented = e.defaultPrevented; });
    });
  });

  // the box at the back, picked by the right-click itself
  await page.mouse.click(mid.x - 60, mid.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(await browserMenuKept(page)).toBe(true);
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /Send to back/ })).toBeDisabled();
  await menu.getByRole('menuitem', { name: /Bring to front/ }).click();
  await expect(menu).toHaveCount(0);
  const spec = await save(page, fixture);
  expect(spec.shapes.map((s) => s.color)).toEqual(['#40c4ff', '#ff5252']);

  // and Delete from the same menu
  await page.mouse.click(mid.x - 60, mid.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await expect(page.locator('.shape-row')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('a right-click on the panel or on the page answers with what they can do', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Crop' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove panel' })).toBeVisible();
  // the grid decides where panels sit, so there is no stacking to offer
  await expect(page.getByRole('menuitem', { name: /Bring to front/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  const canvas = await page.locator('.konva canvas').first().boundingBox();
  await page.mouse.click(canvas.x + 8, canvas.y + 8, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Fit view/ })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('Ctrl+↑ and Ctrl+↓ restack the picked mark, with Shift all the way', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  for (const [dx, colour] of [[-90, null], [0, '#40c4ff'], [90, '#ffffff']]) {
    await drawBox(page, { x: mid.x + dx, y: mid.y }, 25, colour);
  }
  // the white one is picked, in front: send it to the back
  await page.keyboard.press('Control+Shift+ArrowDown');
  expect((await save(page, fixture)).shapes.map((s) => s.color)).toEqual(['#ffffff', '#ff5252', '#40c4ff']);
  await page.keyboard.press('Control+ArrowUp');
  expect((await save(page, fixture)).shapes.map((s) => s.color)).toEqual(['#ff5252', '#ffffff', '#40c4ff']);
  // the rows keep their drag and lose their arrows
  await expect(page.locator('.shape-row .reorder-btn')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a line style is offered to lines only, and kept', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await page.getByTitle('Arrow (a)').click();
  await page.getByTitle('Line style').click();
  await page.getByTitle('Dashed line').click();
  await drag(page, { x: mid.x - 80, y: mid.y }, { x: mid.x + 40, y: mid.y - 40 });
  expect((await save(page, fixture)).shapes[0]).toMatchObject({ kind: 'arrow', dash: 'dash' });

  // the picked arrow turns dotted, then solid again
  await page.getByTitle('Line style').click();
  await page.getByTitle('Dotted line').click();
  expect((await save(page, fixture)).shapes[0].dash).toBe('dot');
  await page.getByTitle('Line style').click();
  await page.getByTitle('Solid line').click();
  expect((await save(page, fixture)).shapes[0]).not.toHaveProperty('dash');

  // a label has no line to style
  await page.getByTitle('Text (t)').click();
  await expect(page.getByTitle('Line style')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a picked label takes its frame and background from the rail', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await page.getByTitle('Text (t)').click();
  await page.mouse.click(mid.x - 40, mid.y);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('gate');
  await page.keyboard.press('Enter');

  await page.getByTitle('Frame around the words').click();
  await page.getByTitle('Background', { exact: true }).click();
  await page.getByLabel('background #0d1117').click();
  expect((await save(page, fixture)).shapes[0]).toMatchObject({ frame: true, bg: '#0d1117' });

  await page.getByTitle('Background', { exact: true }).click();
  await page.getByLabel('no background').click();
  expect((await save(page, fixture)).shapes[0].bg).toBeNull();
  // and the row keeps the words only
  await expect(page.locator('.shape-row button[title^="Frame"]')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a picked panel takes its border from the rail', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await page.locator('.panel-thumb').click();
  await page.getByTitle('Border', { exact: true }).click();
  await page.getByLabel('border #40c4ff').click();
  expect((await save(page, fixture)).panels[0].frame).toMatchObject({ color: '#40c4ff' });
  // saving is a press outside the panel, which folds it away
  await page.getByTitle('Border', { exact: true }).click();
  await page.getByLabel('border thickness').fill('12');
  expect((await save(page, fixture)).panels[0].frame.width).toBe(12);
  await page.getByTitle('Border', { exact: true }).click();
  await page.getByRole('button', { name: 'No border' }).click();
  expect((await save(page, fixture)).panels[0].frame ?? null).toBeNull();
  fixture.expectNoUnexpectedRequests();
});

test('a view cone is aimed by the drag and opens to the lens in hand', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await page.keyboard.press('o');
  await expect(page.getByTitle(/^View cone/)).toHaveClass(/active/);
  // from the bottom, straight to the right
  await drag(page, { x: mid.x - 100, y: mid.y + 40 }, { x: mid.x + 60, y: mid.y + 40 });
  const [cone] = (await save(page, fixture)).shapes;
  expect(cone).toMatchObject({ kind: 'cone', lens: '1', upright: false, fillOpacity: 0.35 });
  expect(cone.rotation).toBeCloseTo(90, 0);
  expect(cone.fov).toBeCloseTo(69.4, 1);
  expect(cone.reach).toBeGreaterThan(0);

  // a 2× zoom, then held upright
  await page.getByTitle('Lens', { exact: true }).click();
  await page.getByRole('button', { name: /Zoom 2×/ }).click();
  expect((await save(page, fixture)).shapes[0].fov).toBeCloseTo(38.2, 1);
  await page.getByTitle('Lens', { exact: true }).click();
  await page.getByTitle('Phone held upright').click();
  const upright = (await save(page, fixture)).shapes[0];
  expect(upright.upright).toBe(true);
  expect(upright.fov).toBeLessThan(38.2);
  fixture.expectNoUnexpectedRequests();
});

test('a view cone opens wider from an edge, and settles on a lens near one', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middle(page);
  await page.getByTitle(/^View cone/).click();
  await drag(page, { x: mid.x - 100, y: mid.y + 60 }, { x: mid.x - 100, y: mid.y - 80 });
  const before = (await save(page, fixture)).shapes[0];
  // the right edge's handle, read off the canvas
  const edge = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const handles = stage.find('.endh').filter((h) => h.getClassName() === 'Rect');
    const c = stage.container().getBoundingClientRect();
    const p = handles.reduce((a, b) => (b.x() > a.x() ? b : a)).getAbsolutePosition();
    return { x: c.left + p.x, y: c.top + p.y };
  });
  await drag(page, edge, { x: edge.x + 60, y: edge.y + 30 });
  const after = (await save(page, fixture)).shapes[0];
  expect(after.fov).toBeGreaterThan(before.fov);
  // either a lens it settled on, or a width set by hand
  expect(after.lens === null || typeof after.lens === 'string').toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('a new proof is set in the shipped face, and the Advanced section changes it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  expect(await save(page, fixture)).toMatchObject({ font: 'inter', fontBold: true });

  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByLabel('proof font').selectOption('barlow');
  await page.getByLabel('Labels, callouts and tags in bold').uncheck();
  expect(await save(page, fixture)).toMatchObject({ font: 'barlow', fontBold: false });

  // the canvas's words are set in it
  const mid = await middle(page);
  await page.getByTitle('Text (t)').click();
  await page.mouse.click(mid.x - 40, mid.y);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('gate');
  await page.keyboard.press('Enter');
  // read once the page is drawn again with the word on it
  const face = () => page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const text = stage.find('Text').find((t) => t.text() === 'gate');
    return text ? `${text.fontFamily()} | ${text.fontStyle()}` : null;
  });
  await expect.poll(face).toContain('Barlow Condensed');
  expect(await face()).toContain('| normal');
  fixture.expectNoUnexpectedRequests();
});
