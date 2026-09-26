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
