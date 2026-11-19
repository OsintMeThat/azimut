import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * An infographic's Data line, in the note: a sheet of the case set as its data from the
 * source picker (the charts copied from a table of its columns take it, their rows read in),
 * changed to another sheet, then a row of that sheet edited elsewhere: the line says it
 * changed since, and Read again (all panels) copies the rows into every panel that reads it,
 * key figures typed in left alone, one Undo taking it back.
 */

const ROWS = ['| Model | Grade |', '| --- | --- |', '| Streit Cougar | Confirmed |', '| Al-Wahsh | Almost sure |'];
const FIGURES = ['::: chart', 'kind: key figures', '| Figure | Words |', '| --- | --- |', '| 51 of 54 | placed |', ':::'].join('\n');
const chart = (kind, title) => ['::: chart', `kind: ${kind}`, `title: ${title}`, 'count: rows', 'by: Model', 'colour by: Grade',
  'from: note:n1#register', ...ROWS, ':::'].join('\n');
const GRAPHIC = [':::: infographic', 'title: At least 2 vehicles lost', '', FIGURES, '', chart('bars', 'Lost'), '', chart('pie', 'Grades'), '::::'].join('\n');
const TEXT = ['# Losses', '', GRAPHIC, '', '## Register', '', ...ROWS, ''].join('\n');
const svg = (words) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${words}</title></svg>`;

/** The case's two sheets, as `GET /notes/figure/sources` lists them and `POST /notes/figure/rows` reads them. */
const SHEETS = {
  's1': { title: 'Vehicle register', rows: [['Streit Cougar', 'Confirmed'], ['Al-Wahsh', 'Almost sure'], ['Oshkosh M-ATV', 'Confirmed']] },
  's2': { title: 'Sightings', rows: [['Streit Cougar', 'Confirmed'], ['BMC Kirpi II', 'Confirmed']] },
};
const tableOf = (rows) => ['| Model | Grade |', '| --- | --- |', ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Losses', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], rows: [] };
  let text = TEXT;
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Losses', folder: '', updated_at: at, excerpt: '', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/figure/sources') {
      return route.fulfill({ json: { tables: [], sheets: Object.entries(SHEETS).map(([id, sheet]) => ({
        origin: `sheet:${id}`, title: sheet.title, rows: sheet.rows.length, columns: ['Model', 'Grade'] })) } });
    }
    if (path === '/figure/rows') {
      const { origin } = request.postDataJSON();
      state.rows.push(origin);
      const sheet = SHEETS[origin.replace('sheet:', '')];
      return route.fulfill({ json: sheet ? { found: true, name: sheet.title, text: tableOf(sheet.rows), rows: sheet.rows.length }
        : { found: false, name: '', text: '', rows: 0 } });
    }
    if (path === '/figure/kinds') return route.fulfill({ json: { rows: 0, kinds: [] } });
    if (path === '/infographic') {
      return route.fulfill({ json: { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">${svg('Page')}</svg>`,
        width: 1200, height: 800, title: '', look: 'report', panels: [], legend: { column: '', values: [] }, credit: '', alt: '', warnings: [] } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: {} } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        text = request.postDataJSON().text;
        state.written.push(text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text } });
    }
    return route.fallback();
  });
  return state;
}

/** The infographic as last saved. */
const saved = (state) => /^:::: infographic\n[\s\S]*?\n::::$/m.exec(String(state.written.at(-1) ?? ''))?.[0] ?? '';
/** How many rows each chart panel of the saved infographic holds. */
const rowsOf = (graphic) => graphic.split(/^::: chart$/m).slice(1)
  .map((panel) => panel.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).length - 1);

test('a sheet set as the infographic’s data, changed, then read again into every panel that reads it', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Losses"]').click();
  const line = page.locator('.cm-block-infographic .cm-ig-data');
  await expect(line).toContainText('None');
  await expect(line).toContainText('each panel keeps its own rows');

  // Choose data…: the sheets first, recommended; the one picked is the page's data
  await line.getByRole('button', { name: 'Choose data…' }).click();
  const menu = page.locator('.float-menu[aria-label="Data"]');
  await expect(menu.locator('.dp-rec')).toHaveText('Recommended');
  await expect(menu.locator('.fm-item .fm-grow')).toHaveText(['Vehicle register', 'Sightings', 'Register', 'New data…']);
  await menu.locator('.fm-item', { hasText: 'Vehicle register' }).click();
  await expect.poll(() => saved(state)).toContain('data: sheet:s1\n');
  // the two charts copied from the register take it, their rows read in; the key figures stay
  expect(saved(state)).not.toContain('from: note:n1#register');
  expect(rowsOf(saved(state))).toEqual([1, 3, 3]);
  await expect(line).toContainText('Sheet “Vehicle register”');
  await expect(line).toContainText('3 rows · 2 panels read it');

  // Change…: another sheet of the same columns
  await line.getByRole('button', { name: 'Change…' }).click();
  await menu.locator('.fm-item', { hasText: 'Sightings' }).click();
  await expect.poll(() => saved(state)).toContain('data: sheet:s2\n');
  expect(rowsOf(saved(state))).toEqual([1, 2, 2]);
  await expect(line).toContainText('2 rows · 2 panels read it');
  await expect(line.getByRole('button', { name: 'Read again (all panels)' })).toHaveCount(0);

  // a row added to the sheet elsewhere: back in the window, the line says it changed since
  SHEETS.s2.rows.push(['Harrow Tygor E1', 'Almost sure']);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(line).toContainText('changed since');
  const before = state.written.at(-1);
  await line.getByRole('button', { name: 'Read again (all panels)' }).click();
  await expect.poll(() => rowsOf(saved(state))).toEqual([1, 3, 3]);
  await expect(line).not.toContainText('changed since');
  expect(saved(state)).toContain('| Harrow Tygor E1 | Almost sure |');

  // one Undo takes the whole Read again back
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => state.written.at(-1)).toBe(before);
});
