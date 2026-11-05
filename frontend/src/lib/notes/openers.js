/**
 * The way back from a picture in a note to the tool state it was made in: a map
 * capture to its view, a pair to its Compare session, a frame to Inspect at its
 * time, a proof to Geo Proof.
 *
 * A tool says which pictures it can reopen (`accepts`) and how (`open`), and the
 * picture's bar in the note offers `Open in <Tool>` for the first that accepts it.
 * The bar is the editor's, never the PDF's: a reader of the PDF cannot open the app.
 *
 * Tools load when first visited, so an opener registered by a tool's component
 * would be missing until then. A tool registers from a small module named
 * `tools/**\/*.opener.js` instead, which `openersLoaded.js` loads with the note.
 */
import { TOOL_LABELS } from '../workspaces.js';

const openers = new Map();

/**
 * `tool` reopens the pictures `accepts(entity)` answers true for, with
 * `open(entity)`. `label` overrides `Open in <the tool's name>`. Returns its undoing.
 */
export function registerOpener(tool, { accepts, open, label = '' } = {}) {
  if (!tool || typeof accepts !== 'function' || typeof open !== 'function') return () => {};
  const opener = { tool, accepts, open, label };
  openers.set(tool, opener);
  return () => {
    if (openers.get(tool) === opener) openers.delete(tool);
  };
}

/** What reopens this picture's entity: `{ tool, label, open() }`, or null when no tool can. */
export function openerFor(entity) {
  if (!entity?.id) return null;
  for (const opener of openers.values()) {
    let yes = false;
    try {
      yes = Boolean(opener.accepts(entity));
    } catch {
      yes = false;
    }
    if (yes) {
      return {
        tool: opener.tool,
        label: opener.label || `Open in ${TOOL_LABELS[opener.tool] ?? opener.tool}`,
        open: () => opener.open(entity),
      };
    }
  }
  return null;
}

/** For tests: forget every opener. */
export function resetOpeners() {
  openers.clear();
}
