// @vitest-environment happy-dom
/**
 * The one-click update on screen: the box in the pop-up, Install and restart in place
 * of the download once a version is ready, and the restart's steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AutoUpdateBox from './AutoUpdateBox.svelte';
import UpdateButtons from './UpdateButtons.svelte';
import UpdateRestart from './UpdateRestart.svelte';
import { prefs } from '../lib/state.svelte.js';
import { adopt, restart, selfUpdate } from '../lib/selfUpdateState.svelte.js';
import { AUTO } from '../lib/selfUpdate.js';

vi.mock('../lib/api.js', () => ({
  api: { get: vi.fn(async () => ({})), post: vi.fn(), put: vi.fn(async () => ({})), patch: vi.fn(), del: vi.fn() },
}));

const binary = { kind: 'binary', system: 'linux', program: '/home/u/Apps/azimut-linux-x86_64', workspace: '/home/u/Azimut' };
const update = {
  update_available: true,
  latest: 'v0.3.5',
  url: 'https://github.com/OsintMeThat/azimut/releases/tag/v0.3.5',
  asset: 'azimut-linux-x86_64',
  download_url: 'https://github.com/OsintMeThat/azimut/releases/download/v0.3.5/azimut-linux-x86_64',
  install: binary,
};
const able = { state: 'idle', supported: true, reason: null, busy: null };

let target;
let app;

function show(Component, props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(Component, { target, props });
  flushSync();
  return target;
}

beforeEach(() => {
  prefs.updateCheckOnStart = true;
  prefs.updateAutoDownload = false;
  adopt(able, binary);
  restart.phase = '';
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
});

describe('the box in the pop-up', () => {
  it('offers itself unticked, saying what it would do', () => {
    const box = show(AutoUpdateBox, { install: binary });
    const tick = box.querySelector('input[type="checkbox"]');
    expect(box.textContent).toContain(AUTO.label);
    expect(tick.checked).toBe(false);
    expect(tick.disabled).toBe(false);
    expect(box.textContent).toContain(AUTO.popHint);
    expect(box.querySelector('label').title).toBe(AUTO.title);
  });

  it('shows the download once ticked, and that nothing is installed yet', () => {
    prefs.updateAutoDownload = true;
    adopt({ ...able, state: 'downloading', version: '0.3.5', done: 21e6, total: 84e6 });
    const box = show(AutoUpdateBox, { install: binary });
    expect(box.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('25');
    expect(box.textContent).toContain('Downloading 0.3.5… 21 of 84 MB');
    adopt({ ...able, state: 'ready', version: '0.3.5', done: 84e6, total: 84e6 });
    flushSync();
    expect(box.textContent).toContain('Downloaded and signed. Nothing is installed yet.');
  });

  it('is greyed, with the reason, on a copy that cannot update itself', () => {
    adopt({ ...able, supported: false, reason: "Azimut can't write to its own folder." });
    const box = show(AutoUpdateBox, { install: binary });
    expect(box.querySelector('input').disabled).toBe(true);
    expect(box.textContent).toContain("can't write to its own folder");
  });

  it('is not there for a pip install', () => {
    const box = show(AutoUpdateBox, { install: { kind: 'package' } });
    expect(box.querySelector('input')).toBeNull();
  });
});

describe('the buttons on Home and in Settings', () => {
  it('download by hand while the box is unticked', () => {
    const text = show(UpdateButtons, { update }).textContent;
    expect(text).toContain('Download for Linux');
    expect(text).not.toContain('Install and restart');
  });

  it('offer Install and restart once the box has the version ready', () => {
    prefs.updateAutoDownload = true;
    adopt({ ...able, state: 'ready', version: '0.3.5' });
    const box = show(UpdateButtons, { update });
    expect(box.textContent).toContain('Install and restart');
    expect(box.textContent).not.toContain('Download for');
    expect(box.textContent).toContain('Release page');
    const install = box.querySelector('button');
    expect(install.disabled).toBe(false);
    expect(install.title).toBe('Closes Azimut and opens it again on the new version.');
  });

  it('hold Install and restart back while work is under way, saying why', () => {
    prefs.updateAutoDownload = true;
    adopt({ ...able, state: 'ready', version: '0.3.5', busy: 'Waits for the media download to finish.' });
    const box = show(UpdateButtons, { update });
    const install = [...box.querySelectorAll('button')].find((b) => b.textContent.includes('Install and restart'));
    expect(install.disabled).toBe(true);
    expect(install.title).toBe('Waits for the media download to finish.');
  });

  it('go back to the download when the ready version is not the one released', () => {
    prefs.updateAutoDownload = true;
    adopt({ ...able, state: 'ready', version: '0.3.4' });
    expect(show(UpdateButtons, { update }).textContent).toContain('Download for Linux');
  });
});

describe('the restart', () => {
  it('shows the steps behind it and the one under way', () => {
    restart.phase = 'restarting';
    restart.version = '0.3.5';
    show(UpdateRestart);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Updating to 0.3.5');
    expect(dialog.querySelectorAll('li.done')).toHaveLength(3);
    expect(dialog.querySelector('li:not(.done)').textContent.trim()).toBe('Restarting');
    expect(dialog.textContent).toContain('This tab comes back on its own.');
  });

  it('says what to rename when Azimut does not come back', () => {
    restart.phase = 'lost';
    show(UpdateRestart);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Azimut did not come back');
    expect(dialog.textContent).toContain('azimut-linux-x86_64.old');
  });
});

describe('the words stay in one place', () => {
  it('the pop-up, Settings and the buttons read them from lib/selfUpdate.js', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const file of ['./AutoUpdateBox.svelte', '../tools/settings/SystemTab.svelte']) {
      expect(read(file)).toContain('{AUTO.label}');
      expect(read(file)).toContain('title={AUTO.title}');
    }
    expect(read('./InstallButton.svelte')).toContain('{INSTALL_LABEL}');
    expect(selfUpdate).toBeTruthy();
  });
});
