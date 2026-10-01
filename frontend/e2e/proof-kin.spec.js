import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * What a geolocation shares with the case, said where the analyst is the moment the proof
 * is saved: other geolocations on its site, what its account posted. One line, gone at the
 * next edit, and one press to the graph.
 */
test('a saved proof says what it shares with the case and opens it in the graph', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    // The saved proof is found again, as the case would: otherwise the composer reads it
    // as deleted elsewhere and the document as unsaved.
    lookupEntities: { 'proofs/.meta/browser-proof.json': { id: 'browser-proof-entity' } },
    kin: {
      sites: ['proof-2', 'proof-3'],
      places: ['place-2', 'place-3'],
      radius: 300,
      accounts: [{ label: '@BashaReport', id: null, files: 3 }],
    },
  });
  await openProofWithPanel(page);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(1);

  const line = page.locator('.kin');
  await expect(line).toContainText('On the same site as 2 other geolocations');
  await expect(line).toContainText('@BashaReport posted 3 other files here');
  expect(fixture.kinReads).toEqual(['browser-proof-entity']);

  await line.getByRole('button', { name: 'See in the graph' }).click();
  await expect(page.locator('.tabstrip').getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-current', /.+/);
});

test('a proof that shares nothing says nothing', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    lookupEntities: { 'proofs/.meta/browser-proof.json': { id: 'browser-proof-entity' } },
  });
  await openProofWithPanel(page);

  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.kinReads.length).toBe(1);

  await expect(page.locator('.kin')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});
