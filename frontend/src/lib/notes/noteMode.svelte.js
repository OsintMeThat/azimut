/**
 * How every note editor of this browser shows the page: `drawn` (pictures, tables
 * and marks as they read) or `markdown` (the raw text). One choice for all of them,
 * kept in this browser, read once when the page loads. A browser that will not
 * store it forgets it at the next load, which is no harm.
 */
const KEY = 'azimut.noteMode';

function read() {
  try {
    return localStorage.getItem(KEY) === 'markdown' ? 'markdown' : 'drawn';
  } catch {
    return 'drawn';
  }
}

const shown = $state({ mode: read() });

export const noteMode = {
  get mode() {
    return shown.mode;
  },
  /** Show the page in `mode`, `drawn` or `markdown`, and keep it for the next visit. */
  set(mode) {
    shown.mode = mode === 'markdown' ? 'markdown' : 'drawn';
    try {
      localStorage.setItem(KEY, shown.mode);
    } catch { /* kept for this visit only */ }
  },
  /** The other mode: what Ctrl+Shift+M does. */
  toggle() {
    this.set(shown.mode === 'markdown' ? 'drawn' : 'markdown');
  },
};
