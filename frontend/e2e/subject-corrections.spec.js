import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

const subject = (id, label, at) => ({ id, type: 'vehicle', label, attrs: { plate: 'AA1234' }, provenance: { by: 'user', at, status: 'confirmed' } });
const newer = subject('newer', 'Convoy vehicle', '2026-09-02T12:00:00Z');
const older = subject('older', 'Earlier vehicle', '2026-09-01T12:00:00Z');
const chain = (entity) => ({ entity, sources: [], lost: [], dependents: [], relations: [], empty: true });

async function setup(page) {
  const fixture = await installAppFixture(page, { catalog: [newer, older] });
  let current = structuredClone(newer);
  let merged = false;
  let restored = false;
  const writes = [];
  await page.route(`**/api/cases/${CASE_ID}/entities/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/chain')) {
      const id = url.pathname.split('/').at(-2);
      return send(chain(id === 'older' ? older : current));
    }
    if (url.pathname.endsWith('/merges')) return send({ merges: merged ? [{ id: 'merge-1', merged_label: newer.label }] : [] });
    if (url.pathname.endsWith('/merge-preview')) return send({
      fields: { kept: { plate: 'AA1234' }, added: {}, conflicts: [] },
      links: { moved: 2, twins: 0, loops: 0 }, refused: [], images: {}, pins: {}, views: [], sheets: 0, notes: 1,
    });
    if (url.pathname.endsWith('/merge')) {
      writes.push({ path: url.pathname, body: request.postDataJSON() }); merged = true;
      return send({ merge: 'merge-1', survivor: older, warnings: [] });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON(); writes.push(body);
      if (body.type) {
        current = { ...current, type: body.type, attrs: { plate: 'AA1234', _retained_fields: { plate: 'vehicle' } } };
      } else if (body.attrs?.plate === null) current.attrs = {};
      return send(current);
    }
    return route.fallback();
  });
  await page.route(`**/api/cases/${CASE_ID}/merges/merge-1/undo`, async (route) => {
    merged = false; restored = true;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ restored: newer, survivor: older.id, lost: [] }) });
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ has: page.locator('.name', { hasText: newer.label }) }).locator('td:not(.pick)').first().click();
  await expect(page.getByRole('dialog', { name: 'Details', exact: true })).toBeVisible();
  return { fixture, writes, restored: () => restored };
}

test('changes a subject type and explicitly removes a retained field', async ({ page }) => {
  const state = await setup(page);
  const details = page.getByRole('dialog', { name: 'Details', exact: true });
  await details.getByRole('button', { name: 'Change type…', exact: true }).click();
  await details.getByLabel('New type').selectOption('organization');
  await details.getByRole('button', { name: 'Change type', exact: true }).click();
  await expect(details.getByText('Kept from Vehicle', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Remove Plate' })).toBeVisible();
  await details.getByRole('button', { name: 'Remove Plate' }).click();
  await expect(details.getByText('Kept from Vehicle', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([{ type: 'organization' }, { attrs: { plate: null } }]);
  state.fixture.expectNoUnexpectedRequests();
});

test('previews the older survivor, merges, and undoes from Details', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Merge…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge subjects', exact: true });
  await dialog.getByRole('option', { name: /Earlier vehicle/ }).click();
  await expect(dialog.getByRole('button', { name: /Keep Earlier vehicle/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('table', { name: 'Fields after merging' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('merge-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('merge-mobile.png') });
  await dialog.getByRole('button', { name: 'Merge subjects', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes[0]).toEqual({ path: `/api/cases/${CASE_ID}/entities/older/merge`, body: { other: 'newer' } });
  const details = page.getByRole('dialog', { name: 'Details', exact: true });
  await expect(details.getByText('Merged from')).toBeVisible();
  await details.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(state.restored).toBe(true);
  await expect(details.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  state.fixture.expectNoUnexpectedRequests();
});
