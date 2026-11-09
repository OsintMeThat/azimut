import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * To geolocate found from anywhere: a count on the sidebar's To-do tab, a dot on its
 * toggle while it is closed, Go to's entry, and pictures marked from the Media Library. A picture walks the same road as a
 * video's scene, its row says Whole picture, Geolocate holds the picture over the map
 * and the pill names it.
 */

const PHOTO = 'media/harbour.png';
const VIDEO = 'media/market.mp4';
const CAPTURE = 'media/capture-bridge.png';
const FRAME = 'media/frame-12.png';
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
    <rect width="640" height="420" fill="#3c5a78"/>
    <path d="M0 320L180 170L300 270L450 110L640 300V420H0Z" fill="#6c8f55"/>
  </svg>`;

const file = (path, kind, title, source) => ({
  path, filename: path.split('/').pop(), title, kind, width: 640, height: 420, size: 2048, sha256: '0'.repeat(64),
  source, thumbnail: null, thumb_state: 'none', enrich_state: 'ready', folder: '', notes: '',
});
const MEDIA = [
  file(PHOTO, 'image', 'Harbour photo', { type: 'upload' }),
  file(VIDEO, 'video', 'Market walk', { type: 'download' }),
  file(CAPTURE, 'image', 'Bridge from above', { type: 'satellite' }),
  file(FRAME, 'image', 'Frame 0:12', { type: 'inspect', op: 'frame', from: VIDEO, time: 12 }),
];

const row = (video, id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video, id, start, end, label, state: 'todo', captures: [], abandoned: null,
  file_kind: video === PHOTO ? 'image' : 'video', order: 0, ...extra,
});
const PASSAGE = row(VIDEO, 'sc_1', 238, 252, 'bridge?', { order: 1 });
const INSTANT = row(VIDEO, 'sc_2', 300, null, 'Minaret', { order: 2 });

/** A case whose server keeps the queue here, with every mark and every Geolocate written down. */
async function openCase(page, scenes = [PASSAGE, INSTANT], options = {}) {
  await page.setViewportSize({ width: 1500, height: 900 });
  const fixture = await installAppFixture(page, { media: MEDIA, ...options });
  const server = { scenes: scenes.map((one) => ({ ...one })), geolocating: null, marks: [], reads: 0, fileReads: [] };
  const queue = () => {
    const files = [...new Set(server.scenes.map((one) => one.video))].map((video) => ({
      video,
      title: MEDIA.find((item) => item.path === video).title,
      kind: MEDIA.find((item) => item.path === video).kind,
      scenes: server.scenes.filter((one) => one.video === video),
    }));
    return { files, geolocating: server.geolocating };
  };
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } })
  );
  await page.route(`**/api/cases/${CASE_ID}/scenes/queue`, (route) => {
    server.reads += 1;
    return route.fulfill({ json: queue() });
  });
  await page.route(`**/api/cases/${CASE_ID}/scenes/mark`, (route) => {
    const { path } = route.request().postDataJSON();
    server.marks.push(path);
    if (path === FRAME) return route.fulfill({ status: 400, json: { detail: "a frame cut from a video belongs to its video's scenes" } });
    let scene = server.scenes.find((one) => one.video === path && one.start == null);
    if (!scene) {
      scene = row(path, `sc_${path === PHOTO ? 'photo' : 'whole'}`, null, null);
      server.scenes.push(scene);
    }
    return route.fulfill({ json: { scene } });
  });
  await page.route(`**/api/cases/${CASE_ID}/geolocating`, (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      server.geolocating = { ...server.scenes.find((one) => one.id === body.draft), since: 'now' };
    } else if (request.method() === 'DELETE') {
      server.geolocating = null;
      return route.fulfill({ json: { ended: true } });
    }
    return route.fulfill({ json: { geolocating: server.geolocating } });
  });
  // one file's scenes, what a nudge about it asks while only the count is shown
  await page.route(new RegExp(`/api/cases/${CASE_ID}/scenes\\?`), (route) => {
    const video = new URL(route.request().url()).searchParams.get('video');
    server.fileReads.push(video);
    return route.fulfill({ json: { video, used: {}, taken: [], scenes: server.scenes.filter((one) => one.video === video), geolocating: null } });
  });
  await page.route(`**/api/cases/${CASE_ID}/inspect/probe*`, (route) => route.fulfill({
    json: { kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 },
  }));
  await page.route(`**/files/${CASE_ID}/${VIDEO}`, (route) => serveRange(route, STEPS_WEBM, 'video/webm'));
  await page.route(`**/files/${CASE_ID}/media/*.png`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG }));
  return { fixture, server };
}

/** The server's nudges, sent by hand: the stream the app listens to, with one way in. */
const hearNudges = (page) => page.addInitScript(() => {
  window.EventSource = class {
    constructor() {
      window.nudge = (event) => this.onmessage({ data: JSON.stringify(event) });
    }
  };
});

const sidebarOf = (page) => page.locator('aside.sidebar');
const todoTab = (page) => sidebarOf(page).getByRole('tab', { name: /^To-do/ });
const toggleOf = (page) => page.locator('.topbar').getByTitle(/^Toggle case sidebar/);
const SHOTS = process.env.SCENE_SHOTS;

/** A picture of the top bar's right end, dark and light, when a folder is named for them. */
async function shootBar(page, name) {
  if (!SHOTS) return;
  const { width } = page.viewportSize();
  const clip = { x: width - 520, y: 0, width: 520, height: 120 };
  const theme = (wanted) => page.evaluate(async (which) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(which);
  }, wanted);
  await page.mouse.move(700, 500);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png`, clip });
  await page.screenshot({ path: `${SHOTS}/${name}-dark-full.png` });
  await theme('light');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png`, clip });
  await page.screenshot({ path: `${SHOTS}/${name}-light-full.png` });
  await theme('dark');
  await page.waitForTimeout(350);
}

test('the sidebar’s toggle wears a dot while it is closed on scenes waiting, the To-do counting them once open', async ({ page }) => {
  const { fixture, server } = await openCase(page, [PASSAGE, INSTANT, row(VIDEO, 'sc_3', 40, null, 'Gone', { state: 'abandoned' })]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#board');
  await expect(sidebarOf(page)).toHaveCount(0);
  const toggle = toggleOf(page);
  await expect(toggle.locator('.waiting-dot')).toBeVisible();
  await expect(toggle).toHaveAttribute('title', 'Toggle case sidebar · scenes to geolocate in the To-do');
  expect(server.reads).toBe(1);
  await shootBar(page, 'toggle-dot');

  // pressed, the sidebar opens as it always did and its To-do tab says the rest
  await toggle.click();
  await expect(sidebarOf(page)).toBeVisible();
  await expect(toggle.locator('.waiting-dot')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('title', 'Toggle case sidebar');
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 2 scenes to geolocate');
  // the number was already in hand
  expect(server.reads).toBe(1);
  await toggle.click();
  await expect(toggle.locator('.waiting-dot')).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('with the sidebar closed, an autosave asks the file’s scenes alone, as an open sidebar does', async ({ page }) => {
  await hearNudges(page);
  const { server } = await openCase(page);
  await page.goto('/#board');
  const toggle = toggleOf(page);
  await expect(toggle.locator('.waiting-dot')).toBeVisible();
  expect(server.reads).toBe(1);

  for (let save = 0; save < 3; save += 1) {
    await page.evaluate((video) => window.nudge({ type: 'scenes', case_id: 'browser-test', video }), VIDEO);
    await expect.poll(() => server.fileReads.length).toBe(save + 1);
  }
  await page.waitForTimeout(500);
  expect(server.reads).toBe(1);

  // every scene given up elsewhere: the file's answer differs, the queue is read, the dot goes
  for (const one of server.scenes) Object.assign(one, { state: 'abandoned', abandoned: { reason: '', at: 'now' } });
  await page.evaluate((video) => window.nudge({ type: 'scenes', case_id: 'browser-test', video }), VIDEO);
  await expect(toggle.locator('.waiting-dot')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('title', 'Toggle case sidebar');
  expect(server.reads).toBe(2);
});

test('the To-do tab counts the scenes waiting, and says nothing when there are none', async ({ page }) => {
  const { fixture, server } = await openCase(page, [PASSAGE, INSTANT, row(VIDEO, 'sc_3', 40, null, 'Gone', { state: 'abandoned' })]);
  await page.goto('/#files');
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 2 scenes to geolocate');
  await expect(todoTab(page)).toHaveText(/To-do\s*2/);
  await expect(todoTab(page)).toHaveAttribute('title', '2 scenes to geolocate');
  expect(server.reads).toBe(1);

  // an abandoned one leaves the count
  await todoTab(page).click();
  const group = sidebarOf(page).getByRole('region', { name: 'To geolocate' });
  await group.getByRole('button', { name: 'Abandon Minaret' }).click();
  await page.route(`**/api/cases/${CASE_ID}/scenes/*/abandon`, (route) => {
    server.scenes.find((one) => one.id === 'sc_2').state = 'abandoned';
    return route.fulfill({ json: { scene: {} } });
  });
  await group.getByLabel('Why it is abandoned').press('Enter');
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 1 scene to geolocate');
  fixture.expectNoUnexpectedRequests();
});

test('an autosave of a file whose scenes stand leaves the queue unread', async ({ page }) => {
  await hearNudges(page);
  const { server } = await openCase(page);
  await page.goto('/#files');
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 2 scenes to geolocate');
  expect(server.reads).toBe(1);

  for (let save = 0; save < 3; save += 1) {
    await page.evaluate((video) => window.nudge({ type: 'scenes', case_id: 'browser-test', video }), VIDEO);
    await expect.poll(() => server.fileReads.length).toBe(save + 1);
  }
  await page.waitForTimeout(500);
  expect(server.reads).toBe(1);

  // a scene kept in Inspect meanwhile: the file's answer differs, and the queue is read
  server.scenes.push(row(VIDEO, 'sc_3', 400, null, 'Silo'));
  await page.evaluate((video) => window.nudge({ type: 'scenes', case_id: 'browser-test', video }), VIDEO);
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 3 scenes to geolocate');
  expect(server.reads).toBe(2);
});

test('a proof laying the picture out ends it: the pill, the row and the count go', async ({ page }) => {
  await hearNudges(page);
  const { server } = await openCase(page, [row(PHOTO, 'sc_photo', null, null, 'Harbour wall')]);
  await page.goto('/#files');
  await todoTab(page).click();
  const group = sidebarOf(page).getByRole('region', { name: 'To geolocate' });
  await group.getByRole('button', { name: 'Geolocate Harbour wall' }).click();
  const pill = page.getByRole('group', { name: 'Geolocating · Whole picture · Harbour wall' });
  await expect(pill).toBeVisible();
  await page.getByTitle('Toggle case sidebar').click();
  await expect(group.locator('li.scene.live')).toContainText('Geolocating');

  // what the server does when the proof is saved
  server.scenes = [];
  server.geolocating = null;
  await page.evaluate(() => {
    window.nudge({ type: 'geolocating', case_id: 'browser-test', video: null, draft: null });
    window.nudge({ type: 'scenes', case_id: 'browser-test', video: null });
  });
  await expect(pill).toHaveCount(0);
  await expect(group).toHaveCount(0);
  await expect(todoTab(page)).toHaveAccessibleName('To-do');
});

test('a case with no scene shows the tab as it always was', async ({ page }) => {
  const { fixture } = await openCase(page, []);
  await page.goto('/#files');
  await expect(todoTab(page)).toHaveAccessibleName('To-do');
  await expect(todoTab(page)).toHaveText('To-do');
  // and the toggle, the sidebar closed
  await toggleOf(page).click();
  await expect(sidebarOf(page)).toHaveCount(0);
  await expect(toggleOf(page)).toHaveAttribute('title', 'Toggle case sidebar');
  await expect(page.locator('.topbar .waiting-dot')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('Go to opens the To-do, from a map with the sidebar folded', async ({ page }) => {
  const { fixture } = await openCase(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await expect(sidebarOf(page)).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  const row = dialog.getByRole('option', { name: /To geolocate/ });
  await expect(row).toContainText('2 scenes · To-do');
  await dialog.getByRole('combobox').fill('geoloc');
  await expect(row).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(sidebarOf(page).getByRole('tab', { name: /^To-do/ })).toHaveAttribute('aria-selected', 'true');
  await expect(sidebarOf(page).getByRole('region', { name: 'To geolocate' })).toBeVisible();
  await expect(page).toHaveURL(/#satellite/);
  fixture.expectNoUnexpectedRequests();
});

test('the sidebar opened by Go to stays open on the way back to the map', async ({ page }) => {
  await openCase(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Go to' }).getByRole('combobox').fill('geoloc');
  await page.getByRole('option', { name: /To geolocate/ }).click();
  await expect(sidebarOf(page)).toBeVisible();
  await page.getByRole('button', { name: 'Case', exact: true }).click();
  await expect(page).not.toHaveURL(/#satellite/);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page).toHaveURL(/#satellite/);
  await expect(sidebarOf(page)).toBeVisible();
});

test('the tab keeps its line in the narrowest sidebar, with a large count', async ({ page }) => {
  const many = Array.from({ length: 128 }, (_, at) => row(VIDEO, `sc_${at}`, at, null));
  await openCase(page, many);
  await page.addInitScript(() => localStorage.setItem('azimut:sidebarW', '240'));
  await page.goto('/#files');
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 128 scenes to geolocate');
  const tabs = sidebarOf(page).getByRole('tablist', { name: 'Sidebar view' });
  const box = await tabs.boundingBox();
  const last = await tabs.getByRole('tab', { name: 'Recent' }).boundingBox();
  expect(last.y).toBe(box.y);
  expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('Go to finds a scene by its words and opens it in Inspect', async ({ page }) => {
  await openCase(page);
  await page.goto('/#files');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Go to' });
  await dialog.getByRole('combobox').fill('bridge');
  const group = dialog.getByRole('group', { name: 'Scenes to geolocate' });
  await expect(group.getByRole('option')).toHaveCount(1);
  await expect(group.getByRole('option')).toContainText('Market walk');
  await group.getByRole('option').click();
  await expect(page).toHaveURL(/#inspect/);
});

test('a picture is marked from the Media Library and shown in the To-do', async ({ page }) => {
  const { fixture, server } = await openCase(page, []);
  await page.goto('/#media');
  const card = page.locator(`.media-card[data-path="${PHOTO}"]`);
  await card.getByTitle('Open in…').click();
  const menu = page.getByRole('menu', { name: /Harbour photo/ });
  await menu.getByRole('menuitem', { name: 'Mark to geolocate' }).click();
  expect(server.marks).toEqual([PHOTO]);
  const toast = page.getByText('Marked to geolocate', { exact: true });
  await expect(toast).toBeVisible();
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 1 scene to geolocate');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  const group = sidebarOf(page).getByRole('region', { name: 'To geolocate' });
  await expect(group.locator('li.scene')).toHaveCount(1);
  await expect(group.locator('li.scene')).toContainText('Whole picture');

  // already there: the menu says so, and shows it rather than asking again
  await card.getByTitle('Open in…').click();
  await menu.getByRole('menuitem', { name: 'Marked to geolocate' }).click();
  expect(server.marks).toEqual([PHOTO]);
  fixture.expectNoUnexpectedRequests();
});

test('a video is marked whole, and a capture or a frame is not offered', async ({ page }) => {
  const { server } = await openCase(page, []);
  await page.goto('/#media');
  await page.locator(`.media-card[data-path="${VIDEO}"]`).getByTitle('Open in…').click();
  await page.getByRole('menu', { name: /Market walk/ }).getByRole('menuitem', { name: 'Mark to geolocate' }).click();
  await expect(page.getByText('Whole video marked to geolocate', { exact: true })).toBeVisible();
  expect(server.marks).toEqual([VIDEO]);

  // the working files come back by their switch
  await page.getByRole('button', { name: /Show 2 working files/ }).click();
  await page.locator(`.media-card[data-path="${CAPTURE}"]`).getByTitle('Open in…').click();
  const capture = page.getByRole('menu', { name: /Bridge from above/ });
  await expect(capture.getByRole('menuitem', { name: 'Inspect' })).toBeVisible();
  await expect(capture.getByRole('menuitem', { name: /to geolocate/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.locator(`.media-card[data-path="${FRAME}"]`).getByTitle('Open in…').click();
  await expect(page.getByRole('menu', { name: /Frame 0:12/ }).getByRole('menuitem', { name: /to geolocate/ })).toHaveCount(0);
});

test('Files marks a picture from its right-click, and a frame is refused calmly', async ({ page }) => {
  const entity = (id, label, path, kind) => ({
    id, type: 'media', label, attrs: { path, kind }, provenance: { by: 'user', at: '2026-11-01T10:00:00Z', status: 'confirmed' },
  });
  const { server } = await openCase(page, [], {
    cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: [] }],
    catalog: [entity('photo', 'Harbour photo', PHOTO, 'image'), entity('frame', 'Frame 0:12', FRAME, 'image')],
  });
  await page.goto('/#files');
  await page.locator('.tree-rail .trow', { hasText: 'Unfiled' }).click();
  await page.locator('.grid-pane .tile.entity', { hasText: 'Harbour photo' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await menu.getByRole('menuitem', { name: 'Mark to geolocate' }).click();
  await expect(page.getByText('Marked to geolocate', { exact: true })).toBeVisible();
  expect(server.marks).toEqual([PHOTO]);
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 1 scene to geolocate');

  await page.locator('.grid-pane .tile.entity', { hasText: 'Frame 0:12' }).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Mark to geolocate' }).click();
  await expect(page.getByText("A frame cut from a video belongs to its video's scenes")).toBeVisible();
  await expect(todoTab(page)).toHaveAccessibleName('To-do, 1 scene to geolocate');
});

test('Files keeps a picture’s whole menu on a short window', async ({ page }) => {
  const entity = { id: 'photo', type: 'media', label: 'Harbour photo', attrs: { path: PHOTO, kind: 'image' }, provenance: { by: 'user', at: '2026-11-01T10:00:00Z', status: 'confirmed' } };
  await openCase(page, [], { cases: [{ id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: [] }], catalog: [entity] });
  await page.setViewportSize({ width: 1500, height: 600 });
  await page.goto('/#files');
  await page.locator('.tree-rail .trow', { hasText: 'Unfiled' }).click();
  await page.locator('.grid-pane .tile.entity', { hasText: 'Harbour photo' }).click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Delete' })).toBeInViewport();
});

test('a picture’s row says Whole picture with no bar mark', async ({ page }) => {
  const { fixture } = await openCase(page, [row(PHOTO, 'sc_photo', null, null), row(PHOTO, 'sc_named', null, null, 'Harbour wall')]);
  await page.goto('/#files');
  await todoTab(page).click();
  const group = sidebarOf(page).getByRole('region', { name: 'To geolocate' });
  await expect(group.locator('li.scene').first()).toContainText('Whole picture');
  await expect(group.locator('li.scene').nth(1)).toContainText('Harbour wall');
  await expect(group.locator('li.scene').nth(1)).toContainText('Whole pictureTo geolocate: no map capture yet, the picture itself');
  await expect(group.locator('.mark')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('Geolocate on a picture holds it over the map, and the pill names it', async ({ page }) => {
  const { fixture } = await openCase(page, [row(PHOTO, 'sc_photo', null, null, 'Harbour wall')]);
  await page.goto('/#files');
  await todoTab(page).click();
  const group = sidebarOf(page).getByRole('region', { name: 'To geolocate' });
  await group.getByRole('button', { name: 'Geolocate Harbour wall' }).click();
  await expect(page).toHaveURL(/#satellite/);
  await awaitMapReady(page);

  const viewer = page.locator('.ref-viewer');
  await expect(viewer).toHaveCount(1);
  await expect(viewer.getByRole('img', { name: 'Scene · Harbour wall · Whole picture' })).toBeVisible();
  // a picture: no clip, no bar, no mark at rest
  await expect(viewer.locator('video')).toHaveCount(0);
  await expect(viewer.locator('.rv-scene-line')).toHaveCount(0);

  const pill = page.getByRole('group', { name: 'Geolocating · Whole picture · Harbour wall' });
  await expect(pill).toBeVisible();
  await expect(pill.getByRole('button', { name: 'Make the proof' })).toHaveAttribute('title', 'Make the proof from the picture and its captures');

  await pill.getByRole('button', { name: 'Make the proof' }).click();
  await expect(page).toHaveURL(/#inspect/);
  fixture.expectNoUnexpectedRequests();
});
