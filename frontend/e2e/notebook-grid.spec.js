import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A table in a note is a grid: typed in cell by cell, a row added past the last
 * cell, a spreadsheet pasted as a table, a column sorted, every gesture one step
 * Undo takes back byte for byte, and an empty picture cell that cuts its row's
 * frame in Inspect.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const VIDEO = { id: 'v1', type: 'media', label: 'Ground tour', attrs: { path: 'media/tour.mp4', kind: 'video', folder: '' }, provenance: made };
const CATALOG = [
  { id: 'n1', type: 'note', label: 'Register', attrs: { path: 'notes/Register.md', folder: '' }, provenance: made },
  VIDEO,
];
const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | identified | 8 |\n| Al-Wahsh | almost sure | 2 |';
const NOTE = `Who made them.\n\n${TABLE}\n\nAfter.`;

const fixtures = new URL('../src/lib/notes/editor/fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');

async function withNote(page, text = NOTE, options = {}) {
  const fixture = await installAppFixture(page, { catalog: CATALOG, ...options });
  const written = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.goto('/#notebook');
  await page.locator('button[title="Open Register"]').click();
  await expect(page.locator('.cm-content')).toContainText(text.split('\n')[0]);
  return { fixture, written };
}

const cell = (page, row, col) => page.locator(`.cm-grid-cell[data-row="${row}"][data-col="${col}"]`);
const field = (page) => page.locator('.cm-grid-input');
const last = (written) => () => written.at(-1) ?? '';

test('types in cells, adds a row past the last one, and Undo gives the note back byte for byte', async ({ page }) => {
  const { written } = await withNote(page);
  await cell(page, 0, 1).click();
  await expect(field(page)).toHaveValue('identified');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('confirmed');
  await page.keyboard.press('Tab');
  await expect(field(page)).toHaveValue('8');
  await expect.poll(last(written)).toContain('| Streit Cougar | confirmed | 8 |');
  // Tab past the last cell opens a new row, written once something is typed in it
  await cell(page, 1, 2).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-grid-ghost')).toBeVisible();
  await page.keyboard.type('BATT UMG');
  await page.keyboard.press('Tab');
  await page.keyboard.type('identified');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect.poll(last(written)).toBe(NOTE
    .replace('| Streit Cougar | identified | 8 |', '| Streit Cougar | confirmed | 8 |')
    .replace('| Al-Wahsh | almost sure | 2 |', '| Al-Wahsh | almost sure | 2 |\n| BATT UMG | identified | 2 |'));
  // four cells, four steps
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Control+z');
  await expect.poll(last(written)).toBe(NOTE);
});

test('pastes a LibreOffice range on an empty line as a table, and as text from its toast', async ({ page }) => {
  const { written } = await withNote(page, 'Who made them.\n\n\n\nAfter.');
  await page.locator('.cm-line', { hasText: 'Who made them.' }).click();
  await page.keyboard.press('ArrowDown');
  await page.evaluate(({ html, text }) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox ignores `clipboardData` in the init dict; the transfer is put on the event
    Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
    document.querySelector('.cm-content').dispatchEvent(event);
  }, { html: fixture('paste-libreoffice.html'), text: fixture('libreoffice.tsv') });
  const toast = page.locator('.toast', { hasText: 'Pasted 3 rows × 4 columns from a spreadsheet.' });
  await expect(toast).toBeVisible();
  await expect(page.locator('.cm-grid-block thead')).toContainText('Unit price');
  await expect.poll(last(written)).toMatch(/^Who made them\.\n\n\| Model \| Grade \| At least \| Unit price \|\n/);
  await toast.getByRole('button', { name: 'Paste as text' }).click();
  await expect.poll(last(written)).toContain('Model\tGrade\tAt least\tUnit price\nStreit Cougar\tidentified\t8');
  await expect(page.locator('.cm-grid-block')).toHaveCount(0);
});

test('sorts a column from its menu, one step Undo takes back', async ({ page }) => {
  const { written } = await withNote(page);
  await cell(page, -1, 2).locator('.cm-grid-colbtn').click();
  await page.getByRole('menuitem', { name: 'Sort 1 → 9' }).click();
  await expect(cell(page, 0, 0)).toHaveText('Al-Wahsh');
  await expect.poll(last(written)).toContain('| ---: |\n| Al-Wahsh | almost sure | 2 |\n| Streit Cougar | identified | 8 |');
  // the keyboard is on the column's button: Undo is the note's there too
  await page.keyboard.press('Control+z');
  await expect(cell(page, 0, 0)).toHaveText('Streit Cougar');
  await expect.poll(last(written)).toBe(NOTE);
});

test('keeps a composed word whole in a cell, and writes it once the cell is left', async ({ page, browserName }) => {
  const { written } = await withNote(page);
  await cell(page, 0, 0).click();
  await page.keyboard.press('Control+a');
  const input = field(page);
  if (browserName === 'chromium') {
    // a real composition, as an input method makes one
    const cdp = await page.context().newCDPSession(page);
    for (const text of ['す', 'すと', 'ストライト']) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await cdp.send('Input.insertText', { text: 'ストライト' });
  } else {
    // a browser without a protocol for it: the composition's events, then its text
    await input.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      node.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'すと' }));
    });
    await page.keyboard.insertText('ストライト');
    await input.evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ストライト' })));
  }
  // Enter while composing is the input method's: the cell keeps the caret
  const taken = await input.evaluate((node) => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(taken).toBe(false);
  await expect(input).toHaveValue('ストライト');
  await expect(input).toBeFocused();
  await page.keyboard.press('Tab');
  await expect.poll(last(written)).toContain('| ストライト | identified | 8 |');
});

test('cuts the missing frame of a row in Inspect, at the row\'s time, the note beside it', async ({ page }) => {
  const wall = '| # | [[entity:v1|Video 1]] | Frame |\n| --- | --- | --- |\n| 1 | S04 0:23-0:37 |  |\n| 2 | – |  |';
  await withNote(page, `The wall.\n\n${wall}\n`, {
    media: [{
      path: 'media/tour.mp4', filename: 'tour.mp4', kind: 'video', width: 1280, height: 720, size: 1024, duration: 627,
      sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210', source: { type: 'upload' },
      thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
    }],
  });
  // only a row naming a time offers it
  await expect(cell(page, 1, 2).locator('.cm-grid-cut')).toHaveCount(0);
  const cut = cell(page, 0, 2).getByRole('button', { name: /Cut a frame/ });
  await expect(cut).toContainText('0:23');
  await cut.click();
  await expect(page).toHaveURL(/#inspect/);
  await expect(page.locator('[data-guide="notes.dock"] .which')).toContainText('Register');
});
