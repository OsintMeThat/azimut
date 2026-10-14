// Marks free on the page, lines that hold to two pictures, and the words that
// grow apart from their lines: a tag, a callout, a cone's camera, the captions
// and the footer.
import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel, CASE_ID, PANEL_PATH } from './app.fixture.js';

const SECOND_PATH = 'media/second.svg';
const SECOND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="#445566"/><circle cx="640" cy="360" r="200" fill="#99aabb"/></svg>`;

const mediaItem = (path, width, height, sha) => ({
  path, filename: path.split('/').pop(), kind: 'image', width, height, size: 256, sha256: sha.repeat(64),
  source: { type: 'upload' }, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});

async function openTwoPanels(page) {
  const fixture = await installAppFixture(page, {
    media: [mediaItem(PANEL_PATH, 640, 360, 'a'), mediaItem(SECOND_PATH, 1280, 720, 'b')],
  });
  await page.route(`**/files/${CASE_ID}/${SECOND_PATH}`, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: SECOND_SVG }));
  await page.goto('/#proof');
  await page.getByRole('button', { name: 'New proof' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create proof' })).toBeVisible();
  await page.locator('.selectable-pick').nth(0).click();
  await page.locator('.selectable-pick').nth(1).click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (
    window.Konva.stages.find((s) => s.container().isConnected)?.find('.panel-hit').length ?? 0
  ))).toBe(2);
  return fixture;
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function save(page, fixture) {
  const n = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(n + 1);
  return fixture.proofSaves[n].spec;
}

/** Each picture on screen, left to right: its id and its middle. */
const pictures = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('.panel-hit'));
  const c = stage.container().getBoundingClientRect();
  return stage.find('.panel-hit').map((hit) => {
    const r = hit.getClientRect();
    return { id: hit.getParent().id().slice(3), x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2, w: r.width, h: r.height };
  }).sort((a, b) => a.x - b.x);
});

/** A node's middle on screen, by id. */
const middleOf = (page, id) => page.evaluate((nodeId) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${nodeId}`));
  const c = stage.container().getBoundingClientRect();
  const r = stage.findOne(`#${nodeId}`).getClientRect();
  return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
}, id);

/**
 * A line's two ends as drawn on the page, and where the pictures its ends hold
 * to have those pixels now: the two agree for as long as each end holds.
 */
const linkOnPage = (page, shape) => page.evaluate((s) => {
  const stage = window.Konva.stages.find((st) => st.container().isConnected && st.findOne(`#${s.id}`));
  const points = stage.findOne(`#${s.id}`).points();
  const held = s.ends.map((tie) => {
    const group = stage.findOne(`#pg-${tie.panel}`);
    return group.getTransform().point({ x: tie.x, y: tie.y });
  });
  return { points, held };
}, shape);

/** The page's own width and height, read off its background. */
const pageSize = (page) => page.evaluate(() => {
  const bg = window.Konva.stages.find((s) => s.container().isConnected).findOne('.bg');
  return { w: bg.width(), h: bg.height() };
});

/** A box drawn on the first picture and dragged off it, out past the page's right edge. */
async function boxTakenOut(page, fixture) {
  const [picture] = await pictures(page);
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: picture.x - 30, y: picture.y - 20 }, { x: picture.x + 30, y: picture.y + 20 });
  const [drawn] = (await save(page, fixture)).shapes;
  expect(drawn.panel).toBe(picture.id);
  const canvas = await page.locator('.konva canvas').first().boundingBox();
  const at = await middleOf(page, drawn.id);
  await drag(page, at, { x: canvas.x + canvas.width - 14, y: at.y });
  return { picture, drawn };
}

test('a mark dragged off its picture comes free, grows the page, and is anchored again on a picture', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const before = await pageSize(page);
  const { picture, drawn } = await boxTakenOut(page, fixture);
  const [free] = (await save(page, fixture)).shapes;
  expect(free.panel).toBe('page');
  // drawn in the page's own group, over every picture, on a page grown to hold it
  const group = await page.evaluate((id) => window.Konva.stages
    .find((s) => s.container().isConnected).findOne(`#${id}`).getParent().id(), drawn.id);
  expect(group).toBe('pg-page');
  expect(free.x + free.w).toBeGreaterThan(before.w);
  await expect.poll(async () => (await pageSize(page)).w).toBeGreaterThan(free.x + free.w);

  // a panel that grows leaves it where it is
  await page.getByTitle('Enlarge panel').click();
  const [still] = (await save(page, fixture)).shapes;
  expect(still).toMatchObject({ panel: 'page', x: free.x, y: free.y, w: free.w, h: free.h });

  // put back on the picture, it follows the picture again
  const now = (await pictures(page))[0];
  await drag(page, await middleOf(page, drawn.id), { x: now.x, y: now.y });
  const [back] = (await save(page, fixture)).shapes;
  expect(back.panel).toBe(picture.id);
  fixture.expectNoUnexpectedRequests();
});

test('a right-click pins a free mark out in a margin to the nearest picture, which it then follows', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const { picture, drawn } = await boxTakenOut(page, fixture);
  const before = await middleOf(page, drawn.id);
  await page.mouse.click(before.x, before.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin to Panel 1' }).click();
  const [pinned] = (await save(page, fixture)).shapes;
  expect(pinned.panel).toBe(picture.id);
  const at = await middleOf(page, drawn.id);
  expect(Math.abs(at.x - before.x)).toBeLessThan(1.5);
  expect(Math.abs(at.y - before.y)).toBeLessThan(1.5);

  // moved about out there, it stays pinned
  await drag(page, at, { x: at.x - 6, y: at.y + 20 });
  expect((await save(page, fixture)).shapes[0].panel).toBe(picture.id);
  // and it follows its picture, read on the page since the view refits
  const onPageX = () => page.evaluate((id) => {
    const node = window.Konva.stages.find((s) => s.container().isConnected).findOne(`#${id}`);
    return Math.round(node.getClientRect({ relativeTo: node.getLayer() }).x);
  }, drawn.id);
  const was = await onPageX();
  await page.getByTitle('Enlarge panel').click();
  await expect.poll(onPageX).toBeGreaterThan(was);
  fixture.expectNoUnexpectedRequests();
});

test('an arrow drawn from one picture to another holds by both ends, and follows them', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [left, right] = await pictures(page);
  await page.getByTitle('Arrow (a)').click();
  await drag(page, { x: left.x, y: left.y }, { x: right.x, y: right.y });
  const [arrow] = (await save(page, fixture)).shapes;
  expect(arrow).toMatchObject({ kind: 'arrow', panel: 'page' });
  expect(arrow.ends.map((tie) => tie.panel)).toEqual([left.id, right.id]);
  // the layer list says what it ties
  await expect(page.locator('.shape-row .on-what')).toHaveText('P1→P2');

  // a panel that grows carries the end that holds to it
  const ink = await linkOnPage(page, arrow);
  await page.locator('.panel-row').first().getByTitle('Enlarge panel').click();
  await expect.poll(async () => (await linkOnPage(page, arrow)).points[0]).not.toBeCloseTo(ink.points[0], 0);
  const now = await linkOnPage(page, arrow);
  expect(now.points[0]).toBeCloseTo(now.held[0].x, 1);
  expect(now.points[1]).toBeCloseTo(now.held[0].y, 1);
  expect(now.points[2]).toBeCloseTo(now.held[1].x, 1);
  expect(now.points[3]).toBeCloseTo(now.held[1].y, 1);
  fixture.expectNoUnexpectedRequests();
});

test('an arrow drawn within one picture is still that picture’s', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await page.getByTitle('Arrow (a)').click();
  await drag(page, { x: picture.x - 50, y: picture.y }, { x: picture.x + 50, y: picture.y });
  const [arrow] = (await save(page, fixture)).shapes;
  expect(arrow.panel).toBe(picture.id);
  expect(arrow).not.toHaveProperty('ends');
  fixture.expectNoUnexpectedRequests();
});

test('a tag and a callout grow their words without their lines', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: picture.x - 50, y: picture.y - 20 }, { x: picture.x + 50, y: picture.y + 30 });
  await page.getByTitle('Tag', { exact: true }).click();
  await page.getByRole('button', { name: 'Tag on the top-left corner' }).click();
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByTitle('Stroke width').click();
  await page.getByLabel('Tag text size').fill('40');
  const [box] = (await save(page, fixture)).shapes;
  expect(box).toMatchObject({ tagSize: 40, strokeWidth: 4 });

  // a callout's label grows and its line does not, and the other way round
  await page.keyboard.press('k');
  await drag(page, { x: picture.x + 30, y: picture.y + 40 }, { x: picture.x + 120, y: picture.y - 60 });
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByTitle('Font size').click();
  await page.getByLabel('font size').fill('44');
  await page.getByLabel('Line size').fill('3');
  const [, callout] = (await save(page, fixture)).shapes;
  expect(callout).toMatchObject({ kind: 'callout', fontSize: 44, strokeWidth: 3 });
  fixture.expectNoUnexpectedRequests();
});

test('a cone’s camera is sized on its own, and the cone draws no line down its middle', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await page.keyboard.press('o');
  await page.getByTitle('Stroke width').click();
  await page.getByLabel('Camera size').fill('70');
  // shut again, so the drag below lands on the picture rather than on the flyout
  await page.getByTitle('Stroke width').click();
  await drag(page, { x: picture.x - 80, y: picture.y + 40 }, { x: picture.x + 60, y: picture.y + 40 });
  const [cone] = (await save(page, fixture)).shapes;
  expect(cone).toMatchObject({ kind: 'cone', badge: 70, strokeWidth: 4 });
  // the wedge, its two edges, and nothing dotted
  const dashed = await page.evaluate((id) => window.Konva.stages.find((s) => s.container().isConnected)
    .findOne(`#${id}`).find('Line').filter((line) => (line.dash() ?? []).length > 0).length, cone.id);
  expect(dashed).toBe(0);
  fixture.expectNoUnexpectedRequests();
});

test('a caption is written where it is printed, and the panel sizes and colours the captions', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const panelId = (await pictures(page))[0].id;
  await page.locator('.panel-row .cap-input').first().fill('Street view');
  await expect.poll(() => page.evaluate((id) => !!window.Konva.stages
    .find((s) => s.container().isConnected).findOne(`#cap-${id}`), panelId)).toBe(true);
  const caption = await middleOf(page, `cap-${panelId}`);
  await page.mouse.dblclick(caption.x, caption.y);
  const editor = page.locator('textarea.text-edit');
  await expect(editor).toBeFocused();
  await editor.fill('Street view, looking north');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel-row .cap-input').first()).toHaveValue('Street view, looking north');

  await page.getByTitle('Caption text').click();
  await page.getByLabel('Caption text size').fill('30');
  await page.getByLabel('Caption colour #ffd740').click();
  const spec = await save(page, fixture);
  expect(spec.panels[0].caption).toBe('Street view, looking north');
  expect(spec).toMatchObject({ captionSize: 30, captionColor: '#ffd740' });
  fixture.expectNoUnexpectedRequests();
});

test('the footer is picked for its size and colour, and its credit line written in place', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const footer = await middleOf(page, 'proof-footer');
  await page.mouse.click(footer.x, footer.y);
  await page.getByTitle('Footer text').click();
  await page.getByLabel('Footer text size').fill('20');
  await page.getByTitle('Footer text').click();
  // a bigger footer makes a taller page, and the view refits: read it again
  await expect.poll(() => page.evaluate(() => window.Konva.stages
    .find((s) => s.container().isConnected).findOne('#proof-footer').findOne('Text').fontSize())).toBe(20);
  const resized = await middleOf(page, 'proof-footer');
  await page.mouse.dblclick(resized.x, resized.y);
  const editor = page.locator('textarea.text-edit');
  await expect(editor).toBeFocused();
  await editor.fill('Geolocated by the desk');
  await page.keyboard.press('Enter');
  const spec = await save(page, fixture);
  expect(spec).toMatchObject({ footer: 'Geolocated by the desk', footerSize: 20 });
  fixture.expectNoUnexpectedRequests();
});

test('a mark drawn or dropped over a zoom inset goes on the page, in front of the inset', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  // a box on the picture's lower right, drawn before the inset
  const corner = { x: picture.x + picture.w / 3, y: picture.y + picture.h / 3 };
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: corner.x - 15, y: corner.y - 10 }, { x: corner.x + 15, y: corner.y + 10 });
  // the inset's frame on the upper right, so the enlargement goes to the far corner
  await page.keyboard.press('z');
  const frame = { x: picture.x + picture.w / 3, y: picture.y - picture.h / 3 };
  await drag(page, { x: frame.x - 15, y: frame.y - 10 }, { x: frame.x + 15, y: frame.y + 10 });
  const [early, zoom] = (await save(page, fixture)).shapes;
  expect([early.kind, zoom.kind]).toEqual(['rect', 'zoom']);

  // drawn over the inset
  const inset = await middleOf(page, zoom.id);
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: inset.x - 15, y: inset.y - 10 }, { x: inset.x + 15, y: inset.y + 10 });
  // and the early box dropped on it
  await page.keyboard.press('v');
  await drag(page, await middleOf(page, early.id), { x: inset.x + 20, y: inset.y + 20 });
  const shapes = (await save(page, fixture)).shapes;
  expect(shapes.map((s) => [s.id === early.id ? 'early' : s.kind, s.panel])).toEqual([
    ['zoom', picture.id], ['rect', 'page'], ['early', 'page'],
  ]);
  fixture.expectNoUnexpectedRequests();
});

test('the wheel button moves the view and never the mark under it', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const [picture] = await pictures(page);
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: picture.x - 40, y: picture.y - 20 }, { x: picture.x + 40, y: picture.y + 20 });
  await page.keyboard.press('v');
  const [box] = (await save(page, fixture)).shapes;
  const view = () => page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    return { x: stage.x(), y: stage.y() };
  });
  const start = await view();
  const at = await middleOf(page, box.id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(at.x + 80, at.y + 40, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  const end = await view();
  expect(end.x - start.x).toBeCloseTo(80, 0);
  const [after] = (await save(page, fixture)).shapes;
  expect(after).toMatchObject({ x: box.x, y: box.y, panel: box.panel });
  fixture.expectNoUnexpectedRequests();
});
