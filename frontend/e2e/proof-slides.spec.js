import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, showProofTab } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * The slides of a video in Geo Proof: a strip under the canvas holding every proof
 * of the video and every scene of it still to prove, in clip order. Moving to another
 * slide saves the one left through the save Save proof runs; a refused save keeps the
 * slide. A proof on photos has no strip, and the composer is what it always was.
 */

const VIDEO = 'media/clip.webm';
const svg = (fill, ground) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="${fill}"/>
    <path d="M0 290L170 160L310 250L460 110L640 270V360H0Z" fill="${ground}"/>
  </svg>`;
const PICTURES = {
  'frame-a': svg('#304b65', '#6c8f55'),
  'frame-b': svg('#5a4632', '#a3814f'),
  'frame-c': svg('#2f4f4f', '#7aa37a'),
  'frame-d': svg('#3d3355', '#8f7fb8'),
  photo: svg('#444', '#999'),
};
// a 1×1 PNG, the signature picture Settings → Publishing holds
const LOGO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const image = (path, title, source) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256,
  sha256: '0'.repeat(64), source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});
const frame = (name, time) => image(`media/${name}.png`, name, { type: 'inspect', op: 'frame', from: VIDEO, time });
const panel = (id, name) => ({ id, src: `media/${name}.png`, caption: '', row: 0, scale: 1, natural: [640, 360] });

/** A saved proof's spec as the server answers it. */
const spec = (title, panels, extra = {}) => ({
  azimut_proof: 1, ink: 'page', title, panels, pastes: [], shapes: [], notes: {}, legendOrder: [],
  points: [{ coords: '', label: '', pov: false }], when: null, description: null, sources: null, material: [], ...extra,
});

test.use({ viewport: { width: 1500, height: 900 } });

/**
 * A case whose video holds three proofs, a scene to prove and one given up, in that
 * clip order once the abandoned one is put last: Road bridge, Market, Water tower?,
 * Square, then the one too blurry.
 */
async function openCase(page, { alone = false } = {}) {
  const media = [
    { path: VIDEO, filename: 'clip.webm', title: 'Clip', kind: 'video', entity_id: 'e_clip', size: STEPS_WEBM.length, sha256: '1'.repeat(64),
      source: { type: 'upload' }, thumbnail: null, folder: '' },
    // frame-d is the scene's frame Inspect already filed
    frame('frame-a', 0.2), frame('frame-b', 0.5), frame('frame-c', 0.96), frame('frame-d', 0.64),
    image('media/photo.png', 'Photo', { type: 'upload' }),
  ];
  const proofs = {
    bridge: spec('Road bridge', [panel('p1', 'frame-a')], {
      scene: { video: VIDEO, moments: [{ start: 0.1, end: 0.3 }] },
      bg: '#1d2a38', font: 'oxanium', footer: 'Desk geolocation', captionsEnabled: false, footerCoords: true,
      notes: { '#ff5252': 'impact' }, legendOrder: ['#ff5252'],
      signature: { anchor: 'tl', dx: 12, dy: 12, scale: 0.12, opacity: 0.9 },
      points: [{ coords: '48.858400, 2.294500', label: 'Bridge', pov: false }], description: 'The road bridge',
    }),
    market: spec('Market', [panel('p2', 'frame-b')]),
    square: spec('Square', [panel('p3', 'frame-c')]),
    photo: spec('Photo proof', [panel('p4', 'photo')]),
  };
  const drafts = alone ? [] : [
    { kind: 'draft', video: VIDEO, id: 's1', start: 0.6, end: 0.8, label: 'Water tower?', state: 'todo', captures: [], abandoned: null },
    { kind: 'draft', video: VIDEO, id: 's2', start: 1.0, end: null, label: '', state: 'abandoned', captures: [], abandoned: { reason: 'too blurry' } },
  ];
  const onVideo = alone ? ['market'] : ['bridge', 'market', 'square'];
  const lookupEntities = Object.fromEntries(Object.keys(proofs).map((name) => [`proofs/.meta/${name}.json`, {
    id: `e_${name}`, type: 'proof', label: proofs[name].title, attrs: { spec: `proofs/.meta/${name}.json`, path: `proofs/${name}.png` },
  }]));
  const catalog = Object.values(lookupEntities).map((entity) => ({ ...entity, provenance: {} }));
  const fixture = await installAppFixture(page, { media, lookupEntities, catalog });
  const saves = [];
  const scenePuts = [];
  const frameSaves = [];
  const sceneReads = [];
  const state = { refuse: false };
  const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const row = (name) => {
    const own = proofs[name];
    const at = own.panels.map((p) => media.find((m) => m.path === p.src)?.source?.time).filter((t) => t != null);
    return {
      kind: 'proof', proof: name, proof_id: `e_${name}`, title: own.title, video: VIDEO,
      moments: own.scene?.moments ?? [], at, stated: !!own.scene, draft: own.scene?.draft ?? null, points: [],
      png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp`, when: null, when_zone: null, description: null,
    };
  };
  const answer = () => {
    const rows = [...onVideo.map(row), ...drafts.filter((d) => !onVideo.some((name) => proofs[name].scene?.draft === d.id))];
    const start = (s) => (s.kind === 'draft' ? s.start ?? -1 : s.moments[0]?.start ?? s.at[0] ?? Infinity);
    return { video: VIDEO, video_id: 'e_clip', scenes: rows.sort((a, b) => start(a) - start(b)), used: {}, taken: [], geolocating: null, collages: [] };
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    const picture = /\/(frame-[a-z0-9]+|photo|[a-z-]+)\.(png|webp)$/.exec(path);
    if (path.startsWith(`/files/${CASE_ID}/`) && picture) {
      const look = PICTURES[picture[1]] ?? svg({ bridge: '#304b65', market: '#5a4632', square: '#2f4f4f' }[picture[1]] ?? '#3a3a3a', '#8a9a6a');
      return route.fulfill({ contentType: 'image/svg+xml', body: look });
    }
    if (path === '/api/settings/signature.png') return route.fulfill({ contentType: 'image/png', body: LOGO });
    // every proof saved here is in the case, the ones a slide saved for the first time included
    if (path === `/api/cases/${CASE_ID}/entities/lookup`) {
      const name = /^proofs\/\.meta\/(.+)\.json$/.exec(url.searchParams.get('value') ?? '')?.[1];
      if (name && proofs[name]) {
        return json({ entity: { id: `e_${name}`, type: 'proof', label: proofs[name].title, attrs: { spec: `proofs/.meta/${name}.json`, path: `proofs/${name}.png` } } });
      }
      return route.fallback();
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/scenes`) {
      sceneReads.push(url.searchParams.get('video'));
      return url.searchParams.get('video') === VIDEO ? json(answer()) : json({ detail: 'that file is not in the case' }, 400);
    }
    const framesOf = /^\/api\/cases\/[^/]+\/scenes\/([^/]+)\/frames$/.exec(path);
    if (framesOf) {
      return json({ frames: [
        { id: 'f1', time: 0.64, path: 'media/frame-d.png', thumb: null },
        { id: 'f2', time: 0.72, path: null, thumb: null },
      ] });
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
    const one = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)$/.exec(path);
    if (one && request.method() === 'GET') {
      const name = decodeURIComponent(one[1]);
      return proofs[name] ? json(proofs[name]) : json({ detail: 'no such proof' }, 404);
    }
    const timed = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timed && request.method() === 'PUT') {
      const body = request.postDataJSON();
      const name = decodeURIComponent(timed[1]);
      scenePuts.push({ proof: name, body });
      if (proofs[name]) proofs[name].scene = { video: body.video, moments: body.moments, draft: body.draft ?? null };
      if (!onVideo.includes(name)) onVideo.push(name);
      return json({ proof: name, video: body.video, moments: body.moments, at: [], stated: true, draft: body.draft ?? null });
    }
    if (path === `/api/cases/${CASE_ID}/proofs` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      if (state.refuse || (payload.spec.when && !/^\d{4}/.test(payload.spec.when))) {
        return json({ detail: 'The date 32/13/2025 is not one the case can read' }, 422);
      }
      saves.push(payload);
      const name = payload.rename_from ?? slug(payload.title);
      proofs[name] = { ...payload.spec, scene: proofs[name]?.scene };
      return json({ id: `e_${name}`, name, title: payload.title, png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp` });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  return { fixture, saves, scenePuts, frameSaves, sceneReads, state, proofs, drafts };
}

/** Open a saved proof the way the sidebar hands one over. */
async function openProof(page, name, title) {
  await page.evaluate(async (wanted) => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = wanted;
  }, name);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue(title);
  await expect(page.locator('.panel-row')).toHaveCount(1);
}

/** What the server says after a save or a scene change: the strip reads its video again. */
const nudge = (page) => page.evaluate(async (caseId) => {
  const { dispatch } = await import('/src/lib/events.js');
  dispatch({ type: 'scenes', case_id: caseId, video: null });
}, CASE_ID);

const slides = (page) => page.getByRole('region', { name: 'Slides of the video' });
const tiles = (page) => slides(page).getByRole('listbox', { name: 'Slides' }).getByRole('option');
const altKey = (page, key) => page.keyboard.press(`Alt+${key}`);
const notTyping = (page) => page.evaluate(() => document.activeElement?.blur());

test('lays out the video\'s scenes in clip order under the canvas, the abandoned one greyed at the end', async ({ page }) => {
  const { sceneReads } = await openCase(page);
  await openProof(page, 'market', 'Market');

  await expect(tiles(page)).toHaveCount(5);
  await expect(tiles(page).locator('.tile-title')).toHaveText(['Road bridge', 'Market', 'Water tower?', 'Square', '0:01']);
  await expect(tiles(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tiles(page).nth(4)).toHaveClass(/abandoned/);
  await expect(tiles(page).nth(2)).toHaveClass(/draft/);
  // a proved slide shows its thumbnail, never its full picture
  await expect(tiles(page).nth(0).locator('img')).toHaveAttribute('src', /proofs\/\.thumbs\/bridge\.webp$/);
  // under the canvas, between the toolbar and the side column, both of full height
  const strip = await slides(page).boundingBox();
  const side = await page.locator('aside.side').boundingBox();
  const canvas = await page.locator('.canvas-wrap').boundingBox();
  expect(strip.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
  expect(strip.x + strip.width).toBeLessThanOrEqual(side.x + 1);
  expect(side.y + side.height).toBeGreaterThan(strip.y + strip.height - 2);
  // one read of the video for the strip
  expect(sceneReads.filter((v) => v === VIDEO)).toHaveLength(1);
});

test('saves the slide left with Alt+→, opens the next one, and Alt+← leaves the browser where it is', async ({ page }) => {
  const { saves } = await openCase(page);
  // a step in the browser's history before Geo Proof, which Alt+← would go back to
  await page.goto('/#media');
  await page.goto('/#proof');
  await openProof(page, 'market', 'Market');
  await showProofTab(page, 'Proof');
  await page.locator('.desc-input').fill('The covered market');
  await notTyping(page);

  await altKey(page, 'ArrowRight');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].rename_from).toBe('market');
  expect(saves[0].spec.description).toBe('The covered market');
  // the next slide is the scene still to prove: its page, no proof started
  await expect(page.getByTestId('draft-page')).toBeVisible();
  await expect(page.getByTestId('draft-page').locator('h3')).toHaveText('Water tower?');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveCount(0);
  await expect(tiles(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.toast', { hasText: 'Saved Market' })).toBeVisible();

  // nothing started on the page, so the next press saves nothing
  await altKey(page, 'ArrowRight');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Square');
  expect(saves).toHaveLength(1);

  // Alt+← goes back a slide, never back in the browser
  const before = page.url();
  await altKey(page, 'ArrowLeft');
  await expect(page.getByTestId('draft-page')).toBeVisible();
  await altKey(page, 'ArrowLeft');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Market');
  expect(new URL(page.url()).hash.startsWith('#proof')).toBe(true);
  expect(page.url().split('#')[0]).toBe(before.split('#')[0]);
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible();

  // in a text field the keys stay the field's
  await page.locator('.desc-input').focus();
  await altKey(page, 'ArrowRight');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Market');
});

test('stays on the slide when its save is refused, and says why', async ({ page }) => {
  const { saves } = await openCase(page);
  await openProof(page, 'market', 'Market');
  await showProofTab(page, 'Proof');
  await page.locator('#proof-when').fill('32/13/2025');
  await page.locator('#proof-when').press('Tab');
  await notTyping(page);

  await altKey(page, 'ArrowRight');
  await expect(page.locator('.toast', { hasText: 'Still on this slide' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Still on this slide' })).toContainText('not one the case can read');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Market');
  await expect(page.getByTestId('draft-page')).toHaveCount(0);
  await expect(page.locator('.tool-header .badge')).toHaveText('unsaved');
  expect(saves).toHaveLength(0);
});

test('starts a new scene in the look of the slide left, with no panel, point or legend', async ({ page }) => {
  const { saves } = await openCase(page);
  await openProof(page, 'bridge', 'Road bridge');

  await slides(page).getByRole('button', { name: 'New scene' }).click();
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Proof 1');
  await expect(page.locator('.panel-row')).toHaveCount(0);
  // the Scene tab, its player on the video, is where the next step is
  await expect(page.getByRole('tablist', { name: 'Proof settings' }).getByRole('tab', { name: 'Scene' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('scene-player')).toBeVisible();
  // the strip shows it, not saved, after the live scenes and before the abandoned one
  await expect(tiles(page)).toHaveCount(6);
  await expect(tiles(page).nth(4)).toHaveText(/Proof 1\s*Not saved/);
  await expect(tiles(page).nth(4)).toHaveAttribute('aria-selected', 'true');
  // nothing was owed: the bridge had no change
  expect(saves).toHaveLength(0);

  await page.getByTestId('scene-block').getByRole('button', { name: 'Add this frame' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  const saved = saves[0].spec;
  expect(saved).toMatchObject({ bg: '#1d2a38', font: 'oxanium', footer: 'Desk geolocation', captionsEnabled: false, footerCoords: true });
  expect(saved.signature).toMatchObject({ anchor: 'tl' });
  expect(saved.notes).toEqual({});
  expect(saved.legendOrder).toEqual([]);
  expect(saved.description).toBeNull();
  expect(saved.points.every((one) => !one.coords)).toBe(true);
  expect(saved.panels).toHaveLength(1);
});

test('leaves a new scene never started without saving it', async ({ page }) => {
  const { saves } = await openCase(page);
  await openProof(page, 'bridge', 'Road bridge');
  await slides(page).getByRole('button', { name: 'New scene' }).click();
  await expect(tiles(page)).toHaveCount(6);
  await notTyping(page);
  await altKey(page, 'ArrowLeft');
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Square');
  await expect(tiles(page)).toHaveCount(5);
  expect(saves).toHaveLength(0);
});

test('makes a slide of a scene still to prove, its frames chosen in Geo Proof, and its first save takes the scene', async ({ page }) => {
  const { saves, scenePuts, frameSaves, drafts } = await openCase(page);
  await openProof(page, 'market', 'Market');

  await tiles(page).nth(2).click();
  const draftPage = page.getByTestId('draft-page');
  await expect(draftPage).toBeVisible();
  await expect(draftPage.locator('.draft-line')).toHaveText(/^0:00–0:00\s*To geolocate: no map capture yet/);
  await draftPage.getByRole('button', { name: 'Make this slide' }).click();

  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  await expect(chooser.getByRole('list', { name: 'Frames of the scene' }).getByRole('listitem')).toHaveCount(2);
  await expect(chooser.getByText('Not in the case', { exact: true })).toHaveCount(1);
  await expect(chooser.getByText('Saves 1 frame to the case on the way.')).toBeVisible();
  await chooser.getByRole('button', { name: 'Make the proof' }).click();

  await expect(page.locator('.panel-row')).toHaveCount(2);
  expect(frameSaves).toHaveLength(1);
  expect(frameSaves[0].items).toEqual([expect.objectContaining({ path: VIDEO, time: 0.72 })]);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Water tower');
  // the slide not saved yet stands where its scene did
  await expect(tiles(page).nth(2)).toHaveText(/Water tower\s*Not saved/);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0].body).toMatchObject({ video: VIDEO, draft: 's1' });
  // the server took the scene up: read again, the strip holds the proof in its place
  drafts.splice(0, 1);
  await nudge(page);
  await expect(tiles(page).nth(2)).toHaveText(/Water tower/);
  await expect(tiles(page).nth(2)).toHaveClass(/proof/);
  await expect(tiles(page)).toHaveCount(5);
});

test('gives up on a scene from its page, with a word, and restores it', async ({ page }) => {
  await openCase(page);
  const abandons = [];
  await page.route(`**/api/cases/${CASE_ID}/scenes/s1/abandon**`, (route) => {
    abandons.push({ method: route.request().method(), body: route.request().postDataJSON?.() ?? null });
    return route.fulfill({ json: { scene: { id: 's1' } } });
  });
  await openProof(page, 'market', 'Market');
  await tiles(page).nth(2).click();
  const draftPage = page.getByTestId('draft-page');
  await draftPage.getByRole('button', { name: 'Abandon…' }).click();
  await draftPage.getByRole('textbox', { name: 'Why it is abandoned' }).fill('no landmark');
  await draftPage.getByRole('button', { name: 'Abandon', exact: true }).click();
  await expect.poll(() => abandons.length).toBe(1);
  expect(abandons[0]).toEqual({ method: 'PUT', body: { video: VIDEO, reason: 'no landmark' } });
  await page.locator('.toast', { hasText: 'Scene abandoned' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => abandons.length).toBe(2);
  expect(abandons[1].method).toBe('DELETE');
});

test('folds to a line that keeps the slide shown and the arrows, for the session', async ({ page }) => {
  await openCase(page);
  await openProof(page, 'market', 'Market');
  await slides(page).getByRole('button', { name: 'Hide the slides' }).click();
  await expect(slides(page)).toHaveClass(/line/);
  await expect(slides(page)).toContainText('2 / 5');
  await expect(slides(page)).toContainText('Market');
  await slides(page).getByRole('button', { name: 'Previous slide' }).click();
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Road bridge');
  // still folded on the next slide
  await expect(slides(page)).toHaveClass(/line/);
  await expect(slides(page)).toContainText('1 / 5');
  await slides(page).getByRole('button', { name: 'Show the slides' }).click();
  await expect(tiles(page)).toHaveCount(5);
});

test('draws a thin line for a video this proof is alone on', async ({ page }) => {
  await openCase(page, { alone: true });
  await openProof(page, 'market', 'Market');
  await expect(slides(page)).toHaveClass(/line/);
  // the video by its title in Media
  await expect(slides(page)).toContainText('Clip');
  await expect(slides(page)).not.toContainText('clip.webm');
  await expect(slides(page)).toContainText('1 scene');
  await expect(slides(page).getByRole('button', { name: 'New scene' })).toBeVisible();
  const line = await slides(page).boundingBox();
  expect(line.height).toBeLessThanOrEqual(29);
});

test('a proof on photos has no strip, and the composer reads no scenes for it', async ({ page }) => {
  const { sceneReads } = await openCase(page);
  await openProof(page, 'photo', 'Photo proof');
  await expect(page.locator('.konva canvas')).toHaveCount(2);
  await expect(slides(page)).toHaveCount(0);
  expect(sceneReads).toHaveLength(0);
  // the canvas runs to the foot of the window, as it always did
  const canvas = await page.locator('.canvas-wrap').boundingBox();
  const side = await page.locator('aside.side').boundingBox();
  expect(Math.abs(canvas.y + canvas.height - (side.y + side.height))).toBeLessThanOrEqual(1);
});

test('exports the slides as one numbered set, saving the slide on screen first', async ({ page }) => {
  const { saves } = await openCase(page);
  const exports = [];
  await page.route(`**/api/cases/${CASE_ID}/proofs/series-export`, (route) => {
    exports.push(route.request().postDataJSON());
    return route.fulfill({ json: {
      folder: '/exports/clip', name: 'clip',
      files: [{ proof: 'bridge', title: 'Road bridge', file: '01 Road bridge.png' }, { proof: 'market', title: 'Market', file: '02 Market.png' }],
      skipped: [{ proof: 'square', title: 'Square' }],
    } });
  });
  await openProof(page, 'market', 'Market');
  await showProofTab(page, 'Proof');
  await page.locator('.desc-input').fill('The covered market');
  await notTyping(page);

  await slides(page).getByRole('button', { name: 'More for the slides' }).click();
  await page.getByRole('menu', { name: 'The slides' }).getByRole('button', { name: 'Export the slides' }).click();
  await expect.poll(() => exports.length).toBe(1);
  expect(exports[0]).toEqual({ video: VIDEO });
  expect(saves).toHaveLength(1);
  await expect(page.locator('.toast', { hasText: 'Exported 2 slides to clip' })).toContainText('Left out, no picture yet: Square');
});

test('saves the slide open when Inspect hands over a scene of the same video, rather than asking', async ({ page }) => {
  const { saves } = await openCase(page);
  await openProof(page, 'market', 'Market');
  await showProofTab(page, 'Proof');
  await page.locator('.desc-input').fill('The covered market');
  await notTyping(page);

  await page.evaluate(async (video) => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.proofScene = { video, moments: [{ start: 0.6, end: 0.8 }], draft: 's1', panels: ['media/frame-c.png'], label: 'Water tower?' };
  }, VIDEO);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Water tower');
  await expect(page.getByRole('dialog', { name: 'Leave this proof?' })).toHaveCount(0);
  expect(saves).toHaveLength(1);
  expect(saves[0].spec.description).toBe('The covered market');
});
