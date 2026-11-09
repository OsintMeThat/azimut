// A zoom inset held in place, and the marks drawn over its enlargement, which
// belong to it and follow it once it moves.
import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, canvasSettled, installAppFixture, openProofWithPanel } from './app.fixture.js';

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

/** The first picture on screen: its id, its middle and its size. */
const firstPicture = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('.panel-hit'));
  const c = stage.container().getBoundingClientRect();
  const hit = stage.find('.panel-hit')[0];
  const r = hit.getClientRect();
  return { id: hit.getParent().id().slice(3), x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2, w: r.width, h: r.height };
});

/** A node's middle on screen, by id. */
const middleOf = (page, id) => page.evaluate((nodeId) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${nodeId}`));
  const c = stage.container().getBoundingClientRect();
  const r = stage.findOne(`#${nodeId}`).getClientRect();
  return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
}, id);

/** A zoom inset framed on the picture's upper right, its enlargement in the far corner. */
async function drawInset(page, fixture) {
  const picture = await firstPicture(page);
  await page.keyboard.press('z');
  const frame = { x: picture.x + picture.w / 3, y: picture.y - picture.h / 3 };
  await drag(page, { x: frame.x - 15, y: frame.y - 10 }, { x: frame.x + 15, y: frame.y + 10 });
  const [zoom] = (await save(page, fixture)).shapes;
  expect(zoom.kind).toBe('zoom');
  return { picture, zoom, frame };
}

const insetRow = (page) => page.locator('.shape-row').filter({ hasText: 'Zoom inset' });

test('a locked inset stays put under a drag, takes marks drawn over it, and they follow it once it moves', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { zoom, frame } = await drawInset(page, fixture);

  // held from its row in the side list, which says so
  await insetRow(page).getByTitle('Lock position').click();
  await expect(insetRow(page).getByTitle('Unlock position')).toHaveAttribute('aria-pressed', 'true');
  let spec = await save(page, fixture);
  expect(spec.shapes[0]).toMatchObject({ id: zoom.id, locked: true, dx: zoom.dx, dy: zoom.dy });

  // a drag on the enlargement, or on its frame, moves nothing and picks nothing
  await page.keyboard.press('v');
  await canvasSettled(page);
  const enlargement = await middleOf(page, zoom.id);
  await drag(page, enlargement, { x: enlargement.x + 50, y: enlargement.y + 40 });
  await drag(page, { x: frame.x + 15, y: frame.y }, { x: frame.x + 60, y: frame.y + 30 });
  await expect(page.locator('.shape-row.selected')).toHaveCount(0);
  spec = await save(page, fixture);
  expect(spec.shapes[0]).toMatchObject({ x: zoom.x, y: zoom.y, dx: zoom.dx, dy: zoom.dy });
  expect(await middleOf(page, zoom.id)).toEqual(enlargement);

  // drawing over it works, and the box is the inset's
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: enlargement.x - 15, y: enlargement.y - 10 }, { x: enlargement.x + 15, y: enlargement.y + 10 });
  spec = await save(page, fixture);
  const box = spec.shapes[1];
  expect(box).toMatchObject({ kind: 'rect', panel: zoom.id });

  // the right-click lets it go
  await page.keyboard.press('v');
  await canvasSettled(page);
  await page.mouse.click(enlargement.x + 25, enlargement.y + 15, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Unlock' }).click();
  await expect(insetRow(page).getByTitle('Lock position')).toHaveAttribute('aria-pressed', 'false');

  // moved, it carries its box along, which keeps its own place on it
  const boxBefore = await middleOf(page, box.id);
  await canvasSettled(page);
  await drag(page, { x: enlargement.x + 25, y: enlargement.y + 15 }, { x: enlargement.x - 15, y: enlargement.y + 35 });
  spec = await save(page, fixture);
  expect(spec.shapes[0].locked).toBeUndefined();
  expect(spec.shapes[0].dx).not.toBeCloseTo(zoom.dx, 0);
  expect(spec.shapes[1]).toMatchObject({ panel: zoom.id, x: box.x, y: box.y, w: box.w, h: box.h });
  const boxAfter = await middleOf(page, box.id);
  expect(boxAfter.x - boxBefore.x).toBeCloseTo(-40, -1);
  expect(boxAfter.y - boxBefore.y).toBeCloseTo(20, -1);

  // and the right-click holds it again
  await canvasSettled(page);
  const moved = await middleOf(page, zoom.id);
  await page.mouse.click(moved.x + 25, moved.y + 15, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Lock position' }).click();
  spec = await save(page, fixture);
  expect(spec.shapes[0].locked).toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('a picked locked inset offers nothing to pull, and arrow keys leave it where it is', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { zoom } = await drawInset(page, fixture);
  await insetRow(page).getByTitle('Lock position').click();
  await insetRow(page).click();
  await expect(insetRow(page)).toHaveClass(/selected/);
  await canvasSettled(page);
  const ui = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('Transformer'));
    return {
      anchors: stage.findOne('Transformer').enabledAnchors().length,
      handles: stage.find('.endh').length,
      hint: stage.find('.lock-hint').length,
    };
  });
  expect(ui).toEqual({ anchors: 0, handles: 0, hint: 1 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const spec = await save(page, fixture);
  expect(spec.shapes[0]).toMatchObject({ x: zoom.x, y: zoom.y, dx: zoom.dx, dy: zoom.dy, locked: true });
  fixture.expectNoUnexpectedRequests();
});

// A proof saved before marks could belong to an inset: a box free on the page, over
// the enlargement, which has to stay exactly where it was.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#3c3c3c"/></svg>`;
const OLD_ZOOM = { id: 'z-old', panel: 'p1', kind: 'zoom', color: '#ff5252', strokeWidth: 4, x: 400, y: 60, w: 60, h: 40, iw: 150, dx: -300, dy: 150 };
const OLD_BOX = { id: 'r-old', panel: 'page', kind: 'rect', color: '#40c4ff', strokeWidth: 4, x: 540, y: 300, w: 60, h: 30 };
const OLD = {
  azimut_proof: 1, ink: 'page', title: 'Old inset', notes: {}, legendOrder: [], pastes: [],
  panels: [{ id: 'p1', src: PANEL_PATH, caption: '', row: 0, scale: 1, natural: [640, 360] }],
  shapes: [OLD_ZOOM, OLD_BOX],
  points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null, material: [],
};

test('an old proof keeps a box free on the page over its inset, where it was', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === `/files/${CASE_ID}/${PANEL_PATH}`) return route.fulfill({ contentType: 'image/svg+xml', body: SVG });
    if (route.request().method() === 'GET' && /\/api\/cases\/[^/]+\/proofs\/old-inset$/.test(url.pathname)) return json(OLD);
    if (url.pathname === `/api/cases/${CASE_ID}/entities/lookup`) {
      return json({ entity: { id: 'e_old', type: 'proof', label: 'Old inset', attrs: { spec: 'proofs/.meta/old-inset.json', path: 'proofs/old-inset.png' } } });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = 'old-inset';
  });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Old inset');
  await canvasSettled(page);

  // the box is over the enlargement, drawn where it was stored, on the page
  const placed = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('#r-old'));
    const box = stage.findOne('#r-old');
    const inset = stage.findOne('#z-old').getClientRect({ relativeTo: stage.getLayers()[0] });
    return { x: box.x(), y: box.y(), parent: box.getParent().id(), inset };
  });
  expect(placed).toMatchObject({ x: OLD_BOX.x, y: OLD_BOX.y, parent: 'pg-page' });
  expect(placed.inset.x).toBeLessThan(OLD_BOX.x);
  expect(placed.inset.x + placed.inset.width).toBeGreaterThan(OLD_BOX.x + OLD_BOX.w);
  expect(placed.inset.y).toBeLessThan(OLD_BOX.y);
  expect(placed.inset.y + placed.inset.height).toBeGreaterThan(OLD_BOX.y + OLD_BOX.h);

  await page.getByRole('textbox', { name: 'Proof name' }).fill('Old inset again');
  const spec = await save(page, fixture);
  expect(spec.shapes).toEqual([OLD_ZOOM, OLD_BOX]);
});
