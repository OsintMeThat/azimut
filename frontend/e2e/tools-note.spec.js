import { test, expect } from '@playwright/test';
import { CASE_ID, awaitMapReady, installAppFixture, openProofWithPanel } from './app.fixture.js';

/**
 * A tool puts what it shows in the note pinned beside, from the menu it already
 * has: Geo Proof its proof (saved first, captioned with its own sentence), the
 * Map the point right-clicked. The toast names the note, and Undo takes it back.
 */

// room for a tool's header beside the note on the side and the case sidebar
test.use({ viewport: { width: 1720, height: 900 } });

const PROOF = {
  id: 'browser-proof-entity',
  type: 'proof',
  label: 'browser-proof',
  attrs: { spec: 'proofs/.meta/browser-proof.json', path: 'proofs/browser-proof.png', notes: 'Smoke over the north quay' },
};

async function withCaseNotes(page, options = {}) {
  const fixture = await installAppFixture(page, options);
  const written = [];
  let text = '';
  await page.route(`**/api/cases/${CASE_ID}/notes`, async (route) => {
    if (route.request().method() === 'PUT') {
      text = route.request().postDataJSON().text;
      written.push(text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  return { fixture, written };
}

async function pinCaseNotes(page) {
  await page.locator('[data-guide="start.note"]').click();
  const dock = page.locator('[data-guide="notes.dock"]');
  await expect(dock.locator('.which')).toContainText('Case notes');
  return dock;
}

test('Geo Proof saves the proof and puts it in the pinned note with its sentence, and Undo takes it back', async ({ page }) => {
  const { fixture, written } = await withCaseNotes(page, { lookupEntities: { [PROOF.attrs.spec]: PROOF } });
  await openProofWithPanel(page);
  const dock = await pinCaseNotes(page);

  // the export menu holds the row; nothing new appears anywhere else in the tool
  await page.getByRole('button', { name: 'More export options' }).click();
  const row = page.getByRole('menuitem', { name: 'Put in “Case notes”' });
  await expect(row).toHaveAttribute('title', 'Saves the proof, then puts it in with its points');
  await row.click();

  // an unsaved proof goes through its own save first
  await expect.poll(() => fixture.proofSaves.length).toBe(1);
  await expect.poll(() => written.at(-1) ?? '')
    .toContain('[[media:browser-proof-entity|browser-proof]]{width=100% caption="Smoke over the north quay"}');
  // the caption field opens on the picture; Escape keeps the proof's own sentence
  await page.keyboard.press('Escape');

  const toast = page.locator('.toast', { hasText: 'Put in “Case notes”' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => written.at(-1)).toBe('');
  // the proof is the analyst's work: Undo takes the text back and leaves the proof
  expect(fixture.entityWrites.filter((write) => write.method === 'DELETE')).toEqual([]);
  await expect(dock).toBeVisible();
});

test('the Map puts the point right-clicked in the pinned note, as coordinates', async ({ page }) => {
  const { written } = await withCaseNotes(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  await pinCaseNotes(page);

  const map = page.locator('.map[data-map-ready="true"]').first();
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'This point' });
  const dd = await menu.locator('.item.copy')
    .filter({ has: page.locator('.fmt', { hasText: /^DD$/ }) }).locator('.coords').textContent();
  await menu.getByRole('menuitem', { name: 'Put this point in “Case notes”' }).click();
  await expect(menu).toBeHidden();

  const [lat, lon] = dd.split(',').map((part) => Number(part.trim()));
  await expect.poll(() => written.at(-1) ?? '').toContain(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);

  await page.locator('.toast', { hasText: 'Put in “Case notes”' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => (written.at(-1) ?? '').trim()).toBe('');
});
