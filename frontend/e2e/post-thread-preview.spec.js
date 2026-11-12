import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The thread's preview in Post, in a browser: Preview over the thread's column shows the
 * posts as they go out, each with its words, its pictures framed as the site frames them,
 * an ALT mark, its count and what runs past the limit; X or Bluesky switches its look and
 * its limits; Write brings the posts back. Showing it reads nothing from the case but the
 * thumbnails, and a recap map still to make is shown on the column's small preview,
 * never made or fetched for it.
 *
 * Nothing leaves the machine: every read is answered here.
 */

const PHOTOS = ['container_yard', 'bridge_channel', 'wando_terminal', 'miami_port_aerial']
  .map((name) => readFileSync(new URL(`../guide/photos/${name}.jpg`, import.meta.url)));
const PROOF_PICTURE = readFileSync(new URL('../src/assets/guide/proof-result.webp', import.meta.url));
const SOURCE = 'https://www.instagram.com/reel/C8kXyZaBcDe/?igsh=MWZ1dGx0a2Y0';
const FIRST = [
  'Al Jawf, Yemen - 7H872G9H+FC', '', 'A formation of 13 helicopters heading East', '', '16.018740, 45.528599', '',
  '@GeoConfirmed', '', `Source: ${SOURCE}`,
].join('\n');
const METHOD = `Method: ${'the pylons, the deck line and the cranes line up from one place only. '.repeat(5).trim()}`;
const PICTURES = ['media/yard.jpg', 'media/channel.jpg', 'media/terminal.jpg', 'media/port.jpg'];

const mediaRow = (path, i, extra = {}) => ({
  path, filename: path.split('/').pop(), title: path, kind: 'image', size: 1_000_000, sha256: String(i).repeat(64),
  source: { type: 'upload' }, thumbnail: `media/.thumbs/${i}.jpg`, folder: '', ...extra,
});
const MEDIA = PICTURES.map((path, i) => mediaRow(path, i + 1));
const PROOFS = [{ name: 'bridge', title: 'Road bridge', updated_at: '2026-11-09T09:00:00Z', png: 'proofs/bridge.png', thumb: 'media/.thumbs/bridge.jpg', video: null }];
const DRAFTS = {
  'Bridge thread': {
    title: 'Bridge thread', updated_at: '2026-11-10T08:00:00Z',
    state: {
      target: 'x', proofPng: 'proofs/bridge.png', tweet1: FIRST, tweet1Edited: true, source: SOURCE,
      mediaEnabled: true, mediaType: 'images', mediaPaths: PICTURES.slice(0, 3),
      mediaText: '2/ Image:\nThe yard and the channel', mediaTextIncludesPrefix: true,
      extraTweets: [
        { text: METHOD, mediaType: 'none', mediaPaths: [] },
        { text: '4/ Image:', mediaType: 'images', mediaPaths: PICTURES, isMediaTweet: true, mediaTextIncludesPrefix: true },
      ],
      alt: { 'proofs/bridge.png': 'Thirteen helicopters over a desert road' },
    },
  },
};
const lookups = {
  'proofs/bridge.png': { id: 'p-bridge', type: 'proof' },
  '.drafts/Bridge thread.json': { id: 'd-bridge', type: 'post' },
};

/** Pictures, and what else Post reads around a saved post. */
async function postRoutes(page) {
  const files = [];
  await page.route(`**/files/${CASE_ID}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    files.push(path);
    if (path.includes('bridge')) return route.fulfill({ contentType: 'image/webp', body: PROOF_PICTURE });
    const at = Number(/(\d)\.jpg$/.exec(path)?.[1] ?? 1) - 1;
    return route.fulfill({ contentType: 'image/jpeg', body: PHOTOS[at % PHOTOS.length] });
  });
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => route.fulfill({ json: { title: 'Road bridge', source: SOURCE } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/*/derivation`, (route) => route.fulfill({ json: { entities: [], links: [] } }));
  return files;
}

/** Every request the page makes from now on. */
function watch(page) {
  const asked = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  return asked;
}

const tab = (page, name) => page.getByRole('tablist', { name: 'The thread' }).getByRole('tab', { name });
const shown = (page) => page.getByTestId('preview-post');

test('Preview shows the thread as it goes out on X, then on Bluesky, reading only thumbnails', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const fixture = await installAppFixture(page, { drafts: DRAFTS, proofList: PROOFS, media: MEDIA, lookupEntities: lookups, settings: { signature_handle: '@desk' } });
  const files = await postRoutes(page);
  await page.goto('/#post');
  await page.getByTestId('post-home').locator('.post-card', { hasText: 'Bridge thread' }).locator('.ph-open').click();
  await expect(page.locator('.tweet-block')).toHaveCount(4);
  await expect(tab(page, 'Write')).toHaveAttribute('aria-selected', 'true');

  const asked = watch(page);
  await tab(page, 'Preview').click();
  await expect(page.locator('.tweet-block')).toHaveCount(0);
  await expect(shown(page)).toHaveCount(4);
  await expect(page.getByTestId('thread-preview-sum')).toHaveText('4 posts · 1 too long');

  // each post's words as X shows them, and its count
  const first = shown(page).first();
  await expect(first.locator('.tp-name')).toHaveText('@desk');
  await expect(first.locator('.tp-text')).toHaveText(FIRST.replace(SOURCE, 'instagram.com/reel/C8kXyZ…'));
  await expect(first.locator('.tp-link')).toHaveText(['@GeoConfirmed', 'instagram.com/reel/C8kXyZ…']);
  await expect(shown(page).locator('.tp-count')).toHaveText(['142/280', '34/280', `${METHOD.length}/280`, '9/280']);
  await expect(shown(page).nth(2).locator('mark.tp-over')).toHaveText(METHOD.slice(280));

  // the pictures, framed one to four, the proof's text marked
  await expect(shown(page).locator('[data-testid="preview-media"]')).toHaveClass([/n1/, /n3/, /n4/]);
  await expect(first.locator('.tp-alt')).toHaveText('ALT');
  await expect(first.locator('img')).toHaveAttribute('alt', 'Thirteen helicopters over a desert road');
  for (const img of await page.getByTestId('thread-preview').locator('img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  // at 1024 px with the case panel open, the thread sits whole in its column
  const column = await page.locator('.layout > .col').nth(1).boundingBox();
  const thread = await page.getByTestId('thread-preview').boundingBox();
  expect(thread.x + thread.width).toBeLessThanOrEqual(column.x + column.width + 1);
  // the line joins each post to the next, and stops at the last
  await expect(shown(page)).toHaveClass([/linked/, /linked/, /linked/, /^(?!.*linked)/]);

  // showing it read only pictures, and thumbnails at that, never a file whole
  expect(asked.filter((path) => !path.startsWith('/files/'))).toEqual([]);
  const pictures = files.filter((path) => asked.includes(path));
  expect(pictures.length).toBeGreaterThan(0);
  expect(pictures.every((path) => path.includes('/media/.thumbs/'))).toBe(true);

  // Bluesky: its limit, its links, its frames
  await page.locator('.target-tabs').getByRole('button', { name: 'Bluesky', exact: true }).click();
  await expect(shown(page).locator('.tp-count')).toHaveText(['152/300', '34/300', `${METHOD.length}/300`, '9/300']);
  await expect(first.locator('.tp-link')).toHaveText(['www.instagram.com/reel/C8kXyZa...']);
  const block = shown(page).nth(3).locator('[data-testid="preview-media"]');
  const box = await block.boundingBox();
  expect(box.width / box.height).toBeCloseTo(1.5, 1);

  await tab(page, 'Write').click();
  await expect(page.getByTestId('thread-preview')).toHaveCount(0);
  await expect(page.locator('.tweet-block')).toHaveCount(4);
  // the platform picked is the post's own, and it saves itself
  await expect.poll(() => fixture.draftWrites.at(-1)?.state?.target).toBe('bluesky');
  await expect(page.locator('.save-status')).toContainText('Saved');
  fixture.expectNoUnexpectedRequests();
});

// ---- a video thread, Recap first on its map ----------------------------------------
const VIDEO = 'media/convoy.mp4';
const slideRow = (name, title, slide, extra = {}) => ({
  name, title, updated_at: '2026-11-09T09:00:00Z', png: `proofs/${name}.png`, thumb: null,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 2, order: slide - 1, postable: true, ...extra,
});
const SLIDES = [
  slideRow('bridge', 'Road bridge', 1, { place: 'Al Jawf, Yemen', when: '2026-11-09', points: [{ lat: 48.85, lon: 2.35 }] }),
  slideRow('gate', 'Port gate', 2),
];
const sceneRow = (proof, title, moments, coords) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments, at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }],
  description: null, when: null, when_zone: null,
});
const SCENES = { video: VIDEO, scenes: [
  sceneRow('bridge', 'Road bridge', [{ start: 0, end: 7 }], '48.850000, 2.350000'),
  sceneRow('gate', 'Port gate', [{ start: 15, end: null }], '48.860000, 2.360000'),
] };
const VIDEO_MEDIA = [{
  path: VIDEO, filename: 'convoy.mp4', title: 'Convoy on the coast road', kind: 'video', size: 48_000_000, sha256: '9'.repeat(64),
  source: { type: 'download', url: 'https://x.com/example/status/1', webpage_url: 'https://x.com/example/status/1' },
  thumbnail: 'media/.thumbs/3.jpg', folder: '',
}];

test('a video thread’s recap shows its map still to make on the column’s preview, and nothing makes it', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    proofList: SLIDES, media: VIDEO_MEDIA,
    lookupEntities: Object.fromEntries(SLIDES.map((row) => [row.png, { id: `p-${row.name}`, type: 'proof' }])),
  });
  await postRoutes(page);
  const made = [];
  await page.route('**/api/tiles/**', (route) => {
    made.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route(`**/api/cases/${CASE_ID}/scenes/map`, (route) => {
    made.push('map');
    return route.fulfill({ json: { path: 'media/map.jpg' } });
  });
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/settings/signature.png**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}/scenes`, (route) => route.fulfill({ json: SCENES }));
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}/inspect/probe`, (route) => route.fulfill({ json: { kind: 'video', duration: 95 } }));
  await page.goto('/#post');
  await page.getByTestId('post-home').getByRole('button', { name: 'New post' }).click();
  await page.getByRole('dialog', { name: 'New post' }).locator('.np-card', { hasText: 'Video thread' }).click();
  await page.getByRole('dialog', { name: 'Video thread' }).locator('.vp-row', { hasText: 'Convoy on the coast road' }).click();
  const drawn = await page.getByTestId('recap-picture').locator('.rm-preview img').getAttribute('src', { timeout: 10_000 });
  expect(drawn).toMatch(/^blob:/);

  await tab(page, 'Preview').click();
  await expect(shown(page)).toHaveCount(4);
  const recap = shown(page).first().locator('.tp-pic.later');
  await expect(recap.locator('img')).toHaveAttribute('src', drawn);
  await expect(shown(page).first().locator('.tp-later')).toHaveText('The map is made when you publish.');
  await expect(shown(page).nth(1).locator('.tp-play')).toBeVisible();
  await expect(shown(page).locator('.tp-count')).toHaveText([/\/280$/, /\/280$/, /\/280$/, /\/280$/]);
  expect(made).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});
