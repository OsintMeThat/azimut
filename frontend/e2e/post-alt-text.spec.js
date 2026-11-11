import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Alt text in Post, in a browser: the box beside the proof, ticked; the field under the
 * proof starts with its sentence and takes the analyst's words; the post saves them,
 * opens again with them, and hands them to the extension beside the proof's file.
 *
 * The extension is played by the page itself: it marks the page as the real bridge
 * does and answers Post's hand-off, keeping what it was given. Nothing leaves the
 * machine.
 */

const PHOTO = readFileSync(new URL('../guide/photos/bridge_channel.jpg', import.meta.url));
const SOURCE = 'https://x.com/example/status/1';
const DESCRIPTION = 'The convoy crosses the road bridge';
const PROOFS = [{ name: 'bridge', title: 'Road bridge', updated_at: '2026-11-09T09:00:00Z', png: 'proofs/bridge.png', thumb: null, video: null }];

/** The bridge, as the extension marks the page and answers a hand-off. */
async function fakeExtension(page) {
  await page.addInitScript(() => {
    window.__handoffs = [];
    // as the content script does at document_start, once the page has its root
    const mark = () => { document.documentElement.dataset.azimutCaptureExtension = '0.3.4'; };
    if (document.documentElement) mark();
    else document.addEventListener('readystatechange', mark, { once: true });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.channel !== 'azimut-capture-ext' || msg.type !== 'post-handoff') return;
      window.__handoffs.push(msg.payload);
      window.postMessage({ channel: 'azimut-capture-ext', type: 'post-handoff-result', id: msg.id, ok: true }, window.location.origin);
    });
  });
}

async function proofRoutes(page) {
  await page.route(`**/files/${CASE_ID}/**`, (route) => route.fulfill({ contentType: 'image/jpeg', body: PHOTO }));
  await page.route(`**/api/cases/${CASE_ID}/proofs/*`, (route) => route.fulfill({ json: {
    title: 'Road bridge', description: DESCRIPTION, coordsText: '48.850000, 2.350000', source: SOURCE,
  } }));
  await page.route('**/api/geo/parse', (route) => route.fulfill({ json: { lat: 48.85, lon: 2.35, dms: '', plus_code: '8FW4V9X2+22' } }));
  await page.route('**/api/geo/reverse**', (route) => route.fulfill({ json: { address: { city: 'Paris', country: 'France' } } }));
  await page.route(`**/api/cases/${CASE_ID}/entities/*/derivation`, (route) => route.fulfill({ json: { entities: [], links: [] } }));
}

const home = (page) => page.getByTestId('post-home');
const box = (page) => page.locator('.alt-box input');
const altField = (page) => page.getByRole('textbox', { name: 'Alt text for bridge.png' });

test('an alt text typed under the proof is saved, opens again, and goes to the extension beside the picture', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    proofList: PROOFS, lookupEntities: { 'proofs/bridge.png': { id: 'p-bridge', type: 'proof' } },
  });
  await fakeExtension(page);
  await proofRoutes(page);
  await page.goto('/#post');
  await home(page).locator('.ph-open, button.ph-card').first().click();

  // off by default: one quiet box, no field
  await expect(box(page)).not.toBeChecked();
  await expect(page.locator('.alt-box')).toHaveAttribute('title', 'Describes each picture for people using a screen reader');
  await expect(page.locator('.alt-input')).toHaveCount(0);

  await box(page).check();
  await expect(altField(page)).toHaveValue(DESCRIPTION);
  await expect.poll(() => fixture.settingsWrites.at(-1)).toEqual({ post_alt_text: true });
  await altField(page).fill('A convoy of trucks on a road bridge over a canal');
  await expect(page.locator('.alt-count')).toHaveText('48/1000');
  await expect.poll(() => fixture.draftWrites.at(-1)?.state?.alt)
    .toEqual({ 'proofs/bridge.png': 'A convoy of trucks on a road bridge over a canal' });

  // back home and in again: the text and the ticked box come back
  await page.locator('.tool-header').getByRole('button', { name: 'Posts' }).click();
  await home(page).locator('.post-card .ph-open').first().click();
  await expect(altField(page)).toHaveValue('A convoy of trucks on a road bridge over a canal');
  await expect(box(page)).toBeChecked();

  await page.locator('[data-guide="post.publish"]').click();
  await expect.poll(() => page.evaluate(() => window.__handoffs.length)).toBe(1);
  const [handed] = await page.evaluate(() => window.__handoffs);
  expect(handed.posts[0]).toMatchObject({
    files: ['proofs/bridge.png'],
    alt: { 'proofs/bridge.png': 'A convoy of trucks on a road bridge over a canal' },
  });
  fixture.expectNoUnexpectedRequests();
});
