// A box can carry a tag: its words on a tab of its own colour, hung from one of
// its corners, the way a published geolocation names a vehicle in its frame.
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

/** A box drawn in the middle of the panel, picked as it lands; its left edge on screen. */
async function drawBox(page) {
  const canvas = await page.locator('.konva canvas').first().boundingBox();
  const x = canvas.x + canvas.width / 2 - 50;
  const y = canvas.y + canvas.height / 2 - 20;
  await page.getByTitle('Box (r)').click();
  await drag(page, { x, y }, { x: x + 100, y: y + 60 });
  // the box is a node of its own once the page is drawn again, not the draft
  await expect.poll(() => page.evaluate(() => window.Konva.stages
    .find((s) => s.container().isConnected)
    .find('Rect').some((r) => /^s/.test(r.id())))).toBe(true);
  return { x, y, w: 100, h: 60 };
}

/**
 * The middle of the one box as it is drawn now. Read again before each gesture,
 * since the page can refit between two of them (a legend line adds a row).
 */
const boxMiddle = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected);
  const rect = stage.find('Rect').find((r) => /^s/.test(r.id()));
  const c = stage.container().getBoundingClientRect();
  const r = rect.getClientRect();
  return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
});

async function dblclickBox(page) {
  const at = await boxMiddle(page);
  await page.mouse.dblclick(at.x, at.y);
}

/** The box and its tab on screen, read off the drawn nodes. */
const drawn = (page, id) => page.evaluate((boxId) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${boxId}`));
  const c = stage.container().getBoundingClientRect();
  const at = (node) => {
    if (!node) return null;
    const r = node.getClientRect();
    return { x: c.left + r.x, y: c.top + r.y, w: r.width, h: r.height };
  };
  const box = stage.findOne(`#${boxId}`);
  return { box: at(box), tag: at(box.getParent().findOne('.box-tag')) };
}, id);

test('a double-click on a box hangs a tag from its top-left, worded as its legend line', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await drawBox(page);
  // the colour already names the feature in the legend
  const legend = page.getByPlaceholder('Feature 1 legend…');
  await legend.fill('Zastava 125pz');
  await legend.press('Tab');

  await dblclickBox(page);
  const editor = page.locator('textarea.text-edit');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Zastava 125pz');
  await page.keyboard.press('Enter');

  const [rect] = (await save(page, fixture)).shapes;
  expect(rect).toMatchObject({ kind: 'rect', tag: 'Zastava 125pz', tagAt: 'tl' });
  const { box: frame, tag } = await drawn(page, rect.id);
  // above the box, flush with its left side, and painted on over its line:
  // two edges that only meet leave a seam of background between them
  expect(tag.y + tag.h - frame.y).toBeGreaterThan(0.5);
  expect(tag.y + tag.h - frame.y).toBeLessThan(4);
  expect(Math.abs(tag.x - frame.x)).toBeLessThan(2);
  fixture.expectNoUnexpectedRequests();
});

test('the Tag control hangs it from another corner, and takes it off', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawBox(page);
  await page.getByTitle('Tag', { exact: true }).click();
  // nothing to take off yet
  await expect(page.getByTitle('No tag')).toHaveCount(0);
  await page.getByTitle('Tag on the bottom-right corner').click();
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('AK-47');
  await page.keyboard.press('Enter');

  const [rect] = (await save(page, fixture)).shapes;
  expect(rect).toMatchObject({ tag: 'AK-47', tagAt: 'br' });
  const { box: frame, tag } = await drawn(page, rect.id);
  expect(frame.y + frame.h - tag.y).toBeGreaterThan(0.5);
  expect(frame.y + frame.h - tag.y).toBeLessThan(4);
  expect(Math.abs(tag.x + tag.w - (frame.x + frame.w))).toBeLessThan(2);

  await page.getByTitle('Tag', { exact: true }).click();
  await page.getByTitle('Tag on the top-right corner').click();
  expect((await save(page, fixture)).shapes[0]).toMatchObject({ tag: 'AK-47', tagAt: 'tr' });

  await page.getByTitle('Tag', { exact: true }).click();
  await page.getByTitle('No tag').click();
  const bare = (await save(page, fixture)).shapes[0];
  expect(bare).not.toHaveProperty('tag');
  expect(bare).not.toHaveProperty('tagAt');
  fixture.expectNoUnexpectedRequests();
});

test('a tag goes with its box, and grows with its line', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await drawBox(page);
  await dblclickBox(page);
  // a key before the editor is up would pick a tool instead
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('Leopard 2A3');
  await page.keyboard.press('Enter');
  const [rect] = (await save(page, fixture)).shapes;
  const before = await drawn(page, rect.id);

  // pressed in the middle of the box, clear of the handles on its sides
  const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  await drag(page, middle, { x: middle.x + 40, y: middle.y + 25 });
  await expect.poll(async () => Math.round((await drawn(page, rect.id)).box.x - before.box.x)).toBe(40);
  const moved = await drawn(page, rect.id);
  expect(moved.tag.x - before.tag.x).toBeCloseTo(40, 0);
  expect(moved.tag.y - before.tag.y).toBeCloseTo(25, 0);

  // a heavier line carries a bigger tag
  await page.getByTitle('Stroke width').click();
  await page.getByLabel('stroke width').fill('8');
  await expect.poll(async () => (await drawn(page, rect.id)).tag.h).toBeGreaterThan(moved.tag.h * 1.4);
  fixture.expectNoUnexpectedRequests();
});

test('a new tag let go with Escape, or emptied, leaves the box untagged', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawBox(page);
  await dblclickBox(page);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.press('Escape');
  const row = page.locator('.shape-row input[placeholder="Tag…"]');
  await expect(page.locator('textarea.text-edit')).toHaveCount(0);
  await expect(row).toHaveCount(0);

  await dblclickBox(page);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('pylon');
  await page.keyboard.press('Enter');
  await expect(row).toHaveValue('pylon');
  await row.fill('');
  await row.press('Tab');
  expect((await save(page, fixture)).shapes[0]).not.toHaveProperty('tag');
  fixture.expectNoUnexpectedRequests();
});
