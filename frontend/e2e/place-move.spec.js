import { test, expect } from '@playwright/test';
import { CASE_ID, awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * Moving a saved place from its card.
 *
 * A page cannot put the pointer on the point, so the map slides until the point is
 * under the press, and the place follows the pointer from there. A click puts it
 * down, Escape leaves it, and a point a proof states is sent to the proof. Where the
 * map slides to and what the click sends are browser facts.
 */

const point = {
  lat: 48.8584,
  lon: 2.2945,
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};
const place = (extra = {}) => ({ id: 'place-1', key: 'place-1', kind: 'place', title: 'checkpoint north', ...point, ...extra });

const card = (page) => page.locator('.saved-popup');
const mark = (page) => page.locator('.saved-mark-wrap:not(.sat-ghost)');

/** Where a place's drop puts its point on screen: the tip, at (13, 35) of its 26×36 box. */
async function tip(page) {
  const box = await mark(page).boundingBox();
  return { x: box.x + 13, y: box.y + 35 };
}

test('slides the map under the hand, then puts the place down where the click lands', async ({ page }) => {
  const savedIndex = [place()];
  const moves = [];
  await installAppFixture(page, { savedIndex });
  await page.route(`**/api/cases/${CASE_ID}/satellite/places/place-1/move`, (route) => {
    const to = route.request().postDataJSON();
    moves.push(to);
    // the index the reload reads says where it went
    Object.assign(savedIndex[0], to);
    return route.fulfill({ json: { id: 'place-1', type: 'place', attrs: to } });
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await mark(page).click();
  const press = await card(page).getByRole('button', { name: 'Move place' }).boundingBox();
  const at = { x: press.x + press.width / 2, y: press.y + press.height / 2 };
  await page.mouse.click(at.x, at.y);
  await expect(card(page)).toHaveCount(0);

  // the place's own point is now under the press, and its mark waits there faint
  await expect(mark(page)).toHaveClass(/is-moving/);
  const under = await tip(page);
  expect(Math.abs(under.x - at.x)).toBeLessThan(3);
  expect(Math.abs(under.y - at.y)).toBeLessThan(3);

  await page.mouse.move(at.x + 60, at.y + 40, { steps: 4 });
  await expect(page.locator('.sat-ghost')).toHaveCount(1);
  await page.mouse.click(at.x + 60, at.y + 40);

  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0].lat).toBeLessThan(point.lat);
  expect(moves[0].lon).toBeGreaterThan(point.lon);
  await expect(page.getByText('Place moved')).toBeVisible();
  await expect(page.locator('.sat-ghost')).toHaveCount(0);
  await expect(mark(page)).not.toHaveClass(/is-moving/);
  // drawn where it was put down
  const landed = await tip(page);
  expect(Math.abs(landed.x - (at.x + 60))).toBeLessThan(3);
  expect(Math.abs(landed.y - (at.y + 40))).toBeLessThan(3);

  // and Undo puts it back where it stood
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => moves.length).toBe(2);
  expect(moves[1]).toEqual({ lat: point.lat, lon: point.lon });
});

test('leaves the place where it was on Escape', async ({ page }) => {
  const moves = [];
  await installAppFixture(page, { savedIndex: [place()] });
  await page.route(`**/api/cases/${CASE_ID}/satellite/places/*/move`, (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await mark(page).click();
  await card(page).getByRole('button', { name: 'Move place' }).click();
  await expect(mark(page)).toHaveClass(/is-moving/);
  await page.keyboard.press('Escape');
  await expect(mark(page)).not.toHaveClass(/is-moving/);
  await expect(page.locator('.sat-ghost')).toHaveCount(0);
  const box = await page.locator('.map').first().boundingBox();
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
  expect(moves).toEqual([]);
});

test('sends a point a proof states to the proof, which keeps its coordinates', async ({ page }) => {
  const moves = [];
  await installAppFixture(page, { savedIndex: [place({ proofs: 1 })] });
  await page.route(`**/api/cases/${CASE_ID}/satellite/places/*/move`, (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/place-1/chain`, (route) => route.fulfill({
    json: {
      entity: { id: 'place-1', type: 'place', label: 'checkpoint north', attrs: point },
      sources: [], lost: [], dependents: [], empty: false,
      relations: [{
        direction: 'in',
        link: { id: 'l1', from: 'proof-1', to: 'place-1', type: 'depicts' },
        entity: { id: 'proof-1', type: 'proof', label: 'Roofline', attrs: { spec: 'proofs/.meta/Roofline.json' } },
      }],
    },
  }));
  await page.goto('/#satellite');
  await awaitMapReady(page);

  await mark(page).click();
  await card(page).getByRole('button', { name: 'Move place' }).click();
  await expect(page).toHaveURL(/#proof/);
  await expect(page.getByText('A proof states this point')).toBeVisible();
  expect(moves).toEqual([]);
});
