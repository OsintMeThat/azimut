import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

for (const empty of [false, true]) {
  test(`checklists fit the dashboard grid in a ${empty ? 'new' : 'populated'} case`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // An empty catalog falls back to the drawn case, so a new case needs its summary.
    await installAppFixture(page, empty
      ? { summary: { total: 0, by_type: {}, by_status: {}, by_folder: {}, linked_to: {} } }
      : { catalog: [{ id: 'source', type: 'place', label: 'Source', attrs: {}, provenance: {} }] });
    let data = { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] };
    await page.route(`**/api/cases/${CASE_ID}/todos`, async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        data = { ...body, revision: body.revision + 1 };
      }
      await route.fulfill({ json: data });
    });
    await page.goto('/#overview');
    const todos = page.getByRole('region', { name: 'To-do', exact: true });
    await expect(todos.getByLabel('New task', { exact: true })).toBeVisible();
    const grid = page.locator('.home .grid');
    if (empty) await expect(grid).toHaveClass(/empty-case/);
    else await expect(page.getByRole('heading', { name: 'What is waiting' })).toBeVisible();
    const gridBox = await grid.boundingBox();
    const todoBox = await todos.boundingBox();
    expect(todoBox.width).toBeLessThan(gridBox.width * 0.6);
    await todos.getByLabel('New task', { exact: true }).fill('Verify source');
    await todos.getByLabel('New task', { exact: true }).press('Enter');
    await expect(todos.getByLabel('Task text', { exact: true })).toHaveValue('Verify source');
    await todos.getByRole('checkbox').check();
    await expect(todos.getByRole('button', { name: 'Tasks 1/1' })).toBeVisible();
    await page.reload();
    await expect(todos.getByRole('checkbox')).toBeChecked();
    await page.setViewportSize({ width: 700, height: 1000 });
    const narrowGrid = await grid.boundingBox();
    const narrowTodos = await todos.boundingBox();
    expect(Math.abs(narrowGrid.width - narrowTodos.width)).toBeLessThan(2);
  });
}
