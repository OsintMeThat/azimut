import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * A scene's two counts, wherever it waits: what the map gave it (its captures) and what
 * its video gives it (the frames of the strip and the collages in it, the server's
 * `footage`), each by its icon, greyed at 0, a small mark saying where it stands and the
 * hover saying it all in words. The To-do's rows, the pill, Geo Proof's home and
 * Inspect's Scenes tab say the same numbers. `COUNT_SHOTS` names a folder for pictures.
 */

const VIDEO = 'media/market.webm';
const SHOTS = process.env.COUNT_SHOTS;
const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start, end, label, state: 'todo', captures: [], footage: 0, abandoned: null,
  file_kind: 'video', ...extra,
});
const SCENES = () => [
  row('sc_1', null, null, 'Which town?', { footage: 5, order: 0 }),
  row('sc_2', 0.2, 0.6, 'Road bridge', { state: 'progress', captures: ['media/c1.png', 'media/c2.png'], footage: 3, order: 1 }),
  row('sc_3', 0.9, null, 'Minaret', { order: 2 }),
];

async function theme(page, which) {
  await page.evaluate(async (wanted) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(wanted);
  }, which);
}

/** A picture of `target`, dark then light, when a folder is named for them. */
async function shoot(page, name, target = page) {
  if (!SHOTS) return;
  await page.mouse.move(0, 0);
  await target.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await theme(page, 'light');
  await page.waitForTimeout(250);
  await target.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await theme(page, 'dark');
  await page.waitForTimeout(250);
}

/** A case whose queue answers from here: the market clip and its three scenes. */
async function caseWithScenes(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  const media = [{
    path: VIDEO, filename: 'market.webm', title: 'Market walk', kind: 'video', entity_id: 'e_market', size: STEPS_WEBM.length,
    source: { type: 'upload' }, thumbnail: null, folder: '',
  }];
  const fixture = await installAppFixture(page, { media });
  const state = { files: [{ video: VIDEO, title: 'Market walk', kind: 'video', scenes: SCENES() }], geolocating: null };
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } }));
  await page.route(`**/api/cases/${CASE_ID}/scenes/queue`, (route) => route.fulfill({ json: state }));
  await page.route(`**/api/cases/${CASE_ID}/geolocating`, (route) => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fulfill({ json: { geolocating: state.geolocating } });
    const body = request.postDataJSON();
    const held = state.files[0].scenes.find((one) => one.id === body.draft);
    state.geolocating = { ...held, file_title: 'Market walk', since: 'now' };
    return route.fulfill({ json: { geolocating: state.geolocating } });
  });
  await page.route(`**/api/cases/${CASE_ID}/inspect/probe*`, (route) => route.fulfill({
    json: { kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 },
  }));
  await page.route(`**/files/${CASE_ID}/${VIDEO}`, (route) => serveRange(route, STEPS_WEBM, 'video/webm'));
  return { fixture, state };
}

/** The counts as they read: the map's and the video's, each with whether it is greyed. */
const counts = (locator) => locator.locator('[data-testid^="count-"]').evaluateAll((els) =>
  els.map((el) => [el.textContent.trim(), el.classList.contains('none')]));

test('the To-do says each scene’s two counts, and the pill says them for the scene geolocated', async ({ page }) => {
  const { fixture, state } = await caseWithScenes(page);
  await page.goto('/#files');
  const sidebar = page.locator('aside.sidebar');
  await sidebar.getByRole('tab', { name: 'To-do' }).click();
  const group = sidebar.getByRole('region', { name: 'To geolocate' });
  const rows = group.locator('li.scene');
  await expect(rows).toHaveCount(3);
  expect(await counts(rows.nth(0))).toEqual([['0', true], ['5', false]]);
  expect(await counts(rows.nth(1))).toEqual([['2', false], ['3', false]]);
  expect(await counts(rows.nth(2))).toEqual([['0', true], ['0', true]]);
  await expect(rows.nth(1).getByTestId('scene-counts')).toHaveAttribute('title', 'In progress: 2 map captures, 3 pictures from the video');
  await shoot(page, 'todo-rows', sidebar);

  await group.getByRole('button', { name: 'Geolocate Road bridge' }).click();
  await expect(page).toHaveURL(/#satellite/);
  const pill = page.locator('.geo-pill');
  await expect(pill.getByTestId('count-map')).toHaveText('2');
  await expect(pill.getByTestId('count-video')).toHaveText('3');
  await expect(pill.getByTestId('scene-counts')).toHaveAttribute('title', 'Geolocating: 2 map captures, 3 pictures from the video');
  await expect(pill.getByRole('button', { name: /^Geolocating/ })).toHaveAttribute('title', 'Open the scene in Inspect, on Market walk');

  // a capture filed: the map's count steps up with a pulse, before the server is read again
  state.geolocating = { ...state.geolocating, state: 'progress', captures: [...state.geolocating.captures, 'media/c3.png'] };
  await page.evaluate(async (caseId) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch({ type: 'geolocating', case_id: caseId, video: 'media/market.webm', draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
  }, CASE_ID);
  await expect(pill.getByTestId('count-map')).toHaveText('3');
  await expect(pill.getByTestId('count-map')).toHaveClass(/bump/);
  await page.waitForTimeout(1000);
  await shoot(page, 'pill', page.locator('.topbar'));
  fixture.expectNoUnexpectedRequests();
});

test('Geo Proof’s home says the counts on its chips, the scene geolocated marked live', async ({ page }) => {
  const { state } = await caseWithScenes(page);
  state.geolocating = { ...state.files[0].scenes[2], file_title: 'Market walk', since: 'now' };
  await page.goto('/#proof');
  const home = page.getByTestId('proof-home');
  const chips = home.locator('.ph-chip');
  await expect(chips).toHaveCount(3);
  await expect(home.locator('.ph-video h5')).toHaveText('Market walk');
  expect(await counts(chips.nth(0))).toEqual([['0', true], ['5', false]]);
  expect(await counts(chips.nth(1))).toEqual([['2', false], ['3', false]]);
  await expect(chips.nth(2).getByTestId('scene-counts')).toHaveAttribute('data-stage', 'live');
  await expect(chips.nth(1).getByTestId('scene-counts')).toHaveAttribute('data-stage', 'progress');
  await expect(chips.nth(0).getByTestId('scene-counts')).toHaveAttribute('data-stage', 'todo');
  await shoot(page, 'home-chips');
});
