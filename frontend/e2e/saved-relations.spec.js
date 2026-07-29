import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Relations on the map, in a real Leaflet popup.
 *
 * The popup is the one surface where a click has somewhere else to go: Leaflet
 * closes a popup when a click reaches the map, and the card's own controls edit
 * only the card. Rendering it server-side cannot tell us whether that holds, so
 * these run in the browser.
 */

const point = {
  lat: 48.8584,
  lon: 2.2945,
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};

const photo = { id: 'media-1', type: 'media', label: 'roadside photo', attrs: { path: 'media/panel.svg' } };

/** Two places at one point, so the marks collapse into a single counted mark. */
const stack = [
  {
    id: 'place-1',
    key: 'place-1',
    kind: 'place',
    title: 'checkpoint north',
    fetched_at: '2026-07-24T09:00:00Z',
    relations: 1,
    status: 'suggested',
    ...point,
  },
  {
    id: 'place-2',
    key: 'place-2',
    kind: 'place',
    title: 'checkpoint south',
    fetched_at: '2026-07-24T08:00:00Z',
    relations: 0,
    status: 'confirmed',
    ...point,
  },
];

const suggestedChain = {
  entity: { id: 'place-1', type: 'place', label: 'checkpoint north', attrs: point },
  sources: [],
  lost: [],
  dependents: [],
  relations: [
    {
      entity: photo,
      direction: 'in',
      link: {
        id: 'link-1',
        from: 'media-1',
        to: 'place-1',
        type: 'located-at',
        provenance: { by: 'enrich', at: '2026-07-24T09:00:00Z', status: 'suggested' },
      },
    },
  ],
  empty: false,
};

test('opens a stacked row’s relations without closing the card', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    savedIndex: stack,
    chains: { 'place-1': suggestedChain },
  });

  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Show saved work on the map' }).click();
  await page.locator('.saved-mark').click();

  const popup = page.locator('.saved-popup');
  await expect(popup.getByText('2 saved here')).toBeVisible();
  // a stack waits to be asked: five marks must not mean five fetches
  await expect(popup.getByText('roadside photo')).toHaveCount(0);

  await popup.getByRole('button', { name: '1 relation' }).click();

  await expect(popup).toBeVisible();
  // the card fetches its edges behind the click, so give that read its own window
  await expect(popup.getByText('roadside photo')).toBeVisible({ timeout: 15000 });
  await expect(popup.locator('select')).toHaveValue('located-at');
  fixture.expectNoUnexpectedRequests();
});

test('corrects the reading of a relation in place, and takes one back', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    savedIndex: [stack[0]],
    chains: { 'place-1': suggestedChain },
  });

  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Show saved work on the map' }).click();
  await page.locator('.saved-mark').click();

  const popup = page.locator('.saved-popup');
  await expect(popup.getByText('roadside photo')).toBeVisible({ timeout: 15000 });

  // the wrong verb is corrected on the same edge, not deleted and restated
  await popup.locator('select').selectOption('depicts');
  await expect(popup).toBeVisible();

  await popup.getByTitle('Dismiss this relation').click();

  expect(fixture.linkWrites).toEqual([
    { method: 'PATCH', id: 'link-1', body: { type: 'depicts' } },
    { method: 'DELETE', id: 'link-1', body: null },
  ]);
  fixture.expectNoUnexpectedRequests();
});

test('settles a suggested relation from the card, which survives the click', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    savedIndex: [stack[0]],
    chains: { 'place-1': suggestedChain },
  });

  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Show saved work on the map' }).click();
  await page.locator('.saved-mark').click();

  const popup = page.locator('.saved-popup');
  // a lone mark opens its relations straight away
  await expect(popup.getByText('roadside photo')).toBeVisible({ timeout: 15000 });
  await expect(popup.getByText('suggested')).toBeVisible();

  await popup.getByTitle('Confirm this relation').click();

  await expect(popup).toBeVisible();
  expect(fixture.linkWrites).toEqual([
    { method: 'PATCH', id: 'link-1', body: { status: 'confirmed' } },
  ]);
  fixture.expectNoUnexpectedRequests();
});
