import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * The note in the extension's side panel, framed by a stand-in for the extension's
 * page: the panel says which note it holds, and a quote, a cite and a capture sent
 * from the page land in the note, each with the toast and its Undo. Page shows the
 * note's PDF in place of its text, and the bar switches the case in place. Its Add
 * menu asks the page what the tab in front is, and asks it to do the item pressed.
 *
 * A browser test cannot be an extension, so the stand-in is a page of the app's own
 * origin and says so in the frame's address (`testParent=1`). Only a test run honours
 * that (`lib/notes/panelOrigin.js`); a build drops it (`panelOrigin.build.test.js`).
 */

const PAGE = 'https://example.org/news/strike';
const BOOKMARK = { id: 'b_new', type: 'bookmark', label: 'Strike on the port', attrs: { url: PAGE } };
const CAPTURE = {
  id: 'e_cap', type: 'capture', label: 'Strike seen from the quay', attrs: { path: PANEL_PATH, kind: 'image' },
  provenance: { by: 'ingest', at: new Date().toISOString(), status: 'confirmed' },
};

/** The extension's page, as a stand-in: the note framed at a panel's width, and what it is told kept. */
const host = (src) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">
<iframe src="${src}" title="Notes" style="display:block;width:360px;height:640px;border:0"></iframe>
<script>
  window.told = [];
  // the tab in front, which a test sets; the panel is told it when it asks
  window.tab = null;
  addEventListener('message', (event) => {
    if (event.source !== frames[0]) return;
    window.told.push(event.data);
    if (event.data && event.data.azimut === 'note-tab-ask' && window.tab) frames[0].postMessage(window.tab, location.origin);
  });
</script>`;

const SECOND = { id: 'dock-fire', name: 'Dock fire', scratch: false, entities: [], links: [], folders: [] };

async function framedNote(page, { testParent = true, cases = undefined } = {}) {
  const fixture = await installAppFixture(page, {
    newEntityId: 'b_new',
    catalog: [CAPTURE],
    chains: { e_cap: { entity: CAPTURE, sources: [], lost: [], dependents: [], relations: [] } },
    ...(cases ? { cases } : {}),
  });
  const written = [];
  let text = '';
  await page.route(`**/api/cases/${CASE_ID}/notes`, async (route) => {
    if (route.request().method() === 'PUT') {
      text = route.request().postDataJSON().text;
      written.push(text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  // the page is not in the case until the quote keeps it; Cite then finds it there
  const looked = [];
  await page.route(`**/api/cases/${CASE_ID}/sources/lookup?**`, (route) => {
    looked.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({ json: { url: PAGE, title: 'Strike on the port', found: looked.length > 1 ? [BOOKMARK] : [] } });
  });
  const src = `/#notebook?case=${CASE_ID}&note=case&solo=1&panel=1${testParent ? '&testParent=1' : ''}`;
  await page.route('**/panel-host.html', (route) => route.fulfill({ contentType: 'text/html', body: host(src) }));
  await page.goto('/panel-host.html');
  return { fixture, written, looked, frame: page.frameLocator('iframe') };
}

/** How the note in the frame is shown: `Write` or `Page`. */
const shown = (frame) => frame.locator('.panel-bar .modes button[aria-pressed="true"]');

const told = (page) => page.evaluate(() => window.told);
const send = (page, message) => page.evaluate((data) => frames[0].postMessage(data, location.origin), message);
const put = (id, fields) => ({ azimut: 'note-put', v: 1, id, ...fields });

test('a quote, a cite and a capture sent from the extension\'s page land in the panel\'s note, each with Undo', async ({ page }) => {
  const { fixture, written, looked, frame } = await framedNote(page);

  // the case, the note, its Look, Write | Page and Add, and nothing else
  await expect(frame.locator('.panel-bar .case')).toHaveText('Browser Test');
  await expect(frame.locator('.panel-bar button.which')).toContainText('Case notes');
  await expect(frame.locator('.panel-bar button')).toHaveText(['Browser Test', 'Case notes', /Look/, 'Write', 'Page', 'Add']);
  await expect.poll(() => told(page)).toContainEqual({
    azimut: 'note-panel', v: 1, state: 'ready', caseId: CASE_ID, noteId: 'case', title: 'Case notes',
  });

  await send(page, put('put-1', { action: 'quote', url: PAGE, title: 'Strike | Example News', text: 'Berths 10 to 14\nwere closed.' }));
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-1', ok: true });
  await expect.poll(() => written.at(-1) ?? '').toContain(
    `> [“Berths 10 to 14 were closed.”](${PAGE}#:~:text=Berths%2010%20to%2014,were%20closed.) [[entity:b_new|Strike on the port]]`);
  expect(looked[0]).toEqual({ url: PAGE, title: 'Strike | Example News' });
  expect(fixture.entityWrites).toContainEqual({
    type: 'bookmark', label: 'Strike on the port', attrs: { url: PAGE, notes: '', folder: '' },
  });
  await expect(frame.locator('.cm-chip', { hasText: 'Strike on the port' })).toBeVisible();

  // the page is in the case now: Cite finds it rather than filing it again
  await send(page, put('put-2', { action: 'cite', url: PAGE, title: 'Strike | Example News' }));
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-2', ok: true });
  await expect.poll(() => (written.at(-1) ?? '').split('[[entity:b_new|').length).toBe(3);
  expect(fixture.entityWrites.filter((write) => write.type === 'bookmark')).toHaveLength(1);

  await send(page, put('put-3', { action: 'picture', url: PAGE, title: 'Strike | Example News', entityId: 'e_cap' }));
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-3', ok: true });
  await expect.poll(() => written.at(-1) ?? '').toContain('[[media:e_cap|Strike seen from the quay]]');
  // a picture asks for its caption, as every tool's does
  const caption = frame.locator('.picture-caption-field');
  await expect(caption).toBeFocused();
  await caption.press('Escape');

  // Undo takes the capture back out, and to the Trash, since the extension filed it for this
  const deleted = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().endsWith('/entities/e_cap'));
  await frame.locator('.toast', { hasText: 'Put in “Case notes”' }).last().getByRole('button', { name: 'Undo' }).click();
  await deleted;
  await expect.poll(() => written.at(-1) ?? '').not.toContain('[[media:e_cap|');
  fixture.expectNoUnexpectedRequests();
});

test('a page of the app\'s own origin that is not the test\'s stand-in gets no answer, and puts nothing', async ({ page }) => {
  const { fixture, written, frame } = await framedNote(page, { testParent: false });
  await expect(frame.locator('.panel-bar button.which')).toContainText('Case notes');
  await expect.poll(() => told(page)).toContainEqual(expect.objectContaining({ azimut: 'note-panel', state: 'ready' }));

  await send(page, put('put-9', { action: 'cite', url: PAGE }));
  await page.waitForTimeout(800);
  expect((await told(page)).filter((message) => message.azimut === 'note-put-done')).toEqual([]);
  expect(written.join('')).not.toContain('[[entity:');
  expect(fixture.entityWrites).toEqual([]);
});

test('Page shows the panel\'s note as its PDF in place of the text, kept for the panel, and what is sent brings the text back', async ({ page }) => {
  const { fixture, written, frame } = await framedNote(page);
  await expect.poll(() => told(page)).toContainEqual(expect.objectContaining({ azimut: 'note-panel', state: 'ready' }));
  await frame.locator('.cm-content').click();
  await frame.locator('.cm-content').pressSequentially('Berths 10 to 14 closed.');
  await expect.poll(() => written.at(-1) ?? '').toBe('Berths 10 to 14 closed.');

  const previews = [];
  page.on('request', (request) => { if (request.url().endsWith('/notes/preview')) previews.push(request.postDataJSON()); });
  await frame.getByRole('button', { name: 'Page' }).click();
  await expect(shown(frame)).toHaveText('Page');
  // the server's PDF, drawn by PDF.js across the panel, the text hidden under it
  const sheet = frame.locator('.page-pane .sheet');
  await expect(sheet).toHaveCount(1);
  await expect(sheet.locator('canvas')).toHaveCount(1);
  expect((await sheet.boundingBox()).width).toBeGreaterThan(300);
  await expect(frame.locator('.cm-content')).toBeHidden();
  expect(previews.at(-1)).toMatchObject({ note: 'case', title: 'Case notes', text: 'Berths 10 to 14 closed.' });

  // kept for the panel: it opens on the pages again
  await page.reload();
  await expect(frame.locator('.page-pane .sheet canvas')).toHaveCount(1);
  await expect(shown(frame)).toHaveText('Page');

  // a page pressed goes back to the text, at the line it starts at
  await frame.locator('.page-pane .sheet .hit').click();
  await expect(frame.locator('.page-pane')).toHaveCount(0);
  await expect(shown(frame)).toHaveText('Write');
  await expect(frame.locator('.cm-content')).toBeFocused();

  // a quote sent while the pages show brings the text back, and lands in it
  await frame.getByRole('button', { name: 'Page' }).click();
  await expect(frame.locator('.page-pane .sheet canvas')).toHaveCount(1);
  await send(page, put('put-p', { action: 'quote', url: PAGE, title: 'Strike | Example News', text: 'The port reopened.' }));
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-p', ok: true });
  await expect(frame.locator('.page-pane')).toHaveCount(0);
  await expect(shown(frame)).toHaveText('Write');
  await expect(frame.locator('.cm-content')).toContainText('The port reopened.');
  fixture.expectNoUnexpectedRequests();
});

test('Add asks the extension\'s page what the tab in front is, lists what it can give, and asks for the one pressed', async ({ page }) => {
  const { frame } = await framedNote(page);
  await expect.poll(() => told(page)).toContainEqual(expect.objectContaining({ azimut: 'note-panel', state: 'ready' }));
  await page.evaluate(() => {
    window.tab = {
      azimut: 'note-tab', v: 1, access: 'open', url: 'https://example.org/news/strike', title: 'Strike | Example News',
      selection: 'Berths 10 to 14 were closed.', post: false, map: false,
    };
  });

  await frame.getByRole('button', { name: 'Add' }).click();
  const menu = frame.getByRole('menu', { name: 'Add to this note' });
  await expect(menu.getByRole('menuitem')).toHaveText([/This page/, /The passage selected/, /A source/]);
  await expect(menu).toContainText('example.org');
  await expect(menu).toContainText('“Berths 10 to 14 were closed.”');
  expect(await told(page)).toContainEqual({ azimut: 'note-tab-ask', v: 1 });

  await menu.getByRole('menuitem', { name: /The passage selected/ }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-tab-run', v: 1, action: 'quote' });

  // a tab the extension may not read yet offers its first permission, and the page is asked for it
  await page.evaluate(() => { window.tab = { azimut: 'note-tab', v: 1, access: 'closed', url: '', title: '', selection: '', post: false, map: false }; });
  await frame.getByRole('button', { name: 'Add' }).click();
  await frame.getByRole('menuitem', { name: /Allow Azimut on this tab/ }).click();
  await expect.poll(() => told(page)).toContainEqual({ azimut: 'note-tab-run', v: 1, action: 'allow' });
});

test('the Look in the panel\'s bar keeps a style beside the note and fits the panel\'s width', async ({ page }) => {
  const { frame } = await framedNote(page);
  await expect(frame.locator('.panel-bar button.which')).toContainText('Case notes');
  await frame.locator('.panel-bar [data-guide="notebook.look"]').click();
  const look = frame.getByRole('dialog', { name: 'Look' });
  // the panel is 360 px wide: the Look is no wider than it, less its margins
  expect((await look.boundingBox()).width).toBeLessThanOrEqual(344);
  await expect(look.getByRole('tab')).toHaveCount(5);
  const wrote = page.waitForRequest((request) => request.method() === 'PUT' && request.url().endsWith('/notes/case/look'));
  await look.getByRole('tab', { name: 'Style' }).click();
  await look.locator('.style-card', { hasText: 'Journal' }).click();
  expect((await wrote).postDataJSON()).toMatchObject({ style: 'journal' });
});

test('the panel switches to another case in place, from its bar', async ({ page }) => {
  const { frame } = await framedNote(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: [] }, SECOND],
  });
  await page.route(`**/api/cases/${SECOND.id}/notes`, (route) => route.fulfill({ json: { text: 'Smoke over the depot.' } }));
  await expect.poll(() => told(page)).toContainEqual(expect.objectContaining({ state: 'ready', caseId: CASE_ID }));

  await frame.locator('.panel-bar button.case').click();
  const menu = frame.getByRole('menu', { name: 'Cases' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Browser Test', 'Dock fire']);
  await expect(menu.locator('[aria-current="true"]')).toHaveText('Browser Test');
  await menu.getByRole('menuitem', { name: 'Dock fire' }).click();

  await expect(frame.locator('.panel-bar .case')).toHaveText('Dock fire');
  await expect(frame.locator('.cm-content')).toContainText('Smoke over the depot.');
  await expect.poll(() => told(page)).toContainEqual({
    azimut: 'note-panel', v: 1, state: 'ready', caseId: SECOND.id, noteId: 'case', title: 'Case notes',
  });
  const address = await frame.locator(':root').evaluate(() => location.hash);
  expect(address).toContain(`case=${SECOND.id}`);
  expect(address).toContain('note=case');
});
