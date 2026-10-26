import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture, PANEL_PATH } from './app.fixture.js';

/**
 * The Add reference picker over the real map. A case that ran Detect and
 * Compare holds more renders than shots, and the shot to geolocate has to stay
 * one or two clicks away: the working files start held back, a chip is one
 * press, and the narrowing picked is still there the next time.
 */

const item = (title, kind, source, path) => ({
  path: path ?? `media/${title}.${kind === 'video' ? 'mp4' : 'png'}`,
  filename: `${title}.${kind === 'video' ? 'mp4' : 'png'}`,
  title,
  kind,
  source,
  thumbnail: null,
  folder: '',
});

const MEDIA = [
  // The one picked below is the fixture's served image, so the window can load it.
  item('Gate', 'image', { type: 'upload' }, PANEL_PATH),
  item('Roof', 'image', { type: 'upload' }),
  item('Checkpoint', 'image', { type: 'clipboard' }),
  item('Crowd', 'image', { type: 'upload' }),
  item('Strike', 'video', { type: 'download' }),
  item('Convoy', 'video', { type: 'download' }),
  item('Launch', 'video', { type: 'download' }),
  item('Small change', 'image', { type: 'compare' }),
  item('Comparison 12', 'image', { type: 'compare' }),
  item('15.73, 45.02', 'image', { type: 'satellite' }),
  item('Collage 4', 'image', { type: 'inspect', op: 'collage' }),
];

test('narrows the reference picker to collected media, one type per click', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: MEDIA });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  const rail = page.getByRole('button', { name: 'Add reference' });
  const dialog = page.getByRole('dialog', { name: 'Add reference' });
  const tiles = dialog.locator('.ref-pick');
  const chip = (name) => dialog.getByRole('button', { name });

  await rail.click();
  await expect(tiles).toHaveCount(7);

  await chip(/^Videos 3/).click();
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first()).toHaveAttribute('title', 'Strike');

  await chip(/^All/).click();
  await chip('Show 4 working files').click();
  await expect(tiles).toHaveCount(11);
  await expect(chip(/^Comparisons 2/)).toBeVisible();
  await chip('Hide working files').click();

  await chip(/^Images 4/).click();
  await dialog.locator('.ref-pick[title="Gate"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.ref-viewer')).toHaveCount(1);

  // The next reference opens on the same narrowing.
  await rail.click();
  await expect(chip(/^Images 4/)).toHaveAttribute('aria-pressed', 'true');
  await expect(tiles).toHaveCount(4);

  fixture.expectNoUnexpectedRequests();
});

test('docks a reference beside the map, which narrows for it, and floats it back', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: MEDIA });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.getByRole('button', { name: 'Add reference' }).click();
  await page.getByRole('dialog', { name: 'Add reference' }).locator('.ref-pick[title="Gate"]').click();
  const pane = page.locator('.ref-viewer');
  await expect(pane).toHaveCount(1);
  const map = page.locator('.map-wrap .map');
  const wide = (await map.boundingBox()).width;

  await pane.getByRole('button', { name: 'Place' }).click();
  await pane.getByRole('button', { name: 'Column on the left' }).click();
  const dock = page.getByRole('complementary', { name: 'References docked on the left' });
  await expect(dock).toBeVisible();
  await expect(dock.locator('.ref-viewer.docked')).toHaveCount(1);
  // the map gave the column its room rather than lying under it
  await expect.poll(async () => (await map.boundingBox()).width).toBeLessThan(wide - 300);

  // the place it is in sets it free
  await dock.getByRole('button', { name: 'Place' }).click();
  await dock.getByRole('button', { name: 'Column on the left' }).click();
  await expect(dock).toHaveCount(0);
  await expect(page.locator('.map-wrap .ref-viewer')).toHaveCount(1);
  await expect.poll(async () => (await map.boundingBox()).width).toBeCloseTo(wide, 0);

  fixture.expectNoUnexpectedRequests();
});

test('fades a reference so the map moves under the picture', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: MEDIA });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.getByRole('button', { name: 'Add reference' }).click();
  await page.getByRole('dialog', { name: 'Add reference' }).locator('.ref-pick[title="Gate"]').click();
  const pane = page.locator('.ref-viewer');
  await pane.getByRole('button', { name: 'Fade' }).click();
  await expect(pane).toHaveClass(/see-through/);
  await expect(pane.locator('.rv-body')).toHaveCSS('opacity', '0.5');

  // what is under the middle of the faded picture is the map, not the window
  const box = await pane.locator('.rv-body').boundingBox();
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.ref-viewer') === null,
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(hit).toBe(true);

  fixture.expectNoUnexpectedRequests();
});

test('pins a reference in a corner, clear of the map\'s own controls', async ({ page }) => {
  const fixture = await installAppFixture(page, { media: MEDIA });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await page.getByRole('button', { name: 'Add reference' }).click();
  await page.getByRole('dialog', { name: 'Add reference' }).locator('.ref-pick[title="Gate"]').click();
  const pane = page.locator('.ref-viewer');
  await pane.getByRole('button', { name: 'Place' }).click();
  await pane.getByRole('button', { name: 'Top right corner' }).click();

  const box = await pane.boundingBox();
  const wrap = await page.locator('.map-wrap').boundingBox();
  // in the right-hand half, near the top, over the map
  expect(box.x + box.width).toBeGreaterThan(wrap.x + wrap.width - 120);
  expect(box.y).toBeLessThan(wrap.y + 200);
  // and over none of the controls in that corner
  for (const control of await page.locator('.surface-ctl > *').all()) {
    const c = await control.boundingBox();
    if (!c) continue;
    const apart = box.x >= c.x + c.width || box.x + box.width <= c.x || box.y >= c.y + c.height || box.y + box.height <= c.y;
    expect(apart).toBe(true);
  }

  // it stays in its corner when the map changes width
  const inset = Math.round(wrap.x + wrap.width - (box.x + box.width));
  await page.getByRole('button', { name: 'Hide the panel' }).click();
  await expect
    .poll(async () => (await page.locator('.map-wrap').boundingBox()).width)
    .toBeGreaterThan(wrap.width + 100);
  await expect
    .poll(async () => {
      const map = await page.locator('.map-wrap').boundingBox();
      const now = await pane.boundingBox();
      return Math.round(map.x + map.width - (now.x + now.width));
    })
    .toBe(inset);

  fixture.expectNoUnexpectedRequests();
});
