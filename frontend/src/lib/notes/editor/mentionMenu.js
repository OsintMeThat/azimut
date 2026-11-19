/**
 * The `@` menu: `@` and a few letters offer the case's records, and picking one
 * writes its chip. A table's cell offers the same records (`editor/cellMention.js`).
 */
import { entityReference } from '../../markdown.js';
import { mentionMatches } from '../syntax.js';
import { noteCase } from './state.js';

/** The records `@` offers for `query`, each with how the menu shows it: its name, and its kind and folder. */
export function mentionChoices(entities, query) {
  return mentionMatches(entities, query).map((entity) => ({
    entity,
    label: entity.label,
    detail: [entity.type, entity.attrs?.folder].filter(Boolean).join(' · '),
  }));
}

/** The completion source of the `@` menu: the records whose name holds what was typed, a chip each. */
export function mentionSource(context) {
  const typed = context.matchBefore(/@[^\s@[\]()]{0,40}$/);
  if (!typed) return null;
  const before = context.state.sliceDoc(typed.from - 1, typed.from);
  if (before && /[\w.]/.test(before)) return null; // an address, not a mention
  const info = context.state.field(noteCase);
  const query = typed.text.slice(1);
  if (!query && !context.explicit && !info.entities.length) return null;
  return {
    from: typed.from,
    filter: false,
    options: mentionChoices(info.entities, query).map(({ entity, label, detail }) => ({
      label,
      detail,
      type: 'mention',
      apply: (view, _completion, from, to) => {
        // a mention names a record; a picture is put in with / or the Picture button
        const text = entityReference(entity);
        const after = view.state.sliceDoc(to, to + 1);
        const insert = after && /\s/.test(after) ? text : `${text} `;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete' });
      },
    })),
  };
}
