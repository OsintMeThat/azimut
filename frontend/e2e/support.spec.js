import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';
import { KOFI_URL, SITE_URL, TIP_LINES } from '../src/lib/support.js';

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

test('turns its line on a press without ever moving the tip under the cursor', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#media');
  await page.locator('.rail').getByRole('button', { name: 'Support', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Support & feedback' });
  const words = dialog.locator('.words');
  const tip = dialog.getByRole('link', { name: 'Tip on Ko-fi' });
  const firstTip = await tip.boundingBox();
  const firstWords = await words.boundingBox();
  // the tip takes its whole line, and the foot says who makes Azimut
  expect(Math.abs(firstTip.width - firstWords.width)).toBeLessThan(1);
  await expect(dialog.locator('.made').getByRole('link')).toHaveAttribute('href', SITE_URL);

  const seen = new Set();
  for (let press = 0; press < 400 && seen.size < TIP_LINES.length; press += 1) {
    const line = (await words.textContent()).trim();
    expect(TIP_LINES).toContain(line);
    seen.add(line);
    expect(await tip.boundingBox()).toEqual(firstTip);
    expect((await words.boundingBox()).height).toBe(firstWords.height);
    await words.click();
    await expect(words).not.toHaveText(line);
  }
  expect(seen.size).toBe(TIP_LINES.length);
});

test('beats the heart every ten minutes in sight, until Support is opened', async ({ page }) => {
  await page.clock.install();
  await installAppFixture(page);
  await page.goto('/#media');
  const support = page.locator('.rail').getByRole('button', { name: 'Support', exact: true });
  const heart = support.locator('.heart');
  await expect(heart).toBeVisible();
  await expect(heart).not.toHaveClass(/beat/);
  // grey like the rest of the rail between beats
  const colour = (locator) => locator.evaluate((node) => getComputedStyle(node).color);
  expect(await colour(heart)).toBe(await colour(support.locator('span').last()));
  await page.clock.fastForward('09:00');
  await expect(heart).not.toHaveClass(/beat/);
  await page.clock.fastForward('01:00');
  await expect(heart).toHaveClass(/beat/);

  await support.click();
  await page.keyboard.press('Escape');
  const still = await heart.elementHandle();
  for (let i = 0; i < 3; i += 1) await page.clock.fastForward('10:00');
  expect(await still.evaluate((node) => node.isConnected)).toBe(true);
});

for (const [why, setUp] of [
  ['with the switch off', (page) => installAppFixture(page, { settings: { support_heartbeat: false } })],
  ['under reduced motion', async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installAppFixture(page);
  }],
]) {
  test(`keeps the heart still ${why}`, async ({ page }) => {
    await page.clock.install();
    await setUp(page);
    await page.goto('/#media');
    const heart = page.locator('.rail .support-rail .heart');
    await expect(heart).toBeVisible();
    for (let i = 0; i < 3; i += 1) await page.clock.fastForward('10:00');
    await expect(heart).not.toHaveClass(/beat/);
  });
}

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
