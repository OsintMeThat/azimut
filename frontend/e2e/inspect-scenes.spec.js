import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * The Scenes tab of Inspect, first of its tabs and open on a video: a closed scene
 * writes its kind and time, one is open at a time with its time as it stands, Mark to
 * geolocate sits above the tabs, the empty strip invites, the first scene ever kept
 * says it is in the To-do, and a picture is marked whole and proved by a proof laying
 * it out. `SCENE_SHOTS` names a folder for the pictures of each state.
 */

const VIDEO = 'media/steps.webm';
const PHOTO = 'media/market.png';
const CAPTURE = 'media/capture-bridge.png';
const SHOTS = process.env.SCENE_SHOTS;
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
  </svg>`;

const image = (path, title, source, extra = {}) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256,
  sha256: '0'.repeat(64), source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
  entity_id: `e_${path}`, ...extra,
});

/** The case's media: the clip, a photo, a capture, and a frame cut from the clip. */
const MEDIA = () => [
  { path: VIDEO, filename: 'steps.webm', title: 'Convoy clip', kind: 'video', entity_id: 'e_steps', size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
  image(PHOTO, 'Market', { type: 'upload' }),
  image(CAPTURE, 'Bridge from above', { type: 'satellite' }),
  image('media/frame.png', 'A frame of the clip', { type: 'inspect', op: 'frame', from: VIDEO, time: 0.4 }),
];

/** Inspect's routes answered the way the server does, over the app's fixture. */
async function serve(page, { scenes = [], proofs = [], held = {}, viewport = { width: 1500, height: 900 }, opens = 'Convoy clip' } = {}) {
  await page.setViewportSize(viewport);
  const media = MEDIA();
  const fixture = await installAppFixture(page, { media });
  const server = { scenes, proofs, held, saves: [] };
  const fileOf = (url) => url.searchParams.get('video') ?? url.searchParams.get('path');
  const row = (scene, path) => {
    const state = server.held[scene.id] ?? { captures: [], abandoned: null };
    return {
      kind: 'draft', video: path, id: scene.id, start: scene.start, end: scene.end, label: scene.label,
      state: state.abandoned ? 'abandoned' : state.captures.length ? 'progress' : 'todo',
      captures: state.captures, abandoned: state.abandoned, file_kind: path === VIDEO ? 'video' : 'image',
    };
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path.startsWith(`/files/${CASE_ID}/media/`) && path.endsWith('.png')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) {
      return json(fileOf(url) === VIDEO
        ? { kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 }
        : { kind: 'image', width: 640, height: 360 });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'GET') {
      const file = fileOf(url);
      const drafts = file === VIDEO ? server.scenes : server.picture ?? [];
      if (!drafts.length) return json({ work: null });
      return json({
        work: {
          name: 'Work', title: 'Work',
          spec: { source: { path: file, kind: file === VIDEO ? 'video' : 'image' }, videoAdjust: {}, videoRotation: 0, frames: [], marks: [], scenes: drafts, activeFrameId: null },
        },
      });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'PUT') {
      const body = request.postDataJSON();
      server.saves.push(body);
      if (body.path === VIDEO) server.scenes = body.spec.scenes;
      else server.picture = body.spec.scenes;
      return json({ name: 'Work', title: 'Work' });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) {
      return route.fulfill({ contentType: 'image/png', body: PIXEL_PNG });
    }
    if (path === `/api/cases/${CASE_ID}/scenes`) {
      const file = fileOf(url);
      if (file === VIDEO) {
        return json({ video: VIDEO, video_id: 'e_steps', used: {}, taken: [], scenes: [...server.proofs, ...server.scenes.map((sc) => row(sc, VIDEO))], geolocating: null });
      }
      // a picture: the proofs laying it out, else its marks
      const laid = server.pictureProofs ?? [];
      const drafts = server.picture ?? [];
      return json({
        video: file, video_id: `e_${file}`, used: {}, taken: laid.length ? drafts.map((sc) => sc.id) : [],
        scenes: laid.length ? laid : drafts.map((sc) => row(sc, file)), geolocating: null,
      });
    }
    return route.fallback();
  });
  await page.goto('/#inspect');
  if (opens) await openFile(page, opens);
  return { fixture, server, media };
}

async function openFile(page, title) {
  await page.locator('.card', { hasText: title }).click();
  if (title === 'Convoy clip') await page.waitForFunction(() => (document.querySelector('.video-canvas video')?.readyState ?? 0) >= 2);
}

async function theme(page, which) {
  await page.evaluate(async (wanted) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(wanted);
  }, which);
}

/** A picture of this state, dark and light, when a folder is named for them. */
async function shoot(page, name) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await theme(page, 'light');
  // past the theme's own fade
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await theme(page, 'dark');
  await page.waitForTimeout(350);
}

const tab = (page, name) => page.getByRole('tab', { name });
const panel = (page) => page.getByRole('tabpanel', { name: 'Scenes' });
const rows = (page) => panel(page).getByTestId('scene-row');
const kept = (id, start, end, label) => ({ id, start, end, label });

const THREE = () => [kept('sc_1', 0.4, 0.9, 'Road bridge?'), kept('sc_2', 1, null, ''), kept('sc_3', null, null, 'Which town?')];
const DEPOT = {
  kind: 'proof', proof: 'depot', title: 'Fuel depot', moments: [{ start: 0.1, end: 0.3 }], at: [0.2], stated: true, draft: null,
  points: [{ coords: '48.5, 35.0', label: '', pov: false }],
};

test('opens a video on its Scenes tab, first of four, the count tinted while some are still to prove', async ({ page }) => {
  await serve(page, { scenes: THREE(), proofs: [DEPOT] });
  await expect(page.getByRole('tablist', { name: 'Panel' }).getByRole('tab')).toHaveText([/^Scenes\s*4$/, 'Adjust', 'Moments', 'Info']);
  await expect(tab(page, /^Scenes/)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, /^Scenes/).locator('.count')).toHaveClass(/todo/);
  // the player's row no longer holds a Scenes button, and nothing narrows the video
  await expect(page.locator('.player-bar').getByRole('button', { name: /^Scenes/ })).toHaveCount(0);
  const canvas = await page.locator('.video-canvas').boundingBox();
  const bar = await page.locator('.track').boundingBox();
  expect(canvas.width).toBeGreaterThan(bar.width);
  await expect(rows(page)).toHaveCount(4);
  await shoot(page, 'video-scenes');
});

test('offers Mark to geolocate above the tabs, its arrow This moment and Whole video', async ({ page }) => {
  await serve(page, { scenes: [kept('sc_1', 0.4, 0.9, 'Road bridge?')] });
  await page.getByRole('button', { name: 'More ways to mark' }).click();
  await expect(page.getByRole('menuitem', { name: /This moment/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Whole video/ })).toBeVisible();
  await shoot(page, 'mark-menu');
});

test('writes each closed scene\'s kind and time, and opens one at a time', async ({ page }) => {
  await serve(page, { scenes: THREE(), proofs: [DEPOT] });
  const whole = rows(page).nth(0);
  const bridge = rows(page).nth(2);
  await expect(rows(page).nth(1)).toContainText('Passage · 0:00–0:00');
  await expect(rows(page).nth(1)).toContainText('Proved');
  await expect(bridge).toContainText('Road bridge?');
  await expect(bridge).toContainText('Passage · 0:00–0:00');
  await expect(rows(page).nth(3)).toContainText('Instant · 0:01');
  // the first is open: its time shows with nothing pressed, and no key is taken from the player
  await expect(whole.getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toHaveCount(1);

  // a press anywhere on another opens it, alone, and the clip goes there
  await bridge.click();
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toHaveCount(1);
  const opened = rows(page).nth(2);
  await expect(opened.getByRole('radio', { name: 'Passage' })).toHaveAttribute('aria-checked', 'true');
  await expect(opened.getByRole('textbox', { name: 'Scene start' })).toHaveValue('0:00.4');
  await expect(opened.getByRole('textbox', { name: 'Scene end' })).toHaveValue('0:00.9');
  await expect(page.locator('.player-time .now')).toHaveText('0:00.400');
  await expect(rows(page).nth(0).getByTestId('scene-when')).toHaveText('Whole video');
  // the bar's handles are on the scene open
  await expect(page.getByTestId('scene-grip-end')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await shoot(page, 'open-passage');

  // a change asks for Apply, and Escape takes it back
  await opened.getByRole('textbox', { name: 'Scene start' }).fill('0:00.2');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  await page.mouse.move(0, 0);
  await shoot(page, 'open-changed');
  await opened.getByRole('textbox', { name: 'Scene start' }).press('Escape');
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await expect(opened.getByRole('textbox', { name: 'Scene start' })).toHaveValue('0:00.4');
});

test('invites in the empty strip of a video with nothing marked, and remembers Not now for that file', async ({ page }) => {
  await serve(page, { scenes: [] });
  const invite = page.getByTestId('scene-invite');
  await expect(invite).toContainText('Several places in this video?');
  await shoot(page, 'invite');
  // it takes no room of its own: the strip stands as high as with frames in it
  expect((await page.locator('.strip').boundingBox()).height).toBeLessThan(80);
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(invite.getByRole('button', { name: 'Not now' })).toBeInViewport();
  expect((await page.locator('.strip').boundingBox()).height).toBeLessThan(80);
  await shoot(page, 'invite-narrow');
  await invite.getByRole('button', { name: 'Not now' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.locator('.strip')).toContainText('Frames you capture are kept with this video.');
  await page.reload();
  await openFile(page, 'Convoy clip');
  await expect(page.locator('.strip')).toContainText('Frames you capture are kept with this video.');
  await expect(invite).toHaveCount(0);
});

test('says once that the first scene kept is in the To-do too, and Show opens it', async ({ page }) => {
  await serve(page, { scenes: [] });
  await page.getByTestId('scene-invite').getByRole('button', { name: 'This moment' }).click();
  const toast = page.locator('.toast', { hasText: 'Also in the To-do' });
  await expect(toast).toContainText('Scene kept at 0:00');
  await expect(page.getByTestId('scene-invite')).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await shoot(page, 'first-hint');
  await toast.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('tablist', { name: 'Sidebar view' }).getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-selected', 'true');

  // never again in this browser
  await page.keyboard.press('Escape');
  await page.locator('.pinned').getByRole('button', { name: /^Mark to geolocate/ }).click();
  await expect(page.locator('.toast', { hasText: 'Scene kept at 0:00' }).last()).not.toContainText('Also in the To-do');
});

test('marks a picture whole, and shows the proof that lays it out', async ({ page }) => {
  const { server } = await serve(page, { opens: 'Market', viewport: { width: 1280, height: 800 } });
  await tab(page, /^Scenes/).click();
  const mark = panel(page).getByRole('button', { name: 'Mark to geolocate' });
  await shoot(page, 'picture-unmarked');
  await mark.click();
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.length).toBe(1);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByTestId('scene-state')).toContainText('To geolocate');
  await expect(rows(page).first().getByRole('radio')).toHaveCount(0);
  await expect(mark).toHaveCount(0);
  await shoot(page, 'picture-marked');

  server.pictureProofs = [{ kind: 'proof', proof: 'p12', title: 'Proof 12', moments: [], at: [], stated: false, draft: null, points: [{}] }];
  await page.getByRole('tab', { name: 'Adjust' }).click();
  await page.evaluate(async () => {
    const { reloadCase } = await import('/src/lib/state.svelte.js');
    await reloadCase();
  });
  await tab(page, /^Scenes/).click();
  await expect(rows(page).first()).toContainText('Proved · Proof 12');
  await shoot(page, 'picture-proved');
});

test('opens the Scenes tab on a pin or a band pressed on the bar, from any tab', async ({ page }) => {
  await serve(page, { scenes: THREE() });
  await tab(page, 'Info').click();
  const bar = await page.locator('.track').boundingBox();
  const at = (time) => [bar.x + (bar.width * time) / STEPS_DURATION, bar.y + bar.height / 2];
  await page.mouse.click(...at(0.6));
  await expect(tab(page, /^Scenes/)).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).nth(1).getByRole('textbox', { name: 'Scene label' })).toHaveValue('Road bridge?');
  await page.mouse.click(...at(1));
  await expect(rows(page).nth(2).getByRole('radio', { name: 'Instant' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.player-time .now')).toHaveText('0:01.000');
});

test('keeps a scene with S whichever row is open, and folds the row with Escape', async ({ page }) => {
  const { server } = await serve(page, { scenes: THREE() });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('s');
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole('textbox', { name: 'Scene start' })).not.toBeFocused();
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.length).toBe(4);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toHaveCount(0);
  // the player kept the keys all along
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.player-time .now')).toHaveText('0:00.080');
});

test('makes the proof of a picture on it and its captures, stating no scene', async ({ page }) => {
  const { fixture, server } = await serve(page, { opens: 'Market' });
  await tab(page, /^Scenes/).click();
  await panel(page).getByRole('button', { name: 'Mark to geolocate' }).click();
  await rows(page).first().getByRole('textbox', { name: 'Scene label' }).fill('Market?');
  // a capture gathered for it on the map
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.[0]?.label).toBe('Market?');
  server.held[server.saves.at(-1).spec.scenes[0].id] = { captures: [CAPTURE], abandoned: null };
  await tab(page, 'Adjust').click();
  await page.evaluate(async () => {
    const { reloadCase } = await import('/src/lib/state.svelte.js');
    await reloadCase();
  });
  await tab(page, /^Scenes/).click();
  await expect(rows(page).first().getByTestId('scene-state')).toContainText('In progress · 1 capture');
  await rows(page).first().getByRole('button', { name: 'Make the proof' }).click();

  await expect(page).toHaveURL(/#proof/);
  // a fresh dev server compiles Geo Proof on this first visit
  await expect(page.locator('.panel-row')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Market');
  const sides = page.getByRole('tablist', { name: 'Proof settings' });
  await expect(sides.getByRole('tab', { name: /^Proof/ })).toHaveAttribute('aria-selected', 'true');
  await expect(sides.getByRole('tab', { name: 'Scene' })).toHaveCount(0);
  expect(fixture.proofSaves).toHaveLength(0);
});

test('offers no mark on a capture or on a frame cut from a video', async ({ page }) => {
  await serve(page, { opens: 'Bridge from above' });
  await expect(page.getByRole('tablist', { name: 'Panel' }).getByRole('tab')).toHaveText(['Adjust', 'Analyze', 'Info']);
  await page.getByRole('button', { name: 'Change file' }).click();
  await page.getByRole('dialog').locator('.card', { hasText: 'A frame of the clip' }).click();
  await expect(page.locator('.file-name')).toHaveValue('A frame of the clip');
  await expect(page.getByRole('tablist', { name: 'Panel' }).getByRole('tab')).toHaveText(['Adjust', 'Analyze', 'Info']);
  await expect(page.getByRole('button', { name: 'Mark to geolocate' })).toHaveCount(0);
});

test('at 1280 px the tab keeps every act of the open scene in view', async ({ page }) => {
  await serve(page, { scenes: THREE(), viewport: { width: 1280, height: 720 } });
  await rows(page).nth(1).click();
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toBeVisible();
  const panelBox = await panel(page).boundingBox();
  for (const name of ['End here', 'Make the proof', 'Geolocate']) {
    const box = await rows(page).nth(1).getByRole('button', { name }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  }
  await shoot(page, 'tab-1280');
  // the panel at its narrowest keeps the acts on one line, Make the proof down to its mark
  await page.evaluate(() => localStorage.setItem('azimut:inspectPanelW', '300'));
  await page.reload();
  await openFile(page, 'Convoy clip');
  await rows(page).nth(1).click();
  const row = await rows(page).nth(1).boundingBox();
  const geolocate = await rows(page).nth(1).getByRole('button', { name: 'Geolocate' }).boundingBox();
  const end = await rows(page).nth(1).getByRole('button', { name: 'End here' }).boundingBox();
  expect(geolocate.x + geolocate.width).toBeLessThanOrEqual(row.x + row.width);
  expect(Math.abs(geolocate.y + geolocate.height / 2 - (end.y + end.height / 2))).toBeLessThan(2);
});
