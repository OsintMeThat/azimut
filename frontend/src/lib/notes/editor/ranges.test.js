import { describe, expect, it } from 'vitest';

import { noteState, openedState } from '../liveMarkdown.js';
import { blockRanges, blocksIn } from './ranges.js';

/**
 * Where the blocks of a note are, read once: the drawn ones whole, and around them
 * the blocks of Markdown, which the block handle sits on and moves.
 */

const NOTE = [
  '# Title', '', 'Intro', '![Roof](roof.png)', '', '- one', '- two', '', '> [!note] Seen twice', '> from the road', '',
  '> Said on the radio', '', '<!-- pagebreak -->', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '```js', 'code', '```', '',
  '---', '', '::: center', 'Centred', ':::', 'End',
].join('\n');

/** Each block as `[kind, drawn, its text]`. */
const read = (state) => blockRanges(state).map((block) => [block.kind, block.drawn, state.sliceDoc(block.from, block.to)]);

describe('the blocks of a note', () => {
  it('lists the drawn blocks whole and the blocks of Markdown around them, top to bottom', () => {
    expect(read(noteState(NOTE))).toEqual([
      ['heading', false, '# Title'],
      ['paragraph', false, 'Intro'],
      ['picture', true, '![Roof](roof.png)'],
      ['list', false, '- one\n- two'],
      ['callout', false, '> [!note] Seen twice\n> from the road'],
      ['quote', false, '> Said on the radio'],
      ['pagebreak', true, '<!-- pagebreak -->'],
      ['table', true, '| A | B |\n| --- | --- |\n| 1 | 2 |'],
      ['code', false, '```js\ncode\n```'],
      ['rule', false, '---'],
      ['aligned', true, '::: center\nCentred\n:::'],
      ['paragraph', false, 'End'],
    ]);
  });

  it('agrees with the drawn blocks the keys step over', () => {
    const state = noteState(NOTE);
    expect(blockRanges(state).filter((block) => block.drawn).map(({ from, to, kind }) => ({ from, to, kind })))
      .toEqual(blocksIn(state, 0, state.doc.length));
  });

  it('reads an open block as the Markdown it is', () => {
    const table = NOTE.indexOf('| A |');
    const words = read(openedState(noteState(NOTE), table));
    expect(words).toContainEqual(['table', false, '| A | B |\n| --- | --- |\n| 1 | 2 |']);
    expect(words.filter(([, drawn]) => drawn).map(([kind]) => kind)).toEqual(['picture', 'pagebreak', 'aligned']);
  });

  it('reads every block as Markdown in the raw mode, where nothing is drawn', () => {
    const words = read(noteState(NOTE, { mode: 'markdown' }));
    expect(words.some(([, drawn]) => drawn)).toBe(false);
    expect(words.map(([kind]) => kind)).toEqual([
      'heading', 'paragraph', 'list', 'callout', 'quote', 'html', 'table', 'code', 'rule', 'paragraph',
    ]);
  });
});
