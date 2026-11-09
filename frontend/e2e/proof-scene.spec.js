import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, showProofTab } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * A proof built on a video. Its Scene tab in the side column says which video it is
 * about and when in it the place shows, plays that, makes a frame of it a panel, and
 * writes the time through its own route, never with a save. A proof made by hand finds
 * the scene still to prove its frames fall in, and its save takes it up. A proof built
 * on no video has no such tab, and looks and exports exactly as it did. `SCENE_SHOTS`
 * names a folder for pictures of the scene found and of Inspect after the save.
 */

const VIDEO = 'media/steps.webm';
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
  </svg>`;

const image = (path, title, source) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256,
  sha256: '0'.repeat(64), source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});
const frame = (path, title, time) => image(path, title, { type: 'inspect', op: 'frame', from: VIDEO, time });

test.use({ viewport: { width: 1500, height: 900 } });

/** The case: the video, two frames Inspect cut from it, and a photo of the same pixels. */
async function openCase(page) {
  const media = [
    { path: VIDEO, filename: 'steps.webm', title: 'Steps', kind: 'video', entity_id: 'e_steps', size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
    frame('media/frame-a.png', 'Frame A', 0.2),
    frame('media/frame-b.png', 'Frame B', 0.96),
    image('media/photo.png', 'Photo', { type: 'upload' }),
  ];
  const fixture = await installAppFixture(page, {
    media,
    // the proof every save answers with, so the composer stays bound to it
    lookupEntities: {
      'proofs/.meta/browser-proof.json': { id: 'browser-proof-entity', type: 'proof', attrs: { spec: 'proofs/.meta/browser-proof.json', path: 'proofs/browser-proof.png' } },
    },
  });
  const scenePuts = [];
  const frameSaves = [];
  // Registered after the fixture, so these answer first.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path.startsWith(`/files/${CASE_ID}/media/`) && path.endsWith('.png')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/scenes`) return json({ video: VIDEO, video_id: 'e_steps', scenes: [] });
    const timed = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timed && request.method() === 'PUT') {
      const body = request.postDataJSON();
      scenePuts.push({ proof: decodeURIComponent(timed[1]), body });
      return json({ proof: timed[1], video: body.video, moments: body.moments, at: [0.2], stated: true, draft: body.draft ?? null });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/save-frames` && request.method() === 'POST') {
      const body = request.postDataJSON();
      frameSaves.push(body);
      const filed = frame(`media/frame-${frameSaves.length + 2}.png`, body.items[0].label, body.items[0].time);
      media.push(filed);
      return json({ saved: [{ item: filed, entity: { id: `e_frame_${frameSaves.length}` } }] });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  // a fresh dev server compiles the app on this first visit
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  return { fixture, scenePuts, frameSaves };
}

/** A new proof of these pictures, through the Create proof dialog. */
async function newProof(page, titles) {
  await page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New proof' })).toBeVisible();
  for (const title of titles) await page.locator('.selectable-pick', { hasText: title }).click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(titles.length);
}

async function saveProof(page, fixture, count) {
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(count);
  await expect(page.locator('.tool-header .badge')).toHaveCount(0);
  return fixture.proofSaves[count - 1];
}

const sceneBlock = (page) => page.getByTestId('scene-block');
const sideTab = (page, name) => page.getByRole('tablist', { name: 'Proof settings' }).getByRole('tab', { name });
const videoState = (page) => page.getByTestId('scene-player').locator('video').evaluate((v) => ({
  paused: v.paused, muted: v.muted, time: v.currentTime,
}));

test('makes the proof of a scene of Inspect on its Proof tab, its player ready, its time written after the first save', async ({ page }) => {
  const { fixture, scenePuts } = await openCase(page);

  // What Inspect's Make the proof hands over (Inspector.svelte), set the way it sets it.
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.proofScene = {
      video: 'media/steps.webm',
      moments: [{ start: 0.2, end: 1 }],
      draft: 's3',
      panels: ['media/frame-a.png', 'media/frame-b.png'],
      label: 'Road bridge?',
    };
  });

  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Road bridge');
  // it opens on its Proof tab, the facts being what is left to do
  await expect(sideTab(page, 'Proof')).toHaveAttribute('aria-selected', 'true');
  // the description is the analyst's sentence, left for them to write
  await expect(page.locator('.desc-input')).toHaveValue('');
  // its player waits on the Scene tab, paused where the scene starts
  expect((await videoState(page)).paused).toBe(true);
  await showProofTab(page, 'Scene');
  const block = sceneBlock(page);
  await expect(block.getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*0:00–0:01/);
  await expect.poll(async () => (await videoState(page)).time).toBeGreaterThanOrEqual(0.19);
  // played, it runs muted, on a loop through its moment
  await expect(block.getByTestId('scene-player')).toBeInViewport();
  await block.getByRole('button', { name: 'Loop the scene' }).click();
  await expect.poll(async () => (await videoState(page)).paused).toBe(false);
  const playing = await videoState(page);
  expect(playing.muted).toBe(true);
  expect(playing.time).toBeGreaterThanOrEqual(0.19);
  await expect(block.getByRole('button', { name: 'Loop the scene' })).toHaveAttribute('aria-pressed', 'true');
  await expect(block.getByTestId('scene-band')).toHaveCount(1);
  await expect(block.locator('.dot')).toHaveCount(2);

  const saved = await saveProof(page, fixture, 1);
  expect(saved.spec).not.toHaveProperty('scene');
  expect(saved.spec).not.toHaveProperty('sceneBadge');
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0]).toEqual({
    proof: 'browser-proof',
    body: { moments: [{ start: 0.2, end: 1 }], video: VIDEO, draft: 's3' },
  });
});

test('makes the proof of a picture marked to geolocate with no scene, the picture its first panel', async ({ page }) => {
  const { fixture, scenePuts } = await openCase(page);

  // What Inspect's Make the proof hands over for a picture (`lib/sceneFrames.js`).
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.proofScene = { picture: 'media/photo.png', panels: ['media/photo.png', 'media/frame-a.png'], label: 'Market?' };
  });

  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Market');
  await expect(sideTab(page, 'Proof')).toHaveAttribute('aria-selected', 'true');
  // its time is nobody's: the frame beside it brings a Scene tab of its own, stating nothing
  const saved = await saveProof(page, fixture, 1);
  expect(saved.spec.panels.map((panel) => panel.src)).toEqual(['media/photo.png', 'media/frame-a.png']);
  expect(saved.spec).not.toHaveProperty('scene');
  await page.waitForTimeout(300);
  expect(scenePuts).toEqual([]);
});

test('changes the time of a saved proof at once, adds a frame of its player, and prints it only when asked', async ({ page }) => {
  const { fixture, scenePuts, frameSaves } = await openCase(page);
  await newProof(page, ['Frame A']);
  const block = sceneBlock(page);
  await expect(block.getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);
  const plain = await saveProof(page, fixture, 1);
  expect(scenePuts).toEqual([]);

  // The time, opened on the player in the Scene tab: an instant at the frame on screen.
  await showProofTab(page, 'Scene');
  await block.getByRole('button', { name: 'Time of the scene, Whole video' }).click();
  await expect(block.getByTestId('scene-player')).toBeVisible();
  await block.getByRole('radio', { name: 'Instant' }).click();
  await block.locator('input[aria-label="Scene start"]').fill('0:00.2');
  await block.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0].body).toEqual({ moments: [{ start: 0.2, end: null }], video: VIDEO });
  await expect(page.getByText('Scene now at 0:00')).toBeVisible();
  await expect(block.getByTestId('scene-video')).toHaveText(/·\s*0:00/);
  // stating a time is no edit of the picture while nothing prints it
  await expect(page.locator('.tool-header .badge')).toHaveCount(0);

  // A frame of the player a second on, made a panel.
  await block.getByRole('button', { name: 'Forward one frame' }).click({ modifiers: ['Shift'] });
  await expect(block.locator('.clock')).toContainText('0:01.');
  await block.getByRole('button', { name: 'Add this frame' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(2);
  expect(frameSaves).toHaveLength(1);
  expect(frameSaves[0].items[0].path).toBe(VIDEO);
  expect(frameSaves[0].items[0].time).toBeGreaterThan(1);
  expect(frameSaves[0].items[0].label).toBe('00-00-01 Steps');
  // the new panel's frame is outside the instant, which says so
  await expect(block.locator('.outside')).toContainText('1 panel is outside these passages');
  await block.getByRole('button', { name: 'Add its passage' }).click();
  await expect.poll(() => scenePuts.length).toBe(2);
  expect(scenePuts[1].body.moments).toHaveLength(2);
  await expect(block.locator('.outside')).toHaveCount(0);
  const two = await saveProof(page, fixture, 2);

  // The time on the picture: off by default, printed when asked, gone again byte for byte.
  await showProofTab(page, 'Style');
  const badge = page.getByRole('checkbox', { name: 'Scene time on the picture' });
  await expect(badge).not.toBeChecked();
  await badge.check();
  const printed = await saveProof(page, fixture, 3);
  expect(printed.spec.sceneBadge).toBe(true);
  expect(printed.png_base64).not.toBe(two.png_base64);
  await badge.uncheck();
  const again = await saveProof(page, fixture, 4);
  expect(again.spec).not.toHaveProperty('sceneBadge');
  expect(again.png_base64).toBe(two.png_base64);
  expect(plain.png_base64).not.toBe(two.png_base64); // two panels against one
});

test('leaves a proof built on no video as it was, and keeps the player\'s marks out of every export', async ({ page }) => {
  const { fixture } = await openCase(page);
  await newProof(page, ['Photo']);
  await expect(sceneBlock(page)).toHaveCount(0);
  await expect(sideTab(page, 'Scene')).toHaveCount(0);
  await showProofTab(page, 'Style');
  await expect(page.getByText('Scene time on the picture')).toHaveCount(0);
  const photo = await saveProof(page, fixture, 1);
  expect(photo.spec).not.toHaveProperty('scene');
  expect(photo.spec).not.toHaveProperty('sceneBadge');

  // the same pixels as a frame of the video: a ▶ on the canvas, nothing in the picture
  await newProof(page, ['Frame A']);
  await expect(sceneBlock(page)).toHaveCount(1);
  const framed = await saveProof(page, fixture, 2);
  expect(framed.png_base64).toBe(photo.png_base64);
});

test('opens a new proof on Layout, marks the Proof tab while it needs facts, and the canvas\'s ▶ opens Scene', async ({ page }) => {
  const { fixture } = await openCase(page);
  // a saved proof to switch to, which keeps the tab in use
  await page.route(`**/api/cases/${CASE_ID}/proofs`, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: [{ name: 'kept', title: 'Kept proof', spec_path: 'proofs/.meta/kept.json', updated_at: '2026-10-01T10:00:00Z' }] })
    : route.fallback()));
  await page.route(`**/api/cases/${CASE_ID}/proofs/kept`, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { title: 'Kept proof', panels: [], pastes: [], shapes: [] } })
    : route.fallback()));

  await newProof(page, ['Frame A']);
  await expect(sideTab(page, 'Layout')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Layout' }).locator('.panel-row')).toBeVisible();
  // a frame of a video brings the Scene tab, between the facts and the layout
  await expect(page.getByRole('tablist', { name: 'Proof settings' }).getByRole('tab')).toHaveText([/^Proof/, 'Scene', 'Layout', 'Style']);
  // the blanks the Proof tab marks with a ! are said on its label, from any tab
  const needs = sideTab(page, 'Proof').getByTestId('proof-tab-needs');
  await expect(needs).toHaveAttribute('aria-label', 'Still needs coordinates and a source');
  await showProofTab(page, 'Proof');
  await page.locator('.point-row').first().locator('.meta-input').fill('48.858400, 2.294500');
  await expect(needs).toHaveAttribute('aria-label', 'Still needs a source');

  // the arrows walk the tabs, and the Scene tab opens its player paused on the scene
  await sideTab(page, 'Proof').focus();
  await page.keyboard.press('ArrowRight');
  await expect(sideTab(page, 'Scene')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Scene')).toBeFocused();
  await expect(sceneBlock(page).getByTestId('scene-player')).toBeVisible();
  expect((await videoState(page)).paused).toBe(true);

  // played, then left: nothing plays where nobody sees it
  await sceneBlock(page).getByRole('button', { name: 'Loop the scene' }).click();
  await expect.poll(async () => (await videoState(page)).paused).toBe(false);
  await showProofTab(page, 'Layout');
  await expect.poll(async () => (await videoState(page)).paused).toBe(true);

  // the ▶ in the panel's corner on the canvas shows the Scene tab, on that panel's frame
  const play = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const rect = stage.findOne('.scene-play').getClientRect();
    const box = stage.container().getBoundingClientRect();
    return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
  });
  await page.mouse.click(play.x, play.y);
  await expect(sideTab(page, 'Scene')).toHaveAttribute('aria-selected', 'true');
  await expect(sceneBlock(page).locator('.clock')).toContainText('0:00.2');

  // another proof opens on the tab in use; without a video, Scene gives way to Layout
  await showProofTab(page, 'Style');
  await saveProof(page, fixture, 1);
  await page.locator('.tool-header').getByRole('button', { name: 'Open proof' }).click();
  await page.locator('.open-row', { hasText: 'Kept proof' }).click();
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Kept proof');
  await expect(sideTab(page, 'Style')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Scene')).toHaveCount(0);
});


test('puts a point of a proof made from a scene in a layer, saving it first, even as the save writes its time', async ({ page }) => {
  const { scenePuts } = await openCase(page);
  const LAYERS = [{ name: 'front', title: 'Front', markers: [], styles: [], groups: [
    { id: 'g1', name: 'Positions', mode: 'individual', colour: '#0072b2', symbol: 'pin' }] }];
  await page.route(`**/api/cases/${CASE_ID}/layer-targets**`, (route) => route.fulfill({ json: LAYERS }));
  const linked = [];
  await page.route(`**/api/cases/${CASE_ID}/map-layers/front/links`, (route) => {
    linked.push(route.request().postDataJSON());
    return route.fulfill({ json: { key: 'mk_1', lat: 48.8584, lon: 2.2945 } });
  });

  await page.evaluate(async () => {
    const { uiState, caseState } = await import('/src/lib/state.svelte.js');
    uiState.proofScene = {
      video: 'media/steps.webm', moments: [{ start: 0.2, end: 1 }], draft: 's3',
      panels: ['media/frame-a.png', 'media/frame-b.png'], label: 'Road bridge?',
    };
    // the layers were read when the case opened, before this case had any
    caseState.rev += 1;
  });
  await expect(page.locator('.panel-row')).toHaveCount(2);
  await page.locator('.point-row').first().locator('.meta-input').fill('48.858400, 2.294500');

  // never saved: the point's menu saves the proof, then puts its point in the layer
  await page.getByRole('button', { name: 'Point 1 actions', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Point 1 actions', exact: true });
  await menu.getByRole('button', { name: 'Front', exact: true }).click();
  // a layer of one group goes straight to the marker's look
  await menu.getByRole('button', { name: 'Add to Front', exact: true }).click();

  // the save wrote the scene's time, and the point still joined the layer
  await expect.poll(() => scenePuts.length).toBe(1);
  await expect.poll(() => linked.length).toBe(1);
});

// -- a proof made by hand finds its scene by its frames ------------------------------------

/**
 * The clip with two scenes still to prove in Inspect: Bridge? from 0:00.1 to 0:01, which
 * holds frames A and B, and Tower?, an instant on frame C. With `older`, a proof made by
 * hand before, on frame B, stating nothing. The server is faked the way it answers:
 * a proof's scene written through its route takes the draft up, which `/scenes` then
 * hides, and Inspect lists the proof in its place.
 */
async function openClip(page, { older = false } = {}) {
  const media = [
    { path: VIDEO, filename: 'steps.webm', title: 'Steps', kind: 'video', entity_id: 'e_steps', size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
    frame('media/frame-a.png', 'Frame A', 0.2),
    frame('media/frame-b.png', 'Frame B', 0.96),
    frame('media/frame-c.png', 'Frame C', 1.12),
  ];
  const drafts = [
    { id: 's1', start: 0.1, end: 1, label: 'Bridge?' },
    { id: 's2', start: 1.12, end: null, label: 'Tower?' },
  ];
  const proofs = {};
  if (older) {
    proofs.lookout = {
      azimut_proof: 1, ink: 'page', title: 'Lookout', pastes: [], shapes: [], notes: {}, legendOrder: [], material: [],
      panels: [{ id: 'p1', src: 'media/frame-b.png', caption: '', row: 0, scale: 1, natural: [640, 360] }],
      points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null,
    };
  }
  const fixture = await installAppFixture(page, {
    media,
    lookupEntities: Object.fromEntries(['road-bridge', 'lookout', 'proof-1', 'proof-2'].map((name) => [`proofs/.meta/${name}.json`, {
      id: `e_${name}`, type: 'proof', attrs: { spec: `proofs/.meta/${name}.json`, path: `proofs/${name}.png` },
    }])),
  });
  const scenePuts = [];
  const saves = [];
  const timeOf = (src) => media.find((m) => m.path === src)?.source?.time;
  const proofRow = (name) => {
    const spec = proofs[name];
    const placed = spec.points.some((p) => String(p.coords ?? '').trim());
    return {
      kind: 'proof', proof: name, proof_id: `e_${name}`, title: spec.title, video: VIDEO,
      moments: spec.scene?.moments ?? [], at: spec.panels.map((p) => timeOf(p.src)).filter((t) => t != null).sort(),
      stated: !!spec.scene, draft: spec.scene?.draft ?? null, points: [], state: placed ? 'proved' : 'progress', abandoned: null,
      png: `proofs/${name}.png`, thumb: null, when: null, when_zone: null, description: null,
    };
  };
  const draftRow = (d) => ({ kind: 'draft', video: VIDEO, ...d, state: 'todo', captures: [], abandoned: null, file_kind: 'video' });
  const answer = () => {
    const taken = new Set(Object.values(proofs).map((spec) => spec.scene?.draft).filter(Boolean));
    const rows = [...Object.keys(proofs).map(proofRow), ...drafts.filter((d) => !taken.has(d.id)).map(draftRow)];
    const start = (s) => (s.kind === 'draft' ? s.start : s.moments[0]?.start ?? s.at[0] ?? Infinity);
    return {
      video: VIDEO, video_id: 'e_steps', scenes: rows.sort((a, b) => start(a) - start(b)), used: {},
      taken: drafts.filter((d) => taken.has(d.id)).map((d) => d.id), geolocating: null, collages: [],
    };
  };
  const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path.startsWith(`/files/${CASE_ID}/`) && /\.(png|webp)$/.test(path)) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/scenes`) return json(answer());
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) {
      const open = answer().scenes.filter((s) => s.kind === 'draft');
      return json({ files: open.length ? [{ video: VIDEO, title: 'Steps', kind: 'video', scenes: open }] : [], geolocating: null });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'GET') {
      // the drafts stay in the work: a proof taking one up hides it, never drops it
      return json({ work: { name: 'Work', title: 'Work', spec: {
        source: { path: VIDEO, kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: [], marks: [], scenes: drafts, activeFrameId: null,
      } } });
    }
    if (path === `/api/cases/${CASE_ID}/proofs` && method === 'POST') {
      const payload = request.postDataJSON();
      saves.push(payload);
      const name = payload.rename_from ?? slug(payload.title);
      proofs[name] = { ...payload.spec, scene: proofs[name]?.scene };
      return json({ id: `e_${name}`, name, title: payload.title, png: `proofs/${name}.png` });
    }
    const one = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)$/.exec(path);
    if (one && method === 'GET' && proofs[decodeURIComponent(one[1])]) return json(proofs[decodeURIComponent(one[1])]);
    const timed = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timed && method === 'PUT') {
      const body = request.postDataJSON();
      const name = decodeURIComponent(timed[1]);
      scenePuts.push({ proof: name, body });
      proofs[name].scene = { video: body.video, moments: body.moments, draft: body.draft ?? null };
      return json({ proof: name, video: body.video, moments: body.moments, at: [], stated: true, draft: body.draft ?? null });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  return { fixture, scenePuts, saves, proofs };
}

const matchLine = (page) => sceneBlock(page).getByTestId('scene-match');
const stripTiles = (page) => page.getByRole('region', { name: 'Slides of the video' }).getByRole('listbox', { name: 'Slides' }).getByRole('option');
/** What the server says after a save or a scene change: the strip reads its video again. */
const nudge = (page) => page.evaluate(async (caseId) => {
  const { dispatch } = await import('/src/lib/events.js');
  dispatch({ type: 'scenes', case_id: caseId, video: null });
}, CASE_ID);

async function saveClip(page, saves, count) {
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => saves.length).toBe(count);
  await expect(page.locator('.tool-header .badge')).toHaveCount(0);
  return saves[count - 1];
}

/** A picture of the screen at 1280×720, dark and light, when a folder is named for them. */
const SHOTS = process.env.SCENE_SHOTS;
async function shoot(page, name) {
  if (!SHOTS) return;
  const theme = (wanted) => page.evaluate(async (which) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(which);
  }, wanted);
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 720 });
  await theme('dark');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await theme('light');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await theme('dark');
  await page.setViewportSize(size);
  await page.waitForTimeout(350);
}

test('ties a proof made by hand to the scene still to prove its frames fall in, and its save takes it up, so Inspect lists one row', async ({ page }) => {
  const { scenePuts, saves } = await openClip(page);
  await newProof(page, ['Frame A', 'Frame B']);
  await page.getByRole('textbox', { name: 'Proof name' }).fill('Road bridge');
  await showProofTab(page, 'Proof');
  await page.locator('.point-row').first().locator('.meta-input').fill('48.858400, 2.294500');

  // the slide not saved yet stands where Bridge? stood on the strip
  await expect(stripTiles(page)).toHaveCount(2);
  await expect(stripTiles(page).locator('.tile-title')).toHaveText(['Road bridge', 'Tower?']);
  await expect(stripTiles(page).nth(0)).toHaveAttribute('aria-selected', 'true');

  // the Scene tab names the scene under the ★ field, its time in the field
  await showProofTab(page, 'Scene');
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*0:00–0:01/);
  await expect(matchLine(page)).toHaveText(/Bridge\?\s*·\s*found by its frames\s*Not this scene/);
  await expect(matchLine(page).getByRole('button', { name: 'Not this scene' })).toBeVisible();
  await page.mouse.move(0, 0);
  await shoot(page, 'scene-match');

  // the first save takes the scene up through the scene's own route, as Make the proof does
  const saved = await saveClip(page, saves, 1);
  expect(saved.spec).not.toHaveProperty('scene');
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0]).toEqual({ proof: 'road-bridge', body: { moments: [{ start: 0.1, end: 1 }], video: VIDEO, draft: 's1' } });
  await expect(matchLine(page)).toHaveCount(0);
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*0:00–0:01/);
  await nudge(page);
  await expect(stripTiles(page).locator('.tile-title')).toHaveText(['Road bridge', 'Tower?']);

  // Inspect: one row for the bridge, the proof, and the scene still to prove after it
  await page.goto('/#inspect');
  await page.locator('.card', { hasText: 'Steps' }).click();
  const rows = page.getByRole('tabpanel', { name: 'Scenes' }).getByTestId('scene-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Road bridge');
  await expect(rows.nth(0)).toContainText('Proved');
  // Tower? is open, its label in its field
  await expect(rows.nth(1)).toHaveAttribute('data-scene-key', 's2');
  await expect(page.getByRole('tabpanel', { name: 'Scenes' })).not.toContainText('Bridge?');
  await page.mouse.move(0, 0);
  await shoot(page, 'inspect-after-save');
});

test('leaves a proof made by hand apart with Not this scene, and says nothing of frames in two scenes', async ({ page }) => {
  const { scenePuts, saves } = await openClip(page);
  await newProof(page, ['Frame A']);
  await showProofTab(page, 'Scene');
  await expect(matchLine(page)).toContainText('Bridge?');
  await matchLine(page).getByRole('button', { name: 'Not this scene' }).click();
  await expect(matchLine(page)).toHaveCount(0);
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);
  // the strip keeps Bridge? to geolocate, the new slide after the scenes
  await expect(stripTiles(page).locator('.tile-title')).toHaveText(['Bridge?', 'Tower?', /^Proof/]);

  // saved, it states no scene, and the refusal holds for this proof once listed
  const saved = await saveClip(page, saves, 1);
  expect(saved.spec).not.toHaveProperty('scene');
  await nudge(page);
  await expect(stripTiles(page)).toHaveCount(3);
  await expect(matchLine(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(scenePuts).toEqual([]);

  // frames in Bridge? and on Tower? are in two scenes: nothing is said, nothing tied
  await newProof(page, ['Frame A', 'Frame C']);
  await showProofTab(page, 'Scene');
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);
  await expect(matchLine(page)).toHaveCount(0);
  await saveClip(page, saves, 2);
  await page.waitForTimeout(300);
  expect(scenePuts).toEqual([]);
});

test('names the scene of an older proof made by hand, and writes nothing until it is saved', async ({ page }) => {
  const { scenePuts, saves } = await openClip(page, { older: true });
  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = 'lookout';
  });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Lookout');
  await showProofTab(page, 'Scene');
  await expect(matchLine(page)).toHaveText(/Bridge\?\s*·\s*found by its frames/);
  // opening it is no change: nothing to save, nothing written
  await expect(page.locator('.tool-header .badge')).toHaveCount(0);
  await expect(stripTiles(page).locator('.tile-title')).toHaveText(['Lookout', 'Tower?']);
  await page.waitForTimeout(300);
  expect(scenePuts).toEqual([]);

  await saveClip(page, saves, 1);
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0]).toEqual({ proof: 'lookout', body: { moments: [{ start: 0.1, end: 1 }], video: VIDEO, draft: 's1' } });
});
