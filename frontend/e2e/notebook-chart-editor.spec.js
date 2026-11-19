import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A chart made in the note from a table: Chart in the grid's bar shows the kinds the
 * table fits drawn from its rows, the one picked is written under the table and drawn,
 * its title is set on the chart and taken back by Undo, Read again follows the table it
 * came from, and Export downloads the picture for X. The server is stood in for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const CATALOG = [{ id: 'n1', type: 'note', label: 'Register', attrs: { path: 'notes/Register.md', folder: '' }, provenance: made }];
const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | identified | 8 |\n| Al-Wahsh | almost sure | 2 |';
const NOTE = `Who made them.\n\n## Count\n\n${TABLE}\n\nAfter.`;
const svg = (words) => `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 220" width="640" height="220"><title>${words}</title><rect width="640" height="220" fill="#fff"/><rect x="40" y="60" width="400" height="24" fill="#184f95"/><text x="40" y="40">${words}</text></svg>`;
const KINDS = {
  rows: 2,
  kinds: [
    { kind: 'bars', label: 'Bars', settings: { kind: 'bars', count: 'At least', by: 'Model' }, title: 'At least 10, by model', svg: svg('Bars') },
    {
      kind: 'stacked bars', label: 'Stacked', settings: { kind: 'stacked bars', count: 'At least', by: 'Model', 'colour by': 'Grade' },
      title: 'At least 10, by model and grade', svg: svg('Stacked'),
    },
  ],
};
const STACKED = { name: 'stacked bars', label: 'Stacked', counts: true, parts: false, stacked: true, up: false, turns: 'stacked columns', style: 'report' };

async function withNote(page) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const asked = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text: NOTE } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure/kinds`, (route) => {
    asked.push({ kinds: route.request().postDataJSON() });
    return route.fulfill({ json: KINDS });
  });
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    const body = route.request().postDataJSON();
    asked.push({ figure: body });
    const title = /\ntitle: (.*)\n/.exec(body.text)?.[1] ?? 'Chart';
    const headers = {
      'X-Chart-Title': JSON.stringify(title), 'X-Chart-Proposed-Title': JSON.stringify('At least 10 vehicles, by model and grade'),
      'X-Chart-Kind': JSON.stringify(STACKED), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
      'X-Note-Warning-Fixes': '[]',
    };
    if (body.format === 'png') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), headers });
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(title), headers });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Register"]').click();
  await expect(page.locator('.cm-content')).toContainText('Who made them.');
  return { written, asked };
}

const last = (written) => () => written.at(-1) ?? '';

test('a chart is picked by its picture from a table, set on itself, read again and exported', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const { written, asked } = await withNote(page);

  // Chart in the grid's bar: the kinds this table fits, each drawn from its rows
  await page.locator('.cm-grid-chart').click();
  const picker = page.getByRole('dialog', { name: 'Pick a chart' });
  await expect(picker.locator('button.cm-chart-pick')).toHaveCount(2);
  await expect(picker).toContainText('Drawn from this table’s 2 rows');
  expect(asked[0].kinds.text).toBe(TABLE);
  await picker.getByRole('button', { name: 'Stacked' }).click();
  const chart = page.locator('.cm-chart-block');
  await expect(chart.locator('.cm-chart-figure svg')).toBeVisible();
  const CHART = ['::: chart', 'kind: stacked bars', 'title: At least 10, by model and grade', 'count: At least', 'by: Model',
    'colour by: Grade', 'from: note:n1#count', TABLE, ':::'].join('\n');
  const CHARTED = `Who made them.\n\n## Count\n\n${TABLE}\n\n${CHART}\n\nAfter.`;
  await expect.poll(last(written)).toBe(CHARTED);
  await expect(chart.getByRole('button', { name: 'Kind: Stacked' })).toBeVisible();

  // its title, set on the chart, one step Undo takes back
  await chart.getByRole('button', { name: 'Settings' }).click();
  const title = chart.getByRole('textbox', { name: 'Title' });
  await title.fill('At least 10 armoured vehicles, by model and grade');
  await title.press('Enter');
  await expect.poll(last(written)).toBe(CHARTED.replace('title: At least 10, by', 'title: At least 10 armoured vehicles, by'));
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('At least 10 armoured vehicles, by model and grade');
  await page.locator('.cm-line', { hasText: 'After.' }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(last(written)).toBe(CHARTED);

  // a row of the table changed: Read again copies it into the chart
  await expect(chart.getByRole('button', { name: 'Read again' })).toBeHidden();
  await page.locator('.cm-grid-cell[data-row="1"][data-col="1"]').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('identified');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(chart.getByRole('button', { name: 'Read again' })).toBeVisible();
  await chart.getByRole('button', { name: 'Read again' }).click();
  const moved = TABLE.replace('| Al-Wahsh | almost sure | 2 |', '| Al-Wahsh | identified | 2 |');
  await expect.poll(last(written)).toBe(`Who made them.\n\n## Count\n\n${moved}\n\n${CHART.replace(TABLE, moved)}\n\nAfter.`);
  await expect(chart.getByRole('button', { name: 'Read again' })).toBeHidden();

  // the picture for X, downloaded from the route
  await chart.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /For X/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('At least 10, by model and grade (X).png');
  expect(asked.at(-1).figure).toMatchObject({ format: 'png', size: 'x', note: 'n1' });
});
