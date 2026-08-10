import { test, expect } from '@playwright/test';
import { CASE_ID, PANEL_PATH, installAppFixture } from './app.fixture.js';

const person = {
  id: 'person-photo',
  type: 'person',
  label: 'Unknown subject',
  attrs: {},
  provenance: { by: 'user', at: '2026-08-04T09:00:00Z', status: 'confirmed' },
};

const chain = {
  entity: person,
  sources: [],
  lost: [],
  dependents: [],
  relations: [],
  empty: true,
};

async function openDetails(page, options = {}) {
  const fixture = await installAppFixture(page, {
    catalog: [person],
    chains: { [person.id]: chain },
    ...options,
  });
  await page.goto('/#board');
  await page.getByRole('cell', { name: 'Unknown subject', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
  return fixture;
}

test('imports a photo from the computer and keeps the main image bounded', async ({ page }) => {
  const fixture = await openDetails(page, {
    entityImageUploadResult: {
      id: 'photo-uploaded',
      path: PANEL_PATH,
      title: 'portrait',
    },
  });
  const details = page.getByRole('dialog', { name: 'Details' });

  await expect(details.locator('.main-photo')).toHaveCount(0);
  await details.locator('input[type=file]').setInputFiles({
    name: 'portrait.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>'),
  });

  await expect(details.getByText('Primary', { exact: true })).toBeVisible();
  const image = details.locator('.main-photo img');
  await expect(image).toBeVisible();
  expect((await image.boundingBox()).height).toBeLessThanOrEqual(220);
  await expect.poll(() => fixture.galleryWrites.length).toBe(1);
  expect(fixture.galleryWrites[0]).toEqual({
    method: 'UPLOAD',
    entityId: person.id,
    imageId: 'photo-uploaded',
  });
  expect(fixture.uploads).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});

test('chooses an existing Media Library image without creating a relation', async ({ page }) => {
  const fixture = await openDetails(page, {
    media: [{
      entity_id: 'photo-existing',
      path: PANEL_PATH,
      filename: 'case-photo.svg',
      title: 'Case photo',
      kind: 'image',
      thumbnail: null,
    }],
  });
  const details = page.getByRole('dialog', { name: 'Details' });

  await details.getByRole('button', { name: 'Choose from media' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose photos' });
  await picker.getByRole('button', { name: 'Case photo' }).click();
  await picker.getByRole('button', { name: 'Add selected' }).click();

  await expect(details.getByText('Primary', { exact: true })).toBeVisible();
  expect(fixture.galleryWrites).toEqual([{
    method: 'POST', entityId: person.id, mediaIds: ['photo-existing'],
  }]);
  expect(fixture.linkWrites).toEqual([]);
  await expect(page.locator(`img[src="/files/${CASE_ID}/${PANEL_PATH}"]`).first()).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('adds private photos while creating an entity and chooses the primary one', async ({ page }) => {
  const created = {
    id: 'e_new',
    type: 'person',
    label: 'New subject',
    attrs: {},
    provenance: { by: 'user', at: '2026-08-04T09:15:00Z', status: 'confirmed' },
  };
  const fixture = await installAppFixture(page, {
    chains: {
      e_new: {
        entity: created,
        sources: [],
        lost: [],
        dependents: [],
        relations: [],
        empty: true,
      },
    },
  });
  await page.goto('/#board');
  await page.getByRole('button', { name: 'New entity' }).click();
  const dialog = page.getByRole('dialog', { name: 'New entity' });
  await dialog.getByLabel('Type').selectOption('person');
  await dialog.getByLabel('Full name').fill('New subject');
  await dialog.locator('input[type=file]').setInputFiles([
    {
      name: 'portrait one.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>'),
    },
    {
      name: 'portrait two.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"/>'),
    },
  ]);
  await dialog.getByRole('button', { name: 'Use portrait two as primary photo' }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
  await expect(page.getByText('Primary', { exact: true })).toBeVisible();
  expect(fixture.galleryWrites).toEqual([
    { method: 'UPLOAD', entityId: 'e_new', imageId: 'photo-direct-1' },
    { method: 'UPLOAD', entityId: 'e_new', imageId: 'photo-direct-2' },
    { method: 'PUT', entityId: 'e_new', imageId: 'photo-direct-2' },
  ]);
  expect(fixture.uploads).toEqual([]);
  fixture.expectNoUnexpectedRequests();
});
