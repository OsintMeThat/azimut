/**
 * The `/` menu: typed at the start of a word, it offers what `SLASH_COMMANDS`
 * (`lib/notes/syntax.js`) lists, best first, and picking one writes it.
 *
 * The entries are data. How an entry writes is named by the field it carries, and
 * each such way is one writer in `SLASH_WRITERS`: an entry is added with a line in
 * `SLASH_COMMANDS`, and a new way of writing with one writer here.
 */
import { startCompletion } from '@codemirror/autocomplete';

import { slashInsert, slashMatches } from '../syntax.js';

/**
 * How each kind of entry writes when it is picked. Each gets the `command` picked,
 * `start`–`end` (the `/` and what was typed after it), the `line` it was typed on,
 * what stands `before` the `/` on that line, and the editor's `handlers`.
 */
export const SLASH_WRITERS = {
  // Case item: an `@`, which offers the case's records
  cite: (view, { start, end }) => {
    view.dispatch({ changes: { from: start, to: end, insert: '@' }, selection: { anchor: start + 1 } });
    startCompletion(view);
  },
  // an action opens something (the record picker, a file) rather than writing
  action: (view, { command, start, end, handlers }) => {
    view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } });
    handlers[command.action]?.();
  },
  // a group: type its name, and its commands come up together
  menu: (view, { command, start, end }) => {
    const typed = `/${command.menu}`;
    view.dispatch({ changes: { from: start, to: end, insert: typed }, selection: { anchor: start + typed.length } });
    startCompletion(view);
  },
  // the whole line goes in a `:::` block, what was typed before the / and what follows the cursor
  wrap: (view, { command, end, line, before }) => {
    const made = slashInsert(command, { before: `${before}${view.state.sliceDoc(end, line.to)}` });
    view.dispatch({ changes: { from: line.from, to: line.to, insert: made.text }, selection: { anchor: line.from + made.cursor }, userEvent: 'input.complete' });
  },
  // a line command restyles the line it is typed on
  line: (view, { command, start, end, line, before }) => {
    const made = slashInsert(command, { before });
    view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } });
    if (!before.trim()) {
      view.dispatch({ changes: { from: line.from, to: start, insert: command.line }, selection: { anchor: line.from + command.line.length } });
    } else {
      view.dispatch({ changes: { from: start, insert: made.text }, selection: { anchor: start + made.cursor } });
    }
  },
  // a block on lines of its own, a dated log entry, today's date or a line of guidance
  insert: (view, { command, start, end, before }) => {
    const made = slashInsert(command, { before });
    view.dispatch({ changes: { from: start, to: end, insert: made.text }, selection: { anchor: start + made.cursor }, userEvent: 'input.complete' });
  },
};

/** The writer an entry takes, by the first of its fields that names one. */
export function slashWriter(command) {
  if (command.action === 'cite') return 'cite';
  return ['action', 'menu', 'wrap', 'line'].find((field) => command[field]) ?? 'insert';
}

/** One entry as the menu shows it, and what picking it writes on `line`, after `before`. */
export function slashOption(command, { handlers = {}, line, before = '' }) {
  return {
    label: command.label,
    detail: command.hint ?? '',
    type: command.action ? 'action' : 'block',
    apply: (view, _completion, start, end) => SLASH_WRITERS[slashWriter(command)](view, {
      command, start, end, line, before, handlers,
    }),
  };
}

/** The completion source of the `/` menu: what a template or a note offers, for the editor's `handlers`. */
export function slashSource(handlers, { template = false } = {}) {
  return (context) => {
    const typed = context.matchBefore(/(?:^|\s)\/[\w-]{0,20}$/);
    if (!typed) return null;
    const slash = typed.text.indexOf('/');
    const from = typed.from + slash;
    const line = context.state.doc.lineAt(from);
    if (context.state.sliceDoc(line.from, from).includes('`')) return null;
    const query = context.state.sliceDoc(from + 1, context.pos);
    const before = context.state.sliceDoc(line.from, from);
    return {
      from,
      filter: false,
      options: slashMatches(query, { template }).map((command) => slashOption(command, { handlers, line, before })),
    };
  };
}
