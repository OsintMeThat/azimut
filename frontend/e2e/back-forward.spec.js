import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The browser's own Back and Forward, pressed for real.
 *
 * They walk the tools, and inside a tool the places the analyst went to: a folder in
 * Files, a sheet from the Sheet home, a proof, a draft, a note. And they never cost
 * work: a document with unsaved changes asks before Back leaves it, and stays put when
 * the analyst keeps editing.
 */

const tab = (page, name) => page.locator('.tabstrip').getByRole('button', { name, exact: true });
const hashOf = (page) => page.evaluate(() => location.hash);

test('Back and Forward walk the tools the analyst opened', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await page.goto('/#files');
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');

  await page.locator('.rail').getByRole('button', { name: 'Compose' }).click();
  await expect(tab(page, 'Geo Proof')).toHaveAttribute('aria-current', 'page');
  await tab(page, 'Notebook').click();
  await expect(tab(page, 'Notebook')).toHaveAttribute('aria-current', 'page');

  await page.goBack();
  await expect(tab(page, 'Geo Proof')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(tab(page, 'Geo Proof')).toHaveAttribute('aria-current', 'page');
  fixture.expectNoUnexpectedRequests();
});

test('Back retraces the folders opened in Files', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    cases: [{
      id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [],
      folders: ['Airbase', 'Airbase/North'],
    }],
  });
  await page.route(`**/api/cases/${CASE_ID}`, (route) =>
    route.fulfill({ json: { id: CASE_ID, name: 'Browser Test', scratch: false, folders: ['Airbase', 'Airbase/North'] } })
  );
  await page.goto('/#files');
  const grid = page.locator('.grid-pane');
  const crumbs = page.locator('.crumbs');

  await grid.locator('.tile.folder', { hasText: 'Airbase' }).dblclick();
  await expect(crumbs).toContainText('Airbase');
  await grid.locator('.tile.folder', { hasText: 'North' }).dblclick();
  await expect(crumbs).toContainText('North');
  expect(await hashOf(page)).toBe('#files?folder=Airbase%2FNorth');

  await page.goBack();
  await expect(crumbs).not.toContainText('North');
  await expect(grid.locator('.tile.folder', { hasText: 'North' })).toBeVisible();
  await page.goBack();
  await expect(grid.locator('.tile.folder', { hasText: 'Airbase' })).toBeVisible();
  await page.goForward();
  await expect(grid.locator('.tile.folder', { hasText: 'North' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('Back goes from a sheet to the Sheet home, and Forward opens it again', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    sheets: [['Candidates', ['Subject', 'Status'], [['Quai sud', 'To check']]]],
  });
  await page.goto('/#sheet');
  await page.locator('.home .sheet').first().click();
  const grid = page.getByRole('grid', { name: 'Sheet rows' });
  await expect(grid).toBeVisible();

  await page.goBack();
  await expect(grid).toBeHidden();
  await expect(page.locator('.home .sheet').first()).toBeVisible();
  await page.goForward();
  await expect(grid).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

const PROOFS = { 'proof-a': 'Convoy at the gate', 'proof-b': 'Smoke over the depot' };

async function withProofs(page, options = {}) {
  const fixture = await installAppFixture(page, {
    ...options,
    lookupEntities: Object.fromEntries(
      Object.keys(PROOFS).map((name) => [`proofs/.meta/${name}.json`, { id: `${name}-entity` }])
    ),
  });
  await page.route(`**/api/cases/${CASE_ID}/proofs`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: Object.entries(PROOFS).map(([name, title]) => ({
        name, title, spec_path: `proofs/.meta/${name}.json`, updated_at: '2026-10-01T10:00:00Z',
      })),
    });
  });
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    if (route.request().method() !== 'GET' || !PROOFS[name]) return route.fallback();
    return route.fulfill({ json: { title: PROOFS[name], panels: [], pastes: [], shapes: [] } });
  });
  return fixture;
}

async function openProof(page, title) {
  await page.locator('.tool-header').getByRole('button', { name: 'Open proof' }).click();
  await page.locator('.open-row', { hasText: title }).click();
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue(title);
}

test('Back between proofs asks before leaving unsaved changes, and keeps them when asked to', async ({ page }) => {
  const fixture = await withProofs(page);
  await page.goto('/#proof');
  await openProof(page, PROOFS['proof-a']);
  await openProof(page, PROOFS['proof-b']);
  expect(await hashOf(page)).toBe('#proof?proof=proof-b');

  const name = page.getByRole('textbox', { name: 'Proof name' });
  await name.fill('Smoke over the depot, east side');
  await expect(page.locator('.tool-header .badge', { hasText: 'unsaved' })).toBeVisible();

  await page.goBack();
  const ask = page.getByRole('alertdialog', { name: 'Leave this proof?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(ask).toBeHidden();
  await expect(name).toHaveValue('Smoke over the depot, east side');
  await expect.poll(() => hashOf(page)).toBe('#proof?proof=proof-b');

  await page.goBack();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(name).toHaveValue(PROOFS['proof-a']);
  await expect.poll(() => hashOf(page)).toBe('#proof?proof=proof-a');

  // A saved proof is left without a word.
  await page.goForward();
  await expect(name).toHaveValue(PROOFS['proof-b']);
  await expect(ask).toBeHidden();
  fixture.expectNoUnexpectedRequests();
});

test('opening another proof asks first too, so the list cannot drop an edit', async ({ page }) => {
  const fixture = await withProofs(page);
  await page.goto('/#proof');
  await openProof(page, PROOFS['proof-a']);
  const name = page.getByRole('textbox', { name: 'Proof name' });
  await name.fill('Convoy at the north gate');

  await page.locator('.tool-header').getByRole('button', { name: 'Open proof' }).click();
  await page.locator('.open-row', { hasText: PROOFS['proof-b'] }).click();
  const ask = page.getByRole('alertdialog', { name: 'Leave this proof?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await page.keyboard.press('Escape');
  await expect(name).toHaveValue('Convoy at the north gate');
  fixture.expectNoUnexpectedRequests();
});

test('Back on an open dialog closes it and stays on the tool', async ({ page }) => {
  const fixture = await withProofs(page);
  await page.goto('/#files');
  await page.locator('.rail').getByRole('button', { name: 'Compose' }).click();
  await expect(tab(page, 'Geo Proof')).toHaveAttribute('aria-current', 'page');
  await page.locator('.tool-header').getByRole('button', { name: 'Open proof' }).click();
  const row = page.locator('.open-row', { hasText: PROOFS['proof-a'] });
  await expect(row).toBeVisible();

  await page.goBack();
  await expect(row).toBeHidden();
  await expect(tab(page, 'Geo Proof')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');
  fixture.expectNoUnexpectedRequests();
});

test('leaving Azimut asks while a proof holds unsaved changes, and only then', async ({ page }) => {
  await withProofs(page);
  await page.goto('/#proof');
  await openProof(page, PROOFS['proof-a']);
  const asked = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.type());
    dialog.dismiss();
  });

  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toEqual([]);
});

test('leaving Azimut with an edited proof is a question the browser asks', async ({ page }) => {
  await withProofs(page);
  await page.goto('/#proof');
  await openProof(page, PROOFS['proof-a']);
  await page.getByRole('textbox', { name: 'Proof name' }).fill('Convoy, edited');
  const asked = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.type());
    dialog.accept();
  });

  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toEqual(['beforeunload']);
});

const DRAFTS = {
  'thread-a': { title: 'Thread A', updated_at: '2026-10-01T10:00:00Z', state: { description: 'Convoy at the gate' } },
  'thread-b': { title: 'Thread B', updated_at: '2026-10-01T11:00:00Z', state: { description: 'Smoke over the depot' } },
};

async function openDraft(page, title) {
  await page.locator('.tool-header').getByRole('button', { name: 'Open' }).click();
  await page.locator('.open-row', { hasText: title }).click();
  await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue(title);
}

test('Back between drafts asks before leaving an edited post', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    drafts: DRAFTS,
    // Found again, as the case would: otherwise the composer reads each as deleted.
    lookupEntities: Object.fromEntries(Object.keys(DRAFTS).map((name) => [`.drafts/${name}.json`, { id: name }])),
  });
  await page.goto('/#post');
  await openDraft(page, 'Thread A');
  await openDraft(page, 'Thread B');
  const description = page.locator('#pc-desc');
  await description.fill('Smoke over the depot, east side');

  await page.goBack();
  const ask = page.getByRole('alertdialog', { name: 'Leave this post?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(description).toHaveValue('Smoke over the depot, east side');
  await expect.poll(() => hashOf(page)).toBe('#post?draft=thread-b');

  await page.goBack();
  await ask.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue('Thread A');
  await expect(description).toHaveValue('Convoy at the gate');
  fixture.expectNoUnexpectedRequests();
});

test('Back retraces the notes opened in the Notebook', async ({ page }) => {
  const note = (id, label) => ({
    id, type: 'note', label, attrs: { path: `notes/${id}.md` },
    provenance: { by: 'user', at: '2026-10-01T10:00:00Z', status: 'confirmed' },
  });
  const fixture = await installAppFixture(page, { catalog: [note('n-convoy', 'Convoy'), note('n-depot', 'Depot')] });
  await page.route(`**/api/cases/${CASE_ID}/notes/*`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ json: { text: `# ${id}\n` } });
  });
  await page.goto('/#notebook');
  const pick = async (label) => {
    await page.locator('.menu-toggle').click();
    await page.locator('.menu-note', { hasText: label }).click();
  };
  const active = page.locator('.tabs .tab.active');

  await pick('Convoy');
  await expect(active).toContainText('Convoy');
  await pick('Depot');
  await expect(active).toContainText('Depot');

  await page.goBack();
  await expect(active).toContainText('Convoy');
  await page.goBack();
  await expect(active).toContainText('Case Notes');
  await page.goForward();
  await expect(active).toContainText('Convoy');
  fixture.expectNoUnexpectedRequests();
});

test('a note opened from Files is one step, and Back lands in the folder it came from', async ({ page }) => {
  const convoy = {
    id: 'n-convoy', type: 'note', label: 'Convoy', attrs: { path: 'notes/convoy.md', folder: 'Sources' },
    provenance: { by: 'user', at: '2026-10-01T10:00:00Z', status: 'confirmed' },
  };
  const fixture = await installAppFixture(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: ['Sources'] }],
    catalog: [convoy],
  });
  await page.route(`**/api/cases/${CASE_ID}`, (route) =>
    route.fulfill({ json: { id: CASE_ID, name: 'Browser Test', scratch: false, folders: ['Sources'] } })
  );
  await page.route(`**/api/cases/${CASE_ID}/notes/*`, (route) => route.fulfill({ json: { text: '# Convoy\n' } }));
  // The Notebook already open once, so the note arrives in a tool that is there.
  await page.goto('/#notebook');
  await expect(page.locator('.tabs .tab.active')).toContainText('Case Notes');
  await page.locator('.rail').getByRole('button', { name: 'Sources' }).click();
  await tab(page, 'Files').click();
  const grid = page.locator('.grid-pane');
  await grid.locator('.tile.folder', { hasText: 'Sources' }).dblclick();
  await grid.locator('.tile', { hasText: 'Convoy' }).dblclick();
  await expect(tab(page, 'Notebook')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.tabs .tab.active')).toContainText('Convoy');

  await page.goBack();
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.crumbs')).toContainText('Sources');
  await page.goBack();
  await expect(grid.locator('.tile.folder', { hasText: 'Sources' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('a proof opened from Files is one step, even though it loads after the switch', async ({ page }) => {
  const proof = {
    id: 'proof-a-entity', type: 'proof', label: PROOFS['proof-a'],
    attrs: { spec: 'proofs/.meta/proof-a.json', folder: 'Sources' },
    provenance: { by: 'user', at: '2026-10-01T10:00:00Z', status: 'confirmed' },
  };
  const fixture = await withProofs(page, {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: ['Sources'] }],
    catalog: [proof],
    chains: { [proof.id]: { entity: proof, sources: [], lost: [], dependents: [], relations: [] } },
  });
  await page.route(`**/api/cases/${CASE_ID}`, (route) =>
    route.fulfill({ json: { id: CASE_ID, name: 'Browser Test', scratch: false, folders: ['Sources'] } })
  );
  // The composer already open once, so the proof arrives in a tool that is there.
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'Open proof' })).toBeVisible();
  await page.locator('.rail').getByRole('button', { name: 'Sources' }).click();
  await tab(page, 'Files').click();
  const grid = page.locator('.grid-pane');
  await grid.locator('.tile.folder', { hasText: 'Sources' }).dblclick();
  await grid.locator('.tile', { hasText: PROOFS['proof-a'] }).dblclick();
  await page.getByRole('button', { name: 'Open in tool' }).click();
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue(PROOFS['proof-a']);
  await expect.poll(() => hashOf(page)).toBe('#proof?proof=proof-a');

  await page.goBack();
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.crumbs')).toContainText('Sources');
  fixture.expectNoUnexpectedRequests();
});
