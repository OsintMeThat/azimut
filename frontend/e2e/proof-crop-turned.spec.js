import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, openProofWithPanel, showProofTab } from './app.fixture.js';

// A turned picture is cropped the way it is seen: the marks stand square on the
// page and the cut they leave is square too, however far the picture was turned.

/** The selection: the node it holds, where it is, its turn and its knob. */
const selection = (page) => page.evaluate(() => {
  const stage = window.Konva.stages[0];
  const transformer = stage.find((node) => node.getClassName() === 'Transformer')[0];
  const node = transformer.nodes()[0];
  if (!node) return null;
  return {
    id: node.id(),
    centre: node.getAbsolutePosition(),
    knob: transformer.findOne('.rotater').getAbsolutePosition(),
    rotation: transformer.rotation(),
    rect: node.getClientRect(),
  };
});

/** Pick the one panel from its row, unless it is picked already: a second press lets go. */
async function pickPanel(page) {
  const row = page.locator('.panel-row');
  if (!/\bselected\b/.test((await row.getAttribute('class')) ?? '')) await page.locator('.panel-thumb').click();
  await expect(row).toHaveClass(/selected/);
  await expect.poll(async () => (await selection(page))?.id ?? null).not.toBeNull();
}

/** Turn what is selected by its round knob, and wait for the page to settle around it. */
async function turnSelected(page, canvasBox, degrees) {
  const held = await selection(page);
  const radius = Math.hypot(held.knob.x - held.centre.x, held.knob.y - held.centre.y);
  const angle = (degrees * Math.PI) / 180;
  await page.mouse.move(canvasBox.x + held.knob.x, canvasBox.y + held.knob.y);
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + held.centre.x + radius * Math.sin(angle),
    canvasBox.y + held.centre.y - radius * Math.cos(angle),
    { steps: 10 },
  );
  await page.mouse.up();
  await settle(page);
}

/** Wait until the surface stops moving: a turn re-flows the page after the release. */
async function settle(page) {
  let last = null;
  await expect.poll(async () => {
    const rect = await page.evaluate(() => {
      const node = window.Konva.stages[0].findOne((one) => /^p[cg]-/.test(one.id() ?? '') && one.id() !== 'pg-page' && one.getParent()?.getClassName() === 'Layer');
      return node?.getClientRect() ?? null;
    });
    const still = rect && last && ['x', 'y', 'width', 'height'].every((key) => Math.abs(rect[key] - last[key]) < 0.5);
    last = rect;
    return still;
  }, { intervals: [120] }).toBe(true);
  return last;
}

const anchors = (page) => page.evaluate(() => Object.fromEntries(
  window.Konva.stages[0].findOne('#proof-crop-handles').find('.crop-anchor')
    .map((node) => [node.getAttr('cropKey'), node.getAbsolutePosition()]),
));

async function dragFromTo(page, canvasBox, from, to) {
  await page.mouse.move(canvasBox.x + from.x, canvasBox.y + from.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + to.x, canvasBox.y + to.y, { steps: 8 });
  await page.mouse.up();
}

/** Pull the corner marks in by a share of the box they frame, keeping its middle. */
async function cropInward(page, canvasBox, share) {
  const marks = await anchors(page);
  const dx = (marks.se.x - marks.nw.x) * share;
  const dy = (marks.se.y - marks.nw.y) * share;
  await dragFromTo(page, canvasBox, marks.nw, { x: marks.nw.x + dx, y: marks.nw.y + dy });
  const pulled = await anchors(page);
  await dragFromTo(page, canvasBox, pulled.se, { x: pulled.se.x - dx, y: pulled.se.y - dy });
}

async function save(page, fixture) {
  const count = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(count + 1);
  return fixture.proofSaves[count];
}

/**
 * The colours of the exported picture at the four inside corners of the panel's
 * box on the page, a few pixels in: page background where a turned picture
 * leaves its corners empty, picture where a cut took them away.
 */
async function exportedCorners(page, saved) {
  const box = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const layer = stage.getLayers()[0];
    const node = stage.findOne((one) => /^p[cg]-/.test(one.id() ?? '') && one.id() !== 'pg-page' && one.getParent() === layer);
    const page = layer.findOne('.bg');
    // a cut panel measures as its cut, an uncut one as the room its turned picture takes
    return { rect: node.getClientRect({ relativeTo: layer }), width: page.width(), height: page.height() };
  });
  const inset = 6;
  const points = [
    [box.rect.x + inset, box.rect.y + inset],
    [box.rect.x + box.rect.width - inset, box.rect.y + inset],
    [box.rect.x + box.rect.width - inset, box.rect.y + box.rect.height - inset],
    [box.rect.x + inset, box.rect.y + box.rect.height - inset],
  ].map(([x, y]) => [x / box.width, y / box.height]);
  const png = saved.png_base64.startsWith('data:') ? saved.png_base64 : `data:image/png;base64,${saved.png_base64}`;
  return page.evaluate(async ({ png, points }) => {
    const image = new Image();
    image.src = png;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * image.width), Math.round(y * image.height), 1, 1).data).slice(0, 3));
  }, { png, points });
}

const PAGE_BG = [13, 17, 23]; // composer.js BG, #0d1117
const isPage = (rgb) => rgb.every((value, index) => Math.abs(value - PAGE_BG[index]) < 12);

/** Serve one saved proof to the Open proof list, by the name it is listed under. */
async function serveProof(page, name, title, specOf) {
  await page.route(`**/api/cases/${CASE_ID}/proofs`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: [{ name, title, spec_path: `proofs/.meta/${name}.json`, updated_at: '2026-11-08T10:00:00Z' }],
    });
  });
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => {
    const asked = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (route.request().method() !== 'GET' || asked !== name) return route.fallback();
    return route.fulfill({ json: { ...specOf(), title } });
  });
}

async function openListed(page, title) {
  await page.locator('.tool-header').getByRole('button', { name: 'Open proof' }).click();
  await page.locator('.open-row', { hasText: title }).click();
  // the fixture's save leaves the proof marked unsaved, so leaving it may ask
  const ask = page.getByRole('alertdialog', { name: 'Leave this proof?' });
  const name = page.getByRole('textbox', { name: 'Proof name' });
  await expect.poll(async () => {
    if (await ask.isVisible()) await ask.getByRole('button', { name: 'Leave without saving' }).click();
    return name.inputValue();
  }).toBe(title);
  await expect.poll(() => page.evaluate(() => (
    window.Konva.stages[0].find((node) => node.id()?.startsWith('pg-') && node.id() !== 'pg-page').length
  ))).toBe(1);
}

test('a turned panel crops square to the page, keeps its marks, undoes, reopens and exports upright', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await serveProof(page, 'reopened', 'Reopened cut', () => fixture.proofSaves.at(-1).spec);
  await openProofWithPanel(page);
  const canvasBox = await page.locator('.konva canvas').first().boundingBox();

  await pickPanel(page);
  await turnSelected(page, canvasBox, 20);
  await page.keyboard.press('f');
  const turnedBox = await settle(page);

  // a box drawn right of the middle, where the cut will keep it
  await page.keyboard.press('r');
  const mark = { x: turnedBox.x + turnedBox.width * 0.56, y: turnedBox.y + turnedBox.height * 0.52 };
  await dragFromTo(page, canvasBox, mark, { x: mark.x + 24, y: mark.y + 18 });
  await expect(page.getByTitle('Select / move (v)')).toHaveAttribute('aria-pressed', 'true');
  const before = await save(page, fixture);
  const drawn = before.spec.shapes[0];
  expect(Math.abs(before.spec.panels[0].rotation)).toBeGreaterThan(10);
  expect(before.spec.panels[0]).not.toHaveProperty('crop');
  expect(before.spec.panels[0]).not.toHaveProperty('cut');
  // the turned picture leaves the corners of its upright room empty
  expect((await exportedCorners(page, before)).every(isPage)).toBe(true);

  // A double-click on the turned picture opens marks square on the page.
  await page.mouse.dblclick(
    canvasBox.x + turnedBox.x + turnedBox.width * 0.42,
    canvasBox.y + turnedBox.y + turnedBox.height * 0.45,
  );
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(8);
  const opened = await anchors(page);
  expect(Math.abs(opened.nw.y - opened.ne.y)).toBeLessThan(0.5);
  expect(Math.abs(opened.nw.x - opened.sw.x)).toBeLessThan(0.5);
  expect(Math.abs(opened.se.x - opened.ne.x)).toBeLessThan(0.5);

  await cropInward(page, canvasBox, 0.3);
  const pulled = await anchors(page);
  expect(Math.abs(pulled.nw.y - pulled.ne.y)).toBeLessThan(0.5);
  await page.keyboard.press('Enter');
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(0);
  await settle(page);

  // The selection holds the cut upright: its frame is square on the page.
  await pickPanel(page);
  const held = await selection(page);
  expect(held.id).toMatch(/^pc-/);
  expect(Math.abs(held.rotation)).toBeLessThan(1e-6);

  const cut = await save(page, fixture);
  const panel = cut.spec.panels[0];
  expect(panel.natural).toEqual([640, 360]); // the source file is untouched
  expect(panel.rotation).toBe(before.spec.panels[0].rotation);
  expect(panel).not.toHaveProperty('crop');
  expect(panel.cut.w).toBeGreaterThan(100);
  expect(panel.cut.h).toBeGreaterThan(60);
  // the mark stands on the same pixels: a cut moves no corner it is measured from
  expect(cut.spec.shapes[0]).toMatchObject({ x: drawn.x, y: drawn.y, w: drawn.w, h: drawn.h });
  // and the export is the picture right into the corners of the panel's box
  expect((await exportedCorners(page, cut)).some(isPage)).toBe(false);

  // Undo takes the cut back as one step, and redo puts it back.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await save(page, fixture)).spec.panels[0].cut ?? null).toBeNull();
  expect(fixture.proofSaves.at(-1).spec.shapes[0]).toMatchObject({ x: drawn.x, y: drawn.y });
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await save(page, fixture)).spec.panels[0].cut ?? null).toEqual(panel.cut);

  // Saved and opened again, it draws the same cut and saves it back unchanged.
  await openListed(page, 'Reopened cut');
  await settle(page);
  expect(await page.evaluate(() => !!window.Konva.stages[0].findOne((node) => node.id()?.startsWith('pc-')))).toBe(true);
  const reopened = await save(page, fixture);
  expect(reopened.spec.panels[0].cut).toEqual(panel.cut);
  expect(reopened.spec.panels[0].rotation).toBe(panel.rotation);
  expect(reopened.spec.shapes[0]).toMatchObject({ x: drawn.x, y: drawn.y });
  expect((await exportedCorners(page, reopened)).some(isPage)).toBe(false);
  expect(errors).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('a cut picture levels inside its cut on a small turn and goes round with a quarter turn', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const canvasBox = await page.locator('.konva canvas').first().boundingBox();
  await pickPanel(page);
  await turnSelected(page, canvasBox, 20);
  await page.keyboard.press('f');
  await settle(page);
  await page.getByRole('button', { name: 'Crop panel' }).click();
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(8);
  await cropInward(page, canvasBox, 0.25);
  await page.getByRole('button', { name: 'Crop panel' }).click();
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(0);
  await settle(page);
  const first = (await save(page, fixture)).spec.panels[0];

  // a few degrees more: the same cut, the picture turned under it
  await pickPanel(page);
  await turnSelected(page, canvasBox, 8);
  const levelled = (await save(page, fixture)).spec.panels[0];
  expect(levelled.rotation - first.rotation).toBeGreaterThan(5);
  expect([levelled.cut.w, levelled.cut.h]).toEqual([first.cut.w, first.cut.h]);

  // a quarter turn: the cut goes round with the picture
  await pickPanel(page);
  await turnSelected(page, canvasBox, 90);
  const sideways = (await save(page, fixture)).spec.panels[0];
  expect(sideways.rotation - levelled.rotation).toBeCloseTo(90, 0);
  expect([sideways.cut.w, sideways.cut.h]).toEqual([levelled.cut.h, levelled.cut.w]);
  fixture.expectNoUnexpectedRequests();
});

test('a quarter turn still crops along the picture, and Reset takes it back with the turn kept', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const canvasBox = await page.locator('.konva canvas').first().boundingBox();
  await pickPanel(page);
  await turnSelected(page, canvasBox, 90);
  await page.keyboard.press('f');
  await settle(page);
  await page.getByRole('button', { name: 'Crop panel' }).click();
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(8);
  await cropInward(page, canvasBox, 0.2);
  await page.keyboard.press('Enter');
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(0);
  const cropped = (await save(page, fixture)).spec.panels[0];
  expect(cropped.rotation).toBe(90);
  expect(cropped).not.toHaveProperty('cut');
  // a quarter turn swaps the sides: 20% off the page's width is 20% off the source's height
  expect(cropped.crop.w).toBeLessThan(640);
  expect(cropped.crop.h).toBeLessThan(360);

  await page.getByRole('button', { name: 'Reset panel crop' }).click();
  const reset = (await save(page, fixture)).spec.panels[0];
  expect(reset).not.toHaveProperty('crop');
  expect(reset).not.toHaveProperty('cut');
  expect(reset.rotation).toBe(90);
  fixture.expectNoUnexpectedRequests();
});

test('a proof saved turned and cropped before cuts opens, draws and saves exactly as it was', async ({ page }) => {
  // today's shape: the crop along the picture's own edges, turned with it
  const old = {
    azimut_proof: 1,
    ink: 'page',
    panels: [{
      id: 'p-old', src: 'media/panel.svg', caption: '', row: 0, scale: 1, x: null, y: null,
      natural: [640, 360], meta: { kind: 'media', source_urls: [] }, frame: null,
      crop: { x: 100, y: 50, w: 400, h: 250 }, rotation: 12,
    }],
    pastes: [],
    shapes: [{ id: 's-old', kind: 'rect', panel: 'p-old', x: 40, y: 30, w: 80, h: 50, color: '#ff5252', strokeWidth: 4 }],
  };
  const fixture = await installAppFixture(page);
  await serveProof(page, 'old-proof', 'Old proof', () => old);
  await page.goto('/#proof');
  await openListed(page, 'Old proof');
  await settle(page);

  // drawn on its own turned group, as before: no upright cut anywhere
  const drawn = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const group = stage.findOne('#pg-p-old');
    return { cut: !!stage.findOne('#pc-p-old'), rotation: group.rotation(), parent: group.getParent().getClassName() };
  });
  expect(drawn).toEqual({ cut: false, rotation: 12, parent: 'Layer' });
  const same = await save(page, fixture);
  expect(same.spec.panels[0]).toEqual(old.panels[0]);
  expect(same.spec.shapes).toEqual(old.shapes);

  // Its crop marks open square, and leaving them untouched keeps the crop it had.
  const canvasBox = await page.locator('.konva canvas').first().boundingBox();
  await showProofTab(page, 'Layout');
  await page.getByRole('button', { name: 'Crop panel' }).click();
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(8);
  const opened = await anchors(page);
  expect(Math.abs(opened.nw.y - opened.ne.y)).toBeLessThan(0.5);
  await page.keyboard.press('Enter');
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(0);
  expect((await save(page, fixture)).spec.panels[0]).toEqual(old.panels[0]);

  // Pulled in, it becomes a cut, and the mark stays on the same pixels of the picture.
  await page.getByRole('button', { name: 'Crop panel' }).click();
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(8);
  await cropInward(page, canvasBox, 0.1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => Object.keys(await anchors(page)).length).toBe(0);
  const cut = (await save(page, fixture)).spec;
  expect(cut.panels[0]).not.toHaveProperty('crop');
  expect(cut.panels[0].rotation).toBe(12);
  // the crop's corner is gone, so the mark is measured from the source's own corner
  expect(cut.shapes[0]).toMatchObject({ x: 140, y: 80 });
  fixture.expectNoUnexpectedRequests();
});
