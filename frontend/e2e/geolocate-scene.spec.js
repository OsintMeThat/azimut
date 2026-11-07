import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * Geolocating a scene of a long video. Its row in Inspect's Scenes tab says where it
 * stands and offers Geolocate first, Make the proof second; Geolocate opens the map
 * with the video as a reference window, the scene marked on its bar, and a pill over
 * the tools counts the captures gathered for it. A scene given up on waits, greyed,
 * in a folded group with its word, and comes back from there.
 */

const VIDEO = 'media/steps.webm';
const CAPTURE = 'media/capture-bridge.png';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
  </svg>`;
const SHOTS = '/tmp/claude-1000/m2c-e2e/shots';

const image = (path, title, source) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256,
  sha256: '0'.repeat(64), source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});

/** The case: the video, a capture filed on the map, and a server that holds the scenes' state. */
async function openCase(page, { viewport = { width: 1500, height: 900 } } = {}) {
  await page.setViewportSize(viewport);
  const media = [
    { path: VIDEO, filename: 'steps.webm', title: 'Convoy clip', kind: 'video', entity_id: 'e_steps', size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
    image(CAPTURE, 'Bridge from above', { type: 'satellite' }),
  ];
  const fixture = await installAppFixture(page, { media });
  const server = {
    scenes: [
      { id: 'sc_1', start: 0.4, end: 0.9, label: 'Road bridge?' },
      { id: 'sc_2', start: 1.0, end: null, label: '' },
      { id: 'sc_3', start: 0.12, end: null, label: 'Market' },
    ],
    held: {
      sc_2: { captures: [CAPTURE], abandoned: null },
      sc_3: { captures: [], abandoned: { reason: 'no landmark in view', at: '2026-11-06T10:00:00+00:00' } },
    },
    geolocating: null,
    calls: [],
    saves: [],
    frameSaves: [],
  };
  const row = (scene) => {
    const held = server.held[scene.id] ?? { captures: [], abandoned: null };
    return {
      kind: 'draft', video: VIDEO, id: scene.id, start: scene.start, end: scene.end, label: scene.label,
      state: held.abandoned ? 'abandoned' : held.captures.length ? 'progress' : 'todo',
      captures: held.captures, abandoned: held.abandoned,
    };
  };
  // its place among the video's scenes in clip order, the proof at 0.2 s included
  const order = (id) => [{ id: 'depot', start: 0.2 }, ...server.scenes]
    .sort((a, b) => a.start - b.start).findIndex((sc) => sc.id === id);
  const current = () => {
    const scene = server.scenes.find((sc) => sc.id === server.geolocating);
    return scene ? { ...row(scene), order: order(scene.id), since: '2026-11-06T22:00:00+00:00' } : null;
  };
  server.row = (id) => row(server.scenes.find((sc) => sc.id === id));
  // Registered after the fixture, so these answer first.
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
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'GET') {
      return json({
        work: {
          name: 'Convoy clip', title: 'Convoy clip',
          spec: { source: { path: VIDEO, kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [], marks: [], scenes: server.scenes, activeFrameId: null },
        },
      });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'PUT') {
      const body = request.postDataJSON();
      server.saves.push(body);
      server.scenes = body.spec.scenes;
      return json({ name: 'Convoy clip', title: 'Convoy clip' });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) {
      const body = request.postDataJSON();
      const named = body.snap ? { 'X-Frame-Time': (Math.floor(body.time * STEPS_FPS + 1e-6) / STEPS_FPS).toFixed(6) } : {};
      return route.fulfill({ contentType: 'image/png', body: PIXEL_PNG, headers: named });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/save-frames` && method === 'POST') {
      const body = request.postDataJSON();
      server.frameSaves.push(body);
      const saved = body.items.map((item, i) => {
        const filed = image(`media/frame-${server.frameSaves.length}-${i}.png`, item.label, { type: 'inspect', op: 'frame', from: VIDEO, time: item.time });
        media.push(filed);
        return { item: filed, entity: { id: `e_frame_${server.frameSaves.length}_${i}` } };
      });
      return json({ saved });
    }
    if (path === `/api/cases/${CASE_ID}/scenes`) {
      return json({
        video: VIDEO, video_id: 'e_steps', used: {}, taken: [],
        scenes: [
          { kind: 'proof', proof: 'depot', title: 'Fuel depot', moments: [], at: [0.2], stated: false, draft: null, points: [{ coords: '48.5, 35.0', label: '', pov: false }] },
          ...server.scenes.map(row),
        ],
        geolocating: server.geolocating,
      });
    }
    // the same answer the route below gives: the sidebar reads the queue for its count
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) return json({ files: [], geolocating: current() });
    if (path === `/api/cases/${CASE_ID}/geolocating`) {
      server.calls.push(`${method} geolocating`);
      if (method === 'PUT') {
        server.geolocating = request.postDataJSON().draft;
        return json({ geolocating: current() });
      }
      if (method === 'DELETE') {
        const ended = server.geolocating != null;
        server.geolocating = null;
        return json({ ended });
      }
      return json({ geolocating: current() });
    }
    const leave = /^\/api\/cases\/[^/]+\/scenes\/([^/]+)\/abandon$/.exec(path);
    if (leave) {
      const id = decodeURIComponent(leave[1]);
      const held = (server.held[id] ??= { captures: [], abandoned: null });
      if (method === 'PUT') {
        const { reason } = request.postDataJSON();
        server.calls.push(`abandon ${id} ${reason}`);
        held.abandoned = { reason, at: '2026-11-06T22:10:00+00:00' };
        if (server.geolocating === id) server.geolocating = null;
      } else {
        server.calls.push(`restore ${id}`);
        held.abandoned = null;
      }
      return json({ scene: server.row(id) });
    }
    return route.fallback();
  });
  await page.goto('/#inspect');
  await page.locator('.card', { hasText: 'Convoy clip' }).click();
  await page.waitForFunction(() => (document.querySelector('.video-canvas video')?.readyState ?? 0) >= 2);
  return { fixture, server };
}

const scenesTab = (page) => page.getByRole('tab', { name: /^Scenes/ });
const panel = (page) => page.getByRole('tabpanel', { name: 'Scenes' });
const rows = (page) => panel(page).getByTestId('scene-row');
/** A row by its name: the tab lists the proof on the clip first, then the bridge, then the unnamed one. */
const ORDER = { 'Fuel depot': 0, 'Road bridge?': 1, '': 2 };
const rowOf = (page, text) => rows(page).nth(ORDER[text]);

/** That row open, with its acts. */
async function openRow(page, text) {
  const row = rowOf(page, text);
  if (await row.evaluate((node) => node.tagName === 'BUTTON')) await row.click();
  await expect(row.getByRole('group', { name: 'When the scene happens' })).toBeVisible();
  return row;
}

async function theme(page, which) {
  await page.evaluate(async (wanted) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(wanted);
  }, which);
}

test('says where each scene to prove stands, with Geolocate first and Make the proof beside it', async ({ page }) => {
  await openCase(page);
  // the abandoned one is left out of the count
  await expect(scenesTab(page).locator('.count')).toHaveText('3');
  await expect(panel(page)).toBeVisible();

  await expect(rows(page)).toHaveCount(3);
  // the first still to prove opens on its own, the proof before it stays folded
  await expect(rowOf(page, 'Fuel depot')).toContainText('Whole video');
  const bridge = await openRow(page, 'Road bridge?');
  await expect(bridge.getByRole('textbox', { name: 'Scene label' })).toHaveValue('Road bridge?');
  await expect(bridge.getByTestId('scene-state')).toContainText('To geolocate');
  await expect(bridge.getByRole('button', { name: 'Geolocate' })).toBeVisible();
  await expect(bridge.getByRole('button', { name: 'Make the proof' })).toBeVisible();
  const found = rows(page).nth(2);
  await expect(found.getByTestId('scene-state')).toContainText('In progress · 1 capture');
  // the abandoned one waits folded, its stretch still on the bar, greyed and hollow
  await expect(panel(page).getByRole('button', { name: 'Abandoned (1)' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.track .scene-pin.abandoned')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/tab-dark.png` });
  await panel(page).screenshot({ path: `${SHOTS}/tab-dark-close.png` });

  await theme(page, 'light');
  await panel(page).getByRole('button', { name: 'Abandoned (1)' }).click();
  await expect(panel(page).getByTestId('scene-row-abandoned')).toContainText('no landmark in view');
  await panel(page).screenshot({ path: `${SHOTS}/tab-light-abandoned.png` });
  await page.screenshot({ path: `${SHOTS}/tab-light.png` });
  await theme(page, 'dark');
});

test('abandons a scene with a word, keeps it greyed in its group, and brings it back', async ({ page }) => {
  const { server } = await openCase(page);
  const bridge = await openRow(page, 'Road bridge?');
  await bridge.getByRole('button', { name: 'Abandon' }).click();
  const word = bridge.getByRole('textbox', { name: 'Why it is abandoned' });
  await expect(word).toBeFocused();
  // Escape keeps it
  await word.press('Escape');
  await expect(word).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);

  await bridge.getByRole('button', { name: 'Abandon' }).click();
  await bridge.getByRole('textbox', { name: 'Why it is abandoned' }).fill('bridge is out of shot');
  await panel(page).screenshot({ path: `${SHOTS}/tab-abandon-word.png` });
  await page.keyboard.press('Enter');
  await expect.poll(() => server.calls).toContain('abandon sc_1 bridge is out of shot');
  await expect(rows(page)).toHaveCount(2);
  await expect(panel(page).getByRole('button', { name: 'Abandoned (2)' })).toBeVisible();
  await expect(page.locator('.track .scene.abandoned')).toHaveCount(1);
  await expect(scenesTab(page).locator('.count')).toHaveText('2');

  await panel(page).getByRole('button', { name: 'Abandoned (2)' }).click();
  const given = panel(page).getByTestId('scene-row-abandoned').filter({ hasText: 'Road bridge?' });
  await expect(given).toContainText('bridge is out of shot');
  await given.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => server.calls).toContain('restore sc_1');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.track .scene.abandoned')).toHaveCount(0);
});

test('geolocates a scene on the map, its video beside it and the captures counted on the pill', async ({ page }) => {
  const { server } = await openCase(page);
  const bridge = await openRow(page, 'Road bridge?');
  const colour = await bridge.evaluate((row) => row.style.getPropertyValue('--scene'));
  await bridge.getByRole('button', { name: 'Geolocate' }).click();
  await expect.poll(() => server.calls).toContain('PUT geolocating');
  await expect(page).toHaveURL(/#satellite/);
  await awaitMapReady(page);

  // the video opens as a reference window, paused where the scene starts, the scene on its bar
  const window = page.locator('.ref-viewer');
  await expect(window).toHaveCount(1);
  await expect(window.locator('.rv-title')).toHaveText('Convoy clip');
  await expect(window.getByRole('img', { name: /Scene · Road bridge\? · 0:00–0:00/ })).toBeVisible();
  const clip = window.locator('video');
  await expect.poll(() => clip.evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(0.4);
  expect(await clip.evaluate((v) => v.paused)).toBe(true);
  await window.hover();
  const band = window.getByTestId('ref-scene');
  await expect(band).toBeVisible();
  // in the colour Inspect's bar draws it in, as the pill's dot
  expect(await band.evaluate((node) => node.style.getPropertyValue('--scene'))).toBe(colour);
  expect(await page.getByTestId('geolocating-dot').evaluate((node) => node.style.getPropertyValue('--scene'))).toBe(colour);
  const bandBox = await band.boundingBox();
  const barBox = await window.locator('.vb-scrub').boundingBox();
  // 0.4–0.9 of a 1.2 s clip: a third in, five twelfths of the track wide
  expect((bandBox.x - barBox.x) / barBox.width).toBeCloseTo(0.33, 1);
  expect(bandBox.width / barBox.width).toBeCloseTo(0.41, 1);

  // the pill over the tools, with nothing captured yet
  const pill = page.getByRole('group', { name: 'Geolocating · 0:00–0:00 · Road bridge?' });
  await expect(pill).toBeVisible();
  await expect(pill.getByTestId('geolocating-count')).toHaveText('0');
  await page.screenshot({ path: `${SHOTS}/satellite-dark.png` });
  await page.locator('.topbar').screenshot({ path: `${SHOTS}/pill-dark.png` });

  // a capture filed for it, here or from the extension: the server says so, the count steps up
  server.held.sc_1 = { captures: [CAPTURE], abandoned: null };
  await page.evaluate(async (caseId) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch({ type: 'geolocating', case_id: caseId, video: 'media/steps.webm', draft: 'sc_1' });
  }, CASE_ID);
  await expect(pill.getByTestId('geolocating-count')).toHaveText('1');
  await expect(pill.getByTestId('geolocating-count')).toHaveClass(/bump/);

  await theme(page, 'light');
  await page.screenshot({ path: `${SHOTS}/satellite-light.png` });
  await page.locator('.topbar').screenshot({ path: `${SHOTS}/pill-light.png` });
  await theme(page, 'dark');

  // Geolocate again: the same window takes it, rather than a second
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.geolocateRef = { video: 'media/steps.webm', draft: 'sc_2', start: 1, end: null, label: '' };
  });
  await expect(window).toHaveCount(1);
  await window.hover();
  await expect(window.getByTestId('ref-scene')).toHaveClass(/pin/);

  // its label goes back to the scene in Inspect, the Scenes tab open on its row
  await expect(pill.getByRole('button', { name: /^Geolocating/ })).toHaveAttribute('title', 'Open the scene in Inspect, on steps.webm');
  await pill.getByRole('button', { name: /^Geolocating/ }).click();
  await expect(page).toHaveURL(/#inspect/);
  await expect(panel(page)).toBeVisible();
  const held = rowOf(page, 'Road bridge?');
  await expect(held).toHaveClass(/active/);
  await expect(held.getByTestId('scene-state')).toHaveText(/Geolocating · 1 capture/);
  await page.waitForTimeout(1700);
  await panel(page).screenshot({ path: `${SHOTS}/tab-active-dark.png` });

  // ✕ stops it, from whichever tool
  await pill.getByRole('button', { name: 'Stop geolocating' }).click();
  await expect.poll(() => server.calls).toContain('DELETE geolocating');
  await expect(page.locator('.geo-pill')).toHaveCount(0);
  await expect(held).not.toHaveClass(/active/);
});

test('makes the proof from the pill, the scene\'s frames first and then its captures', async ({ page }) => {
  const { server } = await openCase(page);
  const scene = await openRow(page, '');
  await scene.getByRole('button', { name: 'Geolocate' }).click();
  await expect(page).toHaveURL(/#satellite/);
  const pill = page.locator('.geo-pill');
  await expect(pill.getByTestId('geolocating-count')).toHaveText('1');

  await pill.getByRole('button', { name: 'Make the proof' }).click();
  await expect(page).toHaveURL(/#inspect/);
  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  await expect(chooser).toBeVisible();
  // an unnamed scene goes by its time, and holding no frame yet, it captures one
  await expect(chooser.locator('.scene-line')).toHaveText('0:01');
  await expect(chooser).toContainText('No frame in this scene yet.');
  await expect(chooser.getByRole('checkbox', { name: 'Capture Bridge from above' })).toBeChecked();
  await chooser.screenshot({ path: `${SHOTS}/chooser-captures-dark.png` });
  await chooser.getByRole('button', { name: 'Make the proof' }).click();

  await expect(page).toHaveURL(/#proof/);
  // a fresh dev server compiles Geo Proof on this first visit
  await expect(page.locator('.panel-row')).toHaveCount(2, { timeout: 20_000 });
  expect(server.frameSaves).toHaveLength(1);
});

test('keeps the pill whole and clear of the map at 1280 px', async ({ page }) => {
  const { server } = await openCase(page, { viewport: { width: 1280, height: 800 } });
  const bridge = await openRow(page, 'Road bridge?');
  await panel(page).screenshot({ path: `${SHOTS}/tab-1280.png` });
  await bridge.getByRole('button', { name: 'Geolocate' }).click();
  await expect.poll(() => server.calls).toContain('PUT geolocating');
  await awaitMapReady(page);
  const pill = page.locator('.geo-pill');
  await expect(pill).toBeVisible();
  const box = await pill.boundingBox();
  const bar = await page.locator('.topbar').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height);
  await expect(pill.getByRole('button', { name: 'Make the proof' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/satellite-1280.png` });
});

test('makes the proof when the extension\'s map panel asks, from whichever tool is open', async ({ page }) => {
  const { server } = await openCase(page);
  await page.goto('/#files');
  await expect(page).toHaveURL(/#files/);
  // what the extension's bridge posts into this tab when Make the proof is pressed over Google Maps
  const answer = await page.evaluate(async (scene) => {
    const heard = new Promise((resolve) => {
      window.addEventListener('message', function onMessage(event) {
        if (event.data?.type !== 'scene-proof-result' || event.data.id !== 'scene-1-1') return;
        window.removeEventListener('message', onMessage);
        resolve(event.data);
      });
    });
    window.postMessage({ channel: 'azimut-capture-ext', type: 'scene-proof', id: 'scene-1-1', scene }, location.origin);
    return heard;
  }, { caseId: CASE_ID, video: VIDEO, draft: 'sc_2', id: 'handoff-1' });
  expect(answer).toMatchObject({ ok: true });
  await expect(page).toHaveURL(/#inspect/);
  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  await expect(chooser).toBeVisible();
  await expect(chooser.locator('.scene-line')).toHaveText('0:01');
  await expect(chooser.getByRole('checkbox', { name: 'Capture Bridge from above' })).toBeChecked();
  // nothing was written for it: the chooser asks first
  expect(server.frameSaves).toHaveLength(0);
  expect(server.calls).not.toContain('PUT geolocating');
  await chooser.screenshot({ path: '/tmp/claude-1000/m2h/shots/app-chooser-from-extension-dark.png' });
});
