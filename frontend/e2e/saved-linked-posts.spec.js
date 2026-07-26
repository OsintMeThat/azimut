import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

const linkedPosts = [
  { id: 'post-1', name: 'panorama-publication', title: 'Panorama publication', target: 'x' },
  { id: 'post-2', name: 'source-follow-up', title: 'Follow-up with sources', target: 'bluesky' },
  { id: 'post-3', name: 'later-note', title: 'Later note', target: 'mastodon' },
];

const point = {
  lat: 48.8584,
  lon: 2.2945,
  geo: { state: 'ok', country_code: 'fr', country: 'France' },
  continent: 'Europe',
  country_en: 'France',
};

test('shows every linked post from a proof popup and opens the selected draft', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    savedIndex: [{
      id: 'capture-1',
      key: 'capture-1',
      kind: 'capture',
      title: 'Source capture',
      path: 'media/source.png',
      fetched_at: '2026-07-24T08:00:00Z',
      proofs: 1,
      ...point,
    }],
    proofIndex: [{
      id: 'proof-1',
      key: 'proof-1@48.8584,2.2945',
      kind: 'proof',
      name: 'panorama-proof',
      title: 'Panorama autostitch test',
      path: 'proofs/panorama-proof.png',
      fetched_at: '2026-07-24T09:00:00Z',
      posts: linkedPosts.length,
      linked_posts: linkedPosts,
      ...point,
    }],
    drafts: {
      'later-note': {
        title: 'Later note',
        updated_at: '2026-07-24T10:00:00Z',
        state: { target: 'mastodon', tweet1: 'Later context' },
      },
    },
  });

  await page.goto('/#satellite');
  await expect(page.locator('.map')).toHaveClass(/leaflet-container/);
  await page.getByRole('button', { name: 'Proofs', exact: true }).click();
  await expect(page.getByText('Panorama autostitch test')).toBeVisible();

  await page.getByRole('button', { name: 'Show saved work on the map' }).click();
  await page.locator('.saved-mark-proof').click();

  const popup = page.locator('.saved-popup');
  await expect(popup.getByText('Linked posts · 3')).toBeVisible();
  await expect(popup.getByText('Panorama publication')).toBeVisible();
  await expect(popup.getByText('Follow-up with sources')).toBeVisible();
  await expect(popup.getByText('Later note')).toHaveCount(0);

  await popup.getByRole('button', { name: '+ 1 more' }).click();
  await expect(popup.getByText('Later note')).toBeVisible();
  await popup.getByRole('button', { name: /Later note/ }).click();

  await expect(page.getByRole('button', { name: 'Geo Report', exact: true })).toHaveClass(/active/);
  await expect(page.getByLabel('Post name')).toHaveValue('Later note');
  fixture.expectNoUnexpectedRequests();
});

test('clears capture rows before a different case index arrives', async ({ page }) => {
  const secondId = 'browser-test-b';
  const fixture = await installAppFixture(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: secondId, name: 'Case B', scratch: false, folders: [] },
    ],
    savedIndexes: {
      [CASE_ID]: [{ id: 'capture-a', key: 'capture-a', kind: 'capture', title: 'Capture A', ...point }],
      [secondId]: [{ id: 'capture-b', key: 'capture-b', kind: 'capture', title: 'Capture B', ...point }],
    },
    savedIndexDelays: { [secondId]: 1200 },
  });

  await page.goto('/#satellite');
  const savedPanel = page.locator('.captures');
  await expect(savedPanel.getByText('Capture A', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show saved work on the map' }).click();
  await expect(page.locator('.saved-mark-capture')).toHaveCount(1);
  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();

  await expect(savedPanel.getByText('Capture A', { exact: true })).toBeHidden({ timeout: 500 });
  await expect(page.locator('.saved-mark-capture')).toBeHidden({ timeout: 500 });
  await expect(savedPanel.getByText('Capture B', { exact: true })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('clears proof rows before a different case proof index arrives', async ({ page }) => {
  const secondId = 'browser-test-b';
  const fixture = await installAppFixture(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: secondId, name: 'Case B', scratch: false, folders: [] },
    ],
    proofIndexes: {
      [CASE_ID]: [{ id: 'proof-a', key: 'proof-a', kind: 'proof', name: 'proof-a', title: 'Proof A', ...point }],
      [secondId]: [{ id: 'proof-b', key: 'proof-b', kind: 'proof', name: 'proof-b', title: 'Proof B', ...point }],
    },
    proofIndexDelays: { [secondId]: 1200 },
  });

  await page.goto('/#satellite');
  await page.getByRole('button', { name: 'Proofs', exact: true }).click();
  await expect(page.getByText('Proof A')).toBeVisible();
  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();

  await expect(page.getByText('Proof A')).toBeHidden({ timeout: 500 });
  await expect(page.getByText('Proof B')).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});
