import { expect, test } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * The home page and the guide, in a real browser.
 *
 * `Overview.render.test.js` and `GuideDialog.render.test.js` cover each on its own.
 * This covers what a DOM with no layout cannot answer: that the map of the case comes
 * up on the free imagery and puts the points where they are, that the guide's pictures
 * load as the build ships them, and that the `?` and Home both open it over the tools,
 * through the topbar, `lib/navigate.js` and the dialog the shell mounts.
 */

const summary = {
  total: 148,
  by_type: { media: 82, place: 31, claim: 18, person: 12 },
  by_status: { confirmed: 136, suggested: 12 },
  by_folder: { work: 96 },
  by_source: {},
  linked_to: {},
  unlinked: 4,
  countable: 0,
};

// Two located files a few hundred metres apart, one north-west of the other:
// the home map draws the case's footage, which is what it is built on.
const mediaIndex = [
  { id: 'm1', key: 'm1@49.9951,36.2304', kind: 'media', media_kind: 'image', title: 'North gate', lat: 49.9951, lon: 36.2304 },
  { id: 'm2', key: 'm2@49.9889,36.2401', kind: 'media', media_kind: 'video', title: 'Depot roof', lat: 49.9889, lon: 36.2401 },
];

test('draws the case on the free imagery, and presses through to the map', async ({ page }) => {
  const tiles = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/tiles/')) tiles.push(pathname);
  });
  await installAppFixture(page, { mediaIndex, summary });
  await page.goto('/#overview');

  await awaitMapReady(page);
  // The one basemap it may ever ask for: keyless and unmetered, so arriving on the
  // home page cannot spend anybody's quota however many cases are opened.
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  // asked one at a time or many at once (a free provider's tiles come in batches)
  expect(tiles.every((path) => path.startsWith('/api/tiles/esri-world-imagery/') || path === '/api/tiles/batch/esri-world-imagery')).toBe(true);
  // whose terms are met the way the Map tool meets them: the credit line, in full
  await expect(page.locator('.plate')).toContainText('Browser fixture');

  await page.locator('.plate .foot').click();
  expect(page.url()).toContain('#satellite');
});

test('the ? opens the guide over the tab it was pressed from', async ({ page }) => {
  await installAppFixture(page, { mediaIndex, summary });
  await page.goto('/#media');

  await page.locator('.topbar button[title="Guide: Media"]').click();
  const guide = page.getByRole('dialog', { name: 'Guide' });
  await expect(guide.locator('.tabs .tab[aria-current="page"]')).toHaveText('Media');
  // the picture the guide ships, drawn, with a frame lit from the line being read
  await expect.poll(() => guide.locator('.shot img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await guide.locator('.legend .mark').nth(2).hover();
  await expect(guide.locator('.frame.on')).toHaveCount(1);

  // a number that leads somewhere shows the screen it opens, and comes back
  await guide.locator('.pin.leads').first().click();
  await expect(guide.locator('.trail')).toContainText('Open in…');
  await expect.poll(() => guide.locator('.shot img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await guide.locator('.trail button').first().click();
  await expect(guide.locator('.trail')).toHaveCount(0);

  // the tool behind it never moved, and Escape leaves it there
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  expect(page.url()).toContain('#media');
});

test('a journey walks across the tools and opens the one it stops on', async ({ page }) => {
  await installAppFixture(page, { mediaIndex, summary });
  await page.goto('/#overview');

  // Home sends somebody new to the start of it
  await page.locator('.canvas-body').getByRole('button', { name: /Read the guide/ }).click();
  const guide = page.getByRole('dialog', { name: 'Guide' });
  await expect(guide.locator('.menu .entry[aria-current="page"]')).toHaveText('Start here');

  await guide.locator('.menu .entry', { hasText: 'Geolocate a photo' }).click();
  for (let step = 0; step < 3; step += 1) await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.locator('.steps .step[aria-current="step"]')).toContainText('Satellite');
  await guide.getByRole('button', { name: 'Open Satellite' }).click();
  await expect(guide).toHaveCount(0);
  expect(page.url()).toContain('#satellite');
});

test('a version opens with its welcome tied to the ?, until it is told not to', async ({ page }) => {
  await installAppFixture(page, { mediaIndex, summary, welcome: true });
  await page.goto('/#media');

  const welcome = page.getByRole('dialog', { name: /^Azimut/ });
  await expect(welcome.locator('.version')).toHaveText('0.2.8');
  await welcome.evaluate((card) => Promise.all(card.getAnimations().map((a) => a.finished)));
  // it sits in the middle, the topbar's own `?` lit through the veil
  const view = page.viewportSize();
  const card = await welcome.boundingBox();
  expect(Math.abs(card.x + card.width / 2 - view.width / 2)).toBeLessThan(2);
  expect(Math.abs(card.y + card.height / 2 - view.height / 2)).toBeLessThan(2);
  const mark = await page.locator('.topbar button[title="Guide: Media"]').boundingBox();
  const lit = await page.locator('.welcome .lit').boundingBox();
  expect(Math.abs(lit.x + lit.width / 2 - (mark.x + mark.width / 2))).toBeLessThan(2);
  // and a line runs from the card's edge to just under that button
  const ends = await page.locator('.welcome .trail').evaluate((path) => {
    const at = (s) => path.getPointAtLength(s);
    return [at(0), at(path.getTotalLength())].map(({ x, y }) => ({ x, y }));
  });
  expect(Math.abs(ends[0].x - (card.x + card.width))).toBeLessThan(2);
  expect(Math.abs(ends[1].x - (mark.x + mark.width / 2))).toBeLessThan(2);
  expect(ends[1].y).toBeGreaterThan(mark.y + mark.height);
  expect(ends[1].y).toBeLessThan(card.y);

  // closed without the tick, it goes into the `?`, and a reload does not bring it
  // back: a reload is not a start
  await welcome.getByRole('button', { name: 'Close' }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-guide="media.card"]').first()).toBeVisible();
  await expect(welcome).toHaveCount(0);

  // the next start shows it again; ticked, the lit `?` opens the guide on the tool
  const next = await page.context().newPage();
  await installAppFixture(next, { mediaIndex, summary, welcome: true });
  await next.goto('/#media');
  const again = next.getByRole('dialog', { name: /^Azimut/ });
  await again.locator('.mute input').check();
  await next.locator('.welcome .lit').click();
  await expect(next.getByRole('dialog', { name: 'Guide' }).locator('.tabs .tab[aria-current="page"]')).toHaveText('Media');

  // and the start after that keeps quiet on this version
  const third = await page.context().newPage();
  await installAppFixture(third, { mediaIndex, summary, welcome: true });
  await third.goto('/#media');
  await expect(third.locator('[data-guide="media.card"]').first()).toBeVisible();
  await expect(third.getByRole('dialog', { name: /^Azimut/ })).toHaveCount(0);
});
