import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture, GRAPH_THUMB } from './app.fixture.js';

const SECOND_CASE = 'browser-test-b';

function isolatedGraph(catalog) {
  const nodes = catalog.map((entity) => ({
    id: entity.id,
    type: entity.type,
    label: entity.label,
    family: 'actor',
    status: entity.provenance?.status ?? 'confirmed',
    at: entity.provenance?.at ?? '2026-08-01T09:00:00Z',
    degree: 0,
  }));
  return {
    lens: 'all',
    order: 'degree',
    nodes,
    links: [],
    total: nodes.length,
    shown: nodes.length,
    truncated: false,
    isolated: nodes.length,
    pinned: 0,
  };
}

/**
 * The case graph, in a real browser.
 *
 * A source-reading test cannot tell whether a canvas drew anything. Konva resolves
 * no CSS variable, a stage with no size draws nothing, a draggable group only drags
 * where it has shapes, and a redraw on selection can silently throw the view back
 * to where it started — none of which a string assertion catches. So the things
 * that only fail in a browser run here: that the canvas has pixels, that a node can
 * be picked, that the view stays where it was put, and that the counts the view
 * promises are on screen.
 */

async function openGraph(page, options = {}) {
  const fixture = await installAppFixture(page, options);
  await page.goto('/#case/graph');
  await expect(page.getByLabel('Lens')).toBeVisible();
  return fixture;
}

/** Konva draws into a <canvas> it creates itself; a stage with no size makes none. */
const canvas = (page) => page.locator('.canvas canvas').first();

/**
 * How much of the canvas has anything drawn on it, 0 to 1.
 *
 * The only honest way to assert on a canvas: the DOM says nothing about pixels. It
 * is what lets a spec prove that a pan actually moved the drawing, and that a
 * mouseover did not put it back.
 */
async function ink(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.canvas canvas');
    const ctx = el.getContext('2d');
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit += 1;
    return lit / (data.length / 4);
  });
}

/** Keep the ink exactly as it stands, to be compared with what it becomes. */
async function keepInk(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.canvas canvas');
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    const lit = new Uint8Array(data.length / 4);
    for (let i = 0; i < lit.length; i += 1) lit[i] = data[i * 4 + 3] > 8 ? 1 : 0;
    window.__ink = lit;
  });
}

/**
 * How much of what was drawn is no longer drawn, as a fraction of what was.
 *
 * The only way to ask a canvas whether the picture stayed put. Ink that appears is
 * deliberately not counted: something arriving is the point of the gesture, and the
 * question here is whether anything **left** the place it was in.
 */
async function inkLost(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.canvas canvas');
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    const before = window.__ink;
    let was = 0;
    let gone = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (!before[i]) continue;
      was += 1;
      if (!(data[i * 4 + 3] > 8)) gone += 1;
    }
    return was ? gone / was : 1;
  });
}

/**
 * Drag across the empty space, which is most of a graph.
 *
 * Walked in strokes that fit inside the canvas: Firefox never delivers a pointerup
 * released outside the window, so one long drag would leave the pan running and
 * prove nothing about the release.
 */
/**
 * Wait until the case is actually on the canvas.
 *
 * `openGraph` waits for the toolbar, which is in the DOM before Konva has drawn a
 * thing. A spec that measured ink straight after it was reading whatever had
 * landed by then, which is why it passed alone and failed in a warm suite.
 */
async function drawn(page) {
  await expect.poll(() => ink(page), { timeout: 5000 }).toBeGreaterThan(0.001);
}

/**
 * Where the canvas is, once there is a canvas to measure.
 *
 * Konva throws its layer away and makes a new one on every rebuild, so the element
 * matched a moment ago can already be detached — and a detached element answers
 * `boundingBox()` with null rather than with a size. Polled for that reason: read
 * once, straight after the toolbar appeared, it read null on a warm suite.
 */
async function canvasBox(page) {
  let box = null;
  await expect
    .poll(
      async () => {
        box = await canvas(page).boundingBox();
        return box?.width ?? 0;
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  return box;
}

async function panBy(page, dx, dy) {
  const box = await canvasBox(page);
  const strokes = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx) / (box.width * 0.55), Math.abs(dy) / (box.height * 0.55))),
  );
  const sx = dx / strokes;
  const sy = dy / strokes;
  for (let i = 0; i < strokes; i += 1) {
    const from = {
      x: box.x + (sx < 0 ? box.width - 20 : 20),
      y: box.y + (sy < 0 ? box.height - 20 : 20),
    };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + sx, from.y + sy, { steps: 8 });
    await page.mouse.up();
  }
}

test('draws the case on a sized canvas', async ({ page }) => {
  await openGraph(page);
  await expect(canvas(page)).toBeVisible();
  const box = await canvasBox(page);
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeGreaterThan(150);
  await drawn(page);
});

test('opens on the whole case and says how much of it is shown', async ({ page }) => {
  await openGraph(page);
  await expect(page.getByText('7 of 7')).toBeVisible();
});

test('Search+ actually narrows the graph, including a stored entity field', async ({ page }) => {
  const fixture = await openGraph(page);
  const bar = page.locator('.graph-tool .filter-bar');

  // The plate is not in the node title. This proves the broad case index reaches a
  // typed field and that the Graph sends the term instead of repainting the old set.
  await bar.getByLabel('Search the case').fill('AX-904-ZT');
  await expect(page.getByText('1 of 1')).toBeVisible();
  await expect.poll(() => fixture.graphQueries.at(-1)?.search ?? '').toContain('q=AX-904-ZT');

  await bar.getByRole('button', { name: 'Clear all' }).click();
  await bar.getByRole('button', { name: 'Filter', exact: true }).click();
  await bar.locator('.pop.wide').getByRole('button', { name: /^Type\b/i }).click();
  await bar.locator('.pop').last().getByRole('button', { name: /^Vehicle\b/i }).click();
  await expect(page.getByText('1 of 1')).toBeVisible();
  await expect.poll(() => fixture.graphQueries.at(-1)?.search ?? '').toContain('type=vehicle');
});

test('autosaves a live analysis view, including its view-local arrangement', async ({ page }) => {
  const fixture = await openGraph(page);
  const bar = page.locator('.graph-tool .filter-bar');
  await bar.getByLabel('Search the case').fill('harbour');

  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save analysis view' });
  await dialog.getByLabel('Name').fill('Harbour accounts');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.locator('.views .active')).toContainText('Harbour accounts');
  expect(fixture.analysisWrites.at(-1)).toMatchObject({
    method: 'POST',
    body: { name: 'Harbour accounts', mode: 'live', surface: 'graph' },
  });
  expect(fixture.analysisWrites.at(-1).body.spec.query.terms.q).toBe('harbour');

  const casePinWrites = fixture.graphPinWrites.length;
  await pick(page, '@harbourwatch');
  await dragNode(page, await middle(page), 110, -50);
  await expect(page.locator('.views .active')).toContainText('saving');
  await expect.poll(
    () => fixture.analysisWrites.at(-1)?.body?.spec?.graph?.arrangement?.length ?? 0,
  ).toBe(1);
  expect(fixture.analysisWrites.at(-1).body.spec.graph.arrangement[0].id).toBe('acc-1');
  expect(fixture.graphPinWrites).toHaveLength(casePinWrites);
  await expect(page.locator('.views .active')).toContainText('saved');

  await page.getByRole('button', { name: 'Leave saved view' }).click();
  await page.getByRole('button', { name: /^Views/ }).click();
  await page.getByRole('button', { name: 'Harbour accounts live · graph' }).click();
  await expect(page.getByRole('button', { name: 'Reset 1 pin' })).toBeVisible();
  expect(fixture.graphPinWrites).toHaveLength(casePinWrites);

  await pick(page, '@harbourwatch');
  await page.locator('.panel').getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(
    () => fixture.analysisWrites.at(-1)?.body?.spec?.graph?.omitted ?? [],
  ).toContain('acc-1');
  await expect(page.locator('.views .active')).toContainText('saved');

  await bar.getByLabel('Search the case').fill('checkpoint');
  await expect(page.locator('.views .active')).toContainText('saving');
  await expect.poll(
    () => fixture.analysisWrites.at(-1)?.body?.spec?.query?.terms?.q,
  ).toBe('checkpoint');
  await expect(page.locator('.views .active')).toContainText('saved');
  await expect(page.getByRole('button', { name: 'Update saved view' })).toHaveCount(0);
});

test('opens a snapshot as a frozen graph without exposing case writes', async ({ page }) => {
  const captured = {
    id: 'v_snapshot',
    name: 'Morning capture',
    mode: 'snapshot',
    surface: 'graph',
    created_at: '2026-08-10T10:00:00Z',
    updated_at: '2026-08-10T10:00:00Z',
    spec: {
      version: 1,
      query: { filter: { q: 'harbour' }, terms: { q: 'harbour' } },
      graph: {
        lens: 'all', order: 'degree', root: null, hops: 1, folder: '', families: [],
        kept: [], expanded: [], omitted: [], collapsed: [], putAway: {},
      },
      snapshot: {
        captured_at: '2026-08-10T10:00:00Z',
        entities: [
          {
            id: 'cap-a', type: 'person', label: 'Captured witness',
            attrs: { role: 'observer' },
            provenance: { by: 'analyst', at: '2026-08-10T09:58:00Z', status: 'confirmed' },
            snapshot_images: [{
              id: 'photo-a', title: 'Witness portrait', primary: true,
              data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            }],
          },
          { id: 'cap-b', type: 'organization', label: 'Captured group', attrs: {}, provenance: {} },
        ],
        links: [{ id: 'cap-link', from: 'cap-a', to: 'cap-b', type: 'member-of', provenance: {} }],
      },
    },
  };
  const fixture = await openGraph(page, { analysisViews: [captured] });

  await page.getByRole('button', { name: /^Views/ }).click();
  await page.locator('.views .menu .open', { hasText: 'Morning capture' }).click();
  await expect(page.locator('.views .active')).toContainText('snapshot');
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.locator('.graph-tool .filter-bar').getByLabel('Search the case')).toBeDisabled();
  await expect.poll(() => fixture.graphQueries.at(-1)?.search ?? '').toContain('view=v_snapshot');

  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByRole('button', { name: 'New entity here' })).toHaveCount(0);
  expect(fixture.graphPinWrites).toEqual([]);

  await pick(page, 'Captured witness');
  await expect(page.getByRole('button', { name: 'In the Board' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Captured details' }).click();
  const details = page.getByRole('dialog', { name: 'Snapshot details' });
  await expect(details).toContainText('Nothing here edits the case');
  await expect(details).toContainText('observer');
  await expect(details.getByRole('img', { name: 'Witness portrait' })).toBeVisible();
  await expect(details).toContainText('member of');
  await details.getByRole('button', { name: 'Close' }).click();

  // A capture belongs to its source surface. Moving to Board leaves it instead of
  // presenting a Graph snapshot as an incomplete second case. The former bug also
  // reopened a live "Details" dialog after the frozen view had gone away.
  await page.locator('.tabstrip').getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.views .active')).toHaveCount(0);
  const board = page.locator('.tool', {
    has: page.getByRole('heading', { name: 'Board' }),
  });
  await expect(board.getByLabel('Search the case')).toBeEnabled();
  await expect(page.getByRole('dialog', { name: 'Snapshot details' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Details', exact: true })).toHaveCount(0);
});

test('rereads while mounted when the Board files an entity', async ({ page }) => {
  const first = {
    id: 'person-1',
    type: 'person',
    label: 'First witness',
    attrs: {},
    provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
  };
  const created = {
    id: 'e_new',
    type: 'person',
    label: 'Second witness',
    attrs: {},
    provenance: { by: 'user', at: '2026-08-03T10:00:00Z', status: 'confirmed' },
  };
  await openGraph(page, {
    catalog: [first],
    graph: ({ catalog }) => isolatedGraph(catalog),
    chains: {
      e_new: { entity: created, sources: [], lost: [], dependents: [], relations: [], empty: true },
    },
  });
  await expect(page.getByText('1 of 1')).toBeVisible();

  await page.locator('.tabstrip').getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'New entity' }).click();
  await page.getByLabel('Type').selectOption('person');
  await page.getByLabel('Full name').fill('Second witness');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.locator('.tabstrip').getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
});

test('keeps the new case when an older graph response arrives last', async ({ page }) => {
  const graphA = isolatedGraph([{
    id: 'only-a', type: 'person', label: 'Only in A',
    provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
  }]);
  const graphB = isolatedGraph([
    {
      id: 'first-b', type: 'person', label: 'First in B',
      provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
    },
    {
      id: 'second-b', type: 'person', label: 'Second in B',
      provenance: { by: 'user', at: '2026-08-01T10:00:00Z', status: 'confirmed' },
    },
  ]);
  const fixture = await openGraph(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: SECOND_CASE, name: 'Case B', scratch: false, folders: [] },
    ],
    graphs: { [CASE_ID]: graphA, [SECOND_CASE]: graphB },
    graphDelays: { [CASE_ID]: 300 },
  });
  await expect.poll(() => fixture.graphQueries.some((entry) => entry.caseId === CASE_ID)).toBe(true);

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();
  await expect(page.getByTitle('Switch case')).toContainText('Case B');
  await expect(page.getByText('2 of 2')).toBeVisible();

  await page.waitForTimeout(350);
  await expect(page.getByTitle('Switch case')).toContainText('Case B');
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.getByText('1 of 1')).toHaveCount(0);
});

test('opens a new case whole after reading a neighbourhood in the old one', async ({ page }) => {
  const graphB = isolatedGraph([
    {
      id: 'first-b', type: 'person', label: 'First in B',
      provenance: { by: 'user', at: '2026-08-01T09:00:00Z', status: 'confirmed' },
    },
    {
      id: 'second-b', type: 'person', label: 'Second in B',
      provenance: { by: 'user', at: '2026-08-01T10:00:00Z', status: 'confirmed' },
    },
  ]);
  await openGraph(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: SECOND_CASE, name: 'Case B', scratch: false, folders: [] },
    ],
    graphs: { [SECOND_CASE]: graphB },
  });
  await pick(page, '3rd Battalion');
  await page.getByRole('button', { name: /^Around this/ }).click();
  await expect(page.getByRole('button', { name: 'Whole case' })).toBeVisible();

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();
  await expect(page.getByText('2 of 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Whole case' })).toHaveCount(0);
});

test('counts what nothing connects to, which the board has no column for', async ({ page }) => {
  await openGraph(page);
  await expect(page.getByText('2 unconnected')).toBeVisible();
});

test('names each family present, and only those', async ({ page }) => {
  await openGraph(page);
  const legend = page.locator('.legend');
  await expect(legend).toContainText('actor');
  await expect(legend).toContainText('identifier');
  await expect(legend).toContainText('place');
  await expect(legend).not.toContainText('claim');
});

test('explains its strokes, so a dash pattern is not decoration', async ({ page }) => {
  await openGraph(page);
  const legend = page.locator('.legend');
  await expect(legend).toContainText('stated relation');
  await expect(legend).toContainText('proposed, not confirmed');
  // Nothing in the drawn case is a lineage edge, so that stroke is not advertised.
  await expect(legend).not.toContainText('produced from');
});

test('hides the ordering on a case it can draw whole', async ({ page }) => {
  // It picks which nodes survive the cut and nothing else: on a case that fits, it
  // changed nothing on screen and read as a sort order.
  await openGraph(page);
  await expect(page.getByLabel('Lens')).toBeVisible();
  await expect(page.getByLabel('Ranking')).toHaveCount(0);
});

test('offers the ordering once the case is too large to draw whole', async ({ page }) => {
  await openGraph(page, {
    graph: {
      lens: 'all',
      order: 'degree',
      nodes: [
        { id: 'a', type: 'person', label: 'Hub', family: 'actor', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 0 },
      ],
      links: [],
      total: 900,
      shown: 1,
      truncated: true,
      isolated: 1,
    },
  });
  await expect(page.getByLabel('Ranking')).toBeVisible();
  // And the count says the case was cut, rather than presenting a slice as whole.
  await expect(page.locator('.count em')).toContainText('most connected');
});

/** A canvas is unreachable from the keyboard, so Find is how a node is picked. */
/** Where a node sits on screen, found through the search field rather than by eye. */
async function nodeAt(page, name) {
  // The toolbar mounts before the initial case read. Typing during that seam is
  // correctly cleared when the case boundary lands, so wait for the drawing that
  // owns the search before using it.
  await drawn(page);
  await page.getByLabel('Find a node').fill(name);
  await page.locator('.found button').first().click();
  // `jumpTo` brings the chosen node to the middle of the canvas.
  const box = await canvasBox(page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Right-click a node, which is where its acts are named. */
async function openMenu(page, name) {
  const at = await nodeAt(page, name);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.locator('.menu')).toBeVisible();
}

/** Left-click a node, for the click that names the far end of a connection. */
async function clickNode(page, name) {
  const at = await nodeAt(page, name);
  await page.mouse.click(at.x, at.y);
}

/**
 * A case whose hub holds more connections of one kind than the panel lists at once.
 *
 * The default fixture is small on purpose, and a group that fits is a group that
 * never asks. Built here rather than added to the fixture: it is one spec's question.
 */
function hubCase(count) {
  const nodes = [
    { id: 'org-1', type: 'organization', label: '3rd Battalion', family: 'actor', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: count },
  ];
  const links = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({ id: `veh-${i}`, type: 'vehicle', label: `BTR ${i}`, family: 'asset', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 1 });
    links.push({
      id: `l-${i}`,
      from: 'org-1',
      to: `veh-${i}`,
      type: 'owns',
      provenance: { by: 'user', at: '2026-08-02T09:00:00Z', status: 'confirmed' },
    });
  }
  return {
    lens: 'all', order: 'degree', nodes, links,
    total: nodes.length, shown: nodes.length, truncated: false,
    expanded: [], isolated: 0, pinned: 0,
  };
}

/**
 * A case whose hop-1 node carries more connections than the walk reached.
 *
 * The default fixture's degrees match its edges exactly, so nothing there is ever
 * out of reach — which is the one state this spec is about. Served for both graph
 * reads, since the fixture overrides them together.
 */
function reachCase() {
  return {
    lens: 'all', order: 'degree', root: 'org-1', hops: 1,
    nodes: [
      { id: 'org-1', type: 'organization', label: '3rd Battalion', family: 'actor', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 1, hop: 0 },
      { id: 'acc-1', type: 'account', label: '@harbourwatch', family: 'identifier', status: 'confirmed', at: '2026-08-02T08:00:00Z', degree: 4, hop: 1 },
    ],
    links: [
      { id: 'l-3', from: 'org-1', to: 'acc-1', type: 'owns', provenance: { by: 'user', at: '2026-08-02T09:10:00Z', status: 'confirmed' } },
    ],
    total: 2, shown: 2, truncated: false, expanded: [], isolated: 0, pinned: 0,
  };
}

async function pick(page, name) {
  // The toolbar is interactive before the initial case read has claimed the
  // workspace. Wait for that drawing so the case reset cannot clear this query.
  await drawn(page);
  await page.getByLabel('Find a node').fill(name);
  await page.locator('.found button').first().click();
  await expect(page.locator('.panel')).toBeVisible();
}

test('a node can be found by name, which is the only way in without a mouse', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'harbourwatch');
  await expect(page.locator('.panel')).toContainText('@harbourwatch');
});

test('a typed name lights the drawing instead of thinning it', async ({ page }) => {
  // Only a browser can show this one: the claim is that the picture still holds as
  // much drawing after the search as before it. A filter would have answered the
  // same question by removing the rest, and taken the shape the analyst was holding
  // their place with along with it.
  await openGraph(page);
  await drawn(page);
  const whole = await ink(page);

  await page.getByLabel('Find a node').fill('harbour');
  await expect(page.getByText('2 matches')).toBeVisible();
  // Dimmed, never dropped: the far context is still on the canvas.
  await expect.poll(() => ink(page)).toBeGreaterThan(whole * 0.85);

  // Emptying the field hands the case back exactly as it was: the layout is a pure
  // function of the payload, and a search never touched the payload.
  await page.getByLabel('Find a node').fill('');
  await expect(page.getByText('2 matches')).toHaveCount(0);
  await expect.poll(() => ink(page)).toBeGreaterThan(whole * 0.98);
});

test('the list steps out of the way of the case, and comes back', async ({ page }) => {
  // With the matches lit, the canvas is what gets read next — and the list sits on
  // top of it, over the nodes the search just pointed at.
  await openGraph(page);
  await drawn(page);
  await page.getByLabel('Find a node').fill('harbour');
  await expect(page.locator('.found')).toBeVisible();

  const box = await canvasBox(page);
  await page.mouse.click(box.x + 20, box.y + 20);
  await expect(page.locator('.found')).toHaveCount(0);
  // The search itself is untouched: what is lit is what the analyst is reading.
  await expect(page.getByLabel('Find a node')).toHaveValue('harbour');
  await expect(page.getByText('2 matches')).toBeVisible();

  await page.getByLabel('Find a node').click();
  await expect(page.locator('.found')).toBeVisible();
});

test('Escape gives the search up whole, list and highlight together', async ({ page }) => {
  await openGraph(page);
  await page.getByLabel('Find a node').fill('harbour');
  await expect(page.getByText('2 matches')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Find a node')).toHaveValue('');
  await expect(page.locator('.found')).toHaveCount(0);
  await expect(page.getByText('2 matches')).toHaveCount(0);
});

test('tells a name the picture does not hold from one the case does not', async ({ page }) => {
  await openGraph(page);
  await drawn(page);
  await page.getByLabel('Find a node').fill('nothing here at all');
  await expect(page.getByText('no match drawn')).toBeVisible();
  // A count, not a verdict: the case's own answer to the name is the list's to give.
  await expect(canvas(page)).toBeVisible();
});

test('a node stays read while a search runs the picture', async ({ page }) => {
  // Which of the two narrows the drawing is asserted on the source; what a browser
  // adds is that the selection is not thrown away to settle it. A click still rings
  // its node and opens its panel — it just stops being the question on screen.
  await openGraph(page);
  await pick(page, '3rd Battalion');
  await expect(page.locator('.panel')).toContainText('3rd Battalion');

  await page.getByLabel('Find a node').fill('harbour');
  await expect(page.getByText('2 matches')).toBeVisible();
  await expect(page.locator('.panel')).toContainText('3rd Battalion');
});

test('finds an entity the drawing does not hold, and brings it in', async ({ page }) => {
  // A view is bounded, so on a case larger than the budget most of it is not drawn —
  // and a search reading only the drawing answered "no such entity" for entities the
  // case plainly holds. Nothing told "not in the case" from "not in this picture".
  await openGraph(page);
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();

  await page.getByLabel('Find a node').fill('harbour frame');
  const row = page.locator('.found .afar');
  await expect(row).toContainText('harbour frame');
  await expect(row).toContainText('bring in');

  // Brought in through `expand`, which keeps a named node whatever the narrowing
  // would have done with it, and selected so it is not just somewhere on screen.
  await row.click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(page.locator('.panel')).toContainText('harbour frame');
});

test('the panel reads an edge as a sentence, inverse wording included', async ({ page }) => {
  await openGraph(page);
  await pick(page, '3rd Battalion');
  const panel = page.locator('.panel');
  // Outgoing reads forward, incoming reads with the registry's inverse: the unit
  // owns the vehicle, and the person filed as "is a member of" reads back as one.
  await expect(panel).toContainText('owns');
  await expect(panel).toContainText('has member');
  await expect(panel.locator('.verb').first()).not.toHaveText(/^[a-z]+-[a-z]+$/);
});

test('the panel groups connections by what they say, biggest group first', async ({ page }) => {
  await openGraph(page);
  await pick(page, '3rd Battalion');
  const groups = page.locator('.panel .group');
  // Two verbs owned by this node: it owns two things and has one member. The verb
  // is said once over its rows rather than repeated on each of them.
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('owns');
  await expect(groups.nth(0)).toContainText('2');
  await expect(groups.nth(1)).toContainText('has member');
});

test('hovering a row singles out the edge it stands for', async ({ page }) => {
  // The row and the line are the same connection, and this is the only way to see
  // which line a row means on a node with twelve of them. Selecting a node already
  // lit every one of its edges and wrote every verb, so the drawing has to *narrow*
  // to one — otherwise the answer to "which line is this row" was "all of them".
  await openGraph(page);
  await pick(page, '3rd Battalion');
  await drawn(page);
  const lit = await ink(page);

  await page.locator('.panel .link-row', { hasText: 'BTR-82A 4721' }).hover();
  await expect.poll(() => ink(page)).not.toBeCloseTo(lit, 4);

  // And the node is read whole again the moment the pointer leaves the row.
  await page.locator('.panel header').hover();
  await expect.poll(() => ink(page)).toBeCloseTo(lit, 4);
});

test('a row is followed to the node it names', async ({ page }) => {
  // Whether the view stayed put is asserted on the source: selecting a node changes
  // what is lit, so the canvas measure cannot tell a pan from a new selection.
  await openGraph(page);
  await pick(page, '3rd Battalion');

  await page.locator('.panel .link-row', { hasText: 'BTR-82A 4721' }).click();
  await expect(page.locator('.panel header')).toContainText('BTR-82A 4721');
  // And the connection reads back the other way round, from the vehicle's side.
  await expect(page.locator('.panel .verb').first()).toContainText('is owned by');
});

test('a long group is asked for before it is listed', async ({ page }) => {
  await openGraph(page, { graph: hubCase(12) });
  await pick(page, '3rd Battalion');
  const rows = page.locator('.panel .link-row:not(.rest)');
  await expect(rows).toHaveCount(8);
  await expect(page.locator('.panel .group')).toContainText('12');

  await page.getByRole('button', { name: 'Show all 12' }).click();
  await expect(rows).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Show all 12' })).toHaveCount(0);
});

test('the panel counts the connections the drawing does not hold', async ({ page }) => {
  // The hole this closes: the list is built from the edges on screen, so this
  // account read as connected to nothing while the case held a connection for it.
  await openGraph(page);
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();

  await pick(page, 'harbourwatch');
  const panel = page.locator('.panel');
  await expect(panel).toContainText('1 more not drawn');
  await expect(panel).not.toContainText('Nothing connects to this');

  // The same switch as the one on the node, in words: the canvas answers a pointer,
  // and the keyboard has to reach the drawing too.
  await panel.getByRole('button', { name: /^Expand \(1\)/ }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(panel).toContainText('posted');
});

test('the focus says what it is on, and offers a reach', async ({ page }) => {
  await openGraph(page);
  await expect(page.locator('.focus')).toHaveCount(0);

  await pick(page, 'Section chief');
  const focus = page.locator('.focus');
  await expect(focus).toContainText('Section chief');
  await expect(focus.getByRole('button', { name: '1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // And it leaves with the node it is about.
  await page.keyboard.press('Escape');
  await expect(focus).toHaveCount(0);
});

test('a wider reach lights more of the case', async ({ page }) => {
  // Only a browser can answer this: the claim is that the second ring is already in
  // the payload, so asking for it costs no read and shows more of the same drawing.
  // The section chief touches the battalion, which touches a vehicle and an account,
  // which posted a frame — one node further out at each of the three reaches.
  await openGraph(page);
  await pick(page, 'Section chief');
  await drawn(page);
  const one = await ink(page);

  await page.locator('.focus').getByRole('button', { name: '2', exact: true }).click();
  await expect.poll(() => ink(page)).toBeGreaterThan(one);
  const two = await ink(page);

  await page.locator('.focus').getByRole('button', { name: '3', exact: true }).click();
  await expect.poll(() => ink(page)).toBeGreaterThan(two);
});

test('the reach answers to the keys beside the one that fits the case', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'Section chief');
  const focus = page.locator('.focus');

  await page.keyboard.press('3');
  await expect(focus.getByRole('button', { name: '3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('1');
  await expect(focus.getByRole('button', { name: '1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the reach keys stay out of a field being typed into', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'Section chief');
  await page.getByLabel('Find a node').fill('2');
  await expect(page.getByLabel('Find a node')).toHaveValue('2');
  await expect(
    page.locator('.focus').getByRole('button', { name: '1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('only this takes the rest of the case off the screen and gives it back', async ({ page }) => {
  // The claim a source test cannot make: that the drawing actually loses the nodes,
  // and that switching back puts the picture where it was rather than re-arranging
  // it. The layout is never touched, so the second measure has to match the first.
  await openGraph(page);
  await pick(page, 'Section chief');
  await drawn(page);
  const whole = await ink(page);

  await page.getByRole('button', { name: 'Only this' }).click();
  await expect.poll(() => ink(page)).toBeLessThan(whole);

  await page.getByRole('button', { name: 'Only this' }).click();
  await expect.poll(() => ink(page)).toBeCloseTo(whole, 3);
});

test('a search outranks the hiding, so its matches are not stranded', async ({ page }) => {
  // An edge is drawn only when both ends survive, so hiding everything outside the
  // matches would answer a search with a scatter of unconnected dots.
  await openGraph(page);
  await pick(page, 'Section chief');
  await drawn(page);
  const whole = await ink(page);

  await page.getByRole('button', { name: 'Only this' }).click();
  await expect.poll(() => ink(page)).toBeLessThan(whole);

  await page.getByLabel('Find a node').fill('BTR');
  await expect(page.getByText('1 match')).toBeVisible();
  await expect.poll(() => ink(page)).toBeGreaterThan(whole * 0.9);
});

test('escape gives the case back before it gives the node up', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'Section chief');
  await page.getByRole('button', { name: 'Only this' }).click();
  await expect(page.getByRole('button', { name: 'Only this' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Only this' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('.panel')).toContainText('Section chief');

  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);
});

/**
 * A case where two equally short routes join the same two entities.
 *
 * The shape that matters on a real case: one place reached through two different
 * media, which is the difference between two sources and one repeated.
 */
function tiedCase() {
  const nodes = [
    { id: 'per-1', type: 'person', label: 'Section chief', family: 'actor', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 2 },
    { id: 'med-1', type: 'media', label: 'first frame', family: 'collected', status: 'confirmed', at: '2026-08-01T09:30:00Z', degree: 2, kind: 'image' },
    { id: 'med-2', type: 'media', label: 'second frame', family: 'collected', status: 'confirmed', at: '2026-08-01T09:40:00Z', degree: 2, kind: 'image' },
    { id: 'plc-1', type: 'place', label: 'checkpoint north', family: 'place', status: 'confirmed', at: '2026-08-02T09:00:00Z', degree: 2 },
  ];
  const links = [
    { id: 'l-1', from: 'med-1', to: 'per-1', type: 'depicts', provenance: { by: 'user', at: '2026-08-02T09:00:00Z', status: 'confirmed' } },
    { id: 'l-2', from: 'med-2', to: 'per-1', type: 'depicts', provenance: { by: 'user', at: '2026-08-02T09:01:00Z', status: 'confirmed' } },
    { id: 'l-3', from: 'med-1', to: 'plc-1', type: 'located-at', provenance: { by: 'user', at: '2026-08-02T09:02:00Z', status: 'confirmed' } },
    { id: 'l-4', from: 'med-2', to: 'plc-1', type: 'located-at', provenance: { by: 'user', at: '2026-08-02T09:03:00Z', status: 'confirmed' } },
  ];
  return {
    lens: 'all', order: 'degree', nodes, links,
    total: 4, shown: 4, truncated: false, expanded: [], isolated: 0, pinned: 0,
  };
}

/** Arm the hand-walk on a node, which becomes its first step. */
async function trace(page, name) {
  await openMenu(page, name);
  await page.getByRole('button', { name: 'Walk by hand' }).click();
  await expect(page.locator('.walk')).toBeVisible();
}

/** Arm the question on a node, and wait for the other end to be named. */
async function askFrom(page, name) {
  await pick(page, name);
  await page.getByRole('button', { name: 'Path to…' }).click();
  await expect(page.locator('.walk')).toContainText('Click the other end');
}

const steps = (page) => page.locator('.said-path .node');

test('a path is walked one connection at a time', async ({ page }) => {
  await openGraph(page);
  await trace(page, 'Section chief');
  await expect(steps(page)).toHaveCount(1);
  await expect(page.locator('.walk')).toContainText('Click a lit node');

  // The rows of the panel are neighbours of the node the path ends on, so each one
  // is a legal step — and it is what makes the walk reachable without a mouse.
  await page.locator('.panel .link-row', { hasText: '3rd Battalion' }).click();
  await expect(steps(page)).toHaveCount(2);
  await expect(page.locator('.walk')).toContainText('1 hop');

  await page.locator('.panel .link-row', { hasText: 'BTR-82A 4721' }).click();
  await expect(steps(page)).toHaveCount(3);
  await expect(page.locator('.walk')).toContainText('2 hops');
});

test('the sentence names the verb of each step, the way the case states it', async ({ page }) => {
  // A drawing says these are joined; a sentence says what the joining is. And the
  // battalion owns the vehicle, where the person is a member of the battalion — so
  // walking from the battalion to the person reads against the arrow.
  await openGraph(page);
  await trace(page, '3rd Battalion');
  await page.locator('.panel .link-row', { hasText: 'BTR-82A 4721' }).click();
  await expect(page.locator('.said-path .verb')).toContainText('owns');

  // Walked the other way, the same edge takes the registry's inverse wording, so the
  // sentence still reads left to right. Written as the plain verb with a reversed
  // arrow it read "A <- made from B", which has to be walked backwards to be
  // understood — and every step of a long path compounds that.
  await page.getByRole('button', { name: 'Give the walk up (Esc)' }).click();
  await trace(page, '3rd Battalion');
  await page.locator('.panel .link-row', { hasText: 'Section chief' }).click();
  await expect(page.locator('.said-path .verb')).toContainText('has member');
});

test('a node the path cannot reach is not offered as a step', async ({ page }) => {
  // The whole reason the gesture is armed: unarmed, a click on a non-neighbour has
  // only bad answers. Armed, no such click exists — the vehicle is two hops from the
  // section chief, so nothing on screen offers it and the empty space does nothing.
  await openGraph(page);
  await trace(page, 'Section chief');
  const rows = page.locator('.panel .link-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('3rd Battalion');

  const box = await canvasBox(page);
  await page.mouse.click(box.x + 12, box.y + box.height - 12);
  await expect(steps(page)).toHaveCount(1);
  await expect(page.locator('.walk')).toContainText('Click a lit node');
});

test('a step already taken is walked back onto rather than looped through', async ({ page }) => {
  await openGraph(page);
  await trace(page, 'Section chief');
  await page.locator('.panel .link-row', { hasText: '3rd Battalion' }).click();
  await page.locator('.panel .link-row', { hasText: 'BTR-82A 4721' }).click();
  await expect(steps(page)).toHaveCount(3);

  // The way back is on the sentence, where the path is already being read.
  await page.locator('.said-path .node', { hasText: '3rd Battalion' }).click();
  await expect(steps(page)).toHaveCount(2);
  await expect(page.locator('.said-path')).not.toContainText('BTR-82A 4721');
});

test('the walk narrows the drawing to itself and what it can reach', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'Section chief');
  await drawn(page);
  const before = await ink(page);

  await page.getByRole('button', { name: 'Path to…' }).click();
  await page.locator('.panel .link-row', { hasText: '3rd Battalion' }).click();
  await expect.poll(() => ink(page)).not.toBeCloseTo(before, 4);

  // And the case comes back whole when the walk is given up.
  await page.keyboard.press('Escape');
  await expect(page.locator('.walk')).toHaveCount(0);
  await expect(page.locator('.focus')).toBeVisible();
});

test('escape gives the walk up whole, as it drops a half-drawn relation', async ({ page }) => {
  // Keeping the steps taken would leave a path on screen that nothing is building.
  await openGraph(page);
  await trace(page, 'Section chief');
  await page.locator('.panel .link-row', { hasText: '3rd Battalion' }).click();
  await expect(steps(page)).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(page.locator('.walk')).toHaveCount(0);
  await expect(page.locator('.said-path')).toHaveCount(0);
});

test('two nodes are named and the case finds the way between them', async ({ page }) => {
  // The question the tool existed without, and the common one: the section chief
  // reaches the frame in three hops, through the battalion and the account it owns.
  // The far end is clicked here, which is the case a search cannot cover on a small
  // view and the one an analyst reaches for first.
  // Named rather than clicked here: the helper that finds a node on the canvas goes
  // through the search, which an armed question rightly consumes as the answer. That
  // a canvas click means the same thing is carried by the source test.
  await openGraph(page);
  await askFrom(page, 'Section chief');
  await page.getByLabel('Find a node').fill('harbour frame');
  await page.locator('.found button').first().click();

  await expect(steps(page)).toHaveCount(4);
  await expect(page.locator('.walk')).toContainText('3 hops');
  await expect(page.locator('.said-path')).toContainText('@harbourwatch');
  // And an answered route is walked back through like a hand-walked one, which is
  // what makes it a place to keep working rather than a result.
  await page.locator('.said-path .node', { hasText: '3rd Battalion' }).click();
  await expect(steps(page)).toHaveCount(2);
});

test('a panel row names the other end, so the question is not mouse-only', async ({ page }) => {
  // An armed gesture owns every way of pointing at a node, or the keyboard is left
  // out of the one act a canvas cannot offer it.
  await openGraph(page);
  await askFrom(page, 'Section chief');
  await page.locator('.panel .link-row', { hasText: '3rd Battalion' }).click();

  await expect(steps(page)).toHaveCount(2);
  await expect(page.locator('.walk')).toContainText('1 hop');
});

test('no route is an answer rather than a silence', async ({ page }) => {
  // Learning that two entities are not connected is a finding about the case, and
  // the only one nothing else in the tool reports.
  await openGraph(page);
  await askFrom(page, 'Section chief');
  await page.getByLabel('Find a node').fill('nothing.test');
  await page.locator('.found button').first().click();

  await expect(page.locator('.said')).toContainText('No route to that one');
  await expect(page.locator('.said-path')).toHaveCount(0);
});

test('an armed question leaves the whole case pressable', async ({ page }) => {
  // Only a browser can catch this one. The question is armed on a selected node, so
  // the focus fade was still on: the drawing said "only these five can be pressed"
  // over a strip saying click anything. Every node is a legal answer here, because
  // the case is searched rather than the drawing.
  // Measured either side of the arming and not against the untouched case: picking
  // the node pans the view to it, so the two are not the same drawing.
  await openGraph(page);
  await drawn(page);
  await pick(page, 'Section chief');
  const faded = await ink(page);

  await page.getByRole('button', { name: 'Path to…' }).click();
  await expect.poll(() => ink(page)).toBeGreaterThan(faded);
});

test('an armed question is given up before a route already drawn', async ({ page }) => {
  await openGraph(page);
  await askFrom(page, 'Section chief');
  await page.keyboard.press('Escape');
  await expect(page.locator('.walk')).toHaveCount(0);
  await expect(page.locator('.focus')).toBeVisible();
});

test('every route that ties for shortest is drawn, and one is read at a time', async ({ page }) => {
  // Two accounts reaching the same place through two different sources is what
  // independence looks like on a real case, so an answer that drew one of them would
  // hide the finding. The sentence takes them one at a time; the drawing takes all.
  await openGraph(page, { graph: tiedCase() });
  await askFrom(page, 'Section chief');
  await page.getByLabel('Find a node').fill('checkpoint north');
  await page.locator('.found button').first().click();

  await expect(page.locator('.walk .of')).toContainText('1 / 2');
  const first = await page.locator('.said-path').innerText();

  await page.getByRole('button', { name: 'The next equally short route' }).click();
  await expect(page.locator('.walk .of')).toContainText('2 / 2');
  expect(await page.locator('.said-path').innerText()).not.toBe(first);
});

test('the focus is not offered on the root of a neighbourhood', async ({ page }) => {
  // Asking for three hops and being handed a control that greys out two of them
  // contradicts the question the view was opened on.
  await openGraph(page);
  await pick(page, '3rd Battalion');
  await page.getByRole('button', { name: /^Around this/ }).click();
  await expect(page.getByLabel('Hops')).toBeVisible();
  await expect(page.locator('.focus')).toHaveCount(0);
});

test('a neighbourhood says how to reach further rather than offering an expansion', async ({
  page,
}) => {
  // The read behind "Around this" takes no `expand`, so an expansion there is a
  // control that can only appear to do nothing. Hops is the act, and the count says so.
  await openGraph(page, { graph: reachCase() });
  await pick(page, '3rd Battalion');
  await page.getByRole('button', { name: /Around this/ }).click();
  await expect(page.getByLabel('Hops')).toBeVisible();

  await pick(page, 'harbourwatch');
  const panel = page.locator('.panel');
  await expect(panel).toContainText('further than 1 hop');
  await expect(panel.getByRole('button', { name: /^Expand/ })).toHaveCount(0);
});

test('a proposed entity is marked as proposed here too', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'harbourwatch');
  await expect(page.locator('.panel')).toContainText('proposed');
});

test('Escape puts the case back without a reload', async ({ page }) => {
  await openGraph(page);
  await pick(page, '3rd Battalion');

  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);
  await expect(canvas(page)).toBeVisible();
});

test('the empty space pans the drawing', async ({ page }) => {
  // The bug this guards: a draggable Konva group only drags where the pointer hits
  // one of its own shapes, so the empty space did nothing and the canvas could only
  // be moved by grabbing a node.
  await openGraph(page);
  await drawn(page);
  const before = await ink(page);

  await panBy(page, 900, 620);
  const after = await ink(page);
  expect(after).toBeLessThan(before / 2);
});

test('a mouseover does not throw the view back to where it started', async ({ page }) => {
  // The teleport this guards: `rebuild` ends in `restyle`, which reads the hover,
  // so the rebuild effect tracked it and every mouseover reset the transform.
  await openGraph(page);
  await drawn(page);
  await panBy(page, 900, 620);
  const parked = await ink(page);

  const box = await canvasBox(page);
  for (const at of [0.3, 0.5, 0.7]) {
    await page.mouse.move(box.x + box.width * at, box.y + box.height * at);
  }
  expect(Math.abs((await ink(page)) - parked)).toBeLessThan(0.01);
});

test('a lens with nothing to draw still shows every node', async ({ page }) => {
  // Narrowing the verbs must not hide entities: a node with no edge in this lens
  // is an answer, not an omission.
  await openGraph(page);
  await page.getByLabel('Lens').selectOption('ground');
  await expect(page.getByText('7 unconnected')).toBeVisible();
  await expect(canvas(page)).toBeVisible();
});

test('expanding switches to the neighbourhood and offers the way back', async ({ page }) => {
  await openGraph(page);
  await pick(page, '3rd Battalion');
  await page.getByRole('button', { name: /^Around this/ }).click();

  await expect(page.getByRole('button', { name: 'Whole case' })).toBeVisible();
  await expect(page.getByText(/around this/)).toBeVisible();

  await page.getByRole('button', { name: 'Whole case' }).click();
  await expect(page.getByText('7 of 7')).toBeVisible();
});

test('the zoom controls act on the drawing rather than the page', async ({ page }) => {
  await openGraph(page);
  // Measured on the pane, not on the <canvas>: Konva replaces that element whenever
  // it rebuilds the scene, so reading it can land between two layers and find none.
  const pane = page.locator('.canvas-row > .canvas');
  const before = await pane.boundingBox();
  await page.getByTitle('Zoom in (+)').click();
  await page.getByTitle('Fit everything on screen (0)').click();
  const after = await pane.boundingBox();
  // The canvas fills its pane whatever the zoom: zooming must not resize the page.
  // Judged in whole pixels, since what this would catch is the toolbar wrapping to
  // a second line and taking thirty of them off the drawing.
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);
  expect(Math.abs(after.height - before.height)).toBeLessThan(2);
});

test('says where the zoom is, and gets back to the whole case', async ({ page }) => {
  await openGraph(page);
  const level = page.locator('.level');
  const opened = await level.textContent();
  await page.getByTitle('Zoom in (+)').click();
  await expect(level).not.toHaveText(opened);
  await page.getByTitle('Fit everything on screen (0)').click();
  await expect(level).toHaveText(opened);
});

test('a node close up becomes a card with the preview the case already holds', async ({ page }) => {
  // The card is drawn on canvas, so what proves it is the request for the picture:
  // the thumbnail the Media Library uses, never the media file itself.
  await openGraph(page);
  const asked = page.waitForRequest((request) => request.url().includes(GRAPH_THUMB));
  for (let i = 0; i < 6; i += 1) await page.getByTitle('Zoom in (+)').click();
  await asked;
  await expect(page.locator('.level')).toContainText(/1[2-9]\d%|[2-9]\d\d%/);
});

test('the hover card shows the full label, the type and the preview', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'harbour frame');
  // The selection puts the node under the eye; hovering it is what names it.
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.locator('.tip');
  await expect(tip).toContainText('harbour frame');
  await expect(tip).toContainText('connection');
  await expect(tip.locator('img')).toHaveAttribute('src', new RegExp(GRAPH_THUMB));
});

/**
 * Arranging the case by hand.
 *
 * Every one of these only fails in a browser: whether Konva's own drag reaches a
 * shape inside a scaled group, whether the press that starts it also pans the
 * canvas, and whether the spot survives the round trip through the case. Picking a
 * node first is what makes the geometry knowable — Find centres it, so the middle of
 * the canvas is where that node is.
 */
const middle = async (page) => {
  const box = await canvasBox(page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Drag whatever is at `from` to `from + delta`, past the slop a click tolerates. */
async function dragNode(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  // Graph keeps its drag guard through the release click, then clears it on the
  // next frame. A second gesture cannot happen before that frame in real use, so
  // do not let a fast headless runner manufacture that impossible overlap.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/** Leave and come back, so a node already under a still pointer names itself. */
async function hover(page, at) {
  await page.mouse.move(at.x, at.y - 140);
  await page.mouse.move(at.x, at.y);
}

test('a node can be dragged, and the case remembers where', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  const from = await middle(page);

  await dragNode(page, from, 150, -70);

  // It went where it was put: the tooltip is the only thing that can say a canvas
  // node is at a screen position.
  await hover(page, { x: from.x + 150, y: from.y - 70 });
  await expect(page.locator('.tip')).toContainText('BTR-82A 4721');
  await expect(page.getByRole('button', { name: /Reset 1 pin/ })).toBeVisible();

  // And it survives being read back: the lens change reloads the whole view.
  await page.getByLabel('Lens').selectOption('ground');
  await page.getByLabel('Lens').selectOption('all');
  await expect(page.getByRole('button', { name: /Reset 1 pin/ })).toBeVisible();
  await pick(page, 'BTR-82A 4721');
  await expect(page.locator('.panel')).toContainText('You placed this one.');
});

test('files a pending drag in the case where it happened', async ({ page }) => {
  const fixture = await openGraph(page, {
    cases: [
      { id: CASE_ID, name: 'Case A', scratch: false, folders: [] },
      { id: SECOND_CASE, name: 'Case B', scratch: false, folders: [] },
    ],
  });
  await pick(page, 'BTR-82A 4721');
  await dragNode(page, await middle(page), 100, -50);
  // The debounce is still holding the move; the case switch is what flushes it.
  expect(fixture.graphPinWrites).toHaveLength(0);

  await page.getByTitle('Switch case').click();
  await page.locator('.menu .item').filter({ hasText: 'Case B' }).click();
  await expect(page.getByTitle('Switch case')).toContainText('Case B');
  await expect.poll(() => fixture.graphPinWrites.length).toBe(1);
  expect(fixture.graphPinWrites[0]).toMatchObject({
    caseId: CASE_ID,
    body: { lens: 'all', pins: [{ id: 'veh-1' }] },
  });
});

test('dragging a node does not also select it, nor pan the case', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  const from = await middle(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel')).toHaveCount(0);

  await dragNode(page, from, 120, 60);

  // The click that ends a drag must not open the panel — and the press must not have
  // reached the container's pan, which would move the node and the case at once.
  await expect(page.locator('.panel')).toHaveCount(0);
  await hover(page, { x: from.x + 120, y: from.y + 60 });
  await expect(page.locator('.tip')).toContainText('BTR-82A 4721');
});

test('a node is still selectable after the case has been panned', async ({ page }) => {
  // The bug this guards: a node's press is stopped from reaching the container so it
  // does not also pan, and the container's handler is what clears the "this click
  // ended a pan" flag. Left set, it swallowed every later click on a node.
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  const from = await middle(page);
  await page.keyboard.press('Escape');
  await panBy(page, 60, 40);

  await page.mouse.click(from.x + 60, from.y + 40);

  await expect(page.locator('.panel')).toContainText('BTR-82A 4721');
});

test('one node can be handed back, and so can the whole arrangement', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  await dragNode(page, await middle(page), 140, -60);
  await pick(page, 'BTR-82A 4721');

  await page.getByRole('button', { name: 'Let it go' }).click();
  await expect(page.getByRole('button', { name: /Reset .* pin/ })).toHaveCount(0);

  // And the toolbar drops every pin at once, which is the way out of an autosave.
  await pick(page, 'Section chief');
  await dragNode(page, await middle(page), -130, 80);
  await page.getByRole('button', { name: /Reset 1 pin/ }).click();
  await expect(page.getByRole('button', { name: /Reset .* pin/ })).toHaveCount(0);
});

test('ctrl-click gathers a handful and one drag moves all of it', async ({ page }) => {
  await openGraph(page);
  // Two nodes, each brought under the eye in turn so its screen position is known.
  await pick(page, 'BTR-82A 4721');
  const centre = await middle(page);
  await page.keyboard.press('Escape');
  // Move the first one off the middle, then gather both.
  await dragNode(page, centre, -180, 120);
  const first = { x: centre.x - 180, y: centre.y + 120 };
  await page.keyboard.down('Control');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: /1 held/ })).toBeVisible();

  await pick(page, 'Section chief');
  const second = await middle(page);
  await page.keyboard.down('Control');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: /2 held/ })).toBeVisible();

  // Dragging one of them files both: two pins from one gesture is the whole point.
  await dragNode(page, second, 100, -60);

  await hover(page, { x: second.x + 100, y: second.y - 60 });
  await expect(page.locator('.tip')).toContainText('Section chief');
  await expect(page.getByRole('button', { name: /Reset 2 pins/ })).toBeVisible();
});

test('a handful is let go without touching the arrangement', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  const centre = await middle(page);
  await page.keyboard.down('Control');
  await page.mouse.click(centre.x, centre.y);
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: /1 held/ })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: /held/ })).toHaveCount(0);
  // Escape released the handful, not the selection: the shallower thing goes first.
  await expect(page.locator('.panel')).toContainText('BTR-82A 4721');
});

test('each lens keeps its own arrangement', async ({ page }) => {
  // A lens draws its own nodes and edges and clusters them its own way, so an
  // arrangement built in one must not anchor the reading in another.
  await openGraph(page);
  await pick(page, 'BTR-82A 4721');
  await dragNode(page, await middle(page), 130, -80);
  await expect(page.getByRole('button', { name: /Reset 1 pin/ })).toBeVisible();

  await page.getByLabel('Lens').selectOption('subjects');

  await expect(page.getByRole('button', { name: /Reset .* pin/ })).toHaveCount(0);
  await page.getByLabel('Lens').selectOption('all');
  await expect(page.getByRole('button', { name: /Reset 1 pin/ })).toBeVisible();
});

test('the arrangement is reachable from the keyboard, which a canvas is not', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'Section chief');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');

  await expect(page.getByRole('button', { name: /Reset 1 pin/ })).toBeVisible();
});

test('typing in Find drives the field, not the drawing', async ({ page }) => {
  // The guard this covers: window-level keys meant for the canvas used to fire while
  // the search field had focus, so an arrow key moved a node instead of the cursor.
  await openGraph(page);
  await pick(page, 'Section chief');
  await page.getByLabel('Find a node').fill('BTR');
  await page.getByLabel('Find a node').press('ArrowRight');

  await expect(page.getByRole('button', { name: /Reset .* pin/ })).toHaveCount(0);
});

test('a neighbourhood is not arranged by hand, since its axis means something', async ({ page }) => {
  await openGraph(page);
  await pick(page, '3rd Battalion');
  await page.getByRole('button', { name: /^Around this/ }).click();
  await expect(page.getByRole('button', { name: 'Whole case' })).toBeVisible();

  // Scoped to the drawing surface: the workspace's own <main> carries that class too.
  await expect(page.locator('.canvas-row > .canvas')).not.toHaveClass(/arrangeable/);
});

test('a media node says what it holds, not just that it is media', async ({ page }) => {
  await openGraph(page);
  await pick(page, 'harbour frame');

  // The panel and the tooltip both name the bytes: one `media` type covers images,
  // video and audio, so "Media" answers a question nobody asked.
  await expect(page.locator('.panel')).toContainText('Image');
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.tip')).toContainText('Image');
});

test('previews can be turned off, and then nothing asks for a picture', async ({ page }) => {
  await openGraph(page);
  const asked = [];
  page.on('request', (request) => {
    if (request.url().includes(GRAPH_THUMB)) asked.push(request.url());
  });

  await page.getByLabel('Preview').uncheck();
  // Close enough for cards, which is the only zoom that ever wants a thumbnail.
  for (let i = 0; i < 6; i += 1) await page.getByTitle('Zoom in (+)').click();
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);

  // And back on, the picture the case already holds is asked for.
  const wanted = page.waitForRequest((request) => request.url().includes(GRAPH_THUMB));
  await page.getByLabel('Preview').check();
  await wanted;
});

test('says so when the case is empty rather than drawing nothing in silence', async ({ page }) => {
  await openGraph(page, {
    graph: { lens: 'all', order: 'degree', nodes: [], links: [], total: 0, shown: 0, truncated: false, isolated: 0 },
  });
  await expect(page.getByText(/Nothing here yet/)).toBeVisible();
});

// -- an edge that stands for several -----------------------------------------

/**
 * The drawing after a collapse, as `engine/graph.view` answers it: the three bookmarks
 * are the edge now. Handed to the tool rather than folded here — the fold itself is
 * proven in `tests/test_graph.py`, and a fixture that reimplemented it would prove the
 * reimplementation.
 */
const foldedCase = {
  lens: 'all',
  order: 'degree',
  nodes: [
    { id: 'clm-1', type: 'claim', label: 'Shot at the quay', family: 'claim', status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: 1, rests: { sources: 3, accounts: 1, one: true } },
    { id: 'acc-9', type: 'account', label: '@harbourwatch', family: 'identifier', status: 'confirmed', at: '2026-08-01T09:10:00Z', degree: 1 },
  ],
  links: [
    {
      id: 'folded:cites:clm-1:acc-9',
      from: 'clm-1',
      to: 'acc-9',
      type: 'cites',
      folded: { sources: 3, via: ['bookmark'], accounts: 1, open: ['bm-1', 'bm-2', 'bm-3'] },
      provenance: { by: 'graph', at: '2026-08-02T09:00:00Z', status: 'confirmed' },
    },
  ],
  total: 2,
  shown: 2,
  truncated: false,
  isolated: 0,
  single_account: 1,
};

/**
 * Click the one edge of a two-node drawing.
 *
 * The view opens fitted, and with two nodes the fit centres their bounding box — whose
 * centre is the midpoint of the segment between them. So the middle of the canvas is
 * the line, which is also the only thing there: the nodes are at the two ends.
 */
async function clickTheEdge(page) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.panel')).toBeVisible();
}

test('an edge that folded three citations says so and hands them back', async ({ page }) => {
  // The finding the case could not state: three citations are not three sources when
  // one account published all three.
  const fixture = await openGraph(page, { graph: foldedCase });
  await drawn(page);

  await expect(page.getByText('1 on one account')).toBeVisible();

  // The edge is read before anything moves the view: picking a node recentres on it,
  // and the middle of the canvas is the line only while the drawing sits as it opened.
  await clickTheEdge(page);
  await expect(page.locator('.panel')).toContainText('3 bookmarks · 1 account, drawn as one edge');
  // Nothing may be written to it: the case has no such row, so the panel offers no act
  // it would then refuse.
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);

  // And it hands back what it stands for through the one mechanism for it: named, not
  // opened, so a source arrives as itself rather than with everything else it touches.
  const asked = page.waitForRequest((request) => request.url().includes('keep=bm-1'));
  await page.getByRole('button', { name: 'Show the 3 sources' }).click();
  await asked;
  expect(fixture.linkWrites).toEqual([]);

  // The statement says the same thing in words, where it is read.
  await pick(page, 'Shot at the quay');
  await expect(page.locator('.panel')).toContainText('Rests on 3 sources · 1 account');
  await expect(page.locator('.panel')).toContainText('all one account');
});

test('the number of statements on one account is pressed to reach them', async ({ page }) => {
  // A count that names a set and gives no way to it sends the analyst opening
  // statements one at a time to find out which ones it meant.
  await openGraph(page, { graph: foldedCase });
  await drawn(page);

  const number = page.getByRole('button', { name: '1 on one account' });
  await expect(number).toHaveAttribute('aria-pressed', 'false');
  await expect(number).toHaveAttribute('title', /one account published every one of them/);

  // A typed name outranks the question, so asking it gives the name up rather than
  // answering the press with an unchanged picture.
  await page.getByLabel('Find a node').fill('harbour');
  await number.click();
  await expect(page.getByLabel('Find a node')).toHaveValue('');
  await expect(number).toHaveAttribute('aria-pressed', 'true');
  await expect(number).toHaveAttribute('title', /Click again to bring the rest/);

  // And it costs one click to ask again, so Escape lets it go before the handful.
  await page.keyboard.press('Escape');
  await expect(number).toHaveAttribute('aria-pressed', 'false');
});

test('a fold this reading cannot hand back names the lens that draws it', async ({ page }) => {
  // The safeguard's fold: an import filed a source under a type meant for the
  // analyst's own output, so the shape collapsed it rather than dropping it — and there
  // is no node to bring back into a reading that does not draw notes at all.
  await openGraph(page, {
    graph: {
      ...foldedCase,
      single_account: 0,
      nodes: foldedCase.nodes.map((node) => (node.rests ? { ...node, rests: undefined } : node)),
      links: [
        {
          ...foldedCase.links[0],
          folded: { sources: 1, via: ['note'], accounts: 0 },
        },
      ],
    },
  });

  await drawn(page);
  await clickTheEdge(page);

  await expect(page.locator('.panel')).toContainText('note, drawn as one edge');
  await expect(page.locator('.panel')).toContainText('My work draws note.');
  await expect(page.getByRole('button', { name: /^Show the/ })).toHaveCount(0);
});

// -- growing the view --------------------------------------------------------

test('opening a node keeps the case on screen instead of replacing it', async ({ page }) => {
  // The gesture the whole tool turns on. Replacing the view answered the question
  // and lost the case it was asked about.
  await openGraph(page, { graph: null });
  // Switched off so the account has a neighbour that is not drawn: on a whole case
  // every one of them already is, and there is nothing to open.
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();

  await openMenu(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Expand 1 more connection/ }).click();

  // The media was switched off and is here only because the node was opened.
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.getByLabel('Find a node').fill('harbour frame');
  await expect(page.locator('.found button').first()).toBeVisible();
});

test('opening a node leaves everything already drawn exactly where it is', async ({ page }) => {
  // What the whole case used to do on every click: re-run the relaxation over all of
  // it, so every node slid to a new resting place while the analyst was reading it.
  // Measured in ink, because the DOM says nothing about where a node sits.
  await openGraph(page, { graph: null });
  await drawn(page);
  // Switched off so the account has a neighbour that is not drawn: on a whole case
  // every one of them already is, and there is nothing to open.
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();

  // The ink is kept **after** the node is picked, because picking one from the search
  // brings it to the middle of the canvas: that moves the camera, and this spec is
  // about the layout. Everything after this point leaves the view where it is.
  const at = await nodeAt(page, 'harbourwatch');
  await page.getByLabel('Find a node').fill('');
  await drawn(page);
  await keepInk(page);

  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.locator('.menu')).toBeVisible();
  await page.getByRole('button', { name: /^Expand 1 more connection/ }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await drawn(page);

  // Not "roughly the same picture": every node is where it was, so every pixel that
  // was drawn is still drawn. What the arrival adds is deliberately not counted.
  // Without the drawing being held, this reads 0.96 — the whole case moves.
  expect(await inkLost(page)).toBeLessThan(0.05);
});

test('the whole picture is put back by one control, not one per list', async ({ page }) => {
  await openGraph(page);
  await drawn(page);
  // Narrowed so the account has a neighbour that is not drawn; on a whole case every
  // one of them already is, and there is nothing to bring in.
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await openMenu(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Expand \d+ more connection/ }).click();
  await expect(page.getByText('7 of 6')).toBeVisible();

  await page.getByRole('button', { name: 'Reset view' }).click();

  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
  // Back to the narrowing it was expanded from, not to the whole case: the reset
  // undoes the edits and leaves the reading alone.
  await expect(page.getByText('6 of 6')).toBeVisible();
});

test('any node is taken out of the drawing, and put back', async ({ page }) => {
  // The way back out of a crowded drawing used to be folding every expansion, which
  // takes the reading that raised the question down with it.
  await openGraph(page);
  await drawn(page);
  await expect(page.getByText('7 of 7')).toBeVisible();

  await pick(page, 'BTR-82A 4721');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();

  // One node fewer drawn, and the case still holds all seven: nothing was deleted.
  await expect(page.getByText('6 of 7')).toBeVisible();
  // And the node being read went with the picture, rather than being left on a panel
  // pointing at nothing.
  await expect(page.locator('.panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset view' }).click();

  await expect(page.getByText('7 of 7')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
});

test('the last change to the drawing is taken back, and put again', async ({ page }) => {
  // Only a browser answers this one: the claim is that the history follows the
  // drawing's own state, so an act nobody wired into it is undone all the same.
  await openGraph(page);
  await drawn(page);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await pick(page, 'BTR-82A 4721');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('7 of 7')).toBeVisible();
  // Nothing was deleted and nothing is left edited, so the blunt way back goes too.
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();
});

test('the chord undoes the drawing, and a typed field keeps its own', async ({ page }) => {
  await openGraph(page);
  await drawn(page);
  await pick(page, 'BTR-82A 4721');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByText('7 of 7')).toBeVisible();

  // A field being typed into owns its own undo: the drawing must not move under it.
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();
  const find = page.getByLabel('Find a node');
  await find.fill('harbour');
  await find.press('Control+z');
  await expect(page.getByText('6 of 7')).toBeVisible();
});

test('a node taken out takes what only it was holding', async ({ page }) => {
  // Taking out the node you opened used to leave its whole neighbourhood drawn with no
  // edge to anything — a handful of dots whose one reason to be there had just gone.
  await openGraph(page);
  await drawn(page);
  // Off the ranking, so the frame is in the picture by the expansion alone.
  await page.getByRole('button', { name: /collected/ }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();
  await openMenu(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Expand \d+ more connection/ }).click();
  await expect(page.getByText('7 of 6')).toBeVisible();

  await pick(page, 'harbourwatch');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();

  // Two fewer, not one: the account and the frame it was the only thing holding.
  await expect(page.getByText('5 of 6')).toBeVisible();
  await expect(page.getByText('harbour frame')).toHaveCount(0);

  // And it is one act to undo, whichever of the edits is in the way: the reset puts
  // the expansion back as well, which is why the count reads the narrowing it was
  // all built on top of.
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByText('6 of 6')).toBeVisible();
});

test('what was hidden is offered back by the node it was hanging on', async ({ page }) => {
  // Hiding is the analyst's own act on their own picture, and undoing one node of it
  // used to cost the whole drawing: *Reset view* puts back every edit, and the name of
  // a node you have just decided not to look at is not what you go and type.
  await openGraph(page);
  await drawn(page);

  await pick(page, 'harbour frame');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();

  // The account that posted it counts it as a connection the picture lacks, which is
  // what it now is, and the switch on it hands it straight back.
  await pick(page, 'harbourwatch');
  await expect(page.locator('.panel')).toContainText('1 more not drawn');
  await page.locator('.panel').getByRole('button', { name: /^Expand \(1\)/ }).click();

  await expect(page.getByText('7 of 7')).toBeVisible();
  // Nothing is left over: the drawing is the one the case opened with, so there is no
  // edit left to undo and nothing still offering to bring in what is on screen.
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
  await pick(page, 'harbourwatch');
  await expect(page.locator('.panel')).not.toContainText('more not drawn');
});

test('the way back is the node it left, not every node on screen', async ({ page }) => {
  // A count that prices a click doing nothing is the failure every number in this tool
  // exists to prevent, so only the node that was holding it offers it back.
  await openGraph(page);
  await drawn(page);

  await pick(page, 'harbour frame');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText('6 of 7')).toBeVisible();

  await pick(page, 'Section chief');
  await expect(page.locator('.panel')).not.toContainText('more not drawn');
});

test('a gathered handful is taken out in one act, not one node per read', async ({ page }) => {
  // Growth and removal over a list is the other half of owning the drawing: one
  // question about several nodes is one read.
  await openGraph(page);
  await drawn(page);
  await pick(page, 'BTR-82A 4721');
  const centre = await middle(page);
  await page.keyboard.press('Escape');
  // The first one is moved off the middle so both screen positions are known, exactly
  // as the drag spec gathers its pair.
  await dragNode(page, centre, -180, 120);
  const first = { x: centre.x - 180, y: centre.y + 120 };
  await page.keyboard.down('Control');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: /1 held/ })).toBeVisible();

  await pick(page, 'Section chief');
  const second = await middle(page);
  await page.keyboard.down('Control');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: /2 held/ })).toBeVisible();

  await page.getByRole('button', { name: 'Hide 2' }).click();

  await expect(page.getByText('5 of 7')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  // The handful went with them: a group over nodes that are no longer drawn is a group
  // nobody is still building.
  await expect(page.getByRole('button', { name: /held/ })).toHaveCount(0);
});

/**
 * A drawing large enough that placing it costs something worth saying. Built here
 * rather than seeded: the tool draws it, so the spec has to hand over the nodes.
 */
function heavyCase(count) {
  const nodes = [];
  const links = [];
  for (let i = 0; i < count; i += 1) {
    nodes.push({
      id: `n-${i}`, type: 'person', label: `Person ${i}`, family: 'actor',
      status: 'confirmed', at: '2026-08-01T09:00:00Z', degree: i ? 1 : count - 1,
    });
    if (i) {
      links.push({
        id: `l-${i}`, from: 'n-0', to: `n-${i}`, type: 'knows',
        provenance: { by: 'user', at: '2026-08-02T09:00:00Z', status: 'confirmed' },
      });
    }
  }
  return {
    lens: 'all', order: 'degree', nodes, links,
    total: count, shown: count, truncated: false, expanded: [], isolated: 0, pinned: 0,
  };
}

test('says what a heavy drawing costs instead of refusing to draw one', async ({ page }) => {
  // The ceiling that refused is gone: a limit is the app overruling the analyst about
  // their own picture, and what replaces it is the price of the next change, said.
  await openGraph(page, { graph: heavyCase(1100) });

  const said = page.locator('.count.weight');
  await expect(said).toContainText('heavy drawing');
  await expect(said).toHaveAttribute('title', /costs about a second/);
});

test('draws a case with no ceiling to be full of', async ({ page }) => {
  // Nothing says how full the drawing is, because nothing refuses: the gauge, the
  // greyed control and the refusal in words all went with the budget.
  await openGraph(page, { graph: heavyCase(40) });
  await drawn(page);
  await openMenu(page, 'Person 0');

  await expect(page.getByRole('button', { name: 'The view is full' })).toHaveCount(0);
  await expect(page.locator('.count.weight')).toHaveCount(0);
});

test('folds an arrival away from the node it arrived at, and gives it back', async ({ page }) => {
  // The switch, in its two shrinking states. Folding costs no read: the case still
  // sent the node, the drawing has simply put it away.
  await openGraph(page);
  await drawn(page);
  await expect(page.getByText('7 of 7')).toBeVisible();
  await page.getByRole('button', { name: /collected/ }).click();
  await openMenu(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Expand \d+ more connection/ }).click();
  await expect(page.getByText('7 of 6')).toBeVisible();

  // Folded from the node itself, where it arrived.
  await pick(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Collapse \(1\)/ }).click();

  await expect(page.getByText('6 of 6')).toBeVisible();
  await expect(page.getByRole('button', { name: '1 folded' })).toBeVisible();
  await expect(page.locator('.panel')).toContainText('Holding 1 folded under it');

  await page.getByRole('button', { name: '1 folded' }).click();
  await expect(page.getByText('7 of 6')).toBeVisible();
});

test('folds and unfolds from the canvas, where the switch is', async ({ page }) => {
  // The panel is the keyboard path; this is the gesture. A canvas teaches nothing on
  // its own, so the count on the node is what says the switch is there at all.
  await openGraph(page, { graph: null });
  await drawn(page);
  await expect(page.getByText('7 of 7')).toBeVisible();

  const at = await nodeAt(page, 'harbourwatch');
  await page.getByLabel('Find a node').fill('');
  await page.mouse.dblclick(at.x, at.y);

  await expect(page.getByText('6 of 7')).toBeVisible();
  await expect(page.getByRole('button', { name: '1 folded' })).toBeVisible();

  // Found again rather than clicked at the same pixel. Folding rebuilds the drawing —
  // Konva throws its layer away and makes a new one — and re-runs the arrangement over
  // what is left, so the count in the toolbar can be right while the node is neither
  // where it was nor yet listening. Asking for it back waits for both.
  const back = await nodeAt(page, 'harbourwatch');
  await page.getByLabel('Find a node').fill('');
  await page.mouse.dblclick(back.x, back.y);
  await expect(page.getByText('7 of 7')).toBeVisible();
  await expect(page.getByRole('button', { name: /folded/ })).toHaveCount(0);
});

test('a right-click twice over opens the menu rather than folding under it', async ({ page }) => {
  // Konva counts a double-click by the clock alone, so the second menu opened on one
  // node arrived here as a double-click and folded the drawing under it.
  await openGraph(page, { graph: null });
  await drawn(page);
  const at = await nodeAt(page, 'harbourwatch');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.keyboard.press('Escape');
  await page.mouse.click(at.x, at.y, { button: 'right' });

  await expect(page.locator('.menu')).toBeVisible();
  await expect(page.getByRole('button', { name: /folded/ })).toHaveCount(0);
});

test('folds the picture the case opened on, which no other act reaches', async ({ page }) => {
  // The hole this closes: expanding adds and hiding removes, and neither speaks for
  // the nodes that were on screen before the analyst touched anything.
  await openGraph(page, { graph: null });
  await drawn(page);
  await expect(page.getByText('7 of 7')).toBeVisible();

  // The frame hangs off the account alone, so folding the account puts it away.
  await pick(page, 'harbourwatch');
  await page.getByRole('button', { name: /^Collapse \(1\)/ }).click();

  await expect(page.getByText('6 of 7')).toBeVisible();
  await expect(page.getByRole('button', { name: '1 folded' })).toBeVisible();
  // Nothing was asked of the case and nothing was hidden: the node is still sent, and
  // typing its name gives the fold back.
  await page.getByLabel('Find a node').fill('harbour frame');
  await expect(page.locator('.found button').first()).toContainText('folded');
  await page.locator('.found button').first().click();
  await expect(page.getByText('7 of 7')).toBeVisible();
});

test('a node says what can be done with it, in words', async ({ page }) => {
  // A canvas teaches no gesture on its own. The menu is where people look.
  await openGraph(page);
  await openMenu(page, '@harbourwatch');

  const menu = page.locator('.menu');
  await expect(menu).toContainText('Connect to…');
  await expect(menu).toContainText('Details');
  // Every neighbour of this account is already drawn, so the menu says so rather
  // than offering an act that could only appear to do nothing.
  await expect(menu).toContainText('All its connections are drawn');
});

test('two entities are connected with two clicks and a named verb', async ({ page }) => {
  const fixture = await openGraph(page);
  await openMenu(page, 'Section chief');
  await page.getByRole('button', { name: 'Connect to…' }).click();
  await expect(page.getByText(/Connecting from/)).toBeVisible();

  await clickNode(page, 'BTR-82A 4721');
  // Only the readings the vocabulary accepts for a person and a vehicle.
  await expect(page.locator('.offer')).toContainText('owns');
  await page.locator('.offer li button').first().click();

  expect(fixture.linkWrites).toEqual([
    { method: 'POST', id: null, body: { from_id: 'per-1', to_id: 'veh-1', type: 'owns' } },
  ]);
});

test('a filed connection says nothing, because the edge saying it is drawn', async ({ page }) => {
  // The bug this guards: the reload was followed by a call to a helper nobody ever
  // wrote, so the ReferenceError landed in the catch that reports a refused
  // connection — and a relation filed successfully reported an error naming the
  // missing function. Nothing on the canvas said the write had worked.
  const fixture = await openGraph(page);
  await openMenu(page, 'Section chief');
  await page.getByRole('button', { name: 'Connect to…' }).click();
  await clickNode(page, 'BTR-82A 4721');
  await page.locator('.offer li button').first().click();

  await expect.poll(() => fixture.linkWrites.length).toBe(1);
  // The edge is the confirmation, so it is read back before the silence is asserted:
  // an empty banner proves nothing while the reload is still in flight.
  await pick(page, 'Section chief');
  await expect(page.locator('.panel')).toContainText('owns');
  await expect(page.locator('.said')).toHaveCount(0);
});

test('a connection filed into a lens that cannot draw it says so', async ({ page }) => {
  // The one case worth a sentence: the lens holds a set of verbs, this one is not in
  // it, so the picture is unchanged and a write with no visible result reads as a
  // write that failed.
  await openGraph(page);
  await page.getByLabel('Lens').selectOption('ground');
  await openMenu(page, 'Section chief');
  await page.getByRole('button', { name: 'Connect to…' }).click();
  await clickNode(page, 'BTR-82A 4721');
  await page.locator('.offer li button').first().click();

  await expect(page.locator('.said')).toContainText('not drawn in this lens');
});

test('an armed connection survives the case being panned under it', async ({ page }) => {
  // A pan stores where the group is going and applies it on the next frame, so
  // reading the group mid-pan put the arrow one transform behind — and it caught up
  // in a jump when the pointer came up, landing the connection on the wrong node.
  const fixture = await openGraph(page);
  await drawn(page);
  await openMenu(page, 'Section chief');
  await page.getByRole('button', { name: 'Connect to…' }).click();

  await panBy(page, 120, 80);
  await expect(page.getByText(/Connecting from/)).toBeVisible();

  await clickNode(page, 'BTR-82A 4721');
  await page.locator('.offer li button').first().click();

  expect(fixture.linkWrites).toEqual([
    { method: 'POST', id: null, body: { from_id: 'per-1', to_id: 'veh-1', type: 'owns' } },
  ]);
});

test('a connection is called off without filing anything', async ({ page }) => {
  const fixture = await openGraph(page);
  await openMenu(page, 'Section chief');
  await page.getByRole('button', { name: 'Connect to…' }).click();
  await page.getByRole('button', { name: 'cancel' }).click();

  await expect(page.getByText(/Connecting from/)).toHaveCount(0);
  expect(fixture.linkWrites).toEqual([]);
});

// -- the edge as a thing to read ---------------------------------------------

test('an edge can be chosen, read and ruled on', async ({ page }) => {
  const fixture = await openGraph(page);
  // Reached from the node panel, which is the keyboard-reachable way to an edge.
  await pick(page, '@harbourwatch');
  await page.locator('.panel .link-row').first().click();
  await pick(page, '3rd Battalion');

  // The suggested edge to the account is the one a tool proposed.
  await expect(page.locator('.panel')).toContainText('owns');
  await page.locator('.canvas-row > .canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.panel')).toHaveCount(0);
  expect(fixture.linkWrites).toEqual([]);
});

// -- the filters -------------------------------------------------------------

test('a family is switched off from the legend, and the drawing shrinks', async ({ page }) => {
  // The control that matters on a case larger than the budget: a lens narrows verbs
  // and so never makes the drawing smaller, where a family does. On a real case one
  // family dwarfs the rest, and switching it off is what spends the budget elsewhere.
  await openGraph(page);
  await expect(page.getByText('7 of 7')).toBeVisible();

  const collected = page.getByRole('button', { name: /collected/ });
  await collected.click();

  // The one media entity is gone, and the legend still offers the way back.
  await expect(page.getByText('6 of 6')).toBeVisible();
  await expect(collected).toHaveAttribute('aria-pressed', 'false');
  await expect(collected).toContainText('off');

  await collected.click();
  await expect(page.getByText('7 of 7')).toBeVisible();
  await expect(collected).toHaveAttribute('aria-pressed', 'true');
});

test('the last family on stays on, since a blank canvas is not a reading', async ({ page }) => {
  // An empty type list reads as "no narrowing" server-side, so switching every family
  // off would draw the whole case back — a control doing the opposite of what it says.
  await openGraph(page);
  // Counted after the case has landed: the legend lists the families the case holds,
  // and before the first read there is nothing to switch.
  await expect(page.getByText('7 of 7')).toBeVisible();
  const families = page.locator('.families button');
  const count = await families.count();
  for (let i = 0; i < count; i += 1) await families.nth(i).click();

  await expect(page.locator('.families button[aria-pressed="true"]')).toHaveCount(1);
});

test('draws one of the analyst’s folders instead of the whole case', async ({ page }) => {
  // A folder is one Search+ axis because it is the closest thing the case has to
  // "what I am working on", and the same question must read the same in Board.
  await openGraph(page, { summary: { total: 7, by_type: { media: 1 }, by_status: {}, by_folder: { harbour: 1 } } });
  const bar = page.locator('.graph-tool .filter-bar');
  await bar.getByRole('button', { name: 'Filter', exact: true }).click();
  await bar.locator('.pop.wide').getByRole('button', { name: /^Folder\b/i }).click();
  await bar.locator('.pop').last().getByRole('button', { name: /^harbour\b/i }).click();

  await expect(page.getByText('1 of 1')).toBeVisible();
});
