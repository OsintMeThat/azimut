import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * The note in the extension's side panel, framed by a stand-in for the extension's
 * page: the panel says which note it holds, and a quote, a cite and a capture sent
 * from the page land in the note, each with the toast and its Undo.
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
  addEventListener('message', (event) => { if (event.source === frames[0]) window.told.push(event.data); });
</script>`;

async function framedNote(page, { testParent = true } = {}) {
  const fixture = await installAppFixture(page, {
    newEntityId: 'b_new',
    catalog: [CAPTURE],
    chains: { e_cap: { entity: CAPTURE, sources: [], lost: [], dependents: [], relations: [] } },
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

const told = (page) => page.evaluate(() => window.told);
const send = (page, message) => page.evaluate((data) => frames[0].postMessage(data, location.origin), message);
const put = (id, fields) => ({ azimut: 'note-put', v: 1, id, ...fields });

test('a quote, a cite and a capture sent from the extension\'s page land in the panel\'s note, each with Undo', async ({ page }) => {
  const { fixture, written, looked, frame } = await framedNote(page);

  // the case and a picker, and nothing else
  await expect(frame.locator('.panel-bar .case')).toHaveText('Browser Test');
  await expect(frame.locator('.panel-bar button.which')).toContainText('Case notes');
  await expect(frame.locator('.panel-bar button')).toHaveCount(1);
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
