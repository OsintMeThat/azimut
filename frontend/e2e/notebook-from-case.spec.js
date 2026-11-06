import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, pdfAnswer } from './app.fixture.js';

/**
 * From the case: the Notebook home's tile opens New note on that start, which asks
 * for a period, says how many geolocations it holds as the period changes, and writes
 * the note, as a report citing each proof, place and file.
 *
 * The server's answer for a period is stood in for here; which geolocations a
 * case holds is the backend's (`tests/test_note_from_case.py`).
 */

const at = '2026-10-01T10:00:00Z';
const entity = (id, type, label, attrs = {}) => ({ id, type, label, attrs, provenance: { by: 'user', at, status: 'confirmed' } });

const PROOF = {
  id: 'pr1', type: 'proof', label: 'Strike on the depot', description: 'Smoke over the tanks.', picture: true, media_kind: null,
  sources: [{ id: 'v1', label: 'Depot video', media_kind: 'video' }],
  points: [{ lat: 48.12345, lon: 37.12345, place: { id: 'pl1', label: 'Fuel depot', coords: false } }],
  shown: { kind: 'taken', raw: '2026-03-12T14:05:00+02:00', tz: 'Europe/Kyiv', day: '2026-03-12', last: '2026-03-12' },
  geolocated: { kind: 'geolocated', raw: '2026-03-14T09:00:00Z', tz: null, day: '2026-03-14', last: '2026-03-14' },
  day: '2026-03-12',
};
const PHOTO = {
  id: 'm1', type: 'media', label: 'Convoy on the bridge', description: '', picture: true, media_kind: 'image',
  sources: [{ id: 'm1', label: 'Convoy on the bridge', media_kind: 'image' }],
  points: [{ lat: 48.1302, lon: 37.1421, place: null }],
  shown: { kind: 'published', raw: '2026-03-13', tz: null, day: '2026-03-13', last: '2026-03-13' },
  geolocated: { kind: 'geolocated', raw: '2026-03-15T09:00:00Z', tz: null, day: '2026-03-15', last: '2026-03-15' },
  day: '2026-03-13',
};

async function home(page) {
  const catalog = [
    entity('pr1', 'proof', 'Strike on the depot', { path: 'proofs/strike.png', kind: 'image' }),
    entity('v1', 'media', 'Depot video', { path: 'media/depot.mp4', kind: 'video' }),
    entity('m1', 'media', 'Convoy on the bridge', { path: 'media/convoy.png', kind: 'image' }),
    entity('pl1', 'place', 'Fuel depot', { lat: 48.12345, lon: 37.12345 }),
  ];
  await installAppFixture(page, { catalog });
  const state = { notes: [], texts: { case: '' }, looks: {}, asked: [] };
  await page.route(`**/api/cases/${CASE_ID}/catalog/entities**`, (route) =>
    route.fulfill({ json: { items: [...catalog, ...state.notes], next_cursor: null, total: catalog.length + state.notes.length } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route('**/api/templates**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/templates/note/preview') return pdfAnswer(route, [0]);
    return route.fulfill({ json: { proof: [], post: [], map: [], note: [] } });
  });
  await page.route((url) => url.pathname.startsWith(`/api/cases/${CASE_ID}/notes`), (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(`/api/cases/${CASE_ID}/notes`.length);
    const method = request.method();
    if (path === '/from-case') {
      const query = Object.fromEntries(url.searchParams);
      state.asked.push(query);
      const by = query.by ?? 'shown';
      const span = by === 'shown' ? ['2026-03-01', '2026-03-14'] : ['2026-03-14', '2026-03-15'];
      // the 13th and later hold the photo alone
      const items = query.from && query.from >= '2026-03-13' ? [PHOTO] : [PROOF, PHOTO];
      return route.fulfill({ json: { items, total: items.length, undated: 0, first: span[0], last: span[1], limit: 200 } });
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
        pictures: 0, look: state.looks[one.id] ?? null, includes: 0 }))] } });
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

test('From the case writes every geolocation of a period into a new report', async ({ page }) => {
  const state = await home(page);
  await page.locator('[data-guide="notebook.from-case"]').click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog.getByRole('status')).toHaveText('2 geolocations.');
  await expect(dialog.getByRole('button', { name: 'First day' })).toContainText('2026-03-01');
  await expect(dialog.getByRole('button', { name: 'Last day' })).toContainText('2026-03-14');

  // a later first day: the count follows
  await dialog.getByRole('button', { name: 'First day' }).click();
  await dialog.locator('button[title="2026-03-13"]').click();
  await expect(dialog.getByRole('status')).toHaveText('1 geolocation.');
  expect(state.asked.at(-1)).toMatchObject({ from: '2026-03-13', to: '2026-03-14', by: 'shown' });

  // back to the whole span, and a figure each
  await dialog.getByRole('button', { name: 'First day' }).click();
  await dialog.locator('button[title="2026-03-01"]').click();
  await expect(dialog.getByRole('status')).toHaveText('2 geolocations.');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Geolocations, 1–14 March 2026');
  const [made] = state.notes;
  const text = state.texts[made.id];
  expect(text).toContain('### Strike on the depot\n\n[[media:pr1|Strike on the depot]]{width=75%}\n\n- Description: Smoke over the tanks.\n- Where: [[entity:pl1|Fuel depot]] 48.12345, 37.12345');
  expect(text).toContain('- When: posted 13 March 2026');
  expect(state.looks[made.id]).toMatchObject({ style: 'report', sources: 'on' });
  // the editor draws what it cites as chips, and the guidance in grey
  await expect(page.locator('.cm-content')).toContainText('Fuel depot');
  await expect(page.locator('.cm-hint').first()).toHaveText('What these geolocations show, in two or three sentences.');
});

test('From the case reads by the day they were geolocated, as a table', async ({ page }) => {
  const state = await home(page);
  await page.locator('[data-guide="notebook.from-case"]').click();
  const dialog = page.getByRole('dialog', { name: 'New note' });
  await expect(dialog.getByRole('status')).toHaveText('2 geolocations.');
  await dialog.getByRole('radio', { name: 'When they were geolocated' }).click();
  await expect(dialog.getByRole('button', { name: 'First day' })).toContainText('2026-03-14');
  expect(state.asked.at(-1)).toMatchObject({ by: 'geolocated' });
  await dialog.getByRole('radio', { name: 'A table' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.locator('input[aria-label="Note name"]')).toHaveValue('Geolocated 14–15 March 2026');
  const text = state.texts[state.notes[0].id];
  expect(text).toContain('| Geolocated | Place | Coordinates | Description | Source |');
  expect(text).toContain('| 14 March 2026 | [[entity:pl1|Fuel depot]] | 48.12345, 37.12345 | Smoke over the tanks. | [[entity:pr1|Strike on the depot]], [[entity:v1|Depot video]] |');
});
