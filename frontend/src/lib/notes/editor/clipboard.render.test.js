// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { noteExtensions, noteState, setNoteCase } from '../liveMarkdown.js';
import { copiedHtml, copiedMarkdown } from './clipboard.js';
import { htmlToMarkdown } from './htmlMarkdown.js';

/**
 * A copy from the drawn page carries the Markdown of what is selected and the page it
 * makes; a web page or a document pasted in is written as the Markdown an analyst would
 * type. The raw Markdown mode keeps the editor's own copy and paste.
 */

const CASE = { caseId: 'c1', entities: [{ id: 'p1', type: 'place', label: 'Quay north', attrs: {} }] };

describe('HTML pasted in, as Markdown', () => {
  it('writes a web page\'s headings, marks, links, lists and quotes', () => {
    const html = '<h1>Port</h1><p>Seen <strong>twice</strong>, <em>once</em> by <a href="https://example.org/p">the port</a>, <s>not</s> <code>x=1</code>.</p>'
      + '<ul><li>One</li><li>Two<ul><li>Deeper</li></ul></li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>'
      + '<blockquote><p>Said on the radio.</p></blockquote><hr><pre>a  b\n  c</pre>';
    expect(htmlToMarkdown(html)).toBe([
      '# Port', '', 'Seen **twice**, *once* by [the port](https://example.org/p), ~~not~~ `x=1`.', '',
      '- One', '- Two', '  - Deeper', '', '3. Third', '4. Fourth', '', '> Said on the radio.', '', '---', '', '```', 'a  b', '  c', '```',
    ].join('\n'));
  });

  it('reads Google Docs\' weights and its wrapper that is not bold', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h2 dir="ltr"><span style="font-weight:400">Findings</span></h2>'
      + '<p dir="ltr"><span style="font-weight:400">Plain </span><span style="font-weight:700">heavy</span><span style="font-style:italic"> slanted</span></p>'
      + '<ul><li aria-level="1"><p role="presentation"><span>Top</span></p></li><li aria-level="2"><p role="presentation"><span>Under</span></p></li></ul></b>';
    expect(htmlToMarkdown(html)).toBe('## Findings\n\nPlain **heavy** *slanted*\n\n- Top\n  - Under');
  });

  it('reads Word\'s lists, its bullet drawn by itself left out', () => {
    const html = '<p class=MsoNormal><b>Lead</b> paragraph<o:p></o:p></p>'
      + '<p class=MsoListParagraphCxSpFirst style=\'mso-list:l0 level1 lfo1\'><span style=\'mso-list:Ignore\'>·<span>&nbsp;&nbsp;</span></span>First</p>'
      + '<p class=MsoListParagraphCxSpLast style=\'mso-list:l0 level2 lfo1\'><span style=\'mso-list:Ignore\'>o<span>&nbsp;</span></span>Second</p>';
    expect(htmlToMarkdown(html)).toBe('**Lead** paragraph\n\n- First\n  - Second');
  });

  it('keeps words that Markdown would read as marks as words', () => {
    expect(htmlToMarkdown('<p>1. not a list, a *star*, [brackets] and <b>** stars</b></p><p># not a heading</p>'))
      .toBe('1\\. not a list, a \\*star\\*, \\[brackets\\] and **\\*\\* stars**\n\n\\# not a heading');
    expect(htmlToMarkdown('<p>  </p><script>alert(1)</script><img src="x.png">')).toBe('');
  });

  it('writes a to-do list from boxes, ticked or not', () => {
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Open</li></ul>'))
      .toBe('- [x] Done\n- [ ] Open');
  });
});

describe('a copy', () => {
  const state = noteState('## Port call\n\nThe **mast** and [the report](https://example.org/r) at [[entity:p1|Quay north]].', { caseInfo: CASE });
  const text = state.doc.toString();

  it('closes the marks it cuts, and leaves out the marks of words it holds none of', () => {
    expect(copiedMarkdown(state, text.indexOf('ast'), text.indexOf(' and'))).toBe('**ast**');
    expect(copiedMarkdown(state, text.indexOf('report'), text.indexOf(' at'))).toBe('[report](https://example.org/r)');
    // from the end of bold's words: its closing marks are not taken alone
    expect(copiedMarkdown(state, text.indexOf('** and'), text.indexOf(' [the'))).toBe(' and');
  });

  it('keeps a line\'s own marks when it takes the line whole, and only then', () => {
    expect(copiedMarkdown(state, text.indexOf('Port'), text.indexOf('\n'))).toBe('## Port call');
    expect(copiedMarkdown(state, text.indexOf('Port'), text.indexOf(' call'))).toBe('Port');
  });

  it('gives Word and Google Docs the page it makes, a chip as its name, marked as a note\'s own', () => {
    const html = copiedHtml(state, copiedMarkdown(state, 0, text.length));
    expect(html).toMatch(/^<div data-azimut-note="1">/);
    expect(html).toContain('<strong>mast</strong>');
    expect(html).toContain('href="https://example.org/r"');
    expect(html).toContain('Quay north');
    expect(html).not.toContain('data-entity-id');
  });
});

describe('the clipboard of the editor', () => {
  let view;
  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  function editor(doc, mode = 'drawn') {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ mode }) }) });
    view.dispatch({ effects: setNoteCase.of(CASE) });
    return view;
  }

  /** Fire a clipboard event on the page, answering what it left on the clipboard. */
  function fire(type, data = new DataTransfer()) {
    const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return { data, taken: event.defaultPrevented };
  }

  it('copies the Markdown and the HTML of the words selected', () => {
    editor('The **mast** matches.');
    view.dispatch({ selection: EditorSelection.range(7, 10) });
    const { data, taken } = fire('copy');
    expect(taken).toBe(true);
    expect(data.getData('text/plain')).toBe('**ast**');
    expect(data.getData('text/html')).toContain('<strong>ast</strong>');
  });

  it('cuts what it copied, the marks around what stays kept whole', () => {
    editor('The **mast** matches.');
    view.dispatch({ selection: EditorSelection.range(7, 15) });
    fire('cut');
    expect(view.state.doc.toString()).toBe('The **m**tches.');
  });

  it('writes a web page pasted in as Markdown, and leaves a note\'s own copy and plain words to the editor', () => {
    editor('Start ');
    view.dispatch({ selection: EditorSelection.cursor(6) });
    const page = new DataTransfer();
    page.setData('text/html', '<p>Seen <b>twice</b>.</p>');
    page.setData('text/plain', 'Seen twice.');
    expect(fire('paste', page).taken).toBe(true);
    expect(view.state.doc.toString()).toBe('Start Seen **twice**.');
    // a note's own copy goes in as its Markdown, the bold of the HTML not written twice
    const own = new DataTransfer();
    own.setData('text/html', '<div data-azimut-note="1"><p><strong>x</strong> y</p></div>');
    own.setData('text/plain', '**x** _y_');
    fire('paste', own);
    expect(view.state.doc.toString()).toBe('Start Seen **twice**.**x** _y_');
    const plain = new DataTransfer();
    plain.setData('text/html', '<span>just *words*</span>');
    plain.setData('text/plain', 'just *words*');
    fire('paste', plain);
    expect(view.state.doc.toString()).toBe('Start Seen **twice**.**x** _y_just *words*');
  });

  it('is the editor\'s own in the raw Markdown', () => {
    editor('The **mast** matches.', 'markdown');
    view.dispatch({ selection: EditorSelection.range(7, 10) });
    expect(fire('copy').data.getData('text/html')).toBe('');
    const page = new DataTransfer();
    page.setData('text/html', '<p>Seen <b>twice</b>.</p>');
    page.setData('text/plain', 'Seen twice.');
    fire('paste', page);
    expect(view.state.doc.toString()).not.toContain('**twice**');
  });
});
