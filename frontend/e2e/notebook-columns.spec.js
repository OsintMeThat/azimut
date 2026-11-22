import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * A row of columns, end to end in the browser: made from `/` › Columns, its empty
 * columns filled with case pictures that then share one height whatever their shapes,
 * and words written in a column where it stands, the picture beside them kept in place
 * and what follows the row pushed under its taller column. The server is stood in for,
 * as in `notebook-pictures.spec.js`; what is checked is the text the browser saves and
 * where the page draws it.
 */

const at = '2026-10-01T10:00:00Z';
const confirmed = { by: 'user', at, status: 'confirmed' };
const note = { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: confirmed };
const picture = (id, label, colour, width, height) => ({
  id, type: 'media', label, attrs: { path: `media/${id}.svg`, kind: 'image', folder: '' }, provenance: confirmed, colour, width, height,
});
// a landscape picture and a portrait one: in a row they still share one height
const ROOF = picture('roof', 'Roof', '#b85c38', 400, 300);
const GATE = picture('gate', 'Gate', '#6a8d3a', 240, 320);
const svg = ({ colour, width, height }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${colour}"/><circle cx="${width / 3}" cy="${height / 3}" r="40" fill="#fff" opacity=".7"/></svg>`;

async function notebook(page, text) {
  const catalog = [note, ROOF, GATE];
  await installAppFixture(page, { catalog });
  const state = { text, saved: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/media/metadata`, (route) => route.fulfill({ json: [] }));
  for (const one of [ROOF, GATE]) {
    await page.route(`**/files/${CASE_ID}/${one.attrs.path}`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg(one) }));
  }
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
    if (path === '/preview') return pdfAnswer(route, [0]);
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
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
const boxOf = async (locator) => locator.boundingBox();

test('a row made from / takes a case picture in each column, the two then sharing one height', async ({ page }) => {
  const state = await notebook(page, 'Opening words.\n\nClosing words.');
  await page.locator('.cm-line', { hasText: 'Opening words.' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/colum');
  await page.locator('.cm-tooltip-autocomplete li', { hasText: 'Columns' }).first().click();
  const empty = ':::: columns\n::: column\n\n:::\n::: column\n\n:::\n::::';
  await expect.poll(() => editorText(page)).toContain(empty);

  // the caret in the first column, the second drawn beside it with what it takes
  const top = page.locator('.cm-cols-edit');
  await expect(top).toBeVisible();
  await expect(page.locator('.cm-col-line .cm-col-here')).toContainText('Type, or add a picture');
  const second = top.locator('.cm-cols-over > .cm-col[data-column="1"]');
  await expect(second).toContainText('Type, or add a picture');
  const line = await boxOf(page.locator('.cm-col-line').first());
  const beside = await boxOf(second);
  expect(beside.x).toBeGreaterThan(line.x + line.width);
  expect(Math.abs(beside.y - line.y)).toBeLessThan(14);

  // each column takes a case picture from its own offer
  await second.getByRole('button', { name: 'Case picture' }).click();
  await page.locator('.cm-picker [data-entity-pick="gate"]').click();
  await expect.poll(() => editorText(page)).toContain(':::\n::: column\n[[media:gate|Gate]]\n:::');
  const row = page.locator('.cm-block-columns');
  await expect(row).toBeVisible();
  await row.locator('[data-column="0"]').getByRole('button', { name: 'Case picture' }).click();
  await page.locator('.cm-picker [data-entity-pick="roof"]').click();
  const made = ':::: columns\n::: column\n[[media:roof|Roof]]\n:::\n::: column\n[[media:gate|Gate]]\n:::\n::::';
  await expect.poll(() => state.text).toContain(`Opening words.\n\n${made}\n`);

  // a landscape picture and a portrait one, side by side at one height, nothing cropped
  const images = row.locator('.cm-col img');
  await expect(images).toHaveCount(2);
  await expect.poll(async () => {
    const [roof, gate] = [await boxOf(images.nth(0)), await boxOf(images.nth(1))];
    return Math.abs(roof.height - gate.height) <= 2 && Math.abs(roof.y - gate.y) <= 1 && gate.x > roof.x + roof.width;
  }).toBe(true);
  const [roof, gate] = [await boxOf(images.nth(0)), await boxOf(images.nth(1))];
  expect(roof.width / roof.height).toBeCloseTo(400 / 300, 1);
  expect(gate.width / gate.height).toBeCloseTo(240 / 320, 1);
});

test('words typed in a column stay where it stands, the picture beside them, and what follows goes under the taller one', async ({ page }) => {
  const row = ':::: columns\n::: column\nThe bridge is green.\n:::\n::: column\n[[media:gate|Gate]]{caption="The gate"}\n:::\n::::';
  const text = `Opening words.\n\n${row}\n\nClosing words.`;
  const state = await notebook(page, text);
  const drawn = page.locator('.cm-block-columns');
  await expect(drawn.locator('img')).toBeVisible();
  const picture = await boxOf(drawn.locator('[data-column="1"] img'));
  await drawn.locator('[data-column="0"] .cm-col-text').click();

  // written in: the words are the column's own lines, the picture drawn where it was
  const top = page.locator('.cm-cols-edit');
  await expect(top).toBeVisible();
  const kept = top.locator('.cm-cols-over > .cm-col[data-column="1"] img');
  await expect(kept).toBeVisible();
  const now = await boxOf(kept);
  expect(Math.abs(now.x - picture.x)).toBeLessThan(4);
  expect(Math.abs(now.width - picture.width)).toBeLessThan(4);
  const words = page.locator('.cm-col-line').first();
  expect((await boxOf(words)).x + (await boxOf(words)).width).toBeLessThan(now.x);
  // the line under the row is under the picture, the taller column
  await expect.poll(async () => (await boxOf(page.locator('.cm-line', { hasText: 'Closing words.' }))).y)
    .toBeGreaterThan(now.y + now.height);

  await page.keyboard.press('End');
  await page.keyboard.type(' It spans the channel.');
  await expect.poll(() => state.text).toBe(text.replace('The bridge is green.', 'The bridge is green. It spans the channel.'));
  // Enter writes a new line in the column; the arrows and Backspace never leave its fences broken
  await page.keyboard.press('Enter');
  await page.keyboard.type('A second line.');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => editorText(page)).toContain('::: column\nThe bridge is green. It spans the channel.A second line.\n:::');
  // at the column's start, Backspace stays in the column
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await editorText(page)).toContain('::: column\nThe bridge is green. It spans the channel.A second line.\n:::');

  // Escape picks the row, drawn whole again
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-block-columns')).toBeVisible();
  await expect(page.locator('.cm-cols-edit')).toHaveCount(0);
  await expect(page.locator('.cm-block-columns [data-column="0"]')).toContainText('A second line.');
});

test('a picture dragged against another\'s side goes beside it', async ({ page }) => {
  const text = 'Opening words.\n\n[[media:roof|Roof]]{width=50%}\n\n[[media:gate|Gate]]{width=30%}\n\nClosing words.';
  const state = await notebook(page, text);
  const pictures = page.locator('.cm-block-picture');
  await expect(pictures).toHaveCount(2);
  await pictures.nth(1).hover({ position: { x: 40, y: 40 } });
  const handle = page.locator('.cm-handle');
  await expect(handle).toBeVisible();
  const grip = await boxOf(handle);
  const target = await boxOf(pictures.nth(0).locator('.cm-picture-frame'));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 10, target.y + target.height / 2, { steps: 8 });
  await expect(page.locator('.cm-handle-beside')).toBeVisible();
  await expect(page.locator('.cm-handle-beside')).toHaveText('Beside');
  await page.mouse.up();
  await expect.poll(() => state.text).toBe('Opening words.\n\n:::: columns\n::: column\n[[media:roof|Roof]]\n:::\n::: column\n[[media:gate|Gate]]\n:::\n::::\n\nClosing words.');
});
