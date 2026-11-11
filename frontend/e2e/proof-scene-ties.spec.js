import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, showProofTab } from './app.fixture.js';
import { STEPS_DURATION, STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * A proof of pictures made from a video's footage without being cut from it: Horizon's
 * two pictures of a collage of the video, taken while its scene, the whole video, was
 * geolocated. The server walks each panel's derivation back to the video
 * (`POST /scenes/ties`). A saved proof is offered that scene, with Take it up, which
 * takes it out of To geolocate; one sent from Horizon while the scene is geolocated holds
 * it, and its first save takes it up with nothing offered.
 */

const VIDEO = 'media/steps.webm';
const COLLAGE = 'media/Collage 22.png';
const PHOTO = 'media/Collage 22 photo with the ridge lines.png';
const TERRAIN = 'media/Collage 22 terrain, simulated.png';
const TIMES = [0.3, 0.6, 0.9];
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
  </svg>`;

const image = (path, title, source) => ({
  path, filename: path.split('/').pop(), title, kind: 'image', width: 640, height: 360, size: 256,
  sha256: '0'.repeat(64), source, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});
const kept = (path, title, kind) => image(path, title, { type: 'horizon', view: '.horizon/Collage 22.json', kept: true, kind, from: COLLAGE, photo: COLLAGE });

test.use({ viewport: { width: 1500, height: 900 } });

/**
 * The case as the owner had it: the video, one scene to geolocate about the whole of it
 * holding Horizon's two pictures, the collage they were made over, and Proof 100 made of
 * them, which states no scene. The server is faked the way it answers.
 */
async function openCase(page) {
  const media = [
    { path: VIDEO, filename: 'steps.webm', title: 'Steps', kind: 'video', entity_id: 'e_steps', size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
    image(COLLAGE, 'Collage 22', { type: 'inspect', op: 'collage', from: '', sources: [VIDEO, VIDEO, VIDEO], times: TIMES, perspective: true }),
    kept(PHOTO, 'Collage 22 photo with the ridge lines', 'photo'),
    kept(TERRAIN, 'Collage 22 terrain, simulated', 'terrain'),
  ];
  const drafts = [{ id: 'sc_whole', start: null, end: null, label: '', captures: [PHOTO, TERRAIN] }];
  const proofs = {
    'proof-100': {
      azimut_proof: 1, ink: 'page', title: 'Proof 100', pastes: [], shapes: [], notes: {}, legendOrder: [], material: [],
      panels: [PHOTO, TERRAIN].map((src, i) => ({ id: `p${i}`, src, caption: '', row: 0, scale: 1, natural: [640, 360] })),
      points: [{ coords: '16.018740, 45.528599', label: 'POV', pov: true }], when: null, description: null, sources: null,
    },
  };
  const fixture = await installAppFixture(page, {
    media,
    lookupEntities: Object.fromEntries(['proof-100', 'browser-proof'].map((name) => [`proofs/.meta/${name}.json`, {
      id: `e_${name}`, type: 'proof', attrs: { spec: `proofs/.meta/${name}.json`, path: `proofs/${name}.png` },
    }])),
  });
  const scenePuts = [];
  const tieReads = [];
  const taken = () => new Set(Object.values(proofs).map((spec) => spec.scene?.draft).filter(Boolean));
  const open = () => drafts.filter((d) => !taken().has(d.id)).map((d) => ({
    kind: 'draft', video: VIDEO, ...d, state: 'progress', footage: 1, abandoned: null, file_kind: 'video',
  }));
  const answer = () => ({
    video: VIDEO, video_id: 'e_steps', used: {}, geolocating: null,
    scenes: [
      ...Object.entries(proofs).filter(([, spec]) => spec.scene).map(([name, spec]) => ({
        kind: 'proof', proof: name, proof_id: `e_${name}`, title: spec.title, video: VIDEO, moments: spec.scene.moments, at: [],
        stated: true, draft: spec.scene.draft, points: [], state: 'proved', abandoned: null, png: `proofs/${name}.png`, thumb: null,
      })),
      ...open(),
    ],
    taken: drafts.filter((d) => taken().has(d.id)).map((d) => d.id),
    collages: [{ collage: 'Collage 22', title: 'Collage 22', export: COLLAGE, current: true, times: TIMES, start: TIMES[0], end: TIMES.at(-1) }],
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path.startsWith(`/files/${CASE_ID}/`) && /\.(png|webp)$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: STEPS_DURATION, fps: STEPS_FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/scenes` && method === 'GET') return json(answer());
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) {
      return json({ files: open().length ? [{ video: VIDEO, title: 'Steps', kind: 'video', scenes: open() }] : [], geolocating: null });
    }
    if (path === `/api/cases/${CASE_ID}/scenes/ties` && method === 'POST') {
      // as the server walks them: each Horizon picture to the collage, the collage to the video
      const { panels } = request.postDataJSON();
      tieReads.push(panels);
      return json({ ties: panels.filter((src) => src === PHOTO || src === TERRAIN).map((src) => ({ src, video: VIDEO, times: TIMES, scene: 'sc_whole' })) });
    }
    if (path === `/api/cases/${CASE_ID}/todos`) return json({ revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] });
    const one = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)$/.exec(path);
    if (one && method === 'GET' && proofs[decodeURIComponent(one[1])]) return json(proofs[decodeURIComponent(one[1])]);
    const timed = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timed && method === 'PUT') {
      const body = request.postDataJSON();
      const name = decodeURIComponent(timed[1]);
      scenePuts.push({ proof: name, body });
      proofs[name] ??= { title: name, panels: [], points: [] };
      if (body.traced) delete proofs[name].scene;
      else proofs[name].scene = { video: body.video, moments: body.moments, draft: body.draft ?? proofs[name].scene?.draft ?? null };
      return json({ proof: name, video: body.video, moments: body.moments, at: [], stated: !body.traced, draft: body.traced ? null : body.draft ?? null });
    }
    return route.fallback();
  });
  await page.goto('/#proof');
  // a fresh dev server compiles the app on this first visit
  await expect(page.locator('.tool-header').getByRole('button', { name: 'New proof', exact: true })).toBeVisible({ timeout: 15_000 });
  return { fixture, scenePuts, tieReads, proofs };
}

const sceneBlock = (page) => page.getByTestId('scene-block');
const toGeolocate = (page) => page.locator('aside.sidebar').getByRole('region', { name: 'To geolocate' });
/** What the server says after a scene's time is written: the queue and the strip read again. */
const nudge = (page) => page.evaluate(async (caseId) => {
  const { dispatch } = await import('/src/lib/events.js');
  dispatch({ type: 'scenes', case_id: caseId, video: null });
}, CASE_ID);

test('offers Proof 100, made of Horizon\'s pictures of the video\'s collage, the scene they were taken for, and Take it up takes it out of To geolocate', async ({ page }) => {
  const { fixture, scenePuts, tieReads } = await openCase(page);
  // the To-do lists the whole video still to geolocate
  await page.locator('aside.sidebar').getByRole('tab', { name: 'To-do' }).click();
  await expect(toGeolocate(page).getByRole('heading', { name: 'To geolocate 1' })).toBeVisible();

  await page.evaluate(async () => {
    const { uiState } = await import('/src/lib/state.svelte.js');
    uiState.openProof = 'proof-100';
  });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Proof 100');
  // its panels are no frames: the server is asked what they were made from
  await expect.poll(() => tieReads.at(-1)).toEqual([PHOTO, TERRAIN]);
  await showProofTab(page, 'Scene');
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);
  const proposal = sceneBlock(page).getByTestId('scene-proposal');
  await expect(proposal).toHaveText(/^\s*Whole video\s*Take it up\s*Not this scene\s*$/);
  await expect(proposal).toHaveAttribute('title', 'Its captures were taken while geolocating this scene, still to prove');
  // opening it writes nothing
  await expect(page.locator('.tool-header .badge')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(scenePuts).toEqual([]);

  await proposal.getByRole('button', { name: 'Take it up' }).click();
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0]).toEqual({ proof: 'proof-100', body: { moments: [], video: VIDEO, draft: 'sc_whole' } });
  await expect(proposal).toHaveCount(0);
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);

  // the server says the scene moved: the To-do reads its queue again, and the scene is gone
  await expect(toGeolocate(page).getByRole('heading', { name: 'To geolocate 1' })).toBeVisible();
  await nudge(page);
  await expect(toGeolocate(page)).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('makes the proof of the scene being geolocated from Horizon\'s pictures, and its first save takes the scene up with nothing offered', async ({ page }) => {
  const { scenePuts } = await openCase(page);
  // Send to Geo Proof while the whole video is geolocated, both pictures attached to it
  await page.evaluate(async ({ caseId, video, photo, terrain }) => {
    const { geolocating } = await import('/src/lib/geolocating.svelte.js');
    const { sendToGeoProof } = await import('/src/lib/toGeoProof.js');
    geolocating.caseId = caseId;
    geolocating.scene = {
      kind: 'draft', video, id: 'sc_whole', start: null, end: null, label: 'Which ridge?', state: 'progress',
      captures: [], abandoned: null, file_kind: 'video', order: 0,
    };
    const scene = { video, id: 'sc_whole', label: 'Which ridge?', captures: 2 };
    sendToGeoProof(caseId, [{ path: photo, scene }, { path: terrain, scene }]);
  }, { caseId: CASE_ID, video: VIDEO, photo: PHOTO, terrain: TERRAIN });

  // a new proof of the two pictures, named after the scene, holding it
  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Which ridge');
  await showProofTab(page, 'Scene');
  await expect(sceneBlock(page).getByTestId('scene-video')).toHaveText(/★\s*Steps\s*·\s*Whole video/);
  await expect(sceneBlock(page).getByTestId('scene-proposal')).toHaveCount(0);
  await expect(sceneBlock(page).getByTestId('scene-match')).toHaveCount(0);
  await expect(sceneBlock(page).getByTestId('scene-choices')).toHaveCount(0);

  await showProofTab(page, 'Proof');
  await page.locator('.point-row').first().locator('.meta-input').fill('16.018740, 45.528599');
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => scenePuts.length).toBe(1);
  expect(scenePuts[0]).toEqual({ proof: 'browser-proof', body: { moments: [], video: VIDEO, draft: 'sc_whole' } });
  await showProofTab(page, 'Scene');
  await expect(sceneBlock(page).getByTestId('scene-proposal')).toHaveCount(0);
});
