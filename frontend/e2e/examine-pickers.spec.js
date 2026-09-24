import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

// Wide enough that the centred column leaves margins on both sides.
test.use({ viewport: { width: 1900, height: 700 } });

const manyImages = Array.from({ length: 60 }, (_, i) => ({
  path: `media/shot-${i}.png`,
  filename: `shot-${i}.png`,
  kind: 'image',
  width: 640,
  height: 360,
  size: 256,
  source: { type: 'upload' },
  thumbnail: null,
  folder: '',
}));

const manyCollages = Array.from({ length: 40 }, (_, i) => ({
  name: `collage-${i}`,
  title: `Collage ${i}`,
  pieces: 2,
  updated_at: '2026-09-20T10:00:00Z',
}));

/** Wheel over the empty margin left of the column: the heading has to move up. */
async function wheelInMargin(page, heading) {
  await expect(heading).toBeVisible();
  const tool = await page.locator('.tool').filter({ has: heading }).boundingBox();
  const before = await heading.boundingBox();
  expect(before.x - tool.x).toBeGreaterThan(80);
  await page.mouse.move(tool.x + (before.x - tool.x) / 2, tool.y + tool.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await heading.boundingBox()).y).toBeLessThan(before.y);
}

test('scrolls the Inspect picker from the margins beside it', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: manyImages });

  await page.goto('/#inspect');
  await wheelInMargin(page, page.getByRole('heading', { name: 'Open a file' }));
  fixture.expectNoUnexpectedRequests();
});

test('scrolls the Reverse Search picker, the same list, from the margins beside it', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: manyImages });

  await page.goto('/#reverse');
  await wheelInMargin(page, page.getByRole('heading', { name: 'Pick a picture' }));
  fixture.expectNoUnexpectedRequests();
});

test('scrolls the collage list from the margins beside it', async ({ page }) => {
  const fixture = await installAppFixture(page, { collages: manyCollages });

  await page.goto('/#collage');
  await wheelInMargin(page, page.getByRole('heading', { name: 'Collages' }));
  fixture.expectNoUnexpectedRequests();
});
