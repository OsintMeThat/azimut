import { foldTerms, foldText } from './textFold.js';
import { workspaceOf } from './workspaces.js';

export function isPaletteKey(event) {
  return Boolean(
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
    !event.repeat && !event.isComposing && !event.defaultPrevented &&
    event.key?.toLowerCase() === 'k'
  );
}

/**
 * `label` cut into runs, each marked with whether a search term matched it.
 *
 * Folded one character at a time so a match found in folded text points back at the
 * characters the analyst sees. Where that per-character fold differs from folding the
 * whole label (a mark that belongs to its letter), nothing is marked rather than the
 * wrong letters.
 */
export function matchRuns(label, query) {
  const text = String(label ?? '');
  const terms = foldTerms(query);
  if (!terms.length || !text) return [{ text, hit: false }];
  const chars = [...text];
  const owner = [];
  let folded = '';
  chars.forEach((char, index) => {
    const part = foldText(char);
    folded += part;
    for (let unit = 0; unit < part.length; unit += 1) owner.push(index);
  });
  if (folded !== foldText(text)) return [{ text, hit: false }];
  const hits = new Array(chars.length).fill(false);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      for (let unit = at; unit < at + term.length; unit += 1) hits[owner[unit]] = true;
    }
  }
  const runs = [];
  chars.forEach((char, index) => {
    const last = runs[runs.length - 1];
    if (last && last.hit === hits[index]) last.text += char;
    else runs.push({ text: char, hit: hits[index] });
  });
  return runs;
}

/** Find tools by their displayed name, workspace or stable id. */
export function paletteTools(tools, query) {
  const terms = foldTerms(query);
  return tools.map(({ id, label }) => {
    const workspace = workspaceOf(id);
    return {
      kind: 'tool', id, label,
      detail: workspace?.label ?? label,
      icon: workspace?.icon ?? 'settings',
    };
  }).filter((row) => {
    const text = foldText(`${row.label} ${row.detail} ${row.id}`);
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    const queryText = foldText(query.trim());
    return Number(foldText(b.label).startsWith(queryText)) - Number(foldText(a.label).startsWith(queryText));
  });
}
