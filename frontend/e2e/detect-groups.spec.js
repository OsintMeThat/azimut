import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

const catalogue = {
    builtins: [{ id: 'surface', name: 'Surface change', description: 'Surface change',
      phenomenon: 'Surface change', method: 'surface', colour: '#38bdf8', style: 'both',
      parameters: { sensitivity: 67, min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0,
        merge_metres: 30, index: 'ndvi', direction: 'both', ignore_clouds: true,
        ignore_shadows: true, cloud_margin: 5 } }],
    custom: [], methods: [{ id: 'surface', label: 'Surface change', single: false, clouds: true,
      sizes: { medium: { min_area: 2000, max_area: 0, cleanup: 1, smoothing: 0, merge_metres: 30 } },
      measure: 'Reflectance moved by {value}%' }],
    max_tiles: 4096, max_results: 2000, grid: [13, 512], copernicus_key: true,
};

test('Areas groups fold and search, while Where keeps ungrouped areas available', async ({ page }) => {
  await installAppFixture(page);
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: catalogue }));
  const ring = [[2.29, 48.855], [2.3, 48.855], [2.3, 48.862], [2.29, 48.862], [2.29, 48.855]];
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8',
    geometry: { type: 'Polygon', coordinates: [ring] } };
  const river = { ...harbor, id: 'bbbbbbbbbbbb', name: 'River' };
  const groups = [
    { id: '111111111111', title: 'Ports', area_ids: [harbor.id], position: 0 },
    { id: '222222222222', title: 'Priority', area_ids: [harbor.id], position: 1 },
  ];
  await page.route('**/api/cases/*/analysis/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    route.fulfill({ json: path.endsWith('/analysis/areas') ? [harbor, river]
      : path.endsWith('/analysis/zones') ? groups : [] });
  });
  await page.goto('/#detect');
  await awaitMapReady(page);
  const dock = page.getByRole('complementary', { name: 'Detect' });
  await dock.getByRole('button', { name: 'Areas', exact: true }).click();
  const priority = dock.getByRole('region', { name: 'Priority' });
  await expect(priority.getByRole('group', { name: 'Harbor' })).toHaveCount(0);
  await dock.getByRole('textbox', { name: 'Search areas or groups' }).fill('Harbor');
  await expect(priority.getByRole('group', { name: 'Harbor' })).toHaveCount(1);
  await dock.getByRole('textbox', { name: 'Search areas or groups' }).fill('');

  await dock.getByRole('button', { name: 'New detection' }).click();
  await dock.getByRole('button', { name: 'New one pass' }).click();
  const where = dock.getByRole('region', { name: 'Where to look' });
  await expect(where).toContainText('Ungrouped');
  await expect(where.getByRole('button', { name: 'River' })).toBeVisible();
  await where.getByRole('button', { name: 'Use Ports' }).click();
  await where.getByRole('button', { name: 'Use Priority' }).click();
  await expect(where.locator('.area-row')).toHaveCount(1);
  await where.getByRole('button', { name: 'River' }).click();
  await expect(where.locator('.area-row')).toHaveCount(2);
});

test('dragging an area between groups and into Ungrouped moves its membership', async ({ page }) => {
  await installAppFixture(page);
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: catalogue }));
  const harbor = { id: 'aaaaaaaaaaaa', name: 'Harbor', colour: '#38bdf8', geometry: {
    type: 'Polygon', coordinates: [[[2.29, 48.855], [2.3, 48.855], [2.3, 48.862],
      [2.29, 48.862], [2.29, 48.855]]],
  } };
  const groups = [
    { id: '111111111111', title: 'Ports', area_ids: [harbor.id], position: 0 },
    { id: '222222222222', title: 'Priority', area_ids: [], position: 1 },
  ];
  await page.route('**/api/cases/*/analysis/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'PUT' && path.includes('/analysis/zones/')) {
      const group = groups.find((row) => path.endsWith(`/${row.id}`));
      Object.assign(group, route.request().postDataJSON());
      await route.fulfill({ json: group });
      return;
    }
    await route.fulfill({ json: path.endsWith('/analysis/areas') ? [harbor]
      : path.endsWith('/analysis/zones') ? groups : [] });
  });
  await page.goto('/#detect');
  await awaitMapReady(page);
  const dock = page.getByRole('complementary', { name: 'Detect' });
  await dock.getByRole('button', { name: 'Areas', exact: true }).click();
  const ports = dock.getByRole('region', { name: 'Ports' });
  const priority = dock.getByRole('region', { name: 'Priority' });
  await expect(ports.locator('.group-head .group-icon svg')).toBeVisible();
  // every group starts folded, the first one too
  await expect(ports.locator('.fold')).toHaveAttribute('aria-expanded', 'false');
  await ports.locator('.fold').click();
  // a ⋯ menu shuts when the press lands anywhere else
  const menu = ports.locator('details.item-menu').last();
  await ports.getByLabel('More actions for Harbor').click();
  await expect(menu).toHaveAttribute('open', '');
  await dock.getByRole('textbox', { name: 'Search areas or groups' }).click();
  await expect(menu).not.toHaveAttribute('open', '');
  await priority.locator('.fold').click();
  const handle = ports.getByRole('button', { name: 'Drag Harbor' });
  const target = priority.locator('.group-head');
  const sourceBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 8, sourceBox.y + sourceBox.height / 2 + 8, { steps: 4 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  await expect(ports.getByRole('group', { name: 'Harbor' })).toHaveClass(/dragging/);
  await expect(target).toHaveClass(/landing-area/);
  await page.mouse.up();
  await expect(target).not.toHaveClass(/landing-area/);
  await expect(ports.getByRole('group', { name: 'Harbor' })).toHaveCount(0);
  await expect(priority.getByRole('group', { name: 'Harbor' })).toHaveCount(1);
  expect(groups.map((group) => group.area_ids)).toEqual([[], [harbor.id]]);

  const ungrouped = dock.getByRole('region', { name: 'Ungrouped' });
  await expect(ungrouped.locator('.ungrouped-head')).toBeVisible();
  await priority.getByRole('button', { name: 'Drag Harbor' }).dragTo(ungrouped.locator('.ungrouped-head'));
  await expect(ungrouped.getByRole('group', { name: 'Harbor' })).toHaveCount(1);
  expect(groups.map((group) => group.area_ids)).toEqual([[], []]);
});
