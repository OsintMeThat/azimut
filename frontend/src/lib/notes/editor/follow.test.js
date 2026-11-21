import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';

import { chartBlocks, followChanges, followSource, forgetFollow, heldBack, originKey, settled } from './follow.js';
import { applyChanges } from './tableText.js';

/**
 * A figure's copy of its rows follows its source by itself: every copy of one source in the
 * note rewritten as one transaction Undo takes back, what Undo brought back kept, and a note
 * that cannot be written left alone.
 */

const REGISTER = '| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n| M-ATV | Almost sure |';
const EDITED = `${REGISTER}\n| Kirpi | Confirmed |`;
const chart = (from, table = REGISTER) => `::: chart\nkind: bars\ncount: rows\nby: Model\n${from ? `from: ${from}\n` : ''}${table}\n:::`;
const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 | placed |\n:::';
const PAGE = `:::: infographic\ndata: sheet:s1\n\n${FIGURES}\n\n${chart('')}\n\n${chart('note:n2#other')}\n::::`;
const NOTE = `# Losses\n\n${chart('sheet:s1')}\n\nWords.\n\n${PAGE}\n\n${chart('sheet:s2')}\n\`\`\`\n${chart('sheet:s1')}\n\`\`\`\n`;

/** A view of `doc` as the editor holds it: its state, its dispatch, its history. */
function viewOf(doc, { readOnly = false } = {}) {
  const view = {
    state: EditorState.create({ doc, extensions: [history(), EditorState.readOnly.of(readOnly)] }),
    dispatch(spec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view;
}

describe('the copies of a source', () => {
  it('names an origin one way however it was written', () => {
    expect(originKey(' sheet : s1 ')).toBe('sheet:s1');
    expect(originKey('note:n1#count')).toBe('note:n1#count');
    expect(originKey('layer:x')).toBe('');
  });

  it('finds every chart of the note, an infographic’s panels included, none in code', () => {
    expect(chartBlocks(NOTE).map((block) => block.source.split('\n')[1])).toEqual(['kind: bars', 'kind: key figures', 'kind: bars', 'kind: bars', 'kind: bars']);
  });

  it('rewrites every chart and panel reading the source, each on its own lines, and nothing else', () => {
    const after = applyChanges(NOTE, followChanges(NOTE, 'sheet:s1', EDITED));
    // the chart naming the sheet, and the page's panel that reads its data
    expect(after.split('| Kirpi | Confirmed |')).toHaveLength(3);
    expect(after).toContain(chart('sheet:s1', EDITED));
    expect(after).toContain(FIGURES);
    expect(after).toContain(chart('note:n2#other'));
    expect(after).toContain(chart('sheet:s2'));
    // a copy in code is no chart
    expect(after.endsWith(`\`\`\`\n${chart('sheet:s1')}\n\`\`\`\n`)).toBe(true);
    // a source that no longer has the chart's columns leaves its copy alone
    expect(followChanges(NOTE, 'sheet:s2', '| Place |\n| --- |\n| Mokha |')).toEqual([]);
    // copies that match already: nothing to write
    expect(followChanges(after, 'sheet:s1', EDITED)).toEqual([]);
  });
});

describe('following a source', () => {
  it('writes every copy as one step Undo takes back, and keeps what Undo brought back', () => {
    const view = viewOf(NOTE);
    expect(followSource(view, 'sheet:s1', EDITED)).toBe(true);
    expect(undoDepth(view.state)).toBe(1);
    expect(view.state.doc.toString()).toBe(applyChanges(NOTE, followChanges(NOTE, 'sheet:s1', EDITED)));
    // the copies match: what was followed stays remembered
    settled(view, 'sheet:s1', EDITED);
    undo(view);
    expect(view.state.doc.toString()).toBe(NOTE);
    expect(heldBack(view, 'sheet:s1', EDITED)).toBe(true);
    expect(followSource(view, 'sheet:s1', EDITED)).toBe(false);
    expect(view.state.doc.toString()).toBe(NOTE);
    // the source moves on: followed again
    const again = `${EDITED}\n| Lenco | Confirmed |`;
    expect(followSource(view, 'sheet:s1', again)).toBe(true);
    expect(view.state.doc.toString()).toContain('| Lenco | Confirmed |');
  });

  it('follows rows typed back to the copy by themselves, and again after a write in the source', () => {
    const view = viewOf(NOTE);
    followSource(view, 'sheet:s1', EDITED);
    undo(view);
    // the source came back to the copy by itself: forgotten, so its next change is followed
    settled(view, 'sheet:s1', REGISTER);
    expect(heldBack(view, 'sheet:s1', EDITED)).toBe(false);
    expect(followSource(view, 'sheet:s1', EDITED)).toBe(true);
    undo(view);
    forgetFollow(view, 'sheet:s1');
    expect(followSource(view, 'sheet:s1', EDITED)).toBe(true);
  });

  it('never writes a note that cannot be written', () => {
    const view = viewOf(NOTE, { readOnly: true });
    expect(followSource(view, 'sheet:s1', EDITED)).toBe(false);
    expect(view.state.doc.toString()).toBe(NOTE);
  });
});
