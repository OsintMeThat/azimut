import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture, PANEL_PATH } from './app.fixture.js';

// Find where it was taken: Horizon's third mode, three columns, the area drawn
// and an alignment made by its four clicks, then the search, its places and a
// look from one; the mode and the work come back after a reload. The terrain is not served here and the search's
// routes answer from the spec, so what is checked is the screen and its flow.

const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAbCAIAAAC1C5slAAAAWklEQVR42mNwy1swqBDDqINGHTTqoFEHjToIzUHTKgKAiEjVEMU0Vc8A14NfG7IymqpnIEYPVtNppJ4BvzY8RtNIPQORRtANjTpo1EGjDhp10KiDRh001B0EACZm1btZqPSgAAAAAElFTkSuQmCC',
  'base64'
);

const DONE = {
  name: 'panel search',
  status: 'done',
  progress: { done: 64, total: 64 },
  ask: { area: [[46.55, 7.82], [46.55, 7.85], [46.57, 7.85], [46.57, 7.82]], who: { mode: 'ground', low: 1.7, high: 1.7 } },
  result: {
    verdict: 'match',
    places: [
      { lat: 46.5586, lon: 7.8353, explained: 0.86, heading: 95.4, fov: 58, tilt: 1.2, roll: 0, reach: 20000, height: 1.7 },
      { lat: 46.5402, lon: 7.8601, explained: 0.52, heading: 101, fov: 60, tilt: 0.4, roll: 0, reach: 20000, height: 1.7 },
    ],
    points: [
      { lat: 46.5586, lon: 7.8353, explained: 0.86, spacing: 250 },
      { lat: 46.5402, lon: 7.8601, explained: 0.52, spacing: 250 },
    ],
  },
};

/** The mode switch on screen: the tab's header, or Find's own over it. */
const modes = (page) => page.getByRole('group', { name: 'Horizon mode' }).last();

async function openFind(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installAppFixture(page);
  const asked = [];
  await page.route('**/api/horizon/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/horizon/finds/estimate')) return route.fulfill({ json: { points: 64, coarse: 64, spacing: 250, step: 0.5 } });
    return route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } });
  });
  let reads = 0;
  await page.route(`**/api/cases/${CASE_ID}/horizon/finds**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith('/horizon/finds')) {
      asked.push(request.postDataJSON());
      return route.fulfill({ json: { name: 'panel search', status: 'queued', progress: { done: 0, total: 0 } } });
    }
    if (request.url().endsWith('/horizon/finds')) return route.fulfill({ json: [] });
    reads += 1;
    return route.fulfill({ json: reads > 1 ? DONE : { ...DONE, status: 'running', progress: { done: 30, total: 64 }, result: null } });
  });
  await page.route(`**/files/${CASE_ID}/${PANEL_PATH}*`, (route) => route.fulfill({ contentType: 'image/png', body: PHOTO_PNG }));
  await page.goto('/#horizon?ll=46.5586,7.8353&hd=95&tl=0&fov=60&r=plain');
  // Overlay asks for the photo when none is laid
  await modes(page).getByRole('button', { name: 'Overlay' }).click();
  await page.getByText('panel.svg').first().click();
  await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  await modes(page).getByRole('button', { name: 'Find' }).click();
  const find = page.getByRole('region', { name: 'Find where it was taken' });
  await expect(find).toBeVisible();
  return { fixture, find, asked };
}

/** A stroke along the photo's ridge, drawn freely (Alt). */
async function trace(page, find) {
  await find.getByRole('button', { name: 'Trace skyline' }).click();
  const box = await find.locator('.fp').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.48);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(box.x + box.width * (0.15 + i * 0.05), box.y + box.height * (0.48 - 0.02 * Math.sin(i)), { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await find.getByRole('button', { name: 'Trace skyline' }).click();
}

test.describe('Find where it was taken', () => {
  test('opens over Horizon in three columns, each enlarged and given back, the tab under it out of reach', async ({ page }) => {
    const { find } = await openFind(page);
    await expect(find.getByRole('region', { name: 'Photo and its skyline' })).toBeVisible();
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeVisible();
    await expect(find.getByRole('complementary', { name: 'Steps' })).toBeVisible();
    // the tab under it takes no focus and no click while Find is open
    await expect(page.locator('.hz-main')).toHaveAttribute('inert', '');
    await expect(page.locator('.hz-inspector')).toHaveAttribute('inert', '');
    await find.getByRole('button', { name: 'Enlarge the photo' }).click();
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(find.getByRole('region', { name: 'Map and the area' })).toBeVisible();
    await find.getByRole('button', { name: 'Hide the steps' }).click();
    await expect(find.getByRole('complementary', { name: 'Steps' })).toHaveCount(0);
    await find.getByRole('button', { name: 'Show the steps' }).click();
    await find.getByRole('group', { name: 'Horizon mode' }).getByRole('button', { name: 'Overlay' }).click();
    await expect(find).toHaveCount(0);
    await expect(page.locator('.hz-main')).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });

  test('takes the trace on the photo and holds the search until the area is drawn', async ({ page }) => {
    const { find } = await openFind(page);
    await expect(find.getByText('Trace the skyline on the photo, or press Detect.')).toBeVisible();
    await trace(page, find);
    await expect(find.getByText(/1 line traced/)).toBeVisible();
    await expect(find.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    await expect(find.getByText('Draw the area on the map.')).toBeVisible();
  });

  test('draws the area, makes an alignment by its four clicks, searches and looks from the best place', async ({ page }) => {
    const { find, asked } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    const at = (fx, fy) => [map.x + map.width * fx, map.y + map.height * fy];
    await find.getByRole('button', { name: 'Draw the area' }).click();
    await expect(page.getByText('Click each corner of the area on the map.', { exact: false }).first()).toBeVisible();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65], [0.35, 0.65]]) await page.mouse.click(...at(fx, fy));
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await expect(find.getByText(/km²/)).toBeVisible();
    await expect(find.getByText('64 points, about a minute.')).toBeVisible();

    // an alignment: the near thing and the far one on the photo, then on the map
    const before = await find.locator('.fp').boundingBox();
    await find.getByRole('button', { name: 'Add an alignment' }).click();
    const photo = await find.locator('.fp').boundingBox();
    // the guide is said in the column that waits for the click: nothing moves aside
    expect(photo).toEqual(before);
    const photoColumn = find.getByRole('region', { name: 'Photo and its skyline' });
    const mapColumn = find.getByRole('region', { name: 'Map and the area' });
    await expect(photoColumn.getByText('1 of 4 · On the photo, click something near')).toBeVisible();
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.6);
    await page.mouse.click(photo.x + photo.width * 0.5, photo.y + photo.height * 0.45);
    // both points show on the photo before the map is asked
    await expect(find.locator('.fp-dot')).toHaveCount(2);
    await expect(mapColumn.getByText('3 of 4 · On the map, click the near one')).toBeVisible();
    await expect(photoColumn.getByText(/of 4 ·/)).toHaveCount(0);
    await page.mouse.click(...at(0.5, 0.45));
    await page.mouse.click(...at(0.52, 0.2));
    await expect(find.getByText('Lined up')).toBeVisible();

    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(find.getByText('One place stands out')).toBeVisible({ timeout: 10_000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].area).toHaveLength(4);
    expect(asked[0].alignments).toHaveLength(1);
    expect(asked[0].trace.x.length).toBeGreaterThan(5);
    const places = find.locator('.fs-place');
    await expect(places).toHaveCount(2);
    await expect(places.first()).toContainText('explains 86%');
    await places.first().click();
    await expect(find).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });

  test('marks a ridge in front of the skyline, pairs them, cuts the collage and sends it all to the search', async ({ page }) => {
    const { find, asked, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const photo = await find.locator('.fp').boundingBox();
    const on = (fu, fv) => [photo.x + photo.width * fu, photo.y + photo.height * fv];
    // a ridge in front, under the skyline's middle, drawn freely with its own pen
    await find.getByRole('button', { name: 'Trace a ridge' }).click();
    await expect(find.getByText(/Draw along a ridge seen against farther land/)).toBeVisible();
    const magnet = find.getByRole('button', { name: 'Snap to edges' });
    await expect(magnet).toHaveAttribute('aria-pressed', 'true');
    await magnet.click();
    await expect(magnet).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.move(...on(0.35, 0.62));
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(...on(0.35 + i * 0.04, 0.62 - 0.01 * i), { steps: 2 });
    await page.mouse.up();
    await expect(find.locator('.fp-trace.ridge')).toHaveCount(1);
    await expect(find.getByText(/2 lines traced: 1 ridge/)).toBeVisible();
    // the ridge in front of the skyline: a letter on each
    await find.getByRole('button', { name: 'Pair a line in front with one behind' }).click();
    await expect(find.getByText(/Click the line in front/)).toBeVisible();
    await page.mouse.click(...on(0.51, 0.58));
    await expect(find.getByText(/Now click the line behind it/)).toBeVisible();
    const sky = await find.locator('.fp-trace:not(.ridge):not(.picked)').first().evaluate((line) => line.getAttribute('points').split(' ')[6].split(',').map(Number));
    const box = await find.locator('.fp').boundingBox();
    await page.mouse.click(box.x + sky[0], box.y + sky[1]);
    await expect(find.locator('.fp-pair')).toHaveCount(2);
    await expect(find.getByText(/1 ridge · 1 pair/)).toBeVisible();
    // a cut down the collage
    await find.getByRole('button', { name: 'Cut the collage' }).click();
    await page.mouse.click(...on(0.5, 0.2));
    await expect(find.locator('.fp-cut')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(find.getByText(/2 lines traced: 1 ridge · 1 pair · 2 pieces/)).toBeVisible();

    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.length).toBe(1);
    const sent = asked[0].trace;
    expect(sent.ridge_x.length).toBeGreaterThan(3);
    expect(sent.pairs).toEqual([[1, 0]]);
    expect(new Set(sent.piece)).toEqual(new Set([0, 1]));
    expect(asked[0].photo.marks.inner).toHaveLength(1);
    // and the marks are kept with the work in the case
    await expect.poll(() => fixture.workWrites.at(-1)?.photo?.marks?.cuts?.length ?? 0, { timeout: 5000 }).toBe(1);
  });

  test('straightens the photo from its lens’s curve, the trace kept on it, and searches with the curve', async ({ page }) => {
    const { find, asked, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const line = find.locator('.fp-trace').first();
    const before = await line.getAttribute('points');
    const lens = find.getByRole('button', { name: 'Lens curve' });
    await lens.click();
    await expect(lens).toHaveAttribute('aria-expanded', 'true');
    const slider = find.getByRole('slider', { name: 'Lens distortion' });
    await expect(slider).toHaveAttribute('aria-valuetext', 'None');
    await slider.evaluate((input) => {
      input.value = '-0.15';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(slider).toHaveAttribute('aria-valuetext', 'Barrel 0.15');
    await expect(lens).toContainText('Barrel 0.15');
    // the stroke follows the photo as it straightens; it is kept on the photo's own pixels
    await expect.poll(() => line.getAttribute('points')).not.toBe(before);
    const kept = () => fixture.workWrites.at(-1)?.photo;
    await expect.poll(() => kept()?.bend, { timeout: 15000 }).toBe(-0.15);
    const strokes = kept().strokes;
    // None puts it back, the stroke where it was
    await find.getByRole('button', { name: 'None', exact: true }).click();
    await expect(slider).toHaveAttribute('aria-valuetext', 'None');
    await expect.poll(() => line.getAttribute('points')).toBe(before);
    await expect.poll(() => kept()?.bend, { timeout: 15000 }).toBe(0);
    expect(kept().strokes).toEqual(strokes);
    await slider.evaluate((input) => {
      input.value = '0.1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.keyboard.press('Escape');
    await expect(find.locator('#fp-curve')).toHaveCount(0);

    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await find.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0].photo.bend).toBe(0.1);
    expect(asked[0].photo.strokes).toEqual(strokes);
  });

  test('the mode is in the address, and a reload brings it back with the photo, its trace and the area', async ({ page }) => {
    const { find, fixture } = await openFind(page);
    await awaitMapReady(page, 2);
    await trace(page, find);
    const map = await find.getByRole('region', { name: 'Map and the area' }).boundingBox();
    await find.getByRole('button', { name: 'Draw the area' }).click();
    for (const [fx, fy] of [[0.35, 0.35], [0.65, 0.35], [0.65, 0.65]]) await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
    await find.getByRole('button', { name: 'Done', exact: true }).first().click();
    await expect(page).toHaveURL(/md=find/);
    // the bench is written a moment after the last change
    await expect.poll(() => fixture.workWrites.at(-1)?.find?.area?.length ?? 0, { timeout: 5000 }).toBe(3);
    expect(fixture.workWrites.at(-1).photo.strokes.length).toBe(1);

    await page.reload();
    const again = page.getByRole('region', { name: 'Find where it was taken' });
    await expect(again).toBeVisible();
    await expect(again.getByText(/1 line traced/)).toBeVisible();
    await expect(again.getByText(/km²/)).toBeVisible();
    // and Back leaves Find for the mode before it
    await page.goBack();
    await expect(again).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Photo over the view' })).toBeVisible();
  });
});
