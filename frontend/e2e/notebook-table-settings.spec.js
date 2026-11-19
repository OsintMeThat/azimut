import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A table's Settings, from its grid's bar: the search bar set to Always on a table of
 * three rows writes its line under the table as one step, and the Page pane's HTML view,
 * drawn again from the note it is sent, shows the bar the reader's own script adds. The
 * server is stood in for: its page is the reader's real script and style sheet around
 * the table as `engine/notes_html.py` writes it, with the settings the posted note holds.
 */

const ASSETS = new URL('../../src/azimut/engine/notes_html_assets/', import.meta.url);
const CSS = readFileSync(new URL('reader.css', ASSETS), 'utf8') + readFileSync(new URL('reader.table.css', ASSETS), 'utf8');
const JS = readFileSync(new URL('reader.js', ASSETS), 'utf8');

const at = '2026-10-01T10:00:00Z';
const CATALOG = [{ id: 'n1', type: 'note', label: 'Register', attrs: { path: 'notes/Register.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } }];
const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | confirmed | 8 |\n| Al-Wahsh | almost sure | 2 |\n| BATT UMG | confirmed | 2 |';
const NOTE = `Who made them.\n\n${TABLE}\n\nAfter.`;

/** The page the server writes for `text`: its one table, with the search bar its settings line asks for. */
function page(text) {
  const search = /\{[^}\n]*\bsearch=(always|never)\b[^}\n]*\}/.exec(text)?.[1];
  const rows = [['Streit Cougar', 'confirmed', '8'], ['Al-Wahsh', 'almost sure', '2'], ['BATT UMG', 'confirmed', '2']]
    .map((cells) => `<tr>${cells.map((cell) => `<td dir="auto">${cell}</td>`).join('')}</tr>`).join('\n');
  return `<!doctype html><html lang="en" data-look="report"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="az-page"><main class="az-body" id="main"><p>Who made them.</p>
<div class="az-table-wrap"><table class="az-table" data-rows="3"${search ? ` data-search="${search}"` : ''}>
<thead><tr><th scope="col" dir="auto">Model</th><th scope="col" dir="auto">Grade</th><th scope="col" data-align="right" dir="auto">At least</th></tr></thead>
<tbody>${rows}</tbody></table></div><p>After.</p></main></div><script>${JS}</script></body></html>`;
}

test('Settings sets the search bar Always on a short table, and the HTML view shows the bar', async ({ page: tab }) => {
  await installAppFixture(tab, { catalog: CATALOG });
  const written = [];
  const previews = [];
  await tab.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) => route.fulfill({ json: { items: CATALOG, next_cursor: null, total: 1 } }));
  await tab.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await tab.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        written.push(request.postDataJSON().text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text: written.at(-1) ?? NOTE } });
    }
    if (path === '/html/preview') {
      const body = request.postDataJSON();
      previews.push(body.text);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page(body.text),
        headers: { 'X-Note-Warnings': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Diagrams': '[]' } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    return route.fallback();
  });
  await tab.goto('/#notebook');
  await tab.locator('button[title="Open Register"]').click();
  await expect(tab.locator('.cm-content')).toContainText('Who made them.');

  // the HTML view first, the table as it is: three rows, no bar
  await tab.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const pane = tab.locator('.page-pane');
  await pane.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'HTML' }).click();
  const frame = tab.frameLocator('.html-page iframe:not([inert])');
  await expect(frame.locator('table.az-table')).toBeVisible();
  await expect(frame.locator('.az-filter')).toHaveCount(0);

  // Settings on the grid's bar, then Always: one line under the table, the bar in the page
  await tab.locator('.cm-grid-bar').getByRole('button', { name: 'Settings' }).click();
  const card = tab.getByRole('dialog', { name: 'Table settings' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('radiogroup', { name: 'Search bar' }).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('radiogroup', { name: 'Search bar' }).getByRole('radio', { name: 'Always' }).click();
  await expect.poll(() => written.at(-1) ?? '').toBe(NOTE.replace(TABLE, `${TABLE}\n{search=always}`));
  await expect.poll(() => previews.at(-1) ?? '').toContain('{search=always}');
  await expect(frame.locator('.az-filter')).toBeVisible();
  await expect(frame.locator('.az-table-tools')).toContainText('3 rows');
  // the drawn page shows no braces: the grid stands over its line
  await expect(tab.locator('.cm-content')).not.toContainText('{search');
  await expect(tab.locator('.cm-grid-look')).toHaveAttribute('aria-label', 'Settings, some set');

  // one step: Undo takes the line back, and the bar leaves the page
  await tab.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await tab.locator('.cm-content').click({ position: { x: 20, y: 10 } });
  await tab.keyboard.press('Control+z');
  await expect.poll(() => written.at(-1) ?? '').toBe(NOTE);
  await expect(frame.locator('.az-filter')).toHaveCount(0);
});

/** A report as the server writes one: a contents bar on a narrow screen, a short table, words to scroll past it. */
function report(classes = 'az-table', data = '') {
  const rows = Array.from({ length: 8 }, (_, index) => `<tr style="--az-c:#184f95"><td dir="auto">${index + 1}</td><td dir="auto">Model ${index % 3}</td>`
    + `<td class="az-key" dir="auto">confirmed</td></tr>`).join('\n');
  const words = Array.from({ length: 30 }, () => '<p dir="auto">Words after the table, enough of them to scroll the page past it.</p>').join('\n');
  return `<!doctype html><html lang="en" data-look="report"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<header class="az-cover" data-cover="none"><h1 class="az-title" dir="auto">Register</h1></header>
<div class="az-page"><nav class="az-contents" aria-label="Contents"><ol><li><a href="#the-vehicles">The vehicles</a></li></ol></nav>
<main class="az-body" id="main"><h2 id="the-vehicles" dir="auto">The vehicles</h2><p dir="auto">One row per vehicle.</p>
<div class="az-table-wrap"><table class="${classes}" data-rows="8"${data}><thead><tr><th scope="col" dir="auto">#</th>
<th scope="col" dir="auto">Model</th><th scope="col" dir="auto">Grade</th></tr></thead><tbody>${rows}</tbody></table></div>
${words}</main></div><script>${JS}</script></body></html>`;
}

/** Where the header's cells stand against the first row and the contents bar, once the table's top went `past` px under the bar. */
async function header(tab, past) {
  if (past !== null) {
    await tab.evaluate((by) => {
      const table = document.querySelector('table.az-table');
      const bar = document.querySelector('.az-contents').offsetHeight;
      window.scrollTo({ top: table.getBoundingClientRect().top + window.scrollY - bar + by, behavior: 'instant' });
    }, past);
    // the bar stands at the top once the page is scrolled past it
    await expect.poll(() => tab.evaluate(() => Math.round(document.querySelector('.az-contents').getBoundingClientRect().top))).toBe(0);
  }
  return tab.evaluate(() => {
    const table = document.querySelector('table.az-table');
    const cell = table.querySelector('thead th').getBoundingClientRect();
    return {
      bar: Math.round(document.querySelector('.az-contents').getBoundingClientRect().bottom),
      top: Math.round(cell.top), bottom: Math.round(cell.bottom), first: Math.round(table.querySelector('tbody tr').getBoundingClientRect().top),
    };
  });
}

test('a table that fits a phone keeps its header over its first row, and under the contents bar as the page scrolls', async ({ page: tab }) => {
  await tab.setViewportSize({ width: 390, height: 844 });
  for (const [classes, data] of [['az-table', ''], ['az-table az-coloured az-first az-stripes', ' data-fold="5"']]) {
    await tab.setContent(report(classes, data));
    await expect(tab.locator('html')).toHaveClass(/az-barred/);
    // at rest the header stands right above the first row, never over it
    const rest = await header(tab, null);
    expect(Math.abs(rest.bottom - rest.first)).toBeLessThanOrEqual(1);
    // the table's top gone 120 px under the bar: the header stays just under the bar
    const scrolled = await header(tab, 120);
    expect(Math.abs(scrolled.top - scrolled.bar)).toBeLessThanOrEqual(1);
  }
  // a header set to scroll leaves with its rows
  await tab.setContent(report('az-table', ' data-header="scrolls"'));
  const gone = await header(tab, 120);
  expect(gone.top).toBeLessThan(gone.bar - 60);
});

