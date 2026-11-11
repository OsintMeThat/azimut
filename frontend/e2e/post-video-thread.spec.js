import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A video thread in Post, in a browser: offered for a video of two proofs or more and
 * for no other, laid out Recap first with its recap map previewed and made, or its
 * contact sheet, each drawn by the browser and filed in the case, saved, and opened again
 * as it was. A geolocation of a proof of a video prints the time the proof states.
 *
 * Nothing leaves the machine: the tiles, the filing and every read are answered here.
 */

const PHOTOS = ['container_yard', 'bridge_channel', 'wando_terminal'].map((name) =>
  readFileSync(new URL(`../guide/photos/${name}.jpg`, import.meta.url)));
const VIDEO = 'media/convoy.mp4';
const SHEET = 'media/Convoy on the coast road contact sheet.jpg';
const MAP = 'media/Convoy on the coast road recap map.jpg';
const SOURCE = 'https://x.com/example/status/1';

const slideRow = (name, title, slide, extra = {}) => ({
  name, title, updated_at: '2026-11-09T09:00:00Z', png: `proofs/${name}.png`, thumb: null,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 2, order: slide - 1, postable: true, ...extra,
});
const PROOFS = [
  slideRow('bridge', 'Road bridge', 1, { place: 'Al Jawf, Yemen', when: '2026-11-09', points: [{ lat: 48.85, lon: 2.35 }] }),
  slideRow('gate', 'Port gate', 2),
  slideRow('lone', 'Lone place', 1, { video: 'media/lone.mp4', video_title: 'Lone clip', slides: 1 }),
];
const sceneRow = (proof, title, moments, coords, extra = {}) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments, at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }],
  description: null, when: null, when_zone: null, ...extra,
});
const SCENES = {
  [VIDEO]: { video: VIDEO, scenes: [
    sceneRow('bridge', 'Road bridge', [{ start: 0, end: 7 }], '48.850000, 2.350000', { description: 'The convoy crosses the road bridge' }),
    sceneRow('gate', 'Port gate', [{ start: 15, end: null }], '48.860000, 2.360000'),
  ] },
  'media/lone.mp4': { video: 'media/lone.mp4', scenes: [sceneRow('lone', 'Lone place', [], '1.000000, 2.000000')] },
};
const MEDIA = [
  { path: VIDEO, filename: 'convoy.mp4', title: 'Convoy on the coast road', kind: 'video', size: 48_000_000, sha256: '1'.repeat(64),
    source: { type: 'download', url: SOURCE, webpage_url: SOURCE }, thumbnail: null, folder: '' },
  { path: 'media/lone.mp4', filename: 'lone.mp4', title: 'Lone clip', kind: 'video', size: 1_000_000, sha256: '2'.repeat(64),
    source: { type: 'upload' }, thumbnail: null, folder: '' },
];
// no title until the analyst gives one: the recap opens on its places
const RECAP = '1. [0:00–0:07] Road bridge\n2. [0:15] Port gate\n\n@GeoConfirmed';

/** A tile of one colour, as the app's tile route would answer one. */
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQUOAGAACpADOjlmHJAAAAAElFTkSuQmCC', 'base64');

/** The reads a thread makes beyond the shared fixture, and the sheet and the map it files. */
async function threadRoutes(page) {
  const sheets = [];
  const maps = [];
  const tiles = [];
  await page.route('**/api/tiles/**', (route) => {
    tiles.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: 'image/png', body: TILE });
  });
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', attribution: 'Esri, Vantor, Earthstar Geographics, and the GIS User Community', max_zoom: 19 },
    { id: 'osm', label: 'OpenStreetMap', attribution: '© OpenStreetMap contributors, openstreetmap.org/copyright', max_zoom: 19 },
  ] }));
  await page.route('**/api/settings/signature.png**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route(`**/api/cases/${CASE_ID}/scenes/map`, async (route) => {
    const body = route.request().postDataBuffer();
    maps.push({ size: body?.length ?? 0, jpeg: body?.includes(Buffer.from([0xff, 0xd8, 0xff])) ?? false });
    return route.fulfill({ json: { path: MAP } });
  });
  await page.route(`**/files/${CASE_ID}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const at = ['bridge', 'gate', 'lone'].findIndex((name) => path.includes(name));
    return route.fulfill({ contentType: 'image/jpeg', body: PHOTOS[Math.max(0, at)] });
  });
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}/scenes`, (route) => {
    const video = new URL(route.request().url()).searchParams.get('video');
    return route.fulfill({ json: SCENES[video] ?? { video, scenes: [] } });
  });
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}/inspect/probe`, (route) => route.fulfill({ json: { kind: 'video', duration: 95 } }));
  await page.route(`**/api/cases/${CASE_ID}/scenes/sheet`, async (route) => {
    const body = route.request().postDataBuffer();
    sheets.push({ size: body?.length ?? 0, jpeg: body?.includes(Buffer.from([0xff, 0xd8, 0xff])) ?? false });
    return route.fulfill({ json: { path: SHEET } });
  });
  return Object.assign(sheets, { maps, tiles });
}

const home = (page) => page.getByTestId('post-home');
const posts = (page) => page.locator('.tweet-block');
const lookups = Object.fromEntries(PROOFS.map((row) => [row.png, { id: `p-${row.name}`, type: 'proof' }]));

test('a video of one proof is offered no thread, and its proof still waits for its post', async ({ page }) => {
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  await threadRoutes(page);
  await page.goto('/#post');
  const lone = home(page).locator('.ph-video', { hasText: 'Lone clip' });
  await expect(lone.locator('.ph-chip')).toHaveCount(1);
  await expect(lone.getByRole('button', { name: 'Video thread' })).toHaveCount(0);
  await expect(home(page).locator('.ph-video', { hasText: 'Convoy on the coast road' }).getByRole('button', { name: 'Video thread' })).toBeVisible();

  await home(page).getByRole('button', { name: 'New post' }).click();
  await page.getByRole('dialog', { name: 'New post' }).locator('.np-card', { hasText: 'Video thread' }).click();
  const picker = page.getByRole('dialog', { name: 'Video thread' });
  await expect(picker.locator('.vp-title')).toHaveText(['Convoy on the coast road']);
  fixture.expectNoUnexpectedRequests();
});

test('Recap first opens on a map previewed with no tile asked, shows it on a press, and files it once made', async ({ page }) => {
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  const sheets = await threadRoutes(page);
  await page.goto('/#post');
  await home(page).getByRole('button', { name: 'New post' }).click();
  await page.getByRole('dialog', { name: 'New post' }).locator('.np-card', { hasText: 'Video thread' }).click();
  await page.getByRole('dialog', { name: 'Video thread' }).locator('.vp-row', { hasText: 'Convoy on the coast road' }).click();

  const recap = page.getByTestId('recap-picture');
  await expect(recap.getByRole('radiogroup', { name: 'Recap picture' }).getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'true');
  await expect(recap.locator('.rm-preview img')).toHaveAttribute('src', /^blob:/);
  // drawn on a plain ground: not one tile asked before the press
  expect(sheets.tiles).toEqual([]);
  await recap.getByRole('button', { name: 'Show the map' }).click();
  await expect.poll(() => sheets.tiles.length).toBeGreaterThan(0);
  expect(sheets.tiles.every((path) => path.startsWith('/api/tiles/esri-world-imagery/'))).toBe(true);
  // a ground picked asks that ground's tiles
  await recap.getByRole('radiogroup', { name: 'Background' }).getByRole('radio', { name: 'Map' }).click();
  await expect.poll(() => sheets.tiles.some((path) => path.startsWith('/api/tiles/osm/'))).toBe(true);
  await recap.getByText('Line in video order').click();

  await recap.getByRole('button', { name: 'Make the map' }).click();
  await expect(recap.getByTestId('recap-made')).toHaveText(/On the recap/);
  expect(sheets.maps).toHaveLength(1);
  expect(sheets.maps[0].jpeg).toBe(true);
  expect(sheets).toHaveLength(0);
  await expect(posts(page).first().locator('.first-pics img')).toHaveAttribute('src', /recap%20map\.jpg/);
  await expect.poll(() => fixture.draftWrites.at(-1)?.state?.map).toBe(MAP);
  expect(fixture.draftWrites.at(-1).state).toMatchObject({
    recap: 'map', firstMedia: [MAP], mapOptions: { background: 'map', line: true },
  });
  fixture.expectNoUnexpectedRequests();
});

test('New post → Video thread lays out Recap first with its sheet, saves it, and opens it again as it was', async ({ page }) => {
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  const sheets = await threadRoutes(page);
  await page.goto('/#post');
  await home(page).getByRole('button', { name: 'New post' }).click();
  await page.getByRole('dialog', { name: 'New post' }).locator('.np-card', { hasText: 'Video thread' }).click();
  await page.getByRole('dialog', { name: 'Video thread' }).locator('.vp-row', { hasText: 'Convoy on the coast road' }).click();
  await page.getByTestId('recap-picture').getByRole('radio', { name: 'Proofs sheet' }).click();

  // a video thread's own column: the header may fold the kind's name to its icon
  await expect(page.getByTestId('video-thread')).toBeVisible();
  // named after neither the video nor its places: no name until the analyst gives one
  await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue('');
  await expect(posts(page).locator('.tweet-head .label')).toHaveText(['Recap', 'Video', 'Road bridge', 'Port gate']);
  await expect(posts(page).first().locator('textarea')).toHaveValue(RECAP);
  await expect(posts(page).nth(1).locator('textarea')).toHaveValue(`Source: ${SOURCE}`);
  await expect(posts(page).nth(3).locator('textarea')).toHaveValue('Port gate\n[0:15]\n\n48.860000, 2.360000');
  // the browser drew the sheet, a JPEG, and the case filed it for the recap
  await expect(posts(page).first().locator('.first-pics img')).toHaveAttribute('src', /contact%20sheet\.jpg/);
  expect(sheets).toHaveLength(1);
  expect(sheets[0].jpeg).toBe(true);

  await expect.poll(() => fixture.draftWrites.at(-1)?.state?.sheet).toBe(SHEET);
  const state = fixture.draftWrites.at(-1).state;
  expect(state).toMatchObject({ kind: 'video', video: VIDEO, order: 'recap', firstMedia: [SHEET], tweet1: RECAP });
  expect(state.extraTweets.map((one) => one.key)).toEqual(['video', 'place:bridge', 'place:gate']);

  // back home, the series has its thread, and its card opens it as it was
  await page.locator('.tool-header').getByRole('button', { name: 'Posts' }).click();
  await expect(home(page).locator('.ph-video', { hasText: 'Convoy on the coast road' }).getByRole('button', { name: 'Video thread' })).toHaveCount(0);
  // a thread with no name of its own reads as its first place and its day
  const card = home(page).locator('.post-card', { hasText: 'Al Jawf, Yemen · 9 Nov' });
  await expect(card.locator('.ph-line')).toHaveText('X · Video thread · 4 posts');
  await card.locator('.ph-open').click();
  await expect(posts(page).locator('.tweet-head .label')).toHaveText(['Recap', 'Video', 'Road bridge', 'Port gate']);
  await expect(posts(page).first().locator('textarea')).toHaveValue(RECAP);
  await expect(page.getByTestId('video-thread').locator('.vt-order.on .vt-order-name')).toHaveText('Recap first');
  await expect(page.getByTestId('recap-picture').getByRole('radio', { name: 'Proofs sheet' })).toHaveAttribute('aria-checked', 'true');
  expect(sheets).toHaveLength(1);
  fixture.expectNoUnexpectedRequests();
});

test('places too close together for a map leave the proofs sheet on the recap, and the column says so', async ({ page }) => {
  const near = { ...SCENES[VIDEO], scenes: SCENES[VIDEO].scenes.map((row) => ({ ...row, points: [{ lat: 48.85, lon: 2.35, coords: '48.850000, 2.350000', label: '' }] })) };
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  const sheets = await threadRoutes(page);
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}/scenes`, (route) => route.fulfill({ json: near }));
  await page.goto('/#post');
  await home(page).locator('.ph-video', { hasText: 'Convoy on the coast road' }).getByRole('button', { name: 'Video thread' }).click();
  const recap = page.getByTestId('recap-picture');
  await expect(recap.getByTestId('recap-fallback')).toHaveText('These places are too close together for a map, so the recap shows the proofs sheet.');
  await expect(recap.getByRole('radiogroup', { name: 'Recap picture' }).getByRole('radio', { name: 'Map' })).toBeDisabled();
  await expect(posts(page).first().locator('.first-pics img')).toHaveAttribute('src', /contact%20sheet\.jpg/);
  expect(sheets.tiles).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('a geolocation of a proof of a video prints the passage it states under its description', async ({ page }) => {
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  await threadRoutes(page);
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => route.fulfill({ json: {
    title: 'Road bridge', description: 'The convoy crosses the road bridge', coordsText: '48.850000, 2.350000', source: SOURCE,
    scene: { video: VIDEO, moments: [{ start: 0, end: 7.4 }], draft: null },
  } }));
  await page.route('**/api/geo/parse', (route) => route.fulfill({ json: { lat: 48.85, lon: 2.35, dms: '', plus_code: '8FW4V9X2+22' } }));
  await page.route('**/api/geo/reverse**', (route) => route.fulfill({ json: { address: { city: 'Paris', country: 'France' } } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/*/derivation`, (route) => route.fulfill({ json: { entities: [], links: [] } }));
  await page.goto('/#post');
  await home(page).locator('.ph-chip', { hasText: 'Road bridge' }).click();
  await expect(posts(page).first().locator('textarea')).toHaveValue([
    'Paris, France - 8FW4V9X2+22',
    '',
    'The convoy crosses the road bridge',
    '[0:00–0:07]',
    '',
    '48.850000, 2.350000',
    '',
    '@GeoConfirmed',
    '',
    `Source: ${SOURCE}`,
  ].join('\n'));
  await expect(page.locator('#pc-timecode')).toHaveValue('[0:00–0:07]');
  fixture.expectNoUnexpectedRequests();
});
