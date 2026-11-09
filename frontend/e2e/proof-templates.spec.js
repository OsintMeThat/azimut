import { expect, test } from '@playwright/test';
import { installAppFixture, showProofTab } from './app.fixture.js';

/**
 * A proof template made the new way, end to end: picked from a start in Settings,
 * kept, marked as the default, then found already chosen by New proof and laid on
 * the proof it creates. The templates live in a small store here, as the server
 * keeps them, so the list and the dialog read back what the editor saved.
 */
async function templateStore(page) {
  const store = { schema: 1, proof: [], post: [], map: [], note: [] };
  const saves = [];
  await page.route('**/api/templates**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/templates' && request.method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(store) });
    }
    if (path === '/api/templates/proof' && request.method() === 'POST') {
      const body = request.postDataJSON();
      saves.push(body);
      const record = { id: body.id ?? `pf_${saves.length}`, name: body.name, data: body.data, updated_at: '2026-11-08T00:00:00Z' };
      store.proof = [...store.proof.filter((one) => one.id !== record.id), record];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(record) });
    }
    return route.fallback();
  });
  return { store, saves };
}

test('a template picked from a start becomes the default, and New proof starts with it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const { saves } = await templateStore(page);

  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New proof template' }).click();

  const dialog = page.getByRole('dialog', { name: 'New proof template' });
  await expect(dialog.locator('.pts-card')).toHaveCount(6);
  // each start is shown as the sample proof set in it
  await expect(dialog.locator('.pts-card[data-starter="free"] img')).toBeVisible();
  await dialog.locator('.pts-card[data-starter="free"]').click();

  const editor = page.locator('.tpl-modal');
  await expect(editor.locator('.tpl-title')).toHaveValue('Free layout');
  await expect(editor.locator('.pte-canvas canvas').first()).toBeVisible();
  await editor.getByRole('checkbox', { name: 'Azimut mark' }).check();
  await editor.getByRole('button', { name: 'Save template' }).click();
  await expect(editor).toHaveCount(0);

  expect(saves).toHaveLength(1);
  expect(saves[0].data).toMatchObject({
    bg: '#000000', layout: 'free', captionsEnabled: false, font: 'barlow',
    azimutMark: { anchor: 'br', show: 'both', size: 28 },
  });

  const row = page.locator('.tpl-row', { hasText: 'Free layout' });
  await expect(row.locator('svg.pts-sketch')).toBeVisible();
  const bookmark = row.getByRole('button', { name: 'Start new proofs with this template' });
  await bookmark.click();
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.tpl-tag')).toHaveText('Default');

  await page.goto('/#proof');
  await page.getByRole('button', { name: 'New proof' }).first().click();
  const create = page.getByRole('dialog', { name: 'New proof' });
  await expect(create.locator('select')).toHaveValue('pf_1');
  await create.locator('.selectable-pick').click();
  await create.getByRole('button', { name: 'Create proof' }).click();

  await showProofTab(page, 'Style');
  await expect(page.getByTitle('Choose a saved house style')).toHaveValue('pf_1');
  await expect.poll(() => page.evaluate(() => {
    const stage = window.Konva.stages[0];
    return {
      ground: stage.findOne('.bg')?.fill(),
      mark: Boolean(stage.findOne('#azimut-mark')),
    };
  })).toEqual({ ground: '#000000', mark: true });

  // The picture the proof exports, as the composer takes it (`exportPng`), read for the
  // amber of the arrow's east flank: the export draws the mark with the canvas's own code.
  const amberInExport = () => page.evaluate(async () => {
    const stage = window.Konva.stages[0];
    const layer = stage.getLayers()[0];
    const bg = layer.findOne('.bg');
    const [scale, position, size] = [stage.scale(), stage.position(), stage.size()];
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.size({ width: bg.width(), height: bg.height() });
    const url = layer.toDataURL({ x: 0, y: 0, width: bg.width(), height: bg.height(), pixelRatio: 1 });
    stage.scale(scale);
    stage.position(position);
    stage.size(size);
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let amber = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - 232) < 12 && Math.abs(pixels[i + 1] - 163) < 12 && Math.abs(pixels[i + 2] - 61) < 12) amber += 1;
    }
    return amber;
  });
  await expect.poll(amberInExport).toBeGreaterThan(20);

  // the proof's own choice: the name alone has no arrow, and so no amber
  await page.getByRole('radiogroup', { name: 'What the mark shows' }).getByRole('radio', { name: 'Name', exact: true }).click();
  await expect.poll(amberInExport).toBe(0);
  await page.getByRole('radiogroup', { name: 'What the mark shows' }).getByRole('radio', { name: 'Logo', exact: true }).click();
  await expect.poll(amberInExport).toBeGreaterThan(20);

  // the proof's own switch answers at once, and leaves the template alone
  await page.getByRole('checkbox', { name: 'Azimut mark' }).uncheck();
  await expect.poll(() => page.evaluate(() => Boolean(window.Konva.stages[0].findOne('#azimut-mark')))).toBe(false);
  await expect.poll(amberInExport).toBe(0);
  fixture.expectNoUnexpectedRequests();
});

test('a default template that was deleted leaves New proof on no template, without a word', async ({ page }) => {
  const fixture = await installAppFixture(page);
  const { store } = await templateStore(page);
  await page.route('**/api/templates/proof/*', (route) => {
    store.proof = [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ deleted: true }) });
  });

  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'New proof template' }).click();
  await page.locator('.pts-card[data-starter="blank"]').click();
  await page.locator('.tpl-title').fill('House');
  await page.getByRole('button', { name: 'Save template' }).click();
  const row = page.locator('.tpl-row', { hasText: 'House' });
  await row.getByRole('button', { name: 'Start new proofs with this template' }).click();
  await expect(row.locator('.tpl-tag')).toHaveText('Default');

  await row.getByTitle('Delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);

  await page.goto('/#proof');
  await page.getByRole('button', { name: 'New proof' }).first().click();
  const create = page.getByRole('dialog', { name: 'New proof' });
  await expect(create.locator('select')).toHaveValue('');
  fixture.expectNoUnexpectedRequests();
});
