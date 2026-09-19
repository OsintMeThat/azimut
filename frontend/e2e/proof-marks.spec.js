import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * The two marks that are neither a line nor a word, driven on the real canvas.
 *
 * Both used to be handed to the code that moves a polyline, where reading the
 * points they have none of threw inside the drop handler: the move was never
 * written down, and the mark sprang back to where it had been picked up on the
 * next redraw. Neither was given transformer handles either, so neither could be
 * resized or turned. None of that is visible in the source — it is Konva
 * answering a gesture — so it is held here.
 */

/** Where the stage put the one node the transformer holds. */
const pickedAt = (page) => page.evaluate(() => {
  const tr = window.Konva.stages[0].find('Transformer')[0];
  return tr.nodes()[0]?.getAbsolutePosition() ?? null;
});

/** The handles on offer, the turn knob, and the frame in the picked node's own
 *  pixels — a panel is drawn at its own scale inside a stage that has one too. */
const handles = (page) => page.evaluate(() => {
  const tr = window.Konva.stages[0].find('Transformer')[0];
  const scale = tr.nodes()[0]?.getAbsoluteScale() ?? { x: 1, y: 1 };
  return {
    anchors: tr.enabledAnchors().length,
    rotates: tr.rotateEnabled(),
    width: tr.width() / scale.x,
    height: tr.height() / scale.y,
  };
});

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

test('a numbered marker stays where it is dropped, and resizes and turns', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Numbered marker (n)').click();
  await page.mouse.click(cx - 50, cy);
  await page.mouse.click(cx + 50, cy); // the stamp keeps the tool in hand
  await expect(page.locator('.shape-row')).toHaveCount(2);

  // The list runs front-first, so the marker stamped first is its last row.
  await page.locator('.shape-row').last().click(); // takes the hand back to Select
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const before = fixture.proofSaves[0].spec.shapes;
  expect(before.map((s) => [s.kind, s.n])).toEqual([['number', 1], ['number', 2]]);

  // A marker is a disc: corners only, with the ratio kept, and a turn knob.
  await settle(page);
  expect(await handles(page)).toMatchObject({ anchors: 4, rotates: true });

  const at = await pickedAt(page);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 70, box.y + at.y + 45, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const moved = fixture.proofSaves[1].spec.shapes.find((s) => s.n === 1);
  expect(moved.x).toBeGreaterThan(before[0].x + 20);
  expect(moved.y).toBeGreaterThan(before[0].y + 10);

  // and the corner grows it rather than stretching it
  await settle(page);
  const corner = await page.evaluate(() => {
    const tr = window.Konva.stages[0].find('Transformer')[0];
    return { x: tr.x() + tr.width(), y: tr.y() + tr.height() };
  });
  await page.mouse.move(box.x + corner.x, box.y + corner.y);
  await page.mouse.down();
  await page.mouse.move(box.x + corner.x + 40, box.y + corner.y + 40, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(3);
  const grown = fixture.proofSaves[2].spec.shapes.find((s) => s.n === 1);
  expect(grown.size).toBeGreaterThan(moved.size);
  fixture.expectNoUnexpectedRequests();
});

test('each colour numbers its own series from 1', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Numbered marker (n)').click();
  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx - 20, cy);

  // A second colour is a second feature, so its count starts over
  await page.getByTitle('Annotation colour').click();
  await page.getByLabel('color #40c4ff').click();
  await page.mouse.click(cx + 20, cy);
  await expect(page.locator('.shape-row')).toHaveCount(3);

  await page.getByTitle('Select / move (v)').click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.shapes.map((s) => [s.color, s.n])).toEqual([
    ['#ff5252', 1],
    ['#ff5252', 2],
    ['#40c4ff', 1],
  ]);
  fixture.expectNoUnexpectedRequests();
});

test('a blur box moves, resizes, and is framed on its own edges', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Blur box (b)').click();
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const drawn = fixture.proofSaves[0].spec.shapes[0];
  expect(drawn.kind).toBe('blur');
  // it hides rather than points, so it carries no ink at all
  expect(drawn.color).toBeUndefined();

  // A box: every handle, and a turn knob. The frame is the box itself — Konva
  // measures a group by its children and would have added the blur's margin.
  await settle(page);
  const frame = await handles(page);
  expect(frame).toMatchObject({ anchors: 8, rotates: true });
  expect(frame.width).toBeCloseTo(drawn.w, 0);
  expect(frame.height).toBeCloseTo(drawn.h, 0);

  const at = await pickedAt(page);
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + 80, box.y + at.y + 60, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const moved = fixture.proofSaves[1].spec.shapes[0];
  expect(moved.x).toBeGreaterThan(drawn.x + 20);
  expect(moved.y).toBeGreaterThan(drawn.y + 10);
  expect(moved.w).toBeCloseTo(drawn.w, 3); // a move is not a resize

  await settle(page);
  const corner = await page.evaluate(() => {
    const tr = window.Konva.stages[0].find('Transformer')[0];
    return { x: tr.x() + tr.width(), y: tr.y() + tr.height() };
  });
  await page.mouse.move(box.x + corner.x, box.y + corner.y);
  await page.mouse.down();
  await page.mouse.move(box.x + corner.x + 50, box.y + corner.y + 30, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(3);
  const grown = fixture.proofSaves[2].spec.shapes[0];
  expect(grown.w).toBeGreaterThan(moved.w);
  expect(grown.h).toBeGreaterThan(moved.h);
  fixture.expectNoUnexpectedRequests();
});

test('the colour swatch stays away from a blur box', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  await page.getByTitle('Blur box (b)').click();
  await expect(page.getByTitle('Annotation colour')).toHaveCount(0);

  await page.getByTitle('Numbered marker (n)').click();
  await expect(page.getByTitle('Annotation colour')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});
