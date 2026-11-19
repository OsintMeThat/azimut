import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * An infographic built from a table of the note: `/` › Infographic writes a starter made of
 * the note's own rows by the chart's kind picker (`notes/figure/kinds`, stood in for here),
 * the builder opens beside the note, Add a panel adds a third from the same picker, a panel
 * moves down with Alt+↓, a chart's own settings card sets its title inside the page (one Undo
 * takes each back), and Export as a picture asks for X's 16:9 and hands it over as a download.
 */

const TABLE = ['| Made in | Vehicles |', '| --- | ---: |', '| UAE | 22 |', '| USA | 9 |', '| Jordan | 2 |'];
const TEXT = ['# Lead', '', 'Seen at the quay.', '', '## Makers', '', ...TABLE, '', ''].join('\n');
const svg = (words) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${words}</title></svg>`;
/** What the kind picker answers for the table: each kind, its settings and its title. */
const KINDS = { rows: 3, kinds: [
  { kind: 'bars', label: 'Bars', settings: { kind: 'bars', count: 'Vehicles', by: 'Made in' }, title: 'At least 33 vehicles, by maker', svg: svg('Bars') },
  { kind: 'donut', label: 'Donut', settings: { kind: 'donut', count: 'Vehicles', by: 'Made in' }, title: 'At least 33 vehicles', svg: svg('Donut') },
  { kind: 'segments', label: 'Segments', settings: { kind: 'segments', count: 'Vehicles', by: 'Made in' }, title: 'All 33', svg: svg('Segments') },
] };
const BARS = { name: 'bars', label: 'Bars', counts: true, parts: false, stacked: false, up: false, turns: 'columns', style: 'report' };
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
  const state = { written: [], kinds: [], pictures: [] };
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
    if (path === '/figure/kinds') {
      state.kinds.push(request.postDataJSON());
      return route.fulfill({ json: KINDS });
    }
    if (path === '/figure') {
      const title = /\ntitle: (.*)\n/.exec(request.postDataJSON().text)?.[1] ?? 'Chart';
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(title), headers: {
        'X-Chart-Title': JSON.stringify(title), 'X-Chart-Proposed-Title': JSON.stringify('At least 33 vehicles, by maker'),
        'X-Chart-Kind': JSON.stringify(BARS), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
        'X-Note-Warning-Fixes': '[]' } });
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
/** The infographic's own lines in what was saved. */
const pageOf = (written) => /^:::: infographic\n[\s\S]*?\n::::$/m.exec(String(written ?? ''))?.[0] ?? '';

test('an infographic is built from a table of the note, set panel by panel, reordered, and exported as a picture', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');

  // `/` › Infographic: a starter made by the kind picker of the note's own table
  await page.locator('.cm-content').getByText('Seen at the quay.').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/infographic');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Infographic');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  await expect.poll(() => order(saved(state))).toEqual(['bars', 'donut']);
  expect(state.kinds[0]).toEqual({ text: TABLE.join('\n'), note: 'n1' });
  const starter = saved(state);
  expect(starter).toContain('widths: half, half');
  expect(starter).toContain('kind: bars\ntitle: At least 33 vehicles, by maker\ncount: Vehicles\nby: Made in\nfrom: note:n1#makers\n| Made in | Vehicles |');

  // the builder beside the note; Add a panel shows the same picker's drawings, and Segments is the third panel
  const builder = page.getByRole('complementary', { name: 'Infographic builder' });
  await expect(builder).toBeVisible();
  const names = builder.locator('.ib-panel-title');
  await expect(names).toHaveText(['At least 33 vehicles, by maker', 'At least 33 vehicles']);
  await builder.getByRole('button', { name: /Add a panel/ }).click();
  await builder.getByRole('button', { name: 'Segments: All 33' }).click();
  await expect(names).toHaveText(['At least 33 vehicles, by maker', 'At least 33 vehicles', 'All 33']);
  await expect.poll(() => order(saved(state))).toEqual(['bars', 'donut', 'segments']);
  await expect(page.locator('.cm-block-infographic .cm-ig-hit')).toHaveCount(3);

  // the first panel down by one, and one Undo gives the order back
  await builder.getByRole('button', { name: /^At least 33 vehicles, by maker/ }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(() => order(saved(state))).toEqual(['donut', 'bars', 'segments']);
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => order(saved(state))).toEqual(['bars', 'donut', 'segments']);

  // the chart's own settings card, under its row: a title written inside the page, one Undo
  await builder.getByRole('button', { name: /^At least 33 vehicles, by maker/ }).click();
  const card = builder.getByRole('group', { name: 'Chart settings' });
  await expect(card).toBeVisible();
  await card.getByRole('textbox', { name: 'Title' }).fill('Who made them');
  await card.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect.poll(() => saved(state)).toContain('kind: bars\ntitle: Who made them\n');
  // the note's own table, outside the page, is as it was
  expect(state.written.at(-1).startsWith(TEXT.trimEnd())).toBe(true);
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(state)).toContain('kind: bars\ntitle: At least 33 vehicles, by maker\n');

  // Export as a picture: X at 16:9, handed over as a download
  await builder.getByRole('button', { name: /Export as a picture/ }).click();
  const downloading = page.waitForEvent('download');
  await page.locator('.fm-item', { hasText: 'X, 16:9' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('infographic-x.png');
  expect(state.pictures).toHaveLength(1);
  expect(state.pictures[0]).toMatchObject({ format: 'png', size: 'x', note: 'n1' });
  expect(state.pictures[0].text.startsWith(':::: infographic\n')).toBe(true);
});

/** The infographic as last saved. */
function saved(state) {
  return pageOf(state.written.at(-1));
}
