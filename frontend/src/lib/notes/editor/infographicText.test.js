import { describe, expect, it, vi } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, redo, undo, undoDepth } from '@codemirror/commands';

vi.mock('../../api.js', () => ({ api: { post: vi.fn(() => new Promise(() => {})) } }));

import {
  EACH_PANEL, EMPTY_INFOGRAPHIC, KEY_FIGURES_PANEL, WORDS_PANEL, addPanel, infographicsIn, movePanel, panelText,
  readInfographic, removePanel, sharesLegend, withLegend, withSetting, withWidth,
} from './infographicText.js';
import { replaceBlock } from './infographicBlock.js';

/**
 * The builder's gestures on an infographic's text (`infographicText.js`): each writes the
 * lines it names, and through the editor (`replaceBlock`) it is one change, so one Undo
 * gives the note back byte for byte.
 */

const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 of 54 | placed |\n:::';
const LOST = '::: chart\nkind: silhouette rows\ntitle: What was lost\n| Model | Grade |\n| --- | --- |\n| Cougar | Confirmed |\n:::';
const MADE = '::: chart\nkind: donut\ntitle: Where they were made\n| Made in | Vehicles |\n| --- | ---: |\n| UAE | 22 |\n:::';
const WORDS = '### Where they lie\nSix groups.';
const BLOCK = [
  ':::: infographic', 'kicker: Bab al-Mandab', 'title: At least 60 vehicles lost', '',
  FIGURES, '', LOST, '', MADE, '', WORDS, '::::',
].join('\n');
const NOTE = `# Losses\n\nWords before.\n\n${BLOCK}\n\nWords after.\n`;

function editor(doc) {
  let state = EditorState.create({ doc, extensions: [history()] });
  return {
    get state() { return state; },
    dispatch(input) { state = (input instanceof Transaction ? input : state.update(input)).state; },
  };
}

/** Run `change` on the note's infographic through the editor: it lands as one Undo step, and Undo and Redo give the bytes back. */
function gesture(change) {
  const view = editor(NOTE);
  const [found] = infographicsIn(NOTE);
  const next = change(found.source);
  const depth = undoDepth(view.state);
  expect(replaceBlock(view, found.from, found.to, next, found.source)).toBe(true);
  expect(undoDepth(view.state)).toBe(depth + 1);
  const after = view.state.doc.toString();
  expect(after).toBe(NOTE.replace(BLOCK, next));
  expect(after.startsWith('# Losses\n\nWords before.\n\n')).toBe(true);
  expect(after.endsWith('\n\nWords after.\n')).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(NOTE);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(after);
  return next;
}

describe('reading an infographic', () => {
  it('finds each wrapper of a note, its offsets and lines, never in a code fence', () => {
    const found = infographicsIn(NOTE);
    expect(found).toHaveLength(1);
    expect(NOTE.slice(found[0].from, found[0].to)).toBe(BLOCK);
    expect(found[0].first).toBe(4);
    expect(infographicsIn(`\`\`\`\n${BLOCK}\n\`\`\`\n`)).toEqual([]);
  });

  it('reads its settings and its panels, words included, each with its width', () => {
    const read = readInfographic(BLOCK);
    expect(read.settings.title).toEqual({ value: 'At least 60 vehicles lost', line: 2 });
    expect(read.panels.map((panel) => [panel.kind, panel.title, panel.chartKind, panel.width])).toEqual([
      ['chart', '', 'key figures', 'wide'],
      ['chart', 'What was lost', 'silhouette rows', 'half'],
      ['chart', 'Where they were made', 'donut', 'half'],
      ['words', 'Where they lie', '', 'wide'],
    ]);
    expect(panelText(BLOCK, 3)).toBe(WORDS);
  });

  it('takes guidance alone for no panel', () => {
    expect(readInfographic(EMPTY_INFOGRAPHIC).panels).toEqual([]);
  });
});

describe('the builder’s gestures, one Undo each', () => {
  it('writes a title band field in place, adds a new one in order, and takes an emptied one out', () => {
    expect(gesture((source) => withSetting(source, 'title', 'At least 60 vehicles lost on one road')))
      .toContain('\ntitle: At least 60 vehicles lost on one road\n');
    const standfirst = gesture((source) => withSetting(source, 'standfirst', 'Every figure is a minimum.'));
    expect(standfirst.split('\n').slice(1, 4)).toEqual(['kicker: Bab al-Mandab', 'title: At least 60 vehicles lost', 'standfirst: Every figure is a minimum.']);
    expect(gesture((source) => withSetting(source, 'kicker', ''))).not.toContain('kicker:');
  });

  it('sets a panel’s width in one widths line, every panel named in reading order', () => {
    const next = gesture((source) => withWidth(source, 2, 'wide'));
    expect(next.split('\n').filter((line) => line.startsWith('widths:'))).toEqual(['widths: wide, half, wide, wide']);
    expect(readInfographic(next).panels.map((panel) => panel.width)).toEqual(['wide', 'half', 'wide', 'wide']);
    // back to every panel's own width: the line goes
    expect(withWidth(next, 2, 'half')).not.toContain('widths:');
  });

  it('moves a panel and its width with it', () => {
    const wide = withWidth(BLOCK, 1, 'wide');
    const view = editor(NOTE.replace(BLOCK, wide));
    const [found] = infographicsIn(view.state.doc.toString());
    const moved = movePanel(found.source, 1, 3);
    expect(replaceBlock(view, found.from, found.to, moved, found.source)).toBe(true);
    const read = readInfographic(moved);
    expect(read.panels.map((panel) => panel.title || panel.chartKind)).toEqual(['key figures', 'Where they were made', 'Where they lie', 'What was lost']);
    expect(read.panels.map((panel) => panel.width)).toEqual(['wide', 'half', 'wide', 'wide']);
    expect(moved).toContain(`${MADE}\n\n${WORDS}\n\n${LOST}\n::::`);
    undo(view);
    expect(view.state.doc.toString()).toBe(NOTE.replace(BLOCK, wide));
    expect(gesture((source) => movePanel(source, 0, 3)).endsWith(`${FIGURES}\n::::`)).toBe(true);
  });

  it('adds a panel at the end, its width written only when it is not its kind’s', () => {
    const map = '::: map\ntitle: Where they lie\nlayer: Vehicles\n:::';
    const added = gesture((source) => addPanel(source, map));
    expect(added.endsWith(`${WORDS}\n\n${map}\n::::`)).toBe(true);
    expect(added).not.toContain('widths:');
    const wide = addPanel(BLOCK, map, 'wide');
    expect(wide).toContain('widths: wide, half, half, wide, wide');
    expect(readInfographic(addPanel(BLOCK, WORDS_PANEL)).panels.at(-1).kind).toBe('words');
    expect(readInfographic(addPanel(BLOCK, KEY_FIGURES_PANEL)).panels.at(-1).width).toBe('wide');
  });

  it('adds the first panel to an empty page', () => {
    const first = addPanel(EMPTY_INFOGRAPHIC, MADE);
    expect(readInfographic(first).panels.map((panel) => panel.chartKind)).toEqual(['donut']);
  });

  it('takes a panel out with its width', () => {
    const wide = withWidth(BLOCK, 2, 'wide');
    const less = removePanel(wide, 1);
    expect(readInfographic(less).panels.map((panel) => panel.width)).toEqual(['wide', 'wide', 'wide']);
    expect(less).not.toContain('What was lost');
    expect(gesture((source) => removePanel(source, 3))).not.toContain('Where they lie');
  });

  it('turns the one legend off and on with one line', () => {
    expect(sharesLegend(BLOCK)).toBe(true);
    const each = gesture((source) => withLegend(source, false));
    expect(each).toContain(`legend: ${EACH_PANEL}`);
    expect(sharesLegend(each)).toBe(false);
    expect(withLegend(each, true)).toBe(BLOCK);
  });

  it('sets the look as a whole preset', () => {
    expect(gesture((source) => withSetting(source, 'look', 'book'))).toContain('\nlook: book\n');
  });

  it('writes nothing when the stretch moved on under it', () => {
    const view = editor(NOTE);
    const [found] = infographicsIn(NOTE);
    expect(replaceBlock(view, found.from, found.to, 'x', 'not what is there')).toBe(false);
    expect(view.state.doc.toString()).toBe(NOTE);
  });
});
