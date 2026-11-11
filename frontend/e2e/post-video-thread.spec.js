import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A video thread in Post, in a browser: offered for a video of two proofs or more and
 * for no other, laid out Recap first with its contact sheet drawn by the browser and
 * filed in the case, saved, and opened again as it was. A geolocation of a proof of a
 * video prints the time the proof states.
 *
 * Nothing leaves the machine: the sheet's filing and every read are answered here.
 */

const PHOTOS = ['container_yard', 'bridge_channel', 'wando_terminal'].map((name) =>
  readFileSync(new URL(`../guide/photos/${name}.jpg`, import.meta.url)));
const VIDEO = 'media/convoy.mp4';
const SHEET = 'media/Convoy on the coast road contact sheet.jpg';
const SOURCE = 'https://x.com/example/status/1';

const slideRow = (name, title, slide, extra = {}) => ({
  name, title, updated_at: '2026-11-09T09:00:00Z', png: `proofs/${name}.png`, thumb: null,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 2, order: slide - 1, postable: true, ...extra,
});
const PROOFS = [
  slideRow('bridge', 'Road bridge', 1), slideRow('gate', 'Port gate', 2),
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

/** The reads a thread makes beyond the shared fixture, and the sheet it files. */
async function threadRoutes(page) {
  const sheets = [];
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
  return sheets;
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

test('New post → Video thread lays out Recap first with its sheet, saves it, and opens it again as it was', async ({ page }) => {
  const fixture = await installAppFixture(page, { proofList: PROOFS, media: MEDIA, lookupEntities: lookups });
  const sheets = await threadRoutes(page);
  await page.goto('/#post');
  await home(page).getByRole('button', { name: 'New post' }).click();
  await page.getByRole('dialog', { name: 'New post' }).locator('.np-card', { hasText: 'Video thread' }).click();
  await page.getByRole('dialog', { name: 'Video thread' }).locator('.vp-row', { hasText: 'Convoy on the coast road' }).click();

  // a video thread's own column: the header may fold the kind's name to its icon
  await expect(page.getByTestId('video-thread')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue('Convoy on the coast road');
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
  const card = home(page).locator('.post-card', { hasText: 'Convoy on the coast road' });
  await expect(card.locator('.ph-line')).toHaveText('X · Video thread · 4 posts');
  await card.locator('.ph-open').click();
  await expect(posts(page).locator('.tweet-head .label')).toHaveText(['Recap', 'Video', 'Road bridge', 'Port gate']);
  await expect(posts(page).first().locator('textarea')).toHaveValue(RECAP);
  await expect(page.getByTestId('video-thread').locator('.vt-order.on .vt-order-name')).toHaveText('Recap first');
  expect(sheets).toHaveLength(1);
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
