import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * How tightly a place is pinned, driven in a real browser.
 *
 * Tracing is a gesture on the map and nothing else can stand in for it: the
 * corners are clicks on the ground, and what makes a shape wrong is where those
 * clicks landed relative to a pin somewhere else on screen. Two rules are under
 * test, and both were things the app let happen without a word — a shape traced
 * beside its own point, and a radius that quietly stopped being drawn the moment
 * a shape existed.
 */

// The point the fixture's home view opens on, so the pin sits dead centre.
const HOME = { lat: 48.8584, lon: 2.2945 };

const quay = {
  id: 'place-1',
  key: 'place-1',
  kind: 'place',
  title: 'checkpoint north',
  lat: HOME.lat,
  lon: HOME.lon,
  zoom: 16,
  radius_m: 500,
  footprint: null,
  relations: 0,
  status: 'confirmed',
  fetched_at: '2026-09-10T09:00:00Z',
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};

const chain = {
  entity: {
    id: 'place-1',
    type: 'place',
    label: 'checkpoint north',
    attrs: { ...HOME, radius_m: 500, method: 'roofline match' },
    provenance: { by: 'user', at: '2026-09-10T09:00:00Z', status: 'confirmed' },
  },
  sources: [],
  lost: [],
  dependents: [],
  relations: [],
  empty: true,
};

async function openCard(page) {
  const fixture = await installAppFixture(page, {
    savedIndex: [quay],
    chains: { 'place-1': chain },
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Saved work' }).click();
  await page.locator('.saved-mark').click();
  return fixture;
}

/** Arm tracing from the place's own card, which is the only way in. */
async function armTrace(page) {
  const fixture = await openCard(page);
  await page.locator('.saved-popup').getByText('Trace footprint').click();
  const panel = page.locator('.footprint-panel');
  await expect(panel).toContainText('checkpoint north');
  // it says what it is about to take the place of, before anything is written
  await expect(panel).toContainText('replaces its 500 m circle');
  return fixture;
}

/** Click corners at offsets from the middle of the map, where the pin is. */
async function corners(page, points) {
  const box = await page.locator('.map').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const [dx, dy] of points) await page.mouse.click(cx + dx, cy + dy);
}

const saveShape = (page) => page.locator('.footprint-panel').getByRole('button', { name: 'Save' });

test('refuses a shape traced beside the place it belongs to', async ({ page }) => {
  const fixture = await armTrace(page);

  // three corners, all of them off to one side of the pin
  await corners(page, [[140, -150], [260, -150], [260, -40]]);

  const panel = page.locator('.footprint-panel');
  await expect(panel).toContainText('The shape has to contain the pin it belongs to.');
  await expect(saveShape(page)).toBeDisabled();
  expect(fixture.entityWrites).toEqual([]);
});

test('writes a shape around the pin, and drops the circle it replaces', async ({ page }) => {
  const fixture = await armTrace(page);

  await corners(page, [[-130, -120], [130, -120], [130, 120], [-130, 120]]);

  await expect(page.locator('.footprint-panel')).toContainText('4 corners');
  await saveShape(page).click();

  await expect.poll(() => fixture.entityWrites.length).toBe(1);
  const written = fixture.entityWrites[0];
  expect(written.method).toBe('PATCH');
  expect(written.id).toBe('place-1');
  expect(written.body.attrs.footprint.type).toBe('Polygon');
  // the pin is inside what was drawn…
  const ring = written.body.attrs.footprint.coordinates[0];
  expect(Math.min(...ring.map(([lon]) => lon))).toBeLessThan(HOME.lon);
  expect(Math.max(...ring.map(([lon]) => lon))).toBeGreaterThan(HOME.lon);
  // …and the radius goes with the shape that replaced it: one precision, one form
  expect(written.body.attrs.radius_m).toBe(null);
  await expect(page.locator('.footprint-panel')).toBeHidden();
});

test('opens the full editor on a place from the map', async ({ page }) => {
  await openCard(page);
  await page.locator('.saved-popup').getByText('Edit', { exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit place' });
  await expect(dialog).toBeVisible();
  // the short form asks what an analyst fills at the moment of saving…
  await expect(dialog.getByLabel('Title')).toHaveValue('checkpoint north');
  await expect(dialog).not.toContainText('Uncertainty radius');

  await dialog.getByRole('button', { name: 'Edit more details' }).click();

  // …and the rest is the panel every other surface opens, on what the case holds
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details).toBeVisible();
  await expect(details.getByLabel('Uncertainty radius (m)')).toHaveValue('500');
  await expect(details.getByLabel('How this point was found')).toHaveValue('roofline match');
});

test('asks before handing over would drop what the short form holds', async ({ page }) => {
  await openCard(page);
  await page.locator('.saved-popup').getByText('Edit', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit place' });
  await dialog.getByLabel('Title').fill('checkpoint north, gate');

  await dialog.getByRole('button', { name: 'Edit more details' }).click();

  await expect(page.getByText('This place has edits that Save has not taken.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeHidden();

  await page.getByRole('button', { name: 'Discard' }).click();

  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
});
