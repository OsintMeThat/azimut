import { test, expect } from '@playwright/test';
import { CASE_ID, awaitMapReady, installAppFixture } from './app.fixture.js';

/**
 * A zone: Save place's arrow offers Save zone, whose corners are clicked on the map and
 * whose name is typed in the panel. Saved, it is a place drawn as its area, with no pin;
 * a click in the area opens its card, Edit footprint opens it with its corners to drag,
 * and a zoom out that leaves the area too small puts a small square in its place.
 */

async function openMap(page) {
  await page.setViewportSize({ width: 1500, height: 900 });
  const savedIndex = [];
  const writes = { places: [], patches: [], moves: [] };
  await installAppFixture(page, { savedIndex });
  await page.route(`**/api/cases/${CASE_ID}/satellite/place`, (route) => {
    const body = route.request().postDataJSON();
    writes.places.push(body);
    savedIndex.push({
      id: 'zone-1', key: 'zone-1', kind: 'place', title: body.title, lat: body.lat, lon: body.lon,
      footprint: body.footprint, zone: true, fetched_at: '2026-11-24T10:00:00Z', proofs: 0, relations: 0,
    });
    return route.fulfill({ json: { id: 'zone-1', type: 'place', label: body.title, attrs: body } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/zone-1`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON();
    writes.patches.push(body);
    Object.assign(savedIndex[0], body.attrs);
    return route.fulfill({ json: { id: 'zone-1', type: 'place', attrs: body.attrs } });
  });
  await page.route(`**/api/cases/${CASE_ID}/satellite/places/zone-1/move`, (route) => {
    const to = route.request().postDataJSON();
    writes.moves.push(to);
    Object.assign(savedIndex[0], to);
    return route.fulfill({ json: { id: 'zone-1', type: 'place', attrs: to } });
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  const box = await page.locator('.map[data-map-ready="true"]').boundingBox();
  const at = (dx, dy) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy });
  return { writes, at };
}

test('draws a zone corner by corner, names it in the panel and saves it as a place', async ({ page }) => {
  const { writes, at } = await openMap(page);
  await page.getByRole('button', { name: 'Save a place or a zone' }).click();
  await page.getByRole('menuitem', { name: 'Save zone' }).click();
  await expect(page.getByText('New zone')).toBeVisible();

  for (const [dx, dy] of [[-120, -80], [120, -80], [120, 80], [-120, 80]]) {
    const p = at(dx, dy);
    await page.mouse.click(p.x, p.y);
  }
  const save = page.locator('.footprint-panel').getByRole('button', { name: 'Save', exact: true });
  // an area, but no name yet
  await expect(save).toBeDisabled();
  await page.getByRole('textbox', { name: 'Zone name' }).fill('North quay');
  await expect(save).toBeEnabled();
  await save.click();

  await expect.poll(() => writes.places.length).toBe(1);
  const [zone] = writes.places;
  expect(zone.title).toBe('North quay');
  expect(zone.footprint.type).toBe('Polygon');
  expect(zone.footprint.coordinates[0]).toHaveLength(5); // four corners, closed
  await expect(page.getByText('Zone saved')).toBeVisible();
  await expect(page.locator('.footprint-panel')).toHaveCount(0);
  // drawn as its area: no pin on its point
  await expect(page.locator('.saved-zone-wrap')).toHaveCount(1);
  await expect(page.locator('.saved-place-drop')).toHaveCount(0);
  await expect(page.locator('.saved-zone-wrap.tiny')).toHaveCount(0);

  // a click inside the area, away from its pin, opens the zone's card
  const inside = at(-90, -55);
  await page.mouse.click(inside.x, inside.y);
  const card = page.locator('.saved-popup');
  await expect(card).toBeVisible();
  await expect(card.getByText('North quay')).toBeVisible();
  await expect(card.getByText('Zone', { exact: true })).toBeVisible();

  // Edit footprint opens it with its four corners, each to drag
  await card.getByRole('button', { name: 'Edit footprint' }).click();
  await expect(page.getByText('Editing')).toBeVisible();
  const corners = page.locator('.path-handle:not(.ghost)');
  await expect(corners).toHaveCount(4);
  const corner = await corners.first().boundingBox();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 40, corner.y - 30, { steps: 6 });
  await page.mouse.up();
  await page.locator('.footprint-panel').getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => writes.patches.length).toBe(1);
  const ring = writes.patches[0].attrs.footprint.coordinates[0];
  expect(ring).toHaveLength(5);
  expect(ring[0]).not.toEqual(zone.footprint.coordinates[0][0]);
  await expect(page.getByText('Footprint saved')).toBeVisible();

  // zoomed out until the area is a few pixels across, its square stands in for it
  const readout = page.locator('.status .z').first();
  for (let i = 0; i < 6; i += 1) {
    const before = Number((await readout.textContent()).match(/z(\d+)/)[1]);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(readout).toContainText(`z${before - 1}`);
  }
  await expect(page.locator('.saved-zone-wrap.tiny .saved-zone-mark')).toBeVisible();
  await page.locator('.saved-zone-wrap.tiny').click();
  await expect(page.locator('.saved-popup').getByText('North quay')).toBeVisible();
});

test('picks a corner and removes it with Delete, Backspace taking the last one back', async ({ page }) => {
  const { at } = await openMap(page);
  await page.getByRole('button', { name: 'Save a place or a zone' }).click();
  await page.getByRole('menuitem', { name: 'Save zone' }).click();
  for (const [dx, dy] of [[-120, -80], [120, -80], [120, 80], [-120, 80]]) {
    const p = at(dx, dy);
    await page.mouse.click(p.x, p.y);
  }
  const corners = page.locator('.path-handle:not(.ghost)');
  await expect(corners).toHaveCount(4);
  await corners.nth(1).click();
  await expect(page.locator('.path-handle.picked')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(corners).toHaveCount(3);
  // Backspace takes the last one back, and Cancel leaves nothing behind
  await page.keyboard.press('Backspace');
  await expect(corners).toHaveCount(2);
  await page.locator('.footprint-panel').getByRole('button', { name: 'Cancel' }).click();
  await expect(corners).toHaveCount(0);
});
