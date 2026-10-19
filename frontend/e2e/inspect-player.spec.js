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
async function openSteps(page) {
  const fixture = await installAppFixture(page, {
    media: [{
      path: STEPS, filename: 'steps.webm', title: 'Steps', kind: 'video', entity_id: 'e_steps',
      size: STEPS_WEBM.length, source: { type: 'upload' }, thumbnail: null, folder: '',
    }],
  });
  const renders = [];
  const saves = [];
  // Registered after the fixture, so these answer first.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/files/${CASE_ID}/${STEPS}`) return serveRange(route, STEPS_WEBM, 'video/webm');
    if (path === `/api/cases/${CASE_ID}/inspect/probe`) return json({ kind: 'video', duration: 1.2, fps: FPS, width: 32, height: 32, codec: 'vp9' });
    if (path === `/api/cases/${CASE_ID}/inspect/overview`) return json({ scan: null });
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
  return { fixture, renders, saves };
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

  for (const name of ['Adjust', 'Info', 'Moments']) {
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
