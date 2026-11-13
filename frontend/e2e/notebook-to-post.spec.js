import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * To Post from the Notebook, end to end in the browser: a note holding a paragraph,
 * a picture and an internal passage is sent from its header, the route is asked with
 * the note as the editor holds it, and Post is opened on a Free post starting from
 * the pieces it answered, what stayed out said once.
 *
 * The server is stood in for, as in `notebook-editions.spec.js`; its answer is the one
 * `engine/notepieces.py` gives for this note (`tests/test_note_pieces.py` holds the
 * stripping). Post is kept from loading, so the start it would adopt can be read
 * before it is taken.
 */

const at = '2026-10-01T10:00:00Z';
const CATALOG = [
  { id: 'n1', type: 'note', label: 'Quay strike', attrs: { path: 'notes/Quay strike.md', folder: '' }, provenance: { by: 'user', at, status: 'confirmed' } },
  { id: 'm1', type: 'media', label: 'Quay at dawn', attrs: { path: PANEL_PATH, kind: 'image' }, provenance: { by: 'user', at, status: 'confirmed' } },
];
const SECRET = 'Source is a port worker, do not publish.';
const NOTE = `Smoke rose over the quay at dawn.\n\n[[media:m1|Quay at dawn]]\n\n> [!internal] ${SECRET}\n`;
const PIECES = [
  { kind: 'text', text: 'Smoke rose over the quay at dawn.' },
  { kind: 'media', path: PANEL_PATH, type: 'image', id: 'm1' },
];

test('To Post sends the note and opens Post on a Free post of its public edition', async ({ page }) => {
  await installAppFixture(page, { catalog: CATALOG });
  const asked = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, (route) => (route.request().method() === 'PUT'
    ? route.fulfill({ json: { status: 'saved' } })
    : route.fulfill({ json: { text: NOTE } })));
  await page.route(`**/api/cases/${CASE_ID}/notes/n1/pieces`, (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ json: { title: 'Quay strike', pieces: PIECES, left: { internal: 1, tables: 0, diagrams: 0, other: 0 } } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route('**/src/tools/PostComposer.svelte**', (route) => route.abort());

  await page.goto('/#notebook');
  await page.locator('button[title="Open Quay strike"]').click();
  await expect(page.locator('.cm-content')).toContainText('Smoke rose over the quay');

  // its title says what goes: the selection while there is one, the note else
  const toPost = page.locator('[data-guide="notebook.to-post"]');
  await expect(toPost).toHaveAttribute('title', 'Opens Post with this note as a thread, its public edition only');
  await page.locator('.cm-line', { hasText: 'Smoke rose' }).dblclick();
  await expect(toPost).toHaveAttribute('title', 'Opens Post with the selection as a thread, its public edition only');
  await page.keyboard.press('Control+End');
  await expect(toPost).toHaveAttribute('title', 'Opens Post with this note as a thread, its public edition only');

  await toPost.click();
  await expect(page.locator('.toast', { hasText: '1 internal passage stays out' })).toBeVisible();
  expect(asked).toEqual([{ text: NOTE, selection: null }]);

  const landed = await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    return { tool: uiState.tool, start: JSON.parse(JSON.stringify(uiState.postStart)) };
  });
  expect(landed.tool).toBe('post');
  expect(landed.start).toMatchObject({ kind: 'free', media: [], about: { title: 'Quay strike' }, pieces: PIECES });
  expect(JSON.stringify(landed.start)).not.toContain('port worker');
  expect(JSON.stringify(landed.start)).not.toContain('internal]');
});
