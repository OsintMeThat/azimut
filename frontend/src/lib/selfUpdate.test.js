/**
 * The one-click update's words and decisions (lib/selfUpdate.js): who sees the box,
 * when it downloads, and what the tab says after a restart.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO,
  INSTALL_LABEL,
  RESTART_STEPS,
  WHAT_HAPPENS,
  afterRestart,
  autoBox,
  canInstall,
  oldName,
  progressLine,
  shouldPrepare,
} from './selfUpdate.js';

const binary = { kind: 'binary', system: 'linux' };
const able = { supported: true, reason: null, state: 'idle' };
const ticked = { on: true, checkOnStart: true };

describe('the box', () => {
  it('is not offered to a pip install, which has no program to swap', () => {
    expect(autoBox({ kind: 'package' }, able, ticked).shown).toBe(false);
    expect(autoBox(null, able, ticked).shown).toBe(false);
  });

  it('stays visible but greyed on a binary that cannot update itself, saying why', () => {
    const box = autoBox(binary, { supported: false, reason: "Azimut can't write to its own folder." }, ticked);
    expect(box).toEqual({ shown: true, disabled: true, hint: "Azimut can't write to its own folder." });
  });

  it('greys out without the startup check it rides on', () => {
    expect(autoBox(binary, able, { on: true, checkOnStart: false })).toEqual({
      shown: true,
      disabled: true,
      hint: AUTO.needsCheck,
    });
  });

  it('says what each position does', () => {
    expect(autoBox(binary, able, ticked).hint).toBe(AUTO.hintOn);
    expect(autoBox(binary, able, { on: false, checkOnStart: true }).hint).toBe(AUTO.hintOff);
  });

  it('never promises an install without the press, in any of its words', () => {
    for (const text of [AUTO.title, AUTO.hintOn, AUTO.popHint]) expect(text).toMatch(/one press/);
    expect(WHAT_HAPPENS.map((item) => item.text).join(' ')).toContain(`until you press ${INSTALL_LABEL}`);
  });

  it('keeps every line to one sentence, without dashes', () => {
    for (const text of [...Object.values(AUTO), ...WHAT_HAPPENS.map((item) => item.text)]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text.replace(/\.$/, '')).not.toMatch(/\.\s+[A-Z]/);
    }
  });
});

describe('the progress line', () => {
  it('counts the download in megabytes', () => {
    const line = progressLine({ state: 'downloading', version: '0.3.5', done: 42e6, total: 84e6 });
    expect(line).toEqual({ kind: 'progress', text: 'Downloading 0.3.5… 42 of 84 MB', percent: 50 });
  });

  it('says it before the size is known', () => {
    expect(progressLine({ state: 'downloading', version: '0.3.5', total: 0 }).text).toBe('Downloading 0.3.5…');
  });

  it('says a ready version is not installed yet', () => {
    expect(progressLine({ state: 'ready', version: '0.3.5' })).toEqual({
      kind: 'ready',
      text: 'Downloaded and signed. Nothing is installed yet.',
      percent: 100,
    });
  });

  it('passes the reason of a failure on, as the server says it', () => {
    const line = progressLine({ state: 'failed', version: '0.3.5', error: 'This release is not signed yet. Download it by hand, or try again later.' });
    expect(line.kind).toBe('failed');
    expect(line.text).toBe('This release is not signed yet. Download it by hand, or try again later.');
    expect(progressLine({ state: 'failed', version: '0.3.5' }).text).toBe('0.3.5 did not download.');
  });

  it('says nothing while idle', () => {
    expect(progressLine({ state: 'idle' }).kind).toBe('');
  });
});

describe('Install and restart', () => {
  it('waits for a ready version and for the work at hand', () => {
    expect(canInstall({ state: 'ready', busy: null })).toBe(true);
    expect(canInstall({ state: 'ready', busy: 'Waits for the media download to finish.' })).toBe(false);
    expect(canInstall({ state: 'downloading' })).toBe(false);
  });

  it('shows the three steps the download already took, then the restart', () => {
    expect(RESTART_STEPS).toEqual(['Downloaded', 'Signature checked', 'New version tried', 'Restarting']);
  });
});

describe('when the box downloads', () => {
  const update = { update_available: true, latest: 'v0.3.5', install: binary };

  it('downloads a newer binary once the box is ticked', () => {
    expect(shouldPrepare(update, able, ticked)).toBe(true);
  });

  it('never downloads with the box unticked or the startup check off', () => {
    expect(shouldPrepare(update, able, { on: false, checkOnStart: true })).toBe(false);
    expect(shouldPrepare(update, able, { on: true, checkOnStart: false })).toBe(false);
  });

  it('never downloads for a pip install, a copy that cannot update itself or no newer release', () => {
    expect(shouldPrepare({ ...update, install: { kind: 'package' } }, able, ticked)).toBe(false);
    expect(shouldPrepare(update, { ...able, supported: false }, ticked)).toBe(false);
    expect(shouldPrepare({ ...update, update_available: false }, able, ticked)).toBe(false);
  });

  it('leaves a download under way, ready or failed alone: a failure waits for Try again', () => {
    for (const state of ['downloading', 'checking', 'ready', 'failed']) {
      expect(shouldPrepare(update, { ...able, state, version: '0.3.5' }, ticked)).toBe(false);
    }
    expect(shouldPrepare(update, { ...able, state: 'ready', version: '0.3.4' }, ticked)).toBe(true);
    expect(shouldPrepare(update, { ...able, state: 'failed', version: '0.3.4' }, ticked)).toBe(true);
  });
});

describe('after the restart', () => {
  it('says the update landed', () => {
    expect(afterRestart('0.3.5', '0.3.5')).toEqual({
      kind: 'ok',
      text: 'Updated to 0.3.5. Your cases and settings are as you left them.',
    });
  });

  it('says it did not, on the version still running', () => {
    expect(afterRestart('0.3.5', '0.3.4')).toEqual({
      kind: 'danger',
      text: '0.3.5 did not install. You are still on 0.3.4.',
    });
  });

  it('says nothing on an ordinary load', () => {
    expect(afterRestart('', '0.3.4')).toBeNull();
  });

  it('names the previous version the way the server keeps it', () => {
    expect(oldName('/home/u/Apps/azimut-linux-x86_64')).toBe('azimut-linux-x86_64.old');
    expect(oldName('C:\\Users\\u\\azimut-windows-x86_64.exe')).toBe('azimut-windows-x86_64.old.exe');
  });
});
