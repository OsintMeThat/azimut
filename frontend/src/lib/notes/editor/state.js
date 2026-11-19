/**
 * What every part of the note editor reads: the case a note belongs to, whether it
 * writes a template, the editor's outside, whether it has focus, and the drawn block
 * whose source is open. No part of the page is drawn here.
 */
import { Facet, StateEffect, StateField } from '@codemirror/state';

import { NO_IDENTITY } from '../reportParts.js';

/**
 * The case the note belongs to and its records, which the chips and pictures are
 * drawn from, and its notes as the home lists them (`notes/index` rows), which a
 * chapter is drawn from. `identity` is who signs, as Settings › Publishing keeps
 * it (`lib/notes/reportParts.js`): what `{name}` shows, and whether the logo and
 * the signature are set.
 */
export const setNoteCase = StateEffect.define();

export const noteCase = StateField.define({
  create: () => ({ caseId: '', entities: [], byId: new Map(), redirects: {}, notes: new Map(), identity: NO_IDENTITY }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setNoteCase)) {
        const entities = effect.value.entities ?? [];
        return {
          caseId: effect.value.caseId ?? '',
          entities,
          byId: new Map(entities.map((entity) => [entity.id, entity])),
          redirects: effect.value.redirects ?? {},
          notes: new Map((effect.value.notes ?? []).map((row) => [row.id, row])),
          identity: effect.value.identity ?? NO_IDENTITY,
        };
      }
    }
    return value;
  },
});

/**
 * Whether the editor writes a template rather than a note. A template's guidance
 * is its own text, edited like any line; in a note it is a prompt that typing
 * replaces.
 */
export const templateMode = Facet.define({ combine: (values) => values.some(Boolean) });

/**
 * The editor's outside, for what the page draws: a picture's bar asks it which tool
 * reopens the picture (`opener(entity)`), whether its source is the analyst's to state
 * (`sourceable(entity)`, a promise) and to state it (`stateSource(entity, url)`), and
 * where a proof was posted (`statePosted(entity, url)`, absent where it cannot be kept).
 */
export const noteHandlers = Facet.define({ combine: (values) => values[0] ?? {} });

/** Whether the editor has focus, which is when a block at the cursor is picked and a template's guidance line is text. */
export const setFocused = StateEffect.define();
export const focused = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFocused)) return effect.value;
    return value;
  },
});

/** The lines the cursor is on while the editor has focus: where a template's guidance shows as text. */
export function cursorLines(state) {
  const lines = new Set();
  if (!state.field(focused, false)) return lines;
  for (const range of state.selection.ranges) if (range.empty) lines.add(state.doc.lineAt(range.head).number);
  return lines;
}

/**
 * While the mouse is pressed on the page, `{ lines }`: the lines that showed their marks
 * when it went down, and only those show them until it is let go, so nothing moves under
 * the pointer. A drag selects the words that were seen, a double press the word that was
 * seen. False the rest of the time, and as soon as anything is typed.
 */
export const setSelecting = StateEffect.define();
export const selecting = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSelecting)) return effect.value;
    return transaction.docChanged ? false : value;
  },
});

/**
 * Where the caret stood right after the last thing typed, or -1 once it moved or the
 * text changed any other way. The page draws a shortcut being typed (`##`, `-`, the
 * second `*` of `**words**`) as typed while the caret is still just after it, so
 * nothing flashes into a heading or a bullet before the space that makes it one.
 */
export const typedAt = StateField.define({
  create: () => -1,
  update(value, transaction) {
    if (transaction.docChanged) return transaction.isUserEvent('input.type') ? transaction.state.selection.main.head : -1;
    return transaction.selection ? -1 : value;
  },
});

/** The record `id` names in the case, following a merge, or null. */
export function resolve(info, id) {
  const to = info.redirects?.[id]?.id ?? id;
  return info.byId.get(to) ?? null;
}

/**
 * The block whose source is open, `{ from, to }` over its lines, or null. A drawn
 * block shows its source only while it is open (or the cursor is inside it, which a
 * jump or an Undo can do); the field follows the typing in it and lets go as soon as
 * the cursor leaves.
 */
export const setOpenBlock = StateEffect.define();
export const openBlock = StateField.define({
  create: () => null,
  update(value, transaction) {
    let next = value;
    if (next && transaction.docChanged) next = { from: transaction.changes.mapPos(next.from, -1), to: transaction.changes.mapPos(next.to, 1) };
    for (const effect of transaction.effects) if (effect.is(setOpenBlock)) next = effect.value;
    if (next) {
      const { head } = transaction.newSelection.main;
      if (head < next.from || head > next.to) next = null;
    }
    return next;
  },
});
