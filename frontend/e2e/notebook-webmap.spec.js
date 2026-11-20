import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * A web map: Notebook › New note › Web map asks which layers it shows and makes a note that is
 * one map laid out as a map page; the Notebook's home then lists it with web maps. The map put
 * and the notes are stood in for here; the page the export writes is the engine's
 * (`tests/test_notes_webmap.py`), and how it reads the reader's (`htmlReaderMapPage.test.js`).
 */

const at = '2026-11-20T10:00:00Z';
const entity = (id, type, label, attrs = {}) => ({ id, type, label, attrs, provenance: { by: 'user', at, status: 'confirmed' } });
const BLOCK = '::: map\ntitle: Vehicles by kind and state\nlayer: Vehicles by kind and state\nground: e_ground\nview: 12.72, 43.5, 12.5\n:::';

async function home(page) {
  await installAppFixture(page, { catalog: [] });
  const state = { notes: [], texts: { case: '' }, looks: {}, put: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: state.notes, next_cursor: null, total: state.notes.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route('**/api/templates**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/templates/note/preview') return pdfAnswer(route, [0]);
    return route.fulfill({ json: { proof: [], post: [], map: [], note: [] } });
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '/maps/sources') {
      return route.fulfill({ json: { layers: [{ name: 'Vehicles by kind and state', title: 'Vehicles by kind and state', features: 54 },
        { name: 'My layer', title: 'LINE', features: 1 }], plates: [], proofs: { count: 0, first: '', last: '' }, providers: [], provider: 'esri-world-imagery' } });
    }
    if (path === '/maps' && method === 'POST') {
      state.put.push(request.postDataJSON());
      return route.fulfill({ json: { text: BLOCK, ground: { id: 'e_ground' }, fresh: false, filed: [], features: 54, warnings: [] } });
    }
    if (path === '' && method === 'POST') {
      const body = request.postDataJSON();
      const made = entity(`n${state.notes.length + 1}`, 'note', body.title, { path: `notes/${body.title}.md`, folder: '' });
      state.notes.push(made);
      state.texts[made.id] = body.content;
      return route.fulfill({ json: made });
    }
    if (path === '/index') {
      return route.fulfill({ json: { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: at, excerpt: '', words: 0,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, look: null, includes: 0 }, ...state.notes.map((one) => ({
        id: one.id, title: one.label, folder: '', updated_at: at, excerpt: '', words: 1, tasks: { open: 0, done: 0 }, mentions: 0,
        pictures: 0, look: state.looks[one.id] ?? null, includes: 0,
        ...(state.looks[one.id]?.web === 'map' ? { map: { picture: '', address: 'https://desk.github.io/maps/vehicles/' } } : {}) }))] } });
    }
    if (path === '' || path === '/case') return route.fulfill({ json: { text: state.texts.case } });
    if (path === '/preview') return pdfAnswer(route, [0]);
    const look = /^\/([\w-]+)\/look$/.exec(path);
    if (look) {
      if (method === 'PUT') state.looks[look[1]] = request.postDataJSON();
      return route.fulfill({ json: { look: state.looks[look[1]] ?? {} } });
    }
    const one = /^\/([\w-]+)$/.exec(path);
    if (one && state.texts[one[1]] !== undefined) {
      if (method === 'PUT') state.texts[one[1]] = request.postDataJSON().text;
      return route.fulfill({ json: method === 'PUT' ? { status: 'saved' } : { text: state.texts[one[1]] } });
    }
    return route.fallback();
  });
  await page.goto('/#notebook');
  return state;
}

test('New › Web map makes a note that is its layers’ map on a page of its own, listed with web maps', async ({ page }) => {
  const state = await home(page);
  await page.getByRole('button', { name: 'Web map', exact: false }).filter({ hasText: 'Your layers on a page of their own' }).click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog.getByRole('radio', { name: /Web map/ })).toHaveAttribute('aria-checked', 'true');
  const create = dialog.getByRole('button', { name: 'Create' });
  await expect(create).toBeDisabled();
  await dialog.getByRole('checkbox').first().check();
  await expect(dialog.locator('#notebook-note-title')).toHaveAttribute('placeholder', 'Vehicles by kind and state');
  await create.click();

  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Vehicles by kind and state');
  expect(state.put).toEqual([{ title: 'Vehicles by kind and state', layers: ['Vehicles by kind and state'] }]);
  const [made] = state.notes;
  expect(state.texts[made.id]).toContain(BLOCK);
  expect(state.looks[made.id]).toMatchObject({ style: 'article', web: 'map' });

  // the Look says it is a map page, with its one optional field
  await page.locator('[data-guide="notebook.look"]').click();
  const look = page.getByRole('dialog', { name: 'Look' });
  await expect(look.getByRole('radio', { name: 'Map page' })).toHaveAttribute('aria-checked', 'true');
  await expect(look.getByPlaceholder('GoatCounter code')).toBeVisible();
  await page.keyboard.press('Escape');

  // back home, it stands with the web maps, where it was published said on its card
  await page.locator('[data-guide="notebook.home"]').click();
  await expect(page.getByText('Web maps · 1')).toBeVisible();
  await expect(page.locator('.map-card .address')).toHaveText('desk.github.io/maps/vehicles/');
});
