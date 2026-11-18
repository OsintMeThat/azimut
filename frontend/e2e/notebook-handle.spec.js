import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * The block handle, end to end in the browser: the ⋮⋮ beside a hovered block, its menu
 * turning a paragraph into a callout and Undo taking it back to the byte, Alt+↓ moving
 * a picture, and Mark internal leaving a passage out of the public edition, as the
 * export's check says. The server is stood in for, as in `notebook-editions.spec.js`;
 * what is checked is the text the browser saves and what it asks.
 */

const at = '2026-10-01T10:00:00Z';
const confirmed = { by: 'user', at, status: 'confirmed' };
const note = { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: confirmed };
const picture = { id: 'm1', type: 'media', label: 'Harbour', attrs: { path: PANEL_PATH, kind: 'image' }, provenance: confirmed };
const passages = (text) => (String(text ?? '').match(/^\s*>\s*\[!internal\]/gim) ?? []).length;

async function notebook(page, text) {
  const catalog = [note, picture];
  await installAppFixture(page, { catalog });
  const state = { text, saved: [], checks: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, body) => ({
        id, title, folder: '', updated_at: at, excerpt: body.split('\n')[0], words: 2, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Lead', state.text)] } });
    }
    if (path === '/preview') return pdfAnswer(route, [0], { 'X-Note-Internal': String(passages(request.postDataJSON().text)) });
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      // what the server's check says of the saved text: each internal passage the public edition leaves out
      const body = request.postDataJSON();
      state.checks.push(body);
      const count = passages(state.text);
      const left = body.edition === 'public' && count
        ? [{ text: `${count} internal passage${count > 1 ? 's' : ''} left out.`, line: null, kind: 'internal' }] : [];
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Lead', internal: count, warnings: left })) } });
    }
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (request.method() === 'PUT') {
        state.text = request.postDataJSON().text;
        state.saved.push(state.text);
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('.cm-content')).toContainText(text.split('\n')[0]);
  return state;
}

/** The text the editor holds now. */
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());

test('hovering a paragraph shows its handle beside it, whose menu turns it into a callout, and Undo gives it back', async ({ page }) => {
  const text = 'Opening words.\n\nThe convoy left at dawn, by the coast road.\n\nClosing words.';
  const state = await notebook(page, text);
  const paragraph = page.locator('.cm-line', { hasText: 'The convoy left at dawn' });
  await paragraph.hover({ position: { x: 200, y: 8 } });
  const handle = page.getByRole('button', { name: 'Block menu: Paragraph' });
  await expect(handle).toBeVisible();
  // in the margin, left of the words, never over them
  const [handleBox, lineBox] = [await handle.boundingBox(), await paragraph.boundingBox()];
  const wordsLeft = await paragraph.evaluate((line) => {
    const range = document.createRange();
    range.setStart(line.firstChild, 0);
    range.setEnd(line.firstChild, 1);
    return range.getBoundingClientRect().left;
  });
  expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(wordsLeft);
  expect(handleBox.y).toBeGreaterThanOrEqual(lineBox.y - 4);
  expect(handleBox.y + handleBox.height).toBeLessThanOrEqual(lineBox.y + lineBox.height + 4);

  await handle.click();
  const menu = page.getByRole('menu', { name: /^Paragraph/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Turn into' }).hover();
  const kinds = page.getByRole('menu', { name: 'Turn into' });
  await expect(kinds.getByRole('menuitemradio', { name: 'Text' })).toHaveAttribute('aria-checked', 'true');
  await kinds.getByRole('menuitemradio', { name: 'Confirmed callout' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.cm-callout-confirmed')).toHaveCount(1);
  await expect.poll(() => state.text).toBe(text.replace('The convoy', '> [!confirmed] The convoy'));

  // one Undo, the exact bytes back, saved
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).toBe(text);
  await expect.poll(() => state.text).toBe(text);
  await expect(page.locator('.cm-callout-confirmed')).toHaveCount(0);
});

test('Alt+↓ on a picked picture moves it under the next block, and Alt+↑ brings it back', async ({ page }) => {
  const text = 'Opening words.\n\n[[media:m1|Harbour]]{width=50%}\n\nThe convoy left at dawn.\n\nClosing words.';
  const state = await notebook(page, text);
  const block = page.locator('.cm-block-picture');
  await expect(block.locator('img')).toBeVisible();
  // a press picks the picture, which the keys then move whole
  await block.click({ position: { x: 60, y: 30 } });
  await page.keyboard.press('Alt+ArrowDown');
  const moved = 'Opening words.\n\nThe convoy left at dawn.\n\n[[media:m1|Harbour]]{width=50%}\n\nClosing words.';
  await expect.poll(() => editorText(page)).toBe(moved);
  await expect.poll(() => state.text).toBe(moved);
  // still picked where it went, so the next press moves it again
  await expect(page.locator('.cm-block-picture.cm-picked')).toHaveCount(1);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => editorText(page)).toBe(text);
  await expect.poll(() => state.text).toBe(text);
});

test('Mark internal wraps a passage the public edition leaves out, as the export\'s check says', async ({ page }) => {
  const text = 'Public words.\n\nWho told us, and how to reach them.\n\nMore public words.';
  const state = await notebook(page, text);
  const passage = page.locator('.cm-line', { hasText: 'Who told us' });
  await passage.hover({ position: { x: 200, y: 8 } });
  await page.getByRole('button', { name: 'Block menu: Paragraph' }).click();
  const item = page.getByRole('menuitem', { name: /Mark internal/ });
  await expect(item).toContainText('not in Public');
  await item.click();
  await expect(page.locator('.cm-callout-internal .cm-callout-label')).toHaveText('Internal');
  await expect.poll(() => state.text).toBe('Public words.\n\n> [!internal] Who told us, and how to reach them.\n\nMore public words.');

  // the menu of the passage now offers it back to the public edition
  await passage.hover({ position: { x: 260, y: 8 } });
  await page.getByRole('button', { name: 'Block menu: Internal passage' }).click();
  await expect(page.getByRole('menuitem', { name: /Make public/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // the public export's check counts it left out
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await dialog.getByRole('group', { name: 'Edition' }).getByRole('button', { name: 'Public' }).click();
  await expect(dialog).toContainText('1 internal passage left out.');
  expect(state.checks.at(-1)).toEqual({ notes: ['n1'], edition: 'public' });
});
