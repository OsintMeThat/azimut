import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

// A street drawn in flat colours, 480 × 270: a building, a red sign, a green vehicle.
const SCENE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAeAAAAEOBAMAAACjtNlUAAAAFVBMVEXw5tKqoIweWjxcVEY6SlzIPDIoKDA85/QRAAABgUlEQVR42u3cwQ2CMBQGYFAcgA2MEziEKzClFxdxBVbAuwe8ePIAKaTQ+L53hqZf/qbhQUN9q2LVoQIGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgaeqKbMabUr7h1fEgYGBgYGBgYGBgYGBv6T9vBb70fK1Z2EgYGBgYGBgYGBgYGBM7WHz2WjHq8SBgYGBt5gl965Tp2EgYGBgYGBgYGBgYGBI7eHg4SBgYGBgYHDP3j8vCZOO/spYWBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGDgoquAY0t9ekrnrcB3SxoYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBg4TjVZfi8wDlknvWb4ma+HF0saGBgYGBgYGBgYGBg4Rj+8/xRaCQMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwOXXR/vPBFo6jRrFQAAAABJRU5ErkJggg==', 'base64');
const SCENE = 'media/scene.png';

test.use({ viewport: { width: 1500, height: 820 } });

/** The fixture with one picture, and Inspect's routes answered the way the server does. */
async function openScene(page) {
  const fixture = await installAppFixture(page, {
    media: [{
      path: SCENE, filename: 'scene.png', title: 'Street', kind: 'image', entity_id: 'e_scene',
      size: SCENE_PNG.length, source: { type: 'upload' }, thumbnail: null, folder: '',
    }],
  });
  const renders = [];
  const saves = [];
  // Registered after the fixture, so these answer first.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${SCENE}`) return route.fulfill({ contentType: 'image/png', body: SCENE_PNG });
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'image', width: 480, height: 270 });
    if (path === `/api/cases/${CASE_ID}/scenes`) return json({ video: null, scenes: [] });
    if (path === `/api/cases/${CASE_ID}/media/item`) return json({ kind: 'image', size: SCENE_PNG.length, sha256: 'ab'.repeat(32), source: { type: 'upload' } });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && request.method() === 'GET') return json({ work: null });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && request.method() === 'PUT') {
      saves.push(request.postDataJSON());
      return json({ name: 'Street', title: 'Street' });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) {
      renders.push(request.postDataJSON());
      return route.fulfill({ contentType: 'image/png', body: SCENE_PNG });
    }
    return route.fallback();
  });

  await page.goto('/#inspect');
  await page.locator('.card', { hasText: 'Street' }).click();
  const picture = page.locator('.viewport img').first();
  await expect.poll(() => picture.evaluate((img) => img.complete && img.naturalWidth)).toBe(480);
  return { fixture, renders, saves, picture };
}

const zoneCuts = (renders) => renders.filter((body) => body.ops.at(-1)?.op === 'crop').map((body) => body.ops.at(-1).params);

test('searches the part of the picture drawn over it, cut from the file and filed nowhere', async ({ page }) => {
  const { fixture, renders, picture } = await openScene(page);
  await page.keyboard.press('r');
  const bar = page.getByRole('toolbar', { name: 'Search a zone' });
  await expect(bar).toContainText('Drag over what to search');
  await expect(page.getByRole('button', { name: 'Search a zone' })).toHaveAttribute('aria-pressed', 'true');

  // the red sign: 300–420 across, 60–110 down
  const box = await picture.boundingBox();
  const at = (fx, fy) => [box.x + fx * box.width, box.y + fy * box.height];
  await page.mouse.move(...at(0.6, 0.2));
  await page.mouse.down();
  await page.mouse.move(...at(0.75, 0.3), { steps: 4 });
  await page.mouse.move(...at(0.9, 0.42), { steps: 4 });
  await page.mouse.up();

  await expect(bar.getByRole('link')).toHaveText(['Google Lens', 'Yandex', 'Bing', 'TinEye']);
  await expect(bar).toContainText('144 × 59 px');
  await expect.poll(() => zoneCuts(renders).length).toBe(1);
  const [cut] = zoneCuts(renders);
  expect(cut.x).toBeCloseTo(0.6, 2);
  expect(cut.y).toBeCloseTo(0.2, 2);
  expect(cut.w).toBeCloseTo(0.3, 2);
  expect(cut.h).toBeCloseTo(0.22, 2);
  expect(renders.at(-1)).toMatchObject({ path: SCENE, time: null });

  // the drag drew the zone: the view neither panned nor zoomed
  await expect(page.getByRole('button', { name: 'Fit' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('takes the whole picture, and gives way to a crop', async ({ page }) => {
  const { renders } = await openScene(page);
  await page.getByRole('tab', { name: 'Analyze' }).click();
  await page.getByRole('button', { name: 'Reverse image search' }).click();
  const bar = page.getByRole('toolbar', { name: 'Search a zone' });
  await bar.getByRole('button', { name: 'Whole picture' }).click();
  await expect(bar).toContainText('480 × 270 px');
  await expect(bar.getByRole('button', { name: 'Whole picture' })).toHaveCount(0);
  await expect.poll(() => zoneCuts(renders)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);

  await page.getByRole('tab', { name: 'Adjust' }).click();
  await page.getByRole('button', { name: 'Crop region' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search a zone' })).toHaveCount(0);
});
