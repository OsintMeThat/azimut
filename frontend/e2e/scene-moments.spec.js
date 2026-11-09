import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, showProofTab } from './app.fixture.js';
import { STEPS_FPS, STEPS_WEBM, serveRange } from './video.fixture.js';

/**
 * One scene, several passages: the same place showing twice in one video. Same place
 * as… joins two scenes still to prove into one, two bands in one colour, and its Undo
 * parts them again; Another passage adds one of the scene's kind from the frame on
 * screen; the To-do says every passage; Make the proof hands them all to Geo Proof,
 * which states them, each panel printing the passage it shows in.
 *
 * The clip is the short one of `video.fixture.js`, read by its probe as a longer one so
 * its times are the ones an analyst writes. `MOMENT_SHOTS` names a folder for a picture
 * of each state, `MOMENT_CLIP` (with `MOMENT_FPS`) a longer clip to take them on, and
 * `MOMENT_STILL` a JPEG its frames show.
 */

const VIDEO = 'media/convoy.webm';
const LENGTH = 90;
const SHOTS = process.env.MOMENT_SHOTS;
const CLIP = process.env.MOMENT_CLIP ? readFileSync(process.env.MOMENT_CLIP) : STEPS_WEBM;
const FPS = Number(process.env.MOMENT_FPS) || STEPS_FPS;
const STILL = process.env.MOMENT_STILL ? readFileSync(process.env.MOMENT_STILL) : null;
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PANEL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="#304b65"/>
    <path d="M0 300L180 150L300 250L450 90L640 280V360H0Z" fill="#6c8f55"/>
  </svg>`;

const kept = (id, start, end, label = '', more = null) => ({ id, start, end, label, ...(more ? { more } : {}) });
const m = (start, end = null) => ({ start, end });
const workFrame = (id, time) => ({
  id, path: VIDEO, time, adjust: {}, crop: null, sourceOps: [], rotation: 0, w: 32, h: 32, filed: null,
});

/** Every moment of a scene as the server keeps it: its own, then `more`. */
const momentsOf = (scene) => (scene.start == null ? [] : [m(scene.start, scene.end ?? null), ...(scene.more ?? [])]);
const inOrder = (moments) => [...moments].sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start));
const timed = (id, label, moments) => {
  const [first, ...rest] = inOrder(moments);
  return kept(id, first.start, first.end, label, rest.length ? rest : null);
};

/** Inspect's routes, the To-do's and Geo Proof's answered the way the server does. */
async function serve(page, { scenes, frames = [], opens = true } = {}) {
  await page.setViewportSize({ width: 1280, height: 720 });
  const media = [
    { path: VIDEO, filename: 'convoy.webm', title: 'Convoy clip', kind: 'video', entity_id: 'e_convoy', size: CLIP.length, source: { type: 'upload' }, thumbnail: null, folder: '' },
  ];
  const fixture = await installAppFixture(page, {
    media,
    lookupEntities: {
      'proofs/.meta/browser-proof.json': { id: 'browser-proof-entity', type: 'proof', attrs: { spec: 'proofs/.meta/browser-proof.json', path: 'proofs/browser-proof.png' } },
    },
  });
  const server = { scenes, frames, saves: [], joins: [], unjoins: [], scenePuts: [], proved: null };
  // its place among the clip's scenes is what colours it, as `engine/geolocate.py` orders it
  const row = (scene) => ({
    kind: 'draft', video: VIDEO, ...scene, state: 'todo', captures: [], abandoned: null, file_kind: 'video',
    order: server.scenes.findIndex((sc) => sc.id === scene.id),
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${VIDEO}`) return serveRange(route, CLIP, 'video/webm');
    if (path.startsWith(`/files/${CASE_ID}/media/`) && path.endsWith('.png')) {
      return STILL ? route.fulfill({ contentType: 'image/jpeg', body: STILL }) : route.fulfill({ contentType: 'image/svg+xml', body: PANEL_SVG });
    }
    if (path === `/api/cases/${CASE_ID}/media`) return json(media);
    if (path === `/api/cases/${CASE_ID}/todos`) return json({ revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] });
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: LENGTH, fps: FPS, width: 32, height: 32 });
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) {
      return STILL ? route.fulfill({ contentType: 'image/jpeg', body: STILL }) : route.fulfill({ contentType: 'image/png', body: PIXEL_PNG });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'GET') {
      return json({
        work: {
          name: 'Work', title: 'Work',
          spec: { source: { path: VIDEO, kind: 'video' }, videoAdjust: {}, videoRotation: 0, frames: server.frames, marks: [], scenes: server.scenes, activeFrameId: null },
        },
      });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/work` && method === 'PUT') {
      const body = request.postDataJSON();
      server.saves.push(body);
      server.scenes = body.spec.scenes;
      server.frames = body.spec.frames;
      return json({ name: 'Work', title: 'Work' });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/save-frames` && method === 'POST') {
      const body = request.postDataJSON();
      const saved = body.items.map((item, i) => {
        const filed = {
          path: `media/frame-${media.length + i}.png`, filename: `frame-${media.length + i}.png`, title: item.label, kind: 'image',
          width: 640, height: 360, size: 256, sha256: '0'.repeat(64), thumbnail: null, thumb_state: 'ready', enrich_state: 'ready',
          folder: '', notes: '', entity_id: `e_frame_${i}`, source: { type: 'inspect', op: 'frame', from: VIDEO, time: item.time },
        };
        return { item: filed, entity: { id: filed.entity_id } };
      });
      media.push(...saved.map((one) => one.item));
      return json({ saved });
    }
    if (path === `/api/cases/${CASE_ID}/scenes/queue`) {
      const open = server.scenes.map(row);
      return json({ files: open.length ? [{ video: VIDEO, title: 'Convoy clip', kind: 'video', scenes: open }] : [], geolocating: null });
    }
    if (path === `/api/cases/${CASE_ID}/scenes`) {
      const taken = server.proved ? [server.proved.draft] : [];
      return json({
        video: VIDEO, video_id: 'e_convoy', used: {}, taken, geolocating: null, collages: [],
        scenes: [...(server.proved ? [server.proved] : []), ...server.scenes.filter((sc) => !taken.includes(sc.id)).map(row)],
      });
    }
    // Same place as…, and its Undo, as `engine/inspectwork.join_scenes` writes them
    const joining = /^\/api\/cases\/[^/]+\/scenes\/([^/]+)\/(join|unjoin)$/.exec(path);
    if (joining && method === 'POST') {
      const body = request.postDataJSON();
      const draft = decodeURIComponent(joining[1]);
      if (joining[2] === 'join') {
        server.joins.push({ draft, body });
        const source = server.scenes.find((sc) => sc.id === draft);
        const target = server.scenes.find((sc) => sc.id === body.into);
        const label = [target.label, source.label].filter(Boolean).join(' / ');
        const joined = timed(target.id, label, [...momentsOf(target), ...momentsOf(source)]);
        server.scenes = server.scenes.filter((sc) => sc.id !== draft).map((sc) => (sc.id === target.id ? joined : sc));
        return json({ scene: row(joined), undo: { kept: target, gone: source, geolocating: null } });
      }
      server.unjoins.push({ draft, body });
      server.scenes = [...server.scenes.map((sc) => (sc.id === body.kept.id ? body.kept : sc)), body.gone];
      return json({ scenes: [row(body.kept), row(body.gone)] });
    }
    const timedProof = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timedProof && method === 'PUT') {
      const body = request.postDataJSON();
      server.scenePuts.push(body);
      const scene = { video: body.video, moments: body.moments, at: [], stated: true, draft: body.draft ?? null };
      // the proof takes its scene up: listed in its place, saved with no point yet
      server.proved = {
        kind: 'proof', proof: timedProof[1], title: 'Road bridge', ...scene, points: [], state: 'progress', abandoned: null,
        png: 'proofs/browser-proof.png', thumb: null,
      };
      return json({ proof: timedProof[1], ...scene });
    }
    return route.fallback();
  });
  await page.goto('/#inspect');
  if (opens) {
    await page.locator('.card', { hasText: 'Convoy clip' }).click();
    await page.waitForFunction(() => (document.querySelector('.video-canvas video')?.readyState ?? 0) >= 2);
  }
  return { fixture, server };
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
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-dark.png` });
  await theme(page, 'light');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-light.png` });
  await theme(page, 'dark');
  await page.waitForTimeout(400);
}

const panel = (page) => page.getByRole('tabpanel', { name: 'Scenes' });
const rows = (page) => panel(page).getByTestId('scene-row');
const toast = (page) => page.locator('.toast').last();

test('joins two scenes of one place into one, two bands in one colour, and its Undo parts them again', async ({ page }) => {
  const { server } = await serve(page, {
    scenes: [kept('sc_w', null, null, 'Which town?'), kept('sc_a', 0, 7, 'Road bridge'), kept('sc_b', 65, 72, '')],
  });
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('scene-band')).toHaveCount(2);

  // the later passage, opened: Same place as… lists the other scene with a time, never the whole video
  await rows(page).nth(2).click();
  await rows(page).nth(2).getByRole('button', { name: 'Same place as…' }).click();
  const menu = page.getByRole('menu', { name: 'Same place as' });
  const choice = menu.getByTestId('same-place-choice');
  await expect(choice).toHaveCount(1);
  await expect(choice).toContainText('Road bridge');
  await expect(choice).toContainText('0:00–0:07');
  await shoot(page, 'same-place-chooser');
  await choice.click();

  await expect.poll(() => server.joins).toEqual([{ draft: 'sc_b', body: { video: VIDEO, into: 'sc_a' } }]);
  await expect(rows(page)).toHaveCount(2);
  await expect(toast(page)).toContainText('“Road bridge” is now 0:00–0:07 · 1:05–1:12');
  // one scene: open on its two moments, two bands on the bar in its one colour
  const joined = rows(page).nth(1);
  await expect(joined.getByTestId('scene-moment')).toHaveCount(2);
  await expect(joined.getByRole('textbox', { name: 'Scene start' }).nth(1)).toHaveValue('1:05');
  const bands = page.getByTestId('scene-band');
  await expect(bands).toHaveCount(2);
  const colours = await bands.evaluateAll((all) => all.map((band) => band.style.getPropertyValue('--scene')));
  expect(new Set(colours).size).toBe(1);
  // no save follows: the server wrote it already
  const saves = server.saves.length;
  await page.waitForTimeout(800);
  expect(server.saves).toHaveLength(saves);
  await page.mouse.move(0, 0);
  await shoot(page, 'joined-open');

  // closed, it writes every moment
  await rows(page).nth(0).click();
  await expect(rows(page).nth(1).getByTestId('scene-when')).toHaveText('2 passages · 0:00–0:07 · 1:05–1:12');
  await page.mouse.move(0, 0);
  await shoot(page, 'joined-closed');

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => server.unjoins.length).toBe(1);
  expect(server.unjoins[0].body).toEqual({
    video: VIDEO, kept: kept('sc_a', 0, 7, 'Road bridge'), gone: kept('sc_b', 65, 72, ''), geolocating: null,
  });
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('scene-band')).toHaveCount(2);
});

test('adds another passage of a scene still to prove, of its kind, from the frame on screen, and takes it off again', async ({ page }) => {
  const { server } = await serve(page, { scenes: [kept('sc_a', 0.12, 0.32, 'Road bridge')] });
  const row = rows(page).first();
  await expect(row.getByRole('radio', { name: 'Passage' })).toHaveAttribute('aria-checked', 'true');
  // a frame further on, stepped to with the player's keys
  const now = page.locator('.player-time .now');
  for (let i = 0; i < 40 && (await now.textContent()) !== '0:00.720'; i += 1) await page.keyboard.press('ArrowRight');
  await expect(now).toHaveText('0:00.720');

  // a stretch as long as the first, from that frame, in hand on the bar
  await row.getByRole('button', { name: 'Another passage' }).click();
  await expect(row.getByTestId('scene-moment')).toHaveCount(2);
  await expect(row.getByRole('textbox', { name: 'Scene start' }).nth(1)).toHaveValue('0:00.72');
  await expect(row.getByRole('textbox', { name: 'Scene end' }).nth(1)).toHaveValue('0:00.92');
  await expect(page.getByTestId('scene-grip-start')).toHaveCount(1);
  await expect(page.getByTestId('scene-grip-end')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await shoot(page, 'another-passage');
  await row.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.[0]?.more).toEqual([{ start: 0.72, end: 0.92 }]);
  expect(server.saves.at(-1).spec.scenes[0]).toMatchObject({ start: 0.12, end: 0.32 });
  await expect(page.getByTestId('scene-band')).toHaveCount(2);
  await expect(page.getByTestId('scene-pin')).toHaveCount(0);

  // inside a passage of its own, it starts where that one ends
  await row.getByRole('button', { name: 'Another passage' }).click();
  await expect(row.getByRole('textbox', { name: 'Scene start' }).nth(2)).toHaveValue('0:00.92');
  await expect(row.getByRole('textbox', { name: 'Scene end' }).nth(2)).toHaveValue('0:01.12');

  // a passage comes off again, never the last
  await row.getByRole('button', { name: 'Remove this passage' }).nth(2).click();
  await row.getByRole('button', { name: 'Remove this passage' }).nth(1).click();
  await expect(row.getByRole('button', { name: 'Remove this passage' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => server.saves.at(-1)?.spec?.scenes?.[0]).toEqual({ id: 'sc_a', start: 0.12, end: 0.32, label: 'Road bridge' });
  await expect(page.getByTestId('scene-band')).toHaveCount(1);
});

test('adds an instant to a scene of instants, and says so when none is free', async ({ page }) => {
  await serve(page, { scenes: [kept('sc_a', 0.12, null, 'Mast')] });
  const row = rows(page).first();
  const now = page.locator('.player-time .now');
  for (let i = 0; i < 40 && (await now.textContent()) !== '0:00.120'; i += 1) await page.keyboard.press('ArrowRight');
  await row.getByRole('button', { name: 'Another passage' }).click();
  await expect(row.getByTestId('scene-moment')).toHaveCount(1);
  await expect(row.getByRole('status')).toHaveText('The scene holds this instant already');
  await page.keyboard.press('ArrowRight');
  await row.getByRole('button', { name: 'Another passage' }).click();
  await expect(row.getByTestId('scene-moment')).toHaveCount(2);
  await expect(row.getByRole('textbox', { name: 'Scene start' }).nth(1)).toHaveValue('0:00.16');
  await expect(row.getByRole('textbox', { name: 'Scene end' })).toHaveCount(0);
  await expect(row.getByRole('status')).toHaveCount(0);
});

test('the To-do’s row says every moment of a scene showing its place again', async ({ page }) => {
  await serve(page, {
    scenes: [kept('sc_a', 0, 7, 'Road bridge', [m(65, 72)]), kept('sc_b', 30, 34.5, '', [m(80)])],
    opens: false,
  });
  await page.goto('/#files');
  const sidebar = page.locator('aside.sidebar');
  await sidebar.getByRole('tab', { name: 'To-do' }).click();
  const group = sidebar.getByRole('region', { name: 'To geolocate' });
  await expect(group.getByRole('heading', { name: 'To geolocate 2' })).toBeVisible();
  await expect(group.locator('li.scene').nth(0)).toContainText('Road bridge');
  // every moment on its own line, the state on the next: no line ends on a dot
  const meta = group.locator('li.scene').nth(0).locator('.meta');
  await expect(meta).toContainText('0:00–0:07 · 1:05–1:12');
  await expect(meta.locator('br')).toHaveCount(1);
  await expect(meta).toContainText('To geolocate');
  // a scene with no label goes by its time, every moment of it
  await expect(group.locator('li.scene').nth(1)).toContainText('0:30–0:34 · 1:20');
  await shoot(page, 'todo-rows');
});

test('makes the proof of a scene of two moments, stating both, each panel printing the moment it shows in', async ({ page }) => {
  const { fixture, server } = await serve(page, {
    scenes: [kept('sc_a', 0, 7, 'Road bridge?', [m(65, 72)])],
    frames: [workFrame('fr_1', 3), workFrame('fr_2', 66.5)],
  });
  await rows(page).first().getByRole('button', { name: 'Make the proof' }).click();
  const chooser = page.getByRole('dialog', { name: 'Make the proof' });
  // a frame in each moment, both ticked
  await expect(chooser.getByRole('list', { name: 'Frames of the scene' }).getByRole('checkbox')).toHaveCount(2);
  await chooser.getByRole('button', { name: 'Make the proof' }).click();

  await expect(page).toHaveURL(/#proof/);
  // a fresh dev server compiles Geo Proof on this first visit
  await expect(page.locator('.panel-row')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('textbox', { name: 'Proof name' })).toHaveValue('Road bridge');
  await showProofTab(page, 'Scene');
  await expect(page.getByTestId('scene-block').getByTestId('scene-video')).toHaveText(/★\s*Convoy clip\s*·\s*0:00–0:07 · 1:05–1:12/);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  await expect.poll(() => server.scenePuts).toEqual([{ moments: [m(0, 7), m(65, 72)], video: VIDEO, draft: 'sc_a' }]);

  // the time on the picture: each panel the moment its frame shows in
  await showProofTab(page, 'Style');
  await page.getByRole('checkbox', { name: 'Scene time on the picture' }).check();
  await expect.poll(() => page.evaluate(() => window.Konva.stages
    .flatMap((stage) => stage.find('.scene-badge'))
    .map((badge) => badge.findOne('Text').text())
    .sort())).toEqual(['0:00–0:07', '1:05–1:12']);
  await showProofTab(page, 'Scene');
  await page.mouse.move(0, 0);
  await shoot(page, 'proof-two-moments');
});
