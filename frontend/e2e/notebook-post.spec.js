import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * `/post`: a link pasted, read on Add (the server's answer stood in for), the card drawn as
 * the documents draw it, then the profile picture hidden and the Quote form, each written
 * into the block's lines. Accounts are made up; nothing reaches X or Bluesky.
 */

const LINK = 'https://x.com/coast_monitor/status/1990000000000000001';
const POST = {
  id: 'e_post', at: 0, site: 'x', site_label: 'X', url: LINK, name: 'Coast Monitor', handle: 'coast_monitor',
  text: 'A column of vehicles heads south on the coast road this morning.', lang: 'en', rtl: false,
  when: '15 Nov 2026 · 05:12 UTC', posted_at: '2026-11-15T05:12:00Z', captured: '15 Nov 2026', avatar: PANEL_PATH,
  initials: 'CM', tint: ['#3c5a6e', '#20323e'], highlights: [], translation: '', archive: '',
  pictures: [{ kind: 'image', path: PANEL_PATH, media: PANEL_PATH, duration: '', alt: 'The coast road' }],
  proof: { label: 'Proof 12', id: 'e_proof', posted: '' },
};

test('/post reads a pasted link on Add and draws its card, then hides the picture and quotes it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const state = { saved: '# Field notes\n\n', fetched: [], described: 0 };
  await page.route(`**/api/cases/${CASE_ID}/notes`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { text: state.saved } });
    state.saved = route.request().postDataJSON().text;
    return route.fulfill({ json: { status: 'saved' } });
  });
  await page.route(`**/api/cases/${CASE_ID}/social-posts/offers`, (route) => route.fulfill({ json: { kept: [], downloaded: [], mine: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/social-posts/fetch`, (route) => {
    state.fetched.push(route.request().postDataJSON());
    return route.fulfill({ json: { job_id: 'post-job' } });
  });
  await page.route('**/api/jobs/post-job', (route) => route.fulfill({ json: { id: 'post-job', status: 'done', result: { results: [{ link: LINK, id: 'e_post' }] } } }));
  await page.route(`**/api/cases/${CASE_ID}/social-posts/describe`, (route) => {
    state.described += 1;
    const { text } = route.request().postDataJSON();
    const posts = /post: e_post/.test(text) ? [POST] : [];
    return route.fulfill({ json: {
      form: /form: (\w+)/.exec(text)?.[1] ?? 'card', avatar: !/avatar: hidden/.test(text), qr: false, span: POST.when,
      missing: [...text.matchAll(/^link: (.*)$/gm)].map((found) => found[1]), posts,
    } });
  });

  await page.goto('/#notebook');
  await page.locator('[data-guide="notebook.case"] button.open').click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(state.fetched).toEqual([]);

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/post');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Post from X or Bluesky');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Post from X or Bluesky' });
  await dialog.getByRole('textbox', { name: 'Link' }).fill(LINK);
  await expect(dialog.getByRole('button', { name: 'Add the post' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add the post' }).click();

  const card = page.locator('.cm-post-block .cm-post-card');
  await expect(card.locator('.cm-post-who b')).toHaveText('Coast Monitor');
  await expect(card.locator('.cm-post-text')).toHaveText(POST.text);
  await expect(card.locator('.cm-post-avatar img')).toBeVisible();
  await expect(card.locator('.cm-post-proof')).toHaveText('Geolocated · Proof 12');
  await expect(card.getByRole('link', { name: 'View on X ↗' })).toHaveAttribute('href', LINK);
  expect(state.fetched).toEqual([{ links: [LINK] }]);
  await expect.poll(() => state.saved).toContain('::: post\npost: e_post\n:::');

  await page.locator('.cm-post-settings-btn').click();
  await page.getByLabel('Hide the profile picture').check();
  await expect(card.locator('.cm-post-initials')).toHaveText('CM');
  await expect(card.locator('.cm-post-avatar img')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Quote' }).click();
  await expect(page.locator('.cm-post-quote-words')).toHaveText(`“${POST.text}”`);
  await expect(page.locator('.cm-post-by')).toContainText('Coast Monitor on X · 15 Nov 2026');
  await expect.poll(() => state.saved).toContain('::: post\npost: e_post\nform: quote\navatar: hidden\n:::');
  expect(state.fetched).toHaveLength(1);

  fixture.expectNoUnexpectedRequests();
});
