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
 * `empty` is a case holding nothing; `scenes: false` one with no scene to prove.
 */
async function openCase(page, { empty = false, scenes = true } = {}) {
  const media = empty ? [] : [
    { path: VIDEO, filename: 'clip.webm', title: 'clip.webm', kind: 'video', entity_id: 'e_clip', size: STEPS_WEBM.length, sha256: '1'.repeat(64),
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
        ...(slide >= 0 ? { video: VIDEO, order: slide === 0 ? 0 : 1, slide: slide + 1, slides: onVideo.length } : { video: null }),
      };
    });
  };
  const queue = () => ({
    files: drafts.length ? [{ video: VIDEO, title: 'clip.webm', kind: 'video', scenes: drafts.map((d) => ({ ...d, file_kind: 'video', order: 2 })), proofs: [] }] : [],
    geolocating: null,
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    const picture = /\/([a-z-]+)\.(png|webp|jpg)$/.exec(path);
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
  await dialog.getByRole('button', { name: 'Create proof' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(proofName(page)).toBeVisible();
  await expect(page.locator('.panel-row')).toHaveCount(2);
  // laid out in the order pressed
  await expect(page.locator('.panel-row .panel-thumb img').first()).toHaveAttribute('src', /photo\.png$/);
  fixture.expectNoUnexpectedRequests();
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
  await expect(dialog.locator('.np-video h5')).toHaveText(['clip.webm']);
  await expect(dialog.locator('.np-video .np-count')).toHaveText('3 frames');
  await expect(dialog.locator('.np-tile .np-time')).toHaveText(['0:00.2', '0:00.5', '0:00.6']);
});

test('New proof from a scene: its material all ticked, and the proof takes the scene up', async ({ page }) => {
  const { frameSaves } = await openCase(page);
  await openNewProof(page);
  const dialog = newProof(page);
  const scenes = dialog.getByRole('list', { name: 'Scenes to prove' });
  await expect(scenes.locator('.np-scene-name')).toHaveText(['Water tower?']);
  await expect(scenes.locator('.np-scene-said')).toHaveText('0:00–0:00 · clip.webm');

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
  await expect(list.locator('.open-slide')).toHaveText(['clip.webm · slide 1 of 2', 'clip.webm · slide 2 of 2']);
  await expect(list.locator('.open-row-wrap', { hasText: 'Holiday' }).locator('.open-slide')).toHaveCount(0);
  await expect(list.locator('.open-row-wrap', { hasText: 'Holiday' }).locator('.open-sub')).toHaveText('1 panels · 0 annotations · 2026-11-06');

  const video = list.getByRole('combobox', { name: 'Video' });
  await video.selectOption({ label: 'clip.webm · 2' });
  await expect(list.locator('.open-title')).toHaveText(['Road bridge', 'Market']);
  await video.selectOption({ label: 'On no video · 1' });
  await expect(list.locator('.open-title')).toHaveText(['Holiday']);
  await video.selectOption({ label: 'Every video' });
  await list.locator('.open-row', { hasText: 'Market' }).click();
  await expect(proofName(page)).toHaveValue('Market');
});
