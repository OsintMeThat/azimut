import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, awaitMapReady, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

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

/** Where the surface sits and how close it is looked at, off its transform. */
const surface = (page) => page.locator('.surface').evaluate((el) => {
  const m = new DOMMatrix(getComputedStyle(el).transform);
  return { x: m.e, y: m.f, scale: m.a };
});

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

test('straightens from the bar over the canvas, each piece bent alike and kept apart', async ({ page }) => {
  await openStrip(page, { works: [] });
  let bent = null;
  await page.route(`**/api/cases/${CASE_ID}/inspect/straighten`, (route) => {
    bent = route.request().postDataJSON();
    // each piece's box on the bent canvas: where it lay, its columns moved
    const pieces = bent.nodes.map((n, i) => {
      const xs = n.quad.map(([x]) => x);
      const ys = n.quad.map(([, y]) => y);
      const box = [Math.min(...xs), Math.min(...ys) - 4, Math.max(...xs), Math.max(...ys) + 4].map(Math.round);
      return { item: { path: `media/Strip straightened ${i + 1}.png` }, box, entity: null, duplicate: false };
    });
    return route.fulfill({ json: { pieces } });
  });
  // once filed, the bent pictures are in the case beside the panel they were bent from
  await page.route(`**/api/cases/${CASE_ID}/media`, (route) => {
    if (!bent || route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [
      { path: PANEL_PATH, filename: 'panel.svg', kind: 'image', title: '', source: { type: 'upload' }, thumbnail: null },
      ...bent.nodes.map((_, i) => ({
        path: `media/Strip straightened ${i + 1}.png`, filename: `Strip straightened ${i + 1}.png`, kind: 'image',
        title: `Strip straightened ${i + 1}`, thumbnail: null,
        source: { type: 'inspect', op: 'collage', sources: [PANEL_PATH], times: [null], straightened: true },
      })),
    ] });
  });
  await page.route(`**/files/${CASE_ID}/media/Strip%20straightened*.png`, (route) => route.fulfill({
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
  expect(bent.bend).toHaveLength(bent.width);
  expect(bent.nodes.map((n) => n.label)).toEqual(['Strip straightened panel', 'Strip straightened panel']);
  await expect(page.locator('[data-guide="collage.straighten"]')).toContainText('straightened');
  await expect(page.locator('.level-line')).toHaveCount(0);
  // one picture per piece, each its own piece still
  await expect(page.locator('img.node')).toHaveCount(2);
  await page.locator('img.node').nth(1).click();
  await expect(page.locator('.identity .source')).toHaveText('Strip straightened 2');
  await expect(page.getByRole('button', { name: 'Rotate piece' })).toBeVisible();
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-straightened.png') });
});

test('cuts the collage to a frame, its pieces whole, and saves the picture cut to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { writes } = await openStrip(page, { works: [] });
  let composed = null;
  await page.route(`**/api/cases/${CASE_ID}/inspect/compose`, (route) => {
    composed = route.request().postDataJSON();
    return route.fulfill({ json: { item: { path: EXPORT }, entity: null, duplicate: false } });
  });

  await page.getByRole('button', { name: 'Cut' }).click();
  await expect(page.locator('.cut-cue')).toContainText('frame what the saved picture keeps');
  const bottom = await page.locator('[data-handle="s"]').boundingBox();
  const piece = await page.locator('img.node').first().boundingBox();
  // the ground cut off: the lower edge raised a third of the way up the pieces
  await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
  await page.mouse.down();
  await page.mouse.move(bottom.x + bottom.width / 2, piece.y + piece.height * 0.66, { steps: 6 });
  await page.mouse.up();
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-cutting.png') });
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.locator('.pieces.cut')).toHaveCount(1);
  await expect(page.locator('.cut-layer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cut' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => writes.at(-1)?.spec.clip?.h ?? null).not.toBeNull();
  const clip = writes.at(-1).spec.clip;
  expect(clip.h).toBeCloseTo(270 * 0.66 + 40 - 40, -1);
  // the pieces stay whole, each its own piece
  await page.locator('img.node').nth(1).click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.identity .source')).toHaveText('panel.svg');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-cut.png') });

  await page.locator('[data-guide="collage.save"] .press').click();
  await expect.poll(() => composed?.clip ?? null).not.toBeNull();
  expect(composed.height).toBeLessThan(composed.width / 4);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.pieces.cut')).toHaveCount(0);
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
  // where the piece sits on the canvas, whatever the view: a stitch also frames the pieces
  const left = async () => {
    const [box, wrap, at] = [await page.locator('img.node').nth(1).boundingBox(), await page.locator('.wrap').boundingBox(), await surface(page)];
    return Math.round((box.x - wrap.x - at.x) / at.scale);
  };
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
  await expect(page.locator('.scene-slot .time')).toHaveText('Whole video');
  await expect(page.getByTestId('collage-scene-state')).toHaveText('To geolocate');
  // its picture saved first, then the video marked whole
  expect(calls).toEqual(['compose', ['mark', { path: CLIP, label: '' }]]);

  await page.locator('.scene-slot').getByRole('button', { name: 'Geolocate' }).click();
  await expect(page).toHaveURL(/#satellite/);
  await awaitMapReady(page);
  await expect(page.locator('.ref-viewer')).toHaveCount(2);
});

test('draws each split button as one control, its arrow joined to its press', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openStrip(page, { works: [] });
  for (const group of ['[aria-label="Auto-stitch"]', '[data-guide="collage.save"] [aria-label="Save to case"]']) {
    const press = await page.locator(`${group} .press`).boundingBox();
    const arrow = await page.locator(`${group} .more`).boundingBox();
    expect(Math.abs(arrow.y - press.y), group).toBeLessThan(0.5);
    expect(Math.abs(arrow.height - press.height), group).toBeLessThan(0.5);
    // the arrow begins where the press ends, sharing its border
    expect(Math.abs(arrow.x - (press.x + press.width)), group).toBeLessThanOrEqual(1);
  }
  if (process.env.COLLAGE_SHOT) await page.getByRole('toolbar', { name: 'Collage tools' }).screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-split.png') });
});

test('opens a collage framed on its pieces, closer than the whole canvas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openStrip(page, { works: [] });
  await expect(page.getByRole('button', { name: 'Fit' })).toBeDisabled();
  const wrap = await page.locator('.wrap').boundingBox();
  // the pieces span 1040 of the 1200 px canvas, laid across the pane less a margin either side
  const whole = Math.min(wrap.width / 1200, wrap.height / 400);
  await expect.poll(async () => (await surface(page)).scale).toBeCloseTo(Math.min((wrap.width - 56) / 1040, (wrap.height - 56) / 270), 3);
  expect((await surface(page)).scale).toBeGreaterThan(whole);
  const [first, last] = [await page.locator('img.node').first().boundingBox(), await page.locator('img.node').nth(1).boundingBox()];
  expect(Math.abs((first.x - wrap.x) - (wrap.x + wrap.width - (last.x + last.width)))).toBeLessThan(2);
});

test('outlines the pieces a stitch left out, saying why, in hand for the arrows, and frames the pieces', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openStrip(page, { works: [] });
  await page.route(`**/api/cases/${CASE_ID}/inspect/auto-stitch`, (route) => route.fulfill({ json: {
    nodes: [{ index: 0, quad: [[100, 60], [580, 60], [580, 330], [100, 330]], op: null }],
    dropped: [1],
    why: ['no-detail'],
    canvas: { width: 1200, height: 400 },
  } }));

  await page.getByRole('button', { name: /^Auto-stitch/ }).click();
  await expect(page.getByText('Stitched 1. The outlined piece stays where it was: nothing to match, blank or painted out')).toBeVisible();
  await expect(page.locator('img.node.unstitched')).toHaveCount(1);
  await expect(page.getByTestId('piece-left-out')).toHaveText('Nothing to match: blank or painted out');
  await expect(page.locator('.identity .source')).toHaveText('panel.svg');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-left-out.png') });
  // Fit frames the pieces as the stitch left them
  await expect(page.getByRole('button', { name: 'Fit' })).toBeDisabled();

  const left = async () => (await page.locator('img.node').nth(1).boundingBox()).x;
  const before = await left();
  const { scale } = await surface(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(left).toBeCloseTo(before + 11 * scale, 0);
  await expect(page.locator('img.node.unstitched')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fit' })).toBeEnabled();
});

test('pans on two fingers and zooms on a pinch, the mouse wheel zooming too', async ({ page, browserName }) => {
  await openStrip(page, { works: [] });
  const wrap = await page.locator('.wrap').boundingBox();
  await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + wrap.height / 2);
  const start = await surface(page);

  await page.mouse.wheel(40, 0);
  await expect.poll(async () => (await surface(page)).x).toBeCloseTo(start.x - 40, 0);
  expect((await surface(page)).scale).toBeCloseTo(start.scale, 5);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -8);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await surface(page)).scale).toBeGreaterThan(start.scale);
  await expect(page.locator('.zoom')).toBeVisible();

  if (browserName === 'chromium') {
    // a mouse notch (Firefox's arrives in lines, which this browser cannot send), once
    // the touchpad's gesture is over
    await page.waitForTimeout(300);
    const before = (await surface(page)).scale;
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await surface(page)).scale).toBeCloseTo(before * 1.1, 3);
  }
});

test('paints areas out of a piece\'s stitch, kept with the collage and sent with the next stitch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { writes } = await openStrip(page, { works: [] });
  let asked = null;
  await page.route(`**/api/cases/${CASE_ID}/inspect/auto-stitch`, (route) => {
    asked = route.request().postDataJSON();
    return route.fulfill({ json: { nodes: [], dropped: [0, 1], canvas: null } });
  });

  await page.getByRole('button', { name: 'Ignore areas' }).click();
  await expect(page.locator('.brush-cue')).toContainText('Auto-stitch does not match there');
  const box = await page.locator('img.node').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + box.width * (0.3 + i * 0.04), box.y + box.height * 0.5);
  await page.mouse.up();
  await expect(page.locator('[data-testid="piece-paint"] polyline')).toHaveCount(1);
  await expect(page.locator('.selection .ignored')).toContainText('1 area kept out of auto-stitch');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-brush.png') });

  // kept in the collage, never in what it exports
  await expect.poll(() => writes.at(-1)?.spec.nodes[0].exclude?.length ?? 0).toBe(1);
  const [stroke] = writes.at(-1).spec.nodes[0].exclude;
  expect(stroke.points.length).toBeGreaterThan(2);
  expect(stroke.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  expect(writes.at(-1).spec.nodes[1]).not.toHaveProperty('exclude');

  await page.getByRole('button', { name: /^Auto-stitch/ }).click();
  await expect.poll(() => asked).not.toBeNull();
  expect(asked.exclude).toEqual([writes.at(-1).spec.nodes[0].exclude, null]);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-testid="piece-paint"]')).toHaveCount(0);
  await expect(page.getByTestId('piece-ignored')).toHaveCount(1);
});

test('changes the moment its collage was marked over, the video playing it beside the fields', async ({ page }) => {
  const VIDEO = 'media/steps.webm';
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#38bdf8"/></svg>';
  const piece = (id, x, time) => ({ ...panel(id, x), save: { path: VIDEO, time, ops: [] } });
  const pan = { name: 'Pan', title: 'Pan', spec: { width: 1200, height: 400, transparent: true, nodes: [piece('nd_1', 40, 0.2), piece('nd_2', 600, 0.6)] } };
  await installAppFixture(page, {
    media: [{ path: VIDEO, filename: 'steps.webm', kind: 'video', title: 'Steps', source: { type: 'upload' }, thumbnail: null }],
    collages: [{ name: 'Pan', title: 'Pan', pieces: 2, updated_at: '2026-09-20T10:00:00Z', outline: null }],
  });
  let draft = { kind: 'draft', video: VIDEO, id: 'sc_1', start: 0.2, end: 0.6, label: '', state: 'todo', captures: [], abandoned: null, file_kind: 'video' };
  let written = null;
  await page.route(`**/api/cases/${CASE_ID}/collages`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { name: body.name ?? body.title, title: body.title } });
  });
  await page.route(`**/api/cases/${CASE_ID}/collages/Pan`, (route) => route.fulfill({ json: pan }));
  await page.route(`**/api/cases/${CASE_ID}/collages/Pan/thumb`, (route) => route.fulfill({ json: { thumb: '.collages/Pan.webp' } }));
  await page.route(`**/api/cases/${CASE_ID}/inspect/render-preview`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: SVG }));
  await page.route(`**/api/cases/${CASE_ID}/inspect/probe?*`, (route) => route.fulfill({ json: { kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 } }));
  await page.route(`**/files/${CASE_ID}/${VIDEO}`, (route) => serveRange(route, STEPS_WEBM, 'video/webm'));
  await page.route(`**/api/cases/${CASE_ID}/scenes?*`, (route) => route.fulfill({ json: {
    video: VIDEO, scenes: [draft], taken: [], used: {}, geolocating: null,
    collages: [{ collage: 'Pan', title: 'Pan', export: null, current: false, times: [0.2, 0.6], start: 0.2, end: 0.6 }],
  } }));
  await page.route(`**/api/cases/${CASE_ID}/inspect/work?*`, (route) => route.fulfill({ json: { work: { name: 'Steps', title: 'Steps', spec: {
    source: { path: VIDEO, kind: 'video' }, frames: [], marks: [], videoAdjust: {}, videoRotation: 0,
    scenes: [{ id: 'sc_1', start: draft.start, end: draft.end, label: '' }],
  } } } }));
  await page.route(`**/api/cases/${CASE_ID}/scenes/sc_1/time`, (route) => {
    written = route.request().postDataJSON();
    const before = { start: draft.start, end: draft.end };
    draft = { ...draft, start: written.start, end: written.end };
    return route.fulfill({ json: { before } });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/#collage');
  await page.getByRole('button', { name: /^Pan/ }).click();
  const time = page.locator('.scene-slot .time');
  await expect(page.locator('.scene-slot')).toContainText('In scene · 0:00–0:00');
  await expect(page.getByTestId('collage-moment')).toHaveCount(0);

  await time.click();
  const editor = page.getByTestId('collage-moment');
  await expect(editor.getByTestId('scene-player').locator('video')).toHaveAttribute('src', /steps\.webm$/);
  await expect(editor.locator('.bar .dot')).toHaveCount(2);
  await expect(editor.getByTestId('scene-band')).toHaveCount(1);
  await expect(editor.getByRole('radio', { name: 'Passage' })).toHaveAttribute('aria-checked', 'true');
  if (process.env.COLLAGE_SHOT) await page.screenshot({ path: process.env.COLLAGE_SHOT.replace('.png', '-moment.png') });

  await editor.getByRole('textbox', { name: 'Scene start' }).fill('0:00.4');
  await editor.getByRole('textbox', { name: 'Scene end' }).fill('0:01');
  await editor.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => written).toEqual({ video: VIDEO, start: 0.4, end: 1 });
  await expect(editor).toHaveCount(0);
  await expect(page.getByText('Scene now 0:00–0:01')).toBeVisible();
});
