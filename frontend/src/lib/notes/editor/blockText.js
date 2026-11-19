/**
 * Where a block's text goes in a note, read from the text alone, so a module may place
 * a block without loading any kind of block (the registry's order is `kinds.js`'s).
 */

/**
 * The text that puts `text` at `pos` on lines of its own: a blank line from words
 * before it and after it, so a table or a picture is read as one. `inline` puts it
 * in the line at `pos` instead, with a space either side, as a citation is written.
 * Answers `{ insert, start, end }`, the text and where `text` sits in it.
 */
export function blockAt(state, pos, text, { inline = false } = {}) {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  if (inline) {
    const before = state.sliceDoc(at - 1, at);
    const after = state.sliceDoc(at, at + 1);
    const lead = before && !/\s/.test(before) ? ' ' : '';
    const trail = !after || !/\s/.test(after) ? ' ' : '';
    return { insert: `${lead}${text}${trail}`, start: lead.length, end: lead.length + text.length };
  }
  const line = state.doc.lineAt(at);
  const head = line.text.slice(0, at - line.from);
  const tail = line.text.slice(at - line.from);
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : null;
  // words before it on this line take a blank line; an empty line under words, one more break
  const lead = head.trim() ? '\n\n' : !head && previous.trim() ? '\n' : '';
  // the line's own break follows it unless it is the last: words after it take a blank line
  const trail = tail.trim() ? '\n\n' : next === null ? '\n' : next.trim() ? '\n' : '';
  const insert = `${lead}${text}${trail}`;
  return { insert, start: lead.length, end: lead.length + text.length };
}
