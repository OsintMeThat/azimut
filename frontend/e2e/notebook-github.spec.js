import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A note published to GitHub Pages in one press, end to end in the browser: the export
 * dialog's Web folder branch giving the page's address on the site with a short name,
 * Publish, GitHub building the page, then Live at its address with Open and Copy link;
 * the note's Editions listing the page. A repository with Pages off is set up from the
 * dialog by its own press. The server and GitHub are stood in for: what is checked is
 * what the browser asks, and that nothing goes to GitHub before a press.
 *
 * `AZIMUT_SHOTS` names a folder the run also draws the views into, at 1440x900.
 */

const SHOTS = process.env.AZIMUT_SHOTS ?? '';
const at = '2026-10-01T10:00:00Z';
const ADDRESS = 'https://octo.github.io/articles/port-strike/';
const COMMIT = '3f1c9a2'.padEnd(40, '0');
const note = (id, label) => ({
  id, type: 'note', label, attrs: { path: `notes/${id}.md`, folder: '' }, provenance: { by: 'user', at, status: 'confirmed' },
});

async function shoot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function stand(page, { pages = true } = {}) {
  const catalog = [note('n1', 'Port strike')];
  const github = { account: 'octo', repo: 'articles', branch: 'main', site: '', base: 'https://octo.github.io/articles/',
    token: { set: true, hint: '…wxyz' } };
  await installAppFixture(page, { catalog, github });
  const state = {
    text: '## What we saw\n\nSmoke over the pier at dawn.\n\n> [!internal]\n> Who told us.\n',
    pages, published: [], builds: 0, presses: [], editions: [],
  };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: catalog, next_cursor: null, total: catalog.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route((url) => url.pathname.startsWith('/api/publishing/github'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    state.presses.push(path);
    if (path.endsWith('/pages')) {
      state.pages = true;
      return route.fulfill({ json: { ok: true, base: 'https://octo.github.io/articles/', pages: { url: 'https://octo.github.io/articles/' } } });
    }
    if (path.endsWith('/build')) {
      state.builds += 1;
      // the first answer takes a moment, so the dialog is seen while GitHub builds
      if (state.builds === 1) await new Promise((resolve) => setTimeout(resolve, 900));
      return route.fulfill({ json: { state: 'built', detail: '' } });
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
      return route.fulfill({ json: { notes: body.notes.map((id) => ({ note: id, title: 'Port strike', internal: 1, weight: 2_400_000,
        links: [], pov: [], earlier: 0, warnings: [{ text: '1 internal passage left out.', line: null, kind: 'internal' }] })) } });
    }
    if (path === '/n1/github') {
      const body = request.postDataJSON();
      if (!state.pages) {
        return route.fulfill({ json: { published: false, needs: 'pages', repository: 'octo/articles', detail: 'Pages is off for octo/articles.' } });
      }
      state.published.push(body);
      state.editions = [{ at: '2026-11-18T19:00:00Z', edition: 'public', format: 'github', file: body.short_name,
        address: `https://octo.github.io/articles/${body.short_name}/`, repository: 'octo/articles', branch: 'main',
        path: body.short_name, commit: COMMIT, sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64) }];
      return route.fulfill({ json: { published: true, address: `https://octo.github.io/articles/${body.short_name}/`,
        repository: 'octo/articles', branch: 'main', commit: COMMIT, sha256: 'a'.repeat(64), at: '2026-11-18T19:00:00Z',
        uploaded: 9, reused: 0, removed: 0, warnings: [] } });
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

async function openWebFolder(page) {
  await page.goto('/#notebook');
  await page.locator('button[title="Open Port strike"]').click();
  await expect(page.locator('.cm-content')).toContainText('Smoke over the pier');
  await page.locator('[data-guide="notebook.pdf"]').click();
  await page.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Web folder' }).click();
  return page.getByRole('dialog', { name: 'Export note as a web folder' });
}

test.use({ viewport: { width: 1440, height: 900 } });

test('a note goes live on GitHub Pages on one press, and its editions list the page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const state = await stand(page);
  const dialog = await openWebFolder(page);
  // the address is the site's own and a short name made from the title
  await expect(dialog.locator('.base')).toHaveText('https://octo.github.io/articles/');
  await expect(dialog.getByRole('textbox', { name: 'Short name' })).toHaveValue('port-strike');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toHaveClass(/btn-primary/);
  await expect(dialog.getByRole('button', { name: 'Export web folder' })).toBeEnabled();
  await shoot(page, 'dialog-github');
  expect(state.presses).toEqual([]);
  expect(state.published).toEqual([]);

  // a short name that is no address part is said, and holds both back
  const short = dialog.getByRole('textbox', { name: 'Short name' });
  await short.fill('Port Strike');
  await expect(dialog.locator('#export-short-said')).toContainText('A short name holds lower-case letters');
  await expect(dialog.getByRole('button', { name: 'Publish to GitHub Pages' })).toBeDisabled();
  await short.fill('port-strike');

  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog).toContainText('GitHub is building the page…');
  await shoot(page, 'dialog-github-building');
  const live = dialog.locator('.line.done');
  await expect(live).toContainText(`Live at ${ADDRESS}`);
  await expect(live.getByRole('link')).toHaveAttribute('href', ADDRESS);
  const open = dialog.getByRole('link', { name: 'Open', exact: true });
  await expect(open).toHaveAttribute('href', ADDRESS);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  // its maps go live online unless the dialog's Keep its maps offline is ticked
  expect(state.published).toEqual([{ short_name: 'port-strike', diagrams: {}, round_pov: false, changes: '', offline_maps: false }]);
  await shoot(page, 'dialog-github-live');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.locator('button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Editions' }).click();
  const row = page.getByRole('dialog', { name: 'Editions' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('GitHub');
  await expect(row).toContainText(ADDRESS);
  await expect(row).toContainText('octo/articles · 3f1c9a2');
  await expect(row.getByRole('link', { name: 'Open' })).toHaveAttribute('href', ADDRESS);
  await expect(row.getByRole('button', { name: 'Check' })).toBeVisible();
  await shoot(page, 'editions-github');
});

test('Pages turned off is turned on from the dialog by its own press', async ({ page }) => {
  const state = await stand(page, { pages: false });
  const dialog = await openWebFolder(page);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog).toContainText('Pages is off for octo/articles.');
  await expect(dialog).toContainText('Serves the branch from its root. The site is public.');
  expect(state.published).toEqual([]);
  await shoot(page, 'dialog-github-pages-off');
  await dialog.getByRole('button', { name: 'Turn on Pages' }).click();
  await expect(dialog).toContainText('Pages is on. Press Publish to GitHub Pages.');
  expect(state.presses).toEqual(['/api/publishing/github/pages']);
  await dialog.getByRole('button', { name: 'Publish to GitHub Pages' }).click();
  await expect(dialog.locator('.line.done')).toContainText(`Live at ${ADDRESS}`);
});
