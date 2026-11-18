import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A note sent to WordPress as a draft, end to end in the browser: the site connected in
 * Settings › Publishing, the export dialog's WordPress branch saying where the draft goes
 * and what stays out, Send, and Open in WordPress; then the note's Editions listing the
 * draft. The server and the site are stood in for: what is checked is what the browser
 * asks, and that nothing reaches WordPress before a press.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the two views into, at 1440x900.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';
const at = '2026-10-01T10:00:00Z';
const SITE = 'https://desk.example.org';
const EDIT = `${SITE}/wp-admin/post.php?post=21&action=edit`;
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function stand(page, { connected = true } = {}) {
  const catalog = [note('n1', 'Port strike')];
  await installAppFixture(page, { catalog });
  const state = {
    text: '## What we saw\n\nSmoke over the pier at dawn.\n\n> [!internal]\n> Who told us.\n',
    wordpress: connected ? { site: SITE, user: 'desk', password: { set: true, hint: '…6789' } }
      : { site: '', user: '', password: { set: false, hint: '' } },
    sent: [], checks: [], tests: 0, saves: [], editions: [],
  };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith('/api/publishing'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/publishing') return route.fulfill({ json: { wordpress: state.wordpress } });
    if (path === '/api/publishing/wordpress/test') {
      state.tests += 1;
      return route.fulfill({ json: { ok: true, name: 'Desk editor', site_name: 'Open Source Desk', detail: '' } });
    }
    if (path === '/api/publishing/wordpress' && request.method() === 'PUT') {
      const body = request.postDataJSON();
      state.saves.push(body);
      if (body.site !== undefined) state.wordpress.site = body.site.startsWith('http') ? body.site : `https://${body.site}`;
      if (body.user !== undefined) state.wordpress.user = body.user;
      if (body.password) state.wordpress.password = { set: true, hint: `…${body.password.replace(/ /g, '').slice(-4)}` };
      return route.fulfill({ json: state.wordpress });
    }
    return route.fallback();
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '' || path === '/case') return route.fulfill({ json: { text: '' } });
    if (path === '/index') {
      const row = (id, title, text) => ({
        id, title, folder: '', updated_at: at, excerpt: text.split('\n')[0], words: 6, tasks: { open: 0, done: 0 },
        mentions: 0, pictures: 0, look: null, includes: 0,
      });
      return route.fulfill({ json: { items: [row('case', 'Case notes', ''), row('n1', 'Port strike', state.text)] } });
    }
    if (path === '/pdf/diagrams') return route.fulfill({ json: { diagrams: [] } });
    if (path === '/pdf/check') {
      const body = request.postDataJSON();
      state.checks.push(body);
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Port strike', internal: 1,
        warnings: [{ text: '1 internal passage left out.', line: null, kind: 'internal' }] })) } });
    }
    if (path === '/n1/wordpress') {
      const body = request.postDataJSON();
      const said = { site: SITE, left: { internal: 1, maps: 1, clips: 0, diagrams: 0, other: 0 },
        left_said: '1 internal passage and 1 interactive map stay out.', pictures: 4, clips: 1, pov: [],
        warnings: ['Picture "The pier" has no source.'] };
      if (body.check) return route.fulfill({ json: { ...said, ready: true } });
      state.sent.push(body);
      state.editions = [{ at: '2026-11-18T19:00:00Z', edition: 'public', format: 'wordpress', site: SITE, post: 21, edit: EDIT,
        preview: `${SITE}/?p=21&preview=true`, text_sha256: 'b'.repeat(64) }];
      return route.fulfill({ json: { ...said, post: 21, edit: EDIT, preview: `${SITE}/?p=21&preview=true`, updated: false } });
    }
    if (path === '/n1/editions') return route.fulfill({ json: { editions: state.editions } });
    if (/^\/[\w-]+\/look$/.test(path)) return route.fulfill({ json: { look: { style: 'report' } } });
    if (path === '/n1') {
      if (method === 'PUT') { state.text = request.postDataJSON().text; return route.fulfill({ json: { status: 'saved' } }); }
      return route.fulfill({ json: { text: state.text } });
    }
    return route.fallback();
  });
  return state;
}

test.use({ viewport: { width: 1440, height: 900 } });

test('a note goes to WordPress as a draft on one press, and its editions list the draft', async ({ page }) => {
  const state = await stand(page);
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await expect(page.locator('.cm-content')).toContainText('Smoke over the pier');

  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'WordPress draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export note as a WordPress draft' });
  await expect(dialog).toContainText('To desk.example.org as desk, as a draft you publish in WordPress.');
  await expect(dialog).toContainText('4 pictures and 1 clip go to the media library, without their metadata.');
  await expect(dialog).toContainText('1 internal passage and 1 interactive map stay out.');
  // the branch checks the public edition itself: the dialog's PDF check is not asked again
  await expect(dialog.getByRole('region', { name: 'Before you send' })).toContainText('Picture "The pier" has no source.');
  expect(state.checks).toHaveLength(1);
  expect(state.sent).toEqual([]);
  await expect(dialog.getByRole('group', { name: 'Edition' })).toHaveCount(0);
  await shoot(page, 'dialog-wordpress');

  await dialog.getByRole('button', { name: 'Send as a draft' }).click();
  await expect(dialog).toContainText('Draft saved in WordPress.');
  const open = dialog.getByRole('link', { name: 'Open in WordPress' });
  await expect(open).toHaveAttribute('href', EDIT);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(dialog.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', `${SITE}/?p=21&preview=true`);
  expect(state.sent).toEqual([{ diagrams: {}, round_pov: false }]);
  await shoot(page, 'dialog-wordpress-sent');
  await dialog.getByRole('button', { name: 'Close' }).last().click();

  await page.locator('button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Editions' }).click();
  const row = page.getByRole('dialog', { name: 'Editions' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('WordPress');
  await expect(row).toContainText('Draft on desk.example.org');
  await expect(row.getByRole('link', { name: 'Open in WordPress' })).toHaveAttribute('href', EDIT);
  await expect(row.getByRole('button', { name: 'Check' })).toHaveCount(0);
});

test('a site not set up shows the steps in the dialog and in Settings, and is connected there', async ({ page }) => {
  const state = await stand(page, { connected: false });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'WordPress draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export note as a WordPress draft' });
  await expect(dialog).toContainText('Connect your WordPress site once');
  await expect(dialog).toContainText('Users › Profile');
  await expect(dialog.getByRole('button', { name: 'Send as a draft' })).toBeDisabled();
  await shoot(page, 'dialog-wordpress-setup');
  await dialog.getByRole('button', { name: 'Open Settings › Publishing' }).click();

  const section = page.getByRole('region', { name: 'WordPress', exact: true });
  await expect(section).toBeVisible();
  await expect(section.locator('details.how')).toHaveAttribute('open', '');
  expect(state.tests).toBe(0);
  await section.getByPlaceholder('https://example.org').fill('desk.example.org');
  await section.getByPlaceholder('https://example.org').press('Tab');
  await section.getByPlaceholder('editor').fill('desk');
  await section.getByPlaceholder('editor').press('Tab');
  await section.locator('input[type="password"]').fill('abcd EFGH 1234 ijkl MNOP 6789');
  await section.locator('input[type="password"]').press('Tab');
  await expect(section).toContainText('ending 6789');
  await expect(section.locator('input[type="password"]')).toHaveValue('');
  expect(state.saves).toEqual([{ site: 'desk.example.org' }, { user: 'desk' }, { password: 'abcd EFGH 1234 ijkl MNOP 6789' }]);
  expect(state.tests).toBe(0);
  await section.getByRole('button', { name: 'Test connection' }).click();
  await expect(section).toContainText('Connected as Desk editor on Open Source Desk.');
  expect(state.tests).toBe(1);
  await section.scrollIntoViewIfNeeded();
  await shoot(page, 'settings-wordpress');
});
