import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A pictogram chart's icons set on its card: Icon › an icon of the library, then One per
 * category, each model its own, then Import SVG…, the SVG drawn as a picture by the browser
 * and sent beside it, the icon worn at once. The server is stood in for.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAh0lEQVR4nO2VSw6AIAxEiQfh/kfhVrpyY6j9IjOJXdNp3yOB1v5K1uj9zPQfVYtsWeCmz1jgNfCkjlrgNCDRRizwGdAovRa4DFjpPBZ4DHjv1nqew0D0lbP04RvI/vdaP7aBLL0lB9dAFb2Wh2mgmv4tF8/AKnopH8vAavrZHBwDX9HvmifWBdq+OpCxNuWeAAAAAElFTkSuQmCC', 'base64');
const COUGAR = 'aaaaaaaaaaaaaaaa';
const MATV = 'bbbbbbbbbbbbbbbb';
const TRUCK = 'eeeeeeeeeeeeeeee';
const at = '2026-10-01T10:00:00Z';
const CATALOG = [{ id: 'n1', type: 'note', label: 'Register', attrs: { path: 'notes/Register.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
const CHART = [
  '::: chart', 'kind: pictograms', 'title: At least 17 armoured vehicles, by model', 'count: At least', 'by: Model',
  '| Model | At least |', '| --- | ---: |', '| Streit Cougar | 8 |', '| Oshkosh M-ATV | 7 |', '| Al-Wahsh | 2 |', ':::',
].join('\n');
const NOTE = `Count.\n\n${CHART}\n\nAfter.`;
const KIND = {
  name: 'pictograms', label: 'Pictograms', counts: true, parts: true, stacked: false, up: false, turns: '', style: 'report',
  keys: ['icon', 'icons', 'per glyph'], values: ['Streit Cougar', 'Oshkosh M-ATV', 'Al-Wahsh'],
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="az-chart" viewBox="0 0 640 220" width="640" height="220"><title>Chart</title><rect width="640" height="220" fill="#fff"/></svg>';
const TRUCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><path d="M8 4h32v16H8z" fill="#222"/></svg>';

async function withChart(page) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const imports = [];
  const library = [
    { key: COUGAR, name: 'Cougar', group: 'Vehicles', mode: 'disc' },
    { key: MATV, name: 'M-ATV', group: 'Vehicles', mode: 'disc' },
  ];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text: NOTE } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: SVG,
    headers: {
      'X-Chart-Title': JSON.stringify('At least 17 armoured vehicles, by model'), 'X-Chart-Proposed-Title': '""',
      'X-Chart-Kind': JSON.stringify(KIND), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
      'X-Note-Warning-Fixes': '[]',
    },
  }));
  await page.route('**/api/icons', async (route) => {
    if (route.request().method() === 'POST') {
      imports.push(route.request().postDataBuffer().toString('latin1'));
      const added = { key: TRUCK, name: 'Truck', group: 'My icons', mode: 'disc', vector: true };
      library.push(added);
      return route.fulfill({ json: { added: [added], already: 0, skipped: [], filed: [{ name: 'Truck', key: TRUCK }], icons: library } });
    }
    return route.fulfill({ json: { icons: library, max: 1000 } });
  });
  await page.route('**/api/icons/*.png', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.goto('/#notebook');
  await page.locator('button[title="Open Register"]').click();
  await expect(page.locator('.cm-content')).toContainText('Count.');
  return { written, imports };
}

const last = (written) => () => written.at(-1) ?? '';
const withLine = (line) => NOTE.replace('by: Model\n', `by: Model\n${line}\n`);

test('a pictogram chart takes an icon of the library, one per model, and an SVG imported on the spot', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const { written, imports } = await withChart(page);
  const chart = page.locator('.cm-chart-block');
  await chart.getByRole('button', { name: 'Settings' }).click();
  const icons = chart.getByRole('group', { name: 'Icons' });

  // Icon › an icon of the library
  await icons.getByRole('button', { name: 'Icon: Dot' }).click();
  const picker = page.getByRole('dialog', { name: 'Icon' });
  await expect(picker.getByRole('region', { name: 'Vehicles' }).first().getByRole('button', { name: 'Cougar' })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Armoured vehicle' })).toBeVisible();
  await picker.getByRole('searchbox', { name: 'Find an icon' }).fill('cougar');
  await expect(picker.getByRole('button', { name: 'Armoured vehicle' })).toBeHidden();
  await picker.getByRole('button', { name: 'Cougar' }).click();
  await expect.poll(last(written)).toBe(withLine(`icon: own:${COUGAR}`));
  await expect(icons.getByRole('button', { name: 'Icon: Cougar' })).toBeVisible();

  // One per category: each model the icon named like it, the others the chart's
  await icons.getByRole('radio', { name: 'One per category' }).click();
  await expect.poll(last(written)).toBe(withLine(`icon: own:${COUGAR}\nicons: Streit Cougar = own:${COUGAR}, Oshkosh M-ATV = own:${MATV}, Al-Wahsh = own:${COUGAR}`));
  await expect(icons.getByRole('button', { name: 'Icon of Oshkosh M-ATV: M-ATV' })).toBeVisible();
  await expect(icons).toContainText('Streit Cougar, Oshkosh M-ATV took the icon named like them; the others keep the chart’s icon.');

  // Import SVG… for one model: drawn by the browser, sent with its SVG, worn at once
  await icons.getByRole('button', { name: 'Icon of Al-Wahsh: Cougar' }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('dialog', { name: 'Icon of Al-Wahsh' }).getByRole('button', { name: 'Import SVG…' }).click(),
  ]);
  await chooser.setFiles({ name: 'Truck.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(TRUCK_SVG) });
  await expect.poll(last(written)).toBe(withLine(`icon: own:${COUGAR}\nicons: Streit Cougar = own:${COUGAR}, Oshkosh M-ATV = own:${MATV}, Al-Wahsh = own:${TRUCK}`));
  expect(imports).toHaveLength(1);
  expect(imports[0]).toContain('name="files"; filename="Truck.svg"');
  expect(imports[0]).toContain('\x89PNG');
  expect(imports[0]).toMatch(/name="vectors"\r\n\r\n<svg[^\r]*viewBox="0 0 48 24"[^\r]*><path d="M8 4h32v16H8z" fill="#222"/);
  await expect(page.getByRole('dialog', { name: 'Icon of Al-Wahsh' })).toBeHidden();
});
