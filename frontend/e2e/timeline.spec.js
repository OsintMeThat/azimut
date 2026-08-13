import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

const person = {
  id: 'person-1',
  type: 'person',
  label: 'Harbour witness',
  attrs: {},
  provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
};

const source = {
  id: 'note-1',
  type: 'note',
  label: 'Interview notes',
  attrs: {},
  provenance: { by: 'user', at: '2026-08-01T09:10:00Z', status: 'confirmed' },
};

const mediaEntity = {
  id: 'media-1',
  type: 'media',
  label: 'Roadside camera frame',
  attrs: { path: 'media/panel.svg', kind: 'image' },
  provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
};

const undatedClaim = {
  id: 'claim-3',
  type: 'claim',
  label: 'Resolve the timezone of the second interview',
  attrs: { time_role: 'observed' },
  provenance: { by: 'user', at: '2026-08-01T09:20:00Z', status: 'confirmed' },
};

const timelineItems = [
  {
    id: 'temporal:claim:claim-1', owner_id: 'claim-1', category: 'statement', kind: 'claim',
    label: 'Witness arrived at the north checkpoint', raw: '2026-06-18',
    earliest: '2026-06-18T00:00:00Z', latest: '2026-06-19T00:00:00Z', precision: 'day',
    shape: 'instant', time_role: 'occurred', uncertain: false, approximate: false,
    zone: 'date-only', sortable: true, status: 'confirmed', confidence: 'probable',
    parse_error: null, subjects: ['person-1'], places: [], sources: ['note-1'],
    subject_entities: [{ id: 'person-1', label: 'Harbour witness', type: 'person' }],
    place_entities: [],
    source_entities: [{ id: 'note-1', label: 'Interview notes', type: 'note' }],
  },
  {
    id: 'temporal:claim:claim-2', owner_id: 'claim-2', category: 'statement', kind: 'claim',
    label: 'Vehicle remained near the eastern road', raw: '2026-06-12/2026-07-04',
    earliest: '2026-06-12T00:00:00Z', latest: '2026-07-05T00:00:00Z', precision: 'day',
    shape: 'interval', time_role: 'valid', uncertain: true, approximate: true,
    zone: 'date-only', sortable: true, status: 'confirmed', confidence: 'possible',
    parse_error: null, subjects: [], places: [], sources: [],
  },
  {
    id: 'temporal:claim:claim-4', owner_id: 'claim-4', category: 'statement', kind: 'claim',
    label: 'Second convoy cleared the gate after the radio call', raw: '2026-06-18',
    earliest: '2026-06-18T00:00:00Z', latest: '2026-06-19T00:00:00Z', precision: 'day',
    shape: 'instant', time_role: 'observed', uncertain: false, approximate: false,
    zone: 'date-only', sortable: true, status: 'confirmed', confidence: 'possible',
    parse_error: null, subjects: [], places: [], sources: [],
  },
  {
    id: 'temporal:claim:claim-5', owner_id: 'claim-5', category: 'statement', kind: 'claim',
    label: 'Third sighting placed the crane near the south quay', raw: '2026-06-19',
    earliest: '2026-06-19T00:00:00Z', latest: '2026-06-20T00:00:00Z', precision: 'day',
    shape: 'instant', time_role: 'observed', uncertain: true, approximate: false,
    zone: 'date-only', sortable: true, status: 'suggested', confidence: 'probable',
    parse_error: null, subjects: [], places: [], sources: [],
  },
  {
    id: 'temporal:media:media-1:captured', owner_id: 'media-1', category: 'media', kind: 'captured',
    label: 'Roadside camera frame', raw: '2026-06-23T18:42:11Z',
    earliest: '2026-06-23T18:42:11Z', latest: '2026-06-23T18:42:12Z', precision: 'second',
    shape: 'instant', time_role: null, uncertain: false, approximate: false,
    zone: 'utc', sortable: true, status: null, confidence: null, parse_error: null,
    subjects: [], places: [], sources: [],
  },
  {
    id: 'temporal:claim:claim-3', owner_id: 'claim-3', category: 'statement', kind: 'claim',
    label: 'Resolve the timezone of the second interview', raw: null,
    earliest: null, latest: null, precision: null, shape: null, time_role: 'observed',
    uncertain: false, approximate: false, zone: null, sortable: false,
    status: 'confirmed', confidence: null, parse_error: null,
    subjects: ['person-1'], places: [], sources: [],
  },
  {
    id: 'temporal:activity:person-1:filed', owner_id: 'person-1', category: 'case_activity', kind: 'filed',
    label: 'Harbour witness', raw: '2026-08-01T09:00:00Z',
    earliest: '2026-08-01T09:00:00Z', latest: '2026-08-01T09:00:01Z', precision: 'second',
    shape: 'instant', time_role: null, uncertain: false, approximate: false,
    zone: 'utc', sortable: true, status: null, confidence: null, parse_error: null,
    subjects: [], places: [], sources: [],
  },
  {
    id: 'temporal:media:media-local:captured', owner_id: 'media-local', category: 'media', kind: 'captured',
    label: 'IMG_5250', raw: '2021-04-24T14:52:29', earliest: null, latest: null,
    precision: 'second', shape: 'instant', time_role: null, uncertain: false, approximate: false,
    zone: 'local', sortable: false, status: null, confidence: null, parse_error: null,
    subjects: [], places: [], sources: [],
  },
];

for (let index = 0; index < 7; index += 1) {
  timelineItems.push({
    id: `temporal:claim:dense-${index}`, owner_id: `dense-${index}`,
    category: 'statement', kind: 'claim',
    label: `Checkpoint log ${index + 1} records the same arrival window`, raw: '2026-06-18',
    earliest: '2026-06-18T00:00:00Z', latest: '2026-06-19T00:00:00Z', precision: 'day',
    shape: 'instant', time_role: 'observed', uncertain: false, approximate: false,
    zone: 'date-only', sortable: true, status: 'confirmed', confidence: 'possible',
    parse_error: null, subjects: [], places: [], sources: [],
  });
}

const timelineItem = (ownerId) => timelineItems.find((item) => item.owner_id === ownerId);

const claimChain = (id, label, attrs, relations = []) => ({
  entity: {
    id, type: 'claim', label, attrs,
    provenance: { by: 'user', at: '2026-08-01T09:20:00Z', status: 'confirmed' },
  },
  sources: [], lost: [], dependents: [], relations, empty: relations.length === 0,
});

const chainLink = (type, entity) => ({
  direction: 'out', link: { id: `link-${type}-${entity.id}`, type }, entity,
});

/** Set the visible window through the range menu, and close it again.
 *
 *  The two boundaries live behind the window reading rather than out on the toolbar,
 *  so a spec that wants a precise window opens the menu, types both ends and gets out
 *  of the way of the axis underneath. */
async function setWindow(page, from, to) {
  await page.locator('.range-face').click();
  const menu = page.locator('.range-menu');
  await menu.getByLabel('From').fill(from);
  await menu.getByLabel('To').fill(to);
  await page.locator('.range-face').click();
  await expect(menu).toHaveCount(0);
}

/** The window the axis says it is drawing, as `<start> to <end>` on the display zone.
 *  It is what stays on screen while the ruler and the overview are being dragged. */
const axisWindowText = (page) => page.locator('.axis-label small').innerText();

async function openTimeline(page, options = {}) {
  const fixture = await installAppFixture(page, {
    catalog: [person, source, mediaEntity],
    timelineItems,
    chains: {
      'person-1': { entity: person, sources: [], lost: [], dependents: [], relations: [], empty: true },
      'claim-1': claimChain('claim-1', timelineItem('claim-1').label, {
        when: timelineItem('claim-1').raw, time_role: 'occurred', confidence: 'probable',
        method: 'Compared the checkpoint log with the interview notes.',
        verbatim: 'The witness arrived shortly after the gate opened.',
      }, [chainLink('about', person), chainLink('cites', source)]),
      'claim-2': claimChain('claim-2', timelineItem('claim-2').label, {
        when: timelineItem('claim-2').raw, time_role: 'valid', confidence: 'possible',
      }),
      'claim-3': claimChain('claim-3', timelineItem('claim-3').label, { time_role: 'observed' }),
      'media-1': { entity: mediaEntity, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
    ...options,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#timeline');
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.locator('.loading-line')).toHaveCount(0);
  return fixture;
}

test('draws a clear chronology with density, uncertainty and an inspector', async ({ page }, testInfo) => {
  const fixture = await openTimeline(page);

  await expect(page.locator('.tabstrip').getByRole('button')).toHaveText(['Board', 'Graph', 'Timeline']);
  await expect(page.locator('.track-label strong')).toHaveText(['Events', 'Media']);
  await expect(page.getByRole('button', { name: /Witness arrived/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Vehicle remained/ }).locator('..')).toHaveClass(/period.*approximate.*uncertain/);
  await expect(page.locator('.density-bucket')).toHaveCount(4);
  await expect(page.getByText('Undated', { exact: true })).toBeVisible();
  await expect(page.getByText('Not on UTC axis', { exact: true })).toBeVisible();
  await expect(page.getByText('2021-04-24T14:52:29', { exact: false })).toBeVisible();

  const axis = await page.locator('.axis-ruler').boundingBox();
  expect(axis.width).toBeGreaterThan(800);

  const eventBoxes = await page.locator('.timeline-event.statement').evaluateAll((events) =>
    events.map((event) => {
      const box = event.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    })
  );
  for (let left = 0; left < eventBoxes.length; left += 1) {
    for (let right = left + 1; right < eventBoxes.length; right += 1) {
      const a = eventBoxes[left];
      const b = eventBoxes[right];
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
    }
  }

  await page.getByRole('button', { name: /Witness arrived/ }).click();
  expect((await page.locator('.axis-ruler').boundingBox()).width).toBeCloseTo(axis.width, 0);
  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('heading', { name: timelineItem('claim-1').label })).toBeVisible();
  await expect(inspector.getByText('2026-06-18', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Confidence: probable')).toBeVisible();
  await expect(inspector.getByText('Compared the checkpoint log with the interview notes.')).toBeVisible();
  await expect(inspector.getByRole('button', { name: /Interview notes/ })).toBeVisible();

  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await page.locator('.track-menu').getByRole('button').filter({ hasText: 'Case activity' }).click();
  await expect(page.locator('.track-label strong')).toHaveText(['Events', 'Media', 'Case activity']);

  if (process.env.AZIMUT_TIMELINE_SCREENSHOT && testInfo.project.name === 'chromium') {
    await page.screenshot({ path: process.env.AZIMUT_TIMELINE_SCREENSHOT, fullPage: true });
  }
  fixture.expectNoUnexpectedRequests();
});

test('builds, reorders and curates tracks without leaving the chronology', async ({ page }) => {
  const fixture = await openTimeline(page);

  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await page.locator('.track-menu').getByRole('button').filter({ hasText: /^Person/ }).click();
  await expect(page.locator('.track-label strong')).toHaveText(['Events', 'Media', 'Person']);

  const movePerson = page.getByRole('button', { name: 'Move Person track' });
  await movePerson.press('Alt+ArrowUp');
  await expect(page.locator('.track-label strong')).toHaveText(['Events', 'Person', 'Media']);

  await page.getByRole('button', { name: 'Fold Person' }).click();
  await expect(page.locator('.track-row').filter({ hasText: 'Person' })).toHaveClass(/folded/);
  await page.getByRole('button', { name: 'Expand Person' }).click();

  const personTrack = page.locator('.track-row').filter({ hasText: 'Person' });
  await personTrack.getByRole('button', { name: /Witness arrived/ }).click();
  await page.getByRole('button', { name: 'Pin in track' }).click();
  await expect(personTrack.locator('.timeline-event.pinned')).toHaveCount(1);

  await page.getByRole('button', { name: 'Hide from track' }).click();
  await expect(personTrack.getByRole('button', { name: /Witness arrived/ })).toHaveCount(0);
  await personTrack.getByRole('button', { name: 'Show hidden' }).click();
  await expect(personTrack.getByRole('button', { name: /Witness arrived/ })).toBeVisible();

  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await page.locator('.track-menu').getByRole('button').filter({ hasText: /^Custom/ }).click();
  const editor = page.getByRole('dialog', { name: 'Add track' });
  await expect(editor.getByText('Search+', { exact: true })).toBeVisible();
  await editor.getByLabel('Name').fill('Evidence review');
  await editor.getByLabel('Match the Search+ question through').selectOption('source');
  await editor.getByRole('button', { name: 'Add track' }).click();
  await expect(page.locator('.track-label strong').filter({ hasText: 'Evidence review' })).toHaveCount(1);

  await page.getByLabel('Group by').selectOption('subject');
  await expect(page.locator('.track-label strong').filter({ hasText: 'Harbour witness' })).toHaveCount(3);
  fixture.expectNoUnexpectedRequests();
});

test('asks an entry what can be done with it, without choosing it', async ({ page }) => {
  await openTimeline(page);
  const events = page.locator('.track-row').filter({ hasText: 'Events' });
  const inspector = page.locator('.inspector');
  const menu = page.locator('.item-menu');

  // A different entry is being read: the menu must leave it, and the panel, alone.
  await page.getByRole('button', { name: /Vehicle remained/ }).click();
  await expect(inspector.getByRole('heading', { name: /Vehicle remained/ })).toBeVisible();

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(inspector.getByRole('heading', { name: /Vehicle remained/ })).toBeVisible();

  await menu.getByRole('button', { name: 'Pin in Events' }).click();
  await expect(menu).toHaveCount(0);
  await expect(events.locator('.timeline-event.pinned')).toHaveCount(1);

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await expect(menu.getByRole('button', { name: 'Unpin from Events' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await menu.getByRole('button', { name: 'Details' }).click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details.getByLabel('Statement')).toHaveValue(timelineItem('claim-1').label);
  await details.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await menu.getByRole('button', { name: 'Edit assessment' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit time assessment' });
  await expect(editor.getByLabel('Statement')).toHaveValue(timelineItem('claim-1').label);
  await editor.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await menu.getByRole('button', { name: 'Hide from Events' }).click();
  await expect(events.getByRole('button', { name: /Witness arrived/ })).toHaveCount(0);
  await expect(inspector.getByRole('heading', { name: /Vehicle remained/ })).toBeVisible();
  await events.getByRole('button', { name: 'Show hidden' }).click();
  await expect(events.getByRole('button', { name: /Witness arrived/ })).toBeVisible();
});

test('autosaves a live Timeline view and restores its track reading', async ({ page }) => {
  const fixture = await openTimeline(page);
  await page.getByRole('button', { name: 'Track', exact: true }).click();
  await page.locator('.track-menu').getByRole('button').filter({ hasText: /^Person/ }).click();

  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save analysis view' });
  await dialog.getByLabel('Name').fill('Witness chronology');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.views .active')).toContainText('live · saved');

  await page.getByLabel('Group by').selectOption('role');
  await expect.poll(() => fixture.analysisWrites.at(-1)?.body?.spec?.timeline?.group_by)
    .toBe('role');
  await expect(page.locator('.views .active')).toContainText('saved');

  await page.getByRole('button', { name: 'Leave saved view' }).click();
  await page.getByRole('button', { name: /^Views/ }).click();
  // the surface is not printed on this list: every view in it is a Timeline reading
  await page.getByRole('button', { name: 'Witness chronology live' }).click();
  await expect(page.getByLabel('Group by')).toHaveValue('role');
  await expect(page.locator('.track-name em').filter({ hasText: 'Person' })).toHaveCount(2);
  fixture.expectNoUnexpectedRequests();
});

test('files a pending live edit before switching cases', async ({ page }) => {
  const fixture = await openTimeline(page, {
    cases: [
      { id: CASE_ID, name: 'Browser Test', scratch: false, entities: [], links: [], folders: [] },
      { id: 'second-case', name: 'Second Case', scratch: false, entities: [], links: [], folders: [] },
    ],
  });
  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save analysis view' });
  await dialog.getByLabel('Name').fill('Switch-safe chronology');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.views .active')).toContainText('live · saved');

  await page.getByLabel('Group by').selectOption('role');
  await page.getByTitle('Switch case').click();
  await page.locator('.switcher .menu .item').filter({ hasText: 'Second Case' }).click();

  await expect(page.getByTitle('Switch case')).toContainText('Second Case');
  await expect.poll(() => fixture.analysisWrites.at(-1)).toMatchObject({
    method: 'PUT',
    caseId: CASE_ID,
    body: { spec: { timeline: { group_by: 'role' } } },
  });
  fixture.expectNoUnexpectedRequests();
});

test('keeps a Timeline snapshot frozen and read-only', async ({ page }) => {
  const fixture = await openTimeline(page);
  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save analysis view' });
  await dialog.getByLabel('Name').fill('Frozen chronology');
  await dialog.getByLabel('Snapshot').check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.locator('.views .active')).toContainText('snapshot');
  await expect(page.getByText('Frozen view', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Track', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Group by')).toBeDisabled();
  await expect(page.getByTitle('Which clock the axis is labelled with')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Witness arrived/ }).first()).toBeVisible();
  expect(fixture.analysisWrites.at(-1)).toMatchObject({
    method: 'POST',
    body: { mode: 'snapshot', surface: 'timeline' },
  });
  fixture.expectNoUnexpectedRequests();
});

test('creates a dated statement from a point on the axis', async ({ page }) => {
  const fixture = await openTimeline(page);
  const canvas = page.locator('.track-canvas').first();
  const box = await canvas.boundingBox();

  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height - 8);
  const dialog = page.getByRole('dialog', { name: 'Add assessment' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('When')).not.toHaveValue('');
  await dialog.getByLabel('Statement').fill('A second witness reached the checkpoint');
  await dialog.getByRole('button', { name: 'Add assessment' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'POST',
    body: { statement: 'A second witness reached the checkpoint' },
  });
  await expect(page.getByRole('button', { name: /A second witness/ })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('pans from the ruler and zooms with the wheel', async ({ page }) => {
  await openTimeline(page);
  const before = await axisWindowText(page);
  const ruler = page.locator('.axis-ruler');
  const box = await ruler.boundingBox();

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => axisWindowText(page)).not.toBe(before);

  const days = async () => {
    const [start, end] = (await axisWindowText(page)).split(' to ');
    return (new Date(`${end.replace(' ', 'T')}Z`) - new Date(`${start.replace(' ', 'T')}Z`)) / 86_400_000;
  };
  const beforeDays = await days();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -120);
  await expect.poll(days).toBeLessThan(beforeDays);
});

test('closes the legend outside and can use the whole screen', async ({ page }) => {
  await openTimeline(page);
  await page.getByText('Legend', { exact: true }).click();
  await expect(page.getByText('Confidence and date quality are independent.')).toBeVisible();
  await page.locator('.title-block').click();
  await expect(page.getByText('Confidence and date quality are independent.')).toBeHidden();

  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test('shows day precision across the full day without drawing a period', async ({ page }) => {
  await openTimeline(page);
  await setWindow(page, '2026-06-18T00:00', '2026-06-19T00:00');
  await expect(page.getByRole('button', { name: /Witness arrived/ })).toBeVisible();

  const canvas = page.locator('.track-canvas').first();
  const span = page.locator('.precision-span.statement').first();
  const [canvasBox, spanBox] = await Promise.all([canvas.boundingBox(), span.boundingBox()]);
  expect(spanBox.width).toBeGreaterThan(canvasBox.width * .95);
  expect(spanBox.height).toBeLessThan(12);
});

test('creates and resizes an hourly period on a day view', async ({ page }) => {
  const fixture = await openTimeline(page);
  await setWindow(page, '2026-06-23T00:00', '2026-06-24T00:00');

  const canvas = page.locator('.track-canvas').first();
  const box = await canvas.boundingBox();
  const y = box.y + box.height - 8;
  await page.mouse.move(box.x + box.width * .4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, y, { steps: 5 });
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: 'Add assessment' });
  await expect(dialog.getByLabel('Date format')).toHaveValue('time-range');
  await expect(dialog.getByLabel('Start time')).toHaveValue(/2026-06-23T\d{2}:\d{2}(?::\d{2})?/);
  await expect(dialog.getByLabel('End time')).toHaveValue(/2026-06-23T\d{2}:\d{2}(?::\d{2})?/);
  await dialog.getByLabel('Statement').fill('Traffic peaked around the checkpoint');
  await dialog.getByRole('button', { name: 'Add assessment' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0].body.when).toMatch(
    /^2026-06-23T\d{2}:\d{2}:\d{2}Z\/2026-06-23T\d{2}:\d{2}:\d{2}Z$/
  );

  const event = page.getByRole('button', { name: /Traffic peaked around/ });
  await expect(event).toBeVisible();
  await event.click();
  const end = event.locator('..').locator('.resize.end');
  const endBox = await end.boundingBox();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x - 35, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();
  const confirm = page.getByRole('alertdialog', { name: 'Change this period?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Update date' }).click();
  await expect.poll(() => fixture.timelineWrites.length).toBe(2);
  expect(fixture.timelineWrites[1]).toMatchObject({ method: 'PATCH' });
  expect(fixture.timelineWrites[1].body.when).toContain('T');
});

test('keeps creation on Statements and offers the list view', async ({ page }) => {
  await openTimeline(page);
  const mediaCanvas = page.locator('.track-canvas').nth(1);
  const box = await mediaCanvas.boundingBox();
  await page.mouse.click(box.x + box.width * .7, box.y + box.height - 8);
  await expect(page.getByRole('dialog', { name: 'Add assessment' })).toHaveCount(0);

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByRole('region', { name: 'Timeline list' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Second convoy cleared/ })).toBeVisible();
});

test('starts a media correction from the captured date', async ({ page }) => {
  const fixture = await openTimeline(page);
  await page.getByRole('button', { name: /Roadside camera frame/ }).click();
  const inspector = page.locator('.inspector');
  const correction = inspector.getByRole('button', { name: 'Add correction' });
  await expect(correction).toBeEnabled();
  await correction.click();

  const dialog = page.getByRole('dialog', { name: 'Add assessment' });
  await expect(dialog.getByLabel('Date format')).toHaveValue('timestamp');
  await expect(dialog.getByLabel('Date and time')).toHaveValue('2026-06-23T18:42:11');
  await expect(dialog.getByLabel('Timezone')).toHaveValue('utc');
  await dialog.getByRole('button', { name: 'Add assessment' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'POST',
    body: {
      statement: 'This media was captured',
      when: '2026-06-23T18:42:11Z',
      time_role: 'observed',
      about: ['media-1'],
    },
  });
});

test('expands dense events in place and can collapse them again', async ({ page }) => {
  await openTimeline(page);
  const cluster = page.locator('.timeline-cluster').first();
  await expect(cluster).toBeVisible();
  const before = await page.locator('.timeline-event.statement').count();
  await cluster.click();
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
  await expect(page.locator('.timeline-cluster')).toHaveCount(0);
  expect(await page.locator('.timeline-event.statement').count()).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Collapse' }).click();
  await expect(page.locator('.timeline-cluster').first()).toBeVisible();
});

test('moves and resizes the overview window', async ({ page }) => {
  await openTimeline(page);
  const before = await axisWindowText(page);
  const start = page.getByRole('button', { name: 'Change range start' });
  const startBox = await start.boundingBox();
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(startBox.x + 90, startBox.y + startBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => axisWindowText(page)).not.toBe(before);

  const narrowed = await axisWindowText(page);
  const drag = page.getByRole('button', { name: 'Move visible range' });
  const dragBox = await drag.boundingBox();
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 - 45, dragBox.y + dragBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => axisWindowText(page)).not.toBe(narrowed);
});

test('moves and shortens a selected assessment on the axis', async ({ page }) => {
  const fixture = await openTimeline(page);
  const period = page.getByRole('button', { name: /Vehicle remained/ });
  await period.click();
  await expect(page.getByText('Drag to move. Use either edge to resize.')).toBeVisible();

  const end = period.locator('..').locator('.resize.end');
  const endBox = await end.boundingBox();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x - 70, endBox.y + endBox.height / 2, { steps: 4 });
  await page.mouse.up();

  const confirm = page.getByRole('alertdialog', { name: 'Change this period?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Update date' }).click();
  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({ method: 'PATCH', ownerId: 'claim-2' });
  expect(fixture.timelineWrites[0].body.when).toMatch(/^2026-06-12\//);

  const point = page.getByRole('button', { name: /Witness arrived/ });
  await point.click();
  const pointBox = await point.boundingBox();
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointBox.x + pointBox.width / 2 + 65, pointBox.y + pointBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('alertdialog', { name: 'Move this date?' })).toBeVisible();
});

test('validates advanced syntax before saving', async ({ page }) => {
  await openTimeline(page);
  await page.getByRole('button', { name: 'Add assessment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add assessment' });
  await dialog.getByLabel('Statement').fill('A dated observation');
  await dialog.getByLabel('Date format').selectOption('advanced');
  await dialog.getByLabel('When').fill('late summer');
  await expect(dialog.getByText('Use a supported date or timestamp.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add assessment' })).toBeDisabled();
  await dialog.getByText('Syntax guide').click();
  await expect(dialog.getByRole('region', { name: 'Supported date syntax' })).toBeVisible();
});

test('keeps entity history in the same three-tab Details model', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    catalog: [person, source],
    timelineItems,
    chains: {
      'person-1': { entity: person, sources: [], lost: [], dependents: [], relations: [], empty: true },
      'claim-1': claimChain('claim-1', timelineItem('claim-1').label, {
        when: timelineItem('claim-1').raw, time_role: 'occurred', confidence: 'probable',
      }),
      'claim-3': claimChain('claim-3', timelineItem('claim-3').label, { time_role: 'observed' }),
    },
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td').first().click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details.getByRole('tab')).toHaveText(['Info', 'Connections', 'Time']);
  await details.getByRole('tab', { name: 'Time' }).click();

  await expect(details.getByRole('heading', { name: 'Statements about this' })).toBeVisible();
  await expect(details.getByText(timelineItem('claim-1').label, { exact: true })).toBeVisible();
  await expect(details.getByText(timelineItem('claim-3').label, { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Add time assessment' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('opens the row handed over from the Time tab', async ({ page }) => {
  await installAppFixture(page, {
    catalog: [person, mediaEntity],
    timelineItems,
    chains: {
      'media-1': { entity: mediaEntity, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: mediaEntity.label }).locator('td').first().click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await details.getByRole('tab', { name: 'Time' }).click();
  await details.getByRole('button', { name: `Open ${mediaEntity.label} in Timeline` }).click();

  // The chip scopes the axis and the named row opens, even though Timeline had
  // loaded nothing at the moment Details handed it over.
  await expect(page.locator('.scope-chip')).toContainText(mediaEntity.label);
  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('heading', { name: mediaEntity.label })).toBeVisible();
  await expect(inspector.getByText('2026-06-23T18:42:11Z')).toBeVisible();
});

test('edits an existing assessment from the Time tab', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    catalog: [person, source],
    timelineItems,
    chains: {
      'person-1': { entity: person, sources: [], lost: [], dependents: [], relations: [], empty: true },
      'claim-1': claimChain('claim-1', timelineItem('claim-1').label, {
        when: timelineItem('claim-1').raw, time_role: 'occurred', confidence: 'probable',
      }),
      'claim-3': claimChain('claim-3', timelineItem('claim-3').label, { time_role: 'observed' }),
    },
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td').first().click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await details.getByRole('tab', { name: 'Time' }).click();

  await details.getByRole('button', { name: `Edit ${timelineItem('claim-1').label}` }).click();
  const editor = details.getByRole('region', { name: 'Edit time assessment' });
  await expect(editor.getByLabel('Statement')).toHaveValue(timelineItem('claim-1').label);
  await editor.getByLabel('Statement').fill('Witness reached the north checkpoint');
  await editor.getByRole('button', { name: 'Update assessment' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'PATCH',
    ownerId: 'claim-1',
    body: { statement: 'Witness reached the north checkpoint' },
  });
});

test('starts a new assessment from an empty form after editing one', async ({ page }) => {
  await installAppFixture(page, {
    catalog: [person, source],
    timelineItems,
    chains: {
      'person-1': { entity: person, sources: [], lost: [], dependents: [], relations: [], empty: true },
      'claim-1': claimChain('claim-1', timelineItem('claim-1').label, {
        when: timelineItem('claim-1').raw, time_role: 'occurred', confidence: 'probable',
      }),
      'claim-3': claimChain('claim-3', timelineItem('claim-3').label, { time_role: 'observed' }),
    },
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td').first().click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await details.getByRole('tab', { name: 'Time' }).click();

  await details.getByRole('button', { name: `Edit ${timelineItem('claim-1').label}` }).click();
  const editing = details.getByRole('region', { name: 'Edit time assessment' });
  await expect(editing.getByLabel('Statement')).toHaveValue(timelineItem('claim-1').label);

  await details.getByRole('button', { name: 'Add time assessment' }).click();
  const adding = details.getByRole('region', { name: 'Add time assessment' });
  await expect(adding.getByLabel('Statement')).toHaveValue('');
  await expect(adding.getByLabel('When')).toHaveValue('');
});

test('shows an undated Claim as a missing statement date, not an existing assessment', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    catalog: [undatedClaim],
    timelineItems,
    chains: {
      'claim-3': claimChain('claim-3', undatedClaim.label, undatedClaim.attrs),
    },
  });
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: undatedClaim.label }).locator('td').first().click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await details.getByRole('tab', { name: 'Time' }).click();

  await expect(details.getByText('This statement has no date yet.')).toBeVisible();
  await expect(details.getByText('A statement has one date or range.')).toBeVisible();
  await expect(details.getByText('Undated', { exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Set statement date' }).click();

  const editor = details.getByRole('region', { name: 'Set statement date' });
  await expect(editor.getByLabel('Statement')).toHaveValue(undatedClaim.label);
  await editor.getByLabel('When').fill('2026-08-12');
  await editor.getByRole('button', { name: 'Update assessment' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'PATCH', ownerId: 'claim-3', body: { when: '2026-08-12' },
  });
});

// --- the four surfaces answering one window ---
//
// The quay is a located place, and one statement in June is attached to it. The camera
// frame sits three days outside the window used below, which is what lets these specs
// tell "the period narrowed the case" apart from "everything was shown anyway".

const quay = {
  id: 'place-1',
  type: 'place',
  label: 'South quay',
  attrs: { lat: 43.2965, lon: 5.3698 },
  provenance: { by: 'user', at: '2026-08-01T09:05:00Z', status: 'confirmed' },
};

const placedItem = {
  id: 'temporal:claim:claim-6', owner_id: 'claim-6', category: 'statement', kind: 'claim',
  label: 'Crane moved along the south quay', raw: '2026-06-20',
  earliest: '2026-06-20T00:00:00Z', latest: '2026-06-21T00:00:00Z', precision: 'day',
  shape: 'instant', time_role: 'occurred', uncertain: false, approximate: false,
  zone: 'date-only', sortable: true, status: 'confirmed', confidence: 'probable',
  parse_error: null, subjects: [], places: ['place-1'], sources: [],
};

async function openTimelineOverJune(page, options = {}) {
  const fixture = await openTimeline(page, {
    catalog: [person, source, mediaEntity, quay],
    timelineItems: [...timelineItems, placedItem],
    ...options,
  });
  await setWindow(page, '2026-06-01T00:00', '2026-06-21T00:00');
  await expect(page.getByRole('button', { name: '1 Jun – 21 Jun 2026' })).toBeVisible();
  return fixture;
}

test('hands one window from the Timeline to the Map, the Board and back', async ({ page }) => {
  const fixture = await openTimelineOverJune(page);
  await page.getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();

  const layer = page.getByLabel('Timeline map layer');
  await expect(layer).toContainText('1 Jun – 21 Jun 2026');
  // What the window holds, and how much of it the map can show: the layer reads
  // every category the Timeline was reading, so the count is the whole window.
  await expect(layer).toContainText('1 placed of 12 dated');
  await expect(page.locator('.temporal-mark')).toHaveCount(1);

  await layer.getByRole('button', { name: 'Board' }).click();

  // The Board asks the server for the window rather than hiding rows it already has,
  // and says which window it is answering.
  await expect(page.getByLabel('Fact-time range')).toContainText('1 Jun – 21 Jun 2026');
  await expect.poll(() => fixture.catalogQueries.at(-1)).toContain('temporal_from=2026-06-01');
  await expect(page.locator('tbody tr')).toHaveText([
    /Harbour witness/, /Interview notes/, /South quay/,
  ]);

  await page.getByLabel('Fact-time range').getByRole('button', { name: 'Timeline' }).click();

  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 Jun – 21 Jun 2026' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('opens a statement in the Timeline from its mark on the map', async ({ page }) => {
  const fixture = await openTimelineOverJune(page);
  await page.getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();

  await page.locator('.temporal-mark').click();
  const popup = page.locator('.temporal-popup');
  await expect(popup).toContainText('South quay');
  await popup.getByRole('button', { name: /Crane moved along the south quay/ }).click();

  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('heading', { name: placedItem.label })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 Jun – 21 Jun 2026' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('draws the window and nothing else, framed on what it holds', async ({ page }) => {
  // The case has saved places nowhere near the window. They are not what a period was
  // asked about, so the layer neither draws them nor lets them pull the frame out.
  const fixture = await openTimelineOverJune(page, {
    savedIndexes: {
      [CASE_ID]: [
        { id: 'place-far', key: 'place-far', kind: 'place', title: 'North depot', lat: 50.85, lon: 4.35 },
        { id: 'place-quay', key: 'place-quay', kind: 'place', title: 'South quay', lat: 43.2965, lon: 5.3698 },
      ],
    },
  });
  await page.getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();

  await expect(page.locator('.temporal-mark')).toHaveCount(1);
  await expect(page.locator('.saved-mark-place')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show saved work on the map' })).not.toHaveClass(/on/);

  const framed = await page.evaluate(() => {
    const map = document.querySelector('.map').getBoundingClientRect();
    return [...document.querySelectorAll('.temporal-mark-wrap')].every((mark) => {
      const box = mark.getBoundingClientRect();
      return box.left >= map.left && box.right <= map.right
        && box.top >= map.top && box.bottom <= map.bottom;
    });
  });
  expect(framed).toBe(true);
  fixture.expectNoUnexpectedRequests();
});

test('says a window holds nothing placed instead of pulling the map out to say it', async ({ page }) => {
  const fixture = await openTimeline(page, {
    catalog: [person, source, mediaEntity],
    savedIndexes: {
      [CASE_ID]: [
        { id: 'place-far', key: 'place-far', kind: 'place', title: 'North depot', lat: 50.85, lon: 4.35 },
        { id: 'place-south', key: 'place-south', kind: 'place', title: 'South site', lat: -23.5, lon: -46.6 },
      ],
    },
  });
  await setWindow(page, '2026-06-18T00:00', '2026-06-19T00:00');
  await page.getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();

  const layer = page.getByLabel('Timeline map layer');
  await expect(layer).toContainText('None of the 10 dated here carries a place.');
  // Nothing to draw is said in words, not by pulling the view out to two continents
  // of unrelated pins, which is what a map showing everything looks like.
  await expect(page.locator('.temporal-mark')).toHaveCount(0);
  await expect(page.locator('.saved-mark-place')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});
