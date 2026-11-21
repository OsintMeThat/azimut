import { test, expect } from '@playwright/test';
import { CASE_ID, GRAPH_THUMB, PANEL_PATH, installAppFixture } from './app.fixture.js';

/**
 * A sheet that reads like the case: pictures drawn as pictures, worklists that follow.
 *
 * A sheet made from a picture wall's rows holds labels and links where the note held
 * `[[media:…]]` chips (`engine/sheets.adopt_chips`): the grid draws each picture's thumbnail
 * under its label and never the code. A worklist built out of the case's proofs gains a row
 * when a proof is filed elsewhere, with nobody pressing anything.
 */

const SHOTS = process.env.SHEET_SHOTS;

async function openSheet(page, name) {
  await page.goto('/#sheet');
  await expect(page.getByRole('heading', { name: 'Sheet', exact: true })).toBeVisible();
  await page.locator('.home .sheet', { hasText: name }).first().click();
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).toBeVisible();
}

const cell = (page, row, column) => page.locator(`#sheet-cell-${row}-${column}`);

/** The server's nudges, sent by hand: the stream the app listens to, with one way in. */
const hearNudges = (page) => page.addInitScript(() => {
  window.EventSource = class {
    constructor() {
      window.nudge = (event) => this.onmessage({ data: JSON.stringify(event) });
    }
  };
});

test('a sheet made from a wall’s rows shows its pictures and labels, and no code', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installAppFixture(page, {
    sheets: [['Wall rows', ['Picture', '#', 'Model'], [
      ['#1', '1', 'Streit Cougar'],
      ['#2', '2', 'Oshkosh M-ATV'],
      // pasted a moment ago, before the save that settles its chip
      ['[[media:e_frame3|#3]]', '3', 'BMC Kirpi'],
    ], {
      roles: { Picture: { kind: 'picture' } },
      links: { r1: { Picture: 'e_frame1' }, r2: { Picture: 'e_frame2' } },
    }, {
      pictures: {
        e_frame1: { label: 'frame-1.jpg', type: 'media', kind: 'image', thumb: PANEL_PATH },
        e_frame2: { label: 'frame-2.jpg', type: 'media', kind: 'image', thumb: GRAPH_THUMB },
        e_frame3: { label: 'frame-3.jpg', type: 'media', kind: 'image', thumb: PANEL_PATH },
      },
    }]],
  });
  await openSheet(page, 'Wall rows');

  for (const [row, label] of [[0, '#1'], [1, '#2'], [2, '#3']]) {
    const picture = cell(page, row, 1).locator('img');
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    await expect(cell(page, row, 1).locator('.value')).toHaveText(label);
  }
  await expect(cell(page, 0, 1).locator('img')).toHaveAttribute('src', `/files/${CASE_ID}/${PANEL_PATH}`);
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).not.toContainText('[[');

  // Tall rows have room to tell the frames apart.
  await page.getByRole('button', { name: 'Tall rows' }).click();
  await expect.poll(() => cell(page, 0, 1).locator('img').evaluate((node) => node.getBoundingClientRect().height))
    .toBeGreaterThan(40);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-wall-sheet.png` });
  await fixture.expectNoUnexpectedRequests();
});

test('a geolocations worklist gains a row after a proof is filed, without a press', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await hearNudges(page);
  const fixture = await installAppFixture(page, {
    sheets: [['My geolocations', ['Title', 'Place', 'Status', 'Notes'], [
      ['Rooftop shot', 'Rooftop', 'done', ''],
    ], {
      roles: { Title: { kind: 'locked' }, Place: { kind: 'locked' }, Status: { kind: 'state' } },
      links: { r1: { Title: 'e_proof1' } },
      built: { r1: 'e_proof1' },
    }, { shape: 'proofs' }]],
  });
  await openSheet(page, 'My geolocations');

  const grid = page.getByRole('grid', { name: 'Sheet rows' });
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  await expect(page.locator('.follows')).toBeVisible();
  // Asked on open; the case had nothing new, so nothing was written.
  await expect.poll(() => fixture.sheetWrites.length).toBe(0);
  await expect(grid).not.toContainText('Bridge shot');

  // A proof filed in another tool: the case reloads, and the sheet follows.
  fixture.fileInCase('sheet-1', ['Bridge shot', 'Bridge', 'done', '']);
  await page.evaluate((id) => window.nudge({ type: 'saved', case_id: id }), CASE_ID);

  await expect(grid).toContainText('Bridge shot');
  await expect(page.locator('.follows')).toContainText('1 row added');
  expect(fixture.sheetWrites.map((write) => write.kind)).toEqual(['refresh']);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-worklist-follows.png` });
  await fixture.expectNoUnexpectedRequests();
});
