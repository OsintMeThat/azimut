import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * The Notebook as a report builder: the Page pane draws the PDF the server answers
 * and draws it again after typing, a press on a page goes to it, the home picks
 * notes to export or to make a report of, and a Notebook template goes from
 * Settings to the editor, out as a file and back in.
 *
 * The server's PDFs are stood in for by small real ones (`pdfOf` in the fixture),
 * so PDF.js draws real pages in the browser.
 */

/** A page every ten lines: what the stand-in server answers for a text. */
function pagesOf(text) {
  const lines = String(text ?? '').split('\n').length;
  return Array.from({ length: Math.max(1, Math.ceil(lines / 10)) }, (_, index) => index * 10);
}

const at = '2026-10-01T10:00:00Z';
const note = (id, label, folder = '') => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder }, provenance: { by: 'user', at, status: 'confirmed' },
});
const LINES = Array.from({ length: 30 }, (_, index) => `Line ${index + 1}`).join('\n');

/** The Notebook's routes, answered from what the spec holds and written down as they are asked. */
/** The four faces a note prints in, as the server names them, and the files their samples are drawn from. */
const FONT_LIST = [
  { key: 'serif', label: 'Noto Serif', kind: 'serif', file: 'NotoSerif-Regular.ttf' },
  { key: 'sans', label: 'Noto Sans', kind: 'sans', file: 'NotoSans-Regular.ttf' },
  { key: 'book', label: 'Literata', kind: 'serif', file: 'Literata-Regular.ttf' },
  { key: 'modern', label: 'IBM Plex Sans', kind: 'sans', file: 'IBMPlexSans-Regular.ttf' },
];
const FONT_DIR = new URL('../../src/azimut/assets/fonts/', import.meta.url);

async function notebook(page, { templates = [], extra = [], texts = {}, pictures = null, warnings = null, checks = null } = {}) {
  const catalog = [note('n1', 'Lead'), note('n2', 'Shadows', 'Leads'), note('n3', 'Mast'), ...extra];
  await installAppFixture(page, { catalog });
  const state = {
    catalog,
    texts: { case: '', n1: LINES, n2: 'Shadow notes.', n3: 'Mast notes.', ...texts },
    looks: {},
    previews: [],
    written: [],
    exported: [],
    checked: [],
    templates,
    savedTemplates: [],
  };
  const row = (id, title, folder = '') => {
    const text = state.texts[id] ?? '';
    return {
      id, title, folder, updated_at: at, excerpt: text.split('\n').find(Boolean) ?? '', words: text.split(/\s+/).filter(Boolean).length,
      tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: state.looks[id] ?? null,
      includes: (text.match(/^\[\[include:[\w-]+\]\]$/gm) ?? []).length,
    };
  };
  // where the stand-in server says the pictures landed, when a spec says so
  // and what it warns about, each with its line, when a spec says so
  const pdf = (route, text) => {
    const headers = pictures ? { 'X-Note-Pictures': JSON.stringify(pictures(text)) } : {};
    if (warnings) {
      const said = warnings(text);
      headers['X-Note-Warnings'] = JSON.stringify(said.map(([words]) => words));
      headers['X-Note-Warning-Lines'] = JSON.stringify(said.map(([, line]) => line));
    }
    return pdfAnswer(route, pagesOf(text), headers);
  };

  state.fontsAsked = [];
  await page.route('**/api/notes/fonts', (route) =>
    route.fulfill({ json: { fonts: FONT_LIST.map(({ key, label, kind }) => ({ key, label, kind })) } }));
  await page.route('**/api/notes/fonts/*.ttf', (route) => {
    const key = new URL(route.request().url()).pathname.split('/').pop().replace('.ttf', '');
    state.fontsAsked.push(key);
    const font = FONT_LIST.find((item) => item.key === key);
    if (!font) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: new URL(font.file, FONT_DIR).pathname, contentType: 'font/ttf' });
  });

  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: state.catalog, next_cursor: null, total: state.catalog.length } }));
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '' && method === 'POST') {
      const body = request.postDataJSON();
      const made = note(`r${state.catalog.length + 1}`, body.title, body.folder);
      state.catalog.push(made);
      state.texts[made.id] = body.content;
      return route.fulfill({ json: made });
    }
    if (path === '' || path === '/case') {
      if (method === 'PUT') { state.texts.case = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.texts.case } });
    }
    if (path === '/index') {
      const notes = state.catalog.filter((item) => item.type === 'note');
      return route.fulfill({ json: { items: [row('case', 'Case notes'), ...notes.map((item) => row(item.id, item.label, item.attrs.folder))] } });
    }
    if (path === '/preview') {
      const body = request.postDataJSON();
      state.previews.push(body);
      return pdf(route, body.text);
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    // what the export would warn about: nothing, unless a spec says so by note
    if (path === '/pdf/check') {
      const { notes } = request.postDataJSON();
      state.checked.push(notes);
      const title = (id) => (id === 'case' ? 'Case notes' : state.catalog.find((item) => item.id === id)?.label ?? id);
      return route.fulfill({ json: { notes: notes.map((id) => ({ note: id, title: title(id), warnings: checks?.(id) ?? [] })) } });
    }
    if (path === '/pdf') {
      const { notes } = request.postDataJSON();
      state.exported.push(notes);
      return route.fulfill({ json: { written: notes.map((id) => `${id}.pdf`), warnings: [], path: '' } });
    }
    const look = /^\/([\w-]+)\/look$/.exec(path);
    if (look) {
      if (method === 'PUT') state.looks[look[1]] = request.postDataJSON();
      const kept = state.looks[look[1]] ?? {};
      return route.fulfill({ json: { look: kept } });
    }
    const one = /^\/([\w-]+)$/.exec(path);
    if (one && state.texts[one[1]] !== undefined) {
      if (method === 'PUT') {
        state.texts[one[1]] = request.postDataJSON().text;
        state.written.push({ id: one[1], text: state.texts[one[1]] });
        return route.fulfill({ json: { status: 'saved' } });
      }
      return route.fulfill({ json: { text: state.texts[one[1]] } });
    }
    return route.fallback();
  });
  await page.route('**/api/templates**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/templates/note/preview') return pdf(route, request.postDataJSON().text);
    if (path === '/api/templates' && request.method() === 'GET') {
      return route.fulfill({ json: { proof: [], post: [], map: [], note: state.templates } });
    }
    if (path === '/api/templates/note' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.savedTemplates.push(body);
      const record = { id: body.id ?? `t${state.templates.length + 1}`, name: body.name, data: body.data, updated_at: at };
      state.templates = [...state.templates.filter((item) => item.id !== record.id), record];
      return route.fulfill({ json: record });
    }
    return route.fallback();
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  return state;
}

async function openLead(page) {
  await page.goto('/#notebook');
  await page.locator('button[title="Open Lead"]').click();
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Lead');
  await expect(page.locator('.cm-content')).toContainText('Line 1');
}

test('the Page pane draws the PDF beside the note, and draws it again after typing', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const sheets = page.locator('.page-pane .sheet');
  await expect(sheets).toHaveCount(3);
  await expect(page.locator('.page-pane canvas').first()).toBeVisible();
  await expect(page.locator('.page-pane .pane-bar')).toContainText('3 pages');
  expect(state.previews[0]).toMatchObject({ note: 'n1', title: 'Lead', text: LINES });

  // twelve more lines: a fourth and a fifth page, once typing stops
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('Enter');
  await page.keyboard.type('Typed at the end.');
  await expect(sheets).toHaveCount(5);
  expect(state.previews.at(-1).text).toContain('Typed at the end.');
  // typing waits: one page asked for, not one per key
  expect(state.previews.length).toBeLessThan(5);
  // the choice is kept: the next note opens beside its pages
  await page.locator('[data-guide="notebook.home"]').click();
  await page.locator('button[title="Open Mast"]').click();
  await expect(page.locator('.page-pane .sheet')).toHaveCount(1);
});

test('a press on a page puts the note at that page', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  await expect(page.locator('.page-pane .sheet')).toHaveCount(3);
  await expect(page.locator('.page-pane canvas').first()).toBeVisible();
  await page.locator('.page-pane .sheet').nth(2).click();
  await page.keyboard.type('X');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('\nXLine 21\n');
});

test('picked notes on the home are exported, one PDF each', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('input[aria-label="Pick Lead"]').check();
  await page.locator('input[aria-label="Pick Mast"]').check();
  const bar = page.locator('[data-guide="notebook.selection"]');
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export notes as PDF' })).toContainText('2 PDFs will be written, one per note.');
  await page.getByRole('button', { name: 'Export 2 PDFs' }).click();
  await expect(page.getByText(/2 PDFs written to/)).toBeVisible();
  expect(state.exported).toEqual([['n1', 'n3']]);
  await expect(bar).toHaveCount(0);
});

test('Make a report opens a new note that includes the picked ones, beside its pages', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('input[aria-label="Pick Mast"]').check();
  await page.locator('input[aria-label="Pick Lead"]').check();
  await page.locator('[data-guide="notebook.selection"]').getByRole('button', { name: 'Make a report' }).click();
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Report');
  const report = state.catalog.at(-1);
  expect(state.texts[report.id]).toBe('[[include:n3]]\n\n[[include:n1]]\n');
  expect(state.looks[report.id]).toMatchObject({ style: 'report', toc: true, cover: { on: true } });
  const chapters = page.locator('.cm-include');
  await expect(chapters).toHaveCount(2);
  await expect(chapters.nth(0)).toContainText('Chapter 1');
  await expect(chapters.nth(0)).toContainText('Mast');
  await expect(chapters.nth(1)).toContainText('Lead');
  await expect(page.locator('.page-pane .sheet').first()).toBeVisible();
  await expect(page.locator('[data-guide="notebook.look"]')).toContainText('Report');
  // a chapter opens the note it names
  await chapters.nth(0).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Mast');
});

test('/ includes a note as a chapter, picked from the others', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/includ');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Include a note');
  // CodeMirror ignores an Enter in a menu's first 75 ms
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Include a note' });
  await expect(picker).toBeVisible();
  // every note but the one being written
  await expect(picker.locator('.include-name')).toHaveText([/Case notes/, /Shadows/, /Mast/]);
  await picker.getByRole('button', { name: /Shadows/ }).click();
  await expect(page.locator('.cm-include')).toContainText('Shadows');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('Line 30\n\n[[include:n2]]\n');
});

test('a Notebook template is edited from Settings, saved as a file and taken back', async ({ page }) => {
  const state = await notebook(page, {
    templates: [{ id: 't1', name: 'House brief', updated_at: at, data: { body: '## Claim\n\n<!--? Who said it -->\n', folder: '', look: { style: 'brief' } } }],
  });
  await page.goto('/#settings');
  await page.locator('.settings-nav, nav').getByRole('button', { name: 'Templates' }).first().click();
  const section = page.locator('[data-guide="settings.note-templates"]');
  await expect(section.locator('.tpl-row')).toContainText('House brief');
  await expect(section.locator('.tpl-row')).toContainText('Brief');
  await expect(section.locator('.tpl-row img')).toBeVisible();

  await section.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('input[aria-label="Template name"]')).toHaveValue('House brief');
  await expect(page.locator('.cm-hint')).toHaveText('Who said it');
  await page.locator('[data-guide="notebook.look"]').click();
  await page.getByRole('tab', { name: 'Style' }).click();
  await page.locator('.style-card', { hasText: 'Report' }).click();
  await expect.poll(() => state.savedTemplates.at(-1)?.data?.look?.style).toBe('report');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(section.locator('.tpl-row')).toContainText('Report');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: 'Download House brief' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('House brief.azimut-note.json');
  const file = JSON.parse(await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8')));
  expect(file).toMatchObject({ azimut_note_template: 1, name: 'House brief', data: { body: '## Claim\n\n<!--? Who said it -->\n', look: { style: 'report' } } });

  file.name = 'Brief from a colleague';
  await section.locator('input[type="file"]').setInputFiles({
    name: 'colleague.azimut-note.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(section.locator('.tpl-row', { hasText: 'Brief from a colleague' })).toBeVisible();
  expect(state.savedTemplates.at(-1)).toMatchObject({ name: 'Brief from a colleague', data: { look: { style: 'report' } } });
});

test('a note from a ready template shows its guidance in grey, and typing on a line of it takes its place', async ({ page }) => {
  const state = await notebook(page);
  await page.goto('/#notebook');
  await page.locator('[data-guide="notebook.ready"] .tile', { hasText: 'Incident brief (5W)' }).click();
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Incident brief (5W)');
  const made = state.catalog.at(-1);
  expect(state.looks[made.id]).toMatchObject({ style: 'brief' });
  const hint = page.locator('.cm-hint', { hasText: 'The event in two sentences' });
  await expect(hint).toBeVisible();
  await hint.click();
  await page.keyboard.type('Two vehicles crossed the bridge');
  await expect(hint).toHaveCount(0);
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('## What\n\nTwo vehicles crossed the bridge\n\n## Where');
});

test('a picture is sized on the page, and one pushed to the next page is fitted back', async ({ page }) => {
  const roof = {
    id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' }, provenance: { by: 'user', at, status: 'confirmed' },
  };
  const text = 'Intro\n\n[[media:m1|Roof]]{width=100%}\n\nAfter';
  // written at full width it goes to page 2 and leaves room on page 1; any narrower, it stays
  const pictures = (body) => (body.includes('{width=100%}')
    ? [{ line: 2, ref: 'media:m1', page: 1, box: [0.1, 0.08, 0.8, 0.6], width: '100%', align: 'left', gap: [0, 0.3, 0.9, 0.1, 0.9], fit: 62 }]
    : [{ line: 2, ref: 'media:m1', page: 0, box: [0.1, 0.3, 0.5, 0.4], width: '62%', align: 'left' }]);
  const state = await notebook(page, { extra: [note('n4', 'Pictures'), roof], texts: { n4: text }, pictures });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Pictures"]').click();
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();

  const gap = page.locator('.page-pane .sheet').first().locator('.gap');
  await expect(gap).toBeVisible();
  await gap.getByRole('button', { name: 'Fit the picture here' }).click();
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=62%}');
  await expect(page.locator('.page-pane .gap')).toHaveCount(0);

  // the same sizes over the picture in the page and in the note
  const placed = page.locator('.page-pane .picture').first();
  await placed.hover();
  await placed.getByRole('button', { name: 'Centre' }).click();
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=62% align=center}');
  const block = page.locator('.cm-block-picture');
  await block.hover();
  await block.locator('[data-size-bar]').getByRole('button', { name: 'S', exact: true }).click();
  // the picture cannot be read here, so it is sized as a wide one: a third across
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=33% align=center}');
});

test('/ Page break writes the line the PDF starts a new page at, drawn as a rule', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/page');
  // the entry, not the preview beside the list that names it too
  await page.locator('.cm-tooltip-autocomplete').getByRole('option', { name: /^Page break/ }).click();
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('Line 30\n<!-- pagebreak -->\n');
  await page.keyboard.type('After the break.');
  await expect(page.locator('.cm-pagebreak')).toHaveText('Page break');
});

test('Look sets the typeface and the text size, each face drawn in itself, from the mouse or the keyboard', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  await expect(page.locator('.page-pane .sheet').first()).toBeVisible();
  // nothing is asked for before the Text tab of the Look shows
  expect(state.fontsAsked).toEqual([]);

  await page.locator('[data-guide="notebook.look"]').click();
  await expect(page.getByRole('tab', { name: 'Style' })).toHaveAttribute('aria-selected', 'true');
  expect(state.fontsAsked).toEqual([]);
  await page.getByRole('tab', { name: 'Text' }).click();
  const cards = page.locator('.font-card');
  await expect(cards.locator('.font-name')).toHaveText(["Style's own", 'Noto Serif', 'Noto Sans', 'Literata', 'IBM Plex Sans']);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "azimut-note-book"'))).toBe(true);
  await expect(cards.nth(3).locator('.font-ag')).toHaveCSS('font-family', /azimut-note-book/);
  expect([...state.fontsAsked].sort()).toEqual(['book', 'modern', 'sans', 'serif']);

  await cards.nth(3).click();
  await expect.poll(() => state.looks.n1?.font).toBe('book');
  await expect.poll(() => state.previews.at(-1)?.look?.font).toBe('book');
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Larger' }).click();
  await expect.poll(() => state.looks.n1?.size).toBe('large');
  await expect.poll(() => state.previews.at(-1)?.look).toMatchObject({ font: 'book', size: 'large' });

  // the keyboard: the panel opens on the tab last used with that tab in focus, and Tab carries on inside its section
  await page.keyboard.press('Escape');
  await expect(page.locator('.font-card')).toHaveCount(0);
  await expect(page.locator('[data-guide="notebook.look"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Text' })).toBeFocused();
  for (let step = 0; step < 20; step += 1) {
    if (await page.evaluate(() => document.activeElement?.textContent?.includes('IBM Plex Sans'))) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => state.looks.n1?.font).toBe('modern');
});

test('a caption is written in place under a picture, in the note and on its page', async ({ page }) => {
  const roof = {
    id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' }, provenance: { by: 'user', at, status: 'confirmed' },
  };
  const pictures = () => [{ line: 2, ref: 'media:m1', page: 0, box: [0.1, 0.3, 0.5, 0.3], width: '62%', align: 'left' }];
  const state = await notebook(page, { extra: [note('n4', 'Pictures'), roof], texts: { n4: 'Intro\n\n[[media:m1|Roof]]{width=62%}\n\nAfter' }, pictures });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Pictures"]').click();
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();

  // the pages first: the note narrows when they come
  await expect(page.locator('.page-pane .picture')).toHaveCount(1);

  // in the note: the field opens where the caption prints, Enter writes it
  const block = page.locator('.cm-block-picture');
  await block.hover();
  await block.locator('[data-size-bar]').getByRole('button', { name: 'Caption' }).click();
  const field = block.getByRole('textbox', { name: 'Caption' });
  await expect(field).toBeFocused();
  await field.fill('Smoke over the port');
  await field.press('Enter');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=62% caption="Smoke over the port"}');
  await expect(page.locator('.cm-block-picture .markdown-caption')).toHaveText('Smoke over the port');
  await expect(page.locator('.picture-caption-field')).toHaveCount(0);

  // on the page: the same field, holding what the line says
  const placed = page.locator('.page-pane .picture').first();
  await placed.hover();
  await placed.getByRole('button', { name: 'Caption' }).click();
  const there = page.locator('.page-pane').getByRole('textbox', { name: 'Caption' });
  await expect(there).toHaveValue('Smoke over the port');
  await there.fill('Smoke over the north quay');
  await there.press('Escape');
  await expect(there).toHaveCount(0);
  expect(state.written.at(-1).text).toContain('caption="Smoke over the port"');
  await placed.hover();
  await placed.getByRole('button', { name: 'Caption' }).click();
  await there.fill('Smoke over the north quay');
  await there.press('Enter');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('{width=62% caption="Smoke over the north quay"}');
});

test('the Page pane lists what the PDF warns about, and a warning with a line takes the note there', async ({ page }) => {
  const warnings = (text) => (text.includes('## Method\n\n## Sources')
    ? [['Section "Method" is empty.', 20], ['A picture is missing', null]]
    : [['A picture is missing', null]]);
  const body = [...Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`), '## Method', '', '## Sources', '', 'Archive.'].join('\n');
  const state = await notebook(page, { warnings, texts: { n1: body } });
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const list = page.locator('.page-pane').getByRole('list', { name: 'Warnings' });
  await expect(list.getByRole('listitem')).toHaveText(['Section "Method" is empty.', 'A picture is missing']);
  await expect(page.locator('.page-pane .pane-bar')).toContainText('2 warnings');
  await list.getByRole('button', { name: /Method/ }).click();
  // the empty section gets a line of its own under the heading: what is typed starts it, never lengthens the heading
  await page.keyboard.type('Measured shadows.');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('Line 20\n## Method\n\nMeasured shadows.\n\n## Sources\n');
  // folded away from the bar
  await page.locator('.page-pane .warned').click();
  await expect(list).toHaveCount(0);
});

test('the export says what the PDF would warn about first, Go to takes the note to the line, and Export anyway writes it', async ({ page }) => {
  const checks = (id) => ({
    n1: [
      { text: 'Picture "Roof" has no source.', line: 20, kind: 'unsourced' },
      { text: 'Picture "Quay" is no longer in the case.', line: null, kind: 'missing' },
    ],
    n3: [{ text: '2 tasks are still open.', line: 0, kind: 'open-task' }],
  })[id] ?? [];
  const state = await notebook(page, { checks });
  await openLead(page);
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  const before = dialog.getByRole('region', { name: 'Before you export' });
  await expect(before.getByRole('listitem')).toHaveText([/Roof" has no source\.\s*Go to/, 'Picture "Quay" is no longer in the case.']);
  expect(state.checked).toEqual([['n1']]);
  await expect(dialog.getByRole('button', { name: 'Export anyway' })).toBeVisible();
  // the keyboard reaches Go to past Ready to publish?, the five formats and the destination,
  // and lands in the note at the line
  const go = before.getByRole('button', { name: 'Go to' });
  for (let press = 0; press < 16; press += 1) {
    await page.keyboard.press('Tab');
    if (await go.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(go).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.type('X');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('\nXLine 21\n');
  expect(state.exported).toEqual([]);

  // asked again on the next export, and written once told to go on
  await page.locator('[data-guide="notebook.pdf"]').click();
  await expect(dialog.getByRole('region', { name: 'Before you export' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Export anyway' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported).toEqual([['n1']]);

  // several notes: what each would warn about under its title, the clear ones left out
  await page.locator('[data-guide="notebook.home"]').click();
  await page.locator('input[aria-label="Pick Lead"]').check();
  await page.locator('input[aria-label="Pick Shadows"]').check();
  await page.locator('input[aria-label="Pick Mast"]').check();
  await page.locator('[data-guide="notebook.selection"]').getByRole('button', { name: 'Export', exact: true }).click();
  const several = page.getByRole('dialog', { name: 'Export notes as PDF' });
  await expect(several.getByRole('list')).toHaveCount(2);
  await expect(several.getByRole('list', { name: 'Lead' }).getByRole('listitem')).toHaveCount(2);
  await expect(several.getByRole('list', { name: 'Mast' }).getByRole('listitem')).toHaveText([/2 tasks are still open\.\s*Go to/]);
  await expect(several.getByRole('list', { name: 'Shadows' })).toHaveCount(0);
  await several.getByRole('list', { name: 'Mast' }).getByRole('button', { name: 'Go to' }).click();
  await expect(several).toHaveCount(0);
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Mast');
});

test('the export counts the links nobody archived in one line, its links folded under it, each one gone to', async ({ page }) => {
  const LINKS = [
    ['Al-Khabar al-Yemeni, 16 Nov', 'https://alkhabaralyemeni.net/2026/11/16/a', 4],
    ['YemenExtra, 10 Oct', 'https://www.yemenextra.net/2026/10/10/b', 9],
    ['Mereja, 10 Oct', 'https://mereja.com/c', 14],
    ['BBC, 5 Oct', 'https://www.bbc.com/news/articles/d', 20],
    ['ISW', 'https://understandingwar.org/e', 25],
  ].map(([text, url, line]) => ({ text, url, line }));
  const checks = (id) => (id === 'n1' ? [
    { text: '5 outside links have no archived copy.', line: 4, kind: 'unarchived', items: LINKS },
    { text: '“ISW” is not in the case, so no day says when it was read.', line: 25, kind: 'unseen' },
  ] : []);
  const state = await notebook(page, { checks });
  await openLead(page);
  await page.locator('[data-guide="notebook.pdf"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  const before = dialog.getByRole('region', { name: 'Before you export' });
  const warnings = before.getByRole('list', { name: 'Warnings' });
  await expect(warnings.locator(':scope > li')).toHaveCount(2);
  const line = warnings.locator(':scope > li').first();
  await expect(line).toContainText('5 outside links have no archived copy.');
  // folded: the first three by their words and how many more, no link listed yet
  const fold = line.locator('summary');
  await expect(fold).toHaveText('“Al-Khabar al-Yemeni, 16 Nov” · “YemenExtra, 10 Oct” · “Mereja, 10 Oct” and 2 more');
  const listed = line.getByRole('list', { name: '5 outside links have no archived copy.' });
  await expect(listed).toBeHidden();
  await dialog.screenshot({ path: test.info().outputPath('export-links-folded.png') });
  await fold.click();
  await expect(listed.getByRole('listitem')).toHaveText([
    /Al-Khabar al-Yemeni, 16 Nov\s*alkhabaralyemeni\.net\s*Go to/, /YemenExtra, 10 Oct\s*yemenextra\.net/, /Mereja/, /BBC, 5 Oct\s*bbc\.com/, /ISW/,
  ]);
  await dialog.screenshot({ path: test.info().outputPath('export-links-open.png') });
  // the export never waits on them
  await expect(dialog.getByRole('button', { name: 'Export anyway' })).toBeEnabled();
  // a link's Go to takes the note to its line
  await listed.getByRole('listitem').nth(3).getByRole('button', { name: 'Go to' }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.type('X');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('\nXLine 21\n');
  expect(state.exported).toEqual([]);
});

/**
 * Archive every link, its routes stood in: the plan, the press and the run read three
 * times, one more link archived each time. `left` is what the check counts: it drops to
 * none once the run says it is done. No route reaches the Internet Archive from here.
 */
async function archiveRoutes(page, state) {
  const LINKS = [
    ['Al-Khabar al-Yemeni, 16 Nov', 'https://alkhabaralyemeni.net/2026/11/16/a', false],
    ['YemenExtra, 10 Oct', 'https://www.yemenextra.net/2026/10/10/b', true],
    ['Mereja, 10 Oct', 'https://mereja.com/c', false],
  ].map(([text, url, held]) => ({ text, url, held }));
  const archive = { posts: [], polls: 0, left: 3, links: LINKS };
  const copy = (url, at) => `https://web.archive.org/web/${at.replace(/\D/g, '').slice(0, 14)}/${url}`;
  const runAt = (done) => {
    const made = ['2026-11-18T09:30:00Z', '2026-11-12T08:00:00Z', '2026-11-18T09:31:00Z'];
    const links = LINKS.map((link, index) => (index < done
      ? { url: link.url, text: link.text, state: index === 1 ? 'kept' : 'new', copy: copy(link.url, made[index]), made: made[index] }
      : { url: link.url, text: link.text, state: index === done ? 'saving' : 'waiting' }));
    const finished = done >= LINKS.length;
    return {
      state: finished ? 'done' : 'running', folder: 'Links of “Lead”', internal: false, fresh: false, reason: '',
      left: (LINKS.length - done) * 240, links,
      counts: { total: 3, archived: done, new: Math.min(done, 1) + (done > 2 ? 1 : 0), kept: done > 1 ? 1 : 0, older: 0, failed: 0 },
    };
  };
  await page.route(`**/api/cases/${CASE_ID}/notes/n1/archive**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/archive/stop')) return route.fulfill({ json: { run: { ...runAt(1), state: 'stopping' } } });
    if (request.method() === 'POST') {
      archive.posts.push(request.postDataJSON());
      return route.fulfill({ json: { run: { ...runAt(0), state: 'queued' } } });
    }
    if (path.endsWith('/archive/run')) {
      archive.polls += 1;
      const run = runAt(Math.min(archive.polls, LINKS.length));
      if (run.state === 'done') archive.left = 0;
      return route.fulfill({ json: { run } });
    }
    const plan = {
      links: LINKS.map((link) => ({ ...link, state: 'todo', copy: '', made: '' })), total: 3, todo: 3, archived: 0, filed: 2,
      more_internal: 1, folder: 'Links of “Lead”', max: 500, run: null,
    };
    return route.fulfill({ json: plan });
  });
  state.archive = archive;
  return archive;
}

test('Archive every link from the check: what goes out, the press, each link as it goes, and the count dropping at the end', async ({ page }) => {
  let archive = null;
  const checks = (id) => (id === 'n1' && archive.left ? [
    { text: `${archive.left} outside links have no archived copy.`, line: 0, kind: 'unarchived', items: archive.links },
  ] : []);
  const state = await notebook(page, { checks });
  archive = await archiveRoutes(page, state);
  await openLead(page);
  await page.locator('[data-guide="notebook.pdf"]').click();
  const exporting = page.getByRole('dialog', { name: 'Export note as PDF' });
  const line = exporting.getByRole('region', { name: 'Before you export' }).locator('.before-item').first();
  await expect(line).toContainText('3 outside links have no archived copy.');
  await line.getByRole('button', { name: 'Archive every link…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Archive every link of this note' });
  await expect(dialog).toContainText('Sends each address to the Internet Archive (web.archive.org)');
  await expect(dialog).toContainText('Links of the public edition (3)');
  await expect(dialog).toContainText('Include internal passages (1 more link)');
  await expect(dialog.locator('.head')).toHaveText('3 links to archive · 2 filed as bookmarks');
  await expect(dialog.getByRole('list', { name: 'Links' }).getByRole('listitem')).toHaveCount(3);
  await dialog.screenshot({ path: test.info().outputPath('archive-plan.png') });
  // nothing is asked before the press
  expect(archive.posts).toEqual([]);
  expect(archive.polls).toBe(0);

  await dialog.getByRole('button', { name: 'Archive 3 links' }).click();
  expect(archive.posts).toEqual([{ internal: false, fresh: false }]);
  await expect(dialog.locator('.head')).toContainText('1 of 3 archived', { timeout: 8000 });
  await expect(dialog.getByRole('listitem').nth(0)).toContainText(/new copy, 18 Nov/);
  await expect(dialog.getByRole('listitem').nth(1)).toContainText('saving…');
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  await dialog.screenshot({ path: test.info().outputPath('archive-running.png') });

  // closed while it goes: the run goes on, the export dialog still counts the three
  await dialog.getByRole('button', { name: 'Keep going in the background' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(line).toContainText('3 outside links have no archived copy.');
  // it ends: a toast says so, and the check is asked again, finding none
  await expect(page.getByText('Links of “Lead” archived: 3 of 3 archived.')).toBeVisible({ timeout: 10000 });
  await expect(exporting.getByRole('region', { name: 'Before you export' })).toHaveCount(0);
  await expect(exporting.getByRole('button', { name: 'Export PDF' })).toBeEnabled();
  await exporting.screenshot({ path: test.info().outputPath('archive-export-after.png') });
  expect(state.exported).toEqual([]);
});

test('the note\'s ⋯ archives its links, and the header says how far while the dialog is closed', async ({ page }) => {
  const state = await notebook(page);
  const archive = await archiveRoutes(page, state);
  await openLead(page);
  await page.locator('.tool-header').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menu', { name: 'Note actions' }).getByText('Archive every link…').click();
  const dialog = page.getByRole('dialog', { name: 'Archive every link of this note' });
  await dialog.getByText('Make fresh copies, even where one is under 30 days old').click();
  await dialog.getByRole('button', { name: 'Archive 3 links' }).click();
  expect(archive.posts).toEqual([{ internal: false, fresh: true }]);
  await dialog.getByRole('button', { name: 'Keep going in the background' }).click();
  const going = page.locator('.tool-header').getByRole('button', { name: /^Archiving \d of 3…$/ });
  await expect(going).toBeVisible();
  await page.locator('.tool-header').screenshot({ path: test.info().outputPath('archive-header.png') });
  await going.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.head')).toContainText('of 3 archived');
  await dialog.getByRole('button', { name: 'Keep going in the background' }).click();
  // once done, the header says nothing more
  await expect(page.getByText('Links of “Lead” archived: 3 of 3 archived.')).toBeVisible({ timeout: 10000 });
  await expect(going).toHaveCount(0);
});

test('a check that fails never holds the export back', async ({ page }) => {
  const state = await notebook(page);
  await page.route(`**/api/cases/${CASE_ID}/notes/pdf/check`, (route) => route.fulfill({ status: 500, json: { detail: 'Boom' } }));
  await openLead(page);
  const failed = page.waitForResponse((response) => response.url().endsWith('/notes/pdf/check'));
  await page.locator('[data-guide="notebook.pdf"]').click();
  expect((await failed).status()).toBe(500);
  const dialog = page.getByRole('dialog', { name: 'Export note as PDF' });
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog).not.toContainText('Before you export');
  await dialog.getByRole('button', { name: 'Export PDF' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.exported).toEqual([['n1']]);
});

test('a picture bar in the note is one Tab away, walked with the arrows, and keeps the keyboard after a press', async ({ page }) => {
  const roof = {
    id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' }, provenance: { by: 'user', at, status: 'confirmed' },
  };
  const state = await notebook(page, { extra: [note('n4', 'Pictures'), roof], texts: { n4: 'Intro\n\n[[media:m1|Roof]]\n\nAfter' } });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Pictures"]').click();
  await expect(page.locator('.cm-block-picture')).toBeVisible();
  await page.locator('.cm-content').click({ position: { x: 40, y: 10 } });
  // Escape lets Tab leave the text, onto the picture's bar
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const bar = page.locator('.cm-block-picture [data-size-bar]');
  await expect(bar.getByRole('button', { name: 'XXS', exact: true })).toBeFocused();
  await expect(bar).toHaveCSS('opacity', '1');
  for (const size of ['XS', 'S', 'M']) {
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('button', { name: size, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=50%}');
  await expect(page.locator('.cm-block-picture [data-size-bar]').getByRole('button', { name: 'M', exact: true })).toBeFocused();
  // the bar ends on </> (Edit the source), after Caption, Graphic, Replace and Side by side
  await page.keyboard.press('End');
  await expect(bar.getByRole('button', { name: 'Edit the source' })).toBeFocused();
  for (const name of ['Side by side', 'Replace…', 'Graphic', 'Caption']) {
    await page.keyboard.press('ArrowLeft');
    await expect(bar.getByRole('button', { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  const field = page.locator('.cm-block-picture').getByRole('textbox', { name: 'Caption' });
  await expect(field).toBeFocused();
  await page.keyboard.type('North roof');
  await page.keyboard.press('Enter');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=50% caption="North roof"}');
  // and Tab leaves the bar in one press
  await page.locator('.cm-content').click({ position: { x: 40, y: 10 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-block-picture [data-size-bar] button:focus')).toHaveCount(0);
});

test('For › Report adds the report\'s annexes to the Page pane, and a switch turned off takes one away', async ({ page }) => {
  await notebook(page);
  // the stand-in server prints a page per part: the note, then the sources and the annexes its look asks for
  const looks = [];
  const ANNEX_PAGES = [['geolocations', 'Geolocations'], ['credits', 'Credits'], ['method', 'How this was made'],
    ['limits', 'Limits'], ['editions', 'Editions and corrections']];
  await page.route(`**/api/cases/${CASE_ID}/notes/preview`, (route) => {
    const look = route.request().postDataJSON().look ?? {};
    looks.push(look);
    const labels = ['Lead'];
    if (look.style === 'report') {
      labels.push('Sources');
      labels.push(...ANNEX_PAGES.filter(([key]) => look.annexes?.[key] !== 'off').map(([, name]) => name));
    }
    return pdfAnswer(route, labels.map((_, index) => index * 10), {}, labels);
  });
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  const sheets = page.locator('.page-pane .sheet');
  await expect(sheets).toHaveCount(1);

  await page.locator('[data-guide="notebook.look"]').click();
  await page.getByRole('tab', { name: 'Style' }).click();
  const forRow = page.getByRole('radiogroup', { name: 'For' });
  await expect(forRow.getByRole('radio')).toHaveText([/^Report/, /^Web article/, /^Brief/, /^Journal/, /^Plain/]);
  await forRow.getByRole('radio', { name: /^Report/ }).click();
  // the note, its sources, then the five annexes
  await expect(sheets).toHaveCount(7);
  await expect(page.locator('.page-pane .pane-bar')).toContainText('7 pages');
  expect(looks.at(-1)).toMatchObject({ style: 'report', annexes: {}, sources_style: '' });

  const includes = page.getByRole('group', { name: 'What it includes' });
  // folded to one line until Change… opens it
  await expect(includes).toContainText('Academic sources · 5 annexes · links grouped');
  await includes.getByRole('button', { name: /Change…/ }).click();
  await expect(includes.locator('[data-include="method"]')).toContainText("Report's own");
  await includes.locator('[data-include="method"] input').click();
  await expect(sheets).toHaveCount(6);
  expect(looks.at(-1).annexes).toEqual({ method: 'off' });
  await expect(includes.locator('[data-include="method"]')).toContainText('Changed here');
  await includes.locator('[data-include="method"]').getByRole('button', { name: /reset/i }).click();
  await expect(sheets).toHaveCount(7);
});

test('Look › Cover signs the note at the end and puts the Azimut logo on the cover', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.look"]').click();
  await page.getByRole('tab', { name: 'Cover' }).click();
  // signing needs no cover: the note is signed after its last section
  await page.getByRole('radiogroup', { name: 'Signed' }).getByRole('radio', { name: 'At the end' }).click();
  await expect.poll(() => state.looks.n1?.signed).toBe('end');
  await page.getByRole('radiogroup', { name: 'Cover page' }).getByRole('radio', { name: "The style's" }).click();
  const marks = page.getByRole('group', { name: 'On the cover' });
  await marks.getByRole('button', { name: 'Azimut logo' }).click();
  await expect.poll(() => state.looks.n1?.cover).toMatchObject({ on: true, marks: ['azimut'] });
  await expect(marks.getByRole('button', { name: 'Azimut logo' })).toHaveAttribute('aria-pressed', 'true');
});
