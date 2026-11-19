// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { noteExtensions, noteState, setNoteCase } from '../liveMarkdown.js';
import { blockKind, blockKinds, isAtomic, registerBlock, unregisterBlock } from './blocks.js';
import { drawn } from './decorations.js';
import { blocksIn, openBlockAt } from './ranges.js';
import { blockWidget } from './widgets.js';

/**
 * The kinds of block the page draws whole are a registry: each kind says how it is
 * found, the stretch it covers, its widget, whether it is atomic and how it opens,
 * and a later module adds a kind without touching the editor.
 */

let view;
const added = [];
afterEach(() => {
  view?.destroy();
  view = null;
  while (added.length) unregisterBlock(added.pop());
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions() }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

/** A kind of one's own for a test, taken out again after it. */
function ownKind(kind) {
  added.push(kind.name);
  return registerBlock({ widget: blockWidget, atomic: true, ...kind });
}

describe('the block kinds', () => {
  it('holds every kind the page draws whole, in the order they are read', () => {
    expect(blockKinds().map((kind) => kind.name)).toEqual([
      'infographic', 'aligned', 'steps', 'story', 'map', 'diagram', 'table', 'picture', 'pagebreak', 'cover', 'html', 'include',
    ]);
    for (const kind of blockKinds()) {
      expect(typeof kind.widget, kind.name).toBe('function');
      expect(kind.atomic, kind.name).toBe(true);
    }
  });

  it('draws a kind of one\'s own, steps over it whole and opens it its own way', () => {
    const open = vi.fn(() => true);
    ownKind({
      name: 'probe',
      fence: /^:::[ \t]*probe[ \t]*$/,
      draw: (box, widget) => { box.textContent = `Probe of ${widget.source.split('\n')[1]}`; },
      open,
    });
    const doc = 'Before\n\n::: probe\nhello\n:::\n\nAfter';
    editor(doc);
    const box = view.dom.querySelector('.cm-block-probe');
    expect(box.textContent).toContain('Probe of hello');
    const from = doc.indexOf('::: probe');
    const [block] = blocksIn(view.state, from);
    expect(block).toEqual({ from, to: doc.indexOf('\n\nAfter'), kind: 'probe' });
    // the cursor steps over it, and a delete takes it, whole
    let widget = null;
    view.state.field(drawn).between(from, from, (_from, _to, value) => { widget = value.spec.widget; });
    expect(widget.blockKind).toBe('probe');
    expect(isAtomic(widget)).toBe(true);
    // a double press, Enter or its </> opens it as the kind says, not as source
    expect(openBlockAt(view, from + 2)).toBe(true);
    expect(open).toHaveBeenCalledWith(view, block);
  });

  it('reads a `::::` block of its own to its closing line, with the blocks inside it', () => {
    ownKind({
      name: 'wall',
      fence: /^::::[ \t]*wall[ \t]*$/,
      close: /^::::[ \t]*$/,
      draw: (box) => { box.textContent = 'A wall of panels'; },
    });
    const doc = ':::: wall\n::: map\ntitle: North\n:::\n::::\n\nAfter';
    editor(doc);
    expect(blocksIn(view.state, 0, doc.length).map((block) => block.kind)).toEqual(['wall']);
    expect(view.dom.querySelector('.cm-block-wall').textContent).toContain('A wall of panels');
  });

  it('gives a kind registered again its new ways in the place it had', () => {
    const table = blockKind('table');
    const at = blockKinds().indexOf(table);
    const open = vi.fn(() => true);
    try {
      registerBlock({ ...table, open });
      expect(blockKinds().indexOf(blockKind('table'))).toBe(at);
      const doc = '| A |\n| --- |\n| 1 |';
      editor(doc);
      openBlockAt(view, 0);
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      registerBlock(table);
    }
    expect(blockKind('table')).toBe(table);
  });

  it('adds the rules a kind brings after the editor\'s own sheet', () => {
    ownKind({ name: 'tinted', fence: /^:::[ \t]*tinted[ \t]*$/, theme: { '.cm-block-tinted': { color: 'rgb(1, 2, 3)' } } });
    const rules = noteState('').facet(EditorView.styleModule).map((module) => module.getRules()).join('\n');
    expect(rules).toContain('.cm-block-tinted');
    expect(rules).toContain('rgb(1, 2, 3)');
  });

  it('refuses a kind that says neither how it is found nor what it draws', () => {
    expect(() => registerBlock({ name: 'nothing', widget: blockWidget })).toThrow(/neither fence, node nor line/);
    expect(() => registerBlock({ name: 'shapeless', fence: /^:::shapeless$/ })).toThrow(/a name and a widget/);
    expect(blockKind('nothing')).toBeNull();
  });
});
