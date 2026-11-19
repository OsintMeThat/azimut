import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { undo } from '@codemirror/commands';

import { noteState } from '../liveMarkdown.js';
import { backspaceAt, deleteAt, enterAt, indentItems } from './lineKeys.js';

/**
 * Enter, Backspace, Delete and Tab on the drawn page act on what it shows: each rule is
 * pinned with the exact text it writes, where the caret ends, and one Undo giving back
 * the exact bytes. `‸` marks the caret.
 */

/** The state of `text`, its `‸` the caret. */
function state(text) {
  const at = text.indexOf('‸');
  return noteState(text.replace('‸', '')).update({ selection: EditorSelection.cursor(at) }).state;
}

/** The text after `rule` at the caret, `‸` the caret after it; null when the rule leaves the key to the editor. */
function press(rule, text, ...args) {
  const before = state(text);
  const spec = rule(before, ...args);
  if (!spec) return null;
  if (!spec.changes && !spec.selection) return 'nothing';
  const after = before.update(spec).state;
  let back = null;
  undo({ state: after, dispatch: (transaction) => { back = transaction.state; } });
  if (spec.changes) expect(back?.doc.toString(), 'one Undo gives back the exact bytes').toBe(before.doc.toString());
  const doc = after.doc.toString();
  const head = after.selection.main.head;
  return `${doc.slice(0, head)}‸${doc.slice(head)}`;
}

describe('Enter', () => {
  it('leaves Markdown to continue a list, a quote and a callout', () => {
    expect(press(enterAt, '- one‸')).toBeNull();
    expect(press(enterAt, '> [!confirmed] The mast‸')).toBeNull();
    expect(press(enterAt, '> words‸')).toBeNull();
    expect(press(enterAt, 'Plain words‸')).toBeNull();
  });

  it('leaves a list on an empty item, a blank line keeping what comes next out of it', () => {
    expect(press(enterAt, '- one\n- ‸')).toBe('- one\n\n‸');
    expect(press(enterAt, '- one\n- [ ] ‸')).toBe('- one\n\n‸');
    expect(press(enterAt, '- ‸')).toBe('‸');
    expect(press(enterAt, '> - one\n> - ‸')).toBe('> - one\n>\n> ‸');
  });

  it('takes an empty nested item out one level', () => {
    expect(press(enterAt, '- one\n  - ‸')).toBe('- one\n- ‸');
    expect(press(enterAt, '1. one\n   1. ‸')).toBe('1. one\n2. ‸');
  });

  it('leaves a quote or a callout on its empty last line', () => {
    expect(press(enterAt, '> [!lead] Follow the ship\n> ‸')).toBe('> [!lead] Follow the ship\n\n‸');
    expect(press(enterAt, '> words\n>‸')).toBe('> words\n\n‸');
    expect(press(enterAt, '> ‸')).toBe('‸');
    // a callout's name alone goes on to its first line of words
    expect(press(enterAt, '> [!lead] ‸')).toBeNull();
  });

  it('opens a line above a heading or an item when pressed at the start of its words', () => {
    expect(press(enterAt, 'Intro\n## ‸Title')).toBe('Intro\n\n## ‸Title');
    expect(press(enterAt, '- one\n- ‸two')).toBe('- one\n- \n- ‸two');
    expect(press(enterAt, '- one\n- [x] ‸two')).toBe('- one\n- [ ] \n- [x] ‸two');
    // an empty item right under words would underline them: a blank line first
    expect(press(enterAt, 'Findings\n- ‸one')).toBe('Findings\n\n- \n- ‸one');
  });
});

describe('Backspace', () => {
  it('takes the character that shows, never half a mark', () => {
    expect(press(backspaceAt, 'x **bold‸** y')).toBe('x **bol‸** y');
    // the caret just after the closing marks, as Ctrl+B leaves it
    expect(press(backspaceAt, 'x **bold**‸ y')).toBe('x **bol‸** y');
    expect(press(backspaceAt, 'See [words](https://a.b)‸ now')).toBe('See [word‸](https://a.b) now');
  });

  it('takes a chip whole', () => {
    expect(press(backspaceAt, 'At [[entity:p1|Quay]]‸ now')).toBe('At ‸ now');
  });

  it('turns a heading into a paragraph at the start of its words', () => {
    expect(press(backspaceAt, 'Intro\n\n## ‸Title\n\nBody')).toBe('Intro\n\n‸Title\n\nBody');
  });

  it('takes an item out of its list, out of one level when nested', () => {
    expect(press(backspaceAt, '- one\n- ‸two\n- three')).toBe('- one\n\n‸two\n\n- three');
    expect(press(backspaceAt, '- ‸one')).toBe('‸one');
    expect(press(backspaceAt, '- [ ] ‸task')).toBe('‸task');
    expect(press(backspaceAt, '- one\n  - ‸two')).toBe('- one\n- ‸two');
  });

  it('joins a later line of a quote to the one above, and turns its first line back into text', () => {
    expect(press(backspaceAt, '> [!confirmed] Seen\n> ‸twice')).toBe('> [!confirmed] Seen‸twice');
    expect(press(backspaceAt, '> [!confirmed] ‸Seen')).toBe('‸Seen');
    expect(press(backspaceAt, '> ‸Words someone said')).toBe('‸Words someone said');
  });

  it('never makes an internal passage public by a slip of the key', () => {
    expect(press(backspaceAt, '> [!internal] ‸Team only')).toBe('nothing');
  });

  it('leaves the join of two lines of words to the editor', () => {
    expect(press(backspaceAt, 'One\n‸Two')).toBeNull();
  });
});

describe('Delete', () => {
  it('takes the character that shows after the caret, never a mark', () => {
    expect(press(deleteAt, 'x **bold‸** y')).toBe('x **bold‸**y');
    expect(press(deleteAt, 'x ‸**bold** y')).toBe('x ‸**old** y');
  });

  it('brings the next line\'s words up at the end of a line, its marks left behind', () => {
    expect(press(deleteAt, 'Intro‸\n## Title')).toBe('Intro‸Title');
    expect(press(deleteAt, 'Intro‸\n- item')).toBe('Intro‸item');
    expect(press(deleteAt, 'Intro‸\n\nNext')).toBe('Intro‸\nNext');
  });
});

describe('Tab', () => {
  it('nests an item under the one before it, and Shift+Tab takes it back out', () => {
    expect(press(indentItems, '- one\n- ‸two', 1)).toBe('- one\n  - ‸two');
    expect(press(indentItems, '- one\n  - ‸two', -1)).toBe('- one\n- ‸two');
    expect(press(indentItems, '1. one\n2. ‸two\n3. three', 1)).toBe('1. one\n   1. ‸two\n2. three');
    expect(press(indentItems, '1. one\n   1. ‸two\n2. three', -1)).toBe('1. one\n2. ‸two\n2. three');
  });

  it('nests an item with what is under it', () => {
    expect(press(indentItems, '- one\n- ‸two\n  - deeper', 1)).toBe('- one\n  - ‸two\n    - deeper');
  });

  it('does nothing to the first item, an item at the top for Shift+Tab, or a line of words', () => {
    expect(press(indentItems, '- ‸one', 1)).toBe('nothing');
    expect(press(indentItems, '- ‸one', -1)).toBe('nothing');
    expect(press(indentItems, 'Words ‸here', 1)).toBe('nothing');
  });

  it('leaves Tab to code', () => {
    expect(press(indentItems, '```\nco‸de\n```', 1)).toBeNull();
  });
});
