import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * How Geo Proof starts, and how a proof is opened and deleted: the New proof window
 * (sources, large pictures, the scenes still to prove), the home shown with no proof
 * open, the delete of the open proof that asks what becomes of its scene, the Open
 * proof list that tags a proof of a video, and a slide's own menu. Without scenes,
 * everything is what it was: a proof is New proof, a picture, Create proof.
 */

const VIDEO = 'media/clip.webm';
/** What Media calls the video, which every surface names it by. */
const TITLE = 'Quay steps';
const svg = (fill, ground) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="${fill}"/>
    <path d="M0 290L170 160L310 250L460 110L640 270V360H0Z" fill="${ground}"/>
  </svg>`;
const PICTURES = {
  'frame-a': svg('#304b65', '#6c8f55'), 'frame-b': svg('#5a4632', '#a3814f'), 'frame-c': svg('#2f4f4f', '#7aa37a'),
  'frame-d': svg('#3d3355', '#8f7fb8'), photo: svg('#555', '#aaa'), sat: svg('#2e3b2a', '#6b7d4f'),
  bridge: svg('#304b65', '#8a9a6a'), market: svg('#5a4632', '#c4a066'), holiday: svg('#444', '#999'),
};

const image = (path, title, source, extra = {}) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256, sha256: '0'.repeat(64),
  source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '', added_at: '2026-11-01T10:00:00Z', ...extra,
});
const frame = (name, time) => image(`media/${name}.png`, name, { type: 'inspect', op: 'frame', from: VIDEO, time });
const panel = (id, src) => ({ id, src, caption: '', row: 0, scale: 1, natural: [640, 360] });
const spec = (title, panels, extra = {}) => ({
  azimut_proof: 1, ink: 'page', title, panels, pastes: [], shapes: [], notes: {}, legendOrder: [],
  points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null, material: [], ...extra,
});

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * A case of one video holding two proofs (Road bridge, made from a scene, and Market),
 * a scene still to prove (Water tower?), a satellite capture and a photo proved apart.
 * `empty` is a case holding nothing; `scenes: false` one with no scene to prove; `gate.wait`
 * holds the answer of the proofs list while it is set.
 */
async function openCase(page, { empty = false, scenes = true, gate = null } = {}) {
  const media = empty ? [] : [
    { path: VIDEO, filename: 'clip.webm', title: TITLE, kind: 'video', entity_id: 'e_clip', size: STEPS_WEBM.length, sha256: '1'.repeat(64),
      source: { type: 'upload' }, thumbnail: null, folder: '' },
    frame('frame-a', 0.2), frame('frame-b', 0.5), frame('frame-d', 0.64),
    image('media/photo.png', 'Harbour photo', { type: 'upload' }, { folder: 'field' }),
  ];
  const satCaptures = empty ? [] : [{
    ...image('captures/sat.png', 'Capture', { type: 'satellite' }), lat: 48.8584, lon: 2.2945, zoom: 17, provider_label: 'Esri',
    attribution: 'Esri', fetched_at: '2026-11-02T09:00:00Z', imagery_date: null,
  }];
  const proofs = empty ? {} : {
    bridge: spec('Road bridge', [panel('p1', 'media/frame-a.png')], { scene: { video: VIDEO, moments: [{ start: 0.1, end: 0.3 }], draft: 's0' },
      points: [{ coords: '48.858400, 2.294500', label: '', pov: false }] }),
    market: spec('Market', [panel('p2', 'media/frame-b.png')]),
    holiday: spec('Holiday', [panel('p3', 'media/photo.png')]),
  };
  const onVideo = empty ? [] : ['bridge', 'market'];
  const drafts = empty || !scenes ? [] : [
    { kind: 'draft', video: VIDEO, id: 's1', start: 0.6, end: 0.8, label: 'Water tower?', state: 'progress', captures: ['captures/sat.png'], abandoned: null },
  ];
  const lookupEntities = Object.fromEntries(Object.keys(proofs).map((name) => [`proofs/.meta/${name}.json`, {
    id: `e_${name}`, type: 'proof', label: proofs[name].title, attrs: { spec: `proofs/.meta/${name}.json`, path: `proofs/${name}.png` },
  }]));
  const catalog = Object.values(lookupEntities).map((entity) => ({ ...entity, provenance: {} }));
  const fixture = await installAppFixture(page, { media, satCaptures, lookupEntities, catalog });
  const saves = [];
  const deletes = [];
  const frameSaves = [];
  const proofReads = [];
  const updated = { bridge: '2026-11-08T09:00:00Z', market: '2026-11-07T09:00:00Z', holiday: '2026-11-06T09:00:00Z' };
  const at = (name) => proofs[name].panels.map((p) => media.find((m) => m.path === p.src)?.source?.time).filter((t) => t != null);
  const row = (name) => ({
    kind: 'proof', proof: name, proof_id: `e_${name}`, title: proofs[name].title, video: VIDEO,
    moments: proofs[name].scene?.moments ?? [], at: at(name), stated: !!proofs[name].scene, draft: proofs[name].scene?.draft ?? null,
    points: [], png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp`, when: null, when_zone: null, description: null,
    state: name === 'bridge' ? 'proved' : 'progress', abandoned: null,
  });
  const start = (s) => (s.kind === 'draft' ? s.start ?? -1 : s.moments[0]?.start ?? s.at[0] ?? Infinity);
  const answer = () => ({
    video: VIDEO, video_id: 'e_clip', used: {}, taken: [], geolocating: null, collages: [],
    scenes: [...onVideo.map(row), ...drafts].sort((a, b) => start(a) - start(b)),
  });
  /** The saved proofs as `GET /proofs` lists them, newest first, a proof of the video tagged. */
  const listed = () => {
    const names = Object.keys(proofs).sort((a, b) => (updated[b] ?? '').localeCompare(updated[a] ?? ''));
    return names.map((name) => {
      const slide = onVideo.indexOf(name);
      return {
        name, title: proofs[name].title, updated_at: updated[name] ?? '2026-11-09T09:00:00Z', panels: proofs[name].panels.length, shapes: 0,
        points: [], png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp`, spec_path: `proofs/.meta/${name}.json`,
        ...(slide >= 0 ? { video: VIDEO, video_title: TITLE, order: slide === 0 ? 0 : 1, slide: slide + 1, slides: onVideo.length } : { video: null }),
      };
    });
  };
  const queue = () => ({
    files: drafts.length ? [{ video: VIDEO, title: TITLE, kind: 'video', scenes: drafts.map((d) => ({ ...d, file_kind: 'video', order: 2 })), proofs: [] }] : [],
    geolocating: null,
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    const picture = /\/([a-z0-9-]+)\.(png|webp|jpg)$/.exec(path);
    if (path.startsWith(`/files/${CASE_ID}/`) && picture) {
      return route.fulfill({ contentType: 'image/svg+xml', body: PICTURES[picture[1]] ?? svg('#3a3a3a', '#8a9a6a') });
    }
    if (path === `/api/cases/${CASE_ID}/entities/lookup`) {
      const name = /^proofs\/\.meta\/(.+)\.json$/.exec(url.searchParams.get('value') ?? '')?.[1];
      if (name && proofs[name]) {
        return json({ entity: { id: `e_${name}`, type: 'proof', label: proofs[name].title, attrs: { spec: `proofs/.meta/${name}.json` } } });
      }
      return route.fallback();
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) return json(queue());
    if (path === `/api/cases/${CASE_ID}/scenes`) return url.searchParams.get('video') === VIDEO ? json(answer()) : json({ detail: 'no' }, 400);
    if (/^\/api\/cases\/[^/]+\/scenes\/[^/]+\/frames$/.test(path)) {
      return json({ frames: [{ id: 'f1', time: 0.64, path: 'media/frame-d.png', thumb: null }, { id: 'f2', time: 0.72, path: null, thumb: null }] });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) return route.fulfill({ contentType: 'image/svg+xml', body: PICTURES['frame-d'] });
    if (path === `/api/cases/${CASE_ID}/inspect/save-frames` && request.method() === 'POST') {
      const body = request.postDataJSON();
      frameSaves.push(body);
      const saved = body.items.map((item, i) => {
        const filed = frame(`frame-n${frameSaves.length}${i}`, item.time);
        media.push(filed);
        return { item: filed, entity: { id: `e_filed_${frameSaves.length}_${i}` } };
      });
      return json({ saved });
    }
    if (path === `/api/cases/${CASE_ID}/proofs` && request.method() === 'GET') {
      proofReads.push(Date.now());
      if (gate?.wait) await gate.wait;
      return json(listed());
    }
    const one = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)$/.exec(path);
    if (one && request.method() === 'GET') {
      const name = decodeURIComponent(one[1]);
      return proofs[name] ? json(proofs[name]) : json({ detail: 'no such proof' }, 404);
    }
    if (one && request.method() === 'DELETE') {
      const name = decodeURIComponent(one[1]);
      deletes.push({ name, scene: url.searchParams.get('scene') ?? 'keep' });
      delete proofs[name];
      onVideo.splice(onVideo.indexOf(name), onVideo.includes(name) ? 1 : 0);
      return json({ status: 'deleted', deleted: [`e_${name}`], tombstoned: [], trash: `t_${name}`, scene: url.searchParams.get('scene') ?? 'keep', dropped: [] });
    }
    if (/^\/api\/cases\/[^/]+\/proofs\/[^/]+\/scene$/.test(path) && request.method() === 'PUT') {
      const name = decodeURIComponent(path.split('/').at(-2));
      const body = request.postDataJSON();
      if (proofs[name]) proofs[name].scene = { video: body.video, moments: body.moments, draft: body.draft ?? null };
      if (!onVideo.includes(name)) onVideo.push(name);
      return json({ proof: name, video: body.video, moments: body.moments, at: [], stated: true, draft: body.draft ?? null });
    }
    if (path === `/api/cases/${CASE_ID}/proofs` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      saves.push(payload);
      const name = payload.rename_from && payload.title.toLowerCase() !== payload.rename_from
        ? payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : payload.rename_from ?? payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (payload.rename_from && payload.rename_from !== name) {
        proofs[name] = { ...payload.spec, title: payload.title };
        delete proofs[payload.rename_from];
        const at = onVideo.indexOf(payload.rename_from);
        if (at >= 0) onVideo[at] = name;
      } else {
        proofs[name] = { ...payload.spec, title: payload.title, scene: proofs[name]?.scene };
      }
      return json({ id: `e_${name}`, name, title: payload.title, png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp` });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  return { fixture, saves, deletes, frameSaves, proofReads, proofs, drafts, onVideo };
}

const header = (page) => page.locator('.tool-header');
const newProof = (page) => page.getByRole('dialog', { name: 'New proof' });
const proofName = (page) => page.getByRole('textbox', { name: 'Proof name' });

async function openNewProof(page) {
  await header(page).getByRole('button', { name: 'New proof', exact: true }).click();
  await expect(newProof(page)).toBeVisible();
  await expect(newProof(page).locator('.np-tile').first()).toBeVisible();
}

// -- New proof ------------------------------------------------------------------------------

test('New proof the old way: a picture and Create proof, in three presses', async ({ page }) => {
  const { fixture } = await openCase(page, { scenes: false });
  await openNewProof(page);
  const dialog = newProof(page);
  // All is where it opens, every source the case holds counted, and no scene in a case with none
  await expect(dialog.locator('.np-row.on')).toContainText('All');
  await expect(dialog.locator('.np-from .np-row')).toHaveText([/All\s*5/, /Satellite\s*1/, /Videos\s*3/, /Photos\s*1/, /field/]);
  await expect(dialog.getByText('Scenes to prove')).toHaveCount(0);

  await dialog.locator('.selectable-pick', { hasText: 'Harbour photo' }).click();
  await dialog.locator('.selectable-pick', { hasText: 'z17' }).click();
  await expect(dialog.locator('.np-chip')).toHaveCount(2);
  await expect(dialog.locator('.selectable-pick', { hasText: 'Harbour photo' }).locator('.np-mark')).toHaveText('1');
  await dialog.getByRole('button', { name: 'Create proof' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(proofName(page)).toBeVisible();
  await expect(page.locator('.panel-row')).toHaveCount(2);
  // laid out in the order pressed
  await expect(page.locator('.panel-row .panel-thumb img').first()).toHaveAttribute('src', /photo\.png$/);
  fixture.expectNoUnexpectedRequests();
});

test('New proof reorders the panels by a drag or the keys, and takes one out', async ({ page }) => {
  await openCase(page, { scenes: false });
  await openNewProof(page);
  const dialog = newProof(page);
  for (const name of ['Harbour photo', 'frame-a', 'frame-b']) await dialog.locator('.selectable-pick', { hasText: name }).click();
  const chips = dialog.locator('.np-chip');
  const order = () => chips.evaluateAll((all) => all.map((chip) => chip.getAttribute('aria-label').split(': ')[1]));
  await expect.poll(order).toEqual(['Harbour photo', 'frame-a', 'frame-b']);

  await chips.nth(2).dragTo(chips.nth(0));
  await expect.poll(order).toEqual(['frame-b', 'Harbour photo', 'frame-a']);
  await chips.nth(0).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(order).toEqual(['Harbour photo', 'frame-b', 'frame-a']);
  await expect(chips.nth(1)).toBeFocused();
  await page.keyboard.press('Delete');
  await expect.poll(order).toEqual(['Harbour photo', 'frame-a']);
  await chips.nth(1).hover();
  await dialog.getByRole('button', { name: 'Take panel 2 out' }).click();
  await expect.poll(order).toEqual(['Harbour photo']);

  await dialog.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(1);
});

test('New proof keeps the keyboard: the search first, Enter creates, Escape closes', async ({ page }) => {
  await openCase(page, { scenes: false });
  await openNewProof(page);
  const dialog = newProof(page);
  await expect(dialog.getByRole('textbox', { name: 'Search pictures' })).toBeFocused();
  await page.keyboard.type('harbour');
  await expect(dialog.locator('.np-tile')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await openNewProof(page);
  await page.keyboard.press('Enter');
  await expect(newProof(page)).toHaveCount(0);
  await expect(proofName(page)).toBeVisible();
  await expect(page.locator('.panel-row')).toHaveCount(0);
});

test('New proof shows each video as a block of its frames', async ({ page }) => {
  await openCase(page, { scenes: false });
  await openNewProof(page);
  const dialog = newProof(page);
  await dialog.locator('.np-from .np-row', { hasText: 'Videos' }).click();
  await expect(dialog.locator('.np-video h5')).toHaveText([TITLE]);
  await expect(dialog.locator('.np-video .np-count')).toHaveText('3 frames');
  await expect(dialog.locator('.np-tile .np-time')).toHaveText(['0:00.2', '0:00.5', '0:00.6']);
});

test('New proof from a scene: its material all ticked, and the proof takes the scene up', async ({ page }) => {
  const { frameSaves } = await openCase(page);
  await openNewProof(page);
  const dialog = newProof(page);
  const scenes = dialog.getByRole('list', { name: 'Scenes to prove' });
  await expect(scenes.locator('.np-scene-name')).toHaveText(['Water tower?']);
  await expect(scenes.locator('.np-scene-said')).toHaveText(`0:00–0:00 · ${TITLE}`);

  await scenes.locator('.np-scene').click();
  // its frame in the case, the one not in it drawn for the choice, and the capture it gathered
  await expect(dialog.locator('.np-tile')).toHaveCount(3);
  await expect(dialog.locator('.np-tile.selected')).toHaveCount(3);
  await expect(dialog.locator('.np-takes')).toContainText('Water tower?');
  await dialog.getByRole('button', { name: 'Create proof' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.panel-row')).toHaveCount(3);
  expect(frameSaves).toHaveLength(1);
  expect(frameSaves[0].items).toEqual([expect.objectContaining({ path: VIDEO, time: 0.72 })]);
  // named after the scene, on the Proof tab as Make the proof opens one, in the scene's place on the strip
  await expect(proofName(page)).toHaveValue('Water tower');
  await expect(page.getByRole('tablist', { name: 'Proof settings' }).getByRole('tab', { name: /Proof/ })).toHaveAttribute('aria-selected', 'true');
  const strip = page.getByRole('region', { name: 'Slides of the video' });
  await expect(strip.getByRole('option').nth(2)).toHaveText(/Water tower\s*Not saved/);
});

// -- Open proof ---------------------------------------------------------------------------

test('Open proof tags a proof of a video and filters by video, a proof on photos as before', async ({ page }) => {
  await openCase(page);
  await header(page).getByRole('button', { name: 'Open proof' }).click();
  const list = page.getByRole('dialog', { name: 'Open a saved proof' });
  await expect(list.locator('.open-title')).toHaveText(['Road bridge', 'Market', 'Holiday']);
  // the video by the title Media gives it, never its file name
  await expect(list.locator('.open-slide')).toHaveText([`${TITLE} · slide 1 of 2`, `${TITLE} · slide 2 of 2`]);
  await expect(list.locator('.open-row-wrap', { hasText: 'Holiday' }).locator('.open-slide')).toHaveCount(0);
  await expect(list.locator('.open-row-wrap', { hasText: 'Holiday' }).locator('.open-sub')).toHaveText('1 panel · 0 annotations · 2026-11-06');

  const video = list.getByRole('combobox', { name: 'Video' });
  await video.selectOption({ label: `${TITLE} · 2` });
  await expect(list.locator('.open-title')).toHaveText(['Road bridge', 'Market']);
  await video.selectOption({ label: 'On no video · 1' });
  await expect(list.locator('.open-title')).toHaveText(['Holiday']);
  await video.selectOption({ label: 'Every video' });
  await list.locator('.open-row', { hasText: 'Market' }).click();
  await expect(proofName(page)).toHaveValue('Market');
});

test('Open proof deletes a row as the header does, its scene asked about, and the list stays', async ({ page }) => {
  const { deletes } = await openCase(page);
  await header(page).getByRole('button', { name: 'Open proof' }).click();
  const list = page.getByRole('dialog', { name: 'Open a saved proof' });
  await list.locator('.open-row-wrap', { hasText: 'Market' }).getByTitle('Delete this saved proof').click();
  const ask = page.getByRole('alertdialog', { name: 'Delete this proof?' });
  await expect(ask.getByRole('radio', { name: 'Goes back to To geolocate' })).toBeChecked();
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletes).toEqual([{ name: 'market', scene: 'keep' }]);
  await expect(list.locator('.open-title')).toHaveText(['Road bridge', 'Holiday']);

  await list.locator('.open-row-wrap', { hasText: 'Holiday' }).getByTitle('Delete this saved proof').click();
  await expect(ask.getByRole('radio')).toHaveCount(0);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.locator('.open-title')).toHaveText(['Road bridge', 'Holiday']);
});

// -- the home ---------------------------------------------------------------------------------

const home = (page) => page.getByTestId('proof-home');

test('the home of an empty case is the big button and one sentence', async ({ page }) => {
  const { fixture } = await openCase(page, { empty: true });
  await expect(home(page).locator('.ph-empty p')).toHaveText('A proof lays pictures side by side and marks where they match.');
  await expect(home(page).getByRole('textbox')).toHaveCount(0);
  // the side column waits for a proof
  await expect(page.locator('aside.side')).toHaveCount(0);
  await home(page).getByRole('button', { name: 'New proof' }).click();
  await expect(newProof(page)).toBeVisible();
  await expect(newProof(page).getByText('No pictures in this case yet.', { exact: false })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('the home opens at once, its cards held in place until the list answers, then on what it read last', async ({ page }) => {
  let release;
  const gate = { wait: new Promise((resolve) => { release = resolve; }) };
  await openCase(page, { gate });
  // the button and the scenes are there while the list is out
  await expect(home(page).getByRole('button', { name: 'New proof' })).toBeVisible();
  await expect(home(page).locator('.ph-card.ghost')).toHaveCount(3);
  await expect(home(page).locator('.ph-chip')).toHaveCount(1);
  release();
  await expect(home(page).locator('.ph-card:not(.ghost)')).toHaveCount(3);
  await expect(home(page).locator('.ph-card.ghost')).toHaveCount(0);

  // back in the tool, it shows what it read last while it reads again
  gate.wait = new Promise((resolve) => { release = resolve; });
  await page.goto('/#media');
  await page.goto('/#proof');
  await expect(home(page).locator('.ph-card:not(.ghost)')).toHaveCount(3);
  await expect(home(page).locator('.ph-card.ghost')).toHaveCount(0);
  release();
});

test('the home continues from the last proofs, finds one by name, and makes the proof of a scene', async ({ page }) => {
  const { proofReads, frameSaves } = await openCase(page);
  const cards = home(page).locator('.ph-card');
  await expect(cards.locator('.ph-title')).toHaveText(['Road bridge', 'Market', 'Holiday']);
  await expect(cards.locator('.ph-tag')).toHaveText([`${TITLE} · 1/2`, `${TITLE} · 2/2`]);
  await expect(page.locator('aside.side')).toHaveCount(0);
  // one read for the home
  expect(proofReads).toHaveLength(1);

  // To prove: the video's card, its scene as a chip
  const chip = home(page).locator('.ph-chip');
  await expect(home(page).locator('.ph-video h5')).toHaveText(TITLE);
  await expect(chip).toHaveText(/Water tower\?\s*0:00–0:00\s*In progress: 1 map capture/);

  // the search opens the first proof found on Enter
  await home(page).getByRole('textbox', { name: 'Find a proof by name' }).fill('mark');
  await expect(home(page).locator('.ph-hit-title')).toHaveText(['Market']);
  await page.keyboard.press('Enter');
  await expect(proofName(page)).toHaveValue('Market');
  await expect(home(page)).toHaveCount(0);

  // Back is the home again, and a chip makes the proof of its scene as Make the proof does
  await page.goBack();
  await expect(home(page)).toBeVisible();
  await home(page).locator('.ph-chip').click();
  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  await expect(chooser.getByRole('list', { name: 'Frames of the scene' }).getByRole('listitem')).toHaveCount(2);
  await chooser.getByRole('button', { name: 'Make the proof' }).click();
  await expect(proofName(page)).toHaveValue('Water tower');
  expect(frameSaves).toHaveLength(1);
  await expect(page.locator('.panel-row')).toHaveCount(3);
});

// -- Delete the open proof -----------------------------------------------------------------------

/** Open a saved proof the way the sidebar hands one over. */
async function openSaved(page, name, title) {
  await page.evaluate(async (wanted) => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = wanted;
  }, name);
  await expect(proofName(page)).toHaveValue(title);
}

async function deleteFromHeader(page) {
  await header(page).getByRole('button', { name: 'More for this proof' }).click();
  await page.getByRole('menu', { name: 'This proof' }).getByRole('button', { name: 'Delete…' }).click();
  return page.getByRole('alertdialog', { name: 'Delete this proof?' });
}

test('deletes the open proof on photos from the header, as simply as before, then shows the home', async ({ page }) => {
  const { deletes } = await openCase(page);
  await openSaved(page, 'holiday', 'Holiday');
  const ask = await deleteFromHeader(page);
  await expect(ask).toContainText('“Holiday” will be removed from the case.');
  await expect(ask).toContainText('You can restore it from Trash');
  await expect(ask.getByRole('radio')).toHaveCount(0);
  await ask.getByRole('button', { name: 'Delete' }).click();

  await expect.poll(() => deletes).toEqual([{ name: 'holiday', scene: 'keep' }]);
  await expect(home(page)).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Deleted “Holiday”' })).toBeVisible();
  // gone on purpose: no word about a proof deleted behind the composer
  await expect(page.locator('.toast', { hasText: 'Saving now creates a new one' })).toHaveCount(0);
});

test('deletes a proof of a scene from the header, asking what becomes of its scene, then shows the next slide', async ({ page }) => {
  const { deletes } = await openCase(page);
  await openSaved(page, 'market', 'Market');
  const ask = await deleteFromHeader(page);
  await expect(ask.locator('legend')).toHaveText(`Its scene in ${TITLE}`);
  await expect(ask.getByRole('radio', { name: 'Goes back to To geolocate' })).toBeChecked();
  await ask.getByRole('radio', { name: 'Is removed with it' }).check();
  await ask.getByRole('button', { name: 'Delete' }).click();

  await expect.poll(() => deletes).toEqual([{ name: 'market', scene: 'drop' }]);
  // the last proof of the video: the one before it opens
  await expect(proofName(page)).toHaveValue('Road bridge');
});

test('a proof of a scene deleted by default gives its scene back', async ({ page }) => {
  const { deletes } = await openCase(page);
  await openSaved(page, 'bridge', 'Road bridge');
  const ask = await deleteFromHeader(page);
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletes).toEqual([{ name: 'bridge', scene: 'keep' }]);
  await expect(proofName(page)).toHaveValue('Market');
});

// -- a slide's menu ------------------------------------------------------------------------------

test('a slide\'s right-click menu renames, deletes and gives up, and the keys open it too', async ({ page }) => {
  const { saves, deletes } = await openCase(page);
  await openSaved(page, 'bridge', 'Road bridge');
  const strip = page.getByRole('region', { name: 'Slides of the video' });
  const tiles = strip.getByRole('listbox', { name: 'Slides' }).getByRole('option');
  await expect(tiles.locator('.tile-title')).toHaveText(['Road bridge', 'Market', 'Water tower?']);

  // Market states no place yet: it can be given up on as well
  await tiles.nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Market' });
  await expect(menu.locator('.fm-item')).toHaveText(['Rename', 'Show in Inspect', 'Abandon…', 'Delete…']);
  await menu.getByRole('button', { name: 'Rename' }).click();
  await menu.getByRole('textbox', { name: 'New name' }).fill('Covered market');
  await page.keyboard.press('Enter');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ title: 'Covered market', rename_from: 'market' });
  await expect(tiles.nth(1).locator('.tile-title')).toHaveText('Covered market');
  // the slide open stays as it was
  await expect(proofName(page)).toHaveValue('Road bridge');

  // the slide open takes a name as its field does: shown at once, saved with it
  await tiles.nth(0).click({ button: 'right' });
  const openOne = page.getByRole('menu', { name: 'Road bridge' });
  await openOne.getByRole('button', { name: 'Rename' }).click();
  await expect(openOne.getByRole('textbox', { name: 'New name' })).toHaveValue('Road bridge');
  await openOne.getByRole('textbox', { name: 'New name' }).fill('Bridge at dawn');
  await page.keyboard.press('Enter');
  await expect(proofName(page)).toHaveValue('Bridge at dawn');
  await expect(header(page).locator('.badge')).toHaveText('unsaved');
  expect(saves).toHaveLength(1);
  await proofName(page).fill('Road bridge');

  // the keys: Shift+F10 on a focused tile, the menu's first item focused, Escape back to the tile
  await tiles.nth(0).focus();
  await page.keyboard.press('Shift+F10');
  const own = page.getByRole('menu', { name: 'Road bridge' });
  await expect(own.locator('.fm-item')).toHaveText(['Rename', 'Show in Inspect', 'Delete…']);
  await expect(own.locator('.fm-item').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(own).toHaveCount(0);
  await expect(tiles.nth(0)).toBeFocused();

  // a scene still to prove keeps its own steps
  await tiles.nth(2).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Water tower?' }).locator('.fm-item')).toHaveText(['Make this slide', 'Geolocate', 'Abandon…']);
  await page.keyboard.press('Escape');

  // Delete… asks about the scene, and the slide open stays
  await tiles.nth(1).click({ button: 'right' });
  await page.getByRole('menu', { name: 'Covered market' }).getByRole('button', { name: 'Delete…' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Delete this proof?' });
  await expect(ask.getByRole('radio', { name: 'Goes back to To geolocate' })).toBeChecked();
  await ask.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletes).toEqual([{ name: 'covered-market', scene: 'keep' }]);
  await expect(proofName(page)).toHaveValue('Road bridge');
});
