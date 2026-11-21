import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A timeline's layout, colours and short labels, set on the chart: its settings say what
 * Auto drew and lay it numbered, colour it by its Kind column and shorten its labels, each
 * one line of the block drawn again; its form gives a new event its kind. The server is
 * stood in for, drawing the layout each block asks for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const CATALOG = [{ id: 'n1', type: 'note', label: 'Front', attrs: { path: 'notes/Front.md', folder: '' }, provenance: made }];
const BLOCK = ['::: chart', 'kind: timeline', 'title: The announcements', '| Day | What | Kind |', '| --- | --- | --- |',
  '| 5 Oct 2026 | Offensive opens, Dhubab airport taken, the strait claimed | Claim |', '| 9 Oct 2026 | The strait announced cleared | Claim |',
  '| 19 Oct 2026 | Government footage on the north edge of the peninsula | Geolocated |', ':::'].join('\n');
const NOTE = `How the front fell.\n\n${BLOCK}\n`;
const TIMELINE = { name: 'timeline', label: 'Timeline', counts: false, parts: false, stacked: false, style: 'report', keys: ['layout', 'labels'] };
const svg = (words) => `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 220" width="640" height="220"><title>${words}</title><rect width="640" height="220" fill="#fff"/><text x="40" y="40">${words}</text></svg>`;

async function withNote(page) {
  await installAppFixture(page, { catalog: CATALOG });
  const written = [];
  const drawn = [];
  await page.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      written.push(route.request().postDataJSON().text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text: NOTE } });
  });
  await page.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    const { text } = route.request().postDataJSON();
    drawn.push(text);
    // Auto draws three events across; a layout written is drawn as written
    const layout = /\nlayout: (\w+)\n/.exec(text)?.[1] ?? 'across';
    const short = /\nlabels: short\n/.test(text) ? ' short' : '';
    const coloured = /\ncolour by: (.*)\n/.exec(text)?.[1] ?? '';
    const headers = {
      'X-Chart-Title': JSON.stringify('The announcements'), 'X-Chart-Proposed-Title': '""',
      'X-Chart-Kind': JSON.stringify({ ...TIMELINE, layout }), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
      'X-Note-Warning-Fixes': '[]',
      'X-Chart-Colours': JSON.stringify(coloured ? [{ value: 'Claim', colour: '#1baf7a', origin: 'order' }, { value: 'Geolocated', colour: '#eb6834', origin: 'order' }] : []),
    };
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(`${layout}${short}${coloured ? ' by kind' : ''}`), headers });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Front"]').click();
  await expect(page.locator('.cm-content')).toContainText('How the front fell.');
  return { written, drawn };
}

const last = (written) => () => written.at(-1) ?? '';

test('a timeline is laid numbered, coloured by its kind and its labels shortened from its settings, and a new event given a kind in its form', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const { written, drawn } = await withNote(page);
  const chart = page.locator('.cm-chart-block').first();
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('across');

  await chart.getByRole('button', { name: 'Settings' }).click();
  const card = chart.getByRole('group', { name: 'Chart settings' });
  const layout = card.getByRole('radiogroup', { name: 'Layout' });
  await expect(layout.getByRole('radio')).toHaveText(['Auto', 'Across', 'Numbered', 'List']);
  await expect(layout.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
  await expect(card.locator('.cm-chart-field-note')).toHaveText('Drawn across here');

  // numbered: one line, drawn again
  await layout.getByRole('radio', { name: 'Numbered' }).click();
  const NUMBERED = NOTE.replace('title: The announcements\n', 'title: The announcements\nlayout: numbered\n');
  await expect.poll(last(written)).toBe(NUMBERED);
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('numbered');
  await expect(layout.getByRole('radio', { name: 'Numbered' })).toHaveAttribute('aria-checked', 'true');
  await expect(card.locator('.cm-chart-field-note')).toHaveCount(0);

  // coloured by its Kind column: the days and the words are not offered
  const colour = card.getByLabel('Coloured by');
  await expect(colour.locator('option')).toHaveText(['One colour', 'Kind']);
  await colour.selectOption('Kind');
  const COLOURED = NUMBERED.replace('title: The announcements\n', 'title: The announcements\ncolour by: Kind\n');
  await expect.poll(last(written)).toBe(COLOURED);
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('numbered by kind');

  // short labels
  await card.getByRole('radiogroup', { name: 'Labels' }).getByRole('radio', { name: 'Short' }).click();
  const SHORT = COLOURED.replace('layout: numbered\n', 'layout: numbered\nlabels: short\n');
  await expect.poll(last(written)).toBe(SHORT);
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('numbered short by kind');
  expect(drawn.at(-1)).toBe(SHORT.replace('How the front fell.\n\n', '').trimEnd());

  // the form, from The numbers that the Data line's Edit opens: a new event and its kind,
  // the layout and the labels as the card left them
  await card.locator('.cm-chart-data').getByRole('button', { name: 'Edit' }).click();
  await chart.getByRole('group', { name: 'The numbers' }).getByRole('button', { name: 'As a form' }).click();
  const form = chart.getByRole('group', { name: 'The chart’s data' });
  await expect(form.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Numbered' })).toHaveAttribute('aria-checked', 'true');
  await expect(form.getByLabel('Short labels')).toBeChecked();
  await form.getByRole('button', { name: '＋ Event' }).click();
  const row = form.locator('.cf-body .cf-row[data-row="3"]');
  await row.getByLabel('Day', { exact: true }).fill('2026-11-15');
  await row.getByLabel('What happened').fill('Withdrawal announced');
  await row.getByLabel('Kind').fill('Press');
  await page.keyboard.press('Tab');
  const ADDED = SHORT.replace('| Geolocated |\n:::', '| Geolocated |\n| 15 Nov 2026 | Withdrawal announced | Press |\n:::');
  await expect.poll(last(written)).toBe(ADDED);
});
