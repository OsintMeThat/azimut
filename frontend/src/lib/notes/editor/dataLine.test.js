import { describe, expect, it } from 'vitest';

import { ELSEWHERE, LOCAL, OWN, SHEET, anchorName, dataWords, sourceOf } from './dataLine.js';

/**
 * A figure's Data line says where its rows live in one line, the same on a chart, an
 * infographic and each of the builder's panels: its own rows, a sheet, or a table.
 */

describe('where the rows live', () => {
  it('reads from: against the note it stands in', () => {
    expect(sourceOf('', 'n1')).toEqual({ mode: OWN, id: '', anchor: '' });
    expect(sourceOf('sheet:e_s1', 'n1')).toEqual({ mode: SHEET, id: 'e_s1', anchor: '' });
    expect(sourceOf('note:n1#count', 'n1')).toEqual({ mode: LOCAL, id: 'n1', anchor: 'count' });
    expect(sourceOf('note:n2#count/2', 'n1')).toEqual({ mode: ELSEWHERE, id: 'n2', anchor: 'count/2' });
  });

  it('names a table by the heading its anchor finds', () => {
    expect(anchorName('the-register')).toBe('The register');
    expect(anchorName('count/2')).toBe('Count, 2');
    expect(anchorName('/3')).toBe('Table 3');
    expect(anchorName('')).toBe('');
  });
});

describe('the words of the line', () => {
  it('says its own rows, a sheet, a table of this note or of another, each with the press that edits them there', () => {
    expect(dataWords({ mode: OWN })).toEqual({ name: 'Its own rows', act: { id: 'edit', label: 'Edit', title: 'Type in its rows, under the chart' }, state: '' });
    expect(dataWords({ mode: SHEET, name: 'Vehicle register' })).toMatchObject({ name: 'Sheet “Vehicle register”', act: { id: 'sheet', label: 'Open in Sheet' } });
    expect(dataWords({ mode: LOCAL, name: 'Count' })).toMatchObject({ name: 'Table “Count” of this note', act: { id: 'table', label: 'Go to the table' } });
    expect(dataWords({ mode: ELSEWHERE, name: 'Count', note: 'Register' })).toMatchObject({ name: 'Table “Count” of the note “Register”', act: { id: 'table' } });
    expect(dataWords({ mode: LOCAL }).name).toBe('A table of this note');
  });

  it('says in one short clause a source without its columns, one gone, and a copy Undo kept', () => {
    expect(dataWords({ mode: SHEET, name: 'Register', state: 'columns' }).state).toBe('no longer has these columns: the chart keeps its copy');
    expect(dataWords({ mode: SHEET, state: 'gone' })).toEqual({ name: 'A sheet no longer in the case', act: null, state: 'the chart keeps its copy' });
    expect(dataWords({ mode: LOCAL, state: 'gone' }).name).toBe('A table no longer in this note');
    expect(dataWords({ mode: SHEET, name: 'Register', state: 'held' }).state).toBe('an older copy, kept by Undo');
    // nothing says Read again any more
    const all = [OWN, SHEET, LOCAL, ELSEWHERE].flatMap((mode) => ['', 'columns', 'gone', 'held'].map((state) => JSON.stringify(dataWords({ mode, state }))));
    expect(all.join(' ')).not.toMatch(/read again/i);
  });
});
