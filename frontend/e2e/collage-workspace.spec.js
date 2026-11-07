import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, awaitMapReady, installAppFixture } from './app.fixture.js';

// The Collage tool laid out for a laptop: what acts on the whole collage in a bar over
// the canvas, the save on top of the panel, the piece in hand at its foot, so nothing
// the analyst presses sits below the fold or moves when a selection comes and goes.

const EXPORT = 'media/Strip.png';
const panel = (id, x) => ({
  id, frameId: null, save: { path: PANEL_PATH, time: null, ops: [] },
  w: 640, h: 360, quad: [[x, 40], [x + 480, 40], [x + 480, 310], [x, 310]], frameOps: [], crop: null,
});
const strip = {
  name: 'Strip', title: 'Strip',
  spec: { width: 1200, height: 400, transparent: true, nodes: [panel('nd_1', 40), panel('nd_2', 600)] },
};
const manyWorks = Array.from({ length: 40 }, (_, i) => ({
  name: `clip-${i}`, title: `clip_${String(i).padStart(2, '0')}_8f3a.mp4`, source: `media/clip-${i}.mp4`, frames: 3, kind: 'video',
}));

async function openStrip(page, { works = manyWorks } = {}) {
  const fixture = await installAppFixture(page, {
    inspectWorks: works,
    collages: [{ name: 'Strip', title: 'Strip', pieces: 2, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  const writes = [];
  await page.route(`**/api/cases/${CASE_ID}/collages`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    writes.push(body);
    return route.fulfill({ json: { name: body.name ?? body.title, title: body.title } });
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip`, (route) => route.fulfill({ json: strip }));
  await page.route(`**/api/cases/${CASE_ID}/collages/Strip/thumb`, (route) => route.fulfill({ json: { thumb: '.collages/Strip.webp' } }));
  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Strip/ }).click();
  await expect(page.getByRole('textbox', { name: 'Collage name' })).toHaveValue('Strip');
  await expect(page.locator('img.node')).toHaveCount(2);
  return { fixture, writes };
}

test('keeps every act in view on a laptop, and nothing moves when a piece is picked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openStrip(page);

  const save = page.locator('[data-guide="collage.save"] .press');
  const pieces = page.locator('[data-guide="collage.add"]');
  for (const control of [
    save,
    page.getByRole('button', { name: /^Auto-stitch/ }),
    page.getByRole('button', { name: 'Draw the line' }),
    page.getByRole('button', { name: 'Fit' }),
  ]) await expect(control).toBeInViewport();
  await expect(page.locator('.group-head')).toHaveCount(40);

  const before = { save: await save.boundingBox(), pieces: await pieces.boundingBox(), foot: await page.locator('.panel .selection').boundingBox() };
  await page.locator('img.node').first().click();
  await expect(page.locator('.identity .source')).toHaveText('panel.svg');
  await expect(page.getByRole('button', { name: 'Remove' })).toBeInViewport();
  const after = { save: await save.boundingBox(), pieces: await pieces.boundingBox(), foot: await page.locator('.panel .selection').boundingBox() };
  expect(after).toEqual(before);

  await page.locator('img.node').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.identity .source')).toHaveText('2 pieces selected');
  expect(await page.locator('.panel .selection').boundingBox()).toEqual(before.foot);
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-laptop.png') });
});

test('saves in one press under its name, and unfolds the name, folder and note on its arrow', async ({ page }) => {
  const { fixture } = await openStrip(page, { works: [] });
  let composed = null;
  await page.route(`**/api/cases/${CASE_ID}/inspect/compose`, (route) => {
    composed = route.request().postDataJSON();
    return route.fulfill({ json: { item: { path: EXPORT }, entity: null, duplicate: false } });
  });

  await page.getByRole('button', { name: 'Name, folder and note' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Strip');
  await expect(page.getByRole('textbox', { name: 'Note' })).toBeVisible();
  await page.getByRole('button', { name: 'Name, folder and note' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);

  await expect(page.locator('[data-guide="collage.save"]')).toContainText('Exports at');
  await page.locator('[data-guide="collage.save"] .press').click();
  await expect.poll(() => composed?.label).toBe('Strip');
  expect(composed).toMatchObject({ collage: 'Strip', notes: null });
  fixture.expectNoUnexpectedRequests();
});

test('straightens from the bar over the canvas, as it did from the panel', async ({ page }) => {
  await openStrip(page, { works: [] });
  let bent = null;
  await page.route(`**/api/cases/${CASE_ID}/inspect/compose`, (route) => {
    bent = route.request().postDataJSON();
    return route.fulfill({ json: { item: { path: 'media/Strip straightened.png' }, box: [0, 0, bent.width, bent.height], entity: null } });
  });
  await page.route(`**/files/${CASE_ID}/media/Strip%20straightened.png`, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#38bdf8"/></svg>',
  }));

  await page.getByRole('button', { name: 'Draw the line' }).click();
  await expect(page.locator('.level-cue')).toContainText('along something level that crosses the view');
  const box = await page.locator('img.node').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await page.keyboard.press('Enter');
  await expect(page.locator('.level-cue')).toHaveCount(0);
  await expect(page.locator('.level-line circle:not(.grab)')).toHaveCount(2);

  await page.getByRole('button', { name: 'Straighten', exact: true }).click();
  await expect.poll(() => Array.isArray(bent?.bend)).toBe(true);
  await expect(page.locator('[data-guide="collage.straighten"]')).toContainText('straightened');
  await expect(page.locator('.level-line')).toHaveCount(0);
});

test('stitches from its press, and takes the stitch back from its message', async ({ page }) => {
  await openStrip(page, { works: [] });
  await page.route(`**/api/cases/${CASE_ID}/inspect/auto-stitch`, (route) => route.fulfill({ json: {
    nodes: [
      { index: 0, quad: [[100, 60], [580, 60], [580, 330], [100, 330]], op: null },
      { index: 1, quad: [[420, 70], [900, 70], [900, 340], [420, 340]], op: null },
    ],
    dropped: [],
    canvas: { width: 1200, height: 400 },
  } }));
  const left = async () => (await page.locator('img.node').nth(1).boundingBox()).x;
  const before = await left();

  await page.getByRole('button', { name: 'More ways to stitch' }).click();
  await page.getByRole('menuitemradio', { name: /Planar/ }).click();
  await expect(page.getByRole('button', { name: /^Auto-stitch/ })).toContainText('Planar');
  await page.getByRole('button', { name: /^Auto-stitch/ }).click();
  await expect(page.getByText('Stitched 2 pieces')).toBeVisible();
  await expect.poll(left).not.toBe(before);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(left).toBe(before);
});

test('opens an empty collage on its ways in', async ({ page }) => {
  await installAppFixture(page, { inspectWorks: manyWorks.slice(0, 2) });
  await page.route(`**/api/cases/${CASE_ID}/collages`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback()));
  await page.goto('/#collage');
  await page.getByRole('button', { name: 'New collage' }).click();

  const card = page.locator('.empty-canvas');
  await expect(card).toContainText('Add frames from a video, or pictures');
  await card.getByRole('button', { name: 'Images' }).click();
  await expect(page.locator('.picker [role="tab"].on')).toHaveText('Images');
  await card.getByRole('button', { name: 'Frames' }).click();
  await expect(page.locator('.picker [role="tab"].on')).toHaveText('Frames');
  await expect(page.getByRole('button', { name: /^Auto-stitch/ })).toBeDisabled();
});

test('marks a collage of one video, then geolocates it with the collage beside the video', async ({ page }) => {
  const CLIP = 'media/clip.mp4';
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#38bdf8"/></svg>';
  const piece = (id, x, time) => ({ ...panel(id, x), save: { path: CLIP, time, ops: [] } });
  const pan = { name: 'Pan', title: 'Pan', spec: { width: 1200, height: 400, transparent: true, nodes: [piece('nd_1', 40, 1.2), piece('nd_2', 600, 3.6)] } };
  await installAppFixture(page, {
    media: [
      { path: PANEL_PATH, filename: 'panel.svg', kind: 'image', title: 'Panel', source: { type: 'upload' }, thumbnail: null },
      { path: CLIP, filename: 'clip.mp4', kind: 'video', title: 'Convoy clip', source: { type: 'upload' }, thumbnail: null },
    ],
    collages: [{ name: 'Pan', title: 'Pan', pieces: 2, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  const calls = [];
  let scenes = [];
  await page.route(`**/api/cases/${CASE_ID}/collages`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { name: body.name ?? body.title, title: body.title } });
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Pan`, (route) => route.fulfill({ json: pan }));
  await page.route(`**/api/cases/${CASE_ID}/collages/Pan/thumb`, (route) => route.fulfill({ json: { thumb: '.collages/Pan.webp' } }));
  await page.route(`**/api/cases/${CASE_ID}/inspect/render-preview`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: SVG }));
  await page.route(`**/files/${CASE_ID}/media/Pan.png`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: SVG }));
  await page.route(`**/api/cases/${CASE_ID}/inspect/compose`, (route) => {
    calls.push('compose');
    return route.fulfill({ json: { item: { path: 'media/Pan.png' }, entity: null, duplicate: false } });
  });
  await page.route(`**/api/cases/${CASE_ID}/scenes?*`, (route) => route.fulfill({ json: {
    video: CLIP, scenes, taken: [], used: {}, geolocating: null,
    collages: [{ collage: 'Pan', title: 'Pan', export: 'media/Pan.png', current: true, times: [1.2, 3.6], start: 1.2, end: 3.6 }],
  } }));
  await page.route(`**/api/cases/${CASE_ID}/scenes/mark`, (route) => {
    calls.push(['mark', route.request().postDataJSON()]);
    scenes = [{ kind: 'draft', video: CLIP, id: 'sc_1', start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null, file_kind: 'video' }];
    return route.fulfill({ json: { scene: { ...scenes[0] } } });
  });
  await page.route(`**/api/cases/${CASE_ID}/geolocating`, (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    calls.push('geolocate');
    return route.fulfill({ json: { geolocating: { video: CLIP, id: 'sc_1', start: null, end: null, label: '', order: 0, captures: [], file_kind: 'video' } } });
  });

  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Pan/ }).click();
  await expect(page.locator('.panel .from')).toContainText('From Convoy clip');
  await expect(page.locator('.panel .from')).toContainText('0:01–0:03');

  await page.getByRole('button', { name: 'Mark to geolocate' }).click();
  await expect(page.locator('.scene-slot .where')).toHaveText('Whole video');
  await expect(page.getByTestId('collage-scene-state')).toHaveText('To geolocate');
  // its picture saved first, then the video marked whole
  expect(calls).toEqual(['compose', ['mark', { path: CLIP, label: '' }]]);

  await page.locator('.scene-slot').getByRole('button', { name: 'Geolocate' }).click();
  await expect(page).toHaveURL(/#satellite/);
  await awaitMapReady(page);
  await expect(page.locator('.ref-viewer')).toHaveCount(2);
});
