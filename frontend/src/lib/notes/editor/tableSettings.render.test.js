// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';

const { focusedState, noteExtensions, setNoteCase, setNoteMode } = await import('../liveMarkdown.js');
const { SAID } = await import('./tableSettings.js');

/**
 * A table's settings card, from its grid's Settings: each choice writes the table's
 * settings line under its last row at once, one Undo step a choice, and a table back
 * to every default has no line. The drawn page stands the grid over the line; the raw
 * Markdown shows it.
 */

const TABLE = '| # | Model | Grade | At least |\n| --- | --- | --- | ---: |\n| 1 | Streit Cougar | confirmed | 8 |\n| 2 | Al-Wahsh | almost sure | 2 |';
const NOTE = `Words before.\n\n${TABLE}\n\nWords after.`;
const withLine = (line) => NOTE.replace(TABLE, `${TABLE}\n${line}`);

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, mode: 'drawn' }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const grid = () => view.dom.querySelector('.cm-grid-block');
const settings = () => grid().querySelector('.cm-grid-look');
const card = () => view.dom.querySelector('[role="dialog"][aria-label="Table settings"]');
const row = (key) => card().querySelector(`[data-key="${key}"]`);
function open() {
  settings().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  settings().click();
  return card();
}
const radio = (key, label) => [...row(key).querySelectorAll('[role="radio"]')].find((node) => node.textContent === label);
const box = (key) => row(key).querySelector('input[type="checkbox"]');
function tick(key, on) {
  box(key).checked = on;
  box(key).dispatchEvent(new Event('change', { bubbles: true }));
}
function choose(key, value) {
  const field = row(key).querySelector('select');
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
function typeIn(key, words, end = 'Enter') {
  const field = row(key).querySelector('input[type="text"]');
  field.value = words;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  if (end === 'Enter') field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  else if (end === 'change') field.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the card', () => {
  it('opens from the bar on every choice, set as the table holds it, each saying where it shows', () => {
    editor(withLine('{search=always fold=30 stripes colour="Grade"}'));
    open();
    expect([...card().querySelectorAll('[data-key]')].map((node) => node.dataset.key))
      .toEqual(['search', 'sort', 'fold', 'header', 'column', 'stripes', 'colour', 'density', 'caption', 'source']);
    expect(radio('search', 'Always').getAttribute('aria-checked')).toBe('true');
    // a fold written by hand is one of the choices, picked
    expect([...row('fold').querySelectorAll('[role="radio"]')].map((node) => node.textContent)).toEqual(['All', '10', '20', '30', '50']);
    expect(radio('fold', '30').getAttribute('aria-checked')).toBe('true');
    expect(radio('fold', '30').getAttribute('aria-label')).toBe('The first 30 rows');
    expect(box('sort').checked).toBe(true);
    expect(box('header').checked).toBe(true);
    expect(box('stripes').checked).toBe(true);
    // the columns of words, the one picked among them
    expect([...row('colour').querySelectorAll('option')].map((node) => node.textContent)).toEqual(['None', 'Model', 'Grade']);
    expect(row('colour').querySelector('select').value).toBe('Grade');
    // what only the web page does says so on its title
    for (const key of ['search', 'sort', 'fold', 'column']) expect(row(key).title).toContain('Web page only');
    expect(row('header').title).toBe(SAID.header);
    expect(settings().classList.contains('cm-grid-look-set')).toBe(true);
    expect(settings().getAttribute('aria-label')).toBe('Settings, some set');
  });

  it('writes each choice as its own line under the last row, one step Undo takes back to the byte', () => {
    editor(NOTE);
    expect(settings().getAttribute('aria-label')).toBe('Settings');
    open();
    const steps = [
      [() => radio('search', 'Always').click(), '{search=always}'],
      [() => tick('sort', false), '{search=always sort=off}'],
      [() => radio('fold', '20').click(), '{search=always sort=off fold=20}'],
      [() => tick('header', false), '{search=always sort=off fold=20 header=scrolls}'],
      [() => tick('column', true), '{search=always sort=off fold=20 header=scrolls first-column=sticky}'],
      [() => tick('stripes', true), '{search=always sort=off fold=20 header=scrolls first-column=sticky stripes}'],
      [() => choose('colour', 'Grade'), '{search=always sort=off fold=20 header=scrolls first-column=sticky stripes colour="Grade"}'],
      [() => radio('density', 'Compact').click(),
        '{search=always sort=off fold=20 header=scrolls first-column=sticky stripes colour="Grade" density=compact}'],
      [() => typeIn('caption', 'Vehicles "lost" in October'),
        '{search=always sort=off fold=20 header=scrolls first-column=sticky stripes colour="Grade" density=compact caption="Vehicles lost in October"}'],
      [() => typeIn('source', 'Our register, 17 Nov 2026', 'change'),
        '{search=always sort=off fold=20 header=scrolls first-column=sticky stripes colour="Grade" density=compact caption="Vehicles lost in October" source="Our register, 17 Nov 2026"}'],
    ];
    const texts = [text()];
    for (const [act, line] of steps) {
      const depth = undoDepth(view.state);
      act();
      expect(text()).toBe(withLine(line));
      expect(undoDepth(view.state)).toBe(depth + 1);
      texts.push(text());
    }
    // the card says what the note holds after each
    expect(radio('density', 'Compact').getAttribute('aria-checked')).toBe('true');
    expect(box('column').checked).toBe(true);
    // the grid stands over the line: its rows are the table's, the line nowhere on the page
    expect(grid().querySelectorAll('.cm-grid-row')).toHaveLength(2);
    expect(view.contentDOM.textContent).not.toContain('{search');
    for (let at = texts.length - 2; at >= 0; at -= 1) {
      undo(view);
      expect(text()).toBe(texts[at]);
    }
    expect(text()).toBe(NOTE);
  });

  it('takes the line out once every choice is back to its default, and Reset does so in one step', () => {
    editor(withLine('{stripes}'));
    open();
    tick('stripes', false);
    expect(text()).toBe(NOTE);
    undo(view);
    expect(text()).toBe(withLine('{stripes}'));
    radio('search', 'Never').click();
    tick('sort', false);
    expect(text()).toBe(withLine('{search=never sort=off stripes}'));
    const depth = undoDepth(view.state);
    card().querySelector('.cm-table-look-reset').click();
    expect(text()).toBe(NOTE);
    expect(undoDepth(view.state)).toBe(depth + 1);
    expect(card().querySelector('.cm-table-look-reset').disabled).toBe(true);
    expect(settings().classList.contains('cm-grid-look-set')).toBe(false);
  });

  it('keeps what it does not read, and names a colour column the table no longer has', () => {
    editor(withLine('{colour="Price" kept=1}'));
    open();
    const options = [...row('colour').querySelectorAll('option')].map((node) => node.textContent);
    expect(options.at(-1)).toBe('Price (not in the table)');
    expect(row('colour').querySelector('select').value).toBe('Price');
    radio('density', 'Compact').click();
    expect(text()).toBe(withLine('{colour="Price" density=compact kept=1}'));
  });

  it('writes words typed when it closes on a press elsewhere, and forgets them on Escape', () => {
    editor(NOTE);
    open();
    const field = row('caption').querySelector('input');
    field.value = 'Kept';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
    expect(text()).toBe(withLine('{caption="Kept"}'));
    open();
    const again = row('caption').querySelector('input');
    expect(again.value).toBe('Kept');
    again.value = 'Dropped';
    again.dispatchEvent(new Event('input', { bubbles: true }));
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
    expect(text()).toBe(withLine('{caption="Kept"}'));
  });
});

describe('the table with its line', () => {
  it('adds a row above the line, and the raw Markdown shows the line as written', () => {
    editor(withLine('{stripes}'));
    grid().querySelector('.cm-grid-add-row').click();
    const field = view.dom.querySelector('.cm-grid-input');
    field.value = '3';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(text()).toMatch(/\| 2 \| Al-Wahsh \| almost sure \| 2 \|\n\| 3 \|[ |]*\n\{stripes\}\n\nWords after\.$/);
    setNoteMode(view, 'markdown');
    expect(view.contentDOM.textContent).toContain('{stripes}');
  });

  it('is deleted whole with its line from the bar’s ⋯', () => {
    editor(withLine('{stripes}'));
    grid().querySelector('.cm-grid-more').click();
    [...view.dom.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent.includes('Delete the table')).click();
    expect(text()).toBe('Words before.\n\nWords after.');
  });
});
