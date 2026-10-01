import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

test('Detect separates its tools, sections, and current task', async ({ page }) => {
  await installAppFixture(page);
  await page.route('**/api/compare/analyzers', (route) => route.fulfill({ json: {
    builtins: [], custom: [], methods: [], grid: [13, 512], max_tiles: 4096, max_results: 2000,
  } }));
  await page.route('**/api/cases/*/analysis/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/#detect');

  const dock = page.getByRole('complementary', { name: 'Detect' });
  await expect(dock).toBeVisible({ timeout: 30_000 });
  const heading = dock.locator('.dock-heading');
  const tabs = dock.getByRole('navigation', { name: 'Detect sections' });
  await expect(heading).toContainText('Detect');
  await expect(tabs.getByRole('button', { name: 'Routines' })).toHaveAttribute('aria-pressed', 'true');
  const headingBox = await heading.boundingBox();
  const tabsBox = await tabs.boundingBox();
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(tabsBox.y + 1);
  await expect(tabs.getByRole('button', { name: 'Routines' })).toHaveCSS('border-bottom-width', '2px');

  await dock.getByRole('button', { name: 'New detection', exact: true }).click();
  const menu = dock.getByRole('group', { name: 'New detection' });
  await expect(menu.getByRole('button')).toHaveCount(2);
  await expect(menu).not.toContainText('START WITH');
  await menu.getByRole('button', { name: 'New one pass' }).click();
  const stepper = dock.getByRole('navigation', { name: 'Steps' });
  await expect(stepper.locator('button.current')).toContainText('Where');
  const titleSize = await dock.getByRole('heading', { name: 'Where to look' }).evaluate(
    (node) => parseFloat(getComputedStyle(node).fontSize)
  );
  const stepSize = await stepper.locator('button.current').evaluate(
    (node) => parseFloat(getComputedStyle(node).fontSize)
  );
  expect(titleSize).toBeGreaterThan(stepSize);

  await dock.getByRole('button', { name: 'Collapse Detect panel' }).click();
  await expect(tabs).toHaveClass(/rail/);
  await expect(dock.getByRole('button', { name: 'Analyzers' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Full screen' })).toBeVisible();
});
