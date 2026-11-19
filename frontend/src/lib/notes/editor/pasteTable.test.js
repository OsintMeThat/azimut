// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { decodeTableFile, pasteSource, pastedTable, readTableFile, sizeSaid } = await import('./pasteTable.js');
const { emptyTable } = await import('./tableInsert.js');

/**
 * A spreadsheet's or a web page's table pasted anywhere on the drawn page becomes a
 * table, said in a toast with its two ways back; anything else pastes as before.
 */

// read from the frontend's root, where the tests run: this environment's module address is no file's
const fixture = (name) => readFileSync(`${process.cwd()}/src/lib/notes/editor/fixtures/${name}`, 'utf8');

let view;
let toast;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc, anchor = doc.length, { mode = 'drawn' } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  toast = vi.fn();
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers: { tableToast: toast }, mode }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(anchor) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

function paste({ html = '', text = '' }) {
  const data = new DataTransfer();
  if (text) data.setData('text/plain', text);
  if (html) data.setData('text/html', html);
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const text = () => view.state.doc.toString();

describe('what a paste makes', () => {
  it('reads a LibreOffice range, an Excel one and a Sheets one as a spreadsheet\'s', () => {
    for (const name of ['paste-libreoffice.html', 'paste-excel.html', 'paste-sheets.html']) {
      const made = pastedTable({ html: fixture(name) });
      expect(made, name).not.toBeNull();
      expect(made.source, name).toBe('a spreadsheet');
      expect(made.columns, name).toBeGreaterThan(1);
    }
  });

  it('reads a web page\'s table as a web page\'s, and tab-separated text as a spreadsheet\'s', () => {
    expect(pastedTable({ html: fixture('paste-web.html') }).source).toBe('a web page');
    const tsv = pastedTable({ text: fixture('libreoffice.tsv') });
    expect(tsv.source).toBe('a spreadsheet');
    expect(tsv.table.header).toEqual(['Model', 'Grade', 'At least', 'Unit price']);
  });

  it('leaves words, a link and one cell as they are', () => {
    expect(pastedTable({ text: 'Two words' })).toBeNull();
    expect(pastedTable({ text: 'https://example.org/a' })).toBeNull();
    expect(pastedTable({ html: '<table><tr><td>one</td></tr></table>', text: 'one' })).toBeNull();
    expect(pastedSource()).toBe('a spreadsheet');
    function pastedSource() {
      return pasteSource('', { format: 'tsv' });
    }
  });

  it('says a size as the toast does', () => {
    expect(sizeSaid(13, 3)).toBe('13 rows × 3 columns');
    expect(sizeSaid(1, 1)).toBe('1 row × 1 column');
  });
});

describe('a paste anywhere in the note', () => {
  const NOTE = 'Intro.\n\n\n\nAfter.';
  const LINE = 'Intro.\n\n'.length;

  it('makes a table on lines of its own, says it, and goes back to text or to nothing on its two presses', () => {
    editor(NOTE, LINE);
    const html = fixture('paste-libreoffice.html');
    const plain = fixture('libreoffice.tsv');
    const event = paste({ html, text: plain });
    expect(event.defaultPrevented).toBe(true);
    const made = pastedTable({ html, text: plain });
    expect(text()).toBe(`Intro.\n\n${made.text}\n\nAfter.`);
    expect(view.dom.querySelector('.cm-grid-block')).toBeTruthy();
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, actions] = toast.mock.calls[0];
    expect(message).toBe(`Pasted ${sizeSaid(made.rows, made.columns)} from a spreadsheet.`);
    expect(actions.map((action) => action.label)).toEqual(['Paste as text', 'Undo']);
    actions[0].onClick();
    expect(text()).toBe(`Intro.\n\n${plain.replace(/\r\n?/g, '\n')}\n\nAfter.`);
    // one Undo takes the text back to the table, a second to the note as it was
    undo(view);
    expect(text()).toBe(`Intro.\n\n${made.text}\n\nAfter.`);
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('takes the table back on the toast\'s Undo, byte for byte, and leaves it once it was changed', () => {
    editor(NOTE, LINE);
    paste({ text: 'Model\tGrade\nCougar\tidentified\nWahsh\talmost sure' });
    const [, actions] = toast.mock.calls[0];
    actions[1].onClick();
    expect(text()).toBe(NOTE);
    editor(NOTE, LINE);
    paste({ text: 'Model\tGrade\nCougar\tidentified\nWahsh\talmost sure' });
    view.dispatch({ changes: { from: text().indexOf('Cougar'), insert: 'Streit ' } });
    toast.mock.calls[0][1][1].onClick();
    expect(text()).toContain('Streit Cougar');
    expect(toast).toHaveBeenLastCalledWith('That part of the note was changed since, so it stays', [], 'warn');
  });

  it('puts the table under words a paste lands after, a blank line between', () => {
    editor('Words here', 'Words here'.length);
    paste({ text: 'a\tb\n1\t2' });
    expect(text()).toBe(`Words here\n\n${pastedTable({ text: 'a\tb\n1\t2' }).text}\n`);
  });

  it('puts the table under a picked table rather than in its lines', () => {
    const note = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.';
    editor(note, 0);
    paste({ text: 'x\ty\n3\t4' });
    expect(text()).toBe(`| a | b |\n| --- | --- |\n| 1 | 2 |\n\n${pastedTable({ text: 'x\ty\n3\t4' }).text}\n\nAfter.`);
  });

  it('pastes as before in code, in the raw Markdown, and words', () => {
    // the editor's own paste writes the clipboard's words
    editor('```\n\n```', 4);
    paste({ text: 'a\tb\n1\t2' });
    expect(text()).toBe('```\na\tb\n1\t2\n```');
    editor(NOTE, LINE, { mode: 'markdown' });
    paste({ text: 'a\tb\n1\t2' });
    expect(text()).toBe('Intro.\n\na\tb\n1\t2\n\nAfter.');
    editor(NOTE, LINE);
    paste({ text: 'just words' });
    expect(text()).toBe('Intro.\n\njust words\n\nAfter.');
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('a table from a file', () => {
  it('reads UTF-8, UTF-16 with its mark and an older Windows CSV', () => {
    const utf8 = new TextEncoder().encode('Ville;Été\nSanaa;2026');
    expect(decodeTableFile(utf8)).toBe('Ville;Été\nSanaa;2026');
    const wide = new Uint8Array([0xff, 0xfe, ...[...'a\tb'].flatMap((char) => [char.charCodeAt(0), 0])]);
    expect(decodeTableFile(wide)).toBe('a\tb');
    expect(decodeTableFile(new Uint8Array([0x45, 0x74, 0xe9]))).toBe('Eté');
  });

  it('reads a CSV, a TSV and an HTML file, and says when there is no table', async () => {
    const csv = await readTableFile(new File([fixture('libreoffice-fr.csv')], 'losses.csv', { type: 'text/csv' }));
    expect(csv.format).toBe('csv');
    const tsv = await readTableFile(new File([fixture('libreoffice.tsv')], 'losses.tsv'));
    expect(tsv.cells[0]).toEqual(['Model', 'Grade', 'At least', 'Unit price']);
    const html = await readTableFile(new File([fixture('paste-web.html')], 'page.html', { type: 'text/html' }));
    expect(html.format).toBe('html');
    await expect(readTableFile(new File(['<p>No table</p>'], 'page.html', { type: 'text/html' }))).rejects.toThrow('No table found in page.html');
  });

  it('writes a new empty table rows by columns under a header to name', () => {
    expect(emptyTable(2, 3)).toBe('| | | |\n| --- | --- | --- |\n| | | |\n| | | |');
  });
});
