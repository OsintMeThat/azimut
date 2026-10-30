import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, mapPicture, repainted } from './app.fixture.js';

/**
 * The Measure tool on the flat map, driven in a real browser.
 *
 * What the terrain server and the sky answer is routed here, so each test asks
 * only what an analyst can see and what the backend was told. The same tool on
 * the globe is in satellite-3d.spec.js.
 */

const PROFILE = {
  distance_m: [0, 500, 1000, 1500],
  lat: [46.6, 46.6, 46.6, 46.6],
  lon: [7.9, 7.906, 7.912, 7.918],
  elevation: [800, 950, 870, 900],
  corners: [800, 900],
  resolution_m: 30,
  credits: [],
  sight: {
    visible: false, angle_deg: 0.9, margin_deg: -1.2, blocked_at_m: 500, eye_m: 801.7, target_m: 900,
    bulge_m: [0, 0, 0, 0], seen: [true, true, false, false],
  },
};

/** The map, the Measure tool open, and the servers it asks answered. */
async function openTool(page, options = {}) {
  const fixture = await installAppFixture(page, options);
  const asked = { profile: [], viewshed: [], shadow: [], shapes: [] };
  await page.route('**/api/terrain/profile', async (route) => {
    asked.profile.push(route.request().postDataJSON());
    await route.fulfill({ json: PROFILE });
  });
  await page.route('**/api/terrain/viewshed', async (route) => {
    const body = route.request().postDataJSON();
    asked.viewshed.push(body);
    await route.fulfill({
      json: { lat: body.lat, lon: body.lon, radius_m: body.radius_m, step_deg: 90, runs: [[0, 400], [0, 200], [], [0, 300]], share: 0.27 },
    });
  });
  await page.route('**/api/geo/shadow?**', async (route) => {
    asked.shadow.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    await route.fulfill({
      json: {
        date: '2024-06-21', zone: 'Europe/Zurich', sun_azimuth: 270,
        moments: [{ local: '2024-06-21T17:40:00+02:00', utc: '2024-06-21T15:40:00Z', abbreviation: 'CEST', sun_azimuth: 270, sun_altitude: 30, height_m: 23.4 }],
      },
    });
  });
  await page.route(`**/api/cases/${CASE_ID}/layer-targets`, (route) =>
    route.fulfill({
      json: [{ name: 'field-notes', title: 'Field notes', groups: [{ id: 'g1', name: 'Notes', mode: 'uniform', colour: '#0072b2' }], markers: [] }],
    })
  );
  await page.route(`**/api/cases/${CASE_ID}/map-layers/field-notes/shapes`, async (route) => {
    asked.shapes.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/#satellite?ll=46.6,7.9&z=15&p=esri-world-imagery');
  await awaitMapReady(page);
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const box = await page.locator('.map').boundingBox();
  return { fixture, asked, box, at: (x, y) => [box.x + x, box.y + y] };
}

// what the selected measure reads, in the panel's list: the status line carries none of it
const reading = (page) => page.locator('.measure-panel .list li.on .what');
const words = (page, kind) => page.locator(`.measure-word.${kind}`);
const zoom = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '').get('z');

test('a line is two clicks and a double click, its length and bearing written along it', async ({ page }) => {
  const { at } = await openTool(page);
  await expect(page.locator('.measure-panel')).toContainText('Click on the map to start a measure');
  const bare = await mapPicture(page);

  await page.mouse.click(...at(500, 200));
  // the stretch to come follows the pointer, with what it adds
  await page.mouse.move(...at(720, 200), { steps: 4 });
  await expect(page.locator('.measure-overlay .band')).toHaveCount(1);
  await expect(page.locator('.live')).toContainText(/\d+ m · 09\d°/);
  await page.mouse.dblclick(...at(720, 200));

  // finished on the double click, without the map zooming in on it
  await expect(page.locator('.measure-overlay .band')).toHaveCount(0);
  expect(zoom(page)).toBe('15');
  await expect(words(page, 'leg')).toHaveText(/^\d+ m · 09\d°$/);
  await expect(reading(page)).toHaveText(/^\d+ m · 09\d°$/);
  await expect(page.locator('.status')).not.toContainText('°');
  expect(repainted(bare, await mapPicture(page))).toBe(true);
  // a line of two points has a length and a bearing to type
  await expect(page.getByLabel('Length', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Bearing', { exact: true })).toBeVisible();
});

test('a click on the first point closes an area; Backspace takes the last point back', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 200));
  await page.mouse.click(...at(780, 200));
  await page.mouse.click(...at(780, 420));
  await page.mouse.click(...at(640, 480));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.measure-panel')).toContainText('click the first point for an area');
  await page.mouse.click(...at(502, 201));
  await expect(words(page, 'area')).toHaveText(/(m²|ha)$/);
  await expect(words(page, 'leg')).toHaveCount(3);
  await expect(page.locator('.measure-panel')).toContainText(/perimeter .* · 3 corners/);
});

test('a line typed to an exact length and bearing, then drawn as rings and a cone', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.dblclick(...at(700, 300));

  const length = page.getByLabel('Length', { exact: true });
  const bearing = page.getByLabel('Bearing', { exact: true });
  await length.fill('2.5 km');
  await length.press('Enter');
  await bearing.fill('NE');
  await bearing.press('Enter');
  await expect(reading(page)).toHaveText('2.50 km · 045°');

  await page.getByRole('button', { name: 'Ring' }).click();
  await expect(reading(page)).toHaveText('Radius 2.50 km');
  await page.getByRole('spinbutton').fill('3');
  await page.getByRole('spinbutton').press('Enter');
  await expect(page.locator('.measure-panel')).toContainText('out to 7.50 km');
  await expect(words(page, 'ring')).toHaveCount(2);

  await page.getByRole('button', { name: 'Cone' }).click();
  await expect(reading(page)).toHaveText('60° cone · 2.50 km');
  await expect(page.locator('.measure-panel')).toContainText('2.89 km across at B');

  // and the units the tool reads in, remembered
  await page.getByRole('button', { name: 'NM', exact: true }).click();
  await expect(reading(page)).toHaveText('60° cone · 1.35 NM');
});

test('two lines crossing are marked where they meet', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 200));
  await page.mouse.dblclick(...at(800, 450));
  await page.mouse.click(...at(800, 200));
  await page.mouse.dblclick(...at(500, 450));
  await expect(page.locator('.measure-crossing')).toHaveCount(1);
  await expect(page.locator('.measure-crossing')).toHaveAttribute('title', /The lines cross at .*Click to copy/);
});

test('the ground under a line is read on its switch, both ways with the map', async ({ page }) => {
  const { at, asked } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.dblclick(...at(780, 300));
  // the flat map asks the terrain server nothing until it is told to
  expect(asked.profile).toEqual([]);

  await page.getByRole('switch', { name: /Ground/ }).check();
  await expect(page.getByText('Ground along measure 1')).toBeVisible();
  expect(asked.profile[0]).toMatchObject({ sight: true, eye_height: 1.7, target_height: 0 });
  await expect(page.getByText(/ground in the way at 500 m/)).toBeVisible();
  await expect(page.getByText('+0.9°')).toBeVisible();

  // a new eye height asks again
  await page.getByLabel('Eye at A').fill('10');
  await page.getByLabel('Eye at A').press('Enter');
  // the usual heights are a press away
  await page.getByLabel('The usual target heights').selectOption('3');
  await expect.poll(() => asked.profile.at(-1)?.target_height).toBe(3);
  // and the crest coloured by its slope rather than its sight
  await page.getByRole('button', { name: 'Slope', exact: true }).click();
  await expect(page.locator('.legend .band')).toHaveCount(5);
  await expect.poll(() => asked.profile.at(-1)?.eye_height).toBe(10);

  // the window folds to its title bar, its verdict still read there, and opens folded again
  await page.getByRole('button', { name: 'Fold Ground along measure 1' }).click();
  await expect(page.getByRole('slider', { name: /Heights along the line/ })).toHaveCount(0);
  await expect(page.getByText(/ground in the way at 500 m/)).toBeVisible();
  await page.getByRole('button', { name: 'Unfold Ground along measure 1' }).click();

  // the chart walked with the arrows, and Enter brings that point to the middle
  const chart = page.getByRole('slider', { name: /Heights along the line/ });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('Enter');
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('ll')).toMatch(/^46\.6\d*,7\.91\d*/);

  // closed, the chart comes back from the panel's Chart button
  await page.getByRole('button', { name: 'Close Ground along measure 1' }).click();
  await expect(page.getByText('Ground along measure 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await expect(page.getByText('Ground along measure 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chart', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a corner pressed and let go where it stands starts no measure on it', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.dblclick(...at(780, 300));
  await expect(page.locator('.path-handle.named')).toHaveCount(2);
  // pressed a little off the dot, where the hand lands as often as on it
  const b = await page.locator('.path-handle.named').last().boundingBox();
  await page.mouse.click(b.x + b.width / 2 + 12, b.y + b.height / 2);
  await expect(page.getByText('Click the next point')).toHaveCount(0);
  await expect(page.locator('.path-handle.named')).toHaveCount(2);
  // and taken there, it moves B
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(...at(780, 420), { steps: 6 });
  await page.mouse.up();
  // the drop leaves the line in hand, no measure started where B was let go
  await expect(page.locator('.path-handle.named')).toHaveCount(2);
  await expect(page.getByText('Click the next point')).toHaveCount(0);
  const moved = await page.locator('.path-handle.named').last().boundingBox();
  expect(moved.y).toBeGreaterThan(b.y + 60);
});

test('a line used as a viewshed reads the ground in sight from A', async ({ page }) => {
  const { at, asked } = await openTool(page);
  const bare = await mapPicture(page);
  await page.mouse.click(...at(520, 300));
  await page.mouse.dblclick(...at(760, 300));
  await page.getByRole('button', { name: 'Viewshed' }).click();
  await expect(page.locator('.measure-panel')).toContainText(/27% of the ground within \d+ m in sight/);
  expect(asked.viewshed[0]).toMatchObject({ eye_height: 1.7, target_height: 0 });
  await expect(words(page, 'use')).toHaveText('27% in sight');
  expect(repainted(bare, await mapPicture(page))).toBe(true);
});

test('a shadow drawn on a dated day says how tall its caster is and the hour', async ({ page }) => {
  const { at, asked } = await openTool(page);
  await page.mouse.click(...at(760, 300));
  await page.mouse.dblclick(...at(680, 300));
  await page.getByRole('button', { name: 'Shadow' }).click();
  // the picture's own day is the one read, else the one typed
  const day = page.getByLabel('The day the picture was taken');
  await day.fill('21/06/2024');
  await day.press('Enter');
  await expect(page.locator('.measure-panel .answer')).toHaveText('About 23 m tall (sun at 270°, 30.0° up at 17:40 CEST)');
  expect(asked.shadow.at(-1)).toMatchObject({ date: '2024-06-21' });
  expect(Number(asked.shadow.at(-1).bearing)).toBeGreaterThan(260);
  await expect(words(page, 'use')).toHaveText('≈ 23 m tall');
});

test('a measure is kept in a layer, named by what it reads', async ({ page }) => {
  const { at, asked } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.dblclick(...at(780, 300));
  await page.getByRole('button', { name: 'Keep' }).click();
  await page.getByRole('button', { name: /Field notes/ }).click();
  await expect.poll(() => asked.shapes.length).toBe(1);
  expect(asked.shapes[0]).toMatchObject({ label: 'on', geometry: { type: 'LineString' } });
  expect(asked.shapes[0].name).toMatch(/^\d+ m · 09\d°$/);
  expect(asked.shapes[0].description).toMatch(/^Distance .* bearing 09\d\.\d°/);
  // it is the layer's now, and off the tool
  await expect(words(page, 'leg')).toHaveCount(0);
});

test('Escape finishes what is drawn, lets go of it, then puts the tool away', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.click(...at(780, 300));
  await page.keyboard.press('Escape');
  await expect(words(page, 'leg')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.measure-panel .detail')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.measure-panel')).toHaveCount(0);
  // the measures wait, hidden, for the tool to open again
  await expect(words(page, 'leg')).toBeHidden();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await expect(words(page, 'leg')).toBeVisible();
});

test('the panel folds to one line, what the measure in hand reads', async ({ page }) => {
  const { at } = await openTool(page);
  await page.mouse.click(...at(500, 300));
  await page.mouse.dblclick(...at(780, 300));
  await page.getByRole('button', { name: 'Fold the measure panel' }).click();
  await expect(page.locator('.measure-panel .tiles')).toHaveCount(0);
  await expect(page.locator('.measure-panel .compact')).toHaveText(/^\d+ m · 09\d°$/);
  // folded it stays, the next time the tool opens
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unfold the measure panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Unfold the measure panel' }).click();
  await expect(page.locator('.measure-panel .list')).toBeVisible();
});
