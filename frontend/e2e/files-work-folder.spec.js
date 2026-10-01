import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Files and the case sidebar act on a right-click, rename in place, and keep a
 * work folder. The case overview is routed here rather than by the fixture, so a
 * rename or a work folder written by the page is what the next reload reads.
 */
async function caseWithFolders(page, { folders, catalog }) {
  const fixture = await installAppFixture(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders }],
    catalog,
  });
  const state = { folders: [...folders], work_folder: null };
  const writes = [];
  await page.route(`**/api/cases/${CASE_ID}`, (route) =>
    route.fulfill({
      json: {
        id: CASE_ID,
        name: 'Browser Test',
        scratch: false,
        folders: state.folders,
        ...(state.work_folder ? { work_folder: state.work_folder } : {}),
      },
    })
  );
  await page.route(`**/api/cases/${CASE_ID}/folders/rename`, (route) => {
    const body = route.request().postDataJSON();
    writes.push({ rename: body });
    state.folders = state.folders.map((path) =>
      path === body.source || path.startsWith(`${body.source}/`) ? body.target + path.slice(body.source.length) : path
    );
    return route.fulfill({ json: state.folders });
  });
  await page.route(`**/api/cases/${CASE_ID}/work-folder`, (route) => {
    const body = route.request().postDataJSON();
    writes.push({ work: body });
    state.work_folder = body.folder;
    return route.fulfill({ json: { work_folder: body.folder } });
  });
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } })
  );
  return { fixture, writes };
}

const gate = {
  id: 'gate',
  type: 'place',
  label: 'Gate',
  attrs: { lat: 32.75, lon: 51.86 },
  provenance: { by: 'user', at: '2026-09-30T10:00:00Z', status: 'confirmed' },
};

test('Files renames a folder in place and makes it the work folder', async ({ page }) => {
  const { fixture, writes } = await caseWithFolders(page, { folders: ['Airbase', 'Airbase/North'], catalog: [gate] });
  await page.goto('/#files');

  const grid = page.locator('.grid-pane');
  await grid.locator('.tile.folder', { hasText: 'Airbase' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Import files here' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Rename' }).click();

  const field = grid.getByRole('textbox', { name: 'New name' });
  await expect(field).toHaveValue('Airbase');
  await field.fill('Isfahan');
  await field.press('Enter');
  await expect(grid.locator('.tile.folder', { hasText: 'Isfahan' })).toBeVisible();
  await expect(page.getByText('Renamed to Isfahan')).toBeVisible();
  expect(writes[0]).toEqual({ rename: { source: 'Airbase', target: 'Isfahan' } });

  await grid.locator('.tile.folder', { hasText: 'Isfahan' }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Work in this folder' }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ work: { folder: 'Isfahan' } });
  await expect(grid.locator('.tile.folder', { hasText: 'Isfahan' }).locator('.tile-pin')).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('Files offers an item its actions and moves it with Move to…', async ({ page }) => {
  const { fixture } = await caseWithFolders(page, { folders: ['Port'], catalog: [gate] });
  const patches = [];
  await page.route(`**/api/cases/${CASE_ID}/entities/gate`, (route) => {
    patches.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...gate, attrs: { ...gate.attrs, folder: 'Port' } } });
  });
  await page.goto('/#files');

  // an unfiled item sits in Unfiled, not at the root
  await page.locator('.tree-rail .trow', { hasText: 'Unfiled' }).click();
  await page.locator('.grid-pane .tile.entity', { hasText: 'Gate' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  for (const name of ['Open', 'Rename F2', 'Move to…', 'Add event', 'Show in Timeline', 'Details', 'Delete']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'Move to…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Move “Gate”' });
  await dialog.locator('.folder-select .trigger').click();
  await page.locator('.menu .opt', { hasText: 'Port' }).click();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches).toEqual([{ attrs: { folder: 'Port' } }]);
  fixture.expectNoUnexpectedRequests();
});

test('the sidebar switches to the to-do lists and renames a folder from its menu', async ({ page }) => {
  const { fixture, writes } = await caseWithFolders(page, { folders: ['Port'], catalog: [gate] });
  await page.goto('/#files');

  const sidebar = page.locator('aside.sidebar');
  await sidebar.getByRole('tab', { name: 'To-do' }).click();
  await expect(sidebar.getByLabel('New task', { exact: true })).toBeVisible();
  await expect(sidebar.getByPlaceholder('Search this case…')).toHaveCount(0);

  await sidebar.getByRole('tab', { name: 'Folders' }).click();
  await sidebar.locator('.frow', { hasText: 'Port' }).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Rename' }).click();
  const field = page.getByRole('menu').getByRole('textbox', { name: 'New name' });
  await expect(field).toHaveValue('Port');
  await field.fill('Harbour');
  await field.press('Enter');
  await expect.poll(() => writes.at(-1)).toEqual({ rename: { source: 'Port', target: 'Harbour' } });
  await expect(sidebar.locator('.frow', { hasText: 'Harbour' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});
