import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

const SAVED = [
  {
    id: 'p1',
    kind: 'place',
    title: 'Kramatorsk checkpoint',
    lat: 48.74,
    lon: 37.57,
    notes: '',
    fetched_at: '2026-07-20T09:12:04Z',
    geo: { state: 'ok', country: 'Україна', country_code: 'ua', region: 'Donetsk' },
    country_en: 'Ukraine',
    continent: 'Europe',
    folder: '',
  },
];

const bar = (page) => page.getByRole('combobox', { name: 'Search a place or coordinates' });

test('proposes cities from the first letters, without asking the geocoder', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('kr');
  await expect(page.getByRole('option', { name: /Kramatorsk/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Kraków/ })).toBeVisible();
  await expect(page.getByText('Cities from GeoNames, CC BY 4.0')).toBeVisible();

  // two letters is under the floor: the geocoder is not asked, however long we wait
  await page.waitForTimeout(1200);
  expect(fixture.geoQueries.places).toEqual([]);
  expect(fixture.geoQueries.suggest).toContain('kr');
});

test('asks the geocoder once typing stops, and puts its matches last', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('kramatorsk');
  // the city is there straight away; the street arrives after the pause
  await expect(page.getByRole('option', { name: /Kramatorsk Donetsk/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Kramatorska Street/ })).toBeVisible();

  const groups = await page.locator('#sat-suggestions .head').allTextContents();
  expect(groups).toEqual(['Cities', 'Places']);
  expect(fixture.geoQueries.places).toEqual(['kramatorsk']);
});

test('offers saved work in this case above anything looked up', async ({ page }) => {
  const fixture = await installAppFixture(page, { savedIndex: SAVED });
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('kram');
  await expect(page.locator('#sat-suggestions .head').first()).toHaveText('Saved in this case');
  await expect(page.getByRole('option', { name: /Kramatorsk checkpoint/ })).toBeVisible();

  fixture.expectNoUnexpectedRequests();
});

test('flies the map to the row the arrows land on', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);
  await expect(page.locator('.hud-coords')).toContainText('48.85'); // the home view, Paris

  await bar(page).fill('kramatorsk');
  await expect(page.getByRole('option', { name: /Kramatorsk Donetsk/ })).toBeVisible();
  await bar(page).press('ArrowDown');
  await bar(page).press('Enter');

  await expect(page.locator('.hud-coords')).toContainText('48.73');
  await expect(page.locator('.hud-coords')).toContainText('37.56');
  await expect(page.locator('#sat-suggestions')).toHaveCount(0);
});

test('recognises coordinates as they are typed', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('50.4501, 30.5234');
  await expect(page.locator('#sat-suggestions .head').first()).toHaveText('Coordinates');
  await bar(page).press('ArrowDown');
  await bar(page).press('Enter');
  await expect(page.locator('.hud-coords')).toContainText('50.45');

  // a coordinate is nobody's place name: the geocoder is never troubled with one
  expect(fixture.geoQueries.places).toEqual([]);
});

test('remembers where it was sent, and offers it back on an empty bar', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('kramatorsk');
  await page.getByRole('option', { name: /Kramatorsk Donetsk/ }).first().click();
  await expect(page.locator('.hud-coords')).toContainText('48.73');

  await bar(page).fill('');
  await bar(page).click();
  await expect(page.locator('#sat-suggestions .head').first()).toHaveText('Recent');
  await expect(page.getByRole('option', { name: /Kramatorsk/ })).toBeVisible();
});

test('closes on Escape and on a press elsewhere', async ({ page }) => {
  await installAppFixture(page);
  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);

  await bar(page).fill('kram');
  await expect(page.locator('#sat-suggestions')).toBeVisible();
  await bar(page).press('Escape');
  await expect(page.locator('#sat-suggestions')).toHaveCount(0);

  await bar(page).click();
  await expect(page.locator('#sat-suggestions')).toBeVisible();
  await page.getByRole('heading', { name: 'Satellite' }).click();
  await expect(page.locator('#sat-suggestions')).toHaveCount(0);
});
