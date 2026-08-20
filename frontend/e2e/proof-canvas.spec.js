import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

test('a real Konva panel remains interactive after click and drag', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // The stage fills the full tool height while the fitted 16:9 panel sits near
  // its top. Use a point well inside that image, away from its footer.
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(180, box.height / 3);

  await page.mouse.click(x, y);
  await expect(page.locator('.panel-row')).toHaveClass(/selected/);

  // Layout modes now live in the toolbar's overflow flyout; open it first.
  await page.getByTitle('Layout, tweet crops & repack').click();
  await page.getByTitle('Free layout: drag panels anywhere').click();
  // Changing layout intentionally clears selection. The first click above
  // covers the canvas selection regression; use the deterministic side control
  // to select the panel for the separate free-layout drag assertion.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.locator('.panel-thumb').click();
  await expect(page.locator('.panel-row')).toHaveClass(/selected/);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 28, { steps: 6 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const savedPanel = fixture.proofSaves[0].spec.panels[0];
  expect(Number.isFinite(savedPanel.x)).toBe(true);
  expect(Number.isFinite(savedPanel.y)).toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('draws a real Konva annotation and round-trips undo and redo', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2 - 40;
  const y = box.y + box.height / 2 - 25;

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 65, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.locator('.shape-row')).toHaveCount(0);
  await page.getByTitle('Redo (Ctrl+Shift+Z / Ctrl+Y)').click();
  await expect(page.locator('.shape-row')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('a picked colour becomes the default for the next drawn shape', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  // Same panel region the plain draw test uses, split into two small boxes.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Box (r)').click();

  // First box: drawn with the default colour, then auto-selected.
  await page.mouse.move(cx - 38, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx - 8, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  // Pick a new colour while that first box is still selected.
  await page.getByTitle('Annotation colour').click();
  await page.getByLabel('color #40c4ff').click();

  // Second box: should inherit the colour just picked, not the old default.
  await page.mouse.move(cx + 8, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const shapes = fixture.proofSaves[0].spec.shapes;
  expect(shapes[1].color).toBe('#40c4ff');
  // …and the first box keeps the colour it was drawn with: a pick made with a
  // drawing tool in hand sets the next shape, never repaints the last one.
  expect(shapes[0].color).toBe('#ff5252');
  fixture.expectNoUnexpectedRequests();
});

test('a picked stroke width becomes the default for the next drawn shape', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Box (r)').click();

  await page.mouse.move(cx - 38, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx - 8, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  // Change the stroke width while the first box is still selected.
  await page.getByTitle('Stroke width', { exact: true }).click();
  await page.locator('.stroke-slider').fill('11');

  await page.mouse.move(cx + 8, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const shapes = fixture.proofSaves[0].spec.shapes;
  expect(shapes[1].strokeWidth).toBe(11);
  expect(shapes[0].strokeWidth).toBe(4);
  fixture.expectNoUnexpectedRequests();
});

test('the layout overflow flyout opens and closes on outside click', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const freeBtn = page.getByTitle('Free layout: drag panels anywhere');
  // Collapsed by default: the control is in the DOM but not shown.
  await expect(freeBtn).toBeHidden();

  await page.getByTitle('Layout, tweet crops & repack').click();
  await expect(freeBtn).toBeVisible();

  // A click anywhere outside the flyout dismisses it.
  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(freeBtn).toBeHidden();
  fixture.expectNoUnexpectedRequests();
});

// A pasted image goes through the real browser path: clipboard event, Web Crypto
// hash, decode, Konva render. What must hold is that it lands as an image and not
// as a panel, and that its bytes ride along with the save exactly once.
async function pasteScreenshot(page, { via = 'paste' } = {}) {
  return page.evaluate(async (kind) => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 400, 300);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    if (kind === 'drop') {
      document.querySelector('.konva').dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      );
    } else {
      // Forced onto the event rather than passed to the constructor: Firefox ignores
      // `clipboardData` in the init dict, since only the browser is meant to fill it.
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: transfer, configurable: true });
      window.dispatchEvent(event);
    }
  }, via);
}

test('pastes a screenshot into the proof without filing it as a panel', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  await pasteScreenshot(page);
  await expect(page.locator('.paste-row')).toHaveCount(1);
  await expect(page.locator('.paste-row')).toHaveClass(/selected/); // ready to place
  await expect(page.locator('.panel-row:not(.paste-row)')).toHaveCount(1); // still one panel

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const saved = fixture.proofSaves[0];

  expect(saved.spec.panels).toHaveLength(1); // the paste is not evidence
  expect(saved.spec.pastes).toHaveLength(1);
  const paste = saved.spec.pastes[0];
  expect(paste.asset).toMatch(/^[0-9a-f]{16}\.png$/); // named by its own bytes
  expect(paste.natural).toEqual([400, 300]);
  expect(paste.frame).toBeNull();
  // the pixels ride along with this save, and only this one
  expect(saved.assets.map((a) => a.name)).toEqual([paste.asset]);
  expect(saved.assets[0].data.length).toBeGreaterThan(0);
  fixture.expectNoUnexpectedRequests();
});

test('a dropped image is pasted, and its frame survives the save', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  await pasteScreenshot(page, { via: 'drop' });
  await expect(page.locator('.paste-row')).toHaveCount(1);

  // picking a border colour is what turns a frame on, on a paste or on a panel
  await page.locator('.paste-row input[aria-label="border color"]').fill('#40c4ff');
  await expect(page.locator('.paste-row input[aria-label="border thickness"]')).toBeVisible();
  await page.locator('.panel-row:not(.paste-row) input[aria-label="border color"]').fill('#69f0ae');

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const { spec } = fixture.proofSaves[0];

  expect(spec.pastes[0].frame).toEqual({ color: '#40c4ff', width: 6 });
  expect(spec.panels[0].frame).toEqual({ color: '#69f0ae', width: 6 });
  fixture.expectNoUnexpectedRequests();
});

test('a pasted image hosts its own annotations and leaves with them', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await pasteScreenshot(page, { via: 'drop' });
  await expect(page.locator('.paste-row')).toHaveCount(1);

  // the image lands centred on the view, so the centre of the canvas is over it
  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(cx - 12, cy - 8);
  await page.mouse.down();
  await page.mouse.move(cx + 14, cy + 9, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const { spec } = fixture.proofSaves[0];
  // the annotation is bound to the pasted image, not to the panel behind it
  expect(spec.shapes[0].panel).toBe(spec.pastes[0].id);

  // removing the image takes its annotation with it
  await page.locator('.paste-row').getByTitle('Remove overlay').click();
  await expect(page.locator('.paste-row')).toHaveCount(0);
  await expect(page.locator('.shape-row')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

/** Draw one box on the panel, which leaves it selected. */
async function drawBox(page) {
  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2 - 40;
  const y = box.y + box.height / 2 - 25;
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 65, { steps: 6 });
  await page.mouse.up();
}

/** A paste event, optionally carrying an image the way the system clipboard would. */
async function sendPaste(page, { image = null } = {}) {
  await page.evaluate((b64) => {
    const data = new DataTransfer();
    if (b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    }
    // forced onto the event rather than passed to the constructor, which Firefox
    // ignores; no engine lets a script fill the real clipboard unprompted
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
    window.dispatchEvent(event);
  }, image);
}

const CLIPBOARD_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('Ctrl+C then Ctrl+V duplicates the selected annotation', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawBox(page);
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.keyboard.press('Control+c');
  await sendPaste(page);

  await expect(page.locator('.shape-row')).toHaveCount(2);
  fixture.expectNoUnexpectedRequests();
});

test('a copied shape outranks a screenshot the clipboard was already holding', async ({ page }) => {
  // The two clipboards answer one chord, and the analyst copied the shape last.
  // Reading the system one first pasted an hour-old screenshot over their rectangle.
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawBox(page);

  await page.keyboard.press('Control+c');
  await sendPaste(page, { image: CLIPBOARD_PNG });

  await expect(page.locator('.shape-row')).toHaveCount(2);
  await expect(page.locator('.paste-row')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('leaving the window hands Ctrl+V back to the system clipboard', async ({ page }) => {
  // Going somewhere else is the only way an outside copy could have happened, so it
  // is what makes the shape copy the older of the two.
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawBox(page);
  await page.keyboard.press('Control+c');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sendPaste(page, { image: CLIPBOARD_PNG });

  await expect(page.locator('.paste-row')).toHaveCount(1);
  await expect(page.locator('.shape-row')).toHaveCount(1); // the shape was not duplicated
  fixture.expectNoUnexpectedRequests();
});

// Konva ends a corner-resize on a window mouseup and on nothing else. A release
// the page never sees — the button let go outside the window, the tab alt-tabbed
// away mid-drag — used to leave the resize running: the panel kept growing under
// a pointer with no button held, and the scale never reached the document, so the
// drawn panel, its selection frame and the sidebar percentage all disagreed.
test('a resize whose release the window never sees still lands, and stops there', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  await page.locator('.panel-thumb').click();
  await expect(page.locator('.panel-row')).toHaveClass(/selected/);
  await expect(page.locator('.scale-val')).toHaveText('100%');
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  // The selection frame is drawn on the canvas, so its corner has no DOM handle
  // to click; ask the stage where it put it.
  const anchor = await page.evaluate(() => {
    const tr = window.Konva.stages[0].find('Transformer')[0];
    return { x: tr.x() + tr.width(), y: tr.y() + tr.height() };
  });
  const canvas = await page.locator('.konva canvas').first().boundingBox();
  const ax = canvas.x + anchor.x;
  const ay = canvas.y + anchor.y;

  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 60, ay + 40, { steps: 8 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); // the release that never arrives

  await expect(page.locator('.scale-val')).not.toHaveText('100%');
  const committed = await page.locator('.scale-val').innerText();

  // The pointer wanders on with no button held. Nothing may follow it.
  await page.mouse.move(ax + 240, ay + 170, { steps: 10 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(page.locator('.scale-val')).toHaveText(committed);

  await page.mouse.up();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const saved = fixture.proofSaves[0].spec.panels[0];
  expect(`${Math.round(saved.scale * 100)}%`).toBe(committed);
  fixture.expectNoUnexpectedRequests();
});

test('a stroke started inside a shape draws, and leaves that shape where it was', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  // A box wide enough that the next gesture starts well inside it.
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(cx - 70, cy - 45);
  await page.mouse.down();
  await page.mouse.move(cx + 70, cy + 45, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const drawnBox = fixture.proofSaves[0].spec.shapes[0];

  // Konva fills a shape's hit canvas whether or not the shape has a fill, so
  // this press lands on the box. With a line in hand it must draw anyway.
  await page.getByTitle('Line (l)').click();
  await page.mouse.move(cx - 40, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const shapes = fixture.proofSaves[1].spec.shapes;
  expect(shapes[1].kind).toBe('line');
  expect(shapes[0]).toEqual(drawnBox); // the box neither moved nor resized
  fixture.expectNoUnexpectedRequests();
});

test('a fill is opt-in, rides the shape colour and survives the save', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();

  // Drawn before touching the control: hollow, like every shape starts.
  await page.mouse.move(cx - 70, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx - 12, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.getByTitle('Fill', { exact: true }).click();
  await page.getByLabel('fill opacity').fill('40');

  await page.mouse.move(cx + 12, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 70, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const shapes = fixture.proofSaves[0].spec.shapes;
  expect(shapes[0].fillOpacity).toBeUndefined();
  expect(shapes[1].fillOpacity).toBe(0.4);
  fixture.expectNoUnexpectedRequests();
});

test('the fill control is out for the kinds that cannot hold one', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  await page.getByTitle('Ellipse (e)').click();
  await expect(page.getByTitle('Fill', { exact: true })).toBeVisible();
  await page.getByTitle('Arrow (a)').click();
  await expect(page.getByTitle('Fill', { exact: true })).toBeHidden();
  fixture.expectNoUnexpectedRequests();
});

/** Two boxes side by side on the panel, drawn with the Box tool. */
async function drawTwoBoxes(page) {
  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(cx - 80, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy + 10, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(cx + 20, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(2);
  await page.getByTitle('Select / move (v)').click();
  return { cx, cy };
}

test('shift-click picks a second annotation, and both take one colour', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await drawTwoBoxes(page);

  const rows = page.locator('.shape-row');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);

  await page.getByTitle('Annotation colour').click();
  await page.getByLabel('color #40c4ff').click();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const shapes = fixture.proofSaves[0].spec.shapes;
  expect(shapes.map((s) => s.color)).toEqual(['#40c4ff', '#40c4ff']);
  fixture.expectNoUnexpectedRequests();
});

test('a marquee dragged over the panel picks what it touches, and Delete takes them all', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { cx, cy } = await drawTwoBoxes(page);

  // Grid layout pins the panel, so a drag across it picks rather than moves.
  // Start beside the left box, inside the panel, and sweep across both.
  await page.mouse.move(cx - 110, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 110, cy + 5, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);
  await expect(page.locator('.panel-row')).not.toHaveClass(/selected/);

  await page.keyboard.press('Delete');
  await expect(page.locator('.shape-row')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a marquee that touches nothing clears the selection', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { cx, cy } = await drawTwoBoxes(page);

  await page.locator('.shape-row').first().click();
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);

  await page.mouse.move(cx - 100, cy + 60);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 90, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row.selected')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('dragging one of several moves the whole family', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { cx, cy } = await drawTwoBoxes(page);

  const rows = page.locator('.shape-row');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const before = fixture.proofSaves[0].spec.shapes;

  // Press inside the first box and drag: the second must travel the same way.
  await page.mouse.move(cx - 50, cy - 15);
  await page.mouse.down();
  await page.mouse.move(cx - 50, cy + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const after = fixture.proofSaves[1].spec.shapes;
  const moved = after.map((s, i) => s.y - before[i].y);
  expect(moved[0]).toBeGreaterThan(1);
  expect(moved[1]).toBeCloseTo(moved[0], 1);
  fixture.expectNoUnexpectedRequests();
});

test('clicking one of several collapses to it, but dragging does not', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { cx, cy } = await drawTwoBoxes(page);

  const rows = page.locator('.shape-row');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);

  // A press inside a picked box that turns into a drag keeps the family, so the
  // whole of it travels; only a press that stays put narrows the selection.
  await page.mouse.move(cx - 50, cy - 15);
  await page.mouse.down();
  await page.mouse.move(cx - 50, cy + 5, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row.selected')).toHaveCount(2);

  // The drag rebuilds the document, and Konva redraws its hit canvas a frame
  // behind the scene: a press landing inside that frame is tested against the
  // canvas from before, so let the redraw land before clicking.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.mouse.click(cx - 50, cy + 5);
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('stamps a symbol, keeps the tool in hand, and saves it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Symbol (s)').click();
  await page.getByRole('button', { name: 'Tank', exact: true }).click();

  await page.mouse.click(cx - 60, cy);
  await expect(page.locator('.shape-row')).toHaveCount(1);
  // the stamp stays armed, so a second mark is a second click and nothing else
  await page.mouse.click(cx + 60, cy);
  await expect(page.locator('.shape-row')).toHaveCount(2);
  await expect(page.locator('.shape-row').first()).toContainText('Tank');

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const stamped = fixture.proofSaves[0].spec.shapes.filter((s) => s.kind === 'icon');
  expect(stamped).toHaveLength(2);
  expect(stamped[0].name).toBe('tank');
  expect(Number.isFinite(stamped[0].size)).toBe(true);
  expect(Number.isFinite(stamped[0].x)).toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('a solid symbol takes a colour and offers no stroke width', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  await page.getByTitle('Symbol (s)').click();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  // a silhouette has no outline, so the control goes away rather than lying
  await expect(page.getByTitle('Stroke width')).toHaveCount(0);
  await expect(page.getByTitle('Annotation colour')).toBeVisible();

  await page.getByTitle('Symbol (s)').click();
  await page.getByRole('button', { name: 'Vehicle', exact: true }).click();
  await expect(page.getByTitle('Stroke width')).toBeVisible();
});

test('panels stay resizable and movable once a symbol tool exists', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  // A reference to selKind above its declaration once threw inside the effect
  // that wires the transformer, taking the panel handles and the row-move
  // arrows down with it. Nothing in the unit suite could see that.
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.locator('.panel-thumb').click();
  await expect(page.locator('.panel-row')).toHaveClass(/selected/);
  await expect(page.locator('.konva canvas').first()).toBeVisible();

  await page.getByTitle('Symbol (s)').click();
  await page.getByRole('button', { name: 'Drone', exact: true }).click();
  await page.getByTitle('Select / move (v)').click();
  await page.locator('.panel-thumb').click();

  expect(errors).toEqual([]);
});

// ---- gestures the composer runs itself, released where Konva cannot hear ----
// Konva binds pointerup to its container and to nothing else, so letting go over
// the annotations column — which touches the right edge of the canvas, and is
// where the pointer lands whenever a stroke is drawn near a panel's right side —
// never reached the handlers that settle a draft, a marquee or a pan.

/** The size of the one committed annotation, read off the drawn node. */
const drawnSize = (page) => page.evaluate(() => {
  const node = window.Konva.stages[0].find('Rect').find((rect) => rect.id());
  return node ? { w: Math.round(node.width()), h: Math.round(node.height()) } : null;
});

/** Marquee rectangles still on the ui layer, found by the fill only it uses. */
const marqueeGhosts = (page) => page.evaluate(() => window.Konva.stages[0]
  .find('Rect')
  .filter((rect) => rect.fill() === 'rgba(232, 163, 61, 0.12)').length);

const stagePos = (page) => page.evaluate(() => {
  const stage = window.Konva.stages[0];
  return { x: Math.round(stage.x()), y: Math.round(stage.y()) };
});

test('a stroke let go off the canvas lands, and stops following the pointer', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const side = await page.locator('aside.side').boundingBox();
  const x = box.x + box.width / 2 - 40;
  const y = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 60, { steps: 6 });
  await page.mouse.move(side.x + 20, y, { steps: 4 }); // over the side column
  await page.mouse.up();

  await expect(page.locator('.shape-row')).toHaveCount(1);
  // The settle runs a frame after the release and the rebuild a frame after
  // that, so let both land before reading the drawn node.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const committed = await drawnSize(page);
  expect(committed).not.toBeNull();

  // The pointer wanders on with no button held. Nothing may follow it.
  await page.mouse.move(x + 260, y + 190, { steps: 10 });
  await page.mouse.move(x - 100, y + 30, { steps: 10 });
  await expect(page.locator('.shape-row')).toHaveCount(1);
  expect(await drawnSize(page)).toEqual(committed);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.shapes).toHaveLength(1);
  fixture.expectNoUnexpectedRequests();
});

test('a marquee let go off the canvas selects what it caught and leaves nothing behind', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const side = await page.locator('aside.side').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  // The shape drawn a moment ago comes back into reach with the hand; Escape
  // lets go of it, so what the rectangle below catches is the rectangle's own.
  await page.getByTitle('Select / move (v)').click();
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.shape-row.selected')).toHaveCount(0);

  // A rectangle dragged over that annotation, released over the side column.
  // Grid layout pins the panel, so a drag across it picks rather than moves.
  await page.mouse.move(cx - 110, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 30, { steps: 8 });
  await page.mouse.move(side.x + 20, cy, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  expect(await marqueeGhosts(page)).toBe(0);

  // The next press used to orphan the old rectangle on the ui layer, where
  // nothing would ever destroy it.
  await page.mouse.move(cx - 110, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx - 90, cy - 10, { steps: 4 });
  await page.mouse.up();
  expect(await marqueeGhosts(page)).toBe(0);
  fixture.expectNoUnexpectedRequests();
});

test('a pan let go off the canvas stops there', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const side = await page.locator('aside.side').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 70, cy + 40, { steps: 6 });
  await page.mouse.move(side.x + 20, cy, { steps: 4 });
  await page.mouse.up({ button: 'middle' });

  const settled = await stagePos(page);
  await page.mouse.move(cx - 150, cy + 120, { steps: 10 });
  await page.mouse.move(cx + 200, cy - 60, { steps: 10 });
  expect(await stagePos(page)).toEqual(settled);
  fixture.expectNoUnexpectedRequests();
});

test('the right button neither draws nor drops what is picked', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.shape-row')).toHaveCount(0);

  // Same in Select: the drag used to clear the selection and open a marquee.
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);
  await page.locator('.shape-row').click();
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 30, cy + 20, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  expect(await marqueeGhosts(page)).toBe(0);
  fixture.expectNoUnexpectedRequests();
});

test('Escape unwinds one level per press', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2 - 40;
  const y = box.y + Math.min(180, box.height / 3);

  // Mid-draft: the stroke goes and the pen stays, because cancelling a stroke
  // is no reason to put the pen down.
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(0);
  await expect(page.getByTitle('Box (r)')).toHaveClass(/active/);

  // Nothing left in hand: now the pen goes down.
  await page.keyboard.press('Escape');
  await expect(page.getByTitle('Select / move (v)')).toHaveClass(/active/);

  // A pick that shows is its own rung, ahead of the tool.
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.mouse.up();
  await page.locator('.shape-row').click();
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('.shape-row.selected')).toHaveCount(0);
  await expect(page.locator('.shape-row')).toHaveCount(1);
  fixture.expectNoUnexpectedRequests();
});

test('a row picked in the side column takes the hand back to Select', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2 - 40;
  const y = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Box (r)').click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.mouse.up();

  // Drawn with the Box still in hand: no row lights up, because nothing on the
  // canvas would answer to it.
  await expect(page.locator('.shape-row')).toHaveCount(1);
  await expect(page.locator('.shape-row.selected')).toHaveCount(0);

  await page.locator('.shape-row').click();
  await expect(page.getByTitle('Select / move (v)')).toHaveClass(/active/);
  await expect(page.locator('.shape-row.selected')).toHaveCount(1);
  // and Delete now reaches it, which is what the lit row promises
  await page.keyboard.press('Delete');
  await expect(page.locator('.shape-row')).toHaveCount(0);

  // A panel row reads the same way.
  await page.getByTitle('Box (r)').click();
  await page.locator('.panel-thumb').click();
  await expect(page.getByTitle('Select / move (v)')).toHaveClass(/active/);
  await expect(page.locator('.panel-row')).toHaveClass(/selected/);
  fixture.expectNoUnexpectedRequests();
});

test('a placed label opens its editor on the spot, and holds two lines', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Text (t)').click();
  await page.mouse.click(cx - 40, cy);
  const editor = page.locator('textarea.text-edit');
  await expect(editor).toBeFocused();

  await page.keyboard.type('north');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('wall');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.shapes.map((s) => s.text)).toEqual(['north\nwall']);
  fixture.expectNoUnexpectedRequests();
});

test('the room around the page pans with a drawing tool in hand', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const before = await stagePos(page);

  // Same room, same drag as in Select: the press used to be lost entirely while
  // the crosshair promised a stroke.
  await page.getByTitle('Box (r)').click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height - 58, { steps: 6 });
  await page.mouse.up();

  const after = await stagePos(page);
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeLessThan(before.y);
  await expect(page.locator('.shape-row')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('undoing back to the saved document takes the unsaved badge with it', async ({ page }) => {
  // The saved proof has to be findable in the catalog afterwards, or the
  // composer rightly decides it was deleted out from under it and marks the
  // document unsaved again.
  const fixture = await installAppFixture(page, {
    lookupEntities: { 'proofs/.meta/browser-proof.json': { id: 'proof-1' } },
  });
  await openProofWithPanel(page);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  await expect(page.getByText('unsaved')).toHaveCount(0);
  // outlast the history capture debounce, so the save's own document is on the stack
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

  await drawBox(page);
  await expect(page.locator('.shape-row')).toHaveCount(1);
  await expect(page.getByText('unsaved')).toHaveCount(1);

  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.locator('.shape-row')).toHaveCount(0);
  await expect(page.getByText('unsaved')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a freehand stroke resizes from its handles, and its samples take the change', async ({ page }) => {
  // It is the one kind with neither vertex handles nor a width to write a resize
  // into, so the whole transform is folded into the samples themselves.
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);

  await page.getByTitle('Freehand (d)').click();
  await page.mouse.move(cx - 60, cy - 20);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy + 10, { steps: 6 });
  await page.mouse.move(cx + 30, cy - 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.shape-row')).toHaveCount(1);

  await page.locator('.shape-row').click(); // takes the hand back to Select
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const before = fixture.proofSaves[0].spec.shapes[0];
  expect(before.kind).toBe('freehand');

  // The frame is drawn on the canvas, so ask the stage where it put its corner.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const anchor = await page.evaluate(() => {
    const tr = window.Konva.stages[0].find('Transformer')[0];
    return { x: tr.x() + tr.width(), y: tr.y() + tr.height() };
  });
  await page.mouse.move(box.x + anchor.x, box.y + anchor.y);
  await page.mouse.down();
  await page.mouse.move(box.x + anchor.x + 70, box.y + anchor.y + 50, { steps: 8 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const after = fixture.proofSaves[1].spec.shapes[0];
  const span = (points, axis) => {
    const values = points.filter((_, i) => i % 2 === axis);
    return Math.max(...values) - Math.min(...values);
  };
  expect(span(after.points, 0)).toBeGreaterThan(span(before.points, 0));
  expect(span(after.points, 1)).toBeGreaterThan(span(before.points, 1));
  fixture.expectNoUnexpectedRequests();
});

test('a finished curve leaves the tool in hand', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);

  const canvas = page.locator('.konva canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(180, box.height / 3);
  const curve = page.getByTitle(/^Curve/);

  // Konva calls any two clicks inside its 400 ms window a double-click, whatever
  // the distance between them, so vertices are dropped at a human's pace here.
  const vertex = async (x, y) => {
    await page.mouse.click(x, y);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)));
  };

  await curve.click();
  await vertex(cx - 40, cy);
  await vertex(cx, cy - 20);
  await page.mouse.dblclick(cx + 40, cy);
  await expect(page.locator('.shape-row')).toHaveCount(1);
  await expect(curve).toHaveClass(/active/);

  // Three curves in a row is three drags, not three presses on `c` as well.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 450)));
  await vertex(cx - 40, cy + 25);
  await vertex(cx, cy + 10);
  await page.mouse.dblclick(cx + 40, cy + 25);
  await expect(page.locator('.shape-row')).toHaveCount(2);
  fixture.expectNoUnexpectedRequests();
});
