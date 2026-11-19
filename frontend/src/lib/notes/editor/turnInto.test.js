import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';

import { noteState } from '../liveMarkdown.js';
import { blockActions } from './blockMenu.js';
import { blockRanges } from './ranges.js';
import {
  alignBlock, cornerBlock, deleteBlock, duplicateBlock, headingLink, headingWords, isInternal, makePublic, markInternal,
  moveBlock, moveBy, pageBreakBefore, shapeOf, slugOf, turnInto,
} from './turnInto.js';

/**
 * What the block handle writes: each action is one transaction, writes the Markdown an
 * expert would type, touches only its block, and one Undo gives back the exact bytes.
 * What it writes for the engine to read (internal passages, aligned blocks, anchors) is
 * pinned in `fixtures/handle-writes.json`, which `tests/test_notes_handle_writes.py`
 * holds to the engine.
 */
const WRITES = JSON.parse(readFileSync(new URL('./fixtures/handle-writes.json', import.meta.url), 'utf8'));

/** The state after `spec`, and after one Undo of it. */
function run(state, spec) {
  expect(spec, 'the action writes something').toBeTruthy();
  const after = state.update(spec).state;
  let back = null;
  undo({ state: after, dispatch: (transaction) => { back = transaction.state; } });
  expect(back?.doc.toString(), 'one Undo gives back the exact bytes').toBe(state.doc.toString());
  return after.doc.toString();
}

/** The block of `state` whose text starts with `start`. */
function block(state, start) {
  const found = blockRanges(state).find((one) => state.sliceDoc(one.from, one.to).startsWith(start));
  expect(found, `a block starting "${start}"`).toBeTruthy();
  return found;
}

/** The note with one block turned into `shape`, and the block's kind before. */
function turned(text, start, shape) {
  const state = noteState(text);
  return run(state, turnInto(state, block(state, start), shape));
}

describe('Turn into', () => {
  it('escapes words that would read as a mark once they start a line, so a heading numbered 1. stays words', () => {
    const note = 'Intro\n\n## 1. What it cost\n\nAfter';
    expect(turned(note, '## 1.', 'paragraph')).toBe('Intro\n\n1\\. What it cost\n\nAfter');
    expect(turned(note, '## 1.', 'bullet')).toBe('Intro\n\n- 1\\. What it cost\n\nAfter');
    expect(turned(note, '## 1.', 'quote')).toBe('Intro\n\n> 1\\. What it cost\n\nAfter');
    expect(turned('Intro\n\n## - not a list\n\nAfter', '## -', 'paragraph')).toBe('Intro\n\n\\- not a list\n\nAfter');
    // a heading keeps its words as they are: Markdown reads no list inside one
    expect(turned('Intro\n\n1\\. What it cost\n\nAfter', '1\\.', 'h2')).toBe('Intro\n\n## 1\\. What it cost\n\nAfter');
  });

  it('turns a paragraph into each kind, keeping its words', () => {
    const note = 'Before\n\nThe convoy left at dawn.\n\nAfter';
    const cases = {
      h1: '# The convoy left at dawn.',
      h2: '## The convoy left at dawn.',
      h3: '### The convoy left at dawn.',
      bullet: '- The convoy left at dawn.',
      numbered: '1. The convoy left at dawn.',
      task: '- [ ] The convoy left at dawn.',
      quote: '> The convoy left at dawn.',
      'callout:confirmed': '> [!confirmed] The convoy left at dawn.',
      'callout:limits': '> [!limits] The convoy left at dawn.',
    };
    for (const [shape, written] of Object.entries(cases)) {
      expect(turned(note, 'The convoy', shape), shape).toBe(`Before\n\n${written}\n\nAfter`);
    }
  });

  it('gives a paragraph back from each kind', () => {
    const cases = [
      ['## Losses ##', 'Losses'],
      ['Losses\n======', 'Losses'],
      ['- one\n- two', 'one\n\ntwo'],
      ['1. one\n2. two', 'one\n\ntwo'],
      ['- [x] one\n- [ ] two', 'one\n\ntwo'],
      ['> Said on the radio\n> twice', 'Said on the radio\ntwice'],
      ['> [!note] Seen twice\n> from the road', 'Seen twice\nfrom the road'],
      ['> [!warning]\n> Mines on the shoulder.', 'Mines on the shoulder.'],
    ];
    for (const [from, to] of cases) expect(turned(`${from}\n\nEnd`, from.slice(0, 3), 'paragraph'), from).toBe(`${to}\n\nEnd`);
  });

  it('turns a list into another list, only its own marks changing, the words under an item kept under it', () => {
    const list = '- one\n  more of one\n  - nested\n- two';
    expect(turned(list, '- one', 'numbered')).toBe('1. one\n   more of one\n   - nested\n2. two');
    expect(turned(list, '- one', 'task')).toBe('- [ ] one\n  more of one\n  - nested\n- [ ] two');
    expect(turned('1. one\n   more\n2. two', '1. one', 'bullet')).toBe('- one\n  more\n- two');
    // a task keeps its tick between to-do lists, and loses its box in a plain one
    expect(turned('- [x] done\n- [ ] open', '- [x]', 'bullet')).toBe('- done\n- open');
    const tasks = noteState('* [x] done\n* [ ] open');
    expect(turnInto(tasks, block(tasks, '* [x]'), 'task')).toBeNull();
  });

  it('turns a heading into a list item, a list into a heading, lines joined', () => {
    expect(turned('# Losses', '# Losses', 'bullet')).toBe('- Losses');
    expect(turned('- one\n- two', '- one', 'h2')).toBe('## one two');
    expect(turned('A line\nand the next', 'A line', 'bullet')).toBe('- A line\n  and the next');
  });

  it('puts a list in a callout or a quote as it is, and gives it back', () => {
    const list = '- one\n- two';
    expect(turned(list, '- one', 'callout:lead')).toBe('> [!lead]\n> - one\n> - two');
    expect(turned(list, '- one', 'quote')).toBe('> - one\n> - two');
    expect(turned('> [!lead]\n> - one\n> - two', '> [!lead]', 'bullet')).toBe('- one\n- two');
  });

  it('changes a callout\'s kind or a quote\'s marker only, what is inside untouched', () => {
    expect(turned('> [!lead] Seen\n> - a list\n>\n> more', '> [!lead]', 'callout:confirmed')).toBe('> [!confirmed] Seen\n> - a list\n>\n> more');
    expect(turned('> Seen\n> twice', '> Seen', 'callout:note')).toBe('> [!note] Seen\n> twice');
    expect(turned('> ## A title\n> words', '> ## A', 'callout:note')).toBe('> [!note]\n> ## A title\n> words');
    expect(turned('> [!note] Seen\n> twice', '> [!note]', 'quote')).toBe('> Seen\n> twice');
    expect(turned('> [!note]\n> Seen', '> [!note]', 'quote')).toBe('> Seen');
  });

  it('turns a heading into a callout with its words', () => {
    expect(turned('## Losses', '## Losses', 'callout:warning')).toBe('> [!warning] Losses');
  });

  it('writes nothing for what a block is already, or for a block that is not words', () => {
    const state = noteState('## Losses\n\n![Roof](roof.png)\n\n| A |\n| --- |\n| 1 |');
    expect(turnInto(state, block(state, '## Losses'), 'h2')).toBeNull();
    expect(turnInto(state, block(state, '![Roof]'), 'h2')).toBeNull();
    expect(turnInto(state, block(state, '| A |'), 'paragraph')).toBeNull();
  });

  it('keeps the cursor on the words it was on', () => {
    const text = 'Before\n\nThe convoy left at dawn.';
    const at = text.indexOf('left');
    const state = noteState(text).update({ selection: { anchor: at } }).state;
    const after = state.update(turnInto(state, block(state, 'The convoy'), 'callout:note')).state;
    expect(after.selection.main.head).toBe(after.doc.toString().indexOf('left'));
  });

  it('names what each block is', () => {
    const state = noteState('### Small\n\nText\n\n1. one\n\n- [ ] task\n\n> [!internal] Ours');
    expect(['### Small', 'Text', '1. one', '- [ ] task', '> [!internal]'].map((start) => shapeOf(state, block(state, start))))
      .toEqual(['h3', 'paragraph', 'numbered', 'task', 'callout:internal']);
  });
});

describe('internal passages', () => {
  for (const { kind, text, wrapped } of WRITES.internal) {
    it(`wraps a ${kind} in > [!internal] and unwraps it to the byte`, () => {
      const note = `Intro\n\n${text}\n\nEnd`;
      const state = noteState(note);
      const target = block(state, text.slice(0, 4));
      expect(target.kind).toBe(kind);
      const marked = run(state, markInternal(state, target));
      expect(marked).toBe(`Intro\n\n${wrapped}\n\nEnd`);
      const again = noteState(marked);
      const passage = block(again, '> [!internal]');
      expect(isInternal(again, passage)).toBe(true);
      expect(run(again, makePublic(again, passage))).toBe(note);
    });
  }

  it('keeps a passage apart from a line of words right before or after it', () => {
    const state = noteState('Intro\n![Roof](roof.png)\nMore');
    expect(run(state, markInternal(state, block(state, '![Roof]')))).toBe('Intro\n\n> [!internal]\n> ![Roof](roof.png)\n\nMore');
  });

  it('makes a passage written by hand public, its lazy lines too', () => {
    const state = noteState('> [!INTERNAL] Ours only\nstill ours\n\nPublic');
    expect(run(state, makePublic(state, block(state, '> [!INTERNAL]')))).toBe('Ours only\nstill ours\n\nPublic');
  });

  it('offers Mark internal or Make public, never both, and nothing on a block that cannot hold one', () => {
    const state = noteState('Words\n\n> [!internal] Ours\n\n<!-- pagebreak -->\n\n::: center\nMid\n:::');
    const ids = (start) => blockActions(state, block(state, start)).map((entry) => entry.id).filter(Boolean);
    expect(ids('Words')).toContain('internal');
    expect(ids('> [!internal]')).toContain('public');
    expect(ids('> [!internal]')).not.toContain('internal');
    // never turned into a public callout by a slip: Make public first
    expect(ids('> [!internal]')).not.toContain('turn');
    expect(ids('<!-- pagebreak')).not.toContain('internal');
    expect(ids('::: center')).not.toContain('internal');
  });
});

describe('Align and the cover\'s corners', () => {
  it('aligns a picture as its bar does, with align= in its braces', () => {
    const state = noteState('Intro\n\n[[media:m1|Shot]]{width=50%}');
    expect(run(state, alignBlock(state, block(state, '[[media'), 'center'))).toBe('Intro\n\n[[media:m1|Shot]]{width=50% align=center}');
    const centred = noteState('[[media:m1|Shot]]{width=50% align=center}');
    expect(run(centred, alignBlock(centred, block(centred, '[[media'), 'left'))).toBe('[[media:m1|Shot]]{width=50%}');
  });

  it('writes the aligned blocks the engine reads', () => {
    for (const { text, side, corner, written } of WRITES.aligned) {
      const note = corner ? `${text}\n\n<!-- cover -->\n\nBody` : `Intro\n\n${text}\n\nEnd`;
      const state = noteState(note);
      const target = block(state, text.slice(0, 4));
      const spec = corner ? cornerBlock(state, target, corner) : alignBlock(state, target, side);
      expect(run(state, spec)).toBe(note.replace(text, written));
    }
  });

  it('puts words in ::: center, renames an aligned block, and takes it off for left', () => {
    const words = noteState('Intro\n\nPrepared for the desk\n\nEnd');
    expect(run(words, alignBlock(words, block(words, 'Prepared'), 'right'))).toBe('Intro\n\n::: right\nPrepared for the desk\n:::\n\nEnd');
    const aligned = noteState('::: center\nMid\nMore\n:::\n\nEnd');
    expect(run(aligned, alignBlock(aligned, block(aligned, '::: center'), 'right'))).toBe('::: right\nMid\nMore\n:::\n\nEnd');
    expect(run(aligned, alignBlock(aligned, block(aligned, '::: center'), 'left'))).toBe('Mid\nMore\n\nEnd');
    expect(alignBlock(aligned, block(aligned, '::: center'), 'center')).toBeNull();
  });

  it('pins a block of the cover to a corner, moves it to another, and takes it out', () => {
    const state = noteState('# Report\n\nPrepared for the desk\n\n<!-- cover -->\n\nBody');
    const pinned = run(state, cornerBlock(state, block(state, 'Prepared'), 'top-right'));
    expect(pinned).toBe('# Report\n\n::: top-right\nPrepared for the desk\n:::\n\n<!-- cover -->\n\nBody');
    const again = noteState(pinned);
    expect(run(again, cornerBlock(again, block(again, '::: top-right'), 'bottom-left')))
      .toBe('# Report\n\n::: bottom-left\nPrepared for the desk\n:::\n\n<!-- cover -->\n\nBody');
    expect(run(again, cornerBlock(again, block(again, '::: top-right'), null))).toBe('# Report\n\nPrepared for the desk\n\n<!-- cover -->\n\nBody');
    // under the cover, or with no cover, there is no corner to pin to
    expect(cornerBlock(state, block(state, 'Body'), 'top-right')).toBeNull();
    expect(blockActions(state, block(state, 'Body')).some((entry) => entry.id === 'corner')).toBe(false);
    expect(blockActions(state, block(state, 'Prepared')).some((entry) => entry.id === 'corner')).toBe(true);
  });
});

describe('pages, copies and deletes', () => {
  it('starts a new page before a block, and takes the break back', () => {
    const state = noteState('Intro\n\n## Chapter two\n\nWords');
    const broken = run(state, pageBreakBefore(state, block(state, '## Chapter')));
    expect(broken).toBe('Intro\n\n<!-- pagebreak -->\n\n## Chapter two\n\nWords');
    const again = noteState(broken);
    expect(blockActions(again, block(again, '## Chapter')).find((entry) => entry.id === 'page').label).toBe('Remove the page break above');
    expect(run(again, pageBreakBefore(again, block(again, '## Chapter')))).toBe('Intro\n\n## Chapter two\n\nWords');
    // not before the first block
    expect(pageBreakBefore(state, block(state, 'Intro'))).toBeNull();
  });

  it('duplicates a block under itself, and deletes one with its blank line', () => {
    const state = noteState('One\n\n![Roof](roof.png)\n\nTwo');
    expect(run(state, duplicateBlock(state, block(state, '![Roof]')))).toBe('One\n\n![Roof](roof.png)\n\n![Roof](roof.png)\n\nTwo');
    expect(run(state, deleteBlock(state, block(state, '![Roof]')))).toBe('One\n\nTwo');
    expect(run(state, deleteBlock(state, block(state, 'Two')))).toBe('One\n\n![Roof](roof.png)\n');
  });
});

/** A note holding every kind of block `blockRanges` reads, a blank line between each. */
const EVERY_KIND = [
  '# Title',
  'Prepared for the desk',
  '::: top-right\nCorner words\n:::',
  '<!-- cover -->',
  'A paragraph\nof two lines',
  '![Roof](roof.png)',
  '[[media:m1|Shot]]{width=50%}',
  // three lists of three marks: two lists of one mark, side by side, are one list
  '* one\n* two',
  '1. first\n2. second',
  '- [ ] open\n- [x] done',
  '> Said on the radio',
  '> [!confirmed] Seen twice\n> from the road',
  '> [!internal] Ours only',
  '| A | B |\n| --- | --- |\n| 1 | 2 |',
  '```js\ncode\n```',
  '```mermaid\nflowchart LR\n  A --> B\n```',
  '---',
  '::: center\nCentred\n:::',
  '::: steps\n![Step](a.png)\n:::',
  '::: story\n![Scene](b.png)\nWords beside\n:::',
  '::: map\ntitle: Front\nlayers: Lines\n:::',
  '<!-- pagebreak -->',
  '<div>Raw</div>',
  '[[include:n2]]',
  'The end',
];

describe('moving a block, of every kind', () => {
  const text = `${EVERY_KIND.join('\n\n')}\n`;
  const state = noteState(text);
  const blocks = blockRanges(state);
  const texts = (one) => blockRanges(one).map((item) => one.sliceDoc(item.from, item.to));

  it('reads every kind of block in the note', () => {
    expect(texts(state)).toEqual(EVERY_KIND);
    expect(new Set(blocks.map((one) => one.kind))).toEqual(new Set([
      'heading', 'paragraph', 'aligned', 'cover', 'picture', 'list', 'quote', 'callout', 'table', 'code', 'diagram', 'rule',
      'steps', 'story', 'map', 'pagebreak', 'html', 'include',
    ]));
  });

  blocks.forEach((moved, index) => {
    const kind = `${moved.kind} "${EVERY_KIND[index].split('\n')[0]}"`;
    it(`moves a ${kind} up and down past its neighbour, whole, in one step`, () => {
      for (const step of [-1, 1]) {
        const spec = moveBy(state, moved, step);
        const to = index + step;
        if (to < 0 || to >= blocks.length) {
          expect(spec).toBeNull();
          continue;
        }
        const after = noteState(run(state, spec));
        const expected = [...EVERY_KIND];
        [expected[index], expected[to]] = [expected[to], expected[index]];
        expect(texts(after)).toEqual(expected);
      }
    });
  });

  it('moves a block to any gap, as a drag does, and to the end', () => {
    const picture = blocks[5];
    const after = run(state, moveBlock(state, picture, blocks[1]));
    const expected = [...EVERY_KIND];
    expected.splice(5, 1);
    expected.splice(1, 0, EVERY_KIND[5]);
    expect(texts(noteState(after))).toEqual(expected);
    const last = run(state, moveBlock(state, blocks[0], null));
    expect(texts(noteState(last))).toEqual([...EVERY_KIND.slice(1), EVERY_KIND[0]]);
    // its own place, or the gap right after it, leaves it where it is
    expect(moveBlock(state, picture, picture)).toBeNull();
    expect(moveBlock(state, picture, blocks[6])).toBeNull();
  });

  it('moves the cursor with its block', () => {
    const at = text.indexOf('of two lines');
    const placed = state.update({ selection: { anchor: at } }).state;
    const paragraph = blockRanges(placed).find((one) => one.kind === 'paragraph' && placed.sliceDoc(one.from, one.to).startsWith('A paragraph'));
    const moved = placed.update(moveBy(placed, paragraph, -1)).state;
    expect(moved.selection.main.head).toBe(moved.doc.toString().indexOf('of two lines'));
  });

  it('keeps a blank line between two blocks that had none', () => {
    const tight = noteState('# Title\nWords right under');
    expect(run(tight, moveBy(tight, block(tight, 'Words'), -1))).toBe('Words right under\n\n# Title');
  });
});

describe('a link to a heading', () => {
  it('names a heading as the HTML page anchors it', () => {
    const state = noteState('## 1. What it cost\n\nWords\n\n## Sources\n\n> [!limits] Thin\n\n## Limits\n\n## 1. What it cost');
    const link = (start, nth = 0) => {
      const found = blockRanges(state).filter((one) => state.sliceDoc(one.from, one.to).startsWith(start))[nth];
      return headingLink(state, found);
    };
    expect(link('## 1. What')).toMatchObject({ id: 's-1-what-it-cost', markdown: '[1. What it cost](#s-1-what-it-cost)' });
    expect(link('## Sources').id).toBe('sources-section');
    expect(link('## Limits').id).toBe('limits-2');
    expect(link('## 1. What', 1).id).toBe('s-1-what-it-cost-2');
  });

  it('reads a heading\'s words without its marks', () => {
    expect(headingWords('## The **fall** of [Dhubab](https://x.test) [[entity:e1|Bab]] `code` ##')).toBe('The fall of Dhubab Bab code');
  });

  it('names an anchor as the engine does, in any script', () => {
    for (const [words, slug] of WRITES.anchors) expect(slugOf(words), words).toBe(slug);
  });
});
