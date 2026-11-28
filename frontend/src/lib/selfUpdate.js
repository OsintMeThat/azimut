/**
 * The one-click update's words and decisions, the same in the new-version pop-up,
 * on Home and in Settings → System. The box only downloads; installing is always
 * its own press on Install and restart (engine/selfupdate.py holds to both).
 *
 * Pure, so it is the part worth unit-testing: the store and the network calls live
 * in selfUpdateState.svelte.js around it.
 */

export const INSTALL_LABEL = 'Install and restart';

export const AUTO = {
  label: 'Download new versions automatically',
  title: 'Gets a new version ready; you install it with one press.',
  hintOff: 'Off: Azimut tells you, and you download the new version yourself.',
  hintOn: 'Gets each new version ready in the background; you install it with one press.',
  needsCheck: 'Needs Tell me on startup.',
  popHint: 'Azimut gets each new version ready, and you install it with one press.',
};

/** Said once, in Settings' fold under the box. */
export const WHAT_HAPPENS = [
  { icon: 'download', text: "A new version downloads in the background, from Azimut's GitHub releases only." },
  { icon: 'shield', text: "Only a file that carries the project's signature is kept." },
  { icon: 'clock', text: `Nothing installs until you press ${INSTALL_LABEL}.` },
  { icon: 'folder', text: 'Cases and settings stay as they are, and the previous version is kept beside it.' },
];

/** The steps the restart screen walks, the first three already behind it. */
export const RESTART_STEPS = ['Downloaded', 'Signature checked', 'New version tried', 'Restarting'];

/**
 * Whether the box shows, whether it can be ticked, and the line under it.
 *
 * A pip install has no binary to swap, so the box is not offered at all. A binary
 * that cannot update itself keeps the box visible, greyed, with the reason.
 *
 * @param {{ kind?: string } | null | undefined} install  GET /api/settings/update's `install`
 * @param {{ supported?: boolean, reason?: string|null } | null | undefined} status  its `self_update`
 * @param {{ on: boolean, checkOnStart: boolean }} prefs
 */
export function autoBox(install, status, { on, checkOnStart }) {
  if (install?.kind !== 'binary') return { shown: false, disabled: true, hint: '' };
  if (status && !status.supported) return { shown: true, disabled: true, hint: status.reason ?? '' };
  if (!checkOnStart) return { shown: true, disabled: true, hint: AUTO.needsCheck };
  return { shown: true, disabled: false, hint: on ? AUTO.hintOn : AUTO.hintOff };
}

function megabytes(bytes) {
  return Math.round((bytes ?? 0) / 1e6);
}

/**
 * Where the download stands, as the line under the bar says it.
 *
 * @returns {{ kind: 'progress'|'checking'|'ready'|'failed'|'', text: string, percent: number }}
 */
export function progressLine(status) {
  const version = status?.version ?? '';
  switch (status?.state) {
    case 'downloading': {
      const total = status.total || 0;
      const percent = total ? Math.min(100, Math.round((100 * (status.done || 0)) / total)) : 0;
      const text = total
        ? `Downloading ${version}… ${megabytes(status.done)} of ${megabytes(total)} MB`
        : `Downloading ${version}…`;
      return { kind: 'progress', text, percent };
    }
    case 'checking':
      return { kind: 'checking', text: `Trying ${version}…`, percent: 100 };
    case 'ready':
      return { kind: 'ready', text: 'Downloaded and signed. Nothing is installed yet.', percent: 100 };
    case 'failed':
      return { kind: 'failed', text: `${version} did not download. ${status.error ?? ''}`.trim(), percent: 0 };
    default:
      return { kind: '', text: '', percent: 0 };
  }
}

/** Install and restart can be pressed: a version is ready and nothing is at work. */
export function canInstall(status) {
  return status?.state === 'ready' && !status.busy;
}

/** Whether the box downloads for this release now: ticked, a newer binary, and able to. */
export function shouldPrepare(update, status, { on, checkOnStart }) {
  if (!on || !checkOnStart || !update?.update_available || !update.latest) return false;
  if (update.install?.kind !== 'binary' || !status?.supported) return false;
  const same = status.version === update.latest.replace(/^v/i, '');
  // under way or ready already; a failed one is tried again, once per page load
  return !(same && ['downloading', 'checking', 'ready'].includes(status.state));
}

/**
 * What the tab says once it comes back after Install and restart.
 *
 * @param {string} target  the version the restart was for
 * @param {string} running the version the server now reports
 */
export function afterRestart(target, running) {
  if (!target) return null;
  if (running === target) {
    return { kind: 'ok', text: `Updated to ${target}. Your cases and settings are as you left them.` };
  }
  return { kind: 'danger', text: `${target} did not install. You are still on ${running}.` };
}

/**
 * The name the previous version keeps beside the new one (engine/selfupdate.py
 * `old_path`): the extension stays last, so a Windows program is still an .exe.
 */
export function oldName(program) {
  const name = String(program ?? '').split(/[\\/]/).pop() || 'azimut';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.old${name.slice(dot)}` : `${name}.old`;
}
