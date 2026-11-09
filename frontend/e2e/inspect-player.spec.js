import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

// Thirty frames at 25 fps, 32 px square, each one flat grey at eight times its own
// index: whatever the browser draws says which frame it is. Lossless VP9, so the
// grey survives the round trip to within a step of rounding.
const STEPS_WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAgtEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggX77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECSwAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhSaj/es0qbKZyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgkLCBILqBIJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYwLjE2LjEwMHNz2mPAi2PFiFJqP96zSpspZ8ilRaOHRU5DT0RFUkSHmExhdmM2MC4zMS4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMjAwMDAwMDAwAB9DtnVESueBAKOkgQAAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////bJ+AArEsAAo6OBACiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///9mkoAFYlgKOjgQBQgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////WngACsSwCjo4EAeICCSYNCAAHwAfYAOCQcGAAAACAAAF8////0lgAArEsAo6OBAKCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///8vXgAViWAKOjgQDIgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////DLuABWJYCjo4EA8ICCSYNCAAHwAfYAOCQcGAAAACAAAF8////v5iAArEsAo6OBARiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///7imwAKxLAKOjgQFAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///+u9gAFYlgCjo4EBaICCSYNCAAHwAfYAOCQcGAAAACAAAF8////m5UACsSwAo6OBAZCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///4O0ABWJYAKOigQG4gIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///9YLAArEsKOigQHggIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///8ePAArEsKOigQIIgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///62uABWJYKOhgQIwgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///X8ACsSwo6KBAliAgkmDQgAB8AH2ADgkHBgAAAAgAABfP//F8AArEsAAo5+BAoCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP2mACsSwo6GBAqiAgkmDQgAB8AH2ADgkHBgAAAAgAABjfP9aAAKglwCjooEC0ICCSYNCAAHwAfYAOCQcGAAAACAAAF8//+bQACsSwACjooEC+ICCSYNCAAHwAfYAOCQcGAAAACAAAF8///+TcAAViWCjooEDIICCSYNCAAHwAfYAOCQcGAAAACAAAF8///+2kAAViWCjooEDSICCSYNCAAHwAfYAOCQcGAAAACAAAF8////L8gAKxLCjo4EDcICCSYNCAAHwAfYAOCQcGAAAACAAAF8////beQAFYlgAo6OBA5iAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///45OAArEsAKOjgQPAgIJJg0IAAfAB9gA4JBwYAAAAIAAAXz///+lNAAKxLACjo4ED6ICCSYNCAAHwAfYAOCQcGAAAACAAAF8////s8EABWJYAo6OBBBCAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///7v0AAViWAKOjgQQ4gIJJg0IAAfAB9gA4JBwYAAAAIAAAXz////BYoACsSwCjo4EEYICCSYNCAAHwAfYAOCQcGAAAACAAAF8////w8kAAViWAo6OBBIiAgkmDQgAB8AH2ADgkHBgAAAAgAABfP///85NAAViWABxTu2tCLLuPs4EAt4r3gQHxggGr8IEDu4+zgSi3iveBAfGCAavwgSm7j7OBULeK94EB8YIBq/CBTruPs4F4t4r3gQHxggGr8IFzu4+zgaC3iveBAfGCAavwgZi7j7OByLeK94EB8YIBq/CBvbuPs4Hwt4r3gQHxggGr8IHiu5GzggEYt4v3gQHxggGr8IIBB7uRs4IBQLeL94EB8YIBq/CCASy7kbOCAWi3i/eBAfGCAavwggFRu5GzggGQt4v3gQHxggGr8IIBdruRs4IBuLeL94EB8YIBq/CCAZu7kbOCAeC3i/eBAfGCAavwggG/u5GzggIIt4v3gQHxggGr8IIB47uRs4ICMLeL94EB8YIBq/CCAge7kbOCAli3i/eBAfGCAavwggIqu5GzggKAt4v3gQHxggGr8IICTruRs4ICqLeL94EB8YIBq/CCAm+7kbOCAtC3i/eBAfGCAavwggKSu5GzggL4t4v3gQHxggGr8IICtruRs4IDILeL94EB8YIBq/CCAtq7kbOCA0i3i/eBAfGCAavwggL+u5GzggNwt4v3gQHxggGr8IIDIruRs4IDmLeL94EB8YIBq/CCA0e7kbOCA8C3i/eBAfGCAavwggNsu5GzggPot4v3gQHxggGr8IIDkbuRs4IEELeL94EB8YIBq/CCA7a7kbOCBDi3i/eBAfGCAavwggPbu5GzggRgt4v3gQHxggGr8IIEALuRs4IEiLeL94EB8YIBq/CCBCU=', 'base64');
const STEPS = 'media/steps.webm';
const FPS = 25;

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ viewport: { width: 1500, height: 820 } });

/**
 * A file answered in byte ranges, as the app's file route does: a browser only
 * seeks a video whose server says it can.
 */
function serveRange(route, body, contentType) {
  const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? '');
  if (!range) {
    return route.fulfill({ status: 200, contentType, body, headers: { 'Accept-Ranges': 'bytes' } });
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  return route.fulfill({
    status: 206,
    contentType,
    body: body.subarray(start, end + 1),
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` },
  });
}

/** The fixture with one video, and Inspect's routes answered the way the server does. */
async function openSteps(page, { scenes = [] } = {}) {
  const fixture = await installAppFixture(page, {
    media: [{
      path: STEPS, filename: 'steps.webm', title: 'Steps', kind: 'video', entity_id: 'e_steps',
      size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '',
    }],
  });
  const renders = [];
  const saves = [];
  const proofTimes = [];
  // Registered after the fixture, so these answer first.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${STEPS}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: 1.2, fps: FPS, width: 32, height: 32, codec: 'vp9' });
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
    if (path === `/api/cases/${CASE_ID}/scenes`) return json({ video: STEPS, video_id: 'e_steps', scenes });
    // A proof's moments, written the way the server writes them: the listed scene follows.
    const timed = /^\/api\/cases\/[^/]+\/proofs\/([^/]+)\/scene$/.exec(path);
    if (timed && request.method() === 'PUT') {
      const { moments } = request.postDataJSON();
      proofTimes.push(moments);
      const scene = scenes.find((sc) => sc.proof === decodeURIComponent(timed[1]));
      Object.assign(scene, { moments, stated: moments.length > 0 });
      return json({ proof: scene.proof, video: STEPS, moments, at: scene.at, stated: scene.stated, draft: null });
    }
    if (path === `/api/cases/${CASE_ID}/media/item`) return json({ kind: 'video', size: STEPS_WEBM.length, sha256: 'ab'.repeat(32), source: { type: 'upload' } });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && request.method() === 'GET') return json({ work: null });
    if (path === `/api/cases/${CASE_ID}/inspect/work` && request.method() === 'PUT') {
      saves.push(request.postDataJSON());
      return json({ name: 'Steps', title: 'Steps' });
    }
    if (path === `/api/cases/${CASE_ID}/inspect/render-preview`) {
      const body = request.postDataJSON();
      renders.push(body);
      // the server names the frame a player shows at the moment it is asked about
      const named = body.snap ? { 'X-Frame-Time': (Math.floor(body.time * FPS + 1e-6) / FPS).toFixed(6) } : {};
      return route.fulfill({ contentType: 'image/png', body: PIXEL_PNG, headers: named });
    }
    return route.fallback();
  });

  await page.goto('/#inspect');
  await page.locator('.card', { hasText: 'Steps' }).click();
  await page.waitForFunction(() => (document.querySelector('.video-canvas video')?.readyState ?? 0) >= 2);
  return { fixture, renders, saves, proofTimes };
}

/** Which frame the browser has on screen, read off its grey. */
function frameOnScreen(page) {
  return page.evaluate(() => {
    const video = document.querySelector('.video-canvas video');
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 4, 4);
    return Math.round(ctx.getImageData(1, 1, 1, 1).data[0] / 8);
  });
}

/** Seek the clip the way a drag on the bar does, and wait for the frame to be drawn. */
async function seekTo(page, time) {
  await page.evaluate((t) => new Promise((resolve) => {
    const video = document.querySelector('.video-canvas video');
    video.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true });
    video.currentTime = t;
  }), time);
}

test('captures the very frame on screen, by its own timestamp', async ({ page }) => {
  const { fixture, renders, saves } = await openSteps(page);

  // 0.5 s falls inside frame 12, which starts at 0.48
  await seekTo(page, 0.5);
  const shown = await frameOnScreen(page);
  expect(shown).toBe(12);
  await expect(page.locator('.player-time')).toContainText('frame 13 of 30');

  await expect(page.locator('.player-time')).toContainText('0:00.480');

  await page.keyboard.press('c');
  await expect.poll(() => renders.length).toBe(1);
  // the moment on screen, inside the frame: the browser's frame stamp or its playback time
  expect(renders[0].snap).toBe(true);
  expect(Math.floor(renders[0].time * FPS + 1e-6)).toBe(shown);
  await expect(page.locator('.strip > div.tile')).toHaveCount(1);
  await expect(page.locator('.pinned')).toContainText('Save the frame to the case');
  await expect.poll(() => saves.at(-1)?.spec?.frames?.[0]?.time).toBeCloseTo(shown / FPS, 6);
  fixture.expectNoUnexpectedRequests();
});

test('steps one frame from the frame on screen, whatever inside it the clip paused', async ({ page }) => {
  await openSteps(page);
  await seekTo(page, 0.5);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frameOnScreen(page)).toBe(13);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frameOnScreen(page)).toBe(14);
  await page.keyboard.press(',');
  await expect.poll(() => frameOnScreen(page)).toBe(13);
  await expect(page.locator('.player-time')).toContainText('0:00.520');
});

test('keeps Capture frame on top while the tabs change, and marks a moment from the keyboard', async ({ page }) => {
  const { saves } = await openSteps(page);
  await seekTo(page, 0.9);

  for (const name of ['Adjust', 'Info', 'Moments', /^Scenes/]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.locator('.pinned').getByRole('button', { name: /Capture frame/ })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Info' }).click();
  await page.keyboard.press('m');
  await expect(page.getByRole('tab', { name: /Moments/ })).toHaveAttribute('aria-selected', 'true');
  const label = page.getByRole('textbox', { name: 'Mark label' });
  await expect(label).toBeFocused();
  await label.fill('sign readable');
  await label.press('Enter');
  await expect.poll(() => saves.at(-1)?.spec?.marks).toEqual([{ id: expect.any(String), time: expect.closeTo(0.88, 6), label: 'sign readable' }]);
  await expect(page.locator('.track .mark')).toHaveCount(1);
});

test('keeps a scene at the frame on screen, ends it a moment later, beside the proofs already resting on the clip', async ({ page }) => {
  const depot = {
    kind: 'proof', proof: 'Depot', proof_id: 'e_depot', title: 'Depot', moments: [], at: [0.2],
    stated: false, draft: null, points: [{ lat: 1, lon: 2, coords: '1, 2', label: '', pov: false, place_id: null }],
    png: null, thumb: null, when: null, when_zone: null, description: null,
  };
  const { saves } = await openSteps(page, { scenes: [depot] });

  // the clip's scenes are counted on the first tab, and pinned on its bar
  await expect(page.getByRole('tab', { name: /^Scenes/ })).toContainText('1');
  await expect(page.getByTestId('scene-pin')).toHaveCount(1);

  await seekTo(page, 0.5);
  await page.keyboard.press('s');
  await expect.poll(() => saves.at(-1)?.spec?.scenes).toEqual([
    { id: expect.any(String), start: expect.closeTo(0.48, 1), end: null, label: '' },
  ]);
  // a scene kept by mistake goes back with Ctrl+Z, and forward again with Ctrl+Shift+Z
  await page.keyboard.press('Control+z');
  await expect.poll(() => saves.at(-1)?.spec?.scenes).toEqual([]);
  await expect(page.getByTestId('scene-pin')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.length).toBe(1);
  await seekTo(page, 0.9);
  await page.keyboard.press('Shift+S');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]?.end).toBeCloseTo(0.92, 1);
  await expect(page.getByTestId('scene-band')).toHaveCount(1);

  const rows = page.getByTestId('scene-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Depot');
  await expect(rows.first()).toContainText('Proved');
  // the scene just kept is the open one, its name ready to be typed
  const label = page.getByRole('textbox', { name: 'Scene label' });
  await label.fill('bridge?');
  await label.press('Enter');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]?.label).toBe('bridge?');
});

test('marks a captured frame with the colour of each scene it falls in, by its time alone', async ({ page }) => {
  const depot = {
    kind: 'proof', proof: 'Depot', proof_id: 'e_depot', title: 'Depot', moments: [], at: [0.2],
    stated: false, draft: null, points: [], png: null, thumb: null, when: null, when_zone: null, description: null,
  };
  const { saves } = await openSteps(page, { scenes: [depot] });
  const tiles = page.locator('.strip > div.tile');

  // a frame on the proof's own frame is in its scene; a capture makes no scene
  await seekTo(page, 0.2);
  await page.keyboard.press('c');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.nth(0).locator('.scene-dot')).toHaveCount(1);
  await expect(tiles.nth(0).getByTestId('scene-dots')).toHaveAttribute('title', 'In Depot');
  await expect(page.getByRole('tab', { name: /^Scenes/ })).toContainText('1');

  await seekTo(page, 0.5);
  await page.keyboard.press('s');
  await page.keyboard.press('c');
  await seekTo(page, 0.8);
  await page.keyboard.press('c');
  await expect(tiles).toHaveCount(3);
  // the frame at the instant is in it, the one after is not, until the scene ends past it
  await expect(tiles.nth(1).locator('.scene-dot')).toHaveCount(1);
  await expect(tiles.nth(2).locator('.scene-dot')).toHaveCount(0);
  await seekTo(page, 0.9);
  await page.keyboard.press('Shift+S');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]?.end).toBeCloseTo(0.92, 1);
  await expect(tiles.nth(2).locator('.scene-dot')).toHaveCount(1);
  await expect(tiles.nth(2).getByTestId('scene-dots')).toHaveAttribute('title', 'In a scene to geolocate');
});

test('offers a scene on a frame captured in none, the whole video or this instant, and keeps an instant there in one press', async ({ page }) => {
  const { saves } = await openSteps(page);

  await seekTo(page, 0.5);
  await page.keyboard.press('c');
  const add = page.getByRole('button', { name: 'This instant' });
  await expect(add).toBeVisible();
  const offer = page.locator('.toast', { has: add });
  await expect(offer).toContainText('Frame captured at 0:00.48 · Add a scene');
  await expect(offer.getByRole('button', { name: 'Whole video' })).toBeVisible();
  await add.click();
  await expect.poll(() => saves.at(-1)?.spec?.scenes).toEqual([
    { id: expect.any(String), start: expect.closeTo(0.48, 3), end: null, label: '' },
  ]);
  await expect(page.locator('.strip > div.tile .scene-dot')).toHaveCount(1);
  await expect(add).toHaveCount(0);
});

/** The Scenes tab, the scene at `index` open with its time showing. */
async function openTime(page, index = 0) {
  await page.getByRole('tab', { name: /^Scenes/ }).click();
  const row = page.getByTestId('scene-row').nth(index);
  if (await row.evaluate((node) => node.tagName === 'BUTTON')) await row.click();
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toBeVisible();
}

/** Where on the bar a time is, in page pixels. */
async function onBar(page, time) {
  const box = await page.locator('.track').boundingBox();
  return { x: box.x + (box.width * time) / 1.2, y: box.y + box.height / 2 };
}

const seconds = (text) => {
  const [m, s] = text.split(':');
  return Number(m) * 60 + Number(s);
};

test('changes a scene\'s time in its row: a passage made of an instant, its end dragged on the bar', async ({ page }) => {
  const { saves } = await openSteps(page);
  await seekTo(page, 0.5);
  await page.keyboard.press('s');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.length).toBe(1);

  await openTime(page);
  const start = page.getByRole('textbox', { name: 'Scene start' });
  await expect(start).toHaveValue('0:00.48');
  // open all along, it leaves the keys to the player until a field is pressed
  await expect(start).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Passage' }).click();
  const end = page.getByRole('textbox', { name: 'Scene end' });
  // the clip still on the start, the passage runs a few seconds on: here, to its end
  await expect(end).toHaveValue('0:01.2');
  await expect(page.getByTestId('scene-grip-end')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();

  // the end's handle, dragged back: the list stays open, and the frame follows it
  const from = await onBar(page, 1.2);
  const to = await onBar(page, 0.8);
  await page.mouse.move(from.x - 1, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toBeVisible();
  const dragged = seconds(await end.inputValue());
  expect(dragged).toBeGreaterThan(0.7);
  expect(dragged).toBeLessThan(0.9);
  expect(Math.round(dragged * 25) / 25).toBeCloseTo(dragged, 6); // on a frame
  await expect.poll(() => frameOnScreen(page)).toBe(Math.round(dragged * 25) - 1);
  // nothing is kept until it is applied
  expect(saves.at(-1).spec.scenes[0].end).toBeNull();

  // the press on the bar gave the keys back to the player: Enter applies, the row open still
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toBeVisible();
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]).toEqual({
    id: expect.any(String), start: expect.closeTo(0.48, 6), end: expect.closeTo(dragged, 6), label: '',
  });
  await expect(page.getByTestId('scene-band')).toHaveCount(1);
  // and like every change to the clip, it goes back with Ctrl+Z
  await page.keyboard.press('Control+z');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]?.end).toBeNull();
  await expect(end).toHaveCount(0);
  await expect(start).toHaveValue('0:00.48');
  // Escape with nothing to drop folds the row, which then writes its time
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'When the scene happens' })).toHaveCount(0);
  await expect(page.getByTestId('scene-row').first()).toContainText('Instant · 0:00');
});

/** The stretch of the clip the zoomed bar shows, as the line along its top draws it. */
async function barWindow(page) {
  const [left, width] = await page.locator('.overview-window').evaluate((el) => [parseFloat(el.style.left), parseFloat(el.style.width)]);
  return { start: (left / 100) * 1.2, span: (width / 100) * 1.2 };
}

test('zooms the bar\'s time with the wheel, drags a handle onto a frame there, and shows the whole clip again', async ({ page }) => {
  // A narrow window: the clip's thirty frames are drawn narrower than the bar's
  // deepest zoom draws them, so there is room to zoom.
  await page.setViewportSize({ width: 1100, height: 820 });
  const { saves } = await openSteps(page);
  await seekTo(page, 0.5);
  await page.keyboard.press('s');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.length).toBe(1);
  await openTime(page);
  await page.getByRole('radio', { name: 'Passage' }).click();
  const end = page.getByRole('textbox', { name: 'Scene end' });
  await expect(end).toHaveValue('0:01.2');

  // the wheel over the bar's end zooms in about it, as deep as it goes
  let bar = await page.locator('.track').boundingBox();
  await page.mouse.move(bar.x + bar.width - 1, bar.y + bar.height / 2);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -100);
  const zoom = page.getByRole('button', { name: /^Bar zoomed ×\d/ });
  await expect(zoom).toHaveText(/^×\d/);
  await expect(page.getByTestId('bar-overview')).toHaveCount(1);
  const win = await barWindow(page);
  expect(win.span).toBeLessThan(1.2 * 0.8);
  expect(win.start + win.span).toBeCloseTo(1.2, 2);
  // the page under the bar never scrolled
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);

  // the end's handle, dragged back to a frame in the middle of the window; the zoom's
  // chip may have wrapped the controls row in a window this narrow, lifting the bar
  bar = await page.locator('.track').boundingBox();
  const frame = Math.round((win.start + win.span / 2) * 25);
  const x = bar.x + ((frame / 25 - win.start) / win.span) * bar.width;
  await page.mouse.move(bar.x + bar.width - 1, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bar.y + bar.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(seconds(await end.inputValue())).toBeCloseTo(frame / 25, 6);
  await expect.poll(() => frameOnScreen(page)).toBe(frame - 1);

  // a press on the zoom puts the whole clip back, the handle where its time says
  await zoom.click();
  await expect(zoom).toHaveCount(0);
  await expect(page.getByTestId('bar-overview')).toHaveCount(0);
  const grip = await page.getByTestId('scene-grip-end').boundingBox();
  expect(grip.x + grip.width / 2).toBeCloseTo(bar.x + (bar.width * frame) / 25 / 1.2, 0);
});

test('ends the open scene with Shift+S, and takes its start from the frame on screen or as typed', async ({ page }) => {
  const { saves } = await openSteps(page);
  await seekTo(page, 0.5);
  await page.keyboard.press('s');
  await openTime(page);

  // a press on the bar moves the clip and keeps the row open
  const later = await onBar(page, 0.9);
  await page.mouse.click(later.x, later.y);
  await expect.poll(() => frameOnScreen(page)).toBe(22);
  await page.keyboard.press('Shift+S');
  await expect(page.getByRole('radio', { name: 'Passage' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('textbox', { name: 'Scene end' })).toHaveValue('0:00.92');
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]?.end).toBeCloseTo(0.92, 6);
  // one step at a time, each frame drawn before the next: Firefox can answer a seek
  // already left behind, which the clock would then name
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.player-time')).toContainText('0:00.840');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.player-time')).toContainText('0:00.800');
  await expect.poll(() => frameOnScreen(page)).toBe(20);
  await page.getByRole('button', { name: 'Here' }).first().click();
  await expect(page.getByRole('textbox', { name: 'Scene start' })).toHaveValue('0:00.8');

  // a typed time is read, and a wrong one is said and never kept
  const start = page.getByRole('textbox', { name: 'Scene start' });
  await start.fill('0:01');
  await expect(page.getByRole('alert').filter({ hasText: 'The end must come after the start' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await start.fill('0,2');
  await start.press('ArrowUp');
  await expect(start).toHaveValue('0:00.24');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => saves.at(-1)?.spec?.scenes?.[0]).toEqual({
    id: expect.any(String), start: expect.closeTo(0.24, 6), end: expect.closeTo(0.92, 6), label: '',
  });
  await expect(page.locator('.toast', { hasText: 'Scene now 0:00–0:00' })).toBeVisible();
});

test('gives a proof about the whole video its passages, two of them, and the whole video back', async ({ page }) => {
  const depot = {
    kind: 'proof', proof: 'Depot', proof_id: 'e_depot', title: 'Depot', moments: [], at: [0.2],
    stated: false, draft: null, points: [], png: null, thumb: null, when: null, when_zone: null, description: null,
  };
  const { proofTimes, saves } = await openSteps(page, { scenes: [depot] });

  // a proof that states no time is about the whole video, and its frame still pins it
  const row = page.getByTestId('scene-row').first();
  await expect(row).toContainText('Whole video');
  await expect(page.getByTestId('scene-pin')).toHaveCount(1);
  await openTime(page);
  await expect(page.getByRole('radio', { name: 'Whole video' })).toHaveAttribute('aria-checked', 'true');
  // the clip goes to its frame, where a moment starts once one is asked for
  await expect.poll(() => frameOnScreen(page)).toBe(5);
  await page.getByRole('radio', { name: 'Instant' }).click();
  const start = page.getByRole('textbox', { name: 'Scene start' });
  await expect(start).toHaveValue('0:00.2');
  await start.fill('0:00.6');
  await page.getByRole('radio', { name: 'Passage' }).click();
  const end = page.getByRole('textbox', { name: 'Scene end' });
  await end.fill('1');
  // the same place again: a second passage of the first's kind, from the frame on screen
  // and shortened to the room before the first, made an instant and typed over
  await page.getByRole('button', { name: 'Another passage' }).click();
  await expect(page.getByRole('textbox', { name: 'Scene start' }).nth(1)).toHaveValue('0:00.2');
  await expect(page.getByRole('textbox', { name: 'Scene end' }).nth(1)).toHaveValue('0:00.6');
  await page.getByRole('radio', { name: 'Instant' }).click();
  await page.getByRole('textbox', { name: 'Scene start' }).nth(1).fill('1.08');
  await page.getByRole('textbox', { name: 'Scene start' }).nth(1).press('Enter');

  await expect.poll(() => proofTimes).toEqual([[{ start: 0.6, end: 1 }, { start: 1.08, end: null }]]);
  await expect(page.locator('.toast', { hasText: '“Depot” is now 0:00–0:01 · 0:01' })).toBeVisible();
  await expect(row).toHaveAttribute('aria-label', 'Scene, 2 passages · 0:00–0:01 · 0:01');
  // both drawn in the proof's colour: a band and a pin
  await expect(page.getByTestId('scene-band')).toHaveCount(1);
  await expect(page.getByTestId('scene-pin')).toHaveCount(1);

  // the whole video again, which takes every moment back, and the toast's Undo
  await openTime(page);
  await page.getByRole('radio', { name: 'Whole video' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => proofTimes.at(-1)).toEqual([]);
  await expect(row).toHaveAttribute('aria-label', 'Scene, Whole video');
  await page.locator('.toast', { hasText: '“Depot” is now the whole video' }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => proofTimes.at(-1)).toEqual([{ start: 0.6, end: 1 }, { start: 1.08, end: null }]);
  await expect(page.getByTestId('scene-band')).toHaveCount(1);
  // a proof's time is the proof's: the video's work never holds it
  expect(saves.every((save) => (save.spec.scenes ?? []).length === 0)).toBe(true);
});

test('keeps the frame on screen and every button of the player in a narrow window', async ({ page }) => {
  // 1100 px with the case panel open: the player is under 400 px wide
  await page.setViewportSize({ width: 1100, height: 720 });
  await openSteps(page);
  // the bar zoomed, so its chip asks for room too
  const bar = await page.locator('.track').boundingBox();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -100);
  await expect(page.getByRole('button', { name: /^Bar zoomed/ })).toBeVisible();

  const playerBar = await page.locator('.player-bar').boundingBox();
  const inside = async (locator) => {
    const box = await locator.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(playerBar.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(playerBar.x + playerBar.width + 0.5);
  };
  // the frame on screen is read whole, the length and the count gone first
  await expect(page.locator('.player-time .now')).toHaveText('0:00.000');
  await inside(page.locator('.player-time .now'));
  await expect(page.locator('.player-time .of.count')).toBeHidden();
  for (const name of ['Play', 'Playback speed', /^Bar zoomed/, 'Mute', 'Full screen', 'Capture this frame']) {
    await inside(page.getByRole('button', { name }).first());
  }
});
