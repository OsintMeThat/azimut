import { expect, test } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

/** A workspace nobody has used: no case, no tour, nothing read. */
const NEWCOMER = { cases: [], lastCase: null, settings: { version: '0.3.3', tour: '', whats_new_seen: '' } };

const card = (page) => page.locator('.onboarding [role="dialog"]');

test('a newcomer is welcomed, walked through the stages, and left on their first case', async ({ page }) => {
  const fixture = await installAppFixture(page, NEWCOMER);
  await page.goto('/');

  await expect(card(page).locator('h2')).toHaveText('Welcome to Azimut');
  await card(page).getByRole('button', { name: 'Show me around' }).click();
  await expect(card(page).locator('h2')).toHaveText('Start with a case');
  // one control lit on the picture, named
  await expect(card(page).locator('.spot .name')).toHaveText('The open case');

  // the veil does nothing, and Escape asks before leaving
  await page.mouse.click(5, 300);
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page).locator('.ask')).toContainText('Leave the tour?');
  await card(page).getByRole('button', { name: 'Continue' }).click();

  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page).locator('h2')).toHaveText('Bring in what you are looking at');
  expect(fixture.settingsWrites.at(-1)).toEqual({ tour: '2' });

  // a reload is no exit: the tour picks up on the page it was on
  await page.reload();
  await expect(card(page).locator('h2')).toHaveText('Bring in what you are looking at');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(card(page).locator('h2')).toHaveText('Prove it');

  // the last page lights the topbar's own `?`, with a line drawn to it
  const mark = await page.locator('.topbar button[aria-label="Read the guide"]').boundingBox();
  const lit = await page.locator('.onboarding .lit').boundingBox();
  expect(Math.abs(lit.x + lit.width / 2 - (mark.x + mark.width / 2))).toBeLessThan(2);
  await expect(page.locator('.onboarding .trail')).toHaveCount(1);

  await card(page).getByRole('button', { name: 'Create my first case' }).click();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('#home-case-name')).toBeFocused();
  expect(fixture.settingsWrites.at(-1)).toEqual({ tour: 'done', whats_new_seen: '0.3.3' });

  // and it stays done
  await page.reload();
  await expect(page.locator('#home-case-name')).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
});

test('the front door and Home both start the tour again', async ({ page }) => {
  await installAppFixture(page, { ...NEWCOMER, settings: { ...NEWCOMER.settings, tour: 'done', whats_new_seen: '0.3.3' } });
  await page.goto('/');
  await expect(page.locator('#home-case-name')).toBeVisible();
  await expect(page.locator('#home-case-name')).toHaveAttribute('placeholder', 'Harbour photo, 3 May');
  await page.locator('.door').getByRole('button', { name: 'Take the tour' }).click();
  await expect(card(page).locator('h2')).toHaveText('Start with a case');
  await card(page).getByRole('button', { name: 'Skip the tour' }).click();
  await expect(page.locator('.onboarding')).toHaveCount(0);

  const home = await page.context().newPage();
  await installAppFixture(home, { settings: { version: '0.3.3', whats_new_seen: '0.3.3' } });
  await home.goto('/#overview');
  await home.locator('.foot').getByRole('button', { name: /Take the tour/ }).click();
  await expect(card(home).locator('h2')).toHaveText('Start with a case');
  // someone with cases ends on Done rather than on making one
  for (let turn = 0; turn < 3; turn += 1) await card(home).getByRole('button', { name: 'Next' }).click();
  await expect(card(home).getByRole('button', { name: 'Done' })).toBeVisible();
});

test('someone who updates reads what the version brings, once', async ({ page }) => {
  const fixture = await installAppFixture(page, { settings: { version: '0.3.3', whats_new_seen: '0.3.2' } });
  await page.goto('/#overview');

  await expect(card(page).locator('.where').first()).toContainText('New in 0.3.3');
  await expect(card(page).getByRole('button', { name: /Try it/ })).toHaveCount(0);

  // put away without a choice, it waits for the next start rather than a reload
  await page.keyboard.press('Escape');
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.foot')).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);

  // Home reads it again, to its last page and Done
  await page.locator('.foot').getByRole('button', { name: "What's new in 0.3.3" }).click();
  const dots = card(page).locator('.dots button');
  await dots.last().click();
  await expect(page.locator('.onboarding .lit')).toBeVisible();
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  expect(fixture.settingsWrites.at(-1)).toEqual({ whats_new_seen: '0.3.3' });
});
