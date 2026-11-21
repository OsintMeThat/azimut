import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A cell of The numbers says what the chart reads in it: a day written in French shows the
 * day the chart draws, a cell that is no day is underlined and says what would be, an empty
 * one shows what to write. What was typed stays as typed. The server is stood in for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const CATALOG = [{ id: 'n1', type: 'note', label: 'Strikes', attrs: { path: 'notes/Strikes.md', folder: '' }, provenance: made }];
const TIMELINE = { name: 'timeline', label: 'Timeline', counts: false, keys: ['layout', 'labels'], drawn: [0, 1] };
const svg = (rows) => `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 220" width="640" height="220"><title>Strikes</title><desc>${rows}</desc><rect width="640" height="220" fill="#fff"/></svg>`;

const CHART = ['::: chart', 'kind: timeline', 'title: Strikes', '| When | What happened |', '| --- | --- |',
  '| 1 Mar 2026 | First strike |', '| 3 Mar 2026 | Second strike |', '|  | Third strike |', ':::'].join('\n');
const NOTE = `Strikes on the coast.\n\n${CHART}\n`;

test('a day typed in French shows the day the chart draws, and a cell that is no day says what would be', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text: NOTE } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    // each event the block's rows hold, drawn as its row
    const rows = route.request().postDataJSON().text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).slice(1);
    return route.fulfill({
      status: 200, contentType: 'image/svg+xml', body: svg(rows.join(' / ')),
      headers: {
        'X-Chart-Title': JSON.stringify('Strikes'), 'X-Chart-Kind': JSON.stringify(TIMELINE), 'X-Note-Warnings': '[]',
        'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]',
      },
    });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Strikes"]').click();
  await expect(page.locator('.cm-content')).toContainText('Strikes on the coast.');

  const chart = page.locator('.cm-chart-block');
  await expect(chart.locator('.cm-chart-figure svg')).toBeVisible();
  await chart.getByRole('button', { name: 'The numbers' }).click();
  const numbers = chart.getByRole('group', { name: 'The numbers' });
  const cell = (row, col) => numbers.locator(`.cm-grid-cell[data-row="${row}"][data-col="${col}"]`);

  // the column says what it takes, and the empty cell what to write
  await expect(numbers.locator('thead .cm-grid-head[data-col="0"] .cm-grid-expects')).toHaveText('Days');
  await expect(numbers.locator('thead .cm-grid-head[data-col="1"] .cm-grid-expects')).toHaveCount(0);
  await expect(cell(2, 0).locator('.cm-grid-text')).toHaveAttribute('data-placeholder', '5 Mar 2026');

  await cell(2, 0).locator('.cm-grid-text').click();
  const field = numbers.locator('.cm-grid-input');
  await expect(field).toBeFocused();
  await field.fill('5 mars 2026');
  await field.press('Tab');
  // written as typed, read as the chart reads it, drawn
  await expect.poll(() => written.at(-1) ?? '').toBe(NOTE.replace('|  | Third strike |', '| 5 mars 2026 | Third strike |'));
  await expect(cell(2, 0).locator('.cm-grid-reading')).toHaveText('5 Mar 2026');
  await expect(cell(2, 0).locator('.cm-grid-text')).toContainText('5 mars 2026');
  await expect(chart.locator('.cm-chart-figure svg desc')).toContainText('| 5 mars 2026 | Third strike |');

  // a cell that is no day: underlined, and its title says what would be one
  await field.press('Escape');
  await cell(0, 0).locator('.cm-grid-text').click();
  await expect(field).toBeFocused();
  await field.fill('Mars rover');
  await field.press('Tab');
  await expect.poll(() => written.at(-1) ?? '').toContain('| Mars rover | First strike |');
  const unread = cell(0, 0).locator('.cm-grid-text');
  await expect(unread).toHaveClass(/cm-grid-unread/);
  await expect(unread).toHaveAttribute('title', 'Not read as a day. Try 5 Mar 2026, 05/03/2026 or 2026-03-05, in any language.');
  await expect(unread).toHaveCSS('text-decoration-style', 'dotted');
  await expect(cell(0, 0).locator('.cm-grid-reading')).toHaveCount(0);
});
