import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { focusedState, noteDecorations, noteMode, noteState, openedState } from './liveMarkdown.js';

const CASE = {
  caseId: 'c1',
  entities: [
    { id: 'p1', type: 'place', label: 'Quay', attrs: {} },
    { id: 'm1', type: 'media', label: 'clip.jpg', attrs: { path: 'media/clip.jpg', kind: 'image' } },
  ],
};

/** What the page draws, as short words: `hide 0-2`, `chip 5-25`, `line cm-h1 @0`. */
function drawn(state) {
  const out = [];
  noteDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec;
    if (spec.widget) out.push(`${spec.widget.constructor.name.replace('Widget', '').toLowerCase()} ${from}-${to}`);
    else if (spec.class && from === to) out.push(`line ${spec.class} @${from}`);
    else if (spec.class) out.push(`mark ${spec.class} ${from}-${to}`);
    else out.push(`hide ${from}-${to}`);
  });
  return out;
}

function at(state, pos) {
  return focusedState(state.update({ selection: EditorSelection.cursor(pos) }).state);
}

describe('the note page', () => {
  it('sets a heading large and puts its marks away until its line is edited', () => {
    const state = noteState('# Field notes\n\nBody', { caseInfo: CASE });
    expect(drawn(state)).toEqual(['line cm-heading cm-h1 @0', 'hide 0-2']);
    expect(drawn(at(state, 3))).toEqual(['line cm-heading cm-h1 @0']);
  });

  it('draws a case reference as a chip, and its source on the line being edited', () => {
    const text = 'Seen at [[entity:p1|Quay]] today';
    const state = noteState(text, { caseInfo: CASE });
    expect(drawn(state)).toEqual(['chip 8-26']);
    expect(drawn(at(state, 2))).toEqual(['mark cm-ref-source 8-26']);
  });

  it('keeps a reference inside code as text', () => {
    const state = noteState('`[[entity:p1|Quay]]`', { caseInfo: CASE });
    expect(drawn(state).some((word) => word.startsWith('chip'))).toBe(false);
  });

  it('draws a picture on a line of its own as a block, and a table whole', () => {
    const text = 'Intro\n[[media:m1|clip.jpg]]{width=50%}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd';
    const state = noteState(text, { caseInfo: CASE });
    const words = drawn(state);
    expect(words).toContain(`block 6-${6 + '[[media:m1|clip.jpg]]{width=50%}'.length}`);
    expect(words.filter((word) => word.startsWith('block'))).toHaveLength(2);
  });

  it('draws a closed mermaid fence as a diagram, and its source once it is open', () => {
    const text = '```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter';
    const state = noteState(text, { caseInfo: CASE });
    expect(drawn(state)[0]).toBe(`block 0-${text.indexOf('\n\nAfter')}`);
    expect(drawn(openedState(state, 14)).every((word) => word.startsWith('line cm-code-line'))).toBe(true);
  });

  it('turns tasks into boxes and bullets into dots', () => {
    const state = noteState('- [ ] Check the date\n- [x] Archived\n- plain', { caseInfo: CASE });
    expect(drawn(state)).toEqual([
      'hide 0-2', 'task 2-5',
      'line cm-task-done @21', 'hide 21-23', 'task 23-26',
      'bullet 36-37',
    ]);
  });

  it('colours a callout and names its kind', () => {
    const state = noteState('> [!confirmed] The mast matches.\n> Second line.', { caseInfo: CASE });
    const words = drawn(state);
    expect(words).toContain('line cm-callout cm-callout-confirmed @0');
    expect(words).toContain('calloutlabel 2-15');
    expect(words).toContain('hide 33-35');
  });

  it('makes coordinates a place to go, never inside a reference', () => {
    const state = noteState('Point 33.5138, 36.2765 and v1.2, 3.4', { caseInfo: CASE });
    expect(drawn(state)).toEqual(['mark cm-coords 6-22', 'coordinates 22-22']);
  });

  it('draws nothing raw a parser found inside a chip label', () => {
    const state = noteState('[[entity:p1|**Quay**]]', { caseInfo: CASE });
    expect(drawn(state)).toEqual(['chip 0-22']);
  });
});

describe('guidance and chapters', () => {
  const NOTES = [{ id: 'n2', title: 'Shadows', excerpt: 'Measured at noon.' }];

  it('draws a line of guidance as grey words, kept drawn on the line being written in a note', () => {
    const text = '## Claim\n\n<!--? Who said it, and where -->\n\nBody';
    const state = noteState(text, { caseInfo: CASE });
    const from = text.indexOf('<!--?');
    const to = from + '<!--? Who said it, and where -->'.length;
    expect(drawn(state)).toContain(`hint ${from}-${to}`);
    expect(drawn(at(state, from + 3))).toContain(`hint ${from}-${to}`);
    let said = '';
    noteDecorations(state).between(from, to, (_a, _b, value) => { said = value.spec.widget?.text ?? said; });
    expect(said).toBe('Who said it, and where');
  });

  it('gives a template its guidance back as text on the line being written', () => {
    const text = '<!--? Who said it -->\n\nBody';
    const state = noteState(text, { caseInfo: CASE, template: true });
    expect(drawn(state)).toEqual(['hint 0-21']);
    expect(drawn(at(state, 4))).toEqual(['line cm-hint-line @0']);
  });

  it('leaves an old comment, guidance inside code, and a hint inside a sentence as they were', () => {
    const state = noteState('<!-- an old comment -->\n\n```\n<!--? in code -->\n```\n\nText <!--? not a line --> here', { caseInfo: CASE });
    const words = drawn(state);
    expect(words.some((word) => word.startsWith('hint'))).toBe(false);
    const kinds = [];
    noteDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget?.kind) kinds.push(value.spec.widget.kind);
    });
    expect(kinds).toEqual(['html']);
  });

  it('draws a chapter line as the note it includes, numbered in order, and its source while edited', () => {
    const text = 'Intro\n\n[[include:n2]]\n\n[[include:gone]]\n\n[[include:case]]\n';
    const state = noteState(text, { caseInfo: { ...CASE, notes: NOTES } });
    const chapters = [];
    noteDecorations(state).between(0, state.doc.length, (from, to, value) => {
      const widget = value.spec.widget;
      if (widget?.constructor.name === 'IncludeWidget') chapters.push([from, to, widget.number, widget.note?.title ?? null]);
    });
    expect(chapters).toEqual([[7, 21, 1, 'Shadows'], [23, 39, 2, null], [41, 57, 3, 'Case notes']]);
    expect(drawn(openedState(state, 9))).toContain('mark cm-ref-source 7-21');
    // the cursor at its start picks it, and leaves it drawn
    expect(drawn(at(state, 7))).toContain('include 7-21');
  });

  it('keeps a chapter line inside a sentence or a quote as text', () => {
    const state = noteState('See [[include:n2]] here\n\n> [[include:n2]]', { caseInfo: { ...CASE, notes: NOTES } });
    expect(drawn(state).some((word) => word.startsWith('include'))).toBe(false);
  });

  it('reads a chapter line by line, as the PDF does, words around it or not, and never inside code', () => {
    const text = 'Words\n[[include:n2]]\nMore\n\n```\n[[include:n2]]\n```';
    const state = noteState(text, { caseInfo: { ...CASE, notes: NOTES } });
    expect(drawn(state).filter((word) => word.startsWith('include'))).toEqual(['include 6-20']);
  });

  it('reads guidance indented as the PDF does', () => {
    const state = noteState('  <!--? Who said it -->', { caseInfo: CASE });
    expect(drawn(state)).toEqual(['hint 0-23']);
  });
});

/** A note as the old split-pane Notebook wrote it, every syntax its help taught. */
const OLD_NOTE = [
  'Field notes',
  '===========',
  '',
  '**Confirmed** and *unverified* ~~discarded~~',
  '',
  '- First observation',
  '- [x] Archive source',
  '- [ ] Verify date',
  '',
  '| Source | Status |',
  '| --- | --- |',
  '| Photo | Verified |',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Tip] --> B[Check]',
  '```',
  '',
  '![Map](/api/cases/c1/files/media/map.png){width=50% align=center}',
  '',
  '::: center',
  '**Centred finding**',
  ':::',
  '',
  '<details><summary>More</summary>Hidden part</details>',
  '',
  'See [[entity:p1|Quay]] and [[media:m1|clip.jpg]] inline.',
  '[[media:m1|clip.jpg]]{width=40% align=right}',
  '',
].join('\n');

describe('a note the old Notebook wrote', () => {
  it('is drawn whole: every block it holds, nothing left as raw marks', () => {
    const state = noteState(OLD_NOTE, { caseInfo: CASE });
    const kinds = [];
    noteDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget?.kind) kinds.push(value.spec.widget.kind);
    });
    expect(kinds.sort()).toEqual(['aligned', 'diagram', 'html', 'picture', 'picture', 'table']);
    const words = drawn(state);
    expect(words).toContain('line cm-heading cm-h1 @0');
    expect(words.filter((word) => word.startsWith('chip'))).toHaveLength(2);
    expect(words.filter((word) => word.startsWith('task'))).toHaveLength(2);
  });

  it('keeps its text as it was: drawing never changes a character', () => {
    const state = noteState(OLD_NOTE, { caseInfo: CASE });
    expect(at(state, 40).doc.toString()).toBe(OLD_NOTE);
  });
});

describe('a page break', () => {
  it('is drawn as a rule, and as its text once it is open', () => {
    const state = noteState('Before\n\n<!-- pagebreak -->\n\nAfter', { caseInfo: CASE });
    expect(drawn(state)).toContain('pagebreak 8-26');
    expect(drawn(openedState(state, 10))).toContain('line cm-pagebreak-line @8');
    expect(drawn(openedState(state, 10)).some((item) => item.startsWith('pagebreak'))).toBe(false);
    // a cursor at its start only picks it
    expect(drawn(at(state, 8))).toContain('pagebreak 8-26');
  });

  it('is only an example inside code', () => {
    const state = noteState('```\n<!-- pagebreak -->\n```', { caseInfo: CASE });
    expect(drawn(state).some((item) => item.startsWith('pagebreak'))).toBe(false);
  });
});

describe('the end of the cover page', () => {
  const COVER = '::: center\n# {title}\n:::\n<!-- cover -->\n\nBody';

  it('is drawn as a named rule, and as its text once it is open', () => {
    const state = noteState(COVER, { caseInfo: CASE });
    const rule = COVER.indexOf('<!-- cover -->');
    expect(drawn(state)).toContain(`coverrule ${rule}-${rule + 14}`);
    expect(drawn(openedState(state, rule))).toContain(`line cm-pagebreak-line @${rule}`);
    expect(drawn(openedState(state, rule)).some((item) => item.startsWith('coverrule'))).toBe(false);
    expect(drawn(at(state, rule))).toContain(`coverrule ${rule}-${rule + 14}`);
  });

  it('is only an example inside code', () => {
    const state = noteState('```\n<!-- cover -->\n```', { caseInfo: CASE });
    expect(drawn(state).some((item) => item.startsWith('coverrule'))).toBe(false);
  });
});

describe('the words the PDF fills in', () => {
  it('are drawn as words of their own, and as their text on the line being edited', () => {
    const text = 'Signed by {name}, {organisation}';
    const state = noteState(text, { caseInfo: CASE });
    expect(drawn(state)).toEqual(['placeholder 10-16', 'placeholder 18-32']);
    expect(drawn(at(state, 2))).toEqual(['mark cm-placeholder-source 10-16', 'mark cm-placeholder-source 18-32']);
  });

  it('stay as written in code and in guidance', () => {
    expect(drawn(noteState('`{name}`', { caseInfo: CASE })).some((item) => item.startsWith('placeholder'))).toBe(false);
    expect(drawn(noteState('<!--? Sign as {name} -->', { caseInfo: CASE }))).toEqual(['hint 0-24']);
  });
});

/** The blocks the page draws whole, as `[kind, from, to, picked]`. */
function blocks(state) {
  const found = [];
  noteDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const widget = value.spec.widget;
    const name = widget?.constructor.name;
    if (widget?.kind) found.push([widget.kind, from, to, widget.picked]);
    else if (name === 'IncludeWidget') found.push(['include', from, to, widget.picked]);
    else if (name === 'PageBreakWidget') found.push(['pagebreak', from, to, widget.picked]);
    else if (name === 'CoverRuleWidget') found.push(['cover', from, to, widget.picked]);
  });
  return found;
}

describe('a block that is clicked', () => {
  const TEXT = [
    'Intro', '', '[[media:m1|clip.jpg]]{width=50%}', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '',
    '::: right', 'Signed', ':::', '', '<details>More</details>', '', '<!-- pagebreak -->', '', '[[include:n2]]', '', 'End',
  ].join('\n');
  const info = { ...CASE, notes: [{ id: 'n2', title: 'Shadows', excerpt: 'Measured at noon.' }] };
  const KINDS = ['picture', 'table', 'diagram', 'aligned', 'html', 'pagebreak', 'include'];
  const start = (needle) => TEXT.indexOf(needle);
  const kindsOf = (state) => blocks(state).map(([kind]) => kind);

  it('stays drawn with the cursor at its start, and is picked there only', () => {
    const state = noteState(TEXT, { caseInfo: info });
    expect(kindsOf(state)).toEqual(KINDS);
    expect(blocks(state).every((block) => block[3] === false)).toBe(true);
    for (const [kind, from] of blocks(state)) {
      const picked = blocks(at(state, from));
      expect(picked.map((block) => block[0]), kind).toEqual(KINDS);
      expect(picked.filter((block) => block[3]).map((block) => block[0]), kind).toEqual([kind]);
    }
    // a cursor in the words around them picks nothing
    expect(blocks(at(state, 2)).some((block) => block[3])).toBe(false);
    // nor does an editor out of focus, or a range
    expect(blocks(state.update({ selection: EditorSelection.cursor(start('| A')) }).state).some((block) => block[3])).toBe(false);
    const range = focusedState(state.update({ selection: EditorSelection.range(start('| A'), start('| A') + 3) }).state);
    expect(blocks(range).some((block) => block[3])).toBe(false);
  });

  it('shows its source only once it is open, each kind as the page draws it open', () => {
    const state = noteState(TEXT, { caseInfo: info });
    const open = (needle) => openedState(state, start(needle));
    const cases = [
      ['[[media:m1', 'picture', (pos) => `mark cm-ref-source ${pos}-`],
      ['| A', 'table', (pos) => `line cm-table-line @${pos}`],
      ['```mermaid', 'diagram', (pos) => `line cm-code-line @${pos}`],
      ['::: right', 'aligned', (pos) => `line cm-fence-line @${pos}`],
      ['<details>', 'html', (pos) => `line cm-code-line @${pos}`],
      ['<!-- pagebreak', 'pagebreak', (pos) => `line cm-pagebreak-line @${pos}`],
      ['[[include', 'include', (pos) => `mark cm-ref-source ${pos}-`],
    ];
    for (const [needle, kind, source] of cases) {
      // that block alone is open: the others stay drawn
      expect(kindsOf(open(needle)), kind).toEqual(KINDS.filter((item) => item !== kind));
      expect(drawn(open(needle)).some((word) => word.startsWith(source(start(needle)))), kind).toBe(true);
    }
    // the picture, open, is its reference as written, not a chip
    expect(drawn(open('[[media:m1')).some((word) => word.startsWith('chip'))).toBe(false);
  });

  it('closes as soon as the cursor leaves it, whichever way it goes', () => {
    const state = noteState(TEXT, { caseInfo: info });
    const table = start('| A');
    const open = openedState(state, table);
    const hasTable = (given) => kindsOf(given).includes('table');
    expect(hasTable(open)).toBe(false);
    // still open on any line of it, at its first and last position
    const end = table + '| A | B |\n| --- | --- |\n| 1 | 2 |'.length;
    for (const pos of [table, table + 12, end]) expect(hasTable(open.update({ selection: EditorSelection.cursor(pos) }).state), String(pos)).toBe(false);
    // gone the moment it is outside, and it stays closed on coming back to it
    const left = open.update({ selection: EditorSelection.cursor(2) }).state;
    expect(hasTable(left)).toBe(true);
    expect(hasTable(left.update({ selection: EditorSelection.cursor(table) }).state)).toBe(true);
    // before it and after it are outside it too
    expect(hasTable(open.update({ selection: EditorSelection.cursor(table - 1) }).state)).toBe(true);
    expect(hasTable(open.update({ selection: EditorSelection.cursor(end + 1) }).state)).toBe(true);
  });

  it('follows what is typed in it', () => {
    const state = noteState(TEXT, { caseInfo: info });
    const table = start('| A');
    const typed = openedState(state, table).update({ changes: { from: table + 2, insert: 'xyz' }, selection: EditorSelection.cursor(table + 5), userEvent: 'input.type' }).state;
    expect(typed.doc.toString()).toContain('| xyzA | B |');
    expect(kindsOf(typed).includes('table')).toBe(false);
    // a line added at its end is still in it
    const last = typed.doc.lineAt(table + 30).to;
    const grown = typed.update({ changes: { from: last, insert: '\n| 3 | 4 |' }, selection: EditorSelection.cursor(last + 5), userEvent: 'input' }).state;
    expect(kindsOf(grown).includes('table')).toBe(false);
    // and one typed at its start
    const first = openedState(state, table).update({ changes: { from: table, insert: '\n' }, selection: EditorSelection.cursor(table), userEvent: 'input' }).state;
    expect(kindsOf(first).includes('table')).toBe(false);
  });

  it('opens when the cursor is put inside it, as a jump or an Undo can', () => {
    const state = noteState(TEXT, { caseInfo: info });
    const inside = focusedState(state.update({ selection: EditorSelection.cursor(start('| 1 | 2 |') + 2) }).state);
    expect(kindsOf(inside).includes('table')).toBe(false);
    expect(drawn(inside)).toContain(`line cm-table-line @${start('| 1 | 2 |')}`);
  });

  it('leaves the marks of the line beside it as they were', () => {
    const state = noteState('# Title\n\n[[media:m1|clip.jpg]]', { caseInfo: CASE });
    expect(drawn(at(state, 3))).toContain('line cm-heading cm-h1 @0');
    expect(drawn(at(state, 3)).some((word) => word.startsWith('hide'))).toBe(false);
    expect(kindsOf(at(state, 3))).toEqual(['picture']);
  });
});

describe('the two modes', () => {
  it('start drawn, or raw when asked', () => {
    expect(noteMode(noteState('# Title', { caseInfo: CASE }))).toBe('drawn');
    expect(noteMode(noteState('# Title', { caseInfo: CASE, mode: 'markdown' }))).toBe('markdown');
    expect(noteMode(noteState('# Title', { caseInfo: CASE, mode: 'anything' }))).toBe('drawn');
  });
});
