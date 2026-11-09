import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, showProofTab } from './app.fixture.js';

/**
 * Importing a published proof: the post's picture becomes the proof as it was
 * published, with no background, margins or footer of Azimut's round it, and it is
 * kept with the proof rather than added to Media. Marks can still be drawn over it.
 */

const TOKEN = '0123456789ab';
const POST_URL = 'https://x.com/geo/status/1';
const SOURCE_URL = 'https://instagram.com/reels/D1';
const NAME = 'harbour-strike';
const ASSET = '0a1b2c3d4e5f6071.png';
const PICTURE_ID = 'u1a2b3c4';
// One flat colour, so a pixel read off the export says whose it is.
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#c0392b"/></svg>`;

const STAGED = { filename: 'harbour.png', kind: 'image', size: 2048, sha256: 'b'.repeat(64), source: { type: 'download', url: POST_URL } };
const POST = {
  url: POST_URL,
  title: 'Harbour strike',
  text: `Geolocated: 10.393313, -66.892504 ${SOURCE_URL}`,
  coords: [{ lat: 10.393313, lon: -66.892504, text: '10.393313, -66.892504', format: 'decimal' }],
  urls: [SOURCE_URL],
};
const SPEC = {
  azimut_proof: 1, ink: 'page', title: NAME,
  published: [{ id: PICTURE_ID, asset: ASSET, natural: [640, 360], url: POST_URL }],
  panels: [], pastes: [], shapes: [], notes: {}, legendOrder: [],
  points: [{ coords: '10.393313, -66.892504', label: '', pov: false }],
  description: null, when: null, sources: [SOURCE_URL], material: [],
};

/** The import routes, answered the way the server does: the picture held, the footage
 *  behind a dead link, and a proof that keeps the picture as published. */
async function importRoutes(page) {
  const seen = { saves: [], filed: [] };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const imports = `/api/cases/${CASE_ID}/proof-imports`;
    if (path === imports && request.method() === 'POST') return json({ token: TOKEN });
    if (path === `${imports}/${TOKEN}/fetch`) {
      return json({ job_id: request.postDataJSON().slot === 'panel' ? 'job-picture' : 'job-footage' });
    }
    if (path === '/api/jobs/job-picture') {
      return json({ status: 'done', progress: {}, result: { slot: 'panel', staged: STAGED, held: [STAGED], post: POST } });
    }
    if (path === '/api/jobs/job-footage') return json({ status: 'error', error: 'that address could not be reached' });
    if (path === `${imports}/${TOKEN}/preview`) {
      return json({
        ready: true, blocking: [],
        entities: [
          { slot: 'place', type: 'place', label: '10°23′N 66°53′W', state: 'new', detail: 'country resolved after creation' },
          { slot: 'proof', type: 'proof', label: NAME, state: 'new', detail: 'the picture as published, not added to Media' },
        ],
        links: [{ from: 'proof', to: 'place', type: 'depicts', label: 'shows' }],
        warnings: [{ code: 'no-source-media', text: 'The source was not downloaded, so the proof will carry its address and no file.' }],
      });
    }
    if (path === `${imports}/${TOKEN}/commit`) {
      return json({ proof: { name: NAME, png: `proofs/${NAME}.png`, id: `e_${NAME}` }, place: { id: 'p1', label: '10°23′N 66°53′W' } });
    }
    if (path === `${imports}/${TOKEN}` && request.method() === 'DELETE') return json({ discarded: true });
    if (path === `/files/${CASE_ID}/media/.dl/${TOKEN}/harbour.png`
      || path === `/files/${CASE_ID}/proofs/.meta/${NAME}.assets/${ASSET}`) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PICTURE });
    }
    if (path === `/api/cases/${CASE_ID}/proofs/${NAME}` && request.method() === 'GET') return json(SPEC);
    if (path === `/api/cases/${CASE_ID}/proofs` && request.method() === 'POST') {
      seen.saves.push(request.postDataJSON());
      return json({ id: `e_${NAME}`, name: NAME, title: NAME, png: `proofs/${NAME}.png`, thumb: null });
    }
    // anything that would file a picture in the case
    if (/\/api\/cases\/[^/]+\/(media\/(upload|import|paste)|ingest)/.test(path)) seen.filed.push(path);
    return route.fallback();
  });
  return seen;
}

/** A saved export, read in the page: its size and the colour of one of its pixels. */
async function pixelOf(page, base64, x, y) {
  return page.evaluate(async ({ data, x, y }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { width: img.naturalWidth, height: img.naturalHeight, rgba: [...ctx.getImageData(x, y, 1, 1).data] };
  }, { data: base64, x, y });
}

test.use({ viewport: { width: 1280, height: 800 } });

test('a published proof comes in as the picture it was, and adds nothing to Media', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const seen = await importRoutes(page);
  await page.goto('/#proof');
  const header = page.locator('.tool-header');
  await header.getByRole('button', { name: 'New proof', exact: true }).click();
  await page.getByRole('button', { name: 'Import a published proof' }).click();

  const dialog = page.getByRole('dialog', { name: 'Import a proof' });
  await expect(dialog).toContainText('The picture becomes the proof as it was published, and is not added to Media.');
  await dialog.getByPlaceholder('https://…').fill(POST_URL);
  await dialog.getByRole('button', { name: 'Fetch' }).click();
  // The picture is shown whole, named for what it becomes.
  await expect(dialog.locator('.import-view img')).toHaveAttribute('src', new RegExp(`media/\\.dl/${TOKEN}/harbour\\.png$`));
  await expect(dialog.locator('.import-view-bar')).toContainText('Proof: as published, not added to Media');

  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.locator('.import-report')).toContainText('the picture as published, not added to Media');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);

  // Open in Geo Proof as the picture, with its facts on the Proof tab.
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue(NAME);
  const tabs = page.getByRole('tablist', { name: 'Proof settings' });
  await expect(tabs.getByRole('tab', { name: 'Proof' })).toHaveAttribute('aria-selected', 'true');
  await showProofTab(page, 'Layout');
  await expect(page.locator('.published-row')).toHaveCount(1);
  await expect(page.locator('.panel-row:not(.published-row)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add panel' })).toHaveCount(0);
  await showProofTab(page, 'Style');
  await expect(page.getByText('Shown as it was published, so it has no background, margins, footer or signature.')).toBeVisible();
  await expect(page.getByText('House style')).toHaveCount(0);

  // No frame: the export is the picture at its own size, its corner the picture's colour.
  await header.getByRole('button', { name: 'Save proof' }).click();
  await expect.poll(() => seen.saves.length).toBe(1);
  const plain = seen.saves[0];
  expect(plain.spec.published).toEqual(SPEC.published);
  expect(plain.spec.panels).toEqual([]);
  expect(plain.assets).toEqual([]);
  expect(await pixelOf(page, plain.png_base64, 1, 1)).toEqual({ width: 640, height: 360, rgba: [192, 57, 43, 255] });

  // A mark drawn over it belongs to the picture, and the export stays the picture's size.
  await page.getByRole('button', { name: 'Box (r)' }).click();
  const canvas = page.locator('.konva').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 5 });
  await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
  await page.mouse.up();
  await header.getByRole('button', { name: 'Save proof' }).click();
  await expect.poll(() => seen.saves.length).toBe(2);
  const marked = seen.saves[1];
  expect(marked.spec.shapes).toHaveLength(1);
  expect(marked.spec.shapes[0]).toMatchObject({ kind: 'rect', panel: PICTURE_ID });
  const corner = await pixelOf(page, marked.png_base64, 1, 1);
  expect(corner).toEqual({ width: 640, height: 360, rgba: [192, 57, 43, 255] });
  const shape = marked.spec.shapes[0];
  const stroke = await pixelOf(page, marked.png_base64, Math.round(shape.x), Math.round(shape.y + shape.h / 2));
  expect(stroke.rgba).not.toEqual([192, 57, 43, 255]);

  // Media holds what it held before the import, and nothing filed the picture.
  await page.evaluate(() => { window.location.hash = '#media'; });
  await expect(page.locator('.media-card')).toHaveCount(1);
  await expect(page.locator('.media-card', { hasText: /harbour/i })).toHaveCount(0);
  expect(seen.filed).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});
