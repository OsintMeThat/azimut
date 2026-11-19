import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * Pictures and stories without braces, end to end in the browser: a picture sized by
 * its bar and by its corner, veiled as graphic, its caption written where it prints; a
 * story built from the case's pictures, reordered by dragging a step's number, a zoom
 * framed on a picture, each gesture one Undo. And every drawn block is as tall on the
 * page as the editor measures it, so what is under it is where the editor thinks. The
 * server is stood in for, as in `notebook-handle.spec.js`; what is checked is the text
 * the browser saves.
 */

const at = '2026-10-01T10:00:00Z';
const confirmed = { by: 'user', at, status: 'confirmed' };
const note = { id: 'n1', type: 'note', label: 'Lead', attrs: { path: 'notes/n1.md', folder: '' }, provenance: confirmed };
const chapter = { id: 'n2', type: 'note', label: 'Shadows', attrs: { path: 'notes/n2.md', folder: '' }, provenance: confirmed };
const picture = (id, label, colour) => ({
  id, type: 'media', label, attrs: { path: `media/${id}.svg`, kind: 'image', folder: '' }, provenance: confirmed, colour,
});
const ROOF = picture('roof', 'Roof', '#b85c38');
const YARD = picture('yard', 'Yard', '#3d7ea6');
const GATE = picture('gate', 'Gate', '#6a8d3a');
const svg = (colour) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="${colour}"/><circle cx="120" cy="110" r="46" fill="#fff" opacity=".7"/>
  <rect x="210" y="170" width="140" height="80" fill="#000" opacity=".35"/></svg>`;

async function notebook(page, text) {
  const catalog = [note, chapter, ROOF, YARD, GATE];
  await installAppFixture(page, { catalog });
  const state = { text, saved: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/media/metadata`, (route) => route.fulfill({ json: [] }));
  for (const one of [ROOF, YARD, GATE]) {
    await page.route(`**/files/${CASE_ID}/${one.attrs.path}`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg(one.colour) }));
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
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Lead', state.text), row('n2', 'Shadows', 'Measured at noon.')] } });
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

/** Undo once, and wait for the editor to hold `text` again, and the note saved so. */
async function undoTo(page, state, text) {
  await page.keyboard.press('Control+z');
  await expect.poll(() => editorText(page)).toBe(text);
  await expect.poll(() => state.text).toBe(text);
}

test('a picture is sized by its bar, the size shown while the pointer is on it, and by dragging its corner, each one Undo', async ({ page }) => {
  const text = 'Opening words.\n\n[[media:roof|Roof]]{width=50% caption="The roof"}\n\nClosing words.';
  const state = await notebook(page, text);
  const block = page.locator('.cm-block-picture');
  const frame = block.locator('.cm-picture-frame');
  await expect(block.locator('img')).toBeVisible();
  await block.hover({ position: { x: 60, y: 60 } });
  const bar = block.getByRole('toolbar', { name: 'Picture' });
  const widthOf = () => frame.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  const half = await widthOf();
  // the pointer on a size shows it on the picture, and writes nothing
  await bar.getByRole('button', { name: 'L', exact: true }).hover();
  await expect(frame.locator('.cm-picture-size')).toHaveText('L · 75%');
  expect(await widthOf()).toBeGreaterThan(half * 1.4);
  await bar.getByRole('button', { name: 'S', exact: true }).click();
  await expect.poll(() => state.text).toBe(text.replace('width=50%', 'width=33%'));
  await undoTo(page, state, text);

  // the corner, dragged: the width follows and snaps, said on the picture, written let go
  await block.hover({ position: { x: 60, y: 60 } });
  const corner = frame.locator('.cm-picture-corner');
  await expect(corner).toBeVisible();
  const box = await corner.boundingBox();
  const page0 = await block.evaluate((node) => {
    const style = getComputedStyle(node);
    return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  const left = (await frame.boundingBox()).x;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(left + page0 * 0.6, box.y + 40, { steps: 6 });
  await page.mouse.move(left + page0 * 0.73, box.y + 60, { steps: 6 });
  await expect(frame.locator('.cm-picture-size')).toHaveText('L · 75%');
  expect(await editorText(page)).toBe(text);
  await page.mouse.up();
  await expect.poll(() => state.text).toBe(text.replace('width=50%', 'width=75%'));
  await undoTo(page, state, text);
});

test('a graphic picture is veiled in one press and drawn blurred, and its caption is written where it prints', async ({ page }) => {
  const text = 'Opening words.\n\n[[media:roof|Roof]]{width=50% caption="The roof"}\n\nClosing words.';
  const state = await notebook(page, text);
  const block = page.locator('.cm-block-picture');
  await block.hover({ position: { x: 60, y: 60 } });
  const graphic = block.getByRole('button', { name: 'Graphic' });
  await expect(graphic).toHaveAttribute('aria-pressed', 'false');
  await graphic.click();
  const veiled = text.replace('caption="The roof"}', 'caption="The roof" graphic}');
  await expect.poll(() => state.text).toBe(veiled);
  await expect(block.getByRole('button', { name: 'Graphic' })).toHaveAttribute('aria-pressed', 'true');
  // it is blurred and says so at once; the pointer on it blurs it less, away from it as the web page does
  await expect(block.locator('.cm-veil-said')).toBeVisible();
  await expect(block.locator('.cm-veil-said')).toContainText('Graphic picture');
  await expect.poll(() => block.locator('img').evaluate((node) => getComputedStyle(node).filter)).toContain('blur(7px)');
  await page.mouse.move(5, 5);
  await expect.poll(() => block.locator('img').evaluate((node) => getComputedStyle(node).filter)).toContain('blur(18px)');
  await expect(block.locator('.cm-veil-said')).toBeVisible();
  await undoTo(page, state, text);

  // the caption, pressed, is a field in its place
  await block.locator('.markdown-caption').click();
  const field = block.getByRole('textbox', { name: 'Caption' });
  await expect(field).toBeFocused();
  await field.fill('The roof, burnt');
  await field.press('Enter');
  await expect.poll(() => state.text).toBe(text.replace('The roof"', 'The roof, burnt"'));
  await undoTo(page, state, text);
});

test('a story is built from the case\'s pictures, reordered by a step\'s number, framed and written, each gesture one Undo', async ({ page }) => {
  const text = 'Opening words.\n\n::: story\n<!--? A picture, then the words read beside it -->\n:::\n\nClosing words.';
  const state = await notebook(page, text);
  const story = page.locator('.cm-block-story');
  await expect(story.locator('.cm-step-none')).toBeVisible();
  const add = async (name) => {
    await story.getByRole('button', { name: 'A picture of the case, as the next step' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a step' });
    await picker.getByRole('searchbox', { name: 'Find a picture' }).fill(name);
    await picker.getByRole('option', { name }).click();
    await expect(picker).toHaveCount(0);
  };
  await add('Roof');
  await add('Yard');
  await add('Gate');
  const built = 'Opening words.\n\n::: story\n[[media:roof|Roof]]\n[[media:yard|Yard]]\n[[media:gate|Gate]]\n:::\n\nClosing words.';
  await expect.poll(() => state.text).toBe(built);
  await expect(story.locator('.cm-step-grip')).toHaveText(['1', '2', '3']);

  // the third step, dragged by its number above the first
  const grip = story.locator('.cm-step-grip').nth(2);
  const from = await grip.boundingBox();
  const first = await story.locator('.cm-played-step').first().boundingBox();
  await page.mouse.move(from.x + 8, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y - 40, { steps: 4 });
  await page.mouse.move(first.x + 20, first.y + 10, { steps: 8 });
  await expect(story.locator('.cm-step-drop')).toBeVisible();
  await page.mouse.up();
  const reordered = built.replace('[[media:roof|Roof]]\n[[media:yard|Yard]]\n[[media:gate|Gate]]', '[[media:gate|Gate]]\n[[media:roof|Roof]]\n[[media:yard|Yard]]');
  await expect.poll(() => state.text).toBe(reordered);
  await undoTo(page, state, built);

  // a box dragged on the second picture frames what its step moves in on
  const area = story.locator('[data-zoom-area]').nth(1);
  await area.scrollIntoViewIfNeeded();
  const image = await area.locator('img').boundingBox();
  await page.mouse.move(image.x + image.width * 0.2, image.y + image.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(image.x + image.width * 0.5, image.y + image.height * 0.5, { steps: 4 });
  await page.mouse.move(image.x + image.width * 0.7, image.y + image.height * 0.8, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => state.text).toMatch(/\[\[media:yard\|Yard\]\]\{zoom=0\.2\d*,0\.2\d*,0\.[45]\d*,0\.[56]\d*\}/);
  await expect(story.locator('.cm-zoom-box')).toHaveCount(1);
  const framed = await editorText(page);

  // its words, written in place
  await story.locator('[data-step-edit="words"]').first().click();
  const words = story.getByRole('textbox', { name: 'Words of step 1' });
  await words.fill('The roof first.');
  await words.press('Enter');
  await expect.poll(() => state.text).toBe(framed.replace('[[media:roof|Roof]]\n', '[[media:roof|Roof]]\nThe roof first.\n\n'));
  await undoTo(page, state, framed);
  await undoTo(page, state, built);
  await undoTo(page, state, built.replace('\n[[media:gate|Gate]]', ''));
});

test('every drawn block is as tall on the page as the editor measures it, so the lines under it are where it thinks', async ({ page }) => {
  const text = [
    'Opening words.', '<!-- cover -->', 'Words.', '<!-- pagebreak -->', 'Words.', '```mermaid\nflowchart LR\n  A --> B\n```', 'Words.',
    '::: steps\n[[media:roof|Roof]]\n[[media:yard|Yard]]\n:::', 'Words.', '::: story\n[[media:gate|Gate]]{zoom=0.2,0.2,0.5,0.5}\nThe gate.\n:::',
    'Words.', '::: map\ntitle: Front\n:::', 'Words.', '[[include:n2]]', 'Words.', '[[media:roof|Roof]]{width=50%}', 'Closing words.',
  ].join('\n\n');
  await notebook(page, text);
  await expect(page.locator('.cm-block-diagram .cm-dg-figure svg')).toBeVisible();
  await expect(page.locator('.cm-block-story img')).toBeVisible();
  const rows = await page.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    const out = [];
    for (const row of view.contentDOM.children) {
      if (row.classList.contains('cm-line')) continue;
      const pos = view.posAtDOM(row);
      const block = view.lineBlockAt(pos);
      const next = row.nextElementSibling;
      const after = next ? view.lineBlockAt(Math.min(block.to + 1, view.state.doc.length)) : null;
      out.push({
        kind: row.dataset.block ?? (row.classList.contains('cm-cover-rule') ? 'cover' : row.classList.contains('cm-pagebreak') ? 'pagebreak' : 'include'),
        drawn: Math.round(row.getBoundingClientRect().height * 10) / 10,
        measured: Math.round(block.height * 10) / 10,
        // where the page draws the line under it, against where the editor's height map puts it
        drift: next ? Math.round((next.getBoundingClientRect().top - view.documentTop - after.top) * 10) / 10 : 0,
      });
    }
    return out;
  });
  expect(rows.map((row) => row.kind)).toEqual(['cover', 'pagebreak', 'diagram', 'steps', 'story', 'map', 'include', 'picture']);
  for (const row of rows) {
    expect(Math.abs(row.drawn - row.measured), `${row.kind} drawn ${row.drawn}, measured ${row.measured}`).toBeLessThanOrEqual(1);
    expect(Math.abs(row.drift), `${row.kind}: the line under it is ${row.drift}px off`).toBeLessThanOrEqual(1);
  }
});
