import { test, expect } from '@playwright/test';
import { awaitMapReady, CASE_ID, installAppFixture } from './app.fixture.js';

/** Details docks beside a wide Board and is a modal below that. */
const boardDetails = (page) =>
  page.locator('aside.fiche').or(page.getByRole('dialog', { name: 'Details', exact: true }));

/** The Board's flat table, where a file or a claim is a row on screen rather than one
 *  in a folded group. */
const flatBoard = (page) =>
  page.addInitScript((key) => localStorage.setItem(key, '{"group":"none"}'), `azimut:board-layout:${CASE_ID}`);

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
    subjects: [], places: [], sources: [], produced_here: false,
  },
  {
    // a frame the case extracted itself: a working file, held back by the Media track
    id: 'temporal:media:frame-1:captured', owner_id: 'frame-1', category: 'media', kind: 'captured',
    label: 'Extracted frame 00:12', raw: '2026-06-23T19:10:00Z',
    earliest: '2026-06-23T19:10:00Z', latest: '2026-06-23T19:10:01Z', precision: 'second',
    shape: 'instant', time_role: null, uncertain: false, approximate: false,
    zone: 'utc', sortable: true, status: null, confidence: null, parse_error: null,
    subjects: [], places: [], sources: [], produced_here: true,
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

/** The window the axis says it is drawing, as `<start> to <end>` on the display zone:
 *  the exact boundaries the window's reading carries on hover. */
const axisWindowText = async (page) =>
  (await page.locator('.range-face').getAttribute('title')).split(' · ')[0];

/** A preset put on the axis from `⋯`, where tracks are added. */
async function addTrack(page, name) {
  await page.locator('.timeline-bar').getByRole('button', { name: 'More', exact: true }).click();
  await page.locator('.more-menu section').getByRole('button').filter({ hasText: name }).click();
  await expect(page.locator('.more-menu')).toHaveCount(0);
}

/** The two lanes a fresh reading opens on: the files where the analyst dated them,
 *  then the events. */
const mediaLane = (page) => page.locator('.track-canvas').first();
const eventsLane = (page) => page.locator('.track-canvas').nth(1);

/** What each file says about itself, a track added on purpose from `⋯`. */
const fileDatesRow = (page) => page.locator('.track-row')
  .filter({ has: page.locator('.track-label strong', { hasText: /^File dates$/ }) });
const fileDatesLane = (page) => fileDatesRow(page).locator('.track-canvas');
const showFileDates = (page) => addTrack(page, /^File dates/);

/** `⋯`, opened, for what waits under it. */
async function more(page) {
  await page.locator('.timeline-bar').getByRole('button', { name: 'More', exact: true }).click();
  return page.locator('.more-menu');
}

/** Group the lanes from `⋯`, and close it again. */
async function groupLanes(page, by) {
  await (await more(page)).getByLabel('Group by').selectOption(by);
  await page.keyboard.press('Escape');
  await expect(page.locator('.more-menu')).toHaveCount(0);
}

/** Narrow the window so the whole-case strip under the axis has something to show. */
async function zoomIn(page) {
  await page.locator('.axis-ruler').focus();
  await page.keyboard.press('+');
  await expect(page.locator('.overview-card')).toBeVisible();
}

async function openTimeline(page, { clock, ...options } = {}) {
  // A clock the analyst picked for the case, kept in this browser like the real one.
  if (clock) {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`azimut:timeline-clock:${CASE_ID}`, clock]);
  }
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
  await expect(page.locator('.timeline-bar')).toBeVisible();
  await expect(page.locator('.loading-line')).toHaveCount(0);
  return fixture;
}

test('draws a clear chronology with density, uncertainty and an inspector', async ({ page }, testInfo) => {
  const fixture = await openTimeline(page);

  await expect(page.locator('.tabstrip').getByRole('button')).toHaveText(['Timeline', 'Board', 'Graph', 'Sheet']);
  // the files where the analyst dated them, over what the analyst dated
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events']);
  // no inspector before a pick, and no whole-case strip while the window is the case
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('.overview-card')).toHaveCount(0);
  // what a file says about itself is a clue, drawn when asked for
  await expect(page.getByRole('button', { name: /Roadside camera frame/ })).toHaveCount(0);
  await showFileDates(page);
  // the files the case collected, not its own frames
  await expect(page.getByRole('button', { name: /Roadside camera frame/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Extracted frame/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Witness arrived/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Vehicle remained/ }).locator('..')).toHaveClass(/period.*approximate.*uncertain/);
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
  // the inspector takes its column from the axis, which keeps a readable width
  expect((await page.locator('.axis-ruler').boundingBox()).width).toBeGreaterThan(600);
  const inspector = page.locator('.inspector');
  await expect(inspector.locator('header')).toContainText('Event');
  await expect(inspector.getByRole('heading', { name: timelineItem('claim-1').label })).toBeVisible();
  await expect(inspector.getByText('Confidence: probable')).toBeVisible();
  await expect(inspector.getByText('Compared the checkpoint log with the interview notes.')).toBeVisible();
  await expect(inspector.getByRole('button', { name: /Interview notes/ })).toBeVisible();
  // how the date is held is folded under the reading
  await expect(inspector.getByText('2026-06-18', { exact: true })).toBeHidden();
  await inspector.getByText('About this date').click();
  await expect(inspector.getByText('2026-06-18', { exact: true })).toBeVisible();

  // narrowed, the window leaves part of the case out, and the strip under the axis says where
  await zoomIn(page);
  await expect(page.locator('.density-bucket')).toHaveCount(4);

  await addTrack(page, 'Case activity');
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events', 'File dates', 'Case activity']);

  if (process.env.AZIMUT_TIMELINE_SCREENSHOT && testInfo.project.name === 'chromium') {
    await page.screenshot({ path: process.env.AZIMUT_TIMELINE_SCREENSHOT, fullPage: true });
  }
  fixture.expectNoUnexpectedRequests();
});

test('builds, reorders and curates tracks without leaving the chronology', async ({ page }) => {
  const fixture = await openTimeline(page);

  await addTrack(page, /^Person/);
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events', 'Person']);

  const movePerson = page.getByRole('button', { name: 'Move Person track' });
  await movePerson.press('Alt+ArrowUp');
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Person', 'Events']);

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

  await addTrack(page, /^Custom/);
  const editor = page.getByRole('dialog', { name: 'Add track' });
  await expect(editor.getByText('Search+', { exact: true })).toBeVisible();
  await editor.getByLabel('Name').fill('Evidence review');
  await editor.getByLabel('Match the Search+ question through').selectOption('source');
  await editor.getByRole('button', { name: 'Add track' }).click();
  await expect(page.locator('.track-label strong').filter({ hasText: 'Evidence review' })).toHaveCount(1);

  await groupLanes(page, 'subject');
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
  await expect(details.getByLabel('Claim', { exact: true })).toHaveValue(timelineItem('claim-1').label);
  await details.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /Witness arrived/ }).click({ button: 'right' });
  await menu.getByRole('button', { name: 'Edit claim' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit claim' });
  await expect(editor.getByLabel('Claim', { exact: true })).toHaveValue(timelineItem('claim-1').label);
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
  await addTrack(page, /^Person/);

  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save analysis view' });
  await dialog.getByLabel('Name').fill('Witness chronology');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.views .active')).toContainText('live · saved');

  await groupLanes(page, 'role');
  await expect.poll(() => fixture.analysisWrites.at(-1)?.body?.spec?.timeline?.group_by)
    .toBe('role');
  await expect(page.locator('.views .active')).toContainText('saved');

  await page.getByRole('button', { name: 'Leave saved view' }).click();
  await page.getByRole('button', { name: /^Views/ }).click();
  // the surface is not printed on this list: every view in it is a Timeline reading
  await page.getByRole('button', { name: 'Witness chronology live' }).click();
  await expect((await more(page)).getByLabel('Group by')).toHaveValue('role');
  await page.keyboard.press('Escape');
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

  await groupLanes(page, 'role');
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
  const menu = await more(page);
  await expect(menu.locator('section').getByRole('button').first()).toBeDisabled();
  await expect(menu.getByLabel('Group by')).toBeDisabled();
  await page.keyboard.press('Escape');
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
  const canvas = eventsLane(page);
  const box = await canvas.boundingBox();

  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height - 8);
  // The click dates the line under the axis and hands it the sentence.
  const line = page.getByRole('region', { name: 'Add an event' });
  await expect(line.getByLabel('When')).not.toHaveValue('');
  await expect(line.getByLabel('What happened')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.type('A second witness reached the checkpoint');
  await page.keyboard.press('Enter');

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'POST',
    body: { statement: 'A second witness reached the checkpoint', create: [] },
  });
  expect(fixture.timelineWrites[0].body.when).toMatch(/^2026-06-/);
  await expect(page.getByRole('button', { name: /A second witness/ })).toBeVisible();
  // Emptied for the next one, and the way back is offered.
  await expect(line.getByLabel('What happened')).toHaveValue('');
  await expect(line.getByLabel('When')).toHaveValue('');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fixture.entityWrites.at(-1)?.ids).toEqual([fixture.timelineWrites[0].ownerId]);
  fixture.expectNoUnexpectedRequests();
});

test('notes an entry with a new subject and a place, on that place’s clock', async ({ page }) => {
  const fixture = await openTimeline(page, { catalog: [person, source, mediaEntity, quay] });
  const line = page.getByRole('region', { name: 'Add an event' });
  const say = line.getByLabel('What happened');

  await say.pressSequentially('Crane seen at @South');
  const mentions = page.getByRole('listbox', { name: 'Mentions' });
  await expect(mentions.getByRole('option').first()).toContainText('South quay');
  await say.press('Enter');
  await say.pressSequentially('with @4th brigade');
  await expect(mentions.getByRole('option').last()).toContainText('New · 4th brigade');
  await say.press('ArrowUp');
  await say.press('Enter');
  await expect(line.locator('.chip.new')).toContainText('4th brigade');

  await line.getByLabel('When').fill('23/06/2026 17:05');
  await expect(line).toContainText('Reads: 23 Jun 2026, 17:05:00 Europe/Paris (UTC+02:00)');
  // the chip names the place whose clock it is
  await expect(line.getByRole('button', { name: 'Clock: South quay UTC+02:00' })).toBeVisible();
  await say.press('Enter');

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  const { body } = fixture.timelineWrites[0];
  expect(body).toMatchObject({
    statement: 'Crane seen at South quay with 4th brigade',
    at: ['place-1'],
    when: '2026-06-23T17:05:00+02:00',
    when_zone: 'Europe/Paris',
    create: [{ slot: 'about', type: 'person', label: '4th brigade' }],
  });
  fixture.expectNoUnexpectedRequests();
});

test('files a day at a place as that place’s day, and names the zone', async ({ page }) => {
  const fixture = await openTimeline(page, { catalog: [quay] });
  const line = page.getByRole('region', { name: 'Add an event' });
  const say = line.getByLabel('What happened');

  await say.pressSequentially('Crane seen at @South');
  await expect(page.getByRole('listbox', { name: 'Mentions' }).getByRole('option').first()).toContainText('South quay');
  await say.press('Enter');
  await line.getByLabel('When').fill('23/06/2026');
  await expect(line).toContainText('Reads: 23 Jun 2026 (Europe/Paris)');
  await expect(line.getByRole('button', { name: 'Clock: South quay UTC+02:00' })).toBeVisible();
  await say.press('Enter');

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0].body).toMatchObject({
    at: ['place-1'], when: '2026-06-23', when_zone: 'Europe/Paris',
  });
  fixture.expectNoUnexpectedRequests();
});

test('says what the line takes, and cites a source picked by its kind', async ({ page }) => {
  const fixture = await openTimeline(page);
  const line = page.getByRole('region', { name: 'Add an event' });

  await line.getByLabel('When').focus();
  await expect(line.locator('.help')).toContainText('a month March 2026');
  await line.getByLabel('What happened').focus();
  await expect(line.locator('.help')).toContainText('mentions a person, a place or a file');

  await line.getByRole('button', { name: 'Cite a source' }).click();
  const finder = line.locator('.sources-panel');
  await expect(finder.getByRole('group', { name: 'Kinds' })).toBeVisible();
  await finder.getByRole('button', { name: /^Media/ }).click();
  await expect(finder.getByRole('option')).toHaveCount(1);
  await finder.getByRole('option', { name: /Roadside camera frame/ }).click();
  await expect(line.locator('.chip')).toContainText('Roadside camera frame');
  await expect(line.getByLabel('What happened')).toHaveValue('Seen in Roadside camera frame');
  await line.getByLabel('What happened').press('Enter');

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0].body).toMatchObject({ statement: 'Seen in Roadside camera frame', cites: ['media-1'] });
  fixture.expectNoUnexpectedRequests();
});

test('keeps the source picker in the viewport and separates images from videos', async ({ page }) => {
  const video = { ...mediaEntity, id: 'clip-2', label: 'Convoy clip', attrs: { kind: 'video', path: 'media/clip.mp4' } };
  const fixture = await openTimeline(page, { catalog: [person, source, mediaEntity, video] });
  await page.setViewportSize({ width: 1024, height: 600 });
  const line = page.getByRole('region', { name: 'Add an event' });
  // Put the line near the bottom inside its existing clipped tool container.
  await line.evaluate((node) => { node.style.position = 'fixed'; node.style.bottom = '20px'; node.style.left = '240px'; node.style.width = '740px'; node.style.zIndex = '100'; });
  await line.getByRole('button', { name: 'Cite a source' }).click();
  const picker = line.locator('.sources-panel');
  await expect(picker.getByRole('button', { name: 'Videos', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(picker.getByRole('option')).toHaveCount(1);
  await expect(picker.getByRole('option')).toContainText('Convoy clip');
  const box = await picker.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(box.y + box.height).toBeLessThan((await line.locator('.row').boundingBox()).y);
  await picker.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(picker.getByRole('option')).toHaveCount(1);
  await expect(picker.getByRole('option')).toContainText('Roadside camera frame');
  const heights = await line.locator('.row').evaluate((node) => [...node.querySelectorAll('input, button')].map((field) => field.getBoundingClientRect().height));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('source-picker.png') });
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
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

test('keeps the legend and the whole screen under ⋯, and closes it outside', async ({ page }) => {
  await openTimeline(page);
  await (await more(page)).getByText('Legend', { exact: true }).click();
  await expect(page.getByText('Confidence and date quality are independent.')).toBeVisible();
  await page.locator('.axis-label').click();
  await expect(page.getByText('Confidence and date quality are independent.')).toBeHidden();

  await (await more(page)).getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  // left from the bar, where it can be seen while it is on
  await expect(page.locator('.timeline-bar').getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test('shows day precision across the full day without drawing a period', async ({ page }) => {
  await openTimeline(page);
  await setWindow(page, '2026-06-18T00:00', '2026-06-19T00:00');
  await expect(page.getByRole('button', { name: /Witness arrived/ })).toBeVisible();

  // A bracket across the day it covers: two stops and a hairline, never a period's bar.
  const canvas = eventsLane(page);
  const mark = page.getByRole('button', { name: /Witness arrived/ }).locator('..');
  await expect(mark).toHaveClass(/bracket/);
  await expect(mark).not.toHaveClass(/\bbar\b|period/);
  const [canvasBox, spanBox] = await Promise.all([canvas.boundingBox(), mark.boundingBox()]);
  expect(spanBox.width).toBeGreaterThan(canvasBox.width * .95);
  expect(spanBox.height).toBeLessThan(20);
});

test('puts an exact instant on its pixel, and never nudges it sideways', async ({ page }) => {
  await openTimeline(page);
  await showFileDates(page);
  await setWindow(page, '2026-06-23T18:00', '2026-06-23T19:00');
  const canvas = await fileDatesLane(page).boundingBox();
  const dot = await page.getByRole('button', { name: /Roadside camera frame/ })
    .locator('..').locator('.event-shape').boundingBox();
  // 18:42:11 on a one-hour axis, the middle of the second it was stamped to
  const expected = canvas.x + canvas.width * ((42 * 60 + 11.5) / 3600);
  expect(Math.abs(dot.x + dot.width / 2 - expected)).toBeLessThan(1);
});

test('reads a mark on the ruler, and walks the track with Alt and an arrow', async ({ page }) => {
  await openTimeline(page);
  const witness = page.getByRole('button', { name: /Witness arrived/ });
  await witness.hover();
  const reading = page.locator('.guide-reading');
  await expect(reading).toHaveText('18 Jun 2026');
  // a reduced date is read at both ends of what it covers
  await expect(page.locator('.guide-line')).toHaveCount(2);
  const [line, ruler] = await Promise.all([
    page.locator('.guide-line').first().boundingBox(),
    page.locator('.axis-ruler').boundingBox(),
  ]);
  expect(Math.abs(line.y - (ruler.y + ruler.height))).toBeLessThan(2);

  await page.getByRole('button', { name: /Vehicle remained/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(eventsLane(page).locator(':focus')).toHaveAttribute('data-mark', /claim-1|claim-4|dense/);
  await expect(page.getByRole('dialog', { name: 'Add event' })).toHaveCount(0);
});

test('hangs a card from each mark when the track has the room', async ({ page }) => {
  await openTimeline(page);
  await showFileDates(page);
  const media = fileDatesLane(page);
  const card = media.locator('.event-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Roadside camera frame');
  await expect(card).toContainText('23 Jun 2026, 18:42:11 UTC');
  await card.click();
  await expect(page.locator('.inspector').getByRole('heading', { name: 'Roadside camera frame' })).toBeVisible();
  // the crowded Events track stays on its marks and their captions
  await expect(eventsLane(page).locator('.event-card')).toHaveCount(0);
});

test('says how many dates the files carry when nothing is dated yet', async ({ page }) => {
  await installAppFixture(page, {
    timelineItems: timelineItems.filter((item) => item.produced_here === true),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#timeline');
  await expect(page.getByRole('heading', { name: 'Nothing dated yet' })).toBeVisible();
  await expect(page.getByText('1 date read from files')).toBeVisible();
  await page.getByRole('button', { name: 'Show them' }).click();
  // on a File dates track that holds every file, since that is what was counted
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events', 'File dates']);
  await expect(page.getByRole('button', { name: /Extracted frame/ })).toBeVisible();
});

test("lets a track's working files in from its editor, and out again", async ({ page }) => {
  await openTimeline(page);
  await showFileDates(page);
  await setWindow(page, '2026-06-23T18:00', '2026-06-23T20:00');
  const media = fileDatesLane(page);
  const name = fileDatesRow(page).locator('.track-name');
  await expect(media.getByRole('button', { name: /Extracted frame/ })).toHaveCount(0);
  await expect(name).toHaveAttribute('title', /working files held back/);

  await page.getByRole('button', { name: 'Edit File dates' }).click();
  const editor = page.getByRole('region', { name: 'Edit timeline track' });
  await editor.getByLabel('Include working files').check();
  await editor.getByRole('button', { name: 'Update track' }).click();
  await expect(media.getByRole('button', { name: /Extracted frame/ })).toBeVisible();
  await expect(name).not.toHaveAttribute('title', /held back/);

  await page.getByRole('button', { name: 'Edit File dates' }).click();
  await editor.getByLabel('Include working files').uncheck();
  await editor.getByRole('button', { name: 'Update track' }).click();
  await expect(media.getByRole('button', { name: /Extracted frame/ })).toHaveCount(0);
});

test('reads the axis and the list as one', async ({ page }) => {
  await openTimeline(page);
  const list = page.getByRole('region', { name: 'Timeline list' });
  await expect(list).toBeVisible();
  const row = list.getByRole('row', { name: /Witness arrived/ });
  await expect(row).toContainText('Harbour witness');
  await expect(row).toContainText('Interview notes');
  // a Claim still waiting for its reasoning says so, in words
  await expect(list.getByRole('row', { name: /Vehicle remained/ })).toContainText('no source');

  const mark = page.getByRole('button', { name: /Witness arrived/ });
  await row.hover();
  await expect(mark.locator('..')).toHaveClass(/\blit\b/);
  await expect(page.locator('.guide-reading')).toHaveText('18 Jun 2026');
  await mark.hover();
  await expect(row).toHaveClass(/\blit\b/);

  const axisBefore = await page.locator('.axis-card').boundingBox();
  await page.getByRole('button', { name: /Second convoy cleared/ }).click();
  const third = list.getByRole('row', { name: /Second convoy cleared/ });
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await expect(third).toBeInViewport();
  // the list scrolled on its own; the axis did not move
  expect((await page.locator('.axis-card').boundingBox()).y).toBeCloseTo(axisBefore.y, 0);

  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector').getByRole('heading', { name: timelineItem('claim-1').label })).toBeVisible();
});

test('gives the axis or the list the room, as a saved mode or a drag', async ({ page }) => {
  await openTimeline(page);
  const axis = page.locator('.axis-card');
  // measured once the column has its height, which is what the share is a share of
  await expect.poll(async () => (await axis.boundingBox()).height).toBeGreaterThan(160);
  const plot = (await axis.boundingBox()).height;
  await page.getByRole('button', { name: 'List' }).click();
  await expect.poll(async () => (await axis.boundingBox()).height).toBeLessThan(plot);
  const listed = (await axis.boundingBox()).height;

  const split = page.getByRole('separator', { name: /axis and the list/ });
  const box = await split.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await axis.boundingBox()).height).toBeGreaterThan(listed);
  // the ruler stays over the tracks it measures while they scroll
  await axis.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const [ruler, card] = await Promise.all([page.locator('.axis-row').boundingBox(), axis.boundingBox()]);
  expect(Math.abs(ruler.y - card.y)).toBeLessThan(2);
});

test('copies the window as a table for a report or a block for a spreadsheet', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copied.push(text); } },
    });
  });
  await openTimeline(page);
  const list = page.getByRole('region', { name: 'Timeline list' });
  await list.getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('menuitem', { name: 'As a Markdown table' }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
  const markdown = await page.evaluate(() => window.__copied[0]);
  expect(markdown).toContain('| Date | Statement | Subjects | Places | Sources | Confidence |');
  expect(markdown).toContain('| 18 Jun 2026 | Witness arrived at the north checkpoint | Harbour witness |  | Interview notes | probable |');
  expect(markdown).toMatch(/^> .*Timeline/);

  await list.getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('menuitem', { name: 'For a spreadsheet' }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
  const block = await page.evaluate(() => window.__copied[1]);
  expect(block.split('\n')[0]).toBe('date_as_written\ttime_zone\tearliest_utc\tlatest_utc\tstatement\tsubjects\tplaces\tsources\tconfidence\tstatus');
  expect(block).toContain('2026-06-18\t\t2026-06-18T00:00:00Z\t2026-06-19T00:00:00Z\tWitness arrived at the north checkpoint');
});

test('lands on what the Overview counted as waiting for a date', async ({ page }) => {
  await installAppFixture(page, { catalog: [person, source, mediaEntity], timelineItems });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#overview');
  await page.getByRole('button', { name: /No date yet/ }).click();
  const queue = page.locator('.undated-card');
  await expect(queue).toHaveAttribute('open', '');
  await expect(queue).toBeInViewport();
  await expect(queue.getByRole('button', { name: /Resolve the timezone/ })).toBeFocused();
});

test('creates and resizes an hourly period on a day view', async ({ page }) => {
  const fixture = await openTimeline(page);
  await setWindow(page, '2026-06-23T00:00', '2026-06-24T00:00');

  const canvas = eventsLane(page);
  await expect(canvas).toHaveClass(/createable/);
  await canvas.evaluate((element) => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const box = await canvas.boundingBox();
  const y = box.y + box.height - 8;
  await canvas.hover({ position: { x: box.width * .4, y: box.height - 8 } });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, y, { steps: 5 });
  await page.mouse.up();

  const line = page.getByRole('region', { name: 'Add an event' });
  await expect(line.getByLabel('When')).toHaveValue(/^23\/06\/2026 \d{2}:\d{2}.* 23\/06\/2026 \d{2}:\d{2}/);
  await page.keyboard.type('Traffic peaked around the checkpoint');
  await page.keyboard.press('Enter');

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

test('keeps creation on the Claims track and offers the list view', async ({ page }) => {
  await openTimeline(page);
  // a file is dated from its proof or an event about it, not by a click on its lane
  await expect(mediaLane(page)).toContainText('A proof’s date or an event about a file puts it here.');
  const box = await mediaLane(page).boundingBox();
  await page.mouse.click(box.x + box.width * .7, box.y + box.height - 8);
  await expect(page.getByRole('region', { name: 'Add an event' }).getByLabel('When')).toHaveValue('');

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByRole('region', { name: 'Timeline list' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Second convoy cleared/ })).toBeVisible();
});

test('starts a media correction from the captured date', async ({ page }) => {
  const fixture = await openTimeline(page);
  await showFileDates(page);
  await page.getByRole('button', { name: /Roadside camera frame/ }).click();
  const inspector = page.locator('.inspector');
  await expect(inspector.locator('header')).toContainText('File date');
  // once, under the date: the footer no longer offers it a second time
  await expect(inspector.getByRole('button', { name: 'Add correction' })).toHaveCount(0);
  const correction = inspector.getByRole('button', { name: 'Correct this date' });
  await expect(correction).toBeEnabled();
  await correction.click();

  const dialog = page.getByRole('dialog', { name: 'Add event' });
  await expect(dialog.getByLabel('Date format')).toHaveValue('timestamp');
  await expect(dialog.getByLabel('Date and time')).toHaveValue('2026-06-23T18:42:11');
  await expect(dialog.getByRole('button', { name: 'Clock: UTC' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add event' }).click();

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
  // Lanes share the axis's height, so a crowd only folds into a `+n` once it outgrows
  // what the axis can hold: a few more marks than the shared timelineItems carry.
  const crowd = Array.from({ length: 40 }, (_, index) => ({
    ...timelineItem('dense-0'),
    id: `temporal:claim:crowd-${index}`, owner_id: `crowd-${index}`,
    label: `Gate camera ${index + 1} records the same arrival window`,
  }));
  await openTimeline(page, { timelineItems: [...timelineItems, ...crowd] });
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
  await zoomIn(page);
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

test('moves and shortens a selected claim on the axis', async ({ page }) => {
  const fixture = await openTimeline(page);
  const period = page.getByRole('button', { name: /Vehicle remained/ });
  await period.click();
  await page.locator('.inspector').getByText('About this date').click();
  await expect(page.getByText('Drag it on the axis to move it, or either edge to resize.')).toBeVisible();

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
  const line = page.getByRole('region', { name: 'Add an event' });
  await line.getByLabel('What happened').fill('A dated observation');
  await line.getByRole('button', { name: 'More' }).click();
  await line.getByRole('button', { name: 'Full editor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add event' });
  await expect(dialog.getByLabel('Claim', { exact: true })).toHaveValue('A dated observation');
  await dialog.getByLabel('Date format').selectOption('advanced');
  await dialog.getByLabel('When').fill('late summer');
  await expect(dialog.getByText('Use a supported date or timestamp.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add event' })).toBeDisabled();
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
  await flatBoard(page);
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td:not(.pick)').first().click();
  const details = boardDetails(page);
  await expect(details.getByRole('tab')).toHaveText(['Info', 'Connections', 'Time']);
  await details.getByRole('tab', { name: 'Time' }).click();

  await expect(details.getByRole('heading', { name: 'Claims about this' })).toBeVisible();
  await expect(details.getByText(timelineItem('claim-1').label, { exact: true })).toBeVisible();
  await expect(details.getByText(timelineItem('claim-3').label, { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Add dated claim' })).toBeVisible();
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
  await flatBoard(page);
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: mediaEntity.label }).locator('td:not(.pick)').first().click();
  const details = boardDetails(page);
  await details.getByRole('tab', { name: 'Time' }).click();
  await details.getByRole('button', { name: `Open ${mediaEntity.label} in Timeline` }).click();

  // The chip scopes the axis and the named row opens, even though Timeline had
  // loaded nothing at the moment Details handed it over.
  await expect(page.locator('.scope-chip')).toContainText(mediaEntity.label);
  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('heading', { name: mediaEntity.label })).toBeVisible();
  await expect(inspector.getByText('23 Jun 2026, 18:42:11 UTC')).toBeVisible();
  // the track that holds a file's own date is put on the axis to show it
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events', 'File dates']);
});

test('edits an existing claim from the Time tab', async ({ page }) => {
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
  await flatBoard(page);
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td:not(.pick)').first().click();
  const details = boardDetails(page);
  await details.getByRole('tab', { name: 'Time' }).click();

  await details.getByRole('button', { name: `Edit ${timelineItem('claim-1').label}` }).click();
  const editor = details.getByRole('region', { name: 'Edit claim' });
  await expect(editor.getByLabel('Claim', { exact: true })).toHaveValue(timelineItem('claim-1').label);
  await editor.getByLabel('Claim', { exact: true }).fill('Witness reached the north checkpoint');
  await editor.getByRole('button', { name: 'Update claim' }).click();

  await expect.poll(() => fixture.timelineWrites.length).toBe(1);
  expect(fixture.timelineWrites[0]).toMatchObject({
    method: 'PATCH',
    ownerId: 'claim-1',
    body: { statement: 'Witness reached the north checkpoint' },
  });
});

test('starts a new claim from an empty form after editing one', async ({ page }) => {
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
  await flatBoard(page);
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: person.label }).locator('td:not(.pick)').first().click();
  const details = boardDetails(page);
  await details.getByRole('tab', { name: 'Time' }).click();

  await details.getByRole('button', { name: `Edit ${timelineItem('claim-1').label}` }).click();
  const editing = details.getByRole('region', { name: 'Edit claim' });
  await expect(editing.getByLabel('Claim', { exact: true })).toHaveValue(timelineItem('claim-1').label);

  await details.getByRole('button', { name: 'Add dated claim' }).click();
  const adding = details.getByRole('region', { name: 'Add dated claim' });
  await expect(adding.getByLabel('Claim', { exact: true })).toHaveValue('');
  await expect(adding.getByLabel('When')).toHaveValue('');
});

test('shows an undated Claim as a missing claim date, not an existing one', async ({ page }) => {
  const fixture = await installAppFixture(page, {
    catalog: [undatedClaim],
    timelineItems,
    chains: {
      'claim-3': claimChain('claim-3', undatedClaim.label, undatedClaim.attrs),
    },
  });
  await flatBoard(page);
  await page.goto('/#board');
  await page.locator('tbody tr').filter({ hasText: undatedClaim.label }).locator('td:not(.pick)').first().click();
  const details = boardDetails(page);
  await details.getByRole('tab', { name: 'Time' }).click();

  await expect(details.getByText('This claim has no date yet.')).toBeVisible();
  await expect(details.getByText('A claim has one date or range.')).toBeVisible();
  await expect(details.getByText('Undated', { exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Set claim date' }).click();

  const editor = details.getByRole('region', { name: 'Set claim date' });
  await expect(editor.getByLabel('Claim', { exact: true })).toHaveValue(undatedClaim.label);
  await editor.getByLabel('When').fill('2026-08-12');
  await editor.getByRole('button', { name: 'Update claim' }).click();

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
  // Read on UTC, so the window handed on is the one typed: the quay would otherwise put
  // the axis on Paris time, and 1 June there starts on 31 May in UTC.
  const fixture = await openTimeline(page, {
    catalog: [person, source, mediaEntity, quay],
    timelineItems: [...timelineItems, placedItem],
    clock: 'utc',
    ...options,
  });
  await setWindow(page, '2026-06-01T00:00', '2026-06-21T00:00');
  await expect(page.getByRole('button', { name: '1 Jun – 21 Jun 2026' })).toBeVisible();
  return fixture;
}

function timelineMapLayer(page) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('button', { name: 'Timeline points', exact: true }),
  });
}

test('hands one window from the Timeline to the Map, the Board and back', async ({ page }) => {
  const fixture = await openTimelineOverJune(page);
  await (await more(page)).getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();
  await awaitMapReady(page); // the marks are drawn on it, so it has to be up

  const layer = timelineMapLayer(page);
  await expect(layer.getByRole('button', { name: 'Timeline points' }))
    .toHaveAttribute('title', '1 Jun – 21 Jun 2026');
  // What the window holds, and how much of it the map can show: the layer reads
  // every category the Timeline was reading, so the compact count is the whole window.
  await expect(layer).toContainText('1 of 12');
  await expect(page.locator('.temporal-mark')).toHaveCount(1);

  await layer.getByRole('button', { name: 'Board' }).click();

  // The Board asks the server for the window rather than hiding rows it already has,
  // and says which window it is answering.
  await expect(page.getByLabel('Fact-time range')).toContainText('1 Jun – 21 Jun 2026');
  await expect.poll(() => fixture.catalogQueries.at(-1)).toContain('temporal_from=2026-06-01');
  // Grouped by kind, and every group holding part of the window open.
  await expect(page.locator('tbody tr')).toHaveText([
    /Harbour witness/, /South quay/, /Interview notes/,
  ]);

  await page.getByLabel('Fact-time range').getByRole('button', { name: 'Timeline' }).click();

  await expect(page.locator('.timeline-bar')).toBeVisible();
  await expect(page.getByRole('button', { name: '1 Jun – 21 Jun 2026' })).toBeVisible();
  fixture.expectNoUnexpectedRequests();
});

test('opens a statement in the Timeline from its mark on the map', async ({ page }) => {
  const fixture = await openTimelineOverJune(page);
  await (await more(page)).getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();
  await awaitMapReady(page); // the marks are drawn on it, so it has to be up

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
  await (await more(page)).getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();
  await awaitMapReady(page); // the marks are drawn on it, so it has to be up

  await expect(page.locator('.temporal-mark')).toHaveCount(1);
  await expect(page.locator('.saved-mark-place')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved work', exact: true }))
    .toHaveAttribute('aria-pressed', 'false');

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
  await (await more(page)).getByRole('group', { name: 'Open range' }).getByRole('button', { name: 'Map' }).click();
  await awaitMapReady(page); // the marks are drawn on it, so it has to be up

  const layer = timelineMapLayer(page);
  await expect(layer).toContainText('0 of 10');
  // Nothing to draw is said in words, not by pulling the view out to two continents
  // of unrelated pins, which is what a map showing everything looks like.
  await expect(page.locator('.temporal-mark')).toHaveCount(0);
  await expect(page.locator('.saved-mark-place')).toHaveCount(0);
  fixture.expectNoUnexpectedRequests();
});

test('shows the file a picked entry is about, one press from full screen', async ({ page }) => {
  await openTimeline(page);
  await showFileDates(page);

  await page.getByRole('button', { name: /Roadside camera frame/ }).first().click();
  const preview = page.locator('.inspector figure.preview');
  await expect(preview.locator('img')).toHaveAttribute('src', /media\/panel\.svg/);

  await preview.getByRole('button', { name: 'Open Roadside camera frame full screen' }).click();
  await expect(page.locator('.stage img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.stage')).toHaveCount(0);
  // the inspector stays on the entry
  await expect(preview).toBeVisible();
});

test('changes a picked entry’s date from the inspector, asked like a drag', async ({ page }) => {
  const fixture = await openTimeline(page);

  await page.getByRole('button', { name: /Witness arrived/ }).first().click();
  const inspector = page.locator('.inspector');
  await inspector.getByRole('button', { name: 'Change the date' }).click();
  const field = inspector.getByLabel('When');
  await field.fill('20/06/2026 15:10');
  await expect(inspector.getByText(/20 Jun 2026/)).toBeVisible();
  await inspector.getByRole('button', { name: 'Save date' }).click();

  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('→ 20 Jun 2026');
  await ask.getByRole('button', { name: 'Update date' }).click();
  // the entry's day was UTC's, so the time it becomes is read on UTC too; the new day
  // stays inside the window, so the picked entry is still there to read after the reload
  await expect.poll(() => fixture.timelineWrites.at(-1)?.body?.when).toBe('2026-06-20T15:10:00Z');
  await expect(inspector.getByRole('button', { name: 'Change the date' })).toBeVisible();
});

test('gives a picked entry’s day any zone in the world from the inspector', async ({ page }) => {
  const fixture = await openTimeline(page);

  await page.getByRole('button', { name: /Witness arrived/ }).first().click();
  const inspector = page.locator('.inspector');
  await inspector.getByRole('button', { name: 'Change the date' }).click();
  await expect(inspector.getByRole('button', { name: 'Clock: UTC' })).toBeVisible();
  // the same day on another clock is a change worth saving
  await inspector.getByRole('button', { name: 'Clock: UTC' }).click();
  const menu = page.locator('.clock-menu');
  await menu.getByRole('textbox').fill('tokyo');
  await menu.getByRole('button', { name: /^Tokyo/ }).click();
  await expect(inspector.getByRole('button', { name: 'Clock: Tokyo UTC+09:00' })).toBeVisible();
  await inspector.getByRole('button', { name: 'Save date' }).click();

  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('→ 18 Jun 2026 (Asia/Tokyo)');
  await ask.getByRole('button', { name: 'Update date' }).click();
  await expect.poll(() => fixture.timelineWrites.at(-1)?.body).toMatchObject({ when: '2026-06-18', when_zone: 'Asia/Tokyo' });
});

test('offers a file’s date as a correction rather than a rewrite', async ({ page }) => {
  await openTimeline(page);
  await showFileDates(page);
  await page.getByRole('button', { name: /Roadside camera frame/ }).first().click();
  await expect(page.locator('.inspector').getByRole('button', { name: 'Correct this date' })).toBeVisible();
  await expect(page.locator('.inspector').getByRole('button', { name: 'Change the date' })).toHaveCount(0);
});

test('draws a file where the analyst dated it, and imagery on a lane of its own', async ({ page }) => {
  // A proof's date is stated for the footage, and an event cites a Compare render.
  const render = {
    id: 'render-1', type: 'media', label: 'Compare render of the bridge',
    attrs: { path: 'media/render.png', kind: 'image' }, origin: { type: 'compare' },
    provenance: { by: 'compare', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
  };
  const dated = (id, label, raw, connectors) => ({
    ...timelineItem('claim-4'), id: `temporal:claim:${id}`, owner_id: id, label, raw,
    earliest: `${raw}T00:00:00Z`, latest: `${raw}T23:59:59Z`, subjects: [], sources: [], ...connectors,
  });
  await openTimeline(page, {
    catalog: [person, source, mediaEntity, render],
    timelineItems: [
      ...timelineItems,
      dated('claim-footage', 'Material of Bridge proof was taken', '2026-06-20', { subjects: ['media-1'] }),
      dated('claim-render', 'A crater on the approach road', '2026-06-21', { sources: ['render-1'] }),
    ],
  });

  // the footage is drawn as itself, at the proof's date, and the render is not
  const media = mediaLane(page);
  await expect(media.getByRole('button', { name: /Roadside camera frame/ })).toHaveCount(1);
  await expect(media.getByRole('button', { name: /Compare render/ })).toHaveCount(0);
  await expect(eventsLane(page).getByRole('button', { name: /Material of Bridge proof/ })).toBeVisible();
  // picked, it is the event that dates it
  await media.getByRole('button', { name: /Roadside camera frame/ }).click();
  const inspector = page.locator('.inspector');
  await expect(inspector.locator('header')).toContainText('Event');
  await expect(inspector.getByRole('heading', { name: 'Material of Bridge proof was taken' })).toBeVisible();

  // what the app pictured from above is a lane added on purpose
  await addTrack(page, /^Imagery/);
  await expect(page.locator('.track-label strong')).toHaveText(['Media', 'Events', 'Imagery']);
  const imagery = page.locator('.track-canvas').nth(2);
  await expect(imagery.getByRole('button', { name: /Compare render of the bridge/ })).toHaveCount(1);
  await expect(imagery.getByRole('button', { name: /Roadside camera frame/ })).toHaveCount(0);
});

test('reads the case on the clock of its places, and keeps the one picked', async ({ page }) => {
  // The quay is at Marseille: the axis opens on Paris time and says so, and the list
  // reads its instants there too.
  await openTimeline(page, { catalog: [person, source, mediaEntity, quay] });
  await showFileDates(page);
  const clock = page.locator('.zone-picker .trigger');
  await expect(clock).toContainText('Paris');
  await expect(clock).toHaveAttribute('title', "The clock of the case's places");
  await expect(page.locator('.axis-label')).toContainText('Paris time');
  const list = page.getByRole('region', { name: 'Timeline list' });
  await expect(list.getByRole('columnheader').first()).toHaveText('Date · Paris time');
  // 18:42:11 UTC on 23 June is 20:42:11 in Paris
  await expect(list.getByRole('row', { name: /Roadside camera frame/ })).toContainText('23 Jun 2026, 20:42:11');

  await clock.click();
  await page.locator('.zone-picker .menu').getByRole('button', { name: /^UTC/ }).click();
  await expect(clock).toHaveText(/^\s*UTC\s*$/);
  await expect(page.locator('.axis-label small')).toHaveCount(0);

  // the pick is the case's from now on, in this browser
  await page.reload();
  await expect(page.locator('.timeline-bar')).toBeVisible();
  await expect(page.locator('.zone-picker .trigger')).toHaveText(/^\s*UTC\s*$/);
});

test('opens with no inspector and no whole-case strip, one bar over the axis', async ({ page }) => {
  await openTimeline(page);
  const bar = page.locator('.timeline-bar');
  // the period, its clock and the split are out; the rest waits under ⋯
  await expect(bar.locator('.range-face')).toBeVisible();
  await expect(bar.locator('.zone-picker')).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Plot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Full screen' })).toHaveCount(0);
  await expect(page.getByLabel('Group by')).toHaveCount(0);
  // adding is the line under the axis, not a second button over it
  await expect(bar.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('.overview-card')).toHaveCount(0);
  // the first lane starts right under the bar and the ruler
  const events = await page.locator('.track-row').first().boundingBox();
  expect(events.y).toBeLessThan(260);
  // Escape lets go of ⋯
  await more(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.more-menu')).toHaveCount(0);
});
