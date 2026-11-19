import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { undo } from '@codemirror/commands';

import { focusedState, noteDecorations, noteState, openedState } from '../liveMarkdown.js';
import { caretAt, keptChange, markAtCaret, marksAround, pendingMarks, spaceShortcut, stepLeft, stepRight, wordsStart } from './caret.js';

/**
 * The drawn page never shows its Markdown, the line the cursor is on included, and the
 * caret never stands among the marks it put away: what the page shows is pinned here for
 * every construct and every place of the cursor on its line, with the caret's moves and
 * what a change next to the marks keeps.
 */

const CASE = { caseId: 'c1', entities: [{ id: 'p1', type: 'place', label: 'Quay', attrs: {} }] };

/** The words the page shows: what is put away gone, a widget as `[its kind]`, a block as `[block]`. */
function shown(state) {
  const pieces = [];
  noteDecorations(state).between(0, state.doc.length, (from, to, value) => {
    if (to > from && (value.spec.widget || value.spec.conceal)) pieces.push({ from, to, widget: value.spec.widget, block: value.spec.block });
  });
  pieces.sort((a, b) => a.from - b.from || b.to - a.to);
  let out = '';
  let at = 0;
  for (const piece of pieces) {
    if (piece.from < at) continue;
    out += state.sliceDoc(at, piece.from);
    if (piece.block) out += '[block]';
    else if (piece.widget) out += `[${piece.widget.constructor.name.replace('Widget', '').toLowerCase()}]`;
    at = piece.to;
  }
  return out + state.sliceDoc(at);
}

/** The state with the editor focused and the cursor at `pos`. */
function at(state, pos) {
  return focusedState(state.update({ selection: EditorSelection.cursor(pos) }).state);
}

/** What the page shows with the cursor at each place of the line `number`, all the same. */
function shownOnLine(text, number = 1) {
  const state = noteState(text, { caseInfo: CASE });
  const line = state.doc.line(number);
  const seen = new Set();
  for (let pos = line.from; pos <= line.to; pos += 1) seen.add(shown(at(state, pos)));
  expect([...seen], 'the page is the same wherever the cursor is on the line').toHaveLength(1);
  return [...seen][0];
}

/** A state right after typing `typed` at the end of `before`, as the editor sees it. */
function typedState(before, typed) {
  const state = focusedState(noteState(before, { caseInfo: CASE }).update({ selection: EditorSelection.cursor(before.length) }).state);
  return state.update({ changes: { from: before.length, insert: typed }, selection: EditorSelection.cursor(before.length + typed.length), userEvent: 'input.type' }).state;
}

describe('the cursor line shows no Markdown', () => {
  it('draws a heading at its size, its # put away', () => {
    expect(shownOnLine('## The convoy')).toBe('The convoy');
    expect(shownOnLine('# One ##')).toBe('One');
  });

  it('draws bold, italic, strikethrough and code, their marks put away', () => {
    expect(shownOnLine('A **bold** and *italic* and ~~struck~~ and `code` here')).toBe('A bold and italic and struck and code here');
    expect(shownOnLine('***both*** then')).toBe('both then');
  });

  it('draws a link as its words, its address never inline, and says it on hover', () => {
    expect(shownOnLine('See [the report](https://example.org/r?a=1) now')).toBe('See the report now');
    const state = at(noteState('See [the report](https://example.org/r) now'), 2);
    let title = '';
    noteDecorations(state).between(0, state.doc.length, (_from, _to, value) => { title = value.spec.attributes?.title ?? title; });
    expect(title).toMatch(/^https:\/\/example\.org\/r\n(Ctrl|⌘)\+click to open, Ctrl\+K to edit$/);
  });

  it('leaves words in brackets with no address as written, as the PDF prints them', () => {
    expect(shownOnLine('Source [1] and [sic] here')).toBe('Source [1] and [sic] here');
  });

  it('draws bullets, numbers and to-do boxes, their marks put away', () => {
    const text = '- first\n  - nested\n1. one\n7. two\n- [ ] open\n- [x] done';
    expect(shownOnLine(text, 1)).toBe('[bullet]first\n  [bullet]nested\n[number]one\n[number]two\n[task]open\n[task]done');
    const numbers = [];
    noteDecorations(at(noteState(text), 0)).between(0, text.length, (_from, _to, value) => {
      if (value.spec.widget?.label) numbers.push(value.spec.widget.label);
    });
    // a list prints its first item's number, then one more each
    expect(numbers).toEqual(['1.', '2.']);
  });

  it('names a callout in place of its marker, and its lines show no >', () => {
    const text = '> [!confirmed] The mast matches.\n> Second line.';
    expect(shownOnLine(text, 1)).toBe('[calloutlabel]The mast matches.\nSecond line.');
    expect(shownOnLine(text, 2)).toBe('[calloutlabel]The mast matches.\nSecond line.');
    expect(shownOnLine('> [!internal]\n> Team only.', 2)).toBe('[calloutlabel]\nTeam only.');
    expect(shownOnLine('> Words someone said.')).toBe('Words someone said.');
  });

  it('keeps a chip and a filled-in word drawn on the cursor line', () => {
    expect(shownOnLine('Seen at [[entity:p1|Quay]] on {date}')).toBe('Seen at [chip] on [placeholder]');
  });

  it('draws a divider as a block, and an escaped mark as the mark', () => {
    expect(shownOnLine('Before\n\n---\n\nAfter', 1)).toBe('Before\n\n[block]\n\nAfter');
    expect(shownOnLine('Not \\*bold\\* here')).toBe('Not *bold* here');
  });

  it('shows the source of an open block only, every line of it', () => {
    const text = '::: center\n**Big** [[entity:p1|Quay]]\n:::\n\n**Out**';
    const state = noteState(text, { caseInfo: CASE });
    expect(shown(at(state, text.indexOf('Out')))).toBe('[block]\n\nOut');
    expect(shown(openedState(state, 0))).toBe('::: center\n**Big** [[entity:p1|Quay]]\n:::\n\nOut');
  });
});

describe('a shortcut being typed', () => {
  it('stays as typed until the space that makes it, then is drawn at once', () => {
    expect(shown(typedState('', '##'))).toBe('##');
    expect(shown(typedState('##', ' '))).toBe('');
    expect(shown(typedState('', '-'))).toBe('-');
    expect(shown(typedState('-', ' '))).toBe('[bullet]');
    expect(shown(typedState('', '1.'))).toBe('1.');
    expect(shown(typedState('1.', ' '))).toBe('[number]');
    expect(shown(typedState('', '>'))).toBe('>');
    expect(shown(typedState('>', ' '))).toBe('');
  });

  it('draws a `**` that never closes as typed, and bold once it does, never italics between', () => {
    expect(shown(typedState('A ', '**words'))).toBe('A **words');
    expect(shown(typedState('A **words', '*'))).toBe('A **words*');
    expect(shown(typedState('A **words*', '*'))).toBe('A words');
  });

  it('draws a shortcut as Markdown reads it once the caret moves on', () => {
    const state = typedState('', '##');
    expect(shown(state.update({ selection: EditorSelection.cursor(0) }).state)).toBe('');
  });

  it('never underlines words for a `-` typed under them, before its space', () => {
    const state = typedState('Findings\n', '-');
    expect(shown(state)).toBe('Findings\n-');
    let heading = false;
    noteDecorations(state).between(0, state.doc.length, (_from, _to, value) => { heading ||= /cm-heading/.test(value.spec.class ?? ''); });
    expect(heading).toBe(false);
  });
});

describe('the caret', () => {
  const text = 'x **bold** y\n## Head\n- item';
  const state = noteState(text);

  it('never stands among a line\'s marks', () => {
    expect(wordsStart(state, state.doc.line(2))).toBe(text.indexOf('Head'));
    expect(caretAt(state, text.indexOf('##'))).toBe(text.indexOf('Head'));
    expect(caretAt(state, text.indexOf('- item'))).toBe(text.indexOf('item'));
  });

  it('crosses the marks around words as nothing, one character that shows at a time', () => {
    const right = [];
    for (let pos = 0, step = 0; step < 40; step += 1) {
      right.push(pos);
      const next = stepRight(state, pos);
      if (next === pos) break;
      pos = next;
    }
    // x, space, b o l d, space, y, end of line; then the heading's words, then the item's
    expect(right).toEqual([0, 1, 2, 5, 6, 7, 8, 11, 12, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27]);
    const left = [];
    for (let pos = text.length, step = 0; step < 40; step += 1) {
      left.push(pos);
      const next = stepLeft(state, pos);
      if (next === pos) break;
      pos = next;
    }
    expect(left).toEqual([...right].reverse());
  });

  it('stands where typing should go: inside bold at its end, outside before it, outside a link and code at their end', () => {
    expect(caretAt(state, 4)).toBe(2); // before bold: outside
    expect(caretAt(state, 10)).toBe(8); // after bold: inside, so what is typed is bold
    const link = noteState('a [w](https://x.y) b `c` d');
    expect(caretAt(link, link.doc.toString().indexOf('](') )).toBe(link.doc.toString().indexOf(') b') + 1);
    expect(caretAt(link, link.doc.toString().indexOf('` d'))).toBe(link.doc.toString().indexOf('` d') + 1);
    // at the start of a line's words the first word's bold is carried
    const lead = noteState('## **Big** news');
    expect(caretAt(lead, 0)).toBe(5);
  });

  it('crosses a chip as one character', () => {
    const chip = noteState('a [[entity:p1|Quay]] b', { caseInfo: CASE });
    expect(stepRight(chip, 2)).toBe(20);
    expect(stepLeft(chip, 20)).toBe(2);
    expect(caretAt(chip, 9)).toBe(2);
  });

  it('is put back in the words when a press, a key or a jump puts it among the marks', () => {
    const focused = focusedState(state);
    const pressed = focused.update({ selection: EditorSelection.cursor(text.indexOf('##')), userEvent: 'select.pointer' }).state;
    expect(pressed.selection.main.head).toBe(text.indexOf('Head'));
    const jumped = focused.update({ selection: EditorSelection.cursor(text.indexOf('- item')) }).state;
    expect(jumped.selection.main.head).toBe(text.indexOf('item'));
    // a press just after bold lands inside it, where typing carries it
    const after = focused.update({ selection: EditorSelection.cursor(10), userEvent: 'select.pointer' }).state;
    expect(after.selection.main.head).toBe(8);
  });
});

describe('Ctrl+B at the caret', () => {
  const state = noteState('x **bold** y');

  it('steps out of bold at its end, and back in', () => {
    const out = markAtCaret(state.update({ selection: EditorSelection.cursor(8) }).state, 'bold');
    expect(out.selection.main.head).toBe(10);
    const back = markAtCaret(state.update({ selection: EditorSelection.cursor(10) }).state, 'bold');
    expect(back.selection.main.head).toBe(8);
  });

  it('holds the mark for what is typed next anywhere else, and lets it go on a second press', () => {
    const plain = state.update({ selection: EditorSelection.cursor(1) }).state;
    const held = plain.update(markAtCaret(plain, 'bold')).state;
    expect(held.field(pendingMarks)).toEqual({ at: 1, kinds: ['bold'] });
    const both = held.update(markAtCaret(held, 'italic')).state;
    expect(both.field(pendingMarks).kinds).toEqual(['bold', 'italic']);
    expect(marksAround(both.field(pendingMarks).kinds)).toEqual({ open: '***', close: '***' });
    const gone = held.update(markAtCaret(held, 'bold')).state;
    expect(gone.field(pendingMarks)).toBeNull();
    // and a move lets it go
    expect(held.update({ selection: EditorSelection.cursor(0) }).state.field(pendingMarks)).toBeNull();
  });
});

describe('a space after a shortcut', () => {
  it('makes `[] ` a to-do, alone or in a list', () => {
    const run = (text) => {
      const state = noteState(text);
      const spec = spaceShortcut(state, text.length);
      return state.update(spec).state.doc.toString();
    };
    expect(run('[]')).toBe('- [ ] ');
    expect(run('[x]')).toBe('- [x] ');
    expect(run('- []')).toBe('- [ ] ');
    expect(run('> []')).toBe('> - [ ] ');
  });

  it('parts a list started under words from them, so it is one', () => {
    const state = noteState('Findings\n-');
    const after = state.update(spaceShortcut(state, state.doc.length)).state;
    expect(after.doc.toString()).toBe('Findings\n\n- ');
    expect(after.selection.main.head).toBe(after.doc.length);
    expect(spaceShortcut(noteState('\n-'), 2)).toBeNull();
    expect(spaceShortcut(noteState('- a\n-'), 5)).toBeNull();
  });
});

describe('a change next to marks put away', () => {
  /** The text after `change`, as kept; the change as it came when it cuts no mark. */
  const run = (text, change) => {
    const state = noteState(text);
    const kept = keptChange(state, change);
    return state.update({ changes: kept ? kept.changes : change }).state.doc.toString();
  };

  it('never takes half a mark', () => {
    // the selection from the start of bold to the middle of its words: the words go, the marks stay
    expect(run('x **bold** y', { from: 2, to: 6 })).toBe('x **ld** y');
    expect(run('x **bold** y', { from: 6, to: 11 })).toBe('x **bo**y');
    expect(run('a [link](https://x.y) b', { from: 0, to: 4 })).toBe('[ink](https://x.y) b');
  });

  it('takes the marks of words deleted entirely with them', () => {
    expect(run('x **bold** y', { from: 4, to: 8 })).toBe('x  y');
    expect(run('x **bold** y', { from: 0, to: 12 })).toBe('');
    expect(keptChange(noteState('x **bold** y'), { from: 0, to: 12 })).toBeNull();
    expect(run('x ***both*** y', { from: 5, to: 9 })).toBe('x  y');
  });

  it('keeps the marks around what is typed over their words', () => {
    expect(run('x **bold** y', { from: 4, to: 8, insert: 'new' })).toBe('x **new** y');
  });
});

describe('Undo', () => {
  it('gives back the exact bytes of a change that kept marks', () => {
    const state = noteState('x **bold** y');
    const kept = keptChange(state, { from: 2, to: 6 });
    const after = state.update({ changes: kept.changes }).state;
    let back = null;
    undo({ state: after, dispatch: (transaction) => { back = transaction.state; } });
    expect(back.doc.toString()).toBe('x **bold** y');
  });
});
