import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The board, in a real browser.
 *
 * This is the screen that made the hand-made vocabulary reachable at all: before
 * it, a `claim` or a `person` could only be created through the API, so a source
 * had nothing to be related to and a statement had nowhere to be read. A
 * source-reading test cannot tell whether the create form actually submits or
 * whether the row opens what it says it opens, so these run for real.
 */

const catalog = [
  {
    id: 'media-1',
    type: 'media',
    label: 'roadside photo',
    attrs: { path: 'media/panel.svg', kind: 'image' },
    provenance: { by: 'media-library', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
  },
  {
    id: 'place-1',
    type: 'place',
    label: 'checkpoint north',
    attrs: { lat: 48.8584, lon: 2.2945, folder: 'Leads' },
    provenance: { by: 'satellite', at: '2026-08-01T10:00:00Z', status: 'confirmed' },
  },
  {
    id: 'bm-1',
    type: 'bookmark',
    label: 'harbour watch thread',
    attrs: { url: 'https://example.test/t', reliability: 'B' },
    provenance: { by: 'ingest', at: '2026-08-02T08:00:00Z', status: 'suggested' },
  },
];

const claimChain = {
  entity: {
    id: 'e_new',
    type: 'claim',
    label: 'Where was this shot?',
    attrs: {},
    provenance: { by: 'user', at: '2026-08-03T10:00:00Z', status: 'confirmed' },
  },
  sources: [],
  lost: [],
  dependents: [],
  relations: [],
  empty: true,
};

async function openBoard(page, options = {}) {
  const fixture = await installAppFixture(page, { catalog, ...options });
  await page.goto('/#board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  return fixture;
}

test('opens from the case it belongs to, not from the rail of stages', async ({ page }) => {
  await installAppFixture(page, { catalog });
  await page.goto('/#media');

  // the rail is the pipeline, and the case is not one of its steps
  const rail = page.getByRole('navigation').first();
  await expect(rail.getByRole('button')).toHaveText(['Sources', 'Examine', 'Map', 'Compose', /Dark|Light/]);

  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect(page.getByTitle('Open the case board')).toHaveClass(/topbar-active/);
});

test('lists what the case holds, whatever the type', async ({ page }) => {
  const fixture = await openBoard(page);

  await expect(page.getByRole('cell', { name: /roadside photo/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /checkpoint north/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /harbour watch thread/ })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('filters by family, and asks the server to narrow rather than hiding rows', async ({ page }) => {
  const fixture = await openBoard(page);
  await expect(page.locator('tbody tr')).toHaveCount(3);

  await page.getByTitle('Filter by family').selectOption('collected');

  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: /roadside photo/ })).toBeVisible();
  // the family resolved to its types on the way out: the endpoint speaks types
  const narrowed = fixture.catalogQueries.filter((q) => q.includes('type='));
  expect(narrowed.at(-1)).toContain('media');
  expect(narrowed.at(-1)).toContain('capture');
});

test('filters by type inside the family', async ({ page }) => {
  await openBoard(page);

  await page.getByTitle('Filter by type').selectOption('place');

  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: /checkpoint north/ })).toBeVisible();
});

test('creates a claim, which nothing else in the app can do', async ({ page }) => {
  const fixture = await openBoard(page, { chains: { e_new: claimChain } });

  await page.getByRole('button', { name: 'New entity' }).click();
  await expect(page.getByRole('heading', { name: 'New entity' })).toBeVisible();
  await page.getByLabel('Type').selectOption('claim');
  await page.getByLabel('Statement').fill('Where was this shot?');
  // the fields come from the registry, not from a form written per type
  await page.getByLabel('How this was worked out').fill('spans counted against imagery');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect.poll(() => fixture.entityWrites.length).toBe(1);
  expect(fixture.entityWrites[0]).toMatchObject({
    type: 'claim',
    label: 'Where was this shot?',
    attrs: { method: 'spans counted against imagery' },
  });
  // and it lands on its own Details, because a claim exists to be pointed at things
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Statement')).toHaveValue('Where was this shot?');
});

test('shows an entity’s typed fields directly in Details', async ({ page }) => {
  const ip = {
    id: 'ip-1',
    type: 'ip',
    label: '203.0.113.42',
    attrs: {
      network: '203.0.113.0/24',
      asn: 'AS64496',
      provider: 'Example Transit',
      notes: 'Observed in the access log',
    },
    provenance: { by: 'user', at: '2026-08-03T10:00:00Z', status: 'confirmed' },
  };
  await openBoard(page, {
    catalog: [ip],
    chains: {
      'ip-1': { entity: ip, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });

  await page.getByRole('cell', { name: /203\.0\.113\.42/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('IP address')).toHaveValue('203.0.113.42');
  await expect(dialog.getByText('Legacy network', { exact: true })).toBeVisible();
  await expect(dialog.getByText('203.0.113.0/24', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('ASN')).toHaveValue('AS64496');
  await expect(dialog.getByLabel('Provider')).toHaveValue('Example Transit');
  await expect(dialog.getByLabel('Notes')).toHaveValue('Observed in the access log');
  await expect(dialog.getByRole('tab')).toHaveCount(0);
});

test('uses a relation instead of new free text for an IP network', async ({ page }) => {
  const fixture = await openBoard(page);

  await page.getByRole('button', { name: 'New entity' }).click();
  await page.getByLabel('Type').selectOption('ip');
  await page.getByLabel('IP address').fill('203.0.113.42');
  await expect(page.getByLabel('Legacy network')).toHaveCount(0);
  await page.getByLabel('ASN').fill('AS64496');
  await page.getByLabel('Notes').fill('Observed in the access log');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect.poll(() => fixture.entityWrites.length).toBe(1);
  expect(fixture.entityWrites[0]).toMatchObject({
    type: 'ip',
    label: '203.0.113.42',
    attrs: {
      asn: 'AS64496',
      notes: 'Observed in the access log',
    },
  });
});

test('shows the plate and notes while creating a vehicle', async ({ page }) => {
  const fixture = await openBoard(page);

  await page.getByRole('button', { name: 'New entity' }).click();
  await page.getByLabel('Type').selectOption('vehicle');
  await page.getByLabel('Vehicle name').fill('White pickup');
  await page.getByLabel('Plate').fill('AB-123-CD');
  await page.getByLabel('Notes').fill('Rear-left panel damaged');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect.poll(() => fixture.entityWrites.length).toBe(1);
  expect(fixture.entityWrites[0]).toMatchObject({
    type: 'vehicle',
    label: 'White pickup',
    attrs: { plate: 'AB-123-CD', notes: 'Rear-left panel damaged' },
  });
});

test('opens a row in the same Details panel every other surface uses', async ({ page }) => {
  await openBoard(page, {
    chains: {
      'bm-1': {
        entity: catalog[2],
        sources: [], lost: [], dependents: [], relations: [], empty: true,
      },
    },
  });

  await page.getByRole('cell', { name: /harbour watch thread/ }).click();

  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://example.test/t' })).toBeVisible();
  // the source's own grade is edited here, under Case, from the served scale
  await page.getByRole('tab', { name: 'Case' }).click();
  await expect(page.getByLabel('Source reliability')).toHaveValue('B');
});

test('keeps Add relation and Add mention as separate gestures', async ({ page }) => {
  const person = {
    id: 'person-1', type: 'person', label: 'Witness A', attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:00:00Z', status: 'confirmed' },
  };
  const note = {
    id: 'note-1', type: 'note', label: 'Field notes', attrs: {},
    provenance: { by: 'notebook', at: '2026-08-03T09:10:00Z', status: 'confirmed' },
  };
  const organization = {
    id: 'org-1', type: 'organization', label: 'Harbour group', attrs: {},
    provenance: { by: 'satellite', at: '2026-08-03T09:20:00Z', status: 'confirmed' },
  };
  const fixture = await openBoard(page, {
    catalog: [person, note, organization],
    chains: {
      'person-1': { entity: person, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });

  await page.getByRole('cell', { name: /Witness A/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Add relation' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add mention' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Add relation' }).click();
  await expect(dialog.getByRole('button', { name: /Harbour group/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Field notes/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: /Harbour group/ }).click();
  await dialog.locator('.picker.composer').getByRole('button', { name: 'Add relation' }).click();
  await expect.poll(() => fixture.linkWrites.length).toBe(1);
  expect(fixture.linkWrites[0]).toMatchObject({
    method: 'POST',
    body: { from_id: 'person-1', to_id: 'org-1', type: 'owns' },
  });

  await dialog.getByRole('button', { name: 'Add mention' }).click();
  await expect(dialog.getByRole('button', { name: /Field notes/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Harbour group/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: /Field notes/ }).click();
  await dialog.locator('.picker.composer').getByRole('button', { name: 'Add mention' }).click();
  await expect.poll(() => fixture.linkWrites.length).toBe(2);
  expect(fixture.linkWrites[1]).toMatchObject({
    method: 'POST',
    body: { from_id: 'note-1', to_id: 'person-1', type: 'mentions' },
  });
});

test('offers IP addresses and networks through Add relation', async ({ page }) => {
  const ip = {
    id: 'ip-1', type: 'ip', label: '203.0.113.42', attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:00:00Z', status: 'confirmed' },
  };
  const network = {
    id: 'network-1', type: 'network', label: '203.0.113.0/24', attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:10:00Z', status: 'confirmed' },
  };
  const people = Array.from({ length: 10 }, (_, index) => ({
    id: `person-${index}`, type: 'person', label: `Person ${index}`, attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:20:00Z', status: 'confirmed' },
  }));
  const fixture = await openBoard(page, {
    catalog: [ip, ...people, network],
    chains: {
      'ip-1': { entity: ip, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });

  await page.getByRole('cell', { name: /203\.0\.113\.42/ }).click();
  const dialog = page.getByRole('dialog');
  const add = dialog.getByRole('button', { name: 'Add relation' });
  await expect(add).toHaveAttribute('title', /Network/);
  await add.click();
  await dialog.getByRole('button', { name: /203\.0\.113\.0\/24/ }).click();
  await expect(dialog.locator('.picker.composer .verb')).toHaveText('is in network');
  await dialog.locator('.picker.composer').getByRole('button', { name: 'Add relation' }).click();

  await expect.poll(() => fixture.linkWrites.length).toBe(1);
  expect(fixture.linkWrites[0]).toMatchObject({
    method: 'POST',
    body: { from_id: 'ip-1', to_id: 'network-1', type: 'in-network' },
  });
});

test('keeps both readings when relation endpoints share a type', async ({ page }) => {
  const parent = {
    id: 'network-parent', type: 'network', label: '203.0.112.0/23', attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:00:00Z', status: 'confirmed' },
  };
  const child = {
    id: 'network-child', type: 'network', label: '203.0.113.0/24', attrs: {},
    provenance: { by: 'user', at: '2026-08-03T09:10:00Z', status: 'confirmed' },
  };
  const fixture = await openBoard(page, {
    catalog: [parent, child],
    chains: {
      'network-parent': {
        entity: parent, sources: [], lost: [], dependents: [], relations: [], empty: true,
      },
    },
  });

  await page.getByRole('cell', { name: /203\.0\.112\.0\/23/ }).click();
  const composer = page.getByRole('dialog').locator('.picker.composer');
  await page.getByRole('dialog').getByRole('button', { name: 'Add relation' }).click();
  await composer.getByRole('button', { name: /203\.0\.113\.0\/24/ }).click();
  const reading = composer.locator('.verb-select');
  await expect(reading.locator('option')).toHaveText(['is in network', 'contains']);
  await reading.selectOption('in-network:in');
  await composer.getByRole('button', { name: 'Add relation' }).click();

  await expect.poll(() => fixture.linkWrites.length).toBe(1);
  expect(fixture.linkWrites[0]).toMatchObject({
    method: 'POST',
    body: { from_id: 'network-child', to_id: 'network-parent', type: 'in-network' },
  });
});

test('sorts on a heading, and reverses on a second click', async ({ page }) => {
  await openBoard(page);
  const names = async () =>
    (await page.locator('tbody tr td:first-child').allInnerTexts()).map((t) => t.trim());

  await page.getByRole('button', { name: 'Name' }).click();

  expect(await names()).toEqual(['checkpoint north', 'harbour watch thread suggested', 'roadside photo']);
  await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');

  await page.getByRole('button', { name: 'Name' }).click();

  expect(await names()).toEqual(['roadside photo', 'harbour watch thread suggested', 'checkpoint north']);
  await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
});

test('names the analyst’s own folder the way the rest of the app does', async ({ page }) => {
  await openBoard(page);

  await expect(page.getByRole('columnheader', { name: 'Folder' })).toBeVisible();
  await expect(page.getByTitle('the My-work folder it is filed in')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Leads' })).toBeVisible();
});

test('sorts by type too, so a mixed case can be read a family at a time', async ({ page }) => {
  await openBoard(page);

  await page.getByRole('button', { name: 'Type' }).click();

  expect(await page.locator('tbody tr td:nth-child(2)').allInnerTexts()).toEqual([
    'Bookmark', 'Media', 'Place',
  ]);
});

test('shows a type’s own columns only once one type is picked', async ({ page }) => {
  await openBoard(page);

  await expect(page.getByRole('columnheader', { name: 'Source reliability' })).toHaveCount(0);

  await page.getByTitle('Filter by type').selectOption('bookmark');

  await expect(page.getByRole('columnheader', { name: 'Source reliability' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'B', exact: true })).toBeVisible();
});

test('explains the vocabulary where it uses it', async ({ page }) => {
  await openBoard(page);

  const claimReads = 'a statement about the rest of the case, carrying its own reasoning';
  // the family filter says what a family is before it is chosen, on the option
  // itself — a reading only visible afterwards explains it to whoever already knew
  await expect(page.locator(`option[title="${claimReads}"]`)).toHaveCount(1);

  // and on the control once one is chosen
  await page.getByTitle('Filter by family').selectOption('claim');
  await expect(page.locator(`select[title="${claimReads}"]`)).toBeVisible();

  // and the create menu says what the type it is about to file actually is
  await page.getByRole('button', { name: 'New entity' }).click();
  await page.getByLabel('Type').selectOption('claim');
  await expect(page.getByTitle('something you are saying about the case')).toBeVisible();
  // including on the field the registry generated for it
  await expect(page.getByTitle('the reasoning a reader would need to check this')).toBeVisible();
});

test('asks the server when the case is larger than one page', async ({ page }) => {
  // The bug this pins: client-side filtering is switched off in server mode, so a
  // board that never handed the term to the list went quiet at exactly the case
  // size that needed it — typing did nothing, with nothing said.
  const fixture = await openBoard(page, { catalogPage: 2 });
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText(/Showing 2 of 3/)).toBeVisible();

  await page.getByPlaceholder('Search the case…').fill('harbour');

  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: /harbour watch thread/ })).toBeVisible();
  expect(fixture.catalogQueries.at(-1)).toContain('q=harbour');
});

test('settles a proposal from the row it is read on', async ({ page }) => {
  const fixture = await openBoard(page);
  await page.getByTitle('Show what a tool proposed, or what was confirmed').selectOption('suggested');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await page.getByTitle('Confirm this item').click();

  await expect(fixture.entityWrites.at(-1)).toEqual({
    method: 'PATCH',
    id: 'bm-1',
    body: { status: 'confirmed' },
  });
  // it leaves the Suggested filter, which is the whole point of confirming it
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('dismisses a proposal through the delete that can be undone', async ({ page }) => {
  const fixture = await openBoard(page);

  await page.getByTitle('Dismiss this item, recoverable from the trash').click();

  expect(fixture.entityWrites.at(-1)).toMatchObject({ method: 'DELETE', id: 'bm-1' });
  await expect(page.getByRole('cell', { name: /harbour watch thread/ })).toHaveCount(0);
});

test('takes a file into the case and opens what it filed', async ({ page }) => {
  // The capability existed under "Media", a word that says nothing about a scanned
  // plan; what was missing is a way in from the screen the case is read on.
  const fixture = await openBoard(page, {
    chains: {
      'media-imported': {
        entity: {
          id: 'media-imported',
          type: 'media',
          label: 'site plan',
          attrs: { path: 'media/site plan.pdf', kind: 'file', sha256: 'abc' },
          provenance: { by: 'media-library', at: '2026-08-04T09:00:00Z', status: 'confirmed' },
        },
        sources: [], lost: [], dependents: [], relations: [], empty: true,
      },
    },
  });

  await page.getByRole('button', { name: 'Add file' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'site plan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fixture'),
  });

  await expect.poll(() => fixture.uploads.length).toBe(1);
  // one file opens where the analyst can say what it is
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('site plan');
});

test('draws a document as a document, never as a photograph', async ({ page }) => {
  const plan = {
    id: 'media-2',
    type: 'media',
    label: 'harbour plan',
    attrs: { path: 'media/harbour plan.pdf', kind: 'file' },
    provenance: { by: 'media-library', at: '2026-08-04T09:00:00Z', status: 'confirmed' },
  };
  await openBoard(page, { catalog: [catalog[0], plan] });
  await expect(page.locator('tbody tr')).toHaveCount(2);

  const icons = await page.locator('tbody tr td:first-child svg path').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('d'))
  );

  // two rows, two glyphs: an image and a document, told apart by what the bytes are
  expect(new Set(icons).size).toBe(2);
});

test('hands a document back to the desktop instead of downloading a copy', async ({ page }) => {
  const plan = {
    id: 'media-2',
    type: 'media',
    label: 'harbour plan',
    attrs: { path: 'media/harbour plan.pdf', kind: 'file' },
    provenance: { by: 'media-library', at: '2026-08-04T09:00:00Z', status: 'confirmed' },
  };
  const fixture = await openBoard(page, {
    catalog: [plan],
    chains: {
      'media-2': { entity: plan, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });

  await page.getByRole('cell', { name: /harbour plan/ }).click();
  const dialog = page.getByRole('dialog');

  // no download link and no tool to send it to: neither exists for a document
  await expect(dialog.getByRole('link', { name: 'Open file' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Open in tool' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Show in folder' }).click();

  await expect.poll(() => fixture.revealed).toEqual(['media/harbour plan.pdf']);
});
