import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A chart's rows in the note: The numbers is a grid to type in, a column the chart does not
 * draw kept and marked, the drawing following each cell; and rows copied from a sheet follow
 * the sheet by themselves, Ctrl+Z bringing the old copy back. The server is stood in for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const CATALOG = [{ id: 'n1', type: 'note', label: 'Losses', attrs: { path: 'notes/Losses.md', folder: '' }, provenance: made }];
const svg = (words, rows) => `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 220" width="640" height="220"><title>${words}</title><desc>${rows}</desc><rect width="640" height="220" fill="#fff"/></svg>`;

/** The note `text`, saved as it is typed; the figure route drawing each block's rows; `rows` what `from:` reads. */
async function withNote(page, text, { kind, rows = () => ({ found: false }) }) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const figures = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure/rows`, (route) => route.fulfill({ json: rows(route.request().postDataJSON()) }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    const body = route.request().postDataJSON();
    figures.push(body.text);
    const title = /\ntitle: (.*)\n/.exec(body.text)?.[1] ?? 'Chart';
    const table = body.text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).join(' / ');
    return route.fulfill({
      status: 200, contentType: 'image/svg+xml', body: svg(title, table),
      headers: {
        'X-Chart-Title': JSON.stringify(title), 'X-Chart-Kind': JSON.stringify(kind), 'X-Note-Warnings': '[]',
        'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]',
      },
    });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Losses"]').click();
  await expect(page.locator('.cm-content')).toContainText(text.split('\n')[0]);
  return { written, figures };
}

const last = (written) => () => written.at(-1) ?? '';

test('the owner’s wall: a column it does not draw is kept and marked, its rows typed in The numbers, the drawing following', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const WALL = ['::: chart', 'kind: pictures', 'title: At least 3 vehicles, one frame each', '| Picture | # | Model | State |', '| --- | --- | --- | --- |',
    '| e_0000000001 | #1 | Streit Cougar | burned |', '| e_0000000002 | #2 | Streit Cougar | burned |', '| e_0000000003 | #3 | Oshkosh M-ATV | abandoned |', ':::'].join('\n');
  const NOTE = `Losses on the road.\n\n${WALL}\n`;
  const PICTURES = { name: 'pictures', label: 'Picture wall', counts: true, per_row: true, keys: ['picture', 'label', 'words', 'shape'], roles: ['picture', 'label', 'words', ''] };
  const { written } = await withNote(page, NOTE, { kind: PICTURES });
  const chart = page.locator('.cm-chart-block');
  await expect(chart.locator('.cm-chart-figure svg')).toBeVisible();

  await chart.getByRole('button', { name: 'The numbers' }).click();
  const numbers = chart.getByRole('group', { name: 'The numbers' });
  await expect(numbers.locator('.cm-chart-numbers-data')).toHaveText('DataIts own rowsChange…');
  // each column drawn says its part; State is no group and no colour: kept, greyed and marked, never refused
  await expect(numbers.locator('thead .cm-grid-head .cm-grid-expects')).toHaveText(['Picture', 'Label', 'Words']);
  await expect(numbers.locator('thead .cm-grid-head[data-col="3"] .cm-grid-idle-mark')).toHaveText('not drawn');
  await expect(numbers.locator('.cm-grid-idle-mark')).toHaveCount(1);
  await expect(numbers.getByRole('button', { name: 'As a form' })).toBeVisible();
  await expect(numbers.getByRole('button', { name: 'Fill from the case…' })).toBeVisible();
  await expect(numbers.getByRole('button', { name: 'Edit them as text' })).toHaveCount(0);

  // a cell typed: its line only, the drawing drawn again from it
  await numbers.locator('.cm-grid-cell[data-row="1"][data-col="2"] .cm-grid-text').click();
  const field = numbers.locator('.cm-grid-input');
  await expect(field).toBeFocused();
  await field.fill('Streit Cougar 6x6');
  await field.press('Tab');
  const TYPED = NOTE.replace('| e_0000000002 | #2 | Streit Cougar | burned |', '| e_0000000002 | #2 | Streit Cougar 6x6 | burned |');
  await expect.poll(last(written)).toBe(TYPED);
  await expect(chart.locator('.cm-chart-figure svg desc')).toContainText('Streit Cougar 6x6');
  // the keyboard is in the next cell, the column not drawn, typed in as any other
  await expect(numbers.locator('.cm-grid-input')).toBeFocused();
  await numbers.locator('.cm-grid-input').fill('captured');
  await numbers.locator('.cm-grid-input').press('Escape');
  await expect.poll(last(written)).toBe(TYPED.replace('| Streit Cougar 6x6 | burned |', '| Streit Cougar 6x6 | captured |'));
  // one Undo a cell
  await page.keyboard.press('Control+z');
  await expect.poll(last(written)).toBe(TYPED);
});

test('a chart drawn from a sheet follows the sheet by itself, and Ctrl+Z brings its old copy back', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const TABLE = '| Model | Grade |\n| --- | --- |\n| Streit Cougar | Confirmed |\n| Al-Wahsh | Almost sure |';
  const CHART = ['::: chart', 'kind: bars', 'title: At least 2 vehicles, by model', 'count: rows', 'by: Model', 'from: sheet:s1', TABLE, ':::'].join('\n');
  const NOTE = `Losses on the road.\n\n${CHART}\n\nAfter.\n`;
  const SHEET = `${TABLE}\n| Harrow Tygor E1 | Confirmed |`;
  const BARS = { name: 'bars', label: 'Bars', counts: true, parts: false, stacked: false, keys: [], roles: ['groups', ''] };
  const { written } = await withNote(page, NOTE, { kind: BARS, rows: () => ({ found: true, name: 'Vehicle register', text: SHEET, rows: 3 }) });
  const chart = page.locator('.cm-chart-block');

  // the sheet gained a row while the note was closed: its copy follows without a press
  const FOLLOWED = NOTE.replace(`${TABLE}\n:::`, `${SHEET}\n:::`);
  await expect.poll(last(written)).toBe(FOLLOWED);
  await expect(chart.locator('.cm-chart-figure svg desc')).toContainText('Harrow Tygor E1');
  await expect(chart.getByRole('button', { name: 'Read again' })).toHaveCount(0);
  await chart.getByRole('button', { name: 'The numbers' }).click();
  const numbers = chart.getByRole('group', { name: 'The numbers' });
  await expect(numbers.locator('.cm-chart-numbers-data')).toHaveText('DataSheet “Vehicle register”·Open in SheetChange…');

  // Ctrl+Z: the old copy comes back, and stays, said as such
  await page.locator('.cm-line', { hasText: 'After.' }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(last(written)).toBe(NOTE);
  await expect(numbers.locator('.cm-chart-numbers-data')).toContainText('an older copy, kept by Undo');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(600);
  expect(last(written)()).toBe(NOTE);
});
