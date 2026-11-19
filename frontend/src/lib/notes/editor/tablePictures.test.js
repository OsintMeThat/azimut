// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

const { noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const {
  holdCell, isBlankCell, pickCell, pickedCell, pictureColumns, placeInCell, putInCell, readTime, rowVideo, timeLabel,
} = await import('./tablePictures.js');
const { parseTable } = await import('./tableText.js');
const { takeBackRange } = await import('./puts.js');

/**
 * A column of pictures in a table, one frame a row, and the way to cut a missing
 * one: a row names its video and its time, and a tool's picture lands in the cell
 * picked.
 */

const VIDEO = { id: 'v1', type: 'media', label: 'Ground tour', attrs: { path: 'media/tour.mp4', kind: 'video' } };
const DRONE = { id: 'v2', type: 'media', label: 'Drone', attrs: { path: 'media/drone.mp4', kind: 'video' } };
const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };
const INFO = { caseId: 'c1', byId: new Map([VIDEO, DRONE, ROOF].map((entity) => [entity.id, entity])), redirects: {} };

const WALL = [
  '| # | Model | [[entity:v1|Video 1]] | Video 2 | Frame |',
  '| --- | --- | --- | --- | --- |',
  '| 1 | Streit Cougar | S04 0:23-0:37 | – |  |',
  '| 2 | Al-Wahsh | – | [[entity:v2|Drone]] 1:44-2:02 | – |',
  '| 3 | BATT UMG | 4:18 | – | [[media:m1|Roof]] |',
  '| 4 | Unknown | – | – |  |',
].join('\n');

describe('reading a row', () => {
  it('reads the first time a cell writes, in seconds', () => {
    expect(readTime('S04 0:23-0:37')).toBe(23);
    expect(readTime('1:44-2:02 (D3); 2:12-2:22 (N6)')).toBe(104);
    expect(readTime('1:02:07')).toBe(3727);
    expect(readTime('6:20.5')).toBe(380.5);
    expect(readTime('~12.7590, 43.4950 (±450 m)')).toBeNull();
    expect(readTime('–')).toBeNull();
    expect(readTime('9:75')).toBeNull();
    expect(timeLabel(3727)).toBe('1:02:07');
    expect(timeLabel(23)).toBe('0:23');
  });

  it('takes a dash or nothing for an empty cell', () => {
    expect(isBlankCell('')).toBe(true);
    expect(isBlankCell(' – ')).toBe(true);
    expect(isBlankCell('[[media:m1|Roof]]')).toBe(false);
  });

  it('finds the picture columns by their name or by a picture they hold', () => {
    const table = parseTable(WALL);
    expect([...pictureColumns(table)]).toEqual([4]);
    expect([...pictureColumns(parseTable('| A | Notes |\n| --- | --- |\n| 1 | [[media:m1|Roof]] |'))]).toEqual([1]);
    expect([...pictureColumns(parseTable('| Close-up | Photos |\n| --- | --- |\n| A |  |'))]).toEqual([1]);
  });

  it('reads the video and the time a row names: a video cited in a cell, else in a column\'s header', () => {
    const table = parseTable(WALL);
    expect(rowVideo(table, 0, INFO)).toEqual({ entity: VIDEO, time: 23 });
    expect(rowVideo(table, 1, INFO)).toEqual({ entity: DRONE, time: 104 });
    expect(rowVideo(table, 2, INFO)).toEqual({ entity: VIDEO, time: 258 });
    expect(rowVideo(table, 3, INFO)).toBeNull();
    // a picture is no video
    expect(rowVideo(parseTable('| [[media:m1|Roof]] | t |\n| --- | --- |\n| 0:23 |  |'), 0, INFO)).toBeNull();
  });
});

describe('a picture put in a cell', () => {
  let view;
  afterEach(() => {
    view?.destroy();
    view = null;
    pickCell('c1:n1', null);
  });

  function editor(doc) {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers: { noteKey: 'c1:n1' } }) }) });
    view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [VIDEO, DRONE, ROOF] }) });
    view.focus = vi.fn();
    return view;
  }
  const NOTE = `Intro.\n\n${WALL}\n\nAfter.`;
  const text = () => view.state.doc.toString();

  it('lands in the picked cell, its size and caption left out, as one step', () => {
    editor(NOTE);
    const landed = putInCell(view, { table: 0, row: 0, col: 4 }, '[[media:f1|Frame 0:23 of Video 1]]{width=50% caption="Cougar"}');
    expect(text()).toContain('| 1 | Streit Cougar | S04 0:23-0:37 | – | [[media:f1|Frame 0:23 of Video 1]] |');
    expect(landed.text).toBe('[[media:f1|Frame 0:23 of Video 1]]');
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('takes the place of a dash, and goes after words', () => {
    editor(NOTE);
    putInCell(view, { table: 0, row: 1, col: 4 }, '[[media:f2|Frame]]');
    expect(text()).toContain('| 2 | Al-Wahsh | – | [[entity:v2|Drone]] 1:44-2:02 | [[media:f2|Frame]] |');
    putInCell(view, { table: 0, row: 2, col: 4 }, '[[media:f3|Frame]]');
    expect(text()).toContain('| [[media:m1|Roof]] [[media:f3|Frame]] |');
  });

  it('is taken back by the put\'s Undo while it is as it landed', () => {
    editor(NOTE);
    const landed = putInCell(view, { table: 0, row: 3, col: 4 }, '[[media:f4|Frame]]');
    expect(takeBackRange(view, landed)).toBe(true);
    expect(text()).toBe(NOTE);
  });

  it('answers nothing for a put that is no picture, or a cell that is gone', () => {
    editor(NOTE);
    expect(putInCell(view, { table: 0, row: 0, col: 4 }, '12.7, 43.4')).toBeNull();
    expect(putInCell(view, { table: 0, row: 9, col: 4 }, '[[media:f1|Frame]]')).toBeNull();
    expect(putInCell(view, { table: 3, row: 0, col: 0 }, '[[media:f1|Frame]]')).toBeNull();
    expect(text()).toBe(NOTE);
  });

  it('holds the picked cell for a tool\'s put, and lets the pick go once it landed', () => {
    editor(NOTE);
    expect(holdCell(view, 'c1:n1')).toBeNull();
    pickCell('c1:n1', { table: 0, row: 3, col: 4 });
    const spot = holdCell(view, 'c1:n1');
    // the note changes while the picture is made
    view.dispatch({ changes: { from: 0, insert: 'A first line.\n\n' } });
    const landed = placeInCell(view, spot, '[[media:f4|Frame]]{width=50%}', 'c1:n1');
    expect(landed.cell).toBe(true);
    expect(text()).toContain('| 4 | Unknown | – | – | [[media:f4|Frame]] |');
    expect(pickedCell('c1:n1')).toBeNull();
  });

  it('puts what is no picture under the table instead', () => {
    editor(NOTE);
    pickCell('c1:n1', { table: 0, row: 3, col: 4 });
    const spot = holdCell(view, 'c1:n1');
    placeInCell(view, spot, '> A quote', 'c1:n1');
    expect(text()).toContain('| 4 | Unknown | – | – |  |\n\n> A quote\n\nAfter.');
  });
});
