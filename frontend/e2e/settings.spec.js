import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

test('keeps app settings in focused sections', async ({ page }) => {
  const fixture = await installAppFixture(page);

  await page.goto('/#settings');
  await expect(page.getByTitle('Settings')).toHaveClass(/topbar-active/);

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

// The template preview hangs its commits off transformend, the same way the
// composer does, so a release the page never sees left the signature resizing
// under a bare pointer and never wrote the size back into the template.
test('a signature resize whose release the window never sees still lands, and stops there', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#settings');
  const rail = page.getByRole('navigation', { name: 'Settings sections' });
  await rail.getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New proof template' }).click();

  await page.getByLabel('Stamp the logo').check();
  const size = page.getByRole('slider', { name: 'Size' });
  const before = await size.inputValue();
  const canvas = page.locator('.preview-frame canvas').first();
  await expect(canvas).toBeVisible();

  // Select the logo, then take its frame's corner. Both live on the canvas,
  // where there is no DOM handle to aim at; ask the stage where it put them.
  const preview = () => page.evaluate(() => {
    const stage = window.Konva.stages[window.Konva.stages.length - 1];
    const k = stage.scaleX();
    const tr = stage.find('Transformer')[0];
    const logo = stage.find((n) => n.draggable())[0];
    const r = logo.getClientRect({ relativeTo: stage });
    return {
      logo: { x: (r.x + r.width / 2) * k, y: (r.y + r.height / 2) * k },
      anchor: tr ? { x: tr.x() + tr.width(), y: tr.y() + tr.height() } : null,
    };
  });

  const box = await canvas.boundingBox();
  const { logo } = await preview();
  await page.mouse.click(box.x + logo.x, box.y + logo.y);
  const { anchor } = await preview();
  expect(anchor).not.toBeNull();

  const ax = box.x + anchor.x;
  const ay = box.y + anchor.y;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 14, ay + 9, { steps: 6 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); // the release that never arrives

  await expect(size).not.toHaveValue(before);
  const committed = await size.inputValue();

  // The pointer wanders on with no button held. Nothing may follow it.
  await page.mouse.move(ax + 120, ay + 90, { steps: 10 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(size).toHaveValue(committed);

  await page.mouse.up();
  fixture.expectNoUnexpectedRequests();
});

test('a new post template starts from a layout, counts each platform and mends a misspelled token', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New post template' }).click();

  const editor = page.locator('.tpl-modal');
  const body = editor.locator('textarea.body');
  const preview = editor.locator('.pe-preview pre');

  await editor.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'With date' }).click();
  await expect(body).toHaveValue(/Filmed: #date/);
  await expect(preview).toContainText('Filmed: 2025-10-24 14:30 UTC+3');
  await expect(editor.locator('.counters')).toContainText(/X \d+\/280 · Bluesky \d+\/300/);

  // no post is open in the composer, so only the sample can be previewed
  const open = editor.getByRole('button', { name: 'Open post' });
  await expect(open).toBeDisabled();
  await expect(open).toHaveAttribute('title', 'No post is open in the composer');

  await body.fill('#place\n#coordinate\n#coordinate');
  await expect(editor.locator('.misspelled'))
    .toContainText('#coordinate is not a token. Did you mean #coordinates?');
  await editor.locator('.misspelled').getByRole('button', { name: 'Fix' }).click();
  await expect(body).toHaveValue('#place\n#coordinates\n#coordinates');
  await expect(editor.locator('.misspelled')).toHaveCount(0);

  await body.fill('a'.repeat(290));
  await expect(editor.locator('.counter').first()).toHaveClass(/over/);
  await expect(editor.locator('.counter').nth(1)).not.toHaveClass(/over/);

  fixture.expectNoUnexpectedRequests();
});
