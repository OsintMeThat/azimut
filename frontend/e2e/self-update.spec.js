import { test, expect } from '@playwright/test';
import { installAppFixture } from './app.fixture.js';

// A binary on 0.3.4 meets 0.3.5 in the new-version pop-up. The box downloads it,
// Install and restart installs it, and the tab comes back on the new version.
const PROGRAM = '/home/analyst/Apps/azimut-linux-x86_64';
const install = { kind: 'binary', system: 'linux', program: PROGRAM, workspace: '/home/analyst/Azimut' };
const able = { supported: true, reason: null, busy: null };
const release = {
  current: '0.3.4',
  latest: 'v0.3.5',
  update_available: true,
  url: 'https://github.com/OsintMeThat/azimut/releases/tag/v0.3.5',
  notes: "## What's new\n\n- Faster plates.",
  asset: 'azimut-linux-x86_64',
  download_url: 'https://github.com/OsintMeThat/azimut/releases/download/v0.3.5/azimut-linux-x86_64',
  install,
};

async function aBinaryBehind(page) {
  const fixture = await installAppFixture(page, { settings: { version: '0.3.4', whats_new_seen: '0.3.4', update_check_on_start: true } });
  const calls = { prepare: [], install: 0, health: 0 };
  // what the server says of the download, one answer per look
  const progress = [
    { state: 'downloading', version: '0.3.5', done: 42e6, total: 84e6 },
    { state: 'ready', version: '0.3.5', done: 84e6, total: 84e6 },
  ];
  let status = { state: 'idle', version: '', done: 0, total: 0 };
  let restarted = false;

  await page.route('**/api/settings/update**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/settings/update/prepare') {
      calls.prepare.push(request.postDataJSON());
      status = { state: 'downloading', version: '0.3.5', done: 0, total: 84e6 };
      return route.fulfill({ json: { ...status, ...able } });
    }
    if (url.pathname === '/api/settings/update/install') {
      calls.install += 1;
      restarted = true;
      return route.fulfill({ json: { restarting: true, version: '0.3.5' } });
    }
    if (url.searchParams.get('check') === 'true') {
      return route.fulfill({ json: { ...release, self_update: { ...status, ...able } } });
    }
    if (status.state === 'downloading' && progress.length) status = progress.shift();
    return route.fulfill({ json: { ...release, update_available: false, self_update: { ...status, ...able } } });
  });
  // Azimut goes away for a moment, then answers on the new version
  await page.route('**/api/health', async (route) => {
    calls.health += 1;
    if (!restarted || calls.health < 2) return route.abort('connectionrefused');
    fixture.settings.version = '0.3.5';
    return route.fulfill({ json: { status: 'ok', version: '0.3.5' } });
  });
  return { fixture, calls };
}

test('the box downloads the new version, and the press installs it and comes back on it', async ({ page }) => {
  // the tab reloads itself through the dev server, which takes its time on a busy machine
  test.setTimeout(90_000);
  const { fixture, calls } = await aBinaryBehind(page);
  await page.goto('/');

  const popup = page.getByRole('dialog', { name: 'v0.3.5 is live' });
  await expect(popup).toBeVisible();
  // unticked: the old way, nothing downloaded
  await expect(popup.getByRole('link', { name: /Download for Linux/ })).toBeVisible();
  const box = popup.getByRole('checkbox', { name: 'Download new versions automatically' });
  await expect(box).not.toBeChecked();
  expect(calls.prepare).toEqual([]);

  await box.check();
  expect(fixture.settingsWrites).toContainEqual({ update_auto_download: true });
  await expect.poll(() => calls.prepare).toEqual([{ tag: 'v0.3.5' }]);
  // the download's own buttons give way to Later and Install and restart
  await expect(popup.getByRole('link', { name: /Download for Linux/ })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'v0.3.5 is ready to install' })).toBeVisible();
  const ready = page.getByRole('dialog', { name: 'v0.3.5 is ready to install' });
  await expect(ready.getByText('Downloaded and signed. Nothing is installed yet.')).toBeVisible();
  // ticking installed nothing: that is the press's alone
  expect(calls.install).toBe(0);

  await ready.getByRole('button', { name: 'Install and restart' }).click();
  await expect(page.getByRole('dialog', { name: 'Updating to 0.3.5' })).toBeVisible();
  expect(calls.install).toBe(1);

  // the tab reloads itself once 0.3.5 answers, and says it landed
  await expect(page.getByText('Updated to 0.3.5. Your cases and settings are as you left them.')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('dialog', { name: 'Updating to 0.3.5' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('azimut:update-installing'))).toBeNull();
});

test('Later closes the pop-up and installs nothing', async ({ page }) => {
  const { calls } = await aBinaryBehind(page);
  await page.goto('/');
  const popup = page.getByRole('dialog', { name: 'v0.3.5 is live' });
  await popup.getByRole('checkbox', { name: 'Download new versions automatically' }).check();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.install).toBe(0);
});

test('Settings › System holds the same box, under the startup check, and says what it does', async ({ page }) => {
  const { fixture } = await aBinaryBehind(page);
  await page.route('**/api/settings/update', (route) =>
    route.fulfill({ json: { current: '0.3.4', latest: null, update_available: false, install, self_update: { state: 'idle', ...able } } }),
  );
  fixture.settings.update_check_on_start = false; // no pop-up over Settings
  await page.goto('/#settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'System' }).click();

  const box = page.getByRole('checkbox', { name: 'Download new versions automatically' });
  await expect(box).toBeDisabled(); // the startup check it rides on is off
  await expect(page.getByText('Needs Tell me on startup.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Check for updates on startup' }).check();
  await expect(box).toBeEnabled();
  await expect(page.getByText('Nothing installs until you press Install and restart.')).toBeVisible();
});
