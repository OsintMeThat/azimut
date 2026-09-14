import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * One map, several windows — driven in a real browser, because every part of
 * this is the browser's: the address bar, `window.open`, and whether a second
 * window is allowed at all. None of it can be asserted from a source string.
 *
 * It runs on both engines. Firefox and Chromium disagree about what a window
 * opened with features is, and about how a hash written with `replaceState`
 * reads back, which is exactly why it is here rather than in a unit test.
 */

const readout = (page) => page.locator('.hud-coords');

test('opens on the view its address carries, not the saved home view', async ({ page }) => {
  await installAppFixture(page);
  // the fixture's home view is 48.8584, 2.2945 at z16 — this is somewhere else
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);

  await expect(readout(page)).toContainText('50.450');
  await expect(readout(page)).toContainText('30.523');
  await expect(readout(page)).toContainText('z13');
});

test('leaves the map where it was when the address says something impossible', async ({ page }) => {
  await installAppFixture(page);
  // an address is typed by hand, and a map that flies to NaN is unrecoverable
  await page.goto('/#satellite?ll=nowhere&z=900');
  await awaitMapReady(page);

  await expect(readout(page)).toContainText('48.858');
  await expect(readout(page)).toContainText('z16');
});

test('keeps this window\'s view in this window\'s address', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await expect.poll(() => page.evaluate(() => location.hash)).toContain('ll=48.8584');

  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 180, { steps: 8 });
  await page.mouse.up();

  // the pan moved the address with it…
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .not.toContain('ll=48.8584,2.2945');
  // …and did not fill the back button on the way
  expect(await page.evaluate(() => history.length)).toBeLessThan(4);
});

test('hands a second window the view the first one is showing', async ({ page, context }) => {
  await installAppFixture(page);
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);

  // the popup carries the fixture with it: it is the same origin, but a new page
  const opening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in a new tab' }).click();
  const second = await opening;
  await installAppFixture(second);
  await second.reload();
  await awaitMapReady(second);

  // same ground…
  await expect(second.locator('.hud-coords')).toContainText('50.450');
  // …and it says which window it is, since two of them look identical
  await expect(second.getByRole('heading', { name: 'Satellite · 2' })).toBeVisible();
  // the first one stays unnumbered and keeps its own view
  await expect(page.getByRole('heading', { name: 'Satellite', exact: true })).toBeVisible();

  // two windows, two cameras: moving one leaves the other alone
  const box = await second.locator('.map').boundingBox();
  await second.mouse.move(box.x + 500, box.y + 300);
  await second.mouse.down();
  await second.mouse.move(box.x + 260, box.y + 160, { steps: 8 });
  await second.mouse.up();
  await expect.poll(() => second.evaluate(() => location.hash)).not.toContain('ll=50.4501');
  await expect(readout(page)).toContainText('50.450');

  await second.close();
});

test('binds a detached window to its parent case, not shared last-case storage', async ({ page, context }) => {
  const cases = [
    { id: 'browser-test', name: 'Case A', scratch: false, entities: [], links: [], folders: [] },
    { id: 'case-b', name: 'Case B', scratch: false, entities: [], links: [], folders: [] },
  ];
  await installAppFixture(page, { cases });
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);
  // Another app tab last opened B. localStorage is shared across both windows.
  await page.evaluate(() => localStorage.setItem('azimut:lastCase', 'case-b'));

  const opening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in a new tab' }).click();
  const second = await opening;
  expect(new URL(second.url()).hash).toContain('case=browser-test');
  const fixture = await installAppFixture(second, { cases, lastCase: 'case-b' });
  await second.reload();
  await awaitMapReady(second);
  await second.getByRole('button', { name: 'Save place', exact: true }).click();

  await expect.poll(() => fixture.placeWrites.length).toBe(1);
  expect(fixture.placeWrites[0].caseId).toBe('browser-test');
  await second.close();
});

test('opens the detached tab on the map, without the app around it', async ({ page, context }) => {
  await installAppFixture(page);
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);

  const opening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in a new tab' }).click();
  const second = await opening;
  await installAppFixture(second);
  await second.reload();
  await awaitMapReady(second);

  // the rail, the case bar and the tab strip are how you get somewhere else,
  // and a second screen showing one map is already somewhere
  await expect(second.locator('nav.rail')).toHaveCount(0);
  await expect(second.locator('.topbar')).toHaveCount(0);
  await expect(second.locator('.tabstrip')).toHaveCount(0);
  // …and it is still a whole map
  await expect(second.locator('.map')).toBeVisible();
  await expect(second.locator('.hud-coords')).toContainText('50.450');

  // the first window keeps all of its own
  await expect(page.locator('nav.rail')).toHaveCount(1);

  await second.close();
});

test('keeps the tab on the map alone after it has been panned and reloaded', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13&w=2&solo=1');
  await awaitMapReady(page);
  await expect(page.locator('nav.rail')).toHaveCount(0);

  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 180, { steps: 8 });
  await page.mouse.up();

  // the pan rewrites the address, and what the tab *is* has to ride along
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('solo=1');
  await page.reload();
  await awaitMapReady(page);
  await expect(page.locator('nav.rail')).toHaveCount(0);
});

test('links two tabs onto one camera, and unlinks them again', async ({ page, context }) => {
  await installAppFixture(page);
  await page.goto('/#satellite?ll=50.4501,30.5234&z=13');
  await awaitMapReady(page);

  const second = await context.newPage();
  await installAppFixture(second);
  await second.goto('/#satellite?ll=48.8584,2.2945&z=13');
  await awaitMapReady(second);

  const link = (target) => target.getByRole('button', { name: 'Link the view to the other maps' });
  await link(page).click();
  await link(second).click();

  // pressing it hands the others this tab's camera, so the last one pressed wins
  await expect(readout(page)).toContainText('48.858');

  // …and from then on a pan in either carries the other with it
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await readout(second).innerText()).includes('48.858')).toBe(false);

  // unlinked, the two go their own ways again
  await link(second).click();
  const parked = await readout(second).innerText();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await readout(page).innerText()) !== parked).toBe(true);
  expect(await readout(second).innerText()).toBe(parked);

  await second.close();
});
