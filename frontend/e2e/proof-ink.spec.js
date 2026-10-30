// A mark belongs to its picture and its ink to the page. Two pictures of very
// different resolutions side by side are what used to tell the two apart: the
// same label drew four times bigger on the small one, and a box carried across
// shrank by the same factor on the way.
import { test, expect } from '@playwright/test';
import { installAppFixture, openProofWithPanel, CASE_ID, PANEL_PATH } from './app.fixture.js';

const LARGE_PATH = 'media/large.svg';
const LARGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440">
  <rect width="2560" height="1440" fill="#445566"/><circle cx="1280" cy="720" r="400" fill="#99aabb"/></svg>`;

const mediaItem = (path, width, height, sha) => ({
  path, filename: path.split('/').pop(), kind: 'image', width, height, size: 256, sha256: sha.repeat(64),
  source: { type: 'upload' }, thumbnail: null, thumb_state: 'ready', enrich_state: 'ready', folder: '', notes: '',
});

/** A proof on a 640 px picture and a 2560 px one, both drawn the same height. */
async function openTwoPanels(page) {
  const fixture = await installAppFixture(page, {
    media: [mediaItem(PANEL_PATH, 640, 360, 'a'), mediaItem(LARGE_PATH, 2560, 1440, 'b')],
  });
  await page.route(`**/files/${CASE_ID}/${LARGE_PATH}`, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: LARGE_SVG }));
  await page.goto('/#proof');
  await page.getByRole('button', { name: 'New proof' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create proof' })).toBeVisible();
  await page.locator('.selectable-pick').nth(0).click();
  await page.locator('.selectable-pick').nth(1).click();
  await page.getByRole('button', { name: 'Create proof' }).click();
  await expect(page.locator('.panel-row')).toHaveCount(2);
  await expect.poll(() => surfaceCount(page)).toBe(2);
  // The proof's face arrives after the page is first drawn, and the page is drawn
  // again then; a word measured before it would not be measured the same after.
  await page.evaluate(() => document.fonts.load('700 16px "Inter"'));
  return fixture;
}

const surfaceCount = (page) => page.evaluate(() => (
  window.Konva.stages.find((s) => s.container().isConnected)?.find('.panel-hit').length ?? 0
));

/** Every surface on screen, smallest picture first: its id and its rectangle. */
const surfacesOnScreen = (page) => page.evaluate(() => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne('.panel-hit'));
  const c = stage.container().getBoundingClientRect();
  return stage.find('.panel-hit').map((hit) => {
    const r = hit.getClientRect();
    const img = hit.getParent().findOne('Image')?.image();
    return {
      id: hit.getParent().id().slice(3),
      natural: img?.naturalWidth ?? img?.width ?? 0,
      x: c.left + r.x, y: c.top + r.y, w: r.width, h: r.height,
      cx: c.left + r.x + r.width / 2, cy: c.top + r.y + r.height / 2,
    };
  }).sort((p, q) => p.natural - q.natural);
});

/**
 * One drawn mark, read off its node: where it is on screen, and its size and ink
 * in page pixels, so a view that refits between two readings changes nothing.
 */
const markOf = (page, id) => page.evaluate((markId) => {
  const stage = window.Konva.stages.find((s) => s.container().isConnected && s.findOne(`#${markId}`));
  const node = stage.findOne(`#${markId}`);
  const c = stage.container().getBoundingClientRect();
  const screen = node.getClientRect();
  const page = node.getClientRect({ relativeTo: node.getLayer() });
  const ink = node.getAbsoluteScale().x / stage.scaleX();
  return {
    cx: c.left + screen.x + screen.width / 2,
    cy: c.top + screen.y + screen.height / 2,
    left: c.left + screen.x,
    w: page.width,
    h: page.height,
    x: page.x,
    y: page.y,
    stroke: typeof node.strokeWidth === 'function' ? node.strokeWidth() * ink : null,
    font: typeof node.fontSize === 'function' ? node.fontSize() * ink : null,
    surface: node.findAncestor((n) => n.id()?.startsWith('pg-'))?.id().slice(3),
  };
}, id);

async function save(page, fixture) {
  const n = fixture.proofSaves.length;
  await page.getByRole('button', { name: 'Save proof', exact: true }).click();
  await expect.poll(() => fixture.proofSaves.length).toBe(n + 1);
  return fixture.proofSaves[n].spec;
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function drawBox(page, at, half = 25) {
  await page.getByTitle('Box (r)').click();
  await drag(page, { x: at.x - half, y: at.y - half * 0.6 }, { x: at.x + half, y: at.y + half * 0.6 });
}

async function placeLabel(page, at, text) {
  await page.getByTitle('Text (t)').click();
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('a label reads the same size on a small picture and on a large one', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [small, large] = await surfacesOnScreen(page);
  await placeLabel(page, { x: small.cx - 20, y: small.cy }, 'small');
  await placeLabel(page, { x: large.cx - 20, y: large.cy }, 'large');
  const spec = await save(page, fixture);
  const [a, b] = await Promise.all(spec.shapes.map((s) => markOf(page, s.id)));
  expect(a.font).toBeCloseTo(28, 1);
  expect(b.font).toBeCloseTo(28, 1);
  fixture.expectNoUnexpectedRequests();
});

test('a box, a label and a marker carried onto the other panel keep their size', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [small, large] = await surfacesOnScreen(page);
  await drawBox(page, { x: small.cx, y: small.cy - 30 });
  await placeLabel(page, { x: small.cx - 40, y: small.cy + 20 }, 'here');
  await page.getByTitle('Numbered marker (n)').click();
  await page.mouse.click(small.x + 30, small.cy + 10);
  await page.getByTitle('Select / move (v)').click();
  await page.keyboard.press('Escape');
  const before = await save(page, fixture);
  expect(new Set(before.shapes.map((s) => s.panel))).toEqual(new Set([small.id]));

  for (const s of before.shapes) {
    const was = await markOf(page, s.id);
    // a hollow box answers on its outline, the others anywhere on them
    const grip = { x: s.kind === 'rect' ? was.left + 0.5 : was.cx, y: was.cy };
    await drag(page, grip, { x: grip.x - (small.cx - large.cx), y: grip.y });
    // the drop is drawn again inside the panel that took it
    await expect.poll(async () => (await markOf(page, s.id)).surface, { message: s.kind }).toBe(large.id);
    const now = await markOf(page, s.id);
    // words are laid out again at the new picture's scale, a half-pixel either way
    const slack = s.kind === 'text' ? 1.5 : 0.5;
    expect(Math.abs(now.w - was.w), s.kind).toBeLessThan(slack);
    expect(Math.abs(now.h - was.h), s.kind).toBeLessThan(slack);
    if (s.kind === 'rect') expect(now.stroke).toBeCloseTo(was.stroke, 1);
    // and it lands where it was let go
    expect(Math.abs(now.cx - (was.cx - (small.cx - large.cx))), s.kind).toBeLessThan(2);
  }
  const after = await save(page, fixture);
  expect(new Set(after.shapes.map((s) => s.panel))).toEqual(new Set([large.id]));
  fixture.expectNoUnexpectedRequests();
});

test('two picked marks dragged across the border keep their sizes and their gap', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const surfaces = await surfacesOnScreen(page);
  const [left, right] = [...surfaces].sort((p, q) => p.x - q.x);
  const y = right.cy;
  await drawBox(page, { x: right.x + 18, y }, 8);
  await drawBox(page, { x: right.x + 60, y }, 8);
  const spec = await save(page, fixture);
  const rows = page.locator('.shape-row');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  const was = await Promise.all(spec.shapes.map((s) => markOf(page, s.id)));
  // the nearer one crosses into the left panel, the other stays where it was
  const first = was.reduce((p, q) => (p.cx < q.cx ? p : q));
  await drag(page, { x: first.cx, y: first.cy }, { x: first.cx - 30, y: first.cy });
  const where = async () => new Set((await Promise.all(spec.shapes.map((s) => markOf(page, s.id)))).map((m) => m.surface));
  await expect.poll(where).toEqual(new Set([left.id, right.id]));
  const now = await Promise.all(spec.shapes.map((s) => markOf(page, s.id)));
  now.forEach((m, i) => expect(m.w).toBeCloseTo(was[i].w, 0));
  expect(now[1].cx - now[0].cx).toBeCloseTo(was[1].cx - was[0].cx, 0);
  fixture.expectNoUnexpectedRequests();
});

test('Shift+arrow and Ctrl+D step the same distance on every panel', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const steps = [];
  for (const surface of await surfacesOnScreen(page)) {
    await drawBox(page, { x: surface.cx, y: surface.cy });
    const spec = await save(page, fixture);
    const id = spec.shapes.at(-1).id;
    const start = await markOf(page, id);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await markOf(page, id)).x).not.toBeCloseTo(start.x, 1);
    const nudged = await markOf(page, id);
    await page.keyboard.press('Control+d');
    const copy = (await save(page, fixture)).shapes.at(-1);
    const pasted = await markOf(page, copy.id);
    steps.push({ nudge: nudged.x - start.x, paste: pasted.x - nudged.x, size: pasted.w - nudged.w });
  }
  for (const step of steps) {
    expect(step.nudge).toBeCloseTo(10, 1);
    expect(step.paste).toBeCloseTo(26, 1);
    expect(step.size).toBeCloseTo(0, 1);
  }
  fixture.expectNoUnexpectedRequests();
});

test('a mark copied on an overlay is pasted onto the overlay', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 400, 300);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.querySelector('.konva').dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.paste-row')).toHaveCount(1);
  const box = await page.locator('.konva canvas').first().boundingBox();
  await drawBox(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 12);
  const first = await save(page, fixture);
  const original = await markOf(page, first.shapes[0].id);

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.shape-row')).toHaveCount(2);
  const spec = await save(page, fixture);
  const copy = spec.shapes.find((s) => s.id !== first.shapes[0].id);
  expect(copy.panel).toBe(spec.pastes[0].id);
  const pasted = await markOf(page, copy.id);
  expect(pasted.w).toBeCloseTo(original.w, 0);
  expect(pasted.x - original.x).toBeCloseTo(26, 0);
  fixture.expectNoUnexpectedRequests();
});

test('a panel moved, enlarged or dragged over another keeps its marks, at the same line width', async ({ page }) => {
  const fixture = await openTwoPanels(page);
  const [small, large] = await surfacesOnScreen(page);
  await drawBox(page, { x: small.cx, y: small.cy });
  const drawn = (await save(page, fixture)).shapes[0];
  const was = await markOf(page, drawn.id);

  // a bigger panel draws its marks over more room, at the same line width
  const smallRow = page.locator('.panel-row').filter({ has: page.locator(`img[src*="${PANEL_PATH.split('/').pop()}"]`) });
  for (let i = 0; i < 4; i++) await smallRow.getByTitle('Enlarge panel').click();
  await expect(smallRow.locator('.scale-val')).not.toHaveText('100%');
  const scale = Number((await smallRow.locator('.scale-val').textContent()).replace('%', '')) / 100;
  await expect.poll(async () => (await markOf(page, drawn.id)).w)
    .toBeCloseTo((was.w - was.stroke) * scale + was.stroke, 0);
  expect((await markOf(page, drawn.id)).stroke).toBeCloseTo(was.stroke, 1);

  // free layout: the panel is dragged onto the other one and its marks go with it
  await page.getByTitle('Layout, tweet crops & repack').click();
  await page.getByTitle('Free layout: drag panels anywhere').click();
  const now = (await surfacesOnScreen(page)).find((s) => s.id === small.id);
  const target = (await surfacesOnScreen(page)).find((s) => s.id === large.id);
  await smallRow.locator('.panel-thumb').click();
  await expect(smallRow).toHaveClass(/selected/);
  const grip = { x: now.x + 8, y: now.y + 8 };
  await drag(page, grip, { x: target.cx, y: target.cy });
  await expect.poll(async () => (await surfacesOnScreen(page)).find((x) => x.id === small.id).x)
    .not.toBeCloseTo(now.x, 0);
  const spec = await save(page, fixture);
  const kept = spec.shapes.find((s) => s.id === drawn.id);
  expect(kept.panel).toBe(small.id);
  expect(kept).toMatchObject({ x: drawn.x, y: drawn.y, w: drawn.w, h: drawn.h });
  expect((await markOf(page, drawn.id)).surface).toBe(small.id);
  fixture.expectNoUnexpectedRequests();
});

test('a box drawn on a turned panel lands under the pointer', async ({ page }) => {
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  await page.locator('.panel-thumb').click();
  const canvasBox = await page.locator('.konva canvas').first().boundingBox();
  const knob = await page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const transformer = stage.find((node) => node.getClassName() === 'Transformer')[0];
    return {
      centre: transformer.nodes()[0].getAbsolutePosition(),
      handle: transformer.findOne('.rotater').getAbsolutePosition(),
    };
  });
  const radius = Math.hypot(knob.handle.x - knob.centre.x, knob.handle.y - knob.centre.y);
  await drag(
    page,
    { x: canvasBox.x + knob.handle.x, y: canvasBox.y + knob.handle.y },
    { x: canvasBox.x + knob.centre.x + radius * 0.6, y: canvasBox.y + knob.centre.y - radius * 0.8 },
  );
  // The turn re-flows the page; aim once the panel has stopped moving. The two
  // corners are taken in the picture's own frame, a third of the way down it so
  // they stay on screen: a box is square to its picture, so a drag along the
  // turned edge would draw one with no height.
  const corners = () => page.evaluate(() => {
    const stage = window.Konva.stages.find((s) => s.container().isConnected);
    const hit = stage.findOne('.panel-hit');
    const group = hit.getParent();
    const c = stage.container().getBoundingClientRect();
    const at = (x, y) => {
      const p = group.getAbsoluteTransform().point({ x, y });
      return { x: c.left + p.x, y: c.top + p.y };
    };
    const [w, h] = [hit.width(), hit.height()];
    return { from: at(w * 0.4, h * 0.25), to: at(w * 0.6, h * 0.45), turn: group.rotation() };
  });
  let last = null;
  await expect.poll(async () => {
    const now = await corners();
    const settled = last && Math.abs(now.from.x - last.from.x) < 0.5 && Math.abs(now.from.y - last.from.y) < 0.5;
    last = now;
    return settled;
  }, { intervals: [100] }).toBe(true);
  expect(Math.abs(last.turn)).toBeGreaterThan(20);
  const { from, to } = last;
  await page.getByTitle('Box (r)').click();
  await drag(page, from, to);
  const drawn = (await save(page, fixture)).shapes[0];
  const mark = await markOf(page, drawn.id);
  expect(Math.abs(mark.cx - (from.x + to.x) / 2)).toBeLessThan(2);
  expect(Math.abs(mark.cy - (from.y + to.y) / 2)).toBeLessThan(2);
  fixture.expectNoUnexpectedRequests();
});

test('real Ctrl+C and Ctrl+V keys duplicate the picked mark', async ({ page }) => {
  // The other copy tests dispatch the paste event themselves; this one presses
  // the keys, which is what Firefox has to turn into that event on its own.
  const fixture = await installAppFixture(page);
  await openProofWithPanel(page);
  const box = await page.locator('.konva canvas').first().boundingBox();
  await drawBox(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.locator('.shape-row').first().click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.shape-row')).toHaveCount(2);
  await page.keyboard.press('Control+d');
  await expect(page.locator('.shape-row')).toHaveCount(3);
  fixture.expectNoUnexpectedRequests();
});
