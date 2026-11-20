import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A picture wall made from scratch in the note: `/` › Chart › Picture wall opens its form,
 * a picture is picked from the case's own, its label, words, group and grade are typed, a
 * folder of the case's pictures is added at once, and its settings crop every picture to
 * 4:3. Each gesture writes the block the engine reads; the server is stood in for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const picture = (id, label, folder) => ({
  id, type: 'media', label, attrs: { path: `media/${folder}/${label}`, folder, kind: 'image', sha256: id.padEnd(64, '0') }, provenance: made,
});
const CATALOG = [
  { id: 'n1', type: 'note', label: 'Front', attrs: { path: 'notes/Front.md', folder: '' }, provenance: made },
  picture('e_0000000001', 'vehicle-01.jpg', 'crops'), picture('e_0000000002', 'vehicle-02.jpg', 'crops'),
  picture('e_0000000010', 'vehicle-10.jpg', 'crops'),
];
const NOTE = 'Every vehicle, one frame each.';
const KIND = {
  name: 'pictures', label: 'Picture wall', counts: true, per_row: true, parts: false, stacked: false, style: 'report',
  keys: ['picture', 'label', 'words', 'shape', 'flag', 'flags'], values: ['Streit Cougar'],
};
// a frame's small picture, a pixel of sand
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48OEDAAWEApz8B9gFAAAAAElFTkSuQmCC', 'base64');

async function withNote(page) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const asked = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text: NOTE } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/media/metadata`, (route) => {
    const { paths } = route.request().postDataJSON();
    return route.fulfill({ json: paths.map((path) => ({ path, thumb_state: 'ready', thumbnail: `${path}.thumb.png` })) });
  });
  await page.route(`**/files/${CASE_ID}/media/**`, (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    const body = route.request().postDataJSON();
    asked.push(body.text);
    const frames = (body.text.match(/\| (?:\[\[media:)?e_\d+/g) ?? []).length;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 200" width="640" height="200"><title>wall</title><text x="20" y="40">${frames} frames</text></svg>`;
    const headers = {
      'X-Chart-Title': '""', 'X-Chart-Proposed-Title': JSON.stringify(`${frames} pictures, by group and grade`), 'X-Chart-Kind': JSON.stringify(KIND),
      'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]', 'X-Chart-Colours': '[]',
    };
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg, headers });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Front"]').click();
  await expect(page.locator('.cm-content')).toContainText(NOTE);
  return { written, asked };
}

const last = (written) => () => written.at(-1) ?? '';

test('a picture wall from scratch: a picture picked from the case, its words, a folder added at once, cropped 4:3', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const { written, asked } = await withNote(page);

  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/chart');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Chart');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Pick a chart' });
  const scratch = picker.getByRole('button', { name: /^Picture wall, from scratch/ });
  await expect(scratch).toContainText('A picture of the case a row');
  await scratch.click();

  const chart = page.locator('.cm-chart-block').first();
  const form = chart.getByRole('group', { name: 'The chart’s data' });
  await expect(form).toBeVisible();
  await expect(chart.locator('.cm-chart-empty')).toHaveText('Add a picture of the case: the wall is drawn as you fill it.');
  const STARTER = '::: chart\nkind: pictures\npicture: Picture\nlabel: #\n| Picture | # |\n| --- | --- |\n:::';
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${STARTER}\n`);

  // the first row is a picture: pressed, the case's own pictures open, small pictures and all
  const row = (index) => form.locator(`.cf-body .cf-row[data-row="${index}"]`);
  await row(0).getByRole('button', { name: 'Pick a picture of the case' }).click();
  const pictures = page.getByRole('dialog', { name: 'A picture for the wall' });
  await expect(pictures).toBeVisible();
  await expect(pictures.locator('.cm-picker-thumb img').first()).toHaveAttribute('src', /vehicle-01\.jpg\.thumb\.png$/);
  await pictures.getByRole('option', { name: /vehicle-02\.jpg/ }).click();
  await expect(row(0).getByRole('button', { name: /^Picture: vehicle-02\.jpg/ })).toBeVisible();
  await expect(row(0).getByLabel('#', { exact: true })).toBeFocused();
  await page.keyboard.type('#2');
  await page.keyboard.press('Tab');
  await row(0).getByLabel('Words', { exact: true }).fill('burned');
  await row(0).getByLabel('Group', { exact: true }).fill('Streit Cougar');
  await row(0).getByLabel('Grade', { exact: true }).fill('Confirmed');
  await page.keyboard.press('Tab');
  const ONE = ['::: chart', 'kind: pictures', 'by: Group', 'colour by: Grade', 'picture: Picture', 'label: #', 'words: Words',
    '| Picture | # | Words | Group | Grade |', '| --- | --- | --- | --- | --- |',
    '| [[media:e_0000000002|vehicle-02.jpg]] | #2 | burned | Streit Cougar | Confirmed |'];
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${[...ONE, ':::'].join('\n')}\n`);
  await expect(chart.locator('.cm-chart-figure svg text')).toHaveText('1 frames');

  // a folder of the case's pictures at once, the one shown already left unticked
  await form.getByRole('button', { name: 'Fill from the case…' }).click();
  const fill = form.getByRole('region', { name: 'Fill from the case' });
  await expect(fill.getByLabel('Folder')).toHaveValue('crops');
  await expect(fill.locator('.cf-fill-said')).toHaveText('already in the wall');
  await fill.getByRole('button', { name: 'Add 2 pictures' }).click();
  const THREE = [...ONE, '| [[media:e_0000000001|vehicle-01.jpg]] | #1 | | | |', '| [[media:e_0000000010|vehicle-10.jpg]] | #10 | | | |', ':::'].join('\n');
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${THREE}\n`);
  await expect(chart.locator('.cm-chart-figure svg text')).toHaveText('3 frames');
  expect(asked.at(-1)).toBe(THREE);

  // its settings: groups, the bar's colour and the shape in place of a count
  await form.getByRole('button', { name: 'Close the form' }).click();
  await chart.getByRole('button', { name: 'Settings' }).click();
  const settings = chart.getByRole('group', { name: 'Chart settings' });
  await expect(settings.getByLabel('Groups')).toHaveValue('Group');
  await expect(settings.getByLabel('Bar coloured by')).toHaveValue('Grade');
  await expect(settings.getByLabel('Count')).toHaveCount(0);
  await expect(settings.getByRole('radiogroup', { name: 'Flag' })).toBeVisible();
  await settings.getByRole('radiogroup', { name: 'Shape' }).getByRole('radio', { name: '4:3' }).click();
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${THREE.replace('words: Words', 'words: Words\nshape: 4:3')}\n`);
});
