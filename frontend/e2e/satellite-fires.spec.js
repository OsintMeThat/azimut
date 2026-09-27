import { test, expect } from '@playwright/test';
import { awaitMapReady, installAppFixture, mapPicture } from './app.fixture.js';

/**
 * Active fires in a real browser.
 *
 * The map draws every detection itself, from vector tiles, at every zoom: a
 * square keeps its size through a zoom and stays where it is while the next
 * level loads, where FIRMS's pictures swelled with their pixels. Whether a
 * tinted square paints at all depends on the engine reading the distance field
 * it was given, and whether the marks are kept while a level loads is the
 * engine's overzooming, so both are proved here rather than in a unit test
 * that stubs the engine out.
 */

const hud = (page) => page.locator('.hud-coords').first();
/** FIRMS's picture of a patch with nothing burning. */
const CLEAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==',
  'base64'
);

/** A protobuf varint, and a length-delimited field around some bytes. */
function varint(value) {
  const out = [];
  let rest = value;
  while (rest > 127) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}
const field = (number, bytes) => [...varint((number << 3) | 2), ...varint(bytes.length), ...bytes];
const text = (value) => [...Buffer.from(value)];
const zigzag = (n) => (n << 1) ^ (n >> 31);

/** A vector tile of recent 375 m marks at these tile coordinates, laid out as
 *  `engine/mvt.py` writes them: one MultiPoint in a layer named `marks`. */
function marksTile(points) {
  const geometry = [(points.length << 3) | 1];
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    geometry.push(zigzag(px - x), zigzag(py - y));
    [x, y] = [px, py];
  }
  const feature = [...field(2, [0, 0, 1, 1]), ...varint(3 << 3), 1, ...field(4, geometry.flatMap(varint))];
  const uint = (value) => field(4, [...varint(5 << 3), ...varint(value)]);
  const layer = [
    ...varint(15 << 3), 2, ...field(1, text('marks')), ...field(2, feature),
    ...field(3, text('recent')), ...field(3, text('side')), ...uint(1), ...uint(375),
    ...varint(5 << 3), ...varint(4096),
  ];
  return Buffer.from(field(3, layer));
}

/** FIRMS behind the fixture: a key that works, marks in every tile. */
async function withFires(page) {
  const asked = { points: [], pictures: [] };
  await page.route('**/api/firms/sensors', (route) => route.fulfill({ json: {
    keyed: true, state: 'ready', paused: null,
    sensors: [{ id: 'viirs', label: 'VIIRS (S-NPP, NOAA-20, NOAA-21)' }],
    windows: ['24h', '48h', '72h', '7d'], max_zoom: 13, max_range_days: 31,
  } }));
  const tile = marksTile([[2048, 2048], [1024, 1024], [3072, 3072], [1024, 3072]]);
  await page.route('**/api/firms/points/**', (route) => {
    asked.points.push(Number(new URL(route.request().url()).pathname.split('/').at(-3)));
    return route.fulfill({ contentType: 'application/vnd.mapbox-vector-tile', body: tile });
  });
  await page.route('**/api/firms/tiles/**', (route) => {
    asked.pictures.push(Number(new URL(route.request().url()).pathname.split('/').at(-3)));
    return route.fulfill({ contentType: 'image/png', body: CLEAR_PNG });
  });
  return asked;
}

/** How many pixels of the map are FIRMS's recent red. */
async function redPixels(page) {
  const picture = await mapPicture(page);
  return page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 225 && data[i + 1] < 90 && data[i + 2] < 50) red += 1;
    return red;
  }, [...picture]);
}

async function wheelTo(page, level) {
  const box = await page.locator('.map').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let guard = 0; guard < 20; guard += 1) {
    const now = Number(/z(\d+)/.exec(await hud(page).innerText())[1]);
    if (now === level) return;
    await page.mouse.wheel(0, now > level ? 120 : -120);
    await expect(hud(page)).toContainText(`z${now > level ? now - 1 : now + 1}`);
  }
}

test('the map draws the fires itself, close in and far out, and lays no picture of them', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await installAppFixture(page);
  const asked = await withFires(page);
  await page.goto('/#satellite');
  await awaitMapReady(page);
  const fires = page.getByRole('button', { name: 'Active fires', exact: true });
  if (!(await fires.isVisible())) await page.getByRole('button', { name: /Layers/ }).first().click();
  const before = await redPixels(page);
  await fires.click();

  // z10 on the readout is engine zoom 9, where the tiles carry the detections
  await wheelTo(page, 10);
  await expect.poll(() => asked.points.includes(9)).toBe(true);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(before + 40);

  // z7 is engine zoom 6, where they are read off FIRMS's picture: marks all the same
  await wheelTo(page, 7);
  await expect.poll(() => asked.points.includes(6)).toBe(true);
  await expect.poll(() => redPixels(page)).toBeGreaterThan(before + 40);
  // the map never lays a picture of the fires of its own
  expect(asked.pictures).toEqual([]);
  expect(errors).toEqual([]);
});
