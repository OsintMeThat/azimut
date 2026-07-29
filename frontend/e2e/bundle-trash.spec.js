import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

test('keeps a failed export visible after its dialog closes', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    bundleJob: { state: 'failed', error: 'Export failed safely' },
  });

  await page.goto('/#files');
  await page.getByTitle('Switch case').click();
  await page.getByRole('button', { name: 'Export this case…' }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  await expect(page.getByText('Export failed safely', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export case' })).toHaveCount(0);
  expect(fixture.bundleCalls.map((call) => call.kind)).toEqual(['export', 'job']);
  fixture.expectNoUnexpectedRequests();
});

test('shows disk capacity before importing a large bundle', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    bundlePreview: {
      upload_id: 'upload-1',
      case_name: 'Large archive',
      total_size: 20 * 1024 ** 3,
      sealed: true,
      estimated_import_bytes: 42 * 1024 ** 3,
      free_space_bytes: 30 * 1024 ** 3,
      space_reserve_bytes: 512 * 1024 ** 2,
      space_ok: false,
      large_bundle: true,
    },
  });

  await page.goto('/#files');
  await page.getByTitle('Switch case').click();
  await page.getByRole('button', { name: 'Import case…' }).click();
  await page.locator('#bundle-import-file').setInputFiles({
    name: 'large.azimut.enc',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('fixture'),
  });
  await page.getByRole('button', { name: 'Check bundle' }).click();

  await expect(page.getByText('Not enough free space.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  expect(fixture.bundleCalls.map((call) => call.kind)).toEqual(['inspect']);
  fixture.expectNoUnexpectedRequests();
});

test('restores a trash group with keyboard-reachable actions', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    trashGroups: [{
      id: 'trash-1',
      label: 'Field note',
      type: 'note',
      item_count: 1,
      size_bytes: 256,
      deleted_at: '2026-07-29T20:00:00Z',
    }],
  });

  await page.goto('/#files');
  await page.locator('button.trash-toggle').click();
  const restore = page.getByRole('button', { name: 'Restore Field note' });
  await restore.focus();
  await expect(restore).toBeFocused();
  await restore.press('Enter');

  await expect(page.getByText('Restored “Field note”', { exact: true })).toBeVisible();
  await expect(page.locator('button.trash-toggle')).toHaveCount(0);
  expect(fixture.trashWrites).toEqual([{ kind: 'restore', groupId: 'trash-1' }]);
  fixture.expectNoUnexpectedRequests();
});
