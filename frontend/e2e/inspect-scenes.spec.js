import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * The Scenes tab of Inspect, first of its tabs and open on a video: a closed scene
 * writes its kind and time, one is open at a time with its time as it stands, Mark to
 * geolocate sits above the tabs, the empty strip invites, the first scene ever kept
 * points once at the To-do, every file opens on its Scenes, and a picture is marked
 * whole and proved by a proof laying it out. `SCENE_SHOTS` names a folder for the
 * pictures of each state.
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
async function serve(page, { scenes = [], proofs = [], held = {}, collages = [], viewport = { width: 1500, height: 900 }, opens = 'Convoy clip' } = {}) {
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
    // the To-do's scenes waiting, the clip's that no proof takes up
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) {
      const open = server.scenes.map((sc) => row(sc, VIDEO));
      return json({ files: open.length ? [{ video: VIDEO, title: 'Convoy clip', kind: 'video', scenes: open }] : [], geolocating: null });
    }
    if (path === `/api/cases/${CASE_ID}/scenes`) {
      const file = fileOf(url);
      if (file === VIDEO) {
        return json({
          video: VIDEO, video_id: 'e_steps', used: {}, taken: [], scenes: [...server.proofs, ...server.scenes.map((sc) => row(sc, VIDEO))],
          geolocating: null, collages,
        });
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

test('hangs the collages of the clip under their scenes, and offers them to the proof', async ({ page }) => {
  const pan = { collage: 'Pan', title: 'Bridge pan', export: 'media/pan.png', current: true, times: [0.5, 0.7], start: 0.5, end: 0.7 };
  const { media } = await serve(page, { scenes: [kept('sc_1', 0.4, 0.9, 'Road bridge?'), kept('sc_2', 1, null, '')], collages: [pan] });
  media.push(image('media/pan.png', 'Bridge pan', { type: 'inspect', op: 'collage' }));

  const line = panel(page).getByTestId('scene-collage');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('Bridge pan');
  // right under the scene it falls in
  // the first row, open, its label in its field
  const scene = await rows(page).first().boundingBox();
  const hung = await line.boundingBox();
  expect(hung.y).toBeGreaterThanOrEqual(scene.y + scene.height - 1);
  expect(hung.y - (scene.y + scene.height)).toBeLessThan(12);
  await shoot(page, 'scene-collages');

  await rows(page).first().getByRole('button', { name: 'Make the proof' }).click();
  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  await expect(chooser.getByRole('list', { name: 'Collages of the scene' }).getByRole('checkbox')).toBeChecked();
  await shoot(page, 'chooser-collages');
  await chooser.getByRole('button', { name: 'Cancel' }).click();

  await line.click();
  await expect(page).toHaveURL(/#collage/);
});

test('offers Mark to geolocate above the tabs, its arrow This instant and Whole video', async ({ page }) => {
  await serve(page, { scenes: [] });
  await page.getByRole('button', { name: 'More ways to mark' }).click();
  await expect(page.getByRole('menuitem', { name: /This instant/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Whole video/ })).toBeEnabled();
  await shoot(page, 'mark-menu');
});

test('greys Whole video once a scene holds a passage, in the arrow and in another scene\'s kinds, saying why', async ({ page }) => {
  await serve(page, { scenes: [kept('sc_1', 0.4, 0.9, 'Road bridge?'), kept('sc_2', 1, null, '')] });
  await page.getByRole('button', { name: 'More ways to mark' }).click();
  const item = page.getByRole('menuitem', { name: /Whole video/ });
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute('title', 'Scenes are marked at passages of this video already');
  await page.keyboard.press('Escape');
  const kind = rows(page).first().getByRole('radio', { name: 'Whole video' });
  await expect(kind).toBeDisabled();
  await expect(kind).toHaveAttribute('title', 'Another scene is marked at passages of this video');
  await expect(rows(page).first().getByRole('radio', { name: 'Instant' })).toBeEnabled();
});

test('gives the clip\'s one scene about the whole video the instant S marks, Undo making it whole again', async ({ page }) => {
  const { server } = await serve(page, { scenes: [kept('sc_all', null, null, 'Which town?')] });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('s');
  const toast = page.locator('.toast', { hasText: 'no longer the whole video' });
  await expect(toast).toContainText('“Which town?” now at 0:00, no longer the whole video');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByRole('radio', { name: 'Instant' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes).toEqual([{ id: 'sc_all', start: 0.08, end: null, label: 'Which town?' }]);
  await page.mouse.move(0, 0);
  await shoot(page, 'takeover-toast');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page).first().getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes).toEqual([{ id: 'sc_all', start: null, end: null, label: 'Which town?' }]);
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
  await expect(invite).toContainText('One place or several?');
  await expect(invite.getByRole('button', { name: 'The whole video: one place' })).toBeVisible();
  await expect(invite.getByRole('button', { name: /^Several places: mark them as you watch/ })).toBeVisible();
  await page.mouse.move(0, 0);
  await shoot(page, 'invite');
  // it takes no room of its own: the strip stands as high as with frames in it
  expect((await page.locator('.strip').boundingBox()).height).toBeLessThan(80);
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(invite.getByRole('button', { name: 'Not now' })).toBeInViewport();
  const strip = await page.locator('.strip').boundingBox();
  expect(strip.height).toBeLessThan(80);
  // every choice inside the strip, none running under the panel beside it
  for (const button of await invite.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width);
  }
  await shoot(page, 'invite-narrow');
  await invite.getByRole('button', { name: 'Not now' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.locator('.strip')).toContainText('Frames you capture are kept with this video.');
  await page.reload();
  await openFile(page, 'Convoy clip');
  await expect(page.locator('.strip')).toContainText('Frames you capture are kept with this video.');
  await expect(invite).toHaveCount(0);
});

test('says how S marks several places, marks nothing, and stops asking; the whole video keeps one scene', async ({ page }) => {
  const { server } = await serve(page, { scenes: [] });
  const invite = page.getByTestId('scene-invite');
  await invite.getByRole('button', { name: /^Several places/ }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Press S where a place shows' })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await page.reload();
  await openFile(page, 'Convoy clip');
  await expect(page.locator('.strip')).toContainText('Frames you capture are kept with this video.');
  await expect(invite).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openFile(page, 'Convoy clip');
  await invite.getByRole('button', { name: 'The whole video: one place' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.[0]).toMatchObject({ start: null, end: null });
});

/** Where the coachmark's arrow points, and the box it lies in. */
async function arrowOf(coach) {
  const box = await coach.boundingBox();
  const arrow = await coach.evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--arrow')));
  return { box, x: box.x + arrow };
}
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('points once at the To-do tab from the open sidebar, the toast keeping its words, and Show opens the To-do', async ({ page }) => {
  const { server } = await serve(page, { scenes: [], viewport: { width: 1280, height: 800 } });
  const views = page.getByRole('tablist', { name: 'Sidebar view' });
  await page.keyboard.press('s');
  // the toast says what was done and offers Undo, nothing more
  const toast = page.locator('.toast', { hasText: 'Scene kept at 0:00' });
  await expect(toast).toBeVisible();
  await expect(toast).not.toContainText('To-do');
  await expect(toast.getByRole('button')).toHaveText(['Undo']);
  await expect(rows(page)).toHaveCount(1);

  const coach = page.locator('.coachmark');
  await expect(coach).toContainText('Your scenes wait here');
  await expect(coach.getByRole('button')).toHaveText(['Show', '']);
  // the work written, the server says so, and the tab gains its count: the arrow stays on it
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.length).toBe(1);
  await page.evaluate(async ({ caseId, video }) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch({ type: 'scenes', case_id: caseId, video });
  }, { caseId: CASE_ID, video: VIDEO });
  await expect(views.getByRole('tab', { name: /^To-do/ })).toContainText('1');
  // its arrow on the To-do tab, under it, never over the capture
  await expect.poll(async () => {
    const tab = await views.getByRole('tab', { name: /^To-do/ }).boundingBox();
    return Math.abs((await arrowOf(coach)).x - (tab.x + tab.width / 2));
  }).toBeLessThan(2);
  const todo = await views.getByRole('tab', { name: /^To-do/ }).boundingBox();
  const { box } = await arrowOf(coach);
  expect(box.y).toBeGreaterThan(todo.y + todo.height);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(overlaps(box, await page.locator('.pinned').boundingBox())).toBe(false);
  // it takes no focus, so the work goes on under it
  expect(await coach.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  await shoot(page, 'coach-tab');

  await coach.getByRole('button', { name: 'Show' }).click();
  await expect(views.getByRole('tab', { name: /^To-do/ })).toHaveAttribute('aria-selected', 'true');
  await expect(coach).toHaveCount(0);

  // never again in this browser
  await views.getByRole('tab', { name: 'Folders' }).click();
  await page.locator('.pinned').getByRole('button', { name: /^Mark to geolocate/ }).click();
  await expect(page.locator('.toast', { hasText: 'Scene kept at 0:00' }).last()).toBeVisible();
  await expect(coach).toHaveCount(0);
  await page.reload();
  await openFile(page, 'Convoy clip');
  await page.locator('.pinned').getByRole('button', { name: /^Mark to geolocate/ }).click();
  await expect(page.locator('.toast', { hasText: 'Scene kept at 0:00' })).toBeVisible();
  await expect(coach).toHaveCount(0);
});

test('points at the sidebar’s toggle while the sidebar is closed, follows it on a resize, and goes on a press elsewhere', async ({ page }) => {
  const { server } = await serve(page, { scenes: [], viewport: { width: 1280, height: 800 } });
  const toggle = page.locator('.topbar').getByTitle(/^Toggle case sidebar/);
  await toggle.click();
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await page.keyboard.press('s');
  // the work written, the server says so, as it does after every save
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.length).toBe(1);
  await page.evaluate(async ({ caseId, video }) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch({ type: 'scenes', case_id: caseId, video });
  }, { caseId: CASE_ID, video: VIDEO });
  const coach = page.locator('.coachmark');
  await expect(coach).toContainText('Your scenes wait here');
  const under = async () => {
    const button = await toggle.boundingBox();
    const { box, x } = await arrowOf(coach);
    expect(Math.abs(x - (button.x + button.width / 2))).toBeLessThan(2);
    expect(box.y).toBeGreaterThan(button.y + button.height);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width - 8);
    // clear of Capture frame and Mark to geolocate, and of the file's own buttons
    expect(overlaps(box, await page.locator('.pinned').boundingBox())).toBe(false);
    for (const name of ['Clear work', 'Change file']) {
      expect(overlaps(box, await page.getByRole('button', { name }).boundingBox())).toBe(false);
    }
  };
  await under();
  // the dot on the toggle, once the queue says the scene waits
  await expect(toggle.locator('.waiting-dot')).toBeVisible();
  await expect(toggle).toHaveAttribute('title', 'Toggle case sidebar · a scene to geolocate in the To-do');
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(400, 500);
  await shoot(page, 'coach-toggle');

  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => {
    const button = await toggle.boundingBox();
    const { x } = await arrowOf(coach);
    return Math.abs(x - (button.x + button.width / 2));
  }).toBeLessThan(2);
  await under();

  // a press anywhere else, which does its own work too
  await tab(page, 'Info').click();
  await expect(coach).toHaveCount(0);
  await expect(tab(page, 'Info')).toHaveAttribute('aria-selected', 'true');
  // the toggle opens the sidebar as before, the To-do counting what the dot stood for
  await toggle.click();
  await expect(toggle.locator('.waiting-dot')).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Sidebar view' }).getByRole('tab', { name: /^To-do/ })).toContainText('1');
});

test('lets the coachmark go on ✕, on Escape and by itself, and draws it still for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serve(page, { scenes: [] });
  const coach = page.locator('.coachmark');
  // asked again as Inspect asks, the pointer resting away from where it lands
  const again = async () => {
    await page.mouse.move(400, 500);
    await page.evaluate(async () => {
      const { uiState } = await import('/src/lib/state.svelte.js');
      uiState.todoHint = true;
    });
    await expect(coach).toBeVisible();
  };
  await page.keyboard.press('s');
  await expect(coach).toBeVisible();
  expect(await coach.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await coach.getByRole('button', { name: 'Close' }).click();
  await expect(coach).toHaveCount(0);
  // the scene kept all the same
  await expect(rows(page)).toHaveCount(1);

  await again();
  await page.keyboard.press('Escape');
  await expect(coach).toHaveCount(0);

  await page.clock.install();
  await again();
  await page.clock.runFor(9000);
  await expect(coach).toBeVisible();
  await page.clock.runFor(1500);
  await expect(coach).toHaveCount(0);
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

test('opens the Scenes tab on a pin pressed on the bar from any tab, and on a band only from Scenes', async ({ page }) => {
  await serve(page, { scenes: THREE() });
  await tab(page, 'Adjust').click();
  const bar = await page.locator('.track').boundingBox();
  const at = (time) => [bar.x + (bar.width * time) / STEPS_DURATION, bar.y + bar.height / 2];
  // a band pressed from Adjust moves the clip there, and Adjust stays
  await page.mouse.click(...at(0.6));
  await expect(page.locator('.player-time .now')).toHaveText(/^0:00\.(5|6)/);
  await expect(tab(page, 'Adjust')).toHaveAttribute('aria-selected', 'true');
  // a pin opens its scene from there
  await page.mouse.click(...at(1));
  await expect(tab(page, /^Scenes/)).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).nth(2).getByRole('radio', { name: 'Instant' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.player-time .now')).toHaveText('0:01.000');
  // on the Scenes tab, a band opens its own
  await page.mouse.click(...at(0.6));
  await expect(rows(page).nth(1).getByRole('textbox', { name: 'Scene label' })).toHaveValue('Road bridge?');
});

test('opens every file on its Scenes tab, whatever tab the last was left on', async ({ page }) => {
  await serve(page, { scenes: THREE() });
  await tab(page, 'Info').click();
  await page.getByRole('button', { name: 'Change file' }).click();
  await page.getByRole('dialog').locator('.card', { hasText: 'Market' }).click();
  await expect(page.locator('.file-name')).toHaveValue('Market');
  await expect(tab(page, /^Scenes/)).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Analyze').click();
  // a capture has no Scenes, and keeps the tab it had
  await page.getByRole('button', { name: 'Change file' }).click();
  await page.getByRole('dialog').locator('.card', { hasText: 'Bridge from above' }).click();
  await expect(page.locator('.file-name')).toHaveValue('Bridge from above');
  await expect(tab(page, 'Analyze')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Change file' }).click();
  await page.getByRole('dialog').locator('.card', { hasText: 'Convoy clip' }).click();
  await expect(page.locator('.file-name')).toHaveValue('Convoy clip');
  await expect(tab(page, /^Scenes/)).toHaveAttribute('aria-selected', 'true');
  // switching while it stays open is as it was
  await tab(page, 'Moments').click();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, /^Moments/)).toHaveAttribute('aria-selected', 'true');
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
