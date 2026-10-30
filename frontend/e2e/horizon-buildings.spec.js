import { expect, test } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

// The buildings switch in Horizon's panel: what it says about the area, the
// question before a download, and its settings. The terrain is not served here
// (every other Horizon route answers that it is missing), and the app's answer
// about the area is a fixed one, so this is about the words and the controls.

const AREA = {
  tiles: [{ key: '14/8411/5844', ready: true, version: 'v1' }],
  pending: 0,
  counts: { measured: 90, estimated: 0, range: 0, unknown: 10 },
  footprints: { ign: 90, osm: 10 },
  sources: [
    { id: 'ign', label: 'BD TOPO® (IGN)', licence: 'Licence Ouverte 2.0', link: 'https://geoservices.ign.fr/bdtopo', oldest: '2010-07-15', newest: '2026-05-29' },
  ],
  failed: [],
  retry_in: 0,
  needs: [{ grid: 'g.zip', size: 40_000_000, source: 'globfp', label: '3D-GloBFP' }],
  downloads: [],
};

async function openHorizon(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAppFixture(page);
  const asked = { area: 0, allowed: [] };
  // registered after the fixture's, so these answer first
  await page.route('**/api/horizon/**', (route) => route.fulfill({ status: 404, json: { detail: 'No terrain in the browser fixture' } }));
  await page.route('**/api/horizon/buildings?**', (route) => {
    asked.area += 1;
    // once the analyst said yes, the grid downloads
    const downloading = { ...AREA, needs: [], downloads: [{ grid: 'g.zip', source: 'globfp', done: 10e6, total: 40e6, error: '' }] };
    return route.fulfill({ json: asked.allowed.length ? downloading : AREA });
  });
  await page.route('**/api/horizon/buildings/tiles?**', (route) => route.fulfill({ body: Buffer.alloc(4), contentType: 'application/octet-stream' }));
  await page.route('**/api/horizon/buildings/allow', async (route) => {
    asked.allowed.push(route.request().postDataJSON());
    return route.fulfill({ json: { started: ['g.zip'] } });
  });
  await page.goto('/#horizon?ll=45.7578,4.8320&hd=60&tl=0&fov=60&r=plain');
  return asked;
}

test.describe('buildings in Horizon', () => {
  test('ask nothing until switched on, then say where the heights come from', async ({ page }) => {
    const asked = await openHorizon(page);
    const box = page.getByRole('checkbox', { name: 'Buildings' });
    await expect(box).toBeVisible();
    await page.waitForTimeout(1200);
    expect(asked.area).toBe(0);
    await box.check();
    await expect(page.getByText('100 buildings · heights 90% measured, 10% unknown', { exact: false })).toBeVisible();
    expect(asked.area).toBeGreaterThan(0);
  });

  test('ask over the view before a download, with its size, then show it coming', async ({ page }) => {
    const asked = await openHorizon(page);
    await page.getByRole('checkbox', { name: 'Buildings' }).check();
    const note = page.getByRole('region', { name: 'Buildings' });
    await expect(note).toContainText('To download here: 3D-GloBFP (about 2020) 40 MB');
    await note.getByRole('button', { name: 'Download 3D-GloBFP (40 MB)' }).click();
    await expect.poll(() => asked.allowed).toEqual([{ grids: ['g.zip'] }]);
    await expect(page.getByText('Downloading 3D-GloBFP 10 MB of 40 MB')).toBeVisible();
  });

  test('open their settings beside the view, unknown heights at a storey by default', async ({ page }) => {
    await openHorizon(page);
    await page.getByRole('checkbox', { name: 'Buildings' }).check();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Buildings settings' });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Height an unknown building is drawn at')).toHaveValue('3');
    await expect(panel.getByText('The Fit ignores buildings for now.')).toBeVisible();
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();
  });
});
