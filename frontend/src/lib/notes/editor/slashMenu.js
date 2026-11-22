/**
 * The `/` menu, which the + in the margin opens too (`editor/insertMenu.js`): typed
 * at the start of a word, it offers what `SLASH_COMMANDS` (`lib/notes/syntax.js`)
 * lists, best first, and picking one writes it. With nothing typed yet it shows the
 * menu's five parts, each entry with its icon, its name, a line saying what it is
 * and, beside the list, a preview of what it makes (`editor/insertPreview.js`).
 *
 * The entries are data. How an entry writes is named by the field it carries, and
 * each such way is one writer in `SLASH_WRITERS`: an entry is added with a line in
 * `SLASH_COMMANDS`, and a new way of writing with one writer here. Each writer is
 * one change, so one Undo takes it back.
 */
import { startCompletion } from '@codemirror/autocomplete';

import { slashGroup, slashHint, slashInsert, slashMatches, slashSection } from '../syntax.js';
import { openFootnoteField } from './bubble.js';
import { columnAt } from './columnsRow.js';
import { insertHintUsed } from './insertHint.js';
import { plusAt } from './insertMenu.js';
import { insertPreview } from './insertPreview.js';

/**
 * How each kind of entry writes when it is picked. Each gets the `command` picked,
 * `start`–`end` (the `/` and what was typed after it), the `line` it was typed on,
 * what stands `before` the `/` on that line, and the editor's `handlers`.
 */
export const SLASH_WRITERS = {
  // Case item: an `@`, which offers the case's records
  cite: (view, { start, end }) => {
    const typed = `${spaceBefore(view, start)}@`;
    view.dispatch({ changes: { from: start, to: end, insert: typed }, selection: { anchor: start + typed.length } });
    startCompletion(view);
  },
  // an action opens something (the record picker, a file) rather than writing
  action: (view, { command, start, end, handlers }) => {
    if (end > start) view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } });
    handlers[command.action]?.();
  },
  // a footnote: what was typed goes, with the space before it so the letter sits on the word, and the Footnote field opens there
  footnote: (view, { start, end, line }) => {
    const from = start > line.from && view.state.sliceDoc(start - 1, start) === ' ' && !/\s/.test(view.state.sliceDoc(start - 2, start - 1)) ? start - 1 : start;
    view.dispatch({ changes: { from, to: end, insert: '' }, selection: { anchor: from }, userEvent: 'input.complete' });
    if (openFootnoteField(view, { at: from })) return;
    // the raw Markdown has no field: its brackets are written, the cursor between them
    view.dispatch({ changes: { from, insert: '^[]' }, selection: { anchor: from + 2 } });
  },
  // a group: type its name, and its commands come up together
  menu: (view, { command, start, end }) => {
    const typed = `${spaceBefore(view, start)}/${command.menu}`;
    view.dispatch({ changes: { from: start, to: end, insert: typed }, selection: { anchor: start + typed.length } });
    startCompletion(view);
  },
  // the whole line goes in a `:::` block, what was typed before the / and what follows the cursor
  wrap: (view, { command, end, line, before }) => {
    const made = slashInsert(command, { before: `${before}${view.state.sliceDoc(end, line.to)}` });
    view.dispatch({ changes: { from: line.from, to: line.to, insert: made.text }, selection: { anchor: line.from + made.cursor }, userEvent: 'input.complete' });
  },
  // a line command restyles the line it is typed on, or starts a line of its own after words
  line: (view, { command, start, end, line, before }) => {
    if (!before.trim()) {
      view.dispatch({ changes: { from: line.from, to: end, insert: command.line }, selection: { anchor: line.from + command.line.length }, userEvent: 'input.complete' });
      return;
    }
    const made = slashInsert(command, { before });
    view.dispatch({ changes: { from: start, to: end, insert: made.text }, selection: { anchor: start + made.cursor }, userEvent: 'input.complete' });
  },
  // a block on lines of its own, a dated log entry, today's date, a field or a line of guidance
  insert: (view, { command, start, end, before }) => {
    const made = slashInsert(command, { before });
    view.dispatch({ changes: { from: start, to: end, insert: made.text }, selection: { anchor: start + made.cursor }, userEvent: 'input.complete' });
  },
};

/** A space when `at` follows a word, where the menu was opened by the + rather than a typed `/`: a `/` or an `@` starts a word. */
function spaceBefore(view, at) {
  const line = view.state.doc.lineAt(at);
  return at > line.from && !/\s/.test(view.state.sliceDoc(at - 1, at)) ? ' ' : '';
}

/** The writer an entry takes, by the first of its fields that names one. */
export function slashWriter(command) {
  if (command.action === 'cite') return 'cite';
  if (command.footnote) return 'footnote';
  return ['action', 'menu', 'wrap', 'line'].find((field) => command[field]) ?? 'insert';
}

/**
 * One entry as the menu shows it, and what picking it writes on `line`, after
 * `before`. `section` puts it under its part's name (the bare list, or a group
 * opened by its name).
 */
export function slashOption(command, { handlers = {}, line, before = '', section = null }) {
  return {
    label: command.label,
    detail: slashHint(command),
    type: command.action ? 'action' : 'block',
    insertEntry: command,
    ...(section ? { section } : {}),
    info: () => insertPreview(command),
    apply: (view, _completion, start, end) => {
      insertHintUsed();
      SLASH_WRITERS[slashWriter(command)](view, { command, start, end, line, before, handlers });
    },
  };
}

/** What was typed for the menu and where it starts: after a `/`, or where the + opened it. */
function typedQuery(context) {
  const plus = context.state.field(plusAt, false);
  if (plus != null && plus <= context.pos) {
    const line = context.state.doc.lineAt(context.pos);
    const typed = context.state.sliceDoc(plus, context.pos);
    if (plus >= line.from && /^[\w-]{0,20}$/.test(typed)) return { from: plus, query: typed, line };
  }
  const typed = context.matchBefore(/(?:^|\s)\/[\w-]{0,20}$/);
  if (!typed) return null;
  const from = typed.from + typed.text.indexOf('/');
  const line = context.state.doc.lineAt(from);
  if (context.state.sliceDoc(line.from, from).includes('`')) return null;
  return { from, query: context.state.sliceDoc(from + 1, context.pos), line };
}

/** The completion source of the `/` menu: what a template or a note offers, for the editor's `handlers`. */
export function slashSource(handlers, { template = false } = {}) {
  return (context) => {
    const typed = typedQuery(context);
    if (!typed) return null;
    const { from, query, line } = typed;
    const before = context.state.sliceDoc(line.from, from);
    const group = slashGroup(query);
    // in a column of a row, only what fits in one
    const commands = slashMatches(query, { template, inColumn: Boolean(columnAt(context.state, from)) });
    return {
      from,
      filter: false,
      options: commands.map((command) => {
        const part = query ? null : slashSection(command);
        const section = part ? { name: part.label, rank: part.rank } : group ? { name: group.label, rank: 0 } : null;
        return slashOption(command, { handlers, line, before, section });
      }),
    };
  };
}
