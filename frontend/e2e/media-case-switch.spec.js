import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

const SECOND_CASE = 'browser-test-b';
const MEDIA_PATH = 'media/shared.jpg';
const THUMB_PATH = 'media/.thumbs/shared.svg';
const THUMB_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="320" height="200" fill="#4f8f67"/>
  </svg>`;

function mediaPage(title) {
  return {
    items: [{
      path: MEDIA_PATH,
      filename: 'shared.jpg',
      title,
      kind: 'image',
      width: 320,
      height: 200,
      size: 128,
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      source: { type: 'upload' },
      thumbnail: THUMB_PATH,
      thumb_state: 'ready',
      enrich_state: 'ready',
      folder: '',
      notes: '',
    }],
    next_cursor: null,
    total: 1,
    facets: {
      category_counts: { image: 1, upload: 1 },
      folder_counts: {},
      gps_count: 0,
      thumbnail_pending: 0,
    },
  };
}

test('reloads a same-path thumbnail when switching cases', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: SECOND_CASE, name: 'Case B', scratch: false, folders: [] },
    ],
  });

  let releaseFirstThumbnail;
  let firstThumbnailStarted;
  const firstStarted = new Promise((resolve) => (firstThumbnailStarted = resolve));
  let firstThumbnailSettled;
  const firstSettled = new Promise((resolve) => (firstThumbnailSettled = resolve));

  await page.route('**/api/cases/*/media/page*', async (route) => {
    const caseId = new URL(route.request().url()).pathname.split('/')[3];
    const pageBody = mediaPage(caseId === CASE_ID ? 'Case A image' : 'Case B image');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(pageBody),
    });
  });
  await page.route('**/files/*/media/.thumbs/shared.svg', async (route) => {
    const caseId = new URL(route.request().url()).pathname.split('/')[2];
    if (caseId === CASE_ID) {
      firstThumbnailStarted();
      await new Promise((resolve) => (releaseFirstThumbnail = resolve));
      try {
        await route.fulfill({ status: 404, body: '' });
      } catch {
        // Changing src may cancel the old request before its delayed response.
      } finally {
        firstThumbnailSettled();
      }
      return;
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: THUMB_SVG });
  });

  await page.goto('/#media');
  await expect(page.getByText('Case A image', { exact: true })).toBeVisible();
  await firstStarted;

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();
  await expect(page.getByText('Case B image', { exact: true })).toBeVisible();
  const currentThumb = page.locator('.media-card img');
  await expect(currentThumb).toHaveAttribute(
    'src',
    `/files/${SECOND_CASE}/${THUMB_PATH}`
  );

  releaseFirstThumbnail();
  await firstSettled;
  await expect(currentThumb).toBeVisible();
  await expect.poll(
    () => currentThumb.evaluate((image) => image.complete && image.naturalWidth > 0)
  ).toBe(true);
  fixture.expectNoUnexpectedRequests();
});
