import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A file of the Media library dragged onto a folder of the case sidebar.
 *
 * Reported from the field: pulling a thumbnail toward a folder raised the
 * library's import overlay, the folder took nothing, the overlay stayed up
 * after the button was let go, and the next drop offered to import the
 * thumbnail as a new file.
 */
const THUMB_PATH = 'media/.thumbs/quai.svg';
const THUMB_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="320" height="200" fill="#4f8f67"/>
  </svg>`;

const quai = {
  path: 'media/quai.jpg',
  filename: 'quai.jpg',
  title: 'Quay at dawn',
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
};

async function libraryWithFolders(page) {
  const fixture = await installAppFixture(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: ['Energodar', 'Fronte'] }],
    media: [quai],
  });
  const writes = [];
  await page.route(`**/files/${CASE_ID}/${THUMB_PATH}`, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: THUMB_SVG })
  );
  await page.route(`**/api/cases/${CASE_ID}/media`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } })
  );
  await page.goto('/#media');
  await expect(page.locator('.media-card img')).toBeVisible();
  return { fixture, writes };
}

const folderRow = (page, name) => page.locator('.tree .frow').filter({ has: page.locator('.fname', { hasText: name }) });

test('a thumbnail dragged onto a sidebar folder is filed there, with no import overlay left behind', async ({ page }) => {
  const { fixture, writes } = await libraryWithFolders(page);

  await page.locator('.media-card img').dragTo(folderRow(page, 'Energodar'));

  await expect.poll(() => writes).toEqual([{ path: 'media/quai.jpg', folder: 'Energodar' }]);
  await expect(page.getByText('Filed in Energodar')).toBeVisible();
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect(page.getByText('Import 1 file')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a picture dragged over the library raises no import overlay, held or let go', async ({ page }) => {
  const { fixture, writes } = await libraryWithFolders(page);

  const from = await page.locator('.media-card img').boundingBox();
  const to = await page.locator('.media-card .body').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('.media-card.dragging')).toHaveCount(1);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await page.mouse.up();

  await expect(page.locator('.media-card.dragging')).toHaveCount(0);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await expect(page.getByText('Import 1 file')).toHaveCount(0);
  expect(writes).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});
