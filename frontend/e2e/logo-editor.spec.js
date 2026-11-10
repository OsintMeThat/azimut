import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

/** The named parts of a multipart body, each as bytes. */
function formParts(request) {
  const boundary = /boundary=(.+)$/.exec(request.headers()['content-type'])[1];
  const body = request.postDataBuffer();
  const parts = {};
  const marker = Buffer.from(`--${boundary}`);
  let start = body.indexOf(marker) + marker.length;
  while (start > marker.length - 1) {
    const end = body.indexOf(marker, start);
    if (end < 0) break;
    const part = body.subarray(start + 2, end - 2); // past the CRLF, before the next one
    const split = part.indexOf('\r\n\r\n');
    const name = /name="([^"]+)"/.exec(part.subarray(0, split).toString())?.[1];
    if (name) parts[name] = part.subarray(split + 4);
    start = end + marker.length;
  }
  return parts;
}

/** A 300 × 150 opaque PNG drawn by the browser: blue, with a red bar. */
async function pictureOf(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1060d0';
    ctx.fillRect(0, 0, 300, 150);
    ctx.fillStyle = '#d02020';
    ctx.fillRect(120, 0, 60, 150);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

/** The logo on the server, as the browser decodes it: its size and a few pixels. */
async function savedLogo(page) {
  return page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch('/api/settings/signature.png?read')).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const at = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const { width: w, height: h } = bitmap;
    return { width: w, height: h, corner: at(2, 2), frame: at(w / 2, 3), middle: at(w / 2, h / 2) };
  });
}

/** A stand-in for the logo routes, holding what the editor saved. */
async function logoServer(page, logo = null) {
  const held = { logo, saves: [] };
  await page.route('**/api/settings/signature.png*', (route) => (held.logo
    ? route.fulfill({ contentType: 'image/png', body: held.logo })
    : route.fulfill({ status: 404, body: '' })));
  await page.route('**/api/settings/signature', (route) => {
    const parts = formParts(route.request());
    held.saves.push(parts);
    held.logo = parts.file;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ signature: true }) });
  });
  return held;
}

async function openPublishing(page) {
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Publishing' }).click();
}

test('frames a picked logo into a circle and saves the picture it was drawn from', async ({ page }) => {
  const fixture = await installAppFixture(page, { settings: { signature: false } });
  const held = await logoServer(page);
  await openPublishing(page);
  const picture = await pictureOf(page);
  await page.locator('input[type="file"][accept="image/png"]').first().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: picture });

  const dialog = page.getByRole('dialog', { name: 'Edit logo' });
  await expect(dialog).toBeVisible();
  // the preview draws the picture itself, in the middle of the paper
  await expect.poll(() => dialog.locator('canvas').first().evaluate((canvas) => {
    const ratio = canvas.width / canvas.clientWidth;
    return [...canvas.getContext('2d').getImageData(canvas.width / 2 - 40 * ratio, canvas.height / 2, 1, 1).data];
  })).toEqual([16, 96, 208, 255]);

  await dialog.getByRole('button', { name: 'Circle' }).click();
  await dialog.locator('#logo-frame').fill('0.05');
  await dialog.getByRole('button', { name: 'Frame colour: Azimut amber' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const [save] = held.saves;
  expect(Buffer.compare(save.original, picture)).toBe(0);
  expect(JSON.parse(save.look.toString())).toMatchObject({ shape: 'circle', border: 0.05, colour: '#e8a33d' });
  const logo = await savedLogo(page);
  expect(logo.width).toBe(logo.height); // a circle is drawn square
  expect(logo.corner[3]).toBe(0); // outside the circle stays transparent
  expect(logo.frame).toEqual([232, 163, 61, 255]); // the amber frame along the top
  expect(logo.middle).toEqual([208, 32, 32, 255]); // the red bar, whole in the middle
  fixture.expectNoUnexpectedRequests();
});

test('keeps a logo saved before the editor byte for byte when it is saved unchanged', async ({ page }) => {
  const fixture = await installAppFixture(page, { settings: { signature: true, logo_look: null } });
  const placeholder = await logoServer(page);
  await openPublishing(page);
  const picture = await pictureOf(page);
  placeholder.logo = picture;

  await page.getByRole('button', { name: 'Edit…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit logo' });
  await expect(dialog.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const [save] = placeholder.saves;
  expect(Object.keys(save)).toEqual(['file']);
  expect(Buffer.compare(save.file, picture)).toBe(0);
  fixture.expectNoUnexpectedRequests();
});
