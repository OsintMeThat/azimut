// Callouts and zoom insets point from a picture out onto the page. Their point,
// or their frame, belongs to the picture; their label, or their enlargement,
// stands on the page beside it.
import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

/** A drawn node on screen, by the id of the mark it belongs to. */
const onScreen = (page, id) => page.evaluate((markId) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${markId}`));
  const node = stage.findOne(`#${markId}`);
  const c = stage.container().getBoundingClientRect();
  const r = node.getClientRect();
  return { x: c.left + r.x, y: c.top + r.y, w: r.width, h: r.height, cx: c.left + r.x + r.width / 2, cy: c.top + r.y + r.height / 2 };
}, id);

/** Where a callout's dot stands on screen. */
const dotOnScreen = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('#pg-page'));
  const dot = stage.findOne('#pg-page').findOne('Circle');
  const c = stage.container().getBoundingClientRect();
  const p = dot.getAbsolutePosition();
  return { x: c.left + p.x, y: c.top + p.y };
});

const stageScale = (page) => page.evaluate(() => window.Konva.stages.find((s) => s.container().isConnected).scaleX());

async function middleOfPanel(page) {
  const box = await page.locator('.konva canvas').first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function save(page, fixture) {
  const n = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(n + 1);
  return fixture.proofSaves[n].spec;
}

async function typeLabel(page, words) {
  const editor = page.locator('textarea.text-edit');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
}

test('a callout is drawn from its point to its label, and asks for its words', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  const point = { x: mid.x + 30, y: mid.y + 40 };
  const label = { x: mid.x - 90, y: mid.y - 60 };

  await page.keyboard.press('k');
  await expect(page.getByTitle(/^Callout/)).toHaveClass(/active/);
  await drag(page, point, label);
  await typeLabel(page, 'north gate');

  const [callout] = (await save(page, fixture)).shapes;
  expect(callout).toMatchObject({ kind: 'callout', tail: 'leader', text: 'north gate' });
  // the label stands where it was let go, the dot where the press was
  const scale = await stageScale(page);
  expect(callout.dx * scale).toBeCloseTo(label.x - point.x, -1);
  expect(callout.dy * scale).toBeCloseTo(label.y - point.y, -1);
  const body = await onScreen(page, callout.id);
  expect(Math.abs(body.cx - label.x)).toBeLessThan(3);
  const dot = await dotOnScreen(page);
  expect(Math.abs(dot.x - point.x)).toBeLessThan(2);
  expect(Math.abs(dot.y - point.y)).toBeLessThan(2);
  // and the pen is down, as after any mark
  await expect(page.getByTitle('Select / move (v)')).toHaveClass(/active/);
  fixture.expectNoUnexpectedRequests();
});

test('a click puts the label up and to the right of its point', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await page.mouse.click(mid.x, mid.y + 30);
  await typeLabel(page, 'here');
  const [callout] = (await save(page, fixture)).shapes;
  expect([callout.dx, callout.dy]).toEqual([80, -60]);
  fixture.expectNoUnexpectedRequests();
});

test('the label drags alone, and the point keeps its pixel', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await drag(page, { x: mid.x, y: mid.y + 30 }, { x: mid.x - 80, y: mid.y - 40 });
  await typeLabel(page, 'pylon');
  const before = (await save(page, fixture)).shapes[0];
  const body = await onScreen(page, before.id);

  await drag(page, { x: body.cx, y: body.cy }, { x: body.cx + 120, y: body.cy + 10 });
  const after = (await save(page, fixture)).shapes[0];
  expect([after.x, after.y]).toEqual([before.x, before.y]);
  const scale = await stageScale(page);
  expect((after.dx - before.dx) * scale).toBeCloseTo(120, -1);
  fixture.expectNoUnexpectedRequests();
});

test('a callout belongs to its panel: a bigger panel carries its point, and the label rides along', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await drag(page, { x: mid.x + 60, y: mid.y + 40 }, { x: mid.x - 40, y: mid.y - 30 });
  await typeLabel(page, 'mast');
  const before = (await save(page, fixture)).shapes[0];

  for (let i = 0; i < 3; i++) await page.getByTitle('Enlarge panel').click();
  await expect(page.locator('.scale-val')).not.toHaveText('100%');
  const after = (await save(page, fixture)).shapes[0];
  // the point is the picture's pixel, the label's offset is the page's
  expect(after).toMatchObject({ panel: before.panel, x: before.x, y: before.y, dx: before.dx, dy: before.dy });
  fixture.expectNoUnexpectedRequests();
});

test('a callout point dragged elsewhere leaves its label where it stands', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await drag(page, { x: mid.x + 20, y: mid.y + 40 }, { x: mid.x - 60, y: mid.y - 40 });
  await typeLabel(page, 'tower');
  const before = (await save(page, fixture)).shapes[0];
  const body = await onScreen(page, before.id);
  const dot = await dotOnScreen(page);

  await drag(page, dot, { x: dot.x + 50, y: dot.y + 10 });
  const after = (await save(page, fixture)).shapes[0];
  expect(after.x).toBeGreaterThan(before.x);
  await expect.poll(async () => Math.round((await dotOnScreen(page)).x)).toBe(Math.round(dot.x + 50));
  const moved = await onScreen(page, before.id);
  expect(Math.abs(moved.cx - body.cx)).toBeLessThan(1.5);
  expect(Math.abs(moved.cy - body.cy)).toBeLessThan(1.5);
  fixture.expectNoUnexpectedRequests();
});

test('the pointer control gives a label a pointer, and takes it off again', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle('Text (t)').click();
  await page.mouse.click(mid.x - 40, mid.y);
  await typeLabel(page, 'depot');
  const label = (await save(page, fixture)).shapes[0];
  expect(label.kind).toBe('text');

  await page.getByTitle('Pointer', { exact: true }).click();
  await page.getByTitle('Leader line to the point').click();
  const callout = (await save(page, fixture)).shapes[0];
  expect(callout).toMatchObject({ id: label.id, kind: 'callout', tail: 'leader', text: 'depot' });

  await page.getByTitle('Pointer', { exact: true }).click();
  await page.getByTitle('Speech bubble').click();
  expect((await save(page, fixture)).shapes[0].tail).toBe('bubble');

  await page.getByTitle('Pointer', { exact: true }).click();
  await page.getByTitle('No pointer: a plain label').click();
  const back = (await save(page, fixture)).shapes[0];
  expect(back).toMatchObject({ id: label.id, kind: 'text', text: 'depot', frame: true });
  fixture.expectNoUnexpectedRequests();
});

test('a bubble picked with the tool in hand is how the next callout is drawn', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await page.getByTitle('Pointer', { exact: true }).click();
  // no plain label to fall back to: there is nothing picked to take a pointer off
  await expect(page.getByTitle('No pointer: a plain label')).toHaveCount(0);
  await page.getByTitle('Speech bubble').click();
  await page.mouse.click(mid.x, mid.y);
  await typeLabel(page, 'ridge');
  expect((await save(page, fixture)).shapes[0].tail).toBe('bubble');
  fixture.expectNoUnexpectedRequests();
});

test('a zoom inset frames a detail and shows it bigger', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.keyboard.press('z');
  await expect(page.getByTitle(/^Zoom inset/)).toHaveClass(/active/);
  await drag(page, { x: mid.x + 60, y: mid.y - 50 }, { x: mid.x + 100, y: mid.y - 20 });

  const [zoom] = (await save(page, fixture)).shapes;
  expect(zoom.kind).toBe('zoom');
  expect(zoom.iw).toBeGreaterThan(0);
  const scale = await stageScale(page);
  const inset = await onScreen(page, zoom.id);
  // bigger than the 40 screen pixels it frames, and keeping its proportions
  expect(inset.w).toBeGreaterThan(40 * 1.5);
  expect(inset.w / inset.h).toBeCloseTo(zoom.w / zoom.h, 1);
  expect(inset.w).toBeCloseTo(zoom.iw * scale, -1);
  await expect(page.getByTitle('Select / move (v)')).toHaveClass(/active/);
  fixture.expectNoUnexpectedRequests();
});

test('the enlargement moves and resizes on its own, and its frame stays', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Zoom inset/).click();
  await drag(page, { x: mid.x - 120, y: mid.y + 20 }, { x: mid.x - 80, y: mid.y + 50 });
  const before = (await save(page, fixture)).shapes[0];
  const inset = await onScreen(page, before.id);

  await drag(page, { x: inset.cx, y: inset.cy }, { x: inset.cx + 30, y: inset.cy - 20 });
  const moved = (await save(page, fixture)).shapes[0];
  expect([moved.x, moved.y, moved.w, moved.h]).toEqual([before.x, before.y, before.w, before.h]);
  expect(moved.dx).toBeGreaterThan(before.dx);

  // the bottom-right corner of the transformer grows it, proportions kept
  const corner = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const handle = stage.find('Transformer')[0].findOne('.bottom-right');
    const c = stage.container().getBoundingClientRect();
    const p = handle.getAbsolutePosition();
    return { x: c.left + p.x, y: c.top + p.y };
  });
  await drag(page, corner, { x: corner.x + 40, y: corner.y + 40 });
  const grown = (await save(page, fixture)).shapes[0];
  expect(grown.iw).toBeGreaterThan(moved.iw);
  expect([grown.w, grown.h]).toEqual([before.w, before.h]);
  fixture.expectNoUnexpectedRequests();
});

test('a blur box over the framed detail is blurred in the enlargement too', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle('Blur box (b)').click();
  await drag(page, { x: mid.x + 10, y: mid.y - 10 }, { x: mid.x + 40, y: mid.y + 15 });
  await page.getByTitle(/^Zoom inset/).click();
  await drag(page, { x: mid.x, y: mid.y - 20 }, { x: mid.x + 60, y: mid.y + 25 });
  const spec = await save(page, fixture);
  const zoom = spec.shapes.find((s) => s.kind === 'zoom');
  const blurred = await page.evaluate((id) => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${id}`));
    return stage.findOne(`#${id}`).find('Image')
      .some((image) => (image.filters() ?? []).includes(window.Konva.Filters.Blur));
  }, zoom.id);
  expect(blurred).toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('a callout and an inset are listed, copied and deleted like any mark', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const mid = await middleOfPanel(page);
  await page.getByTitle(/^Callout/).click();
  await page.mouse.click(mid.x - 60, mid.y + 30);
  await typeLabel(page, 'bridge');
  await page.getByTitle(/^Zoom inset/).click();
  await drag(page, { x: mid.x + 40, y: mid.y - 30 }, { x: mid.x + 80, y: mid.y });
  await expect(page.locator('.shape-row')).toHaveCount(2);
  await expect(page.locator('.shape-row').filter({ hasText: 'Zoom inset' })).toHaveCount(1);
  await expect(page.locator('.shape-row input[placeholder="Text…"]')).toHaveValue('bridge');

  await page.keyboard.press('Control+d');
  await expect(page.locator('.shape-row')).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(page.locator('.shape-row')).toHaveCount(2);
  fixture.expectNoUnexpectedRequests();
});
