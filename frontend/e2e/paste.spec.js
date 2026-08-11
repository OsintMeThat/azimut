import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * Ctrl+V, in a real browser.
 *
 * Nothing about this feature can be proven by reading source or by mounting one
 * component: it is a window event carrying a `DataTransfer`, a listener that has to
 * belong to the visible tool and to no other, and a refusal that must reach the
 * screen. Every visited tab stays mounted behind the one on screen, so "does one
 * Ctrl+V open exactly one dialog" is a question only a browser can answer.
 */

const catalog = [
  {
    id: 'place-1',
    type: 'place',
    label: 'checkpoint north',
    attrs: { lat: 48.8584, lon: 2.2945 },
    provenance: { by: 'satellite', at: '2026-08-01T10:00:00Z', status: 'confirmed' },
  },
];

/**
 * Paste something, the way the browser hands it over.
 *
 * Built in the page: a `DataTransfer` cannot cross the Playwright boundary, and
 * `page.keyboard.press('Control+V')` pastes whatever the *machine's* clipboard
 * holds, which no test can arrange.
 */
async function paste(page, { image = null, text = '', html = '' } = {}) {
  await page.evaluate(
    async ({ image, text, html }) => {
      const data = new DataTransfer();
      if (text) data.setData('text/plain', text);
      if (html) data.setData('text/html', html);
      if (image) {
        // a 1×1 PNG, which is a real image as far as the dialog's preview goes
        const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      }
      // The transfer is forced onto the event rather than passed to the
      // constructor: Firefox ignores `clipboardData` in the init dict, since only
      // the browser is meant to fill it. No engine lets a script put bytes on the
      // system clipboard unprompted, so the event object is the one synthetic part.
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
      document.body.focus();
      document.body.dispatchEvent(event);
    },
    { image, text, html }
  );
}

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('files a screenshot that exists nowhere but the clipboard', async ({ page }) => {
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  await paste(page, { image: PNG_1PX });

  await expect(page.getByRole('dialog', { name: 'Paste image' })).toBeVisible();
  await expect(page.locator('.preview img')).toBeVisible();
  await page.locator('#paste-title').fill('Front gate');
  await page.locator('#paste-source').fill('https://example.test/thread');
  await page.getByRole('button', { name: 'Add to case' }).click();

  await expect(page.getByRole('dialog', { name: 'Paste image' })).toBeHidden();
  expect(fixture.pastes).toHaveLength(1);
  expect(fixture.pastes[0]).toMatchObject({
    title: 'Front gate',
    source_url: 'https://example.test/thread',
  });
  // filed, then opened: the next gesture is relating it to whatever prompted it
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('takes a copied address as a bookmark', async ({ page }) => {
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  await paste(page, { text: 'https://leak.example.test/thread/1' });

  const dialog = page.getByRole('dialog', { name: 'Paste link' });
  await expect(dialog).toBeVisible();
  // named after its host, so the button is live without typing anything
  await expect(page.locator('#paste-title')).toHaveValue('leak.example.test');
  await page.locator('#paste-notes').fill('watching this one');
  await page.getByRole('button', { name: 'Add to case' }).click();

  await expect(dialog).toBeHidden();
  expect(fixture.entityWrites).toEqual([
    {
      type: 'bookmark',
      label: 'leak.example.test',
      attrs: {
        url: 'https://leak.example.test/thread/1',
        notes: 'watching this one',
        folder: '',
      },
    },
  ]);
  fixture.expectNoUnexpectedRequests();
});

test('a link in Media is refused, and told where it does work', async ({ page }) => {
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#media');
  await expect(page.getByRole('heading', { name: 'Media Library' })).toBeVisible();

  await paste(page, { text: 'https://leak.example.test/thread/1' });

  const dialog = page.getByRole('dialog', { name: 'Nothing to paste here' });
  await expect(dialog).toContainText('URL field');
  // a refusal has nothing to fill in and files nothing
  await expect(dialog.locator('input')).toHaveCount(0);
  // the footer button, not the header's X, which carries the same accessible name
  await dialog.locator('.modal-row .btn-primary').click();
  await expect(dialog).toBeHidden();
  expect(fixture.entityWrites).toEqual([]);
  expect(fixture.pastes).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('one Ctrl+V opens one dialog, however many tabs have been visited', async ({ page }) => {
  // The tabs the analyst has opened stay mounted behind the visible one, so four
  // ungated listeners would answer one paste four times over.
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#media');
  await expect(page.getByRole('heading', { name: 'Media Library' })).toBeVisible();
  // switched by the tabs, not by the hash: a deep link is read once, at mount, and
  // the point here is to leave three tools mounted at the same time
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  await paste(page, { image: PNG_1PX });

  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Paste image' })).toBeVisible();
  // the Files dialog would have offered a folder; the board's does not
  await expect(page.locator('.folder-select')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a paste into a field stays the ordinary one', async ({ page }) => {
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  const search = page.getByPlaceholder(/search/i).first();
  await search.click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://leak.example.test/thread/1');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data, configurable: true });
    document.activeElement.dispatchEvent(event);
  });

  await expect(page.getByRole('dialog')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('a paste in Proof stays the composer\'s own', async ({ page }) => {
  // The composer had Ctrl+V before this feature existed, and it means something
  // else there: an overlay on the canvas, not a media file. Its listener and these
  // four are all on `window`, and all five surfaces stay mounted once visited, so
  // the boundary between them is worth a test rather than an argument.
  const fixture = await installAppFixture(page, { catalog });
  await page.goto('/#media');
  await expect(page.getByRole('heading', { name: 'Media Library' })).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  await page.getByRole('button', { name: 'Geo Proof', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Geo Proof' })).toBeVisible();
  await page.getByRole('button', { name: 'New proof' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create proof' })).toBeVisible();
  await page.locator('.selectable-pick').click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(1);

  await paste(page, { image: PNG_1PX });

  // the proof takes it as an overlay, and nothing of ours opens over the canvas
  await expect(page.locator('.paste-row')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Paste image' })).toHaveCount(0);
  expect(fixture.pastes).toEqual([]);
});
