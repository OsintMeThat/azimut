import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Leads, and the place a dropped pin asks a name for. While a scene is geolocated,
 * Satellite's Drop a lead arms a mode in which each click on the map drops one of its
 * leads, numbered in the scene's colour; the pill counts them and lists what the scene
 * gathered, where a lead goes in a press. With no scene geolocated the same button reads
 * Save place, and a click drops a pin that asks for its name before it is saved.
 */

const VIDEO = 'media/steps.webm';
const CAPTURE = 'media/capture-bridge.png';

async function openMap(page, { geolocated = true, places = [] } = {}) {
  await page.setViewportSize({ width: 1500, height: 900 });
  const media = [
    { path: VIDEO, filename: 'steps.webm', title: 'Convoy clip', kind: 'video', entity_id: 'e_steps', size: 100, source: { type: 'upload' }, thumbnail: null, folder: '' },
  ];
  const fixture = await installAppFixture(page, { media, savedIndexes: { [CASE_ID]: places } });
  const server = { leads: [], calls: [], geolocating: geolocated ? 'sc_1' : null };
  const current = () => (server.geolocating
    ? {
      kind: 'draft', video: VIDEO, id: 'sc_1', start: 0.4, end: 0.9, label: 'Road bridge?', state: 'progress',
      captures: [CAPTURE], footage: 0, abandoned: null, file_kind: 'video', order: 1, since: 't',
      ...(server.leads.length ? { leads: server.leads.map((lead) => ({ ...lead })) } : {}),
    }
    : null);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    const base = `/api/cases/${CASE_ID}`;
    if (path === `${base}/scenes/queue`) return json({ files: [], geolocating: current() });
    if (path === `${base}/geolocating` && method === 'GET') return json({ geolocating: current() });
    if (path === `${base}/geolocating/leads` && method === 'POST') {
      const { lat, lon } = request.postDataJSON();
      const lead = { id: `ld_${server.leads.length + 1}`, n: server.leads.length + 1, lat, lon };
      server.leads.push(lead);
      server.calls.push(`drop ${lead.id}`);
      return json({ lead, geolocating: current() });
    }
    const one = new RegExp(`^${base}/geolocating/leads/([^/]+)$`).exec(path);
    if (one && method === 'DELETE') {
      server.leads = server.leads.filter((lead) => lead.id !== one[1]);
      server.calls.push(`delete ${one[1]}`);
      return json({ geolocating: current() });
    }
    if (path === `${base}/geolocating/gathered`) {
      return json({
        geolocating: current(), leads: server.leads,
        captures: [{ path: CAPTURE, title: 'Bridge from above', thumb: null }], frames: [], collages: [],
      });
    }
    return route.fallback();
  });
  await page.goto('/#satellite');
  await awaitMapReady(page);
  return { fixture, server };
}

/** A click on the map, off its middle, away from the rail and the status line. */
async function clickMap(page, dx = 120, dy = -60) {
  const box = await page.locator('.map[data-map-ready="true"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

test('drops leads where the map is clicked while a scene is geolocated, and lets one go from the pill', async ({ page }) => {
  const { server } = await openMap(page);
  const drop = page.getByRole('button', { name: 'Drop a lead' });
  await expect(drop).toBeVisible();
  await expect(drop).toHaveAttribute('aria-pressed', 'false');

  // a click with the mode off is a click on the map, and drops nothing
  await clickMap(page);
  await page.waitForTimeout(300);
  expect(server.calls).toEqual([]);

  await drop.click();
  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await clickMap(page, 120, -60);
  await expect.poll(() => server.calls).toEqual(['drop ld_1']);
  // the mode stays armed for the next one
  await clickMap(page, -140, 40);
  await expect.poll(() => server.calls).toEqual(['drop ld_1', 'drop ld_2']);
  await expect(page.locator('.sat-lead')).toHaveCount(2);
  await expect(page.locator('.sat-lead').nth(1)).toHaveAttribute('title', 'Lead 2: drag to move, click to centre');
  // the second one stands where it was clicked, left of the first
  const [first, second] = await Promise.all([0, 1].map((i) => page.locator('.sat-lead').nth(i).boundingBox()));
  expect(second.x).toBeLessThan(first.x);

  // Escape ends the mode
  await page.keyboard.press('Escape');
  await expect(drop).toHaveAttribute('aria-pressed', 'false');

  // the pill counts them, and its list lets one go
  const pill = page.locator('.geo-pill');
  await expect(pill.getByTestId('geolocating-leads')).toHaveText('2');
  await pill.getByTestId('geolocating-count').click();
  const list = page.getByTestId('gathered-panel');
  await expect(list.getByRole('heading', { name: 'Leads' })).toBeVisible();
  await expect(list.getByRole('heading', { name: 'Map captures' })).toBeVisible();
  await list.getByRole('button', { name: 'Delete lead 1' }).click();
  await expect.poll(() => server.calls).toContain('delete ld_1');
  await expect(page.locator('.sat-lead')).toHaveCount(1);
  await expect(pill.getByTestId('geolocating-leads')).toHaveText('1');
});

test('asks a name for a pin dropped with no scene geolocated, and saves it as a place', async ({ page }) => {
  const { fixture } = await openMap(page, { geolocated: false });
  const save = page.getByRole('button', { name: 'Save place' });
  await save.click();
  await clickMap(page);

  const namer = page.getByTestId('place-namer');
  await expect(namer).toBeVisible();
  const field = namer.getByRole('textbox', { name: 'Name of the place' });
  await expect(field).toBeFocused();
  // nothing is saved without a name
  await expect(namer.getByRole('button', { name: 'Save' })).toBeDisabled();
  await field.press('Enter');
  expect(fixture.placeWrites).toEqual([]);

  await field.fill('Water tower');
  await field.press('Enter');
  await expect.poll(() => fixture.placeWrites.length).toBe(1);
  expect(fixture.placeWrites[0]).toMatchObject({ title: 'Water tower' });
  expect(Number.isFinite(fixture.placeWrites[0].lat)).toBe(true);
  await expect(namer).toHaveCount(0);

  // a place is saved one at a time: the mode ended with it
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  // and Escape lets a pin waiting go, which ends it too
  await save.click();
  await clickMap(page, -100, 50);
  await expect(namer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(namer).toHaveCount(0);
  await expect(save).toHaveAttribute('aria-pressed', 'false');
});

test('shows a pale pin under the pointer while the drop is armed, a lead with its next number while geolocating', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: 'Drop a lead' }).click();
  const box = await page.locator('.map[data-map-ready="true"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  const ghost = page.locator('.sat-ghost');
  await expect(ghost).toHaveCount(1);
  await expect(ghost.locator('text')).toHaveText('1');
  await clickMap(page, 80, 0);
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40);
  await expect(ghost.locator('text')).toHaveText('2');
  // off the map it goes, and with the mode
  await page.mouse.move(box.x - 40, box.y + 20);
  await expect(ghost).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(ghost).toHaveCount(0);
});

test('draws the case’s places with the Places layer on by default, and turns it back on when a place is saved', async ({ page }) => {
  const { fixture } = await openMap(page, {
    geolocated: false,
    places: [{ id: 'place-1', key: 'place-1', kind: 'place', title: 'North depot', lat: 48.859, lon: 2.295 }],
  });
  const places = page.getByRole('button', { name: 'Places', exact: true });
  await expect(places).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Media', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Captures', exact: true })).toHaveCount(0);
  await places.click();
  await expect(places).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Save place' }).click();
  await clickMap(page);
  const field = page.getByTestId('place-namer').getByRole('textbox', { name: 'Name of the place' });
  await field.fill('Depot');
  await field.press('Enter');
  await expect.poll(() => fixture.placeWrites.length).toBe(1);
  await expect(places).toHaveAttribute('aria-pressed', 'true');
});
