import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';
import { KOFI_URL } from '../src/lib/support.js';

test('opens from the rail, reaches nothing until a link is pressed, and steps aside', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const outside = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') outside.push(request.url());
  });
  await page.goto('/#media');
  const rail = page.locator('.rail').getByRole('button', { name: 'Support', exact: true });
  await expect(rail).toBeVisible();
  await expect(rail).toHaveAttribute('title', 'Support & feedback');

  await rail.click();
  const dialog = page.getByRole('dialog', { name: 'Support & feedback' });
  await expect(dialog).toBeVisible();
  const tip = dialog.getByRole('link', { name: 'Tip on Ko-fi' });
  await expect(tip).toHaveAttribute('href', KOFI_URL);
  await expect(tip).toHaveAttribute('target', '_blank');
  await expect(tip).toHaveAttribute('rel', 'noreferrer');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rail).toBeFocused();
  expect(outside).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('takes a problem to the report in Settings', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#media');
  await page.locator('.rail').getByRole('button', { name: 'Support', exact: true }).click();
  await page.getByRole('dialog', { name: 'Support & feedback' }).getByRole('button', { name: 'Report a problem' }).click();
  await expect(page.getByRole('dialog', { name: 'Support & feedback' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Report an issue' })).toBeVisible();
});

test('keeps the theme switch at the foot of the rail, with Support above it', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#media');
  const rail = page.locator('.rail');
  const support = await rail.getByRole('button', { name: 'Support', exact: true }).boundingBox();
  const theme = await rail.getByRole('button', { name: /^(Light|Dark)$/ }).boundingBox();
  const box = await rail.boundingBox();
  expect(support.y + support.height).toBeLessThanOrEqual(theme.y + 1);
  expect(theme.y + theme.height).toBeGreaterThan(box.y + box.height - 24);
});

test('leaves the last entry of the rail within reach in a short window', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#media');
  await page.setViewportSize({ width: 1000, height: 420 });
  const theme = page.locator('.rail').getByRole('button', { name: /^(Light|Dark)$/ });
  await theme.scrollIntoViewIfNeeded();
  await expect(theme).toBeInViewport({ ratio: 1 });
});

test('leaves a quiet link in the foot of Home', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#overview');
  const link = page.locator('.foot').getByRole('link', { name: 'Support Azimut on Ko-fi' });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toHaveAttribute('href', KOFI_URL);
  await expect(link).toHaveAttribute('rel', 'noreferrer');
});
