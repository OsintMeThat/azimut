import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * A chart from scratch in the note: `/` › Chart shows every kind with no table, Timeline
 * opens its form on the chart it writes, five events and a period are filled and drawn as
 * they come; then a donut of categories with a colour of the chart's; then a timeline filled
 * from the case's events, listed before they are written. The server is stood in for.
 */

const at = '2026-10-01T10:00:00Z';
const made = { by: 'user', at, status: 'confirmed' };
const CATALOG = [{ id: 'n1', type: 'note', label: 'Front', attrs: { path: 'notes/Front.md', folder: '' }, provenance: made }];
const NOTE = 'How the front fell.';
const svg = (words) => `<svg xmlns="http://www.w3.org/2000/svg" class="az-chart az-chart-report" viewBox="0 0 640 220" width="640" height="220"><title>${words}</title><rect width="640" height="220" fill="#fff"/><text x="40" y="40">${words}</text></svg>`;
const KINDS = {
  timeline: { name: 'timeline', label: 'Timeline', counts: false, parts: false, stacked: false, style: 'report', keys: [] },
  donut: { name: 'donut', label: 'Donut', counts: true, parts: true, stacked: false, style: 'report', keys: ['centre'] },
};
const EVENTS = {
  items: [
    { id: 'p1', type: 'proof', day: '2026-10-18', last: '', precision: 'day', approximate: true, what: 'Giants Brigades on a peak of the Kahbub Mountains', refuted: false },
    { id: 'c1', type: 'claim', day: '2026-11-01', last: '', precision: 'month', approximate: false, what: 'A strike on the port', refuted: true },
    { id: 'p2', type: 'proof', day: '2026-11-10', last: '2026-11-14', precision: 'day', approximate: false, what: 'Presence northeast of Huwayrib', refuted: false },
  ],
  total: 3, undated: 1, first: '2026-10-18', last: '2026-11-14',
};

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
  await page.route(`**/api/cases/${CASE_ID}/notes/figure/events**`, (route) => {
    asked.push({ events: route.request().url() });
    return route.fulfill({ json: EVENTS });
  });
  await page.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => {
    const body = route.request().postDataJSON();
    asked.push({ figure: body.text });
    const kind = /\nkind: (.*)\n/.exec(body.text)?.[1] ?? 'timeline';
    const headers = {
      'X-Chart-Title': JSON.stringify(/\ntitle: (.*)\n/.exec(body.text)?.[1] ?? ''), 'X-Chart-Proposed-Title': JSON.stringify(kind === 'donut' ? 'At least 40 vehicles, by class' : ''),
      'X-Chart-Kind': JSON.stringify(KINDS[kind] ?? KINDS.timeline), 'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]',
      'X-Note-Warning-Fixes': '[]', 'X-Chart-Colours': '[]',
    };
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(kind), headers });
  });
  await page.goto('/#notebook');
  await page.locator('button[title="Open Front"]').click();
  await expect(page.locator('.cm-content')).toContainText(NOTE);
  return { written, asked };
}

const last = (written) => () => written.at(-1) ?? '';

async function slashChart(page) {
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/chart');
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toContainText('Chart');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Pick a chart' });
  await expect(picker).toBeVisible();
  return picker;
}

test('a timeline, then a donut, made from scratch in their forms, and a timeline filled from the case', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const { written, asked } = await withNote(page);

  // every kind, with no table in the note, each saying what it needs
  let picker = await slashChart(page);
  await expect(picker.locator('button.cf-scratch')).toHaveCount(15);
  await expect(picker.getByRole('button', { name: /^Timeline, from scratch/ })).toContainText('Days and what happened');
  await picker.getByRole('button', { name: /^Timeline, from scratch/ }).click();
  const chart = page.locator('.cm-chart-block').first();
  const form = chart.getByRole('group', { name: 'The chart’s data' });
  await expect(form).toBeVisible();
  await expect(chart.locator('.cm-chart-empty')).toHaveText('Add an event or a period: the timeline is drawn as you fill it.');
  await expect.poll(last(written)).toBe(`${NOTE}\n\n::: chart\nkind: timeline\n| When | What happened |\n| --- | --- |\n:::\n`);

  const row = (index) => form.locator(`.cf-body .cf-row[data-row="${index}"]`);
  const EVENTS_TYPED = [['2026-10-18', 'Giants Brigades on a peak'], ['2026-10-27', 'Shield Forces engage the Houthis'], ['2026-11-06', 'An assault pushed back'],
    ['2026-11-13', 'Forces at Dhubab airport'], ['2026-11-15', 'The vehicles of the two videos']];
  for (const [index, [day, what]] of EVENTS_TYPED.entries()) {
    if (index > 0) await form.getByRole('button', { name: '＋ Event' }).click();
    await row(index).getByLabel('Day', { exact: true }).fill(day);
    await row(index).getByLabel('What happened').fill(what);
    await page.keyboard.press('Tab');
  }
  await form.getByRole('button', { name: '＋ Period' }).click();
  await row(5).getByLabel('From', { exact: true }).fill('2026-11-10');
  await row(5).getByLabel('Until', { exact: true }).fill('2026-11-14');
  await row(5).getByLabel('What happened').fill('Presence northeast of Huwayrib');
  await page.keyboard.press('Tab');
  const TIMELINE = ['::: chart', 'kind: timeline', '| When | What happened | Until |', '| --- | --- | --- |', '| 18 Oct 2026 | Giants Brigades on a peak | |',
    '| 27 Oct 2026 | Shield Forces engage the Houthis | |', '| 6 Nov 2026 | An assault pushed back | |', '| 13 Nov 2026 | Forces at Dhubab airport | |',
    '| 15 Nov 2026 | The vehicles of the two videos | |', '| 10 Nov 2026 | Presence northeast of Huwayrib | 14 Nov 2026 |', ':::'].join('\n');
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${TIMELINE}\n`);
  // drawn as it was filled, through the figure route
  await expect(chart.locator('.cm-chart-figure svg title')).toHaveText('timeline');
  expect(asked.filter((one) => one.figure).at(-1).figure).toBe(TIMELINE);
  // the last row moved up one with Alt+↑, and one Undo puts it back
  await row(5).getByLabel('What happened').press('Alt+ArrowUp');
  await expect.poll(last(written)).toContain('| 10 Nov 2026 | Presence northeast of Huwayrib | 14 Nov 2026 |\n| 15 Nov 2026 |');
  await page.locator('.cm-line', { hasText: NOTE }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${TIMELINE}\n`);

  // a donut: five categories and their counts, floors, one colour of the chart's
  picker = await slashChart(page);
  await picker.getByRole('button', { name: /^Donut, from scratch/ }).click();
  const donut = page.locator('.cm-chart-block').nth(1);
  const donutForm = donut.getByRole('group', { name: 'The chart’s data' });
  await expect(donutForm).toBeVisible();
  await expect(chart.getByRole('group', { name: 'The chart’s data' })).toHaveCount(0);
  const CLASSES = [['MRAP', '23'], ['Pickup', '17'], ['APC', '9'], ['Truck', '7'], ['Tank', '4']];
  for (const [index, [name, count]] of CLASSES.entries()) {
    if (index > 0) await donutForm.getByRole('button', { name: '＋ Category' }).click();
    const line = donutForm.locator(`.cf-body .cf-row[data-row="${index}"]`);
    await line.getByLabel('Category', { exact: true }).fill(name);
    await line.getByLabel('Count', { exact: true }).fill(count);
    await page.keyboard.press('Tab');
  }
  await donutForm.getByLabel('These counts are floors').check();
  await donutForm.getByRole('button', { name: 'Colour of Tank' }).click();
  await page.getByRole('dialog', { name: 'Colour of Tank' }).getByRole('button', { name: '#e34948' }).click();
  await donutForm.getByRole('button', { name: 'Use it' }).click();
  const DONUT = ['::: chart', 'kind: donut', 'title: At least 40 vehicles, by class', 'count: Count (at least)', 'by: Category', 'colours: Tank #e34948',
    '| Category | Count (at least) |', '| --- | ---: |', '| MRAP | 23 |', '| Pickup | 17 |', '| APC | 9 |', '| Truck | 7 |', '| Tank | 4 |', ':::'].join('\n');
  await expect.poll(last(written)).toBe(`${NOTE}\n\n${TIMELINE}\n\n${DONUT}\n`);
  await expect(donut.getByRole('button', { name: 'Kind: Donut' })).toBeVisible();

  // a timeline filled from the case: listed first, the refuted one left unticked
  picker = await slashChart(page);
  await picker.getByRole('button', { name: /^Timeline, from scratch/ }).click();
  const filled = page.locator('.cm-chart-block').last().getByRole('group', { name: 'The chart’s data' });
  await filled.getByRole('button', { name: 'Fill from the case…' }).click();
  const region = filled.getByRole('region', { name: 'Fill from the case' });
  await expect(region.locator('.cf-fill-line')).toHaveCount(3);
  await expect(region.locator('.cf-fill-status')).toHaveText('3 in this period, 1 with no day left out.');
  await expect(region.locator('.cf-fill-line').nth(1)).toContainText('refuted');
  await expect(region.locator('.cf-fill-line').nth(1).locator('input')).not.toBeChecked();
  const before = written.at(-1);
  await region.getByRole('button', { name: 'Add 2 events' }).click();
  const FILLED = ['::: chart', 'kind: timeline', '| When | What happened | Until |', '| --- | --- | --- |', '| 18 Oct 2026 | Giants Brigades on a peak of the Kahbub Mountains | |',
    '| 10 Nov 2026 | Presence northeast of Huwayrib | 14 Nov 2026 |', ':::'].join('\n');
  await expect.poll(last(written)).toBe(before.replace('::: chart\nkind: timeline\n| When | What happened |\n| --- | --- |\n:::\n', `${FILLED}\n`));
  expect(asked.find((one) => one.events).events).toContain(`/api/cases/${CASE_ID}/notes/figure/events`);
});

/** The infographic route's drawing: a box per panel, in reading order. */
function page(text) {
  const kinds = [...text.matchAll(/^kind: (.*)$/gm)].map((match) => match[1]);
  return {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" width="1200" height="600"><rect width="1200" height="600" fill="#fff"/></svg>',
    width: 1200, height: 600, title: '', look: 'report', legend: { column: '', values: [] }, credit: '', alt: '', warnings: [],
    panels: kinds.map((kind, index) => ({ index, kind: 'chart', chart: kind, title: '', width: 'wide', x: 48, y: 120 + index * 220, w: 1100, h: 200 })),
  };
}

test('an infographic’s Add a panel makes a chart from scratch, its form open in its card', async ({ page: tab, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough for the gestures');
  const EMPTY = ':::: infographic\ntitle: The front\n::::';
  await installAppFixture(tab, { catalog: CATALOG });
  const written = [];
  let text = `${NOTE}\n\n${EMPTY}\n`;
  await tab.route(`**/api/cases/${CASE_ID}/entities/redirects`, (route) => route.fulfill({ json: { redirects: {} } }));
  await tab.route(`**/api/cases/${CASE_ID}/layer-palette`, (route) => route.fulfill({ json: { colours: [], icons: [] } }));
  await tab.route(`**/api/cases/${CASE_ID}/notes/infographic`, (route) => route.fulfill({ json: page(route.request().postDataJSON().text) }));
  await tab.route(`**/api/cases/${CASE_ID}/notes/figure`, (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: svg('key figures'), headers: {
      'X-Chart-Title': '""', 'X-Chart-Proposed-Title': '""', 'X-Chart-Kind': JSON.stringify({ name: 'key figures', label: 'Key figures', counts: false }),
      'X-Note-Warnings': '[]', 'X-Note-Warning-Lines': '[]', 'X-Note-Warning-Kinds': '[]', 'X-Note-Warning-Fixes': '[]', 'X-Chart-Colours': '[]',
    },
  }));
  await tab.route(`**/api/cases/${CASE_ID}/notes/n1`, async (route) => {
    if (route.request().method() === 'PUT') {
      text = route.request().postDataJSON().text;
      written.push(text);
      return route.fulfill({ json: { status: 'saved' } });
    }
    return route.fulfill({ json: { text } });
  });
  await tab.goto('/#notebook');
  await tab.locator('button[title="Open Front"]').click();
  await tab.locator('.cm-block-infographic .cm-ig-edit').click();
  const builder = tab.getByRole('complementary', { name: 'Infographic builder' });
  await builder.getByRole('button', { name: /Add a panel/ }).click();
  await builder.getByRole('button', { name: /^Key figures, from scratch/ }).click();
  const form = builder.getByRole('group', { name: 'The chart’s data' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Figure', { exact: true })).toBeFocused();
  await form.getByLabel('Figure', { exact: true }).fill('60');
  await tab.keyboard.press('Tab');
  await form.getByLabel('What it says', { exact: true }).fill('vehicles seen');
  await tab.keyboard.press('Tab');
  await expect.poll(() => written.at(-1) ?? '').toBe(`${NOTE}\n\n:::: infographic\ntitle: The front\n\n::: chart\nkind: key figures\nrows: own\n| Figure | What it says |\n| --- | --- |\n| 60 | vehicles seen |\n:::\n::::\n`);
});
