import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture } from './app.fixture.js';

async function openCompare(page, providerB = 'Esri World Imagery') {
  const fixture = await installAppFixture(page);
  const errors = [];
  const saved = [];
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
    { id: 'esri-wayback', label: 'Esri Wayback', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  await page.route('**/api/satellite/wayback/releases', (route) => route.fulfill({ json: { releases: [{ release: 2, date: '2021-01-01' }, { release: 1, date: '2020-01-01' }] } }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/cases/*/compare/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { name: 'Comparison', title: 'Comparison' } });
    } else await route.fulfill({ json: [] });
  });
  await page.route('**/compare/sessions/*/preview', (route) => route.fulfill({ json: { path: 'media/Comparison.png' } }));
  await page.goto('/#compare');
  // Compare opens on its default pair; these tests build their own.
  await expect(page.locator('.surface-shell').first()).toBeVisible();
  for (const letter of ['A', 'B']) {
    const remove = page.getByRole('button', { name: `Remove imagery ${letter}`, exact: true });
    if (await remove.count()) await remove.click();
  }
  await expect(page.locator('.empty-slot')).toHaveCount(2);
  for (const letter of ['A', 'B']) {
    await page.locator('.empty-slot').filter({ has: page.locator('.slot-letter', { hasText: letter }) }).click();
    await page.locator('.provider-card').filter({ hasText: letter === 'A' ? 'Esri World Imagery' : providerB }).click();
  }
  await awaitMapReady(page, 2);
  return { fixture, errors, saved };
}

test('opens on a Wayback release a year back against today’s World Imagery', async ({ page }) => {
  await installAppFixture(page);
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'esri-world-imagery', label: 'Esri World Imagery', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
    { id: 'esri-wayback', label: 'Esri Wayback', url: 'https://tiles.invalid/{z}/{x}/{y}.png', imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  // a newest release no clock reaches, and one far older than a year
  await page.route('**/api/satellite/wayback/releases', (route) => route.fulfill({ json: { releases: [{ release: 2, date: '2099-01-01' }, { release: 1, date: '2020-01-01' }] } }));
  const history = [];
  page.on('request', (request) => request.url().includes('/wayback/changes') && history.push(request.url()));
  await page.goto('/#compare');
  await awaitMapReady(page, 2);
  await expect(page.locator('.empty-slot')).toHaveCount(0);
  await expect(page.locator('.wb-wrap .chip')).toContainText('2020-01-01');
  expect(history).toEqual([]);
});

test('linked maps keep annotations on the ground through pan, modes and save', async ({ page }) => {
  const { errors, saved } = await openCompare(page);
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  await page.getByTitle('Arrow (A)', { exact: true }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.annotation-canvas .mark')).toHaveCount(2);
  // The drawn outline, not the transparent band laid over it to be grabbed:
  // both carry the same `d`, so a bare `path` matches two and settles nothing.
  const outline = canvas.locator('.mark > path:not(.edge)');
  const before = await outline.getAttribute('d');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect(outline).not.toHaveAttribute('d', before);
  await expect.poll(async () => {
    const paths = await page.locator('.annotation-canvas .mark > path:not(.edge)').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('d')));
    const numbers = paths.map((path) => path.match(/-?\d+(?:\.\d+)?/g).map(Number));
    return Math.max(...numbers[0].map((n, i) => Math.abs(n - numbers[1][i])));
  }).toBeLessThan(1);
  await page.getByRole('button', { name: 'Swipe', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Swipe divider on imagery' })).toBeVisible();
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'B opacity' })).toBeVisible();
  await page.getByRole('button', { name: 'Blink', exact: true }).click();
  await page.getByRole('button', { name: 'Slow', exact: true }).click();
  await page.getByRole('button', { name: 'Save comparison', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save comparison', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].spec.version).toBe(2);
  expect(saved[0].spec.blink.interval).toBe(1600);
  expect(saved[0].spec.annotations[0].points[0][0]).toBeCloseTo(2.2945, 2);
  expect(saved[0].spec.annotations[0].points[0][1]).toBeCloseTo(48.8584, 2);
  await expect(page.getByText('Comparison and animated preview saved to My work', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('compare.png') });
  expect(errors).toEqual([]);
});

test('stamps a numbered marker and a symbol on the ground, and saves both', async ({ page }) => {
  const { errors, saved } = await openCompare(page);
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  const at = (dx, dy) => [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];

  // Two markers: one press each, the tool staying in hand between them.
  await page.getByTitle('Numbered marker (N)', { exact: true }).click();
  await page.mouse.click(...at(-40, 0));
  await page.mouse.click(...at(40, 0));
  await expect(canvas.locator('.numeral')).toHaveCount(2);
  expect(await canvas.locator('.numeral').allTextContents()).toEqual(['1', '2']);

  // A colour picked with the stamp still in hand is for the *next* marker, so
  // its series starts at 1 and the two already down keep the colour they have.
  await page.getByTitle('Annotation colour', { exact: true }).click();
  await page.getByLabel('Colour #22c55e').click();
  await page.mouse.click(...at(0, -40));
  expect(await canvas.locator('.numeral').allTextContents()).toEqual(['1', '2', '1']);

  // The symbol button opens its grid with the tool; a glyph picked, then stamped.
  await page.getByTitle('Symbol (S)', { exact: true }).click();
  await page.locator('.flyout.glyphs .glyph-button').nth(2).click();
  await page.mouse.click(...at(0, 50));
  await expect(canvas.locator('.mark')).toHaveCount(4);

  // The symbol button is also its picker: with the stamp in hand it opens the
  // grid again, and the press with the grid open is the one that puts it down.
  await page.getByTitle('Symbol (S)', { exact: true }).click();
  await expect(page.locator('.flyout.glyphs')).toBeVisible();
  await page.getByTitle('Symbol (S)', { exact: true }).click();
  await expect(page.getByTitle('Select and move (V)', { exact: true })).toHaveAttribute('aria-pressed', 'true');
  // …and every other tool puts itself down on the second press
  await page.getByTitle('Numbered marker (N)', { exact: true }).click();
  await page.getByTitle('Numbered marker (N)', { exact: true }).click();
  await expect(page.getByTitle('Select and move (V)', { exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Save comparison', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save comparison', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  const marks = saved[0].spec.annotations;
  expect(marks.map((mark) => mark.kind)).toEqual(['number', 'number', 'number', 'icon']);
  expect(marks.map((mark) => mark.number)).toEqual([1, 2, 1, 1]);
  expect(marks.map((mark) => mark.colour)).toEqual(
    ['#f6a81a', '#f6a81a', '#22c55e', '#22c55e']
  );
  expect(marks[2].glyph).toBeTruthy();
  expect(marks[0].points).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('an export frame can be drawn across every overlaid reading mode', async ({ page }) => {
  const { errors, saved } = await openCompare(page);

  for (const mode of ['Fade', 'Swipe', 'Blink']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export a copy' });
    await dialog.getByRole('button', { name: /^(Draw|Redraw)…$/ }).click();

    const stage = await page.locator('.compare-stage').boundingBox();
    const overlay = page.locator('.compare-stage > .export-frame.drawing');
    await expect(overlay).toBeVisible();
    const frame = await overlay.boundingBox();
    expect(frame.x).toBeCloseTo(stage.x, 0);
    expect(frame.width).toBeCloseTo(stage.width, 0);
    await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.8, stage.y + stage.height * 0.75, { steps: 5 });
    await page.mouse.up();

    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.destination-actions').getByRole('button')).toHaveText(['Redraw…', 'Clear']);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Save comparison', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save comparison' })
    .getByRole('button', { name: 'Save comparison', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].spec.frame.points).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('spectral frames are requested only by Run, including after reopening and moving', async ({ page }) => {
  await installAppFixture(page);
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/satellite/providers', (route) => route.fulfill({ json: [
    { id: 'sentinel2', label: 'Sentinel-2', url: 'https://tiles.invalid/{z}/{x}/{y}.png',
      imagery: true, max_zoom: 19, tile_size: 256, oversample: 1, attribution: 'Browser fixture' },
  ] }));
  await page.route('**/api/satellite/sentinel/**', (route) => route.fulfill({ json:
    route.request().url().includes('/layers') ? { layers: [{ id: 'TRUE_COLOR', title: 'True colour' }] } : { days: [] },
  }));
  const side = (day) => ({ present: true, provider: 'sentinel2', overlays: [],
    sentinel: { layer: 'TRUE_COLOR', date: day, maxcc: 100 } });
  await page.route('**/api/cases/*/compare/sessions', (route) => route.fulfill({ json: [{ name: 'Spectral', title: 'Spectral', mode: 'change' }] }));
  await page.route('**/api/cases/*/compare/sessions/Spectral', (route) => route.fulfill({ json: {
    title: 'Spectral', spec: { version: 2, camera: { lat: 48.8584, lon: 2.2945, zoom: 16, bearing: 35 },
      mode: 'change', change_assist: { method: 'index' }, a: side('2026-08-01'), b: side('2026-09-01') },
  } }));
  await page.route('**/api/compare/sentinel-frame', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const png = await page.evaluate(({ width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(128,4,0)';
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL().split(',')[1];
    }, body);
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  await page.goto('/#compare');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('.session-open').click();
  await awaitMapReady(page, 2);
  // Reopening a Difference session brings its strip with it; nothing to click.
  await expect(page.getByLabel('Difference', { exact: true })).toBeVisible();
  await expect(page.locator('button[aria-label="Reset to north"] + button')).toHaveText('35°');
  await page.getByRole('button', { name: 'Difference settings', exact: true }).click();
  await expect(page.getByLabel('Method', { exact: true })).toHaveValue('index');
  expect(requests).toHaveLength(0);
  // Read sits on the strip, so pressing it leaves the settings open.
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('aside.settings')).toBeVisible();
  expect(requests.map((request) => request.day)).toEqual(['2026-08-01', '2026-09-01']);
  const box = await page.locator('.compare-stage').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 130, { steps: 8 });
  await page.mouse.up();
  // The press on the map put the settings away, and the pan spent nothing.
  await expect(page.locator('aside.settings')).toBeHidden();
  await expect(page.locator('.secondary .change-map')).not.toHaveCSS('transform', 'none');
  await expect(page.getByRole('button', { name: 'Read', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(2);
  // The cloud filter reads Sentinel-2's own classification, so switching it on
  // over a picture method asks for the sky then and there, rather than leaving
  // an unfiltered reading up behind an "on" switch.
  await page.getByRole('button', { name: 'Difference settings', exact: true }).click();
  await page.getByLabel('Method', { exact: true }).selectOption('colour');
  await page.getByRole('button', { name: /Clouds & shadows/ }).click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests.slice(2).map((request) => request.product)).toEqual(['sky', 'sky']);
  expect(errors).toEqual([]);
});

test('changes run in the worker and export a composed PNG', async ({ page }) => {
  const { errors } = await openCompare(page, 'Esri Wayback');
  const exports = [];
  await page.route('**/api/cases/*/plates', async (route) => {
    exports.push(route.request().postDataJSON());
    await route.fulfill({ json: { file: 'comparison.png', path: '' } });
  });
  await page.getByRole('button', { name: 'Difference', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.change-legend')).toContainText('highlighted');
  // Highlights that come and go are easier to catch over busy imagery.
  await page.getByRole('button', { name: 'Blink the highlights', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeHidden();
  await expect(page.locator('.secondary .change-map')).toBeVisible();
  await page.getByRole('button', { name: 'Stop blinking the highlights', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible();
  await page.getByRole('button', { name: 'Difference settings', exact: true }).click();
  await page.getByLabel('Method', { exact: true }).selectOption('structure');
  await expect(page.locator('aside.settings .readout')).toContainText('coverage');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export copy', exact: true }).click();
  await expect.poll(() => exports.length).toBe(1);
  expect(Buffer.from(exports[0].png, 'base64').subarray(1, 4).toString()).toBe('PNG');
  expect(errors).toEqual([]);
});

/** Turn the shared camera to an exact bearing from the compass. */
async function turnTo(page, degrees) {
  await page.getByTitle('Click to type an exact angle', { exact: true }).first().click();
  const input = page.getByLabel('Set bearing in degrees', { exact: true });
  await input.fill(String(degrees));
  await input.press('Enter');
  await expect(page.getByTitle('Click to type an exact angle', { exact: true }).first())
    .toContainText(`${degrees}`);
}

/** The corners of an outline path, as [x, y] pairs. */
const cornersOf = (d) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

test('on a turned map a box runs along the screen, and turns from its grip', async ({ page }) => {
  const { errors, saved } = await openCompare(page);
  await turnTo(page, 30);
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.getByTitle('Box (R)', { exact: true }).click();
  await page.mouse.move(cx - 80, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
  await page.mouse.up();

  const outline = canvas.locator('.mark > path:not(.edge)');
  const drawn = cornersOf(await outline.getAttribute('d'));
  // Along the screen it was drawn on: level sides, the size the drag covered.
  expect(drawn).toHaveLength(4);
  expect(Math.abs(drawn[1][1] - drawn[0][1])).toBeLessThan(1);
  expect(length(drawn[0], drawn[1])).toBeCloseTo(160, -1);
  expect(length(drawn[1], drawn[2])).toBeCloseTo(80, -1);

  // A quarter turn from the grip stands it on end about its centre.
  const grip = canvas.locator('.turn circle').last();
  const at = await grip.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy, { steps: 8 });
  await page.mouse.up();
  const turned = cornersOf(await outline.getAttribute('d'));
  const xs = turned.map((point) => point[0] - box.x);
  const ys = turned.map((point) => point[1] - box.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, -1);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(160, -1);

  await page.getByRole('button', { name: 'Save comparison', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save comparison', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  // Drawn with the map turned 30° clockwise (compass 330° up), then a quarter turn.
  expect(saved[0].spec.annotations[0].angle).toBeCloseTo(60, 0);
  expect(errors).toEqual([]);
});

test('a drag inside a box pans the map, and a right-click on the box opens its point menu', async ({ page }) => {
  const { errors } = await openCompare(page);
  const canvas = page.getByLabel('Annotations on imagery A', { exact: true });
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // A marker off to the side stays on the ground, so it tells whether the map moved.
  await page.getByTitle('Numbered marker (N)', { exact: true }).click();
  await page.mouse.click(cx + 200, cy + 120);
  await page.getByTitle('Box (R)', { exact: true }).click();
  await page.mouse.move(cx - 100, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 60, { steps: 6 });
  await page.mouse.up();

  const outline = canvas.locator('.mark > path.body');
  const numeral = canvas.locator('.numeral');
  const markerAt = async () => [Number(await numeral.getAttribute('x')), Number(await numeral.getAttribute('y'))];
  const boxBefore = cornersOf(await outline.getAttribute('d'));
  const markerBefore = await markerAt();

  // Well inside the box, away from its outline: the drag is the map's.
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await markerAt())[0] - markerBefore[0]).toBeGreaterThan(30);
  const markerAfter = await markerAt();
  const boxAfter = cornersOf(await outline.getAttribute('d'));
  // The box went with the ground and no further: it was not picked up.
  expect(boxAfter[0][0] - boxBefore[0][0]).toBeCloseTo(markerAfter[0] - markerBefore[0], 0);
  expect(boxAfter[0][1] - boxBefore[0][1]).toBeCloseTo(markerAfter[1] - markerBefore[1], 0);

  // Its outline answers a right-click with the menu of the point under it.
  const [left, right] = [boxAfter[0], boxAfter[1]];
  await page.mouse.click(box.x + (left[0] + right[0]) / 2, box.y + (left[1] + right[1]) / 2, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'This point' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the export frame keeps its shape when the camera turns, and still exports', async ({ page }) => {
  // Tall enough for the frame's four corners to stay in view once it is turned.
  await page.setViewportSize({ width: 1600, height: 1100 });
  const { errors } = await openCompare(page);
  const exports = [];
  await page.route('**/api/cases/*/plates', async (route) => {
    exports.push(route.request().postDataJSON());
    await route.fulfill({ json: { file: 'comparison.png', path: '' } });
  });
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export a copy' });
  await dialog.getByRole('button', { name: 'Draw…', exact: true }).click();
  const stage = await page.locator('.compare-stage').boundingBox();
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  await page.mouse.move(cx - 170, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 170, cy + 110, { steps: 5 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  const edge = page.locator('.compare-stage > .export-frame .edge');
  const [a, b, c, d] = cornersOf(await edge.getAttribute('d'));
  await turnTo(page, 40);
  await expect.poll(async () => cornersOf(await edge.getAttribute('d'))[0][1]).not.toBeCloseTo(a[1], 0);
  const [e, f, g, h] = cornersOf(await edge.getAttribute('d'));
  // Same sides and diagonals: turned with the ground, not stretched to the screen.
  expect(length(e, f)).toBeCloseTo(length(a, b), 0);
  expect(length(f, g)).toBeCloseTo(length(b, c), 0);
  expect(length(e, g)).toBeCloseTo(length(f, h), 0);
  expect(length(e, g)).toBeCloseTo(length(a, c), 0);
  expect(d).toBeTruthy();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: 'Export copy', exact: true }).click();
  await expect.poll(() => exports.length).toBe(1);
  const png = Buffer.from(exports[0].png, 'base64');
  // Upright as drawn: the picture is the frame's own width, not the turned box around it.
  expect(png.readUInt32BE(16)).toBe(Math.round(length(a, b)));
  expect(errors).toEqual([]);
});

test("Difference's settings stay put through a read, lie over the highlights, and close outside", async ({ page }) => {
  const { errors } = await openCompare(page, 'Esri Wayback');
  await page.getByRole('button', { name: 'Difference', exact: true }).click();
  await expect(page.locator('.secondary .change-map')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Difference settings', exact: true }).click();
  const panel = page.locator('aside.settings');
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();

  // A read in flight used to widen the strip, and the panel hanging off it moved.
  await page.getByLabel('Method', { exact: true }).selectOption('structure');
  await expect(panel.locator('.readout')).toContainText('coverage', { timeout: 20000 });
  const after = await panel.boundingBox();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.height).toBeCloseTo(before.height, 0);

  // Over the highlights, not under them.
  const inside = await page.evaluate(({ x, y }) =>
    !!document.elementFromPoint(x, y)?.closest('aside.settings'),
  { x: after.x + 20, y: after.y + 20 });
  expect(inside).toBe(true);

  // A press on the map beside it closes it.
  const stage = await page.locator('.compare-stage').boundingBox();
  await page.mouse.click(stage.x + 80, stage.y + 80);
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});
