import { api } from './api.js';

const base = '/api/settings/workspace';

export const readStatus = () => api.get(base);
export const inspectFolder = (path) => api.post(`${base}/inspect`, { path });
export const useFolder = (path) => api.post(`${base}/use`, { path });
export const useDefaultFolder = () => api.post(`${base}/default`);
export const moveWorkspace = (path) => api.post(`${base}/move`, { path });
export const discardOldWorkspace = () => api.post(`${base}/discard-old`);
export const takeWorkspaceLock = () => api.post(`${base}/take`);

/**
 * Why the app is closed, when it is: a folder that isn't there, or one another
 * Azimut holds. Null means the workspace is ours to work in.
 */
export function stoppedBecause(status) {
  if (!status) return null;
  if (status.missing) return { reason: 'missing', root: status.root, detail: '' };
  if (status.locked_by) {
    return { reason: 'locked', root: status.root, detail: status.locked_detail };
  }
  return null;
}

/** The move's steps, named as the analyst reads them. Mirrors `STEPS` in
 *  `engine/workspacemove.py`. */
export const STEP_LABELS = {
  checking: 'Checking the folder',
  settling: 'Finishing background work',
  copying: 'Copying',
  verifying: 'Verifying the copy',
  switching: 'Switching over',
  opening: 'Opening the new folder',
  tidying: 'Setting the old folder aside',
};

/**
 * What the dialog may offer for a folder that was just inspected.
 *
 * The two actions are not alternatives with the same outcome, which is why the
 * copy has to separate them: using a folder leaves the current cases where they
 * are, and moving carries them over.
 */
export function offers(verdict) {
  if (!verdict || !verdict.ok) return { use: false, move: false, strands: 0 };
  return {
    use: true,
    // The backend refuses this too; hiding the button is how the analyst finds
    // out before typing rather than after.
    move: verdict.state !== 'workspace',
    // Cases that would stay behind if they used this folder as it is.
    strands: verdict.cases === 0 ? verdict.current_cases : 0,
  };
}

/** Progress of a running move: a percentage while bytes are moving, and the
 *  step's own name the rest of the time. */
export function moveProgress(move) {
  if (!move) return { percent: 0, label: '', done: false };
  const label = STEP_LABELS[move.step] ?? move.step;
  if (move.done) return { percent: 100, label, done: true };
  if (move.step !== 'copying') {
    return { percent: move.step === 'checking' || move.step === 'settling' ? 0 : 100, label, done: false };
  }
  const percent = move.total_bytes
    ? Math.min(100, Math.round((move.copied_bytes / move.total_bytes) * 100))
    : 0;
  return { percent, label, done: false };
}

/** Bytes as the dialog prints them. */
export function humanBytes(count) {
  if (!count) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = count;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
