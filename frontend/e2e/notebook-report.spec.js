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
async function notebook(page, { templates = [] } = {}) {
  const catalog = [note('n1', 'Lead'), note('n2', 'Shadows', 'Leads'), note('n3', 'Mast')];
  await installAppFixture(page, { catalog });
  const state = {
    catalog,
    texts: { case: '', n1: LINES, n2: 'Shadow notes.', n3: 'Mast notes.' },
    looks: {},
    previews: [],
    written: [],
    exported: [],
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
  const pdf = (route, text) => pdfAnswer(route, pagesOf(text));

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
      return route.fulfill({ json: { items: [row('case', 'Case notes'), ...state.catalog.map((item) => row(item.id, item.label, item.attrs.folder))] } });
    }
    if (path === '/preview') {
      const body = request.postDataJSON();
      state.previews.push(body);
      return pdf(route, body.text);
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
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
