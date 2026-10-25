/**
 * The plate export under way, one at a time: what it is drawing and how far it is,
 * so the top bar shows it working while the analyst is in another tool, and a press
 * there goes back to it. The plate holds still while it runs; Stop ends it and then
 * nothing is written.
 */

export const plateExport = $state({ running: false, name: '', caseId: '', said: '', done: 0, total: 0 });

let stopper = null;

/** An export of the plate `name` in case `caseId` starts; `stop` ends it. */
export function startExport(name, caseId, stop) {
  Object.assign(plateExport, { running: true, name, caseId, said: '', done: 0, total: 0 });
  stopper = stop;
}

/** What the export is doing now, and how many of its pictures are drawn when it counts them. */
export function exportSays(said, done = 0, total = 0) {
  Object.assign(plateExport, { said, done, total });
}

export function endExport() {
  Object.assign(plateExport, { running: false, said: '', done: 0, total: 0 });
  stopper = null;
}

export function stopExport() {
  stopper?.();
}

/** How far, in percent, when the export counts its pictures; null while it cannot say. */
export const exportShare = (run) => (run.total ? Math.min(100, Math.round((100 * run.done) / run.total)) : null);
