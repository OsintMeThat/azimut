import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * A chart in a note, seen in the Page pane: the PDF view lists what the check says of it
 * at its line and takes the note there; the HTML view shows the chart as the engine writes
 * it (`src/lib/notes/chartFigure.fixture.html`, held to the engine by
 * `tests/test_notecharts.py`), its words real text, a title on each bar, its numbers
 * folded under its caption. The server is stood in for.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const read = (name) => readFileSync(new URL(name, ASSETS), 'utf8');
const FIGURE = readFileSync(new URL('../src/lib/notes/chartFigure.fixture.html', import.meta.url), 'utf8');
const TEXT = [
  '# Lead', '', 'Seen at the quay.', '',
  '::: chart', 'kind: stacked bars', 'title: At least 41 armoured vehicles, by model and grade',
  'count: At least', 'by: Model', 'colour by: Grade', 'source: our vehicle register',
  '| Model | Grade | At least |', '| --- | --- | ---: |', '| Streit Cougar | Confirmed | 8 |',
  '| Total | | 8 |', ':::', '', 'Most are Emirati-made.', '',
].join('\n');
const TOTAL_LINE = TEXT.split('\n').indexOf('| Total | | 8 |');
const SAID = 'The chart "At least 41 armoured vehicles, by model and grade" leaves out the row "Total", which reads as a total.';

function chartPage() {
  return `<!doctype html>
<html lang="en" dir="auto" data-look="plain" data-font="" data-edition="internal">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Lead</title><style id="az-reader">${read('reader.css')}${read('reader.chart.css')}</style></head>
<body><header class="az-cover" data-cover="none"><h1 class="az-title">Lead</h1></header>
<div class="az-page"><main class="az-body" id="main"><p>Seen at the quay.</p>
${FIGURE}<p>Most are Emirati-made.</p></main></div>
<script>${read('reader.js').replace(/<\//g, '<\\/')}</script></body></html>`;
}

async function notebook(page) {
  const at = '2026-10-01T10:00:00Z';
  const catalog = [{ id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
  await installAppFixture(page, { catalog });
  const state = { written: [], pdf: 0, html: 0 };
  let text = TEXT;
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'n1', title: 'Lead', folder: '', updated_at: at, excerpt: 'Seen at the quay.', words: 4,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }] } });
    }
    if (path === '/preview') {
      state.pdf += 1;
      return pdfAnswer(route, [0], { 'X-Note-Warnings': JSON.stringify([SAID]), 'X-Note-Warning-Lines': JSON.stringify([TOTAL_LINE]),
        'X-Note-Warning-Kinds': JSON.stringify(['other']) }, ['Lead']);
    }
    if (path === '/html/preview') {
      state.html += 1;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: chartPage(),
        headers: { 'X-Note-Warnings': JSON.stringify([SAID]), 'X-Note-Warning-Lines': JSON.stringify([TOTAL_LINE]),
          'X-Note-Warning-Kinds': JSON.stringify(['other']), 'X-Note-Diagrams': '[]' } });
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

test('a chart in a note is seen in the Page pane: the PDF view says its check at its line, the HTML view draws it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the frame');
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText('Seen at the quay.');

  // the PDF view: the check's word on the chart, which takes the note to the row it names
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const pane = page.locator('.page-pane');
  await expect.poll(() => state.pdf).toBeGreaterThan(0);
  const list = pane.getByRole('list', { name: 'Warnings' });
  await expect(list.getByRole('listitem')).toHaveText([SAID]);
  await list.getByRole('button', { name: /reads as a total/ }).click();
  await page.keyboard.type('Sub');
  await expect.poll(() => state.written.at(-1) ?? '').toContain('Sub| Total | | 8 |');

  // the HTML view: the chart drawn in the page, a bar's own words on hover, its numbers a press away
  await pane.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  await expect.poll(() => state.html).toBeGreaterThan(0);
  const frame = page.frameLocator('.html-page iframe:not([inert])');
  const figure = frame.locator('figure[data-kind="chart"]');
  await figure.scrollIntoViewIfNeeded();
  // the pane is as narrow as a phone: the chart is the one drawn for a phone
  const drawn = figure.locator('svg.az-chart-phone');
  await expect(drawn).toBeVisible();
  await expect(figure.locator('svg.az-chart-wide')).toBeHidden();
  await expect(figure.getByRole('img', { name: /^At least 41 armoured vehicles, by model and grade/ })).toBeVisible();
  await expect(drawn.locator('text', { hasText: 'Streit Cougar' })).toHaveCount(1);
  await expect(drawn.locator('g > title', { hasText: 'Streit Cougar, Confirmed: 8' })).toHaveCount(1);
  await expect(figure.locator('figcaption .az-caption')).toHaveText('At least 41 armoured vehicles, by model and grade');
  const numbers = figure.locator('.az-chart-data');
  await expect(numbers).toBeHidden();
  await figure.getByText('The numbers').click();
  await expect(numbers).toBeVisible();
  await expect(numbers.getByRole('row', { name: /Harrow Tygor E1/ })).toContainText('8');
  // the chart's edges are the text's own
  const box = await drawn.boundingBox();
  const words = await frame.locator('main > p').first().boundingBox();
  expect(Math.abs(box.x - words.x)).toBeLessThan(2);
  expect(Math.abs(box.x + box.width - (words.x + words.width))).toBeLessThan(2);
});
