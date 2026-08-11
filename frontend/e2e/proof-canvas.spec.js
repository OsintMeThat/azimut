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
