import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A chart made in the note from a table: Chart in the grid's bar shows the kinds the
 * table fits drawn from its rows, the one picked is written under the table and drawn,
 * its title is set on the chart and taken back by Undo, its rows follow the table they came
 * from by themselves, and Export downloads the picture for X. The server is stood in for.
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

async function withNote(page, text = NOTE) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const asked = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
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
  await expect(page.locator('.cm-content')).toContainText(text.split('\n')[0].replace(/^#+ /, ''));
  return { written, asked };
}

const last = (written) => () => written.at(-1) ?? '';

test('a chart is picked by its picture from a table, set on itself, follows its table and is exported', async ({ page, browserName }) => {
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

  // a row of the table changed: the chart's copy follows by itself, no press
  await expect(chart.getByRole('button', { name: 'Read again' })).toHaveCount(0);
  await page.locator('.cm-grid-block .cm-grid-cell[data-row="1"][data-col="1"]').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('identified');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  const moved = TABLE.replace('| Al-Wahsh | almost sure | 2 |', '| Al-Wahsh | identified | 2 |');
  await expect.poll(last(written)).toBe(`Who made them.\n\n## Count\n\n${moved}\n\n${CHART.replace(TABLE, moved)}\n\nAfter.`);

  // the picture for X, downloaded from the route
  await chart.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /For X/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('At least 10, by model and grade (X).png');
  expect(asked.at(-1).figure).toMatchObject({ format: 'png', size: 'x', note: 'n1' });
});

/**
 * A long folded table far above, the cursor away from what is pressed: the note stays
 * where it is when a chart's settings take the keyboard. The editor never reads the note's
 * line height off a heading (`editor/heights.js`), and the table keeps the height it was
 * drawn at in the editor's height map once it is made again out of sight, never the guess
 * made before it was drawn: either one wrong moved the chart by hundreds of pixels.
 */
const LONG = Array.from({ length: 48 }, (_, at) => `| ${at + 1} | Vehicle ${at + 1} | A long remark that wraps onto several lines in a note set at its usual width, as the register's do |`);
const FAR = ['# The register', '', '| # | Model | Remark |', '| --- | --- | --- |', ...LONG, '',
  ...Array.from({ length: 90 }, (_, at) => `Paragraph ${at + 1} between the table and the chart.\n`),
  ['::: chart', 'kind: bars', 'title: At least 2, by model', 'count: rows', 'by: Model', '| Model | Grade |', '| --- | --- |', '| A | identified |', '| B | almost sure |', ':::'].join('\n'),
  '', 'The end.'].join('\n');

test('a chart’s settings far below a long table leave the note where it is, the table its drawn height', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the height map is the editor’s, alike in both browsers');
  await withNote(page, FAR);
  const scroller = page.locator('.cm-scroller');
  const grid = page.locator('.cm-grid-block').first();
  /** The table's height in the editor's height map, and as it was last drawn. */
  const heights = () => page.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    return { map: view.lineBlockAt(view.state.doc.toString().indexOf('| # |')).height, drawn: window.gridDrawn ?? 0 };
  });
  for (const where of ['top', 'table']) {
    // the cursor on the note's heading, or on the table, the table drawn once in passing
    await scroller.evaluate((node) => { node.scrollTop = 0; });
    if (where === 'top') await page.locator('.cm-line').first().click();
    else {
      await grid.click({ position: { x: 4, y: 4 } });
      await expect(grid).toHaveClass(/cm-picked/);
    }
    await grid.evaluate((node) => { window.gridDrawn = node.getBoundingClientRect().height; });
    expect((await heights()).drawn).toBeGreaterThan(1200);
    // far down to the chart: out of sight, the table is drawn only while the cursor is on it
    const chart = page.locator('.cm-chart-block');
    for (let step = 0; step < 80 && !(await chart.count()); step += 1) await scroller.evaluate((node) => node.scrollBy(0, 400));
    await chart.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await expect(grid).toHaveCount(where === 'top' ? 0 : 1);
    await expect(chart.locator('.cm-chart-figure svg')).toBeVisible();
    const before = await chart.evaluate((node) => node.getBoundingClientRect().top);
    await chart.getByRole('button', { name: 'Settings' }).click();
    await expect(chart.getByRole('textbox', { name: 'Title' })).toBeFocused();
    await page.waitForTimeout(400);
    expect(Math.abs((await chart.evaluate((node) => node.getBoundingClientRect().top)) - before)).toBeLessThan(2);
    // the cursor left for the chart: the table is no longer drawn, and keeps its height
    await expect(grid).toHaveCount(0);
    const { map, drawn } = await heights();
    expect(Math.abs(map - drawn)).toBeLessThan(2);
    await chart.getByRole('button', { name: 'Settings' }).click();
  }
});
