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
  await bar.getByRole('button', { name: 'Export as PDF' }).click();
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
  await page.locator('.cm-tooltip-autocomplete').getByText('Page break').click();
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('Line 30\n<!-- pagebreak -->\n');
  await page.keyboard.type('After the break.');
  await expect(page.locator('.cm-pagebreak')).toHaveText('Page break');
});

test('Look sets the typeface and the text size, each face drawn in itself, from the mouse or the keyboard', async ({ page }) => {
  const state = await notebook(page);
  await openLead(page);
  await page.locator('[data-guide="notebook.view"]').getByRole('button', { name: 'Page' }).click();
  await expect(page.locator('.page-pane .sheet').first()).toBeVisible();
  // nothing is asked for before the Look opens
  expect(state.fontsAsked).toEqual([]);

  await page.locator('[data-guide="notebook.look"]').click();
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

  // the keyboard: the panel opens on the style picked, and Tab carries on inside it
  await page.keyboard.press('Escape');
  await expect(page.locator('.font-card')).toHaveCount(0);
  await expect(page.locator('[data-guide="notebook.look"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.style-card', { hasText: 'Plain' })).toBeFocused();
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
  await page.keyboard.type('Measured shadows. ');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('Measured shadows. ## Method');
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
  // the keyboard reaches Go to past the destination, and lands in the note at the line
  const go = before.getByRole('button', { name: 'Go to' });
  for (let press = 0; press < 4; press += 1) {
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
  await page.locator('[data-guide="notebook.selection"]').getByRole('button', { name: 'Export as PDF' }).click();
  const several = page.getByRole('dialog', { name: 'Export notes as PDF' });
  await expect(several.getByRole('list')).toHaveCount(2);
  await expect(several.getByRole('list', { name: 'Lead' }).getByRole('listitem')).toHaveCount(2);
  await expect(several.getByRole('list', { name: 'Mast' }).getByRole('listitem')).toHaveText([/2 tasks are still open\.\s*Go to/]);
  await expect(several.getByRole('list', { name: 'Shadows' })).toHaveCount(0);
  await several.getByRole('list', { name: 'Mast' }).getByRole('button', { name: 'Go to' }).click();
  await expect(several).toHaveCount(0);
  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Mast');
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
  await expect(bar.getByRole('button', { name: 'S', exact: true })).toBeFocused();
  await expect(bar).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'M', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => state.written.at(-1)?.text ?? '').toContain('[[media:m1|Roof]]{width=50%}');
  await expect(page.locator('.cm-block-picture [data-size-bar]').getByRole('button', { name: 'M', exact: true })).toBeFocused();
  await page.keyboard.press('End');
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
