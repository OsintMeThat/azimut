import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

test('keeps app settings in focused sections', async ({ page }) => {
  const fixture = await installAppFixture(page);

  await page.goto('/#settings');
  await expect(page.getByTitle('Settings')).toHaveClass(/gear-active/);

  const rail = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(rail.getByRole('button')).toHaveText([
    'General',
    'Publishing',
    'Imagery',
    'Templates',
    'Capture extension',
    'Storage',
    'System',
  ]);

  await expect(page.getByRole('heading', { name: 'Coordinates' })).toBeVisible();
  await rail.getByRole('button', { name: 'Publishing' }).click();
  await expect(page.getByRole('heading', { name: 'Geo Report' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signature' })).toBeVisible();

  await rail.getByRole('button', { name: 'Storage' }).click();
  await expect(page.getByRole('heading', { name: 'Export folders' })).toBeVisible();
  await expect(page.getByText('Note PDFs')).toBeVisible();
  await expect(page.getByText('Media copies')).toBeVisible();
  await expect(page.getByText('Proof PNGs')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export backup' }))
    .toHaveAttribute('href', '/api/settings/export');
  await expect(page.getByRole('button', { name: 'Import backup' })).toBeVisible();
  await expect(page.getByText('keep this backup private')).toBeVisible();

  await rail.getByRole('button', { name: 'System' }).click();
  await expect(page.getByRole('heading', { name: 'Updates' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Report an issue' })).toBeVisible();

  fixture.expectNoUnexpectedRequests();
});

test('chooses a real export folder and uses it from Media Library', async ({ page }) => {
  const root = '/fixture/Documents';
  const entity = {
    id: 'media-1',
    type: 'media',
    label: 'Panel',
    attrs: { path: 'media/panel.svg' },
    provenance: { by: 'user', at: '2026-08-02T00:00:00Z', status: 'confirmed' },
  };
  const fixture = await installAppFixture(page, {
    folderRoots: [{ label: 'Documents', path: root }],
    folderViews: {
      [root]: {
        path: root,
        name: 'Documents',
        parent: '/fixture',
        crumbs: [{ name: 'Documents', path: root }],
        folders: [],
        truncated: false,
        writable: true,
      },
    },
    lookupEntities: { 'media/panel.svg': entity },
    chains: {
      'media-1': {
        entity,
        sources: [],
        lost: [],
        dependents: [],
        relations: [],
        empty: true,
      },
    },
  });

  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Storage' }).click();
  const mediaRow = page.locator('.row').filter({ hasText: 'Media copies' });
  await mediaRow.getByRole('button', { name: 'Change…' }).click();
  const picker = page.getByRole('dialog', { name: 'Export destination' });
  await picker.getByRole('button', { name: 'New folder' }).click();
  await picker.getByRole('textbox', { name: 'New folder name' }).fill('Field reports');
  await picker.getByRole('button', { name: 'Create' }).click();
  await picker.getByRole('button', { name: 'Use this folder' }).click();

  expect(fixture.folderWrites).toEqual([
    { parent: root, name: 'Field reports', path: `${root}/Field reports` },
  ]);
  expect(fixture.settingsWrites.at(-1)).toEqual({
    export_dirs: { media: `${root}/Field reports` },
  });

  await page.goto('/#media');
  await page.reload();
  await page.getByTitle('Info / Edit notes').click();
  await page.getByRole('dialog', { name: 'Details' })
    .getByRole('button', { name: 'Export', exact: true }).click();

  expect(fixture.exportWrites).toEqual([{ path: 'media/panel.svg' }]);
  await expect(page.getByText('panel.svg copied to Field reports')).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});
