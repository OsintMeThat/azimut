import { expect, test } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

/**
 * The fictional example case, from the front door: one press makes it from the bundle the
 * app ships, waits for its import, and opens it on the Notebook, where the five showcase
 * templates stand in a row of their own.
 */
test('the front door opens the fictional example case on its notes', async ({ page }) => {
  const fixture = await installAppFixture(page, { cases: [], lastCase: null });
  await page.goto('/');

  const press = page.locator('.door-foot').getByRole('button', { name: 'Open the example case' });
  await expect(press).toBeVisible({ timeout: 15_000 });
  await expect(press).toHaveAttribute('title', /fictional case/);
  await press.click();

  await expect(page.getByRole('button', { name: /Example case \(fictional\)/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
  expect(fixture.exampleCalls).toEqual(['make']);

  // the templates it is made from, a row of their own; no link to the case already open
  await expect(page.locator('h4', { hasText: 'Reports with figures' })).toBeVisible();
  for (const name of ['Front-line analysis', 'Equipment losses register', 'Strike and damage assessment',
    'Claim against footage', 'Story article for the web']) {
    await expect(page.locator('.tile-name', { hasText: name })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'See them filled in the example case' })).toHaveCount(0);
  // nothing about the example went unanswered (the To-do, read on any case, is not this spec's)
  expect(fixture.unexpected().filter((request) => !request.endsWith('/todos'))).toEqual([]);
});
