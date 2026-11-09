import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * Vehicle models on a proof: picked from the grouped picker, stamped at the view in
 * hand, turned and tilted on the ring, saved as two extra fields and drawn into the
 * exported picture.
 */

const liveStage = () => window.Konva.stages.find((s) => s.container().isConnected && s.findOne('Transformer'));

const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));

/** Where the ring's knobs stand on screen: `turn` the accent one, `tilt` the white one. */
const knobs = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('Transformer'));
  const box = stage.container().getBoundingClientRect();
  const read = (node) => {
    const at = node.getAbsolutePosition();
    return { x: box.left + at.x, y: box.top + at.y };
  };
  const list = stage.find('.endh');
  const tilt = list.find((n) => n.fill() === '#ffffff');
  const turn = list.find((n) => n.fill() !== '#ffffff');
  return { turn: turn ? read(turn) : null, tilt: tilt ? read(tilt) : null };
});

/** Pixels of the saved picture close to `rgb`, from its base64. */
const pixelsNear = (page, base64, rgb, reach = 60) => page.evaluate(async ({ base64, rgb, reach }) => {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]) < reach) count++;
  }
  return count;
}, { base64, rgb, reach });

async function stampAt(page, name, x, y) {
  await page.getByTitle('Symbol (s)').click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.mouse.click(x, y);
}

test('offers the icons grouped, with the models drawn at the view in hand', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);

  await page.getByTitle('Symbol (s)').click();
  const picker = page.locator('.flyout-icons');
  for (const group of ['Marks', 'Vehicles', 'Events', 'Places', 'People']) {
    await expect(picker.getByRole('heading', { name: group, exact: true })).toBeVisible();
  }
  // the flat stamps say so, the models carry the name
  await expect(picker.getByRole('button', { name: 'Tank, flat', exact: true })).toBeVisible();
  const tank = picker.getByRole('button', { name: 'Tank', exact: true });
  await expect(tank.locator('svg path').first()).toBeAttached();
  const top = await tank.innerHTML();

  // the view changes how the tiles draw, and stays in the picker's foot
  await picker.getByRole('radio', { name: 'Angled' }).click();
  await expect.poll(() => tank.innerHTML()).not.toBe(top);
  await expect(picker.getByRole('radio', { name: 'Angled' })).toHaveAttribute('aria-checked', 'true');

  // the whole picker stays on screen, however low its button sits
  const box = await picker.boundingBox();
  const window = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(window.height);
});

test('stamps a model at the picked view, in its colour, and draws it into the saved picture', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await page.locator('.konva canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await stampAt(page, 'Tank', cx - 80, cy);
  await expect(page.locator('.shape-row')).toHaveCount(1);
  await expect(page.locator('.shape-row').first()).toContainText('Tank');

  await page.getByTitle('Symbol (s)').click();
  await page.locator('.flyout-icons').getByRole('radio', { name: 'Side' }).click();
  await page.locator('.flyout-icons').getByRole('button', { name: 'Helicopter', exact: true }).click();
  await page.mouse.click(cx + 80, cy);
  await expect(page.locator('.shape-row')).toHaveCount(2);
  await settle(page);

  await page.getByTitle('Select / move (v)').click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const [saved] = fixture.proofSaves;
  const stamps = saved.spec.shapes.filter((s) => s.kind === 'icon');
  expect(stamps.map((s) => [s.name, s.heading, s.tilt])).toEqual([['model-tank', 0, 0], ['model-heli', 90, 84]]);
  // no stroke width: a model has no line to widen
  expect(stamps.every((s) => !('strokeWidth' in s))).toBe(true);
  // the shaded body in the stamp's colour reached the export
  const inked = await pixelsNear(page, saved.png_base64, [255, 82, 82], 70);
  expect(inked).toBeGreaterThan(40);
  fixture.expectNoUnexpectedRequests();
});

test('turns and tilts a picked model on its ring, one undo per drag', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await page.locator('.konva canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await stampAt(page, 'Truck', cx, cy);
  await page.getByTitle('Select / move (v)').click();
  await page.locator('.shape-row').first().click();
  await settle(page);

  // the turn knob stands at the heading, the nose straight up; dragged a quarter
  // round the ring it lands on the 5° step
  const before = await knobs(page);
  expect(before.turn).not.toBeNull();
  expect(before.tilt).not.toBeNull();
  const r = cy - before.turn.y;
  const toward = { x: cx + r * Math.sin(Math.PI / 2 + 0.02), y: cy - r * Math.cos(Math.PI / 2 + 0.02) };
  await page.mouse.move(before.turn.x, before.turn.y);
  await page.mouse.down();
  await page.mouse.move(toward.x, toward.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  await page.waitForTimeout(450); // the history takes a drag once the document rests

  // the arc's white knob tilts from the top view down to a side view
  const after = await knobs(page);
  expect(after.turn.x).toBeGreaterThan(cx);
  const arc = Math.hypot(after.tilt.x - cx, after.tilt.y - cy);
  const low = { x: cx + arc * Math.sin((105 * Math.PI) / 180), y: cy - arc * Math.cos((105 * Math.PI) / 180) };
  await page.mouse.move(after.tilt.x, after.tilt.y);
  await page.mouse.down();
  await page.mouse.move(low.x, low.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  await page.waitForTimeout(450);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const tilted = fixture.proofSaves[0].spec.shapes[0];
  expect(tilted.heading).toBe(90);
  expect(tilted.tilt).toBeGreaterThan(70);

  // one undo takes the tilt back and leaves the turn
  await page.getByTitle(/^Undo/).click();
  await settle(page);
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(2);
  const undone = fixture.proofSaves[1].spec.shapes[0];
  expect(undone.heading).toBe(90);
  expect(undone.tilt).toBe(0);
  fixture.expectNoUnexpectedRequests();
});

test('takes the ring away with the hand on another tool', async ({ page }) => {
  await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await page.locator('.konva canvas').first().boundingBox();
  await stampAt(page, 'Truck', box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTitle('Select / move (v)').click();
  await page.locator('.shape-row').first().click();
  await settle(page);
  expect((await knobs(page)).turn).not.toBeNull();
  await page.getByTitle('Box (r)').click();
  await settle(page);
  expect((await knobs(page)).turn).toBeNull();
});

test('puts a model and a glyph on a disc when the stamp has a fill', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await page.locator('.konva canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await stampAt(page, 'Fire', cx - 70, cy);
  await stampAt(page, 'Car', cx + 70, cy);
  await settle(page);
  await page.getByTitle('Select / move (v)').click();
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const names = fixture.proofSaves[0].spec.shapes.map((s) => s.name);
  expect(names).toEqual(['badge-flame', 'model-car']);
  expect(await pixelsNear(page, fixture.proofSaves[0].png_base64, [255, 82, 82], 40)).toBeGreaterThan(40);
  expect(errors).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

// A proof saved before the stamps stored their view: its model has no heading or tilt.
const OLD_MODEL = { id: 'old-tank', panel: 'p1', kind: 'icon', name: 'model-tank', color: '#ff5252', x: 320, y: 180, size: 56 };
const OLD_SPEC = {
  azimut_proof: 1, ink: 'page', title: 'Old model', notes: {}, legendOrder: [], pastes: [],
  panels: [{ id: 'p1', src: PANEL_PATH, caption: '', row: 0, scale: 1, natural: [640, 360] }],
  shapes: [OLD_MODEL],
  points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null, material: [],
};

test('a model saved without a view keeps drawing from above, whatever view the picker holds', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === `/files/${CASE_ID}/${PANEL_PATH}`) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#3c3c3c"/></svg>' });
    }
    if (route.request().method() === 'GET' && /\/api\/cases\/[^/]+\/proofs\/old-model$/.test(url.pathname)) return json(OLD_SPEC);
    if (url.pathname === `/api/cases/${CASE_ID}/entities/lookup`) {
      return json({ entity: { id: 'e_old', type: 'proof', label: 'Old model', attrs: { spec: 'proofs/.meta/old-model.json', path: 'proofs/old-model.png' } } });
    }
    return route.fallback();
  });
  await openProofWithPanel(page);
  // the picker's view set to Side for the session
  await page.getByTitle('Symbol (s)').click();
  await page.locator('.flyout-icons').getByRole('radio', { name: 'Side' }).click();
  await page.keyboard.press('Escape');
  await page.getByTitle('Select / move (v)').click();
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = 'old-model';
  });
  const replace = page.getByRole('alertdialog');
  if (await replace.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await replace.getByRole('button').last().click();
  }
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Old model');
  await settle(page);
  const drawn = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('#old-tank'));
    const model = stage.findOne('#old-tank').findOne('.model-view');
    return { heading: model.getAttr('viewHeading'), tilt: model.getAttr('viewTilt') };
  });
  expect(drawn).toEqual({ heading: 0, tilt: 0 });
  await page.getByRole('textbox', { name: 'Proof name' }).fill('Old model again');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  expect(fixture.proofSaves[0].spec.shapes).toEqual([OLD_MODEL]);
});
