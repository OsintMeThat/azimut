import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

// The To-do's "To geolocate" group: the scenes kept in Inspect that no proof takes
// up yet, over the analyst's own lists, in the sidebar and on the Overview.

const VIDEO = 'media/market.mp4';
const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
});
const BRIDGE = row('sc_2', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png', 'media/c2.png'] });

/** A case whose queue and lists answer from here, with every write kept. */
async function caseWithScenes(page, scenes = [row('sc_1', null, null), BRIDGE, row('sc_3', 300, null, 'Minaret')]) {
  const fixture = await installAppFixture(page);
  const state = { files: [{ video: VIDEO, title: 'Market walk', scenes }], geolocating: null };
  const writes = [];
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } })
  );
  await page.route(`**/api/cases/${CASE_ID}/scenes/queue`, (route) => route.fulfill({ json: state }));
  await page.route(`**/api/cases/${CASE_ID}/geolocating`, (route) => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fulfill({ json: { geolocating: state.geolocating } });
    const body = request.postDataJSON();
    writes.push({ geolocate: body });
    state.geolocating = { ...state.files[0].scenes.find((one) => one.id === body.draft), since: 'now' };
    return route.fulfill({ json: { geolocating: state.geolocating } });
  });
  await page.route(`**/api/cases/${CASE_ID}/scenes/*/abandon*`, (route) => {
    const request = route.request();
    const draft = new URL(request.url()).pathname.split('/').at(-2);
    const scene = state.files[0].scenes.find((one) => one.id === draft);
    if (request.method() === 'PUT') {
      const { reason } = request.postDataJSON();
      writes.push({ abandon: draft, reason });
      Object.assign(scene, { state: 'abandoned', abandoned: { reason, at: 'now' } });
    } else {
      writes.push({ restore: draft, video: new URL(request.url()).searchParams.get('video') });
      Object.assign(scene, { state: scene.captures.length ? 'progress' : 'todo', abandoned: null });
    }
    return route.fulfill({ json: { scene } });
  });
  // Geolocate opens the scene's video over the map: its facts and its bytes
  await page.route(`**/api/cases/${CASE_ID}/inspect/probe*`, (route) => route.fulfill({
    json: { kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 },
  }));
  await page.route(`**/files/${CASE_ID}/${VIDEO}`, (route) => serveRange(route, STEPS_WEBM, 'video/webm'));
  return { fixture, state, writes };
}

async function sidebarTodo(page) {
  await page.goto('/#files');
  const sidebar = page.locator('aside.sidebar');
  await sidebar.getByRole('tab', { name: 'To-do' }).click();
  return sidebar;
}

test('the sidebar’s To-do lists the scenes to geolocate over the lists, and geolocates one', async ({ page }) => {
  const { fixture, writes } = await caseWithScenes(page);
  const sidebar = await sidebarTodo(page);
  const group = sidebar.getByRole('region', { name: 'To geolocate' });
  await expect(group.getByRole('heading', { name: 'To geolocate 3' })).toBeVisible();
  await expect(group.getByRole('list', { name: 'Market walk' }).getByRole('listitem')).toHaveCount(3);
  await expect(group.locator('li.scene').nth(1)).toContainText('3:58–4:12In progress: 2 map captures');
  // over the analyst's own lists, never under them
  const groupBox = await group.boundingBox();
  const entryBox = await sidebar.getByLabel('New task', { exact: true }).boundingBox();
  expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(entryBox.y);

  await group.getByRole('button', { name: 'Geolocate bridge?' }).click();
  await expect(page).toHaveURL(/#satellite/);
  expect(writes).toEqual([{ geolocate: { video: VIDEO, draft: 'sc_2' } }]);
  // its video over the map, the scene named on it
  await expect(page.locator('.ref-viewer')).toHaveCount(1);
  await expect(page.locator('.ref-viewer').getByRole('img', { name: /Scene · bridge\?/ })).toBeVisible();
  // the map tools open with the sidebar folded; brought back, it marks the scene
  await page.getByTitle('Toggle case sidebar').click();
  await expect(group.locator('li.scene.live')).toContainText('Geolocating: 2 map captures');
  fixture.expectNoUnexpectedRequests();
});

test('a scene is abandoned with a word, Escape keeps it, and the fold brings it back', async ({ page }) => {
  const { writes } = await caseWithScenes(page);
  const sidebar = await sidebarTodo(page);
  const group = sidebar.getByRole('region', { name: 'To geolocate' });

  await group.getByRole('button', { name: 'Abandon Minaret' }).click();
  const why = group.getByLabel('Why it is abandoned');
  await expect(why).toBeFocused();
  await why.press('Escape');
  await expect(why).toHaveCount(0);
  expect(writes).toEqual([]);

  await group.getByRole('button', { name: 'Abandon Minaret' }).click();
  await why.fill('no landmark in view');
  await why.press('Enter');
  await expect(group.getByRole('heading', { name: 'To geolocate 2' })).toBeVisible();
  expect(writes).toEqual([{ abandon: 'sc_3', reason: 'no landmark in view' }]);

  const fold = group.getByRole('button', { name: 'Abandoned (1)' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  const left = group.getByRole('list', { name: 'Abandoned in Market walk' });
  await expect(left).toContainText('5:00 · no landmark in view');
  await left.getByRole('button', { name: 'Restore Minaret' }).click();
  await expect(group.getByRole('heading', { name: 'To geolocate 3' })).toBeVisible();
  expect(writes.at(-1)).toEqual({ restore: 'sc_3', video: VIDEO });
});

test('a scene’s name opens it in Inspect', async ({ page }) => {
  await caseWithScenes(page);
  const sidebar = await sidebarTodo(page);
  await sidebar.getByRole('region', { name: 'To geolocate' }).getByRole('button', { name: /^Minaret/ }).click();
  await expect(page).toHaveURL(/#inspect/);
});

test('the Overview shows a few scenes over the lists and counts the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const scenes = [1, 2, 3, 4, 5].map((n) => row(`sc_${n}`, n * 30, n * 30 + 5, `Scene ${n}`));
  await caseWithScenes(page, scenes);
  await page.goto('/#overview');
  const todos = page.getByRole('region', { name: 'To-do', exact: true });
  const group = todos.getByRole('region', { name: 'To geolocate' });
  await expect(group.locator('li.scene')).toHaveCount(3);
  await group.getByRole('button', { name: '2 more' }).click();
  await expect(group.locator('li.scene')).toHaveCount(5);
  await expect(todos.getByLabel('New task', { exact: true })).toBeVisible();
});

test('nothing is added to the To-do of a case with no scene to geolocate', async ({ page }) => {
  const { fixture } = await caseWithScenes(page, []);
  const sidebar = await sidebarTodo(page);
  await expect(sidebar.getByLabel('New task', { exact: true })).toBeVisible();
  await expect(sidebar.getByRole('region', { name: 'To geolocate' })).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});
