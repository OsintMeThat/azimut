import { expect, test } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The analyst's own icons: a copied map editing with the icons it came with,
 * the library offered beside them, and Settings › Icons importing a file.
 *
 * The first thing pinned is that a copied map whose markers all wear their own
 * icons can be opened and edited at all: the first build's preview looped an
 * effect for ever there, and every button of the app stopped answering.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAh0lEQVR4nO2VSw6AIAxEiQfh/kfhVrpyY6j9IjOJXdNp3yOB1v5K1uj9zPQfVYtsWeCmz1jgNfCkjlrgNCDRRizwGdAovRa4DFjpPBZ4DHjv1nqew0D0lbP04RvI/vdaP7aBLL0lB9dAFb2Wh2mgmv4tF8/AKnopH8vAavrZHBwDX9HvmifWBdq+OpCxNuWeAAAAAElFTkSuQmCC', 'base64');
const OWN = 'abcdef0123456789';
const SPARE = '0123456789abcdef';
const TANK = { key: 'aaaaaaaaaaaaaaaa', name: 'Tank', group: 'Armour', mode: 'disc' };

async function iconsFixture(page) {
  await installAppFixture(page);
  const library = [TANK];
  const sent = { selection: [], imports: 0 };
  const row = { name: 'copy', title: 'Africa copy', editable: true, source: { kind: 'editable' }, origin: null, features: 30,
    categories: [{ name: 'Markers', count: 30, colour: '#0072b2', kinds: ['point'] }], icons: 2, hidden: [], refresh: {},
    sha256: '1'.repeat(64), edit_revision: '0'.repeat(64), edit_changed: false };
  const features = Array.from({ length: 30 }, (_, index) => ({ type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.35 + (index % 6) * 0.002, 48.85 + Math.floor(index / 6) * 0.002] },
    properties: { key: `k${index}`, name: `Site ${index + 1}`, category: 'Markers', group: 'markers', colour: '#0072b2',
      symbol: 'pin', icon: index % 2 ? OWN : SPARE } }));
  const groups = [{ id: 'markers', name: 'Markers', mode: 'individual', colour: '#0072b2', symbol: 'pin', size: 1, stroke: 2 }];
  const answer = () => ({ layer: row, groups, icons: {}, checkpoint: null, document: { type: 'FeatureCollection', features } });

  await page.route('**/api/icons', async (route) => {
    if (route.request().method() === 'POST') {
      sent.imports += 1;
      const added = { key: 'cccccccccccccccc', name: 'Truck', group: 'My icons', mode: 'image' };
      library.push(added);
      return route.fulfill({ json: { added: [added], already: 0, skipped: [], icons: library } });
    }
    return route.fulfill({ json: { icons: library, max: 1000 } });
  });
  await page.route('**/api/icons/*.png', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: [row] }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.split('/map-layers/')[1];
    const [name, action, key] = path.split('/');
    if (name !== row.name) return route.fallback();
    if (action === 'icons' && key) return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (action === 'icons') return route.fulfill({ json: [
      { key: OWN, digest: OWN, mode: 'image', name: 'Strike', count: 15 },
      { key: SPARE, digest: SPARE, mode: 'image', name: 'Camp', count: 15 }] });
    if (action === 'edit') return route.fulfill({ json: answer() });
    if (action === 'data') return route.fulfill({ json: { type: 'FeatureCollection', features: features.map((feature, index) => ({
      ...feature, id: index, properties: { ...feature.properties, index, icon_mode: 'image', icon_scale: 1, stroke_width: 2 } })) } });
    if (action === 'selection') {
      const body = route.request().postDataJSON();
      sent.selection.push(body.changes);
      for (const feature of features) if (body.keys.includes(feature.properties.key)) Object.assign(feature.properties, body.changes);
      row.sha256 = String(sent.selection.length).repeat(64).slice(0, 64);
      return route.fulfill({ json: answer() });
    }
    return route.fallback();
  });
  return sent;
}

test('a copied map wearing its own icons edits, and offers them beside the library', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sent = await iconsFixture(page);
  await page.goto('/#satellite?ll=48.854,2.355&z=15'); await awaitMapReady(page);
  await page.getByRole('button', { name: 'Edit Africa copy', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Layer editor', exact: true });
  await panel.getByRole('button', { name: 'Site 2', exact: true }).click();
  await panel.getByRole('button', { name: 'Feature style', exact: true }).click();
  const palette = page.getByRole('group', { name: 'Feature style picker', exact: true });
  await expect(palette.getByText("This layer's icons", { exact: true })).toBeVisible();
  await expect(palette.getByText('Armour', { exact: true })).toBeVisible();
  await expect(palette.getByText('This icon keeps its own colours.', { exact: true })).toBeVisible();
  await expect(palette.getByRole('button', { name: 'Feature style Strike icon, this layer', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // a colour leaves the icon on; the library's icon replaces it
  await palette.getByRole('button', { name: 'Feature style orange', exact: true }).click();
  await expect.poll(() => sent.selection.at(-1)).toEqual({ colour: '#d55e00' });
  await palette.getByRole('button', { name: 'Feature style Tank icon, Armour', exact: true }).click();
  await expect.poll(() => sent.selection.at(-1)).toEqual({ icon: TANK.key });
  await page.screenshot({ path: test.info().outputPath('own-icons-palette.png') });
  await page.keyboard.press('Escape');

  // the app still answers
  await panel.getByRole('button', { name: 'Done', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Edit Africa copy', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Settings › Icons imports a file and lists the library by group', async ({ page }) => {
  const sent = await iconsFixture(page);
  await page.goto('/#settings');
  await page.getByRole('button', { name: 'Icons', exact: true }).click();
  await expect(page.locator('.group-name')).toHaveValue('Armour');
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'truck.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').filter({ hasText: '1 added' })).toBeVisible();
  expect(sent.imports).toBe(1);
  await expect(page.locator('.group-name')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Name of Truck', exact: true })).toBeVisible();
});
