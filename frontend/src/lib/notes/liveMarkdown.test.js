import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { focusedState, noteDecorations, noteState } from './liveMarkdown.js';

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

  it('draws a closed mermaid fence as a diagram, and its source while the cursor is in it', () => {
    const text = '```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter';
    const state = noteState(text, { caseInfo: CASE });
    expect(drawn(state)[0]).toBe(`block 0-${text.indexOf('\n\nAfter')}`);
    expect(drawn(at(state, 14)).every((word) => word.startsWith('line cm-code-line'))).toBe(true);
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
    expect(drawn(at(state, 9))).toContain('mark cm-ref-source 7-21');
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
  it('is drawn as a rule, and as its text while the cursor is on it', () => {
    const state = noteState('Before\n\n<!-- pagebreak -->\n\nAfter', { caseInfo: CASE });
    expect(drawn(state)).toContain('pagebreak 8-26');
    expect(drawn(at(state, 10))).toContain('line cm-pagebreak-line @8');
    expect(drawn(at(state, 10)).some((item) => item.startsWith('pagebreak'))).toBe(false);
  });

  it('is only an example inside code', () => {
    const state = noteState('```\n<!-- pagebreak -->\n```', { caseInfo: CASE });
    expect(drawn(state).some((item) => item.startsWith('pagebreak'))).toBe(false);
  });
});

describe('the end of the cover page', () => {
  const COVER = '::: center\n# {title}\n:::\n<!-- cover -->\n\nBody';

  it('is drawn as a named rule, and as its text while the cursor is on it', () => {
    const state = noteState(COVER, { caseInfo: CASE });
    const rule = COVER.indexOf('<!-- cover -->');
    expect(drawn(state)).toContain(`coverrule ${rule}-${rule + 14}`);
    expect(drawn(at(state, rule + 3))).toContain(`line cm-pagebreak-line @${rule}`);
    expect(drawn(at(state, rule + 3)).some((item) => item.startsWith('coverrule'))).toBe(false);
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
