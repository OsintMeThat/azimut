import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The Case Sheet, in a real browser.
 *
 * The grid is the one tool here whose behaviour is mostly *gestures* — a cell entered on
 * a keystroke, a selection pulled with the arrows, an autosave nobody pressed, a banner
 * that appears because a file moved on disk. None of that is reachable from a unit test
 * with a fake DOM: the render tests drive the component's own functions, so they prove
 * the model and say nothing about whether typing into the screen reaches the file.
 *
 * So these run for real, and they are deliberately about the seams:
 * the keyboard reaching the table, the autosave presenting the stamp it read, the
 * sidecar going out on its own route, and the refusal an analyst meets when a
 * spreadsheet has the same file open.
 */

const SHEETS = [
  ['Candidates', ['Subject', 'Status', 'Notes'], [
    ['Quai sud', 'To check', ''],
    ['Pont nord', 'Seen', 'two frames'],
    ['Rue basse', 'Ruled out', ''],
  ]],
];

async function openSheet(page) {
  await page.goto('/#sheet');
  await expect(page.getByRole('heading', { name: 'Sheet', exact: true })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Sheet rows' })).toBeVisible();
}

const cell = (page, row, column) => page.locator(`#sheet-cell-${row}-${column}`);

/** Put the cursor in a cell and wait until the grid says so, before anything is typed.
 *  Under a loaded machine the click and the first keystroke can otherwise cross. */
async function focusCell(page, row, column) {
  const target = cell(page, row, column);
  await target.click();
  await expect(target).toHaveClass(/cursor/);
  return target;
}

/** Type into the cell under the cursor and commit, waiting for the editor to exist so a
 *  slow mount cannot swallow the run. */
async function typeInto(page, row, column, text) {
  await focusCell(page, row, column);
  await page.keyboard.press(text[0]);
  await expect(cell(page, row, column).locator('textarea')).toBeVisible();
  if (text.length > 1) await page.keyboard.type(text.slice(1));
  await page.keyboard.press('Enter');
}

test('types into a cell and autosaves it, presenting the stamp it read', async ({ page }) => {
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  await typeInto(page, 0, 2, 'Seen');

  // Nobody pressed save. The grid writes on its own, and what it writes is the table.
  await expect.poll(() => fixture.sheetWrites.filter((write) => write.kind === 'table').length)
    .toBeGreaterThan(0);
  await expect(cell(page, 0, 2)).toContainText('Seen');
  expect(fixture.sheetOnDisk('sheet-1').rows[0][2]).toBe('Seen');
  await fixture.expectNoUnexpectedRequests();
});

test('Tab off the last cell grows the sheet', async ({ page }) => {
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  const before = fixture.sheetOnDisk('sheet-1').rows.length;
  await focusCell(page, 2, 3);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Pont vieux');
  await page.keyboard.press('Enter');

  await expect.poll(() => fixture.sheetOnDisk('sheet-1').rows.length).toBe(before + 1);
});

/**
 * The vocabulary a column offers opens **downwards**, so on the last row of a short sheet
 * it lands right across the empty line the grid ends on. Both lists are moved with a
 * transform — a stacking context each — and the empty line, drawn last, simply painted on
 * top: a click meant for a word added a row instead, and the word was never written.
 */
test('a word offered over the empty last line is the thing that is clicked', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    sheets: [['Candidates', ['Subject', 'Status'], [
      ['Quai sud', ''],
      ['Pont nord', ''],
      ['Rue basse', ''],
    ], { roles: { Status: { kind: 'choice', values: ['to check', 'seen', 'ruled out'] } } }]],
  });
  await openSheet(page);

  const rowsBefore = fixture.sheetOnDisk('sheet-1').rows.length;
  await focusCell(page, 2, 2);
  await page.keyboard.press('Enter');
  const offers = page.locator('.offers');
  await expect(offers).toBeVisible();

  // Whichever word happens to land over the empty line, taken by a click on the word.
  const ghost = await page.locator('.rows.ghost .row').boundingBox();
  const words = await offers.getByRole('button').all();
  let over = null;
  for (const word of words) {
    const box = await word.boundingBox();
    if (box.y < ghost.y + ghost.height && box.y + box.height > ghost.y) over = word;
    if (over) break;
  }
  expect(over).not.toBeNull();
  const chosen = (await over.textContent()).trim();
  await over.click();

  await expect(cell(page, 2, 2)).toContainText(chosen);
  expect(fixture.sheetOnDisk('sheet-1').rows.length).toBe(rowsBefore);
});

test('the search narrows the rows and is remembered without rewriting the CSV', async ({ page }) => {
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  await expect(page.locator('.count')).toContainText('3 of 3');
  await page.getByPlaceholder('Search these rows').fill('pont');
  await expect(page.locator('.count')).toContainText('1 of 3');

  // The question is the sidecar's, and the sidecar has a route of its own: asking it
  // must not rewrite the file, because that moves the stamp a save is made of.
  await expect.poll(() => fixture.sheetWrites.filter((write) => write.kind === 'meta').length)
    .toBeGreaterThan(0);
  expect(fixture.sheetWrites.filter((write) => write.kind === 'table')).toHaveLength(0);
  expect(fixture.sheetOnDisk('sheet-1').meta.query).toBe('pont');
});

test('a file changed underneath is noticed, and reading it is asked about first', async ({ page }) => {
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  // An edit the grid is holding, then the spreadsheet writes over the same file.
  await typeInto(page, 0, 2, 'mine');
  await expect.poll(() => fixture.sheetWrites.length).toBeGreaterThan(0);

  await fixture.moveSheetOnDisk('sheet-1', {
    rows: [['r1', 'Quai sud', 'theirs', ''], ['r2', 'Pont nord', 'Seen', 'two frames']],
  });
  await typeInto(page, 1, 2, 'again');

  const banner = page.locator('.notice.danger');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('changed on disk');

  // Reload drops the analyst's own unsaved work, so it asks before it does.
  await banner.getByRole('button', { name: 'Reload' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('lose your edits');
  await dialog.getByRole('button', { name: 'Reload' }).click();

  await expect(banner).toBeHidden();
  await expect(cell(page, 0, 2)).toContainText('theirs');
});

test('overwriting is asked about too, and then sends no stamp', async ({ page }) => {
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  await typeInto(page, 0, 2, 'mine');
  await expect.poll(() => fixture.sheetWrites.length).toBeGreaterThan(0);

  await fixture.moveSheetOnDisk('sheet-1', {});
  await typeInto(page, 1, 2, 'again');

  const banner = page.locator('.notice.danger');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Overwrite' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('loses them');
  await dialog.getByRole('button', { name: 'Overwrite' }).click();

  await expect(banner).toBeHidden();
  await expect.poll(() => fixture.sheetOnDisk('sheet-1').rows[0][2]).toBe('mine');
});

test('a drag chooses cells and paints no text, and the block copies and pastes', async ({ page }) => {
  // A press on a cell used to start the browser's own text selection as well, so pulling
  // a rectangle painted the headings and whatever sat past the table blue, and left that
  // highlight behind as the thing the next Ctrl+C would have taken. Only a real browser
  // has a text selection to get wrong, so this seam lives here.
  const fixture = await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  const from = await cell(page, 0, 1).boundingBox();
  const to = await cell(page, 1, 2).boundingBox();
  await page.mouse.move(from.x + 6, from.y + 6);
  await page.mouse.down();
  await page.mouse.move(to.x + 6, to.y + 6, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.foot')).toContainText('2 × 2 selected');
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');

  // Two rows by two columns, taken from the top of the sheet and put down on the last one.
  await page.keyboard.press('Control+c');
  await focusCell(page, 2, 1);
  await page.keyboard.press('Control+v');

  await expect(cell(page, 2, 1)).toContainText('Quai sud');
  await expect(cell(page, 2, 2)).toContainText('To check');
  await expect.poll(() => fixture.sheetOnDisk('sheet-1').rows[2][1]).toBe('Quai sud');
  await fixture.expectNoUnexpectedRequests();
});

test('names every key and gesture behind ?', async ({ page }) => {
  await installAppFixture(page, { sheets: SHEETS });
  await openSheet(page);

  await page.locator('#sheet-grid').click();
  await page.keyboard.press('?');

  const help = page.getByRole('dialog');
  await expect(help).toContainText('Ctrl+S');
  await expect(help).toContainText('Right-click a heading');
});

test('the empty case says what a sheet is for', async ({ page }) => {
  await installAppFixture(page, { sheets: [] });
  await page.goto('/#sheet');

  await expect(page.getByText('No sheet in this case.')).toBeVisible();
  await expect(page.getByText('A worklist that counts what is left')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New sheet' })).toBeVisible();
});
