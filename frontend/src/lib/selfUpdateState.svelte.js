/**
 * The one-click update in the tab: where the download stands, the box that allows
 * it, and the restart (lib/selfUpdate.js has the words and the decisions).
 *
 * Nothing here reaches the network on its own. The server downloads only once the
 * box is ticked, and refuses to otherwise; installing is always the analyst's
 * press on Install and restart. While a download runs, its progress is read from
 * this machine's server every half second, and only then.
 */
import { api } from './api.js';
import { prefs, applyPrefs, updatesState, updateState, appInfo, toast } from './state.svelte.js';
import { afterRestart, shouldPrepare } from './selfUpdate.js';

/** GET /api/settings/update's `self_update`, and the `install` it came with. */
export const selfUpdate = $state({
  state: 'idle',
  version: '',
  done: 0,
  total: 0,
  error: '',
  supported: false,
  reason: '',
  busy: '',
  install: null,
});

/** The restart after the press: '' none, 'restarting' waiting, 'lost' it did not come back. */
export const restart = $state({ phase: '', version: '' });

/** Kept across the reload, so the tab that comes back can say how it went. */
export const MARK = 'azimut:update-installing';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function adopt(status, install) {
  if (!status) return;
  selfUpdate.state = status.state ?? 'idle';
  selfUpdate.version = status.version ?? '';
  selfUpdate.done = status.done ?? 0;
  selfUpdate.total = status.total ?? 0;
  selfUpdate.error = status.error ?? '';
  selfUpdate.supported = Boolean(status.supported);
  selfUpdate.reason = status.reason ?? '';
  selfUpdate.busy = status.busy ?? '';
  if (install) selfUpdate.install = install;
}

const underWay = () => selfUpdate.state === 'downloading' || selfUpdate.state === 'checking';

let following = false;

/** Read the progress while a download runs, and stop as soon as it doesn't. */
async function follow(every = 500) {
  if (following) return;
  following = true;
  try {
    while (underWay()) {
      await sleep(every);
      const body = await api.get('/api/settings/update');
      adopt(body.self_update, body.install);
    }
  } catch {
    /* the next look at Settings reads it again */
  } finally {
    following = false;
  }
}

/** Where the update stands, from this machine's server. No network beyond it. */
export async function readSelfUpdate() {
  const body = await api.get('/api/settings/update');
  adopt(body.self_update, body.install);
  if (underWay()) follow();
}

export async function prepare(tag) {
  try {
    adopt(await api.post('/api/settings/update/prepare', { tag }));
    follow();
  } catch (e) {
    selfUpdate.state = 'failed';
    selfUpdate.version = tag.replace(/^v/i, '');
    selfUpdate.error = e.message;
  }
}

/** After the startup check, or once the box is ticked: download if it says to. */
export async function prepareIfTicked() {
  const update = updatesState.app;
  if (update?.self_update) adopt(update.self_update, update.install);
  const allowed = { on: prefs.updateAutoDownload, checkOnStart: prefs.updateCheckOnStart };
  if (shouldPrepare(update, selfUpdate, allowed)) await prepare(update.latest);
}

/** Tick or untick the box. Unticking forgets the download and its file. */
export async function setAutoDownload(on) {
  prefs.updateAutoDownload = on;
  try {
    applyPrefs(await api.put('/api/settings/prefs', { update_auto_download: on }));
  } catch (e) {
    prefs.updateAutoDownload = !on;
    toast(`Could not save: ${e.message}`, 'danger');
    return;
  }
  if (on) await prepareIfTicked();
  else adopt({ ...selfUpdate, state: 'idle', version: '', done: 0, total: 0, error: '', busy: '' });
}

/**
 * Wait for the server to come back, then reload. Back on the new version, or on the
 * old one after a swap that failed: the reloaded tab says which (announceRestart).
 */
async function waitForVersion(version, { tries = 120, every = 1000 } = {}) {
  let wentDown = false;
  for (let i = 0; i < tries; i += 1) {
    await sleep(every);
    let running = '';
    try {
      const answer = await fetch('/api/health', { cache: 'no-store' });
      running = (await answer.json()).version ?? '';
    } catch {
      wentDown = true;
      continue;
    }
    if (running === version || (wentDown && running)) {
      location.reload();
      return;
    }
  }
  restart.phase = 'lost';
}

export async function installNow() {
  let answer;
  try {
    answer = await api.post('/api/settings/update/install');
  } catch (e) {
    toast(`Could not install: ${e.message}`, 'danger');
    readSelfUpdate().catch(() => {});
    return;
  }
  updateState.show = false;
  restart.phase = 'restarting';
  restart.version = answer.version;
  try {
    localStorage.setItem(MARK, answer.version);
  } catch {
    /* the tab still comes back; it only cannot say how it went */
  }
  waitForVersion(answer.version);
}

/** On load: if this tab is back from Install and restart, say how it went. */
export function announceRestart() {
  let target = '';
  try {
    target = localStorage.getItem(MARK) ?? '';
    localStorage.removeItem(MARK);
  } catch {
    return;
  }
  const said = afterRestart(target, appInfo.version);
  if (said) toast(said.text, said.kind, 8000);
}
