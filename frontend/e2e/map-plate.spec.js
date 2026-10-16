import { expect, test } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

/**
 * The plate routes, kept in memory over the shared fixture: what was saved, what
 * was exported, and the templates kept.
 */
async function plateFixture(page, store = { plates: new Map(), saves: [], exports: [], templates: [] }) {
  await installAppFixture(page);
  await page.route('**/api/templates', (route) => route.fulfill({ json: { proof: [], post: [], map: store.templates } }));
  await page.route('**/api/templates/map', async (route) => {
    const body = route.request().postDataJSON();
    const record = { id: body.id ?? `t${store.templates.length + 1}`, name: body.name, data: body.data };
    store.templates = [...store.templates.filter((item) => item.id !== record.id), record];
    await route.fulfill({ json: record });
  });
  await page.route(`**/api/cases/${CASE_ID}/map-plates**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const tail = path.split('/map-plates')[1];
    if (tail === '/export') {
      store.exports.push(request.postDataBuffer()?.toString('latin1') ?? '');
      return route.fulfill({ json: { file: 'Map plate.png', path: '/tmp/views', format: 'png' } });
    }
    if (tail === '' && request.method() === 'GET') {
      return route.fulfill({ json: [...store.plates.values()].map((saved) => ({ name: saved.title, title: saved.title, maps: 1, thumb: null })) });
    }
    if (tail === '' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.rename_from) store.plates.delete(body.rename_from);
      store.plates.set(body.title, { title: body.title, spec: body.spec });
      store.saves.push(body);
      return route.fulfill({ json: { name: body.title, title: body.title, spec_path: `.mapplates/${body.title}.json`, thumb: null } });
    }
    if (tail.endsWith('/thumb')) return route.fulfill({ json: { thumb: null } });
    const saved = store.plates.get(decodeURIComponent(tail.slice(1)));
    return saved ? route.fulfill({ json: { name: saved.title, ...saved } }) : route.fulfill({ status: 404, json: { detail: 'plate not found' } });
  });
  return store;
}

const lastSave = (store) => store.saves.at(-1);

/** An element added from the Add panel, by its tile. */
async function addOnPage(page, label) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('.float-menu .tile', { hasText: new RegExp(`^${label}$`) }).click();
}

test('a new plate opens on the house layout and saves itself', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await expect(page.getByRole('heading', { name: 'Map plates' })).toBeVisible();
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const kinds = lastSave(store).spec.elements.map((element) => element.kind);
  expect(kinds).toEqual(expect.arrayContaining(['map', 'legend', 'inset', 'scale', 'north', 'credits', 'text']));
  // a text added and written in the inspector is on the next save
  await addOnPage(page, 'Text');
  await page.getByLabel('Text', { exact: true }).fill('Situation, as reported');
  await expect.poll(() => lastSave(store).spec.elements.some((element) => element.text === 'Situation, as reported')).toBe(true);
  // renamed in the header, it is saved under its new name
  const title = page.getByLabel('Plate name', { exact: true });
  await title.fill('Front, October');
  await title.press('Enter');
  await expect.poll(() => lastSave(store).title).toBe('Front, October');
});

test('the page zooms round the wheel, moves by a drag, and Fit brings it back', async ({ page }) => {
  await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  const paper = page.locator('.page');
  await expect(page.locator('.plate-map')).toHaveCount(2);
  const fitted = await paper.boundingBox();
  const viewport = await page.locator('.viewport').boundingBox();
  // a drag round the page moves it
  await page.mouse.move(viewport.x + 6, viewport.y + 6);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 66, viewport.y + 46, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await paper.boundingBox()).x).toBeCloseTo(fitted.x + 60, 0);
  // the wheel zooms round the pointer
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await paper.boundingBox()).width).toBeGreaterThan(fitted.width * 1.3);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => (await paper.boundingBox()).width).toBeCloseTo(fitted.width, 0);
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeDisabled();
});

test('a framed map goes as far as the hand drags it', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const map = page.locator('.plate-map').first();
  const box = await map.boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.plate-map.live')).toHaveCount(1);
  // the page's hand layer stays clear while a map is framed, and the hint stands under the page
  await expect(page.locator('.hand')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.hand')).toHaveCSS('border-radius', '0px');
  await expect(page.getByText('Drag and scroll to frame the map', { exact: false })).toBeVisible();
  const mainOf = (spec) => spec.elements.find((element) => element.kind === 'map').view;
  const before = mainOf(lastSave(store).spec);
  const scale = parseInt(await page.locator('.zoom-value').textContent(), 10) / 100;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
  // 150 screen pixels are 150 / scale pixels of the map: the ground follows the whole drag
  const expected = ((150 / scale) * 360) / (512 * 2 ** before.zoom);
  await expect.poll(() => mainOf(lastSave(store).spec).lon - before.lon).toBeGreaterThan(expected * 0.8);
});

test('a map in 3D goes as far as the hand drags it', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await addOnPage(page, '3D view');
  await expect(page.locator('.plate-map')).toHaveCount(3);
  const tilted = () => lastSave(store)?.spec.elements.find((element) => element.kind === 'map' && (element.view?.pitch ?? 0) > 0);
  await expect.poll(() => !!tilted()).toBe(true);
  const { id, view: before } = tilted();
  const box = await page.locator(`.hit[data-element="${id}"]`).boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.plate-map.live')).toHaveCount(1);
  const scale = parseInt(await page.locator('.zoom-value').textContent(), 10) / 100;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  // the leaning camera follows the whole drag, never put back where it stood at each step
  const expected = ((80 / scale) * 360) / (512 * 2 ** before.zoom);
  await expect.poll(() => {
    const view = lastSave(store).spec.elements.find((element) => element.id === id).view;
    return [Math.abs(view.lon - before.lon) > expected * 0.6, view.pitch];
  }).toEqual([true, before.pitch]);
});

test('symbols are stamped on the map one after the other, and the next takes the marker picked', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  const box = await page.locator('.plate-map').first().boundingBox();
  const symbols = () => lastSave(store)?.spec.elements.filter((element) => element.kind === 'symbol') ?? [];
  // the tool stays in hand: two presses, two symbols over their points
  await addOnPage(page, 'Symbol');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect.poll(() => symbols().length).toBe(2);
  expect(symbols().every((element) => element.at?.length === 2 && element.of === 'map')).toBe(true);
  // the second, picked, takes a marker of the layers' palette, and the next one placed takes it too
  await page.getByRole('button', { name: 'Symbol and colour' }).click();
  await page.locator('.icons button[title="Tank"]').first().click();
  await expect.poll(() => symbols().at(-1)?.symbol).toBe('badge-tank');
  await page.keyboard.press('Escape');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await expect.poll(() => symbols().map((element) => element.symbol)).toEqual(['badge-crosshair', 'badge-tank', 'badge-tank']);
});

test('an element moves by the keyboard, goes with Delete, and Undo brings it back', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.locator('.list button', { hasText: 'Legend' }).click();
  await expect(page.getByRole('heading', { name: 'Legend', exact: true })).toBeVisible();
  const before = await page.locator('.hit.selected').boundingBox();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.locator('.hit.selected').boundingBox()).x).toBeGreaterThan(before.x);
  await page.keyboard.press('Delete');
  await expect(page.locator('.list button', { hasText: 'Legend' })).toHaveCount(0);
  await expect.poll(() => lastSave(store)?.spec.elements.some((element) => element.kind === 'legend')).toBe(false);
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(page.locator('.list button', { hasText: 'Legend' })).toHaveCount(1);
});

test('a row of the element list is dragged up or down, the writing above the maps', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const rows = page.locator('.elements .list > li');
  /** The saved elements, top first, as the list shows them. */
  const saved = () => [...lastSave(store).spec.elements].reverse().map((element) => element.id);
  const kinds = () => [...lastSave(store).spec.elements].reverse().map((element) => element.kind);
  /** A press on one row, moved in small steps to a point, and let go there. */
  async function drag(from, to, below = false) {
    const start = await rows.nth(from).boundingBox();
    const end = await rows.nth(to).boundingBox();
    await page.mouse.move(start.x + 30, start.y + start.height / 2);
    await page.mouse.down();
    const y = below ? end.y + end.height - 2 : end.y + 2;
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x + 30, start.y + start.height / 2 + ((y - start.y - start.height / 2) * step) / 6);
    await page.mouse.up();
  }
  const first = saved();
  const maps = kinds().findIndex((kind) => kind === 'map' || kind === 'inset');
  expect(maps).toBeGreaterThan(2);

  // the last of the writing goes to the top
  await drag(maps - 1, 0);
  await expect.poll(() => saved()[0]).toBe(first[maps - 1]);

  // the top one, let go under the maps, stops just above them
  const top = saved()[0];
  await drag(0, first.length - 1, true);
  await expect.poll(() => saved()[maps - 1]).toBe(top);
  expect(kinds().slice(maps).every((kind) => kind === 'map' || kind === 'inset')).toBe(true);

  // a map taken over the writing stays among the maps, on top of them
  const map = saved().at(-1);
  await drag(first.length - 1, 0);
  await expect.poll(() => saved()[maps]).toBe(map);
  expect(kinds().slice(maps).every((kind) => kind === 'map' || kind === 'inset')).toBe(true);
  // a plain press still picks the row, and the inspector steps it among the rows listed
  const picked = saved()[0];
  await rows.nth(0).locator('.row').click();
  await expect(rows.nth(0).locator('.row')).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Bring forward', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Send back', exact: true }).click();
  await expect.poll(() => saved()[1]).toBe(picked);
});

test('the credits stay on the page, and the export writes the page', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.locator('.list button', { hasText: 'Credits' }).click();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // a plate with no layer followed over time has no days to play
  await expect(dialog.getByText('Needs a layer followed over time on the plate.').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Screen · 150 dpi' }).click();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => store.exports.length, { timeout: 30_000 }).toBe(1);
  expect(store.exports[0]).toContain('name="format"\r\n\r\npng');
  await expect(page.getByText('Map plate.png written')).toBeVisible();
});

test('a plate kept as a template starts the next one', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await page.getByLabel('Paper', { exact: true }).selectOption('screen');
  await page.getByRole('button', { name: 'Keep as template' }).click();
  await page.getByLabel('Template name').fill('Slide');
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect.poll(() => store.templates.length).toBe(1);
  const kept = store.templates[0].data;
  expect(kept.page.paper).toBe('screen');
  // no case's data in it
  expect(kept.elements.find((element) => element.kind === 'map').view).toBeUndefined();
  await page.getByRole('button', { name: 'Plates', exact: true }).click();
  await page.locator('.tile.template', { hasText: 'Slide' }).click();
  await expect.poll(() => lastSave(store)?.spec.page.paper).toBe('screen');
});

test('a day plays its steps, and a step plays a video of the case', async ({ page }) => {
  const store = await plateFixture(page);
  const strike = { path: 'media/strike.mp4', title: 'Strike', kind: 'video', thumbnail: null,
    source: { type: 'download', uploader: 'GeoWatch', webpage_url: 'https://x.com/geo/status/1', upload_date: '20261012' } };
  await page.route(`**/api/cases/${CASE_ID}/media/page**`, (route) => route.fulfill({ json: { items: [strike], next_cursor: null, total: 1, facets: {} } }));
  await page.route(`**/api/cases/${CASE_ID}/media/item**`, (route) => route.fulfill({ json: strike }));
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  // a plate with no layer followed over time has no play bar, and still takes steps
  await expect(page.locator('.timebar')).toHaveCount(0);
  await addOnPage(page, 'Step');
  const tiles = page.locator('.steps [role="option"]');
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('.on-step')).toHaveText('Step 1: what you add belongs to it');
  await addOnPage(page, 'Text');
  await page.getByLabel('Text', { exact: true }).fill('First strike');
  await expect.poll(() => {
    const spec = lastSave(store)?.spec;
    return !!spec && spec.elements.find((element) => element.text === 'First strike')?.step === spec.steps?.now?.[0]?.id;
  }).toBe(true);
  await expect(page.locator('.list .tag.step')).toHaveCount(1);
  // the day itself leaves the step's text out
  await tiles.first().click();
  await expect(page.locator('.on-step')).toHaveCount(0);
  await expect(page.locator('.list .row', { hasText: 'First strike' })).toHaveCount(0);
  // a video goes on a step of its own, after the last, and says where it comes from
  await addOnPage(page, 'Video');
  await expect(tiles).toHaveCount(3);
  await page.getByRole('button', { name: 'Choose a video' }).click();
  await page.locator('.float-menu button[title="Strike"]').click();
  await expect(page.getByLabel('Source line', { exact: true })).toHaveValue('GeoWatch · x.com · 12 October 2026');
  await expect.poll(() => {
    const spec = lastSave(store)?.spec;
    const video = spec?.elements.find((element) => element.kind === 'video');
    return video && [video.src, video.step === spec.steps.now[1].id, video.clip];
  }).toEqual(['media/strike.mp4', true, [0, 10]]);
  // the MP4 is the page, then each step, the video running over its own
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[value="mp4"]').check();
  await expect(dialog.getByText(/Runs 0:1\d/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect.poll(() => store.exports.length, { timeout: 60_000 }).toBe(1);
  expect(store.exports[0]).toContain('name="beats"');
  expect(store.exports[0]).toContain('"src":"media/strike.mp4"');
  expect(store.exports[0]).toContain('name="overs"');
});

test('a line and a text go on the map, a step frames the map its own way, and the video moves between them', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  const box = await page.locator('.plate-map').first().boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  // a line, point by point, ended by Enter
  await addOnPage(page, 'Line');
  await page.mouse.click(...at(0.3, 0.4));
  await page.mouse.click(...at(0.5, 0.5));
  await page.mouse.click(...at(0.7, 0.45));
  await page.keyboard.press('Enter');
  await expect.poll(() => lastSave(store)?.spec.elements.find((element) => element.kind === 'line')?.points.length).toBe(3);
  await expect(page.getByRole('heading', { name: 'Line', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Line path' }).getByRole('button', { name: 'Curved' }).click();
  await expect.poll(() => lastSave(store)?.spec.elements.find((element) => element.kind === 'line')?.shape).toBe('curve');
  // a text on the map: no leader, over the point pressed, even on the line and its handle
  await addOnPage(page, 'Map text');
  await page.mouse.click(...at(0.5, 0.5));
  await expect(page.getByRole('heading', { name: 'Text on the map' })).toBeVisible();
  await expect.poll(() => lastSave(store)?.spec.elements.find((element) => element.kind === 'label' && element.leader === 'none')?.at?.length).toBe(2);
  // its words set like any other
  await page.getByRole('group', { name: 'Text weight' }).getByRole('button', { name: 'Bold' }).click();
  await expect.poll(() => lastSave(store)?.spec.elements.find((element) => element.leader === 'none')?.weight).toBe(700);
  // a step keeps the day's framing until it is let go, then frames the map on its own
  await addOnPage(page, 'Step');
  await expect(page.locator('.on-step')).toHaveText('Step 1: what you add belongs to it');
  await page.locator('.list').getByRole('button', { name: 'Map', exact: true }).click();
  const keep = page.locator('.map-bar .keep input');
  await expect(keep).toBeChecked();
  await expect(page.getByRole('button', { name: 'Zoom the map in' })).toBeDisabled();
  await keep.uncheck();
  await page.getByRole('button', { name: 'Zoom the map in' }).click();
  await expect.poll(() => {
    const spec = lastSave(store)?.spec;
    const step = spec?.steps?.now?.[0]?.id;
    const own = spec?.framing?.[step]?.map;
    return own && own.zoom - spec.elements.find((element) => element.id === 'map').view.zoom;
  }).toBeCloseTo(0.5, 1);
  // the video goes from the day to the step by the plate's transitions, once they are on
  await page.keyboard.press('Escape');
  await page.getByLabel('Between the days and the steps').check();
  await page.getByLabel('Blurred as it moves').uncheck();
  await expect.poll(() => {
    const moves = lastSave(store)?.spec.transitions;
    return moves && [moves.on, moves.move, moves.blur];
  }).toEqual([true, true, false]);
});

test('a detail\'s square on the main map is dragged to move what the detail shows', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await addOnPage(page, 'Detail');
  await expect(page.locator('.plate-map')).toHaveCount(3);
  const detailOf = (spec) => spec?.elements.find((element) => element.kind === 'map' && element.of);
  await expect.poll(() => detailOf(lastSave(store)?.spec)?.view?.lon).toBeDefined();
  const square = page.locator('[data-footprint]');
  await expect(square).toHaveCount(1);
  await expect(square.locator('title')).toHaveText('Drag to move what Detail shows');
  // a press picks the detail
  await page.keyboard.press('Escape');
  const box = await square.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('heading', { name: 'Map (detail)' })).toBeVisible();
  // a drag moves what it shows: east as the square goes right, at the same zoom
  const before = detailOf(lastSave(store).spec).view;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => detailOf(lastSave(store).spec).view.lon - before.lon).toBeGreaterThan(0);
  expect(detailOf(lastSave(store).spec).view.zoom).toBe(before.zoom);
  // locked, the square only picks it
  await page.locator('.inspector header').getByRole('button', { name: 'Lock', exact: true }).click();
  await expect.poll(() => detailOf(lastSave(store).spec).locked).toBe(true);
  const moved = detailOf(lastSave(store).spec).view;
  const again = await square.boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2 + 60, again.y + again.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  expect(detailOf(lastSave(store).spec).view.lon).toBe(moved.lon);
});

test('each day and step holds its own time in the video, the export saying how long it runs', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await addOnPage(page, 'Step');
  const times = page.locator('.steps .time');
  await expect(times).toHaveText(['0:01', '0:03']);
  // a step's time, pressed, is set
  await page.getByRole('button', { name: 'How long Step 1 holds' }).click();
  const seconds = page.locator('.float-menu input[type="number"]');
  await expect(seconds).toBeFocused();
  await seconds.fill('2.5');
  await seconds.blur();
  await expect.poll(() => lastSave(store)?.spec.steps?.now?.[0]?.duration).toBe(2.5);
  await page.keyboard.press('Escape');
  // the day's own time, over every day's
  await page.locator('.steps button.time').first().click();
  await page.locator('.float-menu input[type="number"]').fill('4');
  await page.locator('.float-menu input[type="number"]').blur();
  await expect.poll(() => lastSave(store)?.spec.holds?.now).toBe(4);
  await page.keyboard.press('Escape');
  await expect(times).toHaveText(['0:04', '0:02.5']);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[value="mp4"]').check();
  await expect(dialog.getByText('Runs 0:06.5')).toBeVisible();
  // a landscape A4 at 1080p, both sides even
  await expect(dialog.getByRole('group', { name: 'Video size' }).getByRole('button')).toHaveText(['1280 × 906', '1920 × 1358']);
});

test('a plate holds eight maps at most, and says why', async ({ page }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  for (let index = 0; index < 6; index += 1) await addOnPage(page, 'Map');
  await expect(page.locator('.plate-map')).toHaveCount(8);
  await addOnPage(page, 'Map');
  await expect(page.getByText('A plate holds 8 maps and insets at most', { exact: false })).toBeVisible();
  await expect(page.locator('.plate-map')).toHaveCount(8);
  await expect.poll(() => lastSave(store)?.spec.elements.filter((element) => ['map', 'inset'].includes(element.kind)).length).toBe(8);
});

test('the page takes the room: panels widened and put away, focus, and a tab of its own', async ({ page, context }) => {
  const store = await plateFixture(page);
  await page.goto('/#plate');
  await page.getByRole('button', { name: 'New plate', exact: true }).click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await expect.poll(() => store.saves.length).toBeGreaterThan(0);
  const inspector = page.getByLabel('Plate inspector');
  const list = page.getByLabel('Elements', { exact: true });

  // the inspector is widened by its edge, and a section folded stays folded
  const narrow = (await inspector.boundingBox()).width;
  await page.getByRole('button', { name: 'Resize the inspector' }).focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await inspector.boundingBox()).width).toBeGreaterThan(narrow + 50);
  await inspector.getByRole('button', { name: 'Looks' }).click();
  await expect(inspector.locator('.themes')).toHaveCount(0);

  // the list and the inspector put away from the header, the page taking their room
  const page0 = (await page.locator('.viewport').boundingBox()).width;
  await page.getByRole('button', { name: 'The list', exact: true }).click();
  await page.getByRole('button', { name: 'The inspector', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(inspector).toHaveCount(0);
  await expect.poll(async () => (await page.locator('.viewport').boundingBox()).width).toBeGreaterThan(page0 + 300);

  // kept for the next plate opened
  await page.getByRole('button', { name: 'Plates', exact: true }).click();
  await page.locator('.tile .open').first().click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await expect(inspector).toHaveCount(0);
  await page.getByRole('button', { name: 'The inspector', exact: true }).click();
  await page.getByRole('button', { name: 'The list', exact: true }).click();
  await expect(inspector.getByRole('button', { name: 'Looks' })).toHaveAttribute('aria-expanded', 'false');

  // A finds an element and adds it
  await page.locator('.viewport').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('a');
  await page.getByLabel('Find an element').fill('banner');
  await page.keyboard.press('Enter');
  await expect.poll(() => lastSave(store)?.spec.elements.some((element) => element.name === 'Banner')).toBe(true);

  // F gives the page the whole screen: the app's bars and the panels step aside
  await page.locator('.viewport').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('tool') ?? false)).toBe(true);
  await expect(page.locator('.topbar')).toHaveCount(0);
  await expect(page.locator('nav.rail')).toHaveCount(0);
  await expect(page.getByLabel('Plate name', { exact: true })).toHaveCount(0);
  await expect(inspector).toHaveCount(0);
  // a panel called back floats over the page, which keeps its room
  const whole = (await page.locator('.viewport').boundingBox()).width;
  await page.locator('.focus-bar').getByRole('button', { name: 'The inspector' }).click();
  await expect(inspector).toBeVisible();
  expect((await page.locator('.viewport').boundingBox()).width).toBe(whole);
  await page.locator('.viewport').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByLabel('Plate name', { exact: true })).toBeVisible();

  // a tab of its own: the plate alone there, this tab back on the list
  const opening = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open in its own tab' }).click();
  const second = await opening;
  await second.waitForURL(/#plate\?/);
  expect(new URL(second.url()).hash).toMatch(/plate=.+solo=1/);
  await plateFixture(second, store);
  await second.reload();
  await expect(second.locator('.plate-map')).toHaveCount(2);
  await expect(second.locator('nav.rail')).toHaveCount(0);
  await expect(second.locator('.topbar')).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Open in its own tab' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Map plates' })).toBeVisible();

  // one plate, one tab: opened here again, the other tab lets it go
  await page.locator('.tile .open').first().click();
  await expect(page.locator('.plate-map')).toHaveCount(2);
  await expect(second.getByRole('heading', { name: 'Map plates' })).toBeVisible();
  await second.close();
});

test('a plate saved on now reopens on the day it was last saved, with what stood on now', async ({ page }) => {
  const store = await plateFixture(page);
  const front = { name: 'front', title: 'Front', source: { kind: 'editable' }, editable: true, hidden: [], features: 1,
    categories: [], sha256: 'f1', icons: 0, track: { on: true, precision: 'day', zone: 'UTC' } };
  const point = (lon) => ({ type: 'Point', coordinates: [lon, 48.86] });
  await page.route(`**/api/cases/${CASE_ID}/map-layers`, (route) => route.fulfill({ json: [front] }));
  await page.route(`**/api/cases/${CASE_ID}/map-layers/front/data**`, (route) => route.fulfill({ json: { type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: point(2.31), properties: { key: 'k', name: 'Post', group: 'g', category: 'Posts',
      states: [{ at: '2026-10-03', geometry: point(2.30) }, { at: '2026-10-09', geometry: point(2.31) }] } }] } }));
  // saved on the 12th while a played plate could stand on "now"
  store.plates.set('Front', { title: 'Front', updated_at: '2026-10-12T21:00:00Z', spec: {
    page: { paper: 'a4', orientation: 'landscape' },
    theme: { paper: '#ffffff', ink: '#15181e', accent: '#c8102e', font: 'inter', preset: '' },
    time: { at: null, step: null, trail: true, since: null, window: 7, hold: 1 },
    steps: { now: [{ id: 's1', name: 'Strike', duration: 3 }] },
    holds: { now: 2 },
    elements: [
      { id: 'map', kind: 'map', box: [10, 20, 200, 150], view: { lat: 48.86, lon: 2.3, zoom: 12, bearing: 0 }, basemap: 'plain',
        overlays: [], layers: [{ name: 'front', hidden: [], stroke: 1, icons: 1 }], grid: 'none' },
      { id: 'note', kind: 'text', box: [10, 4, 120, 12], text: 'Hit on the post', onward: 'now', until: null },
    ] } });
  await page.goto('/#plate');
  await page.locator('.tile .open', { hasText: 'Front' }).click();
  // the day it was left on, never a "now" that slid to today
  await expect(page.locator('.timebar .moment')).toHaveText('12 Oct 2026');
  await expect.poll(() => lastSave(store)?.spec.time.at ?? null).toBe('2026-10-12');
  const spec = lastSave(store).spec;
  expect(spec.steps).toEqual({ '2026-10-12': [{ id: 's1', name: 'Strike', duration: 3 }] });
  expect(spec.holds).toEqual({ '2026-10-12': 2 });
  const note = spec.elements.find((element) => element.id === 'note');
  expect([note.onward, note.until]).toEqual(['2026-10-12', '2026-10-12']);
  await expect(page.locator('.steps [role="option"]').first()).toContainText('12 Oct 2026');
});
