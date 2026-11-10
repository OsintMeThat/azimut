import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Post, in a browser: the home a case with drafts and proofs opens on, the New post
 * gallery, the extension window, Reply under the source, and post templates per kind.
 * A geolocation must come out exactly as Geo Report wrote it, so the first post a
 * proof gives is pinned here too.
 *
 * Nothing leaves the machine: the source post's reply page is caught where it would
 * open, and the clipboard is read back in the page.
 */

const PROOF_PICTURE = readFileSync(new URL('../src/assets/guide/proof-result.webp', import.meta.url));
const PHOTO = readFileSync(new URL('../guide/photos/container_yard.jpg', import.meta.url));
const SOURCE_X = 'https://x.com/someone/status/1850000000000000000';
const GEO = { lat: 33.736901, lon: -118.272552, dms: '33°44′12.8″N 118°16′21.2″W', plus_code: '8553PPP4+QX' };
const FIRST_POST = [
  'San Pedro, California, United States - 8553PPP4+QX',
  '',
  'Where this photo of the Vincent Thomas Bridge was taken',
  '',
  '33.736901, -118.272552',
  '',
  '@GeoConfirmed',
  '',
  `Source: ${SOURCE_X}`,
].join('\n');

const proofRow = (name, title, extra = {}) => ({
  name, title, updated_at: '2026-11-09T09:00:00Z', png: `proofs/${name}.png`, thumb: null, video: null, ...extra,
});
const PROOFS = [
  proofRow('bridge', 'Vincent Thomas Bridge'),
  proofRow('terminal', 'Container terminal'),
  proofRow('port-1', 'Port gate', { video: 'media/convoy.mp4', video_title: 'Convoy along the port', slide: 1, slides: 2, order: 0 }),
  proofRow('port-2', 'Coast road', { video: 'media/convoy.mp4', video_title: 'Convoy along the port', slide: 2, slides: 2, order: 1 }),
];
const draft = (title, state) => ({ title, updated_at: '2026-11-10T08:00:00Z', state });
const DRAFTS = {
  'Bridge thread': draft('Bridge thread', {
    target: 'bluesky', proofPng: 'proofs/terminal.png', mediaType: 'images', mediaPaths: ['media/panel.svg'],
    extraTweets: [{ text: 'Method: the pylons and the deck line.' }],
  }),
  'Harbour words': draft('Harbour words', { target: 'x', kind: 'free', firstMedia: ['media/panel.svg'] }),
};

/** The routes Post reads beyond the shared fixture: proof pictures and specs, the point's address. */
async function postRoutes(page) {
  await page.route(`**/files/${CASE_ID}/proofs/**`, (route) => route.fulfill({ contentType: 'image/webp', body: PROOF_PICTURE }));
  await page.route(`**/files/${CASE_ID}/media/convoy.jpg`, (route) => route.fulfill({ contentType: 'image/jpeg', body: PHOTO }));
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => route.fulfill({
    json: {
      title: 'Vincent Thomas Bridge',
      description: 'Where this photo of the Vincent Thomas Bridge was taken',
      coordsText: '33.736901, -118.272552',
      source: SOURCE_X,
    },
  }));
  await page.route('**/api/geo/parse', (route) => route.fulfill({ json: GEO }));
  await page.route('**/api/geo/reverse**', (route) => route.fulfill({
    json: { address: { city: 'San Pedro', state: 'California', country: 'United States' } },
  }));
  await page.route(`**/api/cases/${CASE_ID}/entities/*/derivation`, (route) => route.fulfill({ json: { entities: [], links: [] } }));
}

/** Pages Post opens, caught instead of opened, and the clipboard as the page wrote it. */
async function catchWhatLeaves(page) {
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(url);
      return null;
    };
    window.__clipboard = [];
    const clipboard = {
      writeText: async (text) => window.__clipboard.push({ text }),
      write: async (items) => window.__clipboard.push({ types: items.flatMap((item) => item.types ?? []) }),
      readText: async () => '',
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  });
}

const lookups = Object.fromEntries([
  ...PROOFS.map((row) => [row.png, { id: `p-${row.name}`, type: 'proof' }]),
  ...Object.keys(DRAFTS).map((name) => [`.drafts/${name}.json`, { id: `d-${name}`, type: 'post' }]),
]);

test.describe('the home', () => {
  test('a case with nothing to list keeps the composer it always had', async ({ page }) => {
    const fixture = await installAppFixture(page);
    await page.goto('/#post');
    await expect(page.locator('.tabstrip').getByRole('button', { name: 'Post', exact: true })).toHaveAttribute('title', 'Formerly Geo Report');
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    for (const label of ['Description', 'Coordinates', 'Place', 'Mention', 'Source']) {
      await expect(page.locator('.col .label', { hasText: label }).first()).toBeVisible();
    }
    await expect(page.getByTestId('post-home')).toHaveCount(0);
    fixture.expectNoUnexpectedRequests();
  });

  test('lists the drafts and what is ready to post, and a proof opens its geolocation', async ({ page }) => {
    const fixture = await installAppFixture(page, { drafts: DRAFTS, proofList: PROOFS, lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    const home = page.getByTestId('post-home');
    await expect(home).toBeVisible();

    const drafts = home.locator('.ph-cards').first().locator('.ph-card');
    await expect(drafts).toHaveCount(2);
    await expect(drafts.nth(0)).toContainText('Bluesky · 3 posts');
    await expect(drafts.nth(1)).toContainText('X · Free post · 1 post');
    // the terminal's proof has its draft; the bridge waits, and the video's slides under it
    const ready = home.locator('.ph-cards').nth(1).locator('.ph-card');
    await expect(ready).toHaveCount(1);
    await expect(ready).toContainText('Vincent Thomas Bridge');
    const series = home.locator('.ph-video');
    await expect(series).toContainText('Convoy along the port');
    await expect(series.locator('.ph-chip')).toHaveCount(2);
    await expect(series.getByRole('button', { name: /Video thread/ })).toBeDisabled();

    await home.getByLabel('Find a draft by name').fill('harb');
    await expect(home.locator('.ph-hit')).toHaveCount(1);
    await home.getByLabel('Find a draft by name').fill('');

    await ready.click();
    await expect(home).toHaveCount(0);
    await expect(page.locator('.tweet-block textarea').first()).toHaveValue(FIRST_POST);
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    // it saved itself on the way: back home, nothing is asked and it is a draft now
    await page.locator('.tool-header').getByRole('button', { name: 'Posts' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(home).toBeVisible();
    expect(fixture.draftWrites.at(-1).state.proofPng).toBe('proofs/bridge.png');
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('the home in three parts', () => {
  const PARTS = {
    ...DRAFTS,
    'Opened one': draft('Opened one', { target: 'x', proofPng: 'proofs/port-1.png', publish: { opened_at: '2026-11-10T09:00:00Z', site: 'x' } }),
    'Gone out': draft('Gone out', {
      target: 'x', proofPng: 'proofs/port-2.png',
      publish: { opened_at: '2026-11-10T09:00:00Z', site: 'x', url: 'https://x.com/desk/status/1850000000000000009', posted_at: '2026-11-10T09:05:00Z', mark: 'm', changed: false },
    }),
  };

  test('In progress, Ready to post and Posted, each card wearing its state, and a card deletes with Undo', async ({ page }) => {
    const fixture = await installAppFixture(page, { drafts: PARTS, proofList: PROOFS, lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    const home = page.getByTestId('post-home');
    await expect(home.locator('h4')).toHaveText(['In progress', 'Ready to post', 'Posted']);
    await expect(home.getByRole('button', { name: 'New post' })).toBeVisible();
    const progress = home.locator('[data-part="progress"]');
    await expect(progress.locator('.ph-title')).toHaveText(['Bridge thread', 'Harbour words', 'Opened one']);
    await expect(progress.locator('.ph-pill')).toHaveText(['Draft', 'Draft', 'Opened in X']);
    const posted = home.locator('[data-part="posted"]');
    await expect(posted.locator('.ph-title')).toHaveText(['Gone out']);
    await expect(posted.locator('.ph-pill')).toHaveText(['Posted']);
    await expect(posted.getByRole('link')).toHaveAttribute('href', 'https://x.com/desk/status/1850000000000000009');

    // a right-click and the ⋯ open the same menu
    await progress.locator('.post-card', { hasText: 'Harbour words' }).click({ button: 'right' });
    const menu = page.locator('.float-menu[aria-label="Harbour words"]');
    await expect(menu.locator('.fm-item')).toHaveText(['Open', 'Delete…']);
    await page.keyboard.press('Escape');
    await progress.locator('.post-card', { hasText: 'Harbour words' }).hover();
    await progress.getByRole('button', { name: 'More for Harbour words' }).click();
    await menu.getByRole('button', { name: 'Delete…' }).click();
    await page.getByRole('alertdialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(progress.locator('.ph-title')).toHaveText(['Bridge thread', 'Opened one']);
    await page.locator('.toast', { hasText: 'Deleted “Harbour words”' }).getByRole('button', { name: 'Undo' }).click();
    await expect(progress.locator('.post-card', { hasText: 'Harbour words' })).toHaveCount(1);
    await expect(progress.locator('.post-card')).toHaveCount(3);
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('Open', () => {
  test('lists every post with its picture, kind, platform and state, filters them, and deletes one with Undo', async ({ page }) => {
    const ALL = {
      ...DRAFTS,
      'Gone out': draft('Gone out', {
        target: 'x', proofPng: 'proofs/bridge.png',
        publish: { site: 'x', url: 'https://x.com/desk/status/1850000000000000009', posted_at: '2026-11-10T09:05:00Z', mark: 'm', changed: false },
      }),
    };
    const fixture = await installAppFixture(page, { drafts: ALL, proofList: PROOFS, lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    await page.locator('.tool-header').getByRole('button', { name: 'Open' }).click();
    const list = page.getByRole('dialog', { name: 'Open a post' });
    const titles = list.locator('.ol-title');
    await expect(titles).toHaveText(['Bridge thread', 'Harbour words', 'Gone out']);
    await expect(list.locator('.ol-sub')).toHaveText([/^Geolocation · Bluesky · /, /^Free post · X · /, /^Geolocation · X · /]);
    await expect(list.locator('.ol-pill')).toHaveText(['Draft', 'Draft', 'Posted']);
    await expect(list.locator('.ol-row').first().locator('img')).toHaveAttribute('src', /proofs\/terminal\.png/);

    await list.getByRole('combobox', { name: 'Kind' }).selectOption('geolocation');
    await expect(titles).toHaveText(['Bridge thread', 'Gone out']);
    await list.getByRole('combobox', { name: 'State' }).selectOption('posted');
    await expect(titles).toHaveText(['Gone out']);
    await list.getByRole('combobox', { name: 'Kind' }).selectOption('');
    await list.getByRole('combobox', { name: 'State' }).selectOption('');
    await list.getByPlaceholder('Search posts…').fill('harbour');
    await expect(titles).toHaveText(['Harbour words']);
    await list.getByPlaceholder('Search posts…').fill('');

    await list.getByRole('button', { name: 'Delete Bridge thread' }).click();
    await page.getByRole('alertdialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(titles).toHaveText(['Harbour words', 'Gone out']);
    await page.locator('.toast', { hasText: 'Deleted “Bridge thread”' }).getByRole('button', { name: 'Undo' }).click();
    await expect(list.locator('.ol-row', { hasText: 'Bridge thread' })).toHaveCount(1);

    await list.locator('.ol-open', { hasText: 'Harbour words' }).click();
    await expect(list).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue('Harbour words');
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('a post saves itself', () => {
  test('files nothing for a blank post, then saves as it is written, the header saying so', async ({ page }) => {
    const fixture = await installAppFixture(page);
    await page.goto('/#post');
    const header = page.locator('.tool-header');
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(fixture.draftWrites).toEqual([]);
    await expect(header.locator('.save-status')).toHaveCount(0);
    await expect(header.getByRole('button', { name: /Save/ })).toHaveCount(0);

    await page.locator('#pc-desc').fill('Smoke over the depot');
    await expect(header.locator('.save-status')).toHaveText('Saved');
    expect(fixture.draftWrites).toHaveLength(1);
    expect(fixture.draftWrites[0]).toMatchObject({ rename_from: null, title: 'Post 1' });

    // renamed when the field is left, the file moved with it
    const name = page.getByRole('textbox', { name: 'Post name' });
    await name.fill('Depot smoke');
    await name.press('Enter');
    await expect.poll(() => fixture.draftWrites.at(-1)).toMatchObject({ rename_from: 'Post 1', title: 'Depot smoke' });
    await expect(header.locator('.save-status')).toHaveText('Saved');
    fixture.expectNoUnexpectedRequests();
  });

  test('deletes the post open from its ⋯, back home, and Undo brings it back', async ({ page }) => {
    const fixture = await installAppFixture(page, { drafts: DRAFTS, proofList: PROOFS, lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    const home = page.getByTestId('post-home');
    await home.locator('.ph-card', { hasText: 'Harbour words' }).click();
    await expect(page.getByRole('textbox', { name: 'Post name' })).toHaveValue('Harbour words');

    await page.getByRole('button', { name: 'More for this post' }).click();
    const menu = page.locator('.float-menu[aria-label="This post"]');
    await expect(menu.locator('.fm-item')).toHaveText(['Add to notes…', 'Delete…']);
    await menu.getByRole('button', { name: 'Delete…' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Delete this post?' });
    await ask.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(home).toBeVisible();
    await expect(home.locator('.ph-card', { hasText: 'Harbour words' })).toHaveCount(0);

    await page.locator('.toast', { hasText: 'Deleted “Harbour words”' }).getByRole('button', { name: 'Undo' }).click();
    await expect(home.locator('.ph-card', { hasText: 'Harbour words' })).toHaveCount(1);
    expect(fixture.trashWrites).toEqual([{ kind: 'restore', groupId: 'trash-draft-1' }]);
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('whether it went out', () => {
  test('Publish asks quietly, and the link pasted marks it posted on the draft', async ({ page }) => {
    await catchWhatLeaves(page);
    const fixture = await installAppFixture(page, { proofList: [PROOFS[0]], lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    await page.getByTestId('post-home').locator('.ph-card').first().click();
    await expect(page.locator('.tweet-block textarea').first()).toHaveValue(FIRST_POST);

    const went = page.locator('.went');
    await expect(went).toHaveCount(0);
    await page.getByRole('button', { name: 'Publish on X' }).click();
    await expect(went).toHaveText(/It went out\?\s*Yes, paste its link\s*Not yet/);
    await went.getByRole('button', { name: 'Yes, paste its link' }).click();
    const field = went.getByRole('textbox', { name: 'The post\'s address' });
    await expect(field).toBeFocused();
    await field.fill('https://example.com/elsewhere');
    await field.press('Enter');
    await expect(went).toContainText('That is not the address of an X or Bluesky post.');
    await field.fill('https://x.com/desk/status/1850000000000000009?s=20');
    await went.getByRole('button', { name: 'Mark as posted' }).click();
    await expect(went).toContainText(/Posted on X · \d{4}-\d{2}-\d{2}/);
    await expect(went.getByRole('link')).toHaveAttribute('href', 'https://x.com/desk/status/1850000000000000009');
    await expect.poll(() => fixture.draftWrites.at(-1)?.state.publish).toMatchObject({
      site: 'x', url: 'https://x.com/desk/status/1850000000000000009', changed: false,
    });

    // an edit after it went out says so
    await page.locator('#pc-desc').fill('A second look at the bridge');
    await expect(went).toContainText('Changed since posted on X');
    await expect.poll(() => fixture.draftWrites.at(-1)?.state.publish.changed).toBe(true);
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('New post', () => {
  test('offers four starts, and each built one opens its own post', async ({ page }) => {
    const fixture = await installAppFixture(page, { drafts: DRAFTS, proofList: PROOFS, lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    await page.getByTestId('post-home').getByRole('button', { name: 'New post' }).click();

    const gallery = page.getByRole('dialog', { name: 'New post' });
    const cards = gallery.locator('.np-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('Geolocation');
    await expect(cards.nth(1)).toContainText('Coming next');
    await expect(cards.nth(1)).toBeDisabled();

    await cards.nth(0).click();
    await expect(gallery).toHaveCount(0);
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    await expect(page.locator('.kind-chip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Attach a proof' })).toBeVisible();

    await page.locator('.tool-header').getByRole('button', { name: 'Posts' }).click();
    await page.getByTestId('post-home').getByRole('button', { name: 'New post' }).click();
    await gallery.locator('.np-card', { hasText: 'Free post' }).click();
    await expect(page.locator('.kind-chip')).toHaveText('Free post');
    await expect(page.locator('#pc-coords')).toHaveCount(0);
    await expect(page.getByText('First post', { exact: true })).toBeVisible();
    await page.locator('.first-media').getByRole('button', { name: 'Image' }).click();
    await page.locator('.first-media').getByRole('button', { name: 'Add media' }).click();
    await page.locator('.picker-item').first().click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.first-media .attach-chip')).toContainText('panel.svg');
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('the extension window', () => {
  test('says once why, then a quiet line stays while the extension is missing', async ({ page }) => {
    const fixture = await installAppFixture(page, { postExtensionWindow: true });
    await page.goto('/#post');
    const window = page.getByRole('dialog', { name: 'Post works best with the extension' });
    await expect(window).toBeVisible();
    await expect(window).toContainText('fills the whole thread in X or Bluesky, pictures included');
    await window.getByRole('button', { name: 'Not now' }).click();
    await expect(window).toHaveCount(0);
    const quiet = page.locator('.ext-quiet');
    await expect(quiet).toHaveText(/Extension not connected · Install/);
    // and Publish is still there without it
    await expect(page.getByRole('button', { name: 'Publish on X' })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    await expect(window).toHaveCount(0);
    await expect(quiet).toBeVisible();

    await quiet.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByRole('dialog', { name: /Capture extension/ }).or(page.locator('.guide'))).toBeVisible();
    fixture.expectNoUnexpectedRequests();
  });

  test('opens the guide on the install page from How to install', async ({ page }) => {
    const fixture = await installAppFixture(page, { postExtensionWindow: true });
    await page.goto('/#post');
    await page.getByRole('dialog', { name: 'Post works best with the extension' }).getByRole('button', { name: 'How to install' }).click();
    await expect(page.getByRole('dialog', { name: 'Post works best with the extension' })).toHaveCount(0);
    await expect(page.getByText('Chrome, Edge, Brave').first()).toBeVisible();
    fixture.expectNoUnexpectedRequests();
  });

  test('is never shown where the extension is installed', async ({ page }) => {
    // what the bridge stamps on the page before the app runs (extension/bridge.js)
    await page.addInitScript(() => {
      const stamp = () => {
        if (!document.documentElement) return false;
        document.documentElement.dataset.azimutCaptureExtension = '0.3.3';
        return true;
      };
      if (!stamp()) {
        const watch = new MutationObserver(() => stamp() && watch.disconnect());
        watch.observe(document, { childList: true });
      }
    });
    const fixture = await installAppFixture(page, { postExtensionWindow: true });
    await page.goto('/#post');
    await expect(page.getByText('Geolocation post', { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog', { name: 'Post works best with the extension' })).toHaveCount(0);
    await expect(page.locator('.ext-quiet')).toHaveCount(0);
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('Reply under the source', () => {
  test('one box under the source makes Reply the main action, the source line out of the post', async ({ page }) => {
    await catchWhatLeaves(page);
    const fixture = await installAppFixture(page, { proofList: [PROOFS[0]], lookupEntities: lookups });
    await postRoutes(page);
    await page.goto('/#post');
    await page.getByTestId('post-home').locator('.ph-card').first().click();
    const first = page.locator('.tweet-block textarea').first();
    await expect(first).toHaveValue(FIRST_POST);

    const box = page.getByRole('checkbox', { name: 'Post as a reply under the source' });
    await expect(box).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Reply under the source' })).toHaveCount(0);
    await box.check();
    const text = FIRST_POST.replace(`\n\nSource: ${SOURCE_X}`, '');
    await expect(first).toHaveValue(text);
    await expect(page.getByRole('button', { name: 'Publish on X' })).toHaveCount(0);
    const reply = page.getByRole('button', { name: 'Reply under the source' });
    await expect(reply).toHaveAttribute('title', 'Open the reply box under the source post on X');
    await reply.click();
    await expect(page.locator('.toast', { hasText: 'Picture copied: paste it with Ctrl+V.' })).toBeVisible();

    const opened = await page.evaluate(() => window.__opened);
    expect(opened).toEqual([`https://x.com/intent/post?in_reply_to=1850000000000000000&text=${encodeURIComponent(text)}`]);
    const clipboard = await page.evaluate(() => window.__clipboard);
    expect(clipboard.at(-1)).toEqual({ types: ['image/png'] });
    // unchecked, Publish opens the composer it always opened, with the source in it
    await box.uncheck();
    await expect(first).toHaveValue(FIRST_POST);
    await page.getByRole('button', { name: 'Publish on X' }).click();
    await expect.poll(() => page.evaluate(() => window.__opened.at(-1)))
      .toBe(`https://x.com/intent/post?text=${encodeURIComponent(FIRST_POST)}`);
    fixture.expectNoUnexpectedRequests();
  });

  test('is not offered for a source that is not an X or Bluesky post', async ({ page }) => {
    const fixture = await installAppFixture(page);
    await page.goto('/#post');
    const box = page.getByRole('checkbox', { name: 'Post as a reply under the source' });
    await page.locator('#pc-source').fill('https://instagram.com/p/abc');
    await expect(box).toHaveCount(0);
    await page.locator('#pc-source').fill('https://bsky.app/profile/someone.bsky.social/post/3kabc');
    await expect(box).toBeVisible();
    fixture.expectNoUnexpectedRequests();
  });
});

test.describe('post templates per kind', () => {
  test('lists them under their kind, with a default for each, and starts a new one from a kind', async ({ page }) => {
    const store = {
      schema: 1, proof: [], map: [], note: [],
      post: [
        { id: 'po_geo', name: 'Desk thread', data: { mention: '@Desk', body: '#place\n#coordinates', mediaEnabled: true, extraTweets: [] } },
        { id: 'po_free', name: 'Free words', data: { mention: '', body: '#description', mediaEnabled: false, extraTweets: [], kind: 'free' } },
      ],
    };
    const saves = [];
    const fixture = await installAppFixture(page, { settings: { post_template: 'po_geo', post_kind_templates: {} } });
    await page.route('**/api/templates**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/templates' && request.method() === 'GET') return route.fulfill({ json: store });
      if (path === '/api/templates/post' && request.method() === 'POST') {
        const body = request.postDataJSON();
        saves.push(body);
        const record = { id: `po_${saves.length}`, name: body.name, data: body.data };
        store.post = [...store.post, record];
        return route.fulfill({ json: record });
      }
      return route.fallback();
    });
    await page.goto('/#settings');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Templates' }).click();
    const section = page.locator('[data-guide="settings.report-templates"]');
    await expect(section.locator('h3')).toHaveText('Post templates');
    await expect(section.locator('.tpl-kind')).toHaveText(['Geolocation', 'Free post']);
    await expect(section.locator('.tpl-row', { hasText: 'Desk thread' }).locator('.tpl-tag')).toHaveText('Default');

    const putFree = page.waitForRequest((request) => request.url().endsWith('/api/settings/prefs') && request.method() === 'PUT');
    await section.locator('.tpl-row', { hasText: 'Free words' }).getByRole('button', { name: 'Start new free posts with this template' }).click();
    expect((await putFree).postDataJSON()).toEqual({ post_kind_templates: { free: 'po_free' } });
    await expect(section.locator('.tpl-row', { hasText: 'Free words' }).locator('.tpl-tag')).toHaveText('Default');
    await expect(section.locator('.tpl-row', { hasText: 'Desk thread' }).locator('.tpl-tag')).toHaveText('Default');

    await section.getByRole('button', { name: 'New post template' }).click();
    const menu = page.locator('.float-menu[aria-label="New post template"]');
    await expect(menu.locator('.fm-item')).toHaveText(['Classic', 'Coordinates only', 'Short', 'With date', 'Coming next', 'Plate', 'Text and source']);
    await menu.getByRole('button', { name: 'Plate' }).click();
    const editor = page.locator('.tpl-modal');
    await expect(editor.locator('.pe-kind')).toHaveText('Map plate');
    await expect(editor.locator('textarea.body')).toHaveValue('#description\n\n#credits\n\n#mention');
    await expect(editor.locator('label.reply')).toHaveCount(0);
    await editor.locator('.tpl-title').fill('Plate post');
    await editor.getByRole('button', { name: 'Save template' }).click();
    await expect(editor).toHaveCount(0);
    expect(saves[0]).toMatchObject({ name: 'Plate post', data: { kind: 'plate', mediaEnabled: false } });
    await expect(section.locator('.tpl-kind')).toHaveText(['Geolocation', 'Map plate', 'Free post']);
    fixture.expectNoUnexpectedRequests();
  });
});
