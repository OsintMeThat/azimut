import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A page started from a ready template, in the note: the infographic's data is a sheet of
 * the case, Start from a template… lists the ready ones, Losses at a glance meets the
 * sheet's columns by name and asks the one it does not name (its Status, the sheet's
 * State), and the page is written as one change: its panels drawn, the key figures' own
 * form open to fill, one Undo taking the whole page back.
 *
 * The server's answers are stood in for (`/templates/figure/apply`, its engine is the
 * Python suite's); what is checked is what the browser asks, shows and writes.
 */

const SHEET = ['| Grade | State | Type | Date | What happened |', '| --- | --- | --- | --- | --- |',
  '| Confirmed | destroyed | tank | 2026-10-05 | Hit on the road |', '| Almost sure | abandoned | truck | 2026-10-06 | Left in a ditch |'].join('\n');
const GRAPHIC = [':::: infographic', 'data: sheet:s1', 'title: At least 2 vehicles lost', '::::'].join('\n');
const TEXT = ['# Losses', '', GRAPHIC, ''].join('\n');
const READY = [{ id: 'losses-at-a-glance', name: 'Losses at a glance', about: 'Key figures, pictograms by grade, a donut, segments and a timeline',
  data: { figure: 'infographic', text: ':::: infographic\nlook: report\n::::' } }];
const chart = (lines) => ['::: chart', ...lines, ':::'].join('\n');
/** What the engine writes once the State is given for the template's Status. */
const APPLIED = [':::: infographic', 'data: sheet:s1', 'look: report', 'widths: wide, half, half, wide, wide', '',
  [chart(['kind: key figures', 'rows: own', '| Figure | What it says |', '| --- | --- |']),
    chart(['kind: pictograms', 'title: 2 rows, by grade', 'count: rows', 'by: Grade', SHEET]),
    chart(['kind: donut', 'title: 2 rows, by state', 'count: rows', 'by: State', SHEET]),
    chart(['kind: segments', 'title: 2 rows, by type', 'count: rows', 'by: Type', SHEET]),
    chart(['kind: timeline', 'by: What happened', SHEET])].join('\n\n'), '::::'].join('\n');
const NEEDS = [
  { column: 'Grade', match: 'Grade', suggest: '', counts: false, required: true, uses: [{ panel: 1, kind: 'Pictograms', role: 'parts' }] },
  { column: 'Status', match: '', suggest: '', counts: false, required: true, uses: [{ panel: 2, kind: 'Donut', role: 'parts' }] },
  { column: 'Type', match: 'Type', suggest: '', counts: false, required: true, uses: [{ panel: 3, kind: 'Segments', role: 'parts' }] },
];
const COLUMNS = ['Grade', 'State', 'Type', 'Date', 'What happened'];

/** The drawing the route answers: the panels' kinds in its title, a box each. */
function drawing(text) {
  const kinds = [...text.matchAll(/^kind: (.*)$/gm)].map((match) => match[1]);
  const panels = kinds.map((kind, index) => ({ index, kind: 'chart', chart: kind, title: '', width: 'half',
    x: 48 + (index % 2) * 550, y: 120 + Math.floor(index / 2) * 320, w: 528, h: 300 }));
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800"><title>${kinds.join(', ') || 'Empty'}</title>`
      + '<rect width="1200" height="800" fill="#fff"/></svg>',
    width: 1200, height: 800, title: '', look: 'report', panels, legend: { column: '', values: [] }, credit: '', alt: '', warnings: [],
  };
}

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Losses', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], applied: [] };
  let text = TEXT;
  await page.route('**/api/templates/figure/ready', (route) => route.fulfill({ json: { ready: READY } }));
  await page.route('**/api/templates/figure/apply', (route) => {
    const body = route.request().postDataJSON();
    state.applied.push(body);
    if (!body.mapping) return route.fulfill({ json: { ask: true, needs: NEEDS, columns: COLUMNS } });
    return route.fulfill({ json: { ask: false, needs: NEEDS, columns: COLUMNS, text: APPLIED,
      panels: ['own', 'data', 'data', 'data', 'data'].map((reads, index) => ({ index, kind: '', reads, notes: [] })) } });
  });
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
      return route.fulfill({ json: { tables: [], sheets: [{ origin: 'sheet:s1', title: 'Vehicle register', rows: 2, columns: COLUMNS }] } });
    }
    if (path === '/figure/rows') return route.fulfill({ json: { found: true, name: 'Vehicle register', text: SHEET, rows: 2 } });
    if (path === '/figure/kinds') return route.fulfill({ json: { rows: 0, kinds: [] } });
    if (path === '/figure') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
        headers: { 'X-Chart-Title': '""', 'X-Chart-Proposed-Title': '""', 'X-Chart-Kind': JSON.stringify({ name: 'key figures', counts: false }),
          'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]' } });
    }
    if (path === '/infographic') return route.fulfill({ json: drawing(request.postDataJSON().text) });
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

test('a ready template meets the page’s sheet, asks the column it does not name, and draws its panels', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Losses"]').click();
  await page.locator('.cm-block-infographic [data-ig-edit]').click();
  const builder = page.getByRole('complementary', { name: 'Infographic builder' });
  await expect(builder).toBeVisible();
  await expect(builder.locator('.ib-data-line')).toContainText('Vehicle register');

  // the ready ones, the page's data said
  await builder.getByRole('button', { name: 'Start from a template…' }).click();
  const picker = page.locator('.float-menu[aria-label="Start from a template"]');
  await expect(picker).toContainText('With Sheet “Vehicle register”');
  await picker.locator('.fm-item', { hasText: 'Losses at a glance' }).click();
  expect(state.applied[0]).toMatchObject({ table: SHEET, origin: 'sheet:s1', mapping: null });

  // Match the columns: the template's Status is the sheet's State
  const step = picker.getByRole('group', { name: 'Match the columns' });
  await expect(step).toContainText('Status');
  await expect(step).toContainText('Donut: its parts');
  await step.getByLabel('The data’s column for Status').selectOption({ label: 'State' });
  await picker.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => state.applied.length).toBe(2);
  expect(state.applied[1]).toMatchObject({ mapping: { Status: 'State' }, rows: [] });

  // one change: the page's own title kept, five panels drawn, the key figures' form open to fill
  await expect.poll(() => saved(state)).toContain('kind: pictograms');
  const written = saved(state);
  expect(written).toContain('title: At least 2 vehicles lost');
  expect(written).toContain('data: sheet:s1');
  await expect(builder.locator('.ib-panel-title')).toHaveText(['Key figures', '2 rows, by grade', '2 rows, by state', '2 rows, by type', 'Timeline']);
  await expect(page.locator('.cm-block-infographic svg title').first()).toHaveText('key figures, pictograms, donut, segments, timeline');
  await expect(builder.locator('.ib-card')).toBeVisible();
  await expect(page.locator('.toast').filter({ hasText: 'Started from “Losses at a glance”' })).toBeVisible();

  // one Undo takes the whole page back
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(state)).toBe(GRAPHIC);
});
