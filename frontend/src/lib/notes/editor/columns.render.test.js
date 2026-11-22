// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';

// the small pictures the case made, asked once a list opens
const { post } = vi.hoisted(() => ({ post: vi.fn(async () => []) }));
vi.mock('../../api.js', () => ({ api: { post } }));

const { focusedState, noteExtensions, noteState, setNoteCase } = await import('../liveMarkdown.js');
const { forgetPickerThumbs } = await import('./casePicker.js');
const { blockActions } = await import('./blockMenu.js');
const { besideSpec, columnAt, rowAround } = await import('./columnsRow.js');
const { columnStyle, writeInColumn } = await import('./columnsBlock.js');
const { slashSource } = await import('./slashMenu.js');
const { blocksIn, blockRanges } = await import('./ranges.js');
const { SLASH_COMMANDS, slashInsert } = await import('../syntax.js');
const { insertPreview } = await import('./insertPreview.js');
const { markdownHtml } = await import('../../markdown.js');

/**
 * A row of columns on the note page: drawn side by side as the PDF prints it, set to two
 * or three columns and their widths from its bar, an empty column filled with a case
 * picture, a picture moved, replaced, captioned or taken out of the row, and words
 * written in a column where it stands, the other columns beside it. Each gesture writes
 * the lines an expert would type, in one change one Undo takes back.
 */

const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };
const YARD = { id: 'm2', type: 'media', label: 'Yard', attrs: { path: 'media/yard.png', kind: 'image' } };
const GATE = { id: 'm3', type: 'capture', label: 'Gate', attrs: { path: 'media/gate.png', kind: 'image' } };
const CASE = { caseId: 'c1', entities: [ROOF, YARD, GATE] };

const PICTURES = ':::: columns\n::: column\n[[media:m1|Roof]]{caption="The roof"}\n:::\n::: column\n[[media:m2|Yard]]\n:::\n::::';
const WORDS = ':::: columns\n::: column\nThe bridge is green.\n:::\n::: column\n[[media:m2|Yard]]\n:::\n::::';
const EMPTY = ':::: columns\n::: column\n\n:::\n::: column\n\n:::\n::::';

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  for (const node of document.querySelectorAll('.cm-picker, .cm-handle-menu')) node.remove();
  forgetPickerThumbs();
  post.mockClear();
});

function editor(doc, { readOnly = false, handlers = {} } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ readOnly, handlers }) }) });
  view.dispatch({ effects: setNoteCase.of(CASE) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of(CASE) });
  return view;
}

const text = () => view.state.doc.toString();
const mouse = (node, type, extra = {}) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }));
const key = (name, options = {}) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
const row = () => view.dom.querySelector('.cm-block-columns');
const undoneTo = (doc) => {
  undo(view);
  return text() === doc;
};
const doc = (body) => `Intro\n\n${body}\n\nEnd`;
const at = (needle) => text().indexOf(needle);

describe('a row drawn', () => {
  it('sets pictures side by side, each with its caption, the bar saying they share one height', () => {
    editor(doc(PICTURES));
    const columns = [...row().querySelectorAll('.cm-cols-row > .cm-col')];
    expect(columns).toHaveLength(2);
    expect(row().querySelector('.cm-cols-row').classList.contains('cm-cols-pictures')).toBe(true);
    expect(columns.map((column) => column.querySelector('img')?.getAttribute('alt'))).toEqual(['Roof', 'Yard']);
    expect(columns[0].querySelector('.markdown-caption').textContent).toBe('The roof');
    const bar = row().querySelector('.cm-cols-bar');
    expect(bar.querySelector('[data-count="2"]').getAttribute('aria-pressed')).toBe('true');
    expect(bar.querySelector('.cm-cols-note').textContent).toBe('Pictures at one height, none cropped');
    expect(bar.querySelector('[data-widths]')).toBeNull();
    // a picture's bar: caption, its place in the row, another picture, out of the row
    expect([...columns[0].querySelectorAll('.cm-col-bar button')].map((button) => button.title)).toEqual([
      'Caption: a line printed under the picture', 'Move right', 'Replace: another picture of the case in its place, its caption kept',
      'Out of the row: back under it, on its own',
    ]);
  });

  it('shares words and a picture by the widths written, and offers the three widths', () => {
    editor(doc(WORDS.replace('::: column\nThe', '::: column width=66%\nThe')));
    const columns = [...row().querySelectorAll('.cm-cols-row > .cm-col')];
    expect(columns[0].querySelector('.cm-col-text').textContent.trim()).toBe('The bridge is green.');
    expect(columns.map((column) => Number(column.style.flexGrow))).toEqual([66, 34]);
    const widths = [...row().querySelectorAll('[data-widths]')];
    expect(widths.map((button) => [button.title, button.getAttribute('aria-pressed')])).toEqual([
      ['Equal', 'false'], ['Wide left', 'true'], ['Wide right', 'false'],
    ]);
  });

  it('offers an empty column a case picture or a file, and draws nothing there when the note is read only', () => {
    editor(doc(EMPTY), { handlers: { upload: vi.fn() } });
    const empty = row().querySelectorAll('.cm-col-empty');
    expect(empty).toHaveLength(2);
    expect(empty[0].querySelector('.cm-col-hint').textContent).toBe('Type, or add a picture');
    expect([...empty[0].querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Case picture', 'From a file']);
    view.destroy();
    editor(doc(EMPTY), { readOnly: true });
    expect(row().querySelector('.cm-col-drop')).toBeNull();
    expect(row().querySelector('.cm-cols-bar')).toBeNull();
  });
});

describe('the row\'s bar and a picture\'s', () => {
  it('fills an empty column with a case picture, one Undo taking it back', async () => {
    editor(doc(EMPTY));
    mouse(row().querySelectorAll('[data-add-picture]')[1], 'mousedown');
    const picker = view.dom.querySelector('.cm-picker');
    expect(picker.getAttribute('aria-label')).toBe('Add a picture');
    mouse(picker.querySelector('[data-entity-pick="m3"]'), 'click');
    expect(text()).toBe(doc(EMPTY.replace(':::\n::: column\n\n:::', ':::\n::: column\n[[media:m3|Gate]]\n:::')));
    expect(undoneTo(doc(EMPTY))).toBe(true);
  });

  it('takes a third column and gives it back, the widths of two columns of words set in one press', () => {
    editor(doc(WORDS));
    mouse(row().querySelector('[data-count="3"]'), 'mousedown');
    expect(text()).toBe(doc(WORDS.replace(':::\n::::', ':::\n::: column\n\n:::\n::::')));
    mouse(row().querySelector('[data-count="2"]'), 'mousedown');
    expect(text()).toBe(doc(WORDS));
    mouse(row().querySelector('[data-widths="right"]'), 'mousedown');
    expect(text()).toBe(doc(WORDS.replace(':::\n::: column\n[[media', ':::\n::: column width=66%\n[[media')));
    expect(undoneTo(doc(WORDS))).toBe(true);
  });

  it('moves a picture, replaces it, and takes it out of the row, which then is a row no more', () => {
    editor(doc(PICTURES));
    mouse(row().querySelector('[data-column="0"] [data-col-move="1"]'), 'mousedown');
    expect(text()).toBe(doc(':::: columns\n::: column\n[[media:m2|Yard]]\n:::\n::: column\n[[media:m1|Roof]]{caption="The roof"}\n:::\n::::'));
    expect(undoneTo(doc(PICTURES))).toBe(true);
    mouse(row().querySelector('[data-column="1"] [data-col-replace]'), 'mousedown');
    mouse(view.dom.querySelector('.cm-picker [data-entity-pick="m3"]'), 'click');
    expect(text()).toBe(doc(PICTURES.replace('[[media:m2|Yard]]', '[[media:m3|Gate]]')));
    expect(undoneTo(doc(PICTURES))).toBe(true);
    mouse(row().querySelector('[data-column="1"] [data-col-out]'), 'mousedown');
    expect(text()).toBe(doc('[[media:m1|Roof]]{caption="The roof"}\n\n[[media:m2|Yard]]'));
    expect(row()).toBeNull();
    expect(undoneTo(doc(PICTURES))).toBe(true);
  });

  it('writes a picture\'s caption where it prints', () => {
    editor(doc(PICTURES));
    mouse(row().querySelector('[data-column="1"] [data-col-caption]'), 'mousedown');
    const field = row().querySelector('[data-column="1"] .picture-caption-field');
    field.value = 'The yard at dawn';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(text()).toBe(doc(PICTURES.replace('[[media:m2|Yard]]', '[[media:m2|Yard]]{caption="The yard at dawn"}')));
  });

  it('opens the block menu, whose Take apart puts the columns one under the other', () => {
    editor(doc(WORDS));
    mouse(row().querySelector('[data-cols-more]'), 'mousedown');
    expect(view.dom.querySelector('.cm-handle-menu')).not.toBeNull();
    const block = blockRanges(view.state).find((one) => one.kind === 'columns');
    const apart = blockActions(view.state, block).find((entry) => entry.id === 'apart');
    expect(apart.label).toBe('Take apart');
    view.dispatch(apart.run(view.state));
    expect(text()).toBe(doc('The bridge is green.\n\n[[media:m2|Yard]]'));
  });
});

describe('words written in a column', () => {
  it('puts the caret in the column pressed, which then stands where it is drawn, the others beside it', () => {
    editor(doc(WORDS));
    mouse(row().querySelector('[data-column="0"] .cm-col-text'), 'mousedown');
    expect(view.state.selection.main.head).toBe(at('The bridge is green.') + 'The bridge is green.'.length);
    // the row is no longer drawn whole: its bar and the other column above, the column's own lines in its place
    expect(row()).toBeNull();
    const top = view.dom.querySelector('.cm-cols-edit');
    expect(top.querySelector('.cm-cols-bar')).not.toBeNull();
    expect([...top.querySelectorAll('.cm-cols-over > .cm-col')].map((column) => column.dataset.column)).toEqual(['1']);
    expect(top.querySelector('.cm-cols-frame')).not.toBeNull();
    expect(view.dom.querySelector('.cm-cols-edit-end')).not.toBeNull();
    const line = view.dom.querySelector('.cm-col-line');
    expect(line.textContent).toBe('The bridge is green.');
    expect(line.getAttribute('style')).toContain(columnStyle([0.5, 0.5], 0).split(';')[0]);
    expect(line.getAttribute('style')).toContain(columnStyle([0.5, 0.5], 0).split(';')[1].trim());
    // the handle and the menus still see one block, the row
    expect(blockRanges(view.state).filter((block) => block.kind === 'columns')).toEqual([
      { from: at(':::: columns'), to: at('::::\n\nEnd') + 4, kind: 'columns', drawn: true },
    ]);
  });

  it('places a column\'s lines by its share of the row and the room between columns', () => {
    expect(columnStyle([0.66, 0.34], 1)).toBe('margin-left: calc(var(--note-gutter, 32px) + calc((100% - 2 * var(--note-gutter, 32px) - 16px) * 0.6600 + 16px)); '
      + 'margin-right: calc(var(--note-gutter, 32px) + calc((100% - 2 * var(--note-gutter, 32px) - 16px) * 0.0000 + 0px)); padding-left: 0; padding-right: 0;');
  });

  it('types in the column, Tab going to the next one, Escape picking the row', () => {
    editor(doc(EMPTY));
    writeInColumn(view, at(':::: columns'), 0);
    view.dispatch(view.state.replaceSelection('Left words'));
    expect(text()).toBe(doc(EMPTY.replace('::: column\n\n:::', '::: column\nLeft words\n:::')));
    expect(key('Tab')).toBe(false);
    const second = columnAt(view.state, view.state.selection.main.head);
    expect(second.index).toBe(1);
    expect(key('Escape')).toBe(false);
    expect(view.state.selection.main.head).toBe(at(':::: columns'));
    expect(blocksIn(view.state, at(':::: columns'))[0].kind).toBe('columns');
  });

  it('says what an empty column takes where the caret is', () => {
    editor(doc(EMPTY), { handlers: { upload: vi.fn() } });
    writeInColumn(view, at(':::: columns'), 1);
    const here = view.dom.querySelector('.cm-col-line .cm-col-here');
    expect(here.querySelector('.cm-col-hint').textContent).toBe('Type, or add a picture');
    expect([...here.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Case picture', 'From a file']);
  });

  it('keeps the row\'s fences and its other columns as they are while a column is typed in', () => {
    editor(doc(WORDS));
    writeInColumn(view, at(':::: columns'), 0);
    const { row: found, column } = columnAt(view.state, view.state.selection.main.head);
    // Backspace at the column's start and Delete at its end stay in it
    view.dispatch({ selection: { anchor: column.contentFrom } });
    expect(key('Backspace')).toBe(false);
    expect(text()).toBe(doc(WORDS));
    // a deletion running over the fences keeps them, and the other column
    view.dispatch({ changes: { from: column.contentFrom - 3, to: found.to }, userEvent: 'delete.selection' });
    expect(text()).toBe(doc(WORDS.replace('The bridge is green.', '')));
    // the row deleted whole goes, as any block does
    view.dispatch({ selection: { anchor: column.contentFrom } });
    const now = rowAround(view.state, found.from);
    view.dispatch({ changes: { from: now.from, to: now.to + 2 }, userEvent: 'delete.selection' });
    expect(text()).toBe('Intro\n\nEnd');
  });

  it('offers in a column\'s / menu only what fits in one', () => {
    editor(doc(EMPTY));
    writeInColumn(view, at(':::: columns'), 0);
    view.dispatch(view.state.replaceSelection('/'));
    const pos = view.state.selection.main.head;
    const result = slashSource({})(new CompletionContext(view.state, pos, true));
    const labels = result.options.map((option) => option.label);
    expect(labels).toContain('Case picture');
    expect(labels).toContain('Bulleted list');
    for (const absent of ['Table', 'Chart', 'Columns', 'Page break', 'Infographic', 'Interactive map']) expect(labels).not.toContain(absent);
    // outside a row, Columns stands in Layout, after Divider
    const outside = slashSource({})(new CompletionContext(noteState('/'), 1, true));
    const layout = outside.options.filter((option) => option.section?.name === 'Layout').map((option) => option.label);
    expect(layout.slice(0, 3)).toEqual(['Divider', 'Columns', 'Page break']);
  });
});

describe('a row made', () => {
  it('is what / › Columns writes, the caret in its first column', () => {
    const command = SLASH_COMMANDS.find((one) => one.id === 'columns');
    const made = slashInsert(command, { before: '' });
    expect(made.text).toBe(`${EMPTY}\n`);
    expect(made.text.slice(0, made.cursor)).toBe(':::: columns\n::: column\n');
    const after = slashInsert(command, { before: 'Words' });
    expect(after.text.slice(0, after.cursor)).toBe('\n\n:::: columns\n::: column\n');
    const preview = insertPreview(command);
    expect(preview.querySelectorAll('.cm-ip-cols')).toHaveLength(2);
    expect(preview.querySelector('.cm-ip-md').textContent).toContain(':::: columns');
  });

  it('is what a picture\'s Side by side writes with the picture picked', () => {
    editor(doc('[[media:m1|Roof]]{width=50% caption="The roof"}'));
    const bar = view.dom.querySelector('.cm-block-picture [data-size-bar]');
    mouse(bar.querySelector('[data-beside]'), 'mousedown');
    const picker = view.dom.querySelector('.cm-picker');
    expect(picker.getAttribute('aria-label')).toBe('Put a picture beside it');
    mouse(picker.querySelector('[data-entity-pick="m2"]'), 'click');
    expect(text()).toBe(doc(PICTURES));
    expect(undoneTo(doc('[[media:m1|Roof]]{width=50% caption="The roof"}'))).toBe(true);
  });

  it('is what a picture let go against another\'s side writes, up to three columns', () => {
    const state = noteState('[[media:m1|Roof]]\n\nWords\n\n[[media:m2|Yard]]\n\nEnd');
    const roof = { from: 0, to: 17, kind: 'picture' };
    const yard = { from: state.doc.toString().indexOf('[[media:m2'), kind: 'picture' };
    yard.to = yard.from + 17;
    const spec = besideSpec(state, yard, roof, 'left');
    const made = state.update(spec).state.doc.toString();
    expect(made).toBe(':::: columns\n::: column\n[[media:m2|Yard]]\n:::\n::: column\n[[media:m1|Roof]]\n:::\n::::\n\nWords\n\nEnd');
    // a third picture against the row's right side
    const more = noteState(`${PICTURES}\n\n[[media:m3|Gate]]`);
    const gate = { from: more.doc.toString().indexOf('[[media:m3'), kind: 'picture' };
    gate.to = gate.from + 17;
    const three = more.update(besideSpec(more, gate, { from: 0, to: PICTURES.length, kind: 'columns' }, 'right')).state;
    expect(rowAround(three, 0).columns.map((column) => column.text)).toEqual(['[[media:m1|Roof]]{caption="The roof"}', '[[media:m2|Yard]]', '[[media:m3|Gate]]']);
    expect(besideSpec(three, { from: 0, to: 1, kind: 'picture' }, { from: 0, to: 10, kind: 'columns' }, 'left')).toBeNull();
  });

  it('is drawn side by side wherever the note is read as Markdown, an empty column drawing nothing', () => {
    const html = markdownHtml(`Intro\n\n${WORDS.replace(':::\n::::', ':::\n::: column\n\n:::\n::::')}\n\nEnd`, { entities: [ROOF, YARD], caseId: 'c1' });
    const box = document.createElement('div');
    box.innerHTML = html;
    const columns = [...box.querySelectorAll('.markdown-columns > .markdown-column')];
    expect(columns).toHaveLength(2);
    expect(columns[0].textContent.trim()).toBe('The bridge is green.');
    expect(columns[1].querySelector('img').getAttribute('alt')).toBe('Yard');
    expect(box.textContent).not.toContain(':::');
  });
});
