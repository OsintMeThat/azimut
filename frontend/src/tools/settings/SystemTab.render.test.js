// @vitest-environment happy-dom
/**
 * Settings › System › Updates, mounted: Download new versions automatically sits
 * under the startup check it rides on, says what it does, and follows the download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import SystemTab from './SystemTab.svelte';
import { prefs } from '../../lib/state.svelte.js';
import { adopt } from '../../lib/selfUpdateState.svelte.js';
import { AUTO, WHAT_HAPPENS } from '../../lib/selfUpdate.js';

vi.mock('../../lib/api.js', () => ({
  api: { get: vi.fn(async () => ({})), post: vi.fn(), put: vi.fn(async () => ({})), patch: vi.fn(), del: vi.fn() },
}));

const binary = { kind: 'binary', system: 'linux', program: '/home/u/Apps/azimut-linux-x86_64', workspace: '/home/u/Azimut' };
const able = { state: 'idle', supported: true, reason: null, busy: null };

let target;
let app;

function open(props = {}) {
  target = document.createElement('div');
  target.className = 'settings-pane';
  document.body.append(target);
  app = mount(SystemTab, {
    target,
    props: {
      about: { version: '0.3.4' },
      ffmpeg: {},
      badges: { app: false },
      appUpdate: null,
      checkingApp: false,
      checkAppUpdate: () => {},
      scrapers: [],
      checking: false,
      checkScrapers: () => {},
      updating: {},
      updateScraper: () => {},
      resetScraper: () => {},
      savePrefs: () => {},
      report: null,
      loadReport: () => {},
      refreshReport: () => {},
      copyReport: () => {},
      REPO_URL: 'https://github.com/OsintMeThat/azimut',
      SITE_URL: 'https://osintmethat.com',
      updateOnStart: true,
      reportKind: 'bug',
      reportSummary: '',
      ...props,
    },
  });
  flushSync();
  return target;
}

const autoRow = () =>
  [...target.querySelectorAll('.row')].find((row) => row.textContent.includes(AUTO.label));

beforeEach(() => {
  prefs.updateAutoDownload = false;
  prefs.updateCheckOnStart = true;
  adopt(able, binary);
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
});

describe('Download new versions automatically in Settings', () => {
  it('sits under the startup check, unticked, with a hover and the four things it does', () => {
    open();
    const row = autoRow();
    expect(row.classList.contains('child')).toBe(true);
    expect(row.textContent).toContain(AUTO.hintOff);
    const tick = row.querySelector('input');
    expect(tick.checked).toBe(false);
    expect(tick.title).toBe(AUTO.title);
    const fold = target.querySelector('details.what');
    expect([...fold.querySelectorAll('li')].map((li) => li.textContent.trim())).toEqual(
      WHAT_HAPPENS.map((item) => item.text),
    );
  });

  it('greys out with the startup check off', () => {
    open({ updateOnStart: false });
    expect(autoRow().querySelector('input').disabled).toBe(true);
    expect(autoRow().textContent).toContain(AUTO.needsCheck);
  });

  it('is not offered to a pip install', () => {
    adopt({ ...able, supported: false, reason: 'A pip install updates with its own command.' }, { kind: 'package' });
    open();
    expect(autoRow()).toBeUndefined();
    expect(target.querySelector('details.what')).toBeNull();
  });

  it('saves a tick', async () => {
    const { api } = await import('../../lib/api.js');
    open();
    autoRow().querySelector('input').click();
    await tick();
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { update_auto_download: true });
  });

  it('says when a version is downloaded and waits for the press', () => {
    prefs.updateAutoDownload = true;
    adopt({ ...able, state: 'ready', version: '0.3.5', done: 1, total: 1 });
    open();
    expect(target.querySelector('.auto-status').textContent).toContain('Nothing is installed yet.');
  });
});
