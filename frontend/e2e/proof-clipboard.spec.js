// Copy and paste of picked marks in Geo Proof: in the same proof, onto another
// picture, into another proof, and beside the image paste that Ctrl+V already made.
import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, canvasSettled, installAppFixture, openProofWithPanel } from './app.fixture.js';

const SECOND_PATH = 'media/second.svg';
const SECOND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="#445566"/><circle cx="640" cy="360" r="200" fill="#99aabb"/></svg>`;

const mediaItem = (path, width, height, sha) => ({
  path, filename: path.split('/').pop(), kind: 'image', width, height, size: 256, sha256: sha.repeat(64),
  source: { type: 'upload' }, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** A real system clipboard for the page, which the copy is written to and read back from. */
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

async function pickBothPictures(page) {
  await page.getByRole('button', { name: 'New proof' }).first().click();
  await expect(page.getByRole('heading', { name: 'New proof' })).toBeVisible();
  await page.locator('.selectable-pick').nth(0).click();
  await page.locator('.selectable-pick').nth(1).click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  // a proof open is replaced only once that is said
  const replace = page.getByRole('alertdialog', { name: 'Create a new proof?' });
  if (await replace.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await replace.getByRole('button', { name: 'Create proof' }).click();
  }
  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (
    window.Konva.stages.find((s) => s.container().isConnected)?.find('.panel-hit').length ?? 0
  ))).toBe(2);
  await canvasSettled(page);
}

async function openTwoPanels(page) {
  const fixture = await installAppFixture(page, {
    media: [mediaItem(PANEL_PATH, 640, 360, 'a'), mediaItem(SECOND_PATH, 1280, 720, 'b')],
  });
  await page.route(`**/files/${CASE_ID}/${SECOND_PATH}`, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: SECOND_SVG }));
  await page.goto('/#proof');
  await pickBothPictures(page);
  return fixture;
}

/** Each picture on screen, left to right: its id, its middle and its size. */
const pictures = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('.panel-hit'));
  const c = stage.container().getBoundingClientRect();
  return stage.find('.panel-hit').map((hit) => {
    const r = hit.getClientRect();
    return { id: hit.getParent().id().slice(3), x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2, w: r.width, h: r.height };
  }).sort((a, b) => a.x - b.x);
});

async function save(page, fixture) {
  const n = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(n + 1);
  return fixture.proofSaves[n].spec;
}

/** Three numbered markers across a picture, then the hand back. */
async function numberAcross(page, picture) {
  await page.getByTitle('Numbered marker (n)').click();
  for (const dx of [-0.3, 0, 0.3]) await page.mouse.click(picture.x + dx * picture.w, picture.y - picture.h * 0.2);
  await page.getByTitle('Select / move (v)').click();
}

/** Pick every row of the Elements list, as Shift on each row does. */
async function pickAllRows(page) {
  const rows = page.locator('.shape-row');
  const count = await rows.count();
  await rows.nth(0).click();
  for (let i = 1; i < count; i += 1) await rows.nth(i).click({ modifiers: ['Shift'] });
  await expect(page.locator('.shape-row.selected')).toHaveCount(count);
}

/** The text the system clipboard holds. */
const clipboardText = (page) => page.evaluate(() => navigator.clipboard.readText());

/**
 * Ctrl+V, the way the browser hands it over: what the system clipboard holds, or an
 * image put there since. Built in the page, since no engine lets a test put bytes on
 * the real clipboard and press the chord over them.
 */
async function paste(page, { image = null, target = null } = {}) {
  const text = image ? '' : await clipboardText(page);
  await page.evaluate(({ text, image, target }) => {
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    if (image) {
      const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
    (target ? document.querySelector(target) : document.body).dispatchEvent(event);
  }, { text, image, target });
}

test('a group pasted in the same proof lands stepped aside, picked, and goes in one undo', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await numberAcross(page, picture);
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(picture.x - 20, picture.y + 10);
  await page.mouse.down();
  await page.mouse.move(picture.x + 30, picture.y + 40, { steps: 6 });
  await page.mouse.up();
  const drawn = (await save(page, fixture)).shapes;
  expect(drawn).toHaveLength(4);

  await pickAllRows(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('"azimut":"proof-shapes"');
  await paste(page);
  await expect(page.locator('.shape-row')).toHaveCount(8);
  await expect(page.locator('.shape-row.selected')).toHaveCount(4);
  const spec = await save(page, fixture);
  const copies = spec.shapes.slice(4);
  expect(copies.map((s) => [s.kind, s.n, s.panel])).toEqual(drawn.map((s) => [s.kind, s.n, s.panel]));
  // a step down and right of each original, the same on the page for all of them
  const steps = copies.map((s, i) => [s.x - drawn[i].x, s.y - drawn[i].y]);
  for (const [dx, dy] of steps) {
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBeCloseTo(steps[0][0], 3);
    expect(dy).toBeCloseTo(steps[0][1], 3);
  }

  // a second paste steps on from the first; history keeps a step per pause, so
  // the second waits out the first one's
  await page.waitForTimeout(500);
  await paste(page);
  const again = (await save(page, fixture)).shapes.slice(8);
  expect(again[0].x - drawn[0].x).toBeCloseTo(steps[0][0] * 2, 3);

  // and each paste is one step back
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.shape-row')).toHaveCount(8);
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.shape-row')).toHaveCount(4);
  fixture.expectNoUnexpectedRequests();
});

test('numbers copied on a frame paste onto the other picture at the same places, numbers kept', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [frame, capture] = await pictures(page);
  await numberAcross(page, frame);
  const drawn = (await save(page, fixture)).shapes;

  await pickAllRows(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('"azimut":"proof-shapes"');
  // the other picture picked, then Ctrl+V
  await page.mouse.click(capture.x + capture.w * 0.4, capture.y + capture.h * 0.4);
  await expect(page.locator('.panel-row.selected')).toHaveCount(1);
  await paste(page);
  await expect(page.locator('.shape-row')).toHaveCount(6);
  let spec = await save(page, fixture);
  const pasted = spec.shapes.slice(3);
  expect(pasted.map((s) => [s.panel, s.n])).toEqual([[capture.id, 1], [capture.id, 2], [capture.id, 3]]);
  // at the same share of each picture, whatever their sizes
  const size = (id) => spec.panels.find((p) => p.id === id).natural;
  const [fw, fh] = size(frame.id);
  const [cw, ch] = size(capture.id);
  expect(cw).not.toBe(fw);
  pasted.forEach((s, i) => {
    expect(s.x / cw).toBeCloseTo(drawn[i].x / fw, 3);
    expect(s.y / ch).toBeCloseTo(drawn[i].y / fh, 3);
  });

  // with nothing picked, the picture under the pointer takes the next paste, a step on
  await page.keyboard.press('Escape');
  await page.mouse.move(capture.x, capture.y + capture.h * 0.3);
  await paste(page);
  spec = await save(page, fixture);
  const next = spec.shapes.slice(6);
  expect(next.map((s) => [s.panel, s.n])).toEqual([[capture.id, 1], [capture.id, 2], [capture.id, 3]]);
  expect(next[0].x).toBeGreaterThan(pasted[0].x);
  fixture.expectNoUnexpectedRequests();
});

test('marks copied in one proof paste into the next one, on the picture in the same place', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [frame] = await pictures(page);
  await numberAcross(page, frame);
  const drawn = (await save(page, fixture)).shapes;
  await pickAllRows(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('"azimut":"proof-shapes"');

  // another proof of the same two pictures
  await pickBothPictures(page);
  await expect(page.locator('.shape-row')).toHaveCount(0);
  const [newFrame] = await pictures(page);
  await page.mouse.move(10, 10); // off the canvas: no picture under the pointer
  await paste(page);
  await expect(page.locator('.shape-row')).toHaveCount(3);
  const spec = await save(page, fixture);
  // on the first panel again, where they stood, since nothing there is covered
  expect(spec.shapes.map((s) => [s.panel, s.n, s.x, s.y])).toEqual(drawn.map((s) => [newFrame.id, s.n, s.x, s.y]));
  expect(newFrame.id).not.toBe(frame.id);
  fixture.expectNoUnexpectedRequests();
});

test('an image copied since still pastes as an overlay', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await numberAcross(page, picture);
  await pickAllRows(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('"azimut":"proof-shapes"');

  // a screenshot taken after the copy: the system clipboard holds an image now
  await paste(page, { image: PNG_1PX });
  await expect(page.locator('.paste-row')).toHaveCount(1);
  await expect(page.locator('.shape-row')).toHaveCount(3);
  fixture.expectNoUnexpectedRequests();
});

test('a paste into a field being typed in stays the field\'s', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await numberAcross(page, picture);
  await pickAllRows(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => clipboardText(page)).toContain('"azimut":"proof-shapes"');
  await page.getByRole('textbox', { name: 'Proof name' }).focus();
  await paste(page, { target: 'input[aria-label="Proof name"]' });
  await expect(page.locator('.shape-row')).toHaveCount(3);
  fixture.expectNoUnexpectedRequests();
});

test('the right-click copies the picked marks and pastes them on the picture it is over', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [frame, capture] = await pictures(page);
  await numberAcross(page, frame);
  await pickAllRows(page);
  await canvasSettled(page);
  // on the middle marker, which is picked with the others
  await page.mouse.click(frame.x, frame.y - frame.h * 0.2, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Copy/ })).toBeEnabled();
  await menu.getByRole('menuitem', { name: /Copy/ }).click();

  await page.mouse.click(capture.x, capture.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Paste/ }).click();
  await expect(page.locator('.shape-row')).toHaveCount(6);
  const spec = await save(page, fixture);
  expect(spec.shapes.slice(3).map((s) => [s.panel, s.n])).toEqual([[capture.id, 1], [capture.id, 2], [capture.id, 3]]);
  fixture.expectNoUnexpectedRequests();
});
