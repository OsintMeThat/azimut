import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

test('explains when a large video must be saved from Telegram', async ({ page }) => {
  const target = 'https://t.me/example_channel/104333';
  const fixture = await installAppFixture(page, {
    mediaDownloadJob: {
      id: 'media-download-job',
      kind: 'download',
      status: 'done',
      progress: {},
      result: { telegram_only: true },
    },
  });

  await page.goto('/#media');
  await expect(page.getByRole('heading', { name: 'Media Library' })).toBeVisible();
  await page.getByPlaceholder('Paste a link (X, Telegram, YouTube…)').fill(target);
  await page.getByRole('button', { name: 'Download', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'This video needs Telegram' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Save it in Telegram, then import the file here.');
  await expect(dialog.getByRole('link', { name: 'Open in Telegram' }))
    .toHaveAttribute('href', target);
  await expect(dialog.getByRole('link', { name: 'Open in Telegram' }))
    .toHaveAttribute('target', '_blank');
  expect(fixture.mediaDownloadWrites).toEqual([{
    url: target,
    index: null,
    title: null,
    use_cookies: false,
  }]);
  fixture.expectNoUnexpectedRequests();
});
