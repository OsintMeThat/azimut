import { describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';

import { focusedState, noteDecorations, noteState } from '../liveMarkdown.js';
import { setSelecting } from './state.js';
import {
  activeFormats, clearInline, linkAt, linkTarget, removeLink, toggleInline, toggleInternal, toggleLines, toggleQuote, writeCitation, writeLink,
} from './marks.js';

/** The text with `«` … `»` marking the selection, as a state with it selected. */
function picked(marked) {
  const from = marked.indexOf('«');
  const to = marked.indexOf('»') - 1;
  const text = marked.replace('«', '').replace('»', '');
  return noteState(text).update({ selection: EditorSelection.range(from, to) }).state;
}

/** What `spec` makes of `state`: the text, the selection marked back in. */
function after(state, spec) {
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  const text = next.doc.toString();
  return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

describe('bold, italic and code around words', () => {
  it('sets each mark around the words, the selection kept on them', () => {
    const state = picked('Seen at «the quay» today.');
    expect(after(state, toggleInline(state, 'bold'))).toBe('Seen at **«the quay»** today.');
    expect(after(state, toggleInline(state, 'italic'))).toBe('Seen at *«the quay»* today.');
    expect(after(state, toggleInline(state, 'code'))).toBe('Seen at `«the quay»` today.');
    expect(after(state, toggleInline(state, 'strike'))).toBe('Seen at ~~«the quay»~~ today.');
  });

  it('keeps spaces a double press picked up outside the marks', () => {
    const state = picked('Seen at« the quay »today.');
    expect(after(state, toggleInline(state, 'bold'))).toBe('Seen at **«the quay»** today.');
  });

  it('takes a mark off the words that carry it, read from the tree', () => {
    const state = picked('Seen at **«the quay»** today.');
    expect(after(state, toggleInline(state, 'bold'))).toBe('Seen at «the quay» today.');
    // the * of italic is never taken for half of the ** of bold
    expect(after(state, toggleInline(state, 'italic'))).toBe('Seen at ***«the quay»*** today.');
  });

  it('takes a mark off part of a run, the rest keeping it', () => {
    const state = picked('**Seen at «the quay» today.**');
    expect(after(state, toggleInline(state, 'bold'))).toBe('**Seen at** «the quay» **today.**');
  });

  it('marks words across a run once, never nested', () => {
    const state = picked('«Seen at **the** quay» today.');
    expect(after(state, toggleInline(state, 'bold'))).toBe('**«Seen at the quay»** today.');
  });

  it('marks each line apart, past a list item\'s mark', () => {
    const state = picked('- «First\n- Second»');
    expect(after(state, toggleInline(state, 'bold'))).toBe('- **«First**\n- **Second»**');
  });

  it('fences lines selected for code, and takes the fence off again', () => {
    const state = picked('«one\ntwo»');
    expect(after(state, toggleInline(state, 'code'))).toBe('```\n«one\ntwo»\n```');
    const fenced = picked('```\n«one\ntwo»\n```');
    expect(after(fenced, toggleInline(fenced, 'code'))).toBe('«one\ntwo»');
  });

  it('with no words, writes the two marks with the cursor between them', () => {
    const state = noteState('Seen ').update({ selection: EditorSelection.cursor(5) }).state;
    expect(after(state, toggleInline(state, 'bold'))).toBe('Seen **«»**');
  });

  it('clears bold, italic, code and strikethrough, and leaves a link', () => {
    const state = picked('«**Seen** at *the* `quay` ~~now~~ [BBC](https://bbc.com)»');
    expect(after(state, clearInline(state))).toBe('«Seen at the quay now [BBC](https://bbc.com)»');
    expect(clearInline(picked('«plain words»'))).toBeNull();
  });
});

describe('whole lines', () => {
  it('turns lines into headings and back', () => {
    const state = picked('Seen «at» the quay.');
    expect(after(state, toggleLines(state, 'heading'))).toBe('## Seen «at» the quay.');
    const heading = picked('### Seen «at» the quay.');
    expect(after(heading, toggleLines(heading, 'heading'))).toBe('Seen «at» the quay.');
  });

  it('turns lines into a bulleted list and back, blank lines left alone', () => {
    const state = picked('«One\n\nTwo»');
    expect(after(state, toggleLines(state, 'bullet'))).toBe('- «One\n\n- Two»');
    const list = picked('- «One\n- Two»');
    expect(after(list, toggleLines(list, 'bullet'))).toBe('«One\nTwo»');
  });

  it('quotes lines, blank ones inside it too, and takes a callout out with its marker', () => {
    const state = picked('«One\n\nTwo»');
    expect(after(state, toggleQuote(state))).toBe('> «One\n>\n> Two»');
    const callout = picked('> [!lead] «Ask the port»');
    expect(after(callout, toggleQuote(callout))).toBe('«Ask the port»');
  });
});

describe('an internal passage', () => {
  it('marks the whole paragraphs touched, a blank line inside kept in it', () => {
    const state = picked('Public.\n\nWho «told us,\nand how.\n\nA second» paragraph.\n\nAfter.');
    expect(after(state, toggleInternal(state))).toBe(
      'Public.\n\n> [!internal] «Who told us,\n> and how.\n>\n> A second paragraph.»\n\nAfter.');
  });

  it('puts the marker on a line of its own above a heading or a list', () => {
    const state = picked('## «Sources»');
    expect(after(state, toggleInternal(state))).toBe('> [!internal]\n> «## Sources»');
  });

  it('turns a callout into the passage, and takes a passage out again', () => {
    const state = picked('> [!confirmed] «Seen twice.»');
    expect(after(state, toggleInternal(state))).toBe('> [!internal] «Seen twice.»');
    const inside = picked('> [!internal] Who told us,\n> «and how.»');
    expect(after(inside, toggleInternal(inside))).toBe('Who told us,\n«and how.»');
  });
});

describe('links and citations', () => {
  it('links words, and changes or takes off a written link', () => {
    const state = picked('Seen by «the BBC» today.');
    const target = linkTarget(state);
    expect(target.existing).toBe(false);
    expect(after(state, writeLink(target, 'https://bbc.com/news/a (b)'))).toBe('Seen by [«the BBC»](https://bbc.com/news/a%20%28b%29) today.');
    const linked = picked('Seen by [the «BBC»](https://bbc.com) today.');
    const existing = linkTarget(linked);
    expect(existing).toMatchObject({ existing: true, words: 'the BBC', url: 'https://bbc.com' });
    expect(after(linked, writeLink(existing, 'https://bbc.co.uk'))).toBe('Seen by [«the BBC»](https://bbc.co.uk) today.');
    expect(after(linked, removeLink(existing))).toBe('Seen by «the BBC» today.');
  });

  it('names a link with no words by the page, else its address', () => {
    const state = noteState('Seen ').update({ selection: EditorSelection.cursor(5) }).state;
    expect(after(state, writeLink(linkTarget(state), 'https://x.com/desk/status/1', { title: 'Post by @desk on X' })))
      .toBe('Seen [«Post by @desk on X»](https://x.com/desk/status/1)');
  });

  it('cites a case item in place of the words, as a chip named as the item is', () => {
    const state = picked('Seen by the «BBC, 5 Oct» today.');
    expect(after(state, writeCitation(linkTarget(state), { id: 'b1', label: 'BBC News, 5 Oct 2026' }))).toBe('Seen by the «[[entity:b1|BBC News, 5 Oct 2026]]» today.');
    const empty = noteState('Seen ').update({ selection: EditorSelection.cursor(5) }).state;
    expect(after(empty, writeCitation(linkTarget(empty), { id: 'b1', label: 'BBC [News]' }))).toBe('Seen «[[entity:b1|BBC News]]»');
  });

  it('never cuts a link or a chip in two: words across one take it whole, as the page shows it', () => {
    const state = picked('Pulled «back ([Al Jaz»eera](https://aljazeera.com/a); [[entity:p1|Quay]]).');
    const target = linkTarget(state);
    expect(target.words).toBe('back (Al Jazeera');
    expect(after(state, writeLink(target, 'https://bbc.com'))).toBe('Pulled [«back (Al Jazeera»](https://bbc.com); [[entity:p1|Quay]]).');
    const chip = picked('Seen at «the [[entity:p1|Qu»ay]] today.');
    expect(linkTarget(chip)).toMatchObject({ from: 8, to: 30, words: 'the Quay' });
    const bold = picked('Pulled «back ([Al Jaz»eera](https://aljazeera.com/a)).');
    expect(after(bold, toggleInline(bold, 'bold'))).toBe('Pulled **«back ([Al Jazeera](https://aljazeera.com/a)»**).');
  });

  it('never reads a chip as a link', () => {
    const state = picked('Seen at [[entity:p1|«Quay»]] today.');
    expect(linkAt(state)).toBeNull();
  });
});

describe('what the bubble lights', () => {
  it('names the marks the words carry and what their line is', () => {
    expect([...activeFormats(picked('## **Seen «at»** [the](https://a.b) quay'))].sort()).toEqual(['bold', 'heading']);
    expect([...activeFormats(picked('- Seen [«the»](https://a.b) quay'))].sort()).toEqual(['bullet', 'link']);
    expect([...activeFormats(picked('> [!internal] Seen «at» the quay'))].sort()).toEqual(['internal', 'quote']);
  });
});

describe('the lines a selection is on', () => {
  /** Whether the bold marks of the first line are put away. */
  const marksHidden = (state) => {
    const hidden = [];
    noteDecorations(state).between(0, 2, (from, to, value) => { if (!value.spec.widget && !value.spec.class) hidden.push(`${from}-${to}`); });
    return hidden.includes('0-2');
  };

  it('stay drawn, so the bubble stands over the words as they read, and so does the cursor\'s line', () => {
    const state = focusedState(picked('**Seen «at»** the quay'));
    expect(marksHidden(state)).toBe(true);
    // the cursor's line no longer shows its marks: the drawn page never does
    expect(marksHidden(focusedState(state.update({ selection: EditorSelection.cursor(4) }).state))).toBe(true);
  });

  it('hold a template\'s guidance as it was while the mouse is pressed, so nothing moves under the pointer', () => {
    /** Whether the guidance of the first line is drawn as grey words, not as its text. */
    const drawnHint = (state) => {
      let hint = false;
      noteDecorations(state).between(0, 1, (_from, _to, value) => { hint ||= Boolean(value.spec.widget?.constructor.name === 'HintWidget'); });
      return hint;
    };
    const away = focusedState(noteState('<!--? Who said it -->\n\nAnother line', { template: true }).update({ selection: EditorSelection.cursor(30) }).state);
    // the press lands on the drawn guidance: it stays drawn until the mouse is let go
    const pressed = away.update({ effects: setSelecting.of({ lines: [3] }) }).state.update({ selection: EditorSelection.cursor(4) }).state;
    expect(drawnHint(pressed)).toBe(true);
    // let go, the template's own words are written as text
    expect(drawnHint(pressed.update({ effects: setSelecting.of(false) }).state)).toBe(false);
  });
});
