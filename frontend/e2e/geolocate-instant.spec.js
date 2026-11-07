import { test, expect } from '@playwright/test';
import { CASE_ID, installAppFixture } from './app.fixture.js';

// While a scene is geolocated, the server attaches every capture to it and says so
// (the `geolocating` nudge, with the capture and how many the scene now holds). The
// pill and the To-do show that word at once and read the server behind it, so the
// count moves with its pulse before any answer lands, and the pill goes the moment
// the scene ends. The two routes they read are held back here to prove it.

const VIDEO = 'media/market.mp4';
const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start, end, label, state: 'todo', captures: [], abandoned: null, order: 1, ...extra,
});
const CAPTURES = ['media/c1.png', 'media/c2.png'];
const SHOTS = '/tmp/claude-1000/m2h/shots';

/** A case geolocating the bridge, its two reads answering from here, slowly once asked to. */
async function geolocatingBridge(page) {
  const fixture = await installAppFixture(page);
  const server = {
    bridge: row('sc_2', 238, 252, 'bridge?', { state: 'progress', captures: [...CAPTURES] }),
    live: true,
    slow: 0, // how long each read waits before it answers, in ms
    answered: [], // the reads answered while slow, by route
  };
  const queue = () => ({
    files: [{ video: VIDEO, title: 'Market walk', kind: 'video', scenes: [row('sc_1', null, null), structuredClone(server.bridge)] }],
    geolocating: server.live ? { ...structuredClone(server.bridge), since: 'now' } : null,
  });
  // Each read answers with the server as it stood when asked, however late it lands.
  const answer = (name, body) => async (route) => {
    const slow = server.slow;
    const said = body();
    if (slow) await new Promise((resolve) => setTimeout(resolve, slow));
    // the page may have moved on by then; a read nobody waits for any more is not one to count
    await route.fulfill({ json: said }).catch(() => {});
    if (slow) server.answered.push(name);
  };
  await page.route(`**/api/cases/${CASE_ID}/todos`, (route) =>
    route.fulfill({ json: { revision: 0, lists: [{ id: 'default', name: 'Tasks', tasks: [] }] } }),
  );
  await page.route(`**/api/cases/${CASE_ID}/scenes/queue`, answer('queue', queue));
  await page.route(`**/api/cases/${CASE_ID}/geolocating`, answer('geolocating', () => ({ geolocating: queue().geolocating })));
  return { fixture, server };
}

/** The server's word, as the SSE stream hands it over. */
async function nudge(page, event) {
  await page.evaluate(async (said) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch(said);
  }, { type: 'geolocating', case_id: CASE_ID, ...event });
}

async function theme(page, which) {
  await page.evaluate(async (wanted) => {
    const { setTheme } = await import('/src/lib/state.svelte.js');
    setTheme(wanted);
  }, which);
}

test('a capture attached steps the count up before the server is read again, and an end drops the pill at once', async ({ page }) => {
  const { server } = await geolocatingBridge(page);
  await page.goto('/#files');
  const sidebar = page.locator('aside.sidebar');
  await sidebar.getByRole('tab', { name: 'To-do' }).click();
  const group = sidebar.getByRole('region', { name: 'To geolocate' });
  const pill = page.locator('.geo-pill');
  const count = pill.getByTestId('geolocating-count');
  await expect(count).toHaveText('2');
  await expect(group.locator('li.scene.live')).toContainText('Geolocating · 2 captures');

  // from here every read takes four seconds
  server.slow = 4000;
  server.bridge.captures.push('media/c3.png');
  const said = Date.now();
  await nudge(page, { video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
  await expect(count).toHaveText('3', { timeout: 1500 });
  await expect(count).toHaveClass(/bump/);
  await expect(group.locator('li.scene.live')).toContainText('Geolocating · 3 captures', { timeout: 1500 });
  // shown before any read answered
  expect(server.answered).toEqual([]);
  expect(Date.now() - said).toBeLessThan(4000);
  await page.locator('.topbar').screenshot({ path: `${SHOTS}/app-pill-bump-dark.png` });
  await theme(page, 'light');
  await page.locator('.topbar').screenshot({ path: `${SHOTS}/app-pill-light.png` });
  await theme(page, 'dark');

  // the read behind it lands with the same word: nothing flickers back
  await expect.poll(() => server.answered.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(count).toHaveText('3');

  // a proof takes the scene up: the pill goes on the word, the reads still slow
  server.answered = [];
  server.live = false;
  await nudge(page, { video: null, draft: null });
  await expect(pill).toHaveCount(0, { timeout: 1500 });
  expect(server.answered).toEqual([]);
  await expect(group.locator('li.scene.live')).toHaveCount(0);
  // and the read that follows, asked after the word, agrees
  await expect.poll(() => server.answered.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(pill).toHaveCount(0);
});

test('a read asked before the capture cannot take the count back down', async ({ page }) => {
  const { server } = await geolocatingBridge(page);
  await page.goto('/#files');
  const count = page.locator('.geo-pill').getByTestId('geolocating-count');
  await expect(count).toHaveText('2');

  // a read out before the capture, as the pill asks when its video's scenes are saved
  server.slow = 2500;
  await page.evaluate(async ({ caseId, video }) => {
    const { dispatch } = await import('/src/lib/events.js');
    dispatch({ type: 'scenes', case_id: caseId, video });
  }, { caseId: CASE_ID, video: VIDEO });
  await page.waitForTimeout(200);
  // the capture, which that read cannot know of
  server.slow = 600;
  server.bridge.captures.push('media/c3.png');
  await nudge(page, { video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
  await expect(count).toHaveText('3', { timeout: 1000 });
  // every read lands, the old one last; the count never leaves 3
  const seen = new Set();
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    seen.add(await count.textContent());
    await page.waitForTimeout(100);
  }
  expect([...seen].map((text) => text.trim())).toEqual(['3']);
  expect(server.answered.length).toBeGreaterThanOrEqual(2);
});
