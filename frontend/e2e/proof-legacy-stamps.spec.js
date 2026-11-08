import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * A proof saved before the stamps were redrawn. It names all eleven old stamps, with
 * the fields it could carry, and has to open with every one in its place, size,
 * colour and turn, draw the new drawing, export it, and save the same fields back.
 */

// Each stamp its own colour, so the export can answer for each of them.
const OLD = [
  ['point', '#ff0000', {}],
  ['impact', '#00ff00', { rotation: 15 }],
  ['vehicle', '#0000ff', { strokeWidth: 4 }],
  ['truck', '#ffff00', { strokeWidth: 8, rotation: -30 }],
  ['tank', '#ff00ff', { strokeWidth: 2 }],
  ['person', '#00ffff', { strokeWidth: 4, fillOpacity: 1 }],
  ['building', '#ff8000', { strokeWidth: 4, fillOpacity: 0.3 }],
  ['drone', '#8000ff', { strokeWidth: 6 }],
  ['camera', '#00ff80', { strokeWidth: 4 }],
  ['antenna', '#ff0080', { strokeWidth: 3 }],
  ['nord', '#80ff00', { size: 80 }],
];

const shapes = OLD.map(([name, color, extra], i) => ({
  id: `old-${name}`, panel: 'p1', kind: 'icon', name, color,
  x: 60 + (i % 4) * 150, y: 60 + Math.floor(i / 4) * 120, size: 56, ...extra,
}));
// a view cone draws the camera stamp on its badge
const cone = { id: 'old-cone', panel: 'p1', kind: 'cone', color: '#00a0ff', x: 500, y: 300, rotation: 40, reach: 90, fov: 60 };

const spec = {
  azimut_proof: 1, ink: 'page', title: 'Old stamps', notes: {}, legendOrder: [], pastes: [],
  panels: [{ id: 'p1', src: PANEL_PATH, caption: '', row: 0, scale: 1, natural: [640, 360] }],
  shapes: [...shapes, cone],
  points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null, material: [],
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#3c3c3c"/></svg>`;

const nodesOnStage = (page) => page.evaluate((ids) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('Transformer'));
  return ids.map((id) => {
    const node = stage.findOne(`#${id}`);
    if (!node) return { id, missing: true };
    const painted = node.getChildren().filter((c) => c.opacity() > 0 && c.getClassName() !== 'Rect');
    return {
      id, x: node.x(), y: node.y(), rotation: node.rotation(),
      painted: painted.length,
      paths: painted.filter((c) => c.getClassName() === 'Path' && c.data().length > 20).length,
    };
  });
}, shapes.map((s) => s.id));

const pixelsNear = (page, base64, rgb) => page.evaluate(async ({ base64, rgb }) => {
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
    if (Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]) < 30) count++;
  }
  return count;
}, { base64, rgb });

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

async function openOldProof(page) {
  const fixture = await installAppFixture(page);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === `/files/${CASE_ID}/${PANEL_PATH}`) return route.fulfill({ contentType: 'image/svg+xml', body: SVG });
    if (route.request().method() === 'GET' && /\/api\/cases\/[^/]+\/proofs\/old-stamps$/.test(url.pathname)) return json(spec);
    if (url.pathname === `/api/cases/${CASE_ID}/entities/lookup`) {
      return json({ entity: { id: 'e_old', type: 'proof', label: 'Old stamps', attrs: { spec: 'proofs/.meta/old-stamps.json', path: 'proofs/old-stamps.png' } } });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = 'old-stamps';
  });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Old stamps');
  await expect(page.locator('.panel-row')).toHaveCount(1);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return fixture;
}

test('opens a proof naming all eleven old stamps, each in its place and turn, each drawn', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openOldProof(page);

  const nodes = await nodesOnStage(page);
  expect(nodes.filter((n) => n.missing)).toEqual([]);
  for (const [i, stored] of shapes.entries()) {
    expect(nodes[i].x).toBeCloseTo(stored.x);
    expect(nodes[i].y).toBeCloseTo(stored.y);
    expect(nodes[i].rotation).toBeCloseTo(stored.rotation ?? 0);
    expect(nodes[i].paths, stored.name).toBeGreaterThan(0);
  }
  await expect(page.locator('.shape-row')).toHaveCount(12);
  expect(errors).toEqual([]);
});

test('exports every old stamp in its colour and saves the same fields back', async ({ page }) => {
  const fixture = await openOldProof(page);

  await page.getByRole('textbox', { name: 'Proof name' }).fill('Old stamps again');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  const [saved] = fixture.proofSaves;

  expect(saved.spec.shapes.filter((s) => s.kind === 'icon')).toEqual(shapes);
  for (const [name, color, extra] of OLD) {
    // on a solid disc the glyph goes white and the disc carries the colour
    const count = await pixelsNear(page, saved.png_base64, rgbOf(color));
    expect(count, `${name} in ${color}${extra.fillOpacity ? ' on its disc' : ''}`).toBeGreaterThan(30);
  }
});

test('leaves the view cone its camera, drawn on its badge', async ({ page }) => {
  await openOldProof(page);
  const camera = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('Transformer'));
    const cone = stage.findOne('#old-cone');
    const paths = cone.find('Path');
    return paths.map((p) => p.data().length);
  });
  expect(camera).toHaveLength(1);
  expect(camera[0]).toBeGreaterThan(100);
});
