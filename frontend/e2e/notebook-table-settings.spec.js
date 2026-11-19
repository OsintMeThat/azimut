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
