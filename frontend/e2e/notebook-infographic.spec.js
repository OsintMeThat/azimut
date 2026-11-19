import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * An infographic built from a table of the note: `/` › Infographic writes a starter of three
 * panels made of the note's own rows (the offers route, stood in for here), the builder opens
 * beside the note, a panel moves down with Alt+↓ (one Undo takes it back), and Export as a
 * picture asks the server for X's 16:9 and hands the picture over as a download.
 */

const TABLE = ['| Made in | Vehicles |', '| --- | ---: |', '| UAE | 22 |', '| USA | 9 |', '| Jordan | 2 |'];
const TEXT = ['# Lead', '', 'Seen at the quay.', '', '## Makers', '', ...TABLE, '', ''].join('\n');
const chart = (kind, title) => ['::: chart', `kind: ${kind}`, `title: ${title}`, 'count: Vehicles', 'by: Made in',
  'source: our vehicle register', ...TABLE, ':::'].join('\n');
const PANELS = [chart('bars', 'At least 33 vehicles, by maker'), chart('donut', 'Where they were made'), chart('segments', 'All 33')];
const STARTER = [':::: infographic', 'widths: half, half, wide', '', PANELS.join('\n\n'), '::::'].join('\n');
/** A one-pixel PNG: what the picture route answers here. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** The drawing the route answers: a box per panel, in reading order, as the engine lays them out. */
function drawing(text) {
  const titles = [...text.matchAll(/^title: (.*)$/gm)].map((match) => match[1]).slice(0);
  const kinds = [...text.matchAll(/^kind: (.*)$/gm)].map((match) => match[1]);
  const panels = kinds.map((kind, index) => ({ index, kind: 'chart', chart: kind, title: titles[index] ?? '', width: 'half',
    x: 48 + (index % 2) * 550, y: 120 + Math.floor(index / 2) * 320, w: 528, h: 300 }));
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800"><title>${kinds.join(', ')}</title>`
      + '<rect width="1200" height="800" fill="#fff"/></svg>',
    width: 1200, height: 800, title: '', look: 'report', panels, legend: { column: '', values: [] }, credit: 'our vehicle register',
    alt: '', warnings: [],
  };
}

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], offers: [], pictures: [] };
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
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/infographic/offers') {
      state.offers.push(request.postDataJSON());
      return route.fulfill({ json: {
        tables: [{ line: 6, heading: 'Makers', columns: ['Made in', 'Vehicles'], rows: 3,
          kinds: PANELS.map((block, index) => ({ kind: ['bars', 'donut', 'segments'][index], label: ['Bars', 'Donut', 'Segments'][index],
            title: '', block, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' })) }],
        maps: [], starter: STARTER,
      } });
    }
    if (path === '/infographic') {
      const body = request.postDataJSON();
      if (body.format === 'png') {
        state.pictures.push(body);
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      }
      return route.fulfill({ json: drawing(body.text) });
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

const order = (written) => [...String(written ?? '').matchAll(/^kind: (.*)$/gm)].map((match) => match[1]);

test('an infographic is built from a table of the note, reordered, and exported as a picture', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');

  // `/` › Infographic: a starter of three panels, made of the note's own table
  // a press on words, not on the table's grid, then the note's last line
  await page.locator('.cm-content').getByText('Seen at the quay.').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/infographic');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Infographic');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await expect.poll(() => state.written.at(-1) ?? '').toContain(STARTER);
  expect(state.offers[0].text).toContain('| UAE | 22 |');
  expect(order(state.written.at(-1))).toEqual(['bars', 'donut', 'segments']);

  // the builder beside the note, its three panels in reading order
  const builder = page.getByRole('complementary', { name: 'Infographic builder' });
  await expect(builder).toBeVisible();
  const names = builder.locator('.ib-panel-title');
  await expect(names).toHaveText(['At least 33 vehicles, by maker', 'Where they were made', 'All 33']);
  // the page drawn in the note, a box over each panel
  await expect(page.locator('.cm-block-infographic .cm-ig-hit')).toHaveCount(3);

  // the first panel down by one: its lines and its width move together, in one change
  await builder.getByRole('button', { name: /^At least 33 vehicles, by maker/ }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(names).toHaveText(['Where they were made', 'At least 33 vehicles, by maker', 'All 33']);
  await expect.poll(() => order(state.written.at(-1))).toEqual(['donut', 'bars', 'segments']);
  expect(state.written.at(-1)).toContain('widths: half, half, wide');

  // one Undo gives the order back
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => order(state.written.at(-1))).toEqual(['bars', 'donut', 'segments']);
  await expect(names).toHaveText(['At least 33 vehicles, by maker', 'Where they were made', 'All 33']);

  // Export as a picture: X at 16:9, handed over as a download
  await builder.getByRole('button', { name: /Export as a picture/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /X, 16:9/ }).or(page.locator('.fm-item', { hasText: 'X, 16:9' })).first().click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('infographic-x.png');
  expect(state.pictures).toHaveLength(1);
  expect(state.pictures[0]).toMatchObject({ format: 'png', size: 'x', note: 'n1' });
  expect(state.pictures[0].text.startsWith(':::: infographic\n')).toBe(true);
});
