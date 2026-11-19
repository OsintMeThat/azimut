import { describe, expect, it, vi } from 'vitest';

import { STACKS, cardChanges, cardChoices } from './chartCard.js';
import { EXPORTS, chartKinds, drawChart, exportChart, forgetDrawings, pictureName, readChecks } from './chartFigure.js';
import {
  WRITTEN_LAST, WRITTEN_ORDER, anchorFor, compareRows, headingAbove, newChart, readChart, readOrigin, slug, tableUnder, withSettings, withTable,
} from './chartText.js';
import { parseTable } from './tableText.js';

/**
 * A chart block's text as the engine reads it (`engine/notes_charts.py`), written
 * back one line per choice, and where its rows came from as `engine/notecharts.py`
 * names a table.
 */

const TABLE = '| Model | Grade | At least |\n| --- | --- | ---: |\n| Streit Cougar | identified | 8 |\n| Al-Wahsh | almost sure | 2 |';
const BLOCK = ['::: chart', 'kind: stacked bars', 'title: Vehicles', 'colour: Grade', 'source: our register', TABLE, ':::'].join('\n');

describe('reading a chart block', () => {
  it('reads its settings by the word the Notebook writes, the first of each, and its table', () => {
    const chart = readChart(`${BLOCK.replace(':::\n', '')}`.replace('title: Vehicles', 'title: Vehicles\nTitle: Again\nwhat: else'));
    expect(chart.settings.kind.value).toBe('stacked bars');
    expect(chart.settings.title).toEqual({ value: 'Vehicles', line: 2 });
    expect(chart.settings['colour by'].value).toBe('Grade');
    expect(chart.settings.what).toBeUndefined();
    expect(chart.table.header).toEqual(['Model', 'Grade', 'At least']);
    expect(chart.text).toBe(TABLE);
  });

  it('writes the order the engine writes', () => {
    expect([...WRITTEN_ORDER, ...WRITTEN_LAST]).toEqual(['kind', 'title', 'caption', 'count', 'by', 'colour by', 'order', 'colours', 'only',
      'highlight', 'sort', 'last', 'show', 'bars', 'source', 'from', 'style']);
  });
});

describe('writing a chart block', () => {
  it('replaces a setting where it stands, takes an emptied one out, and puts a new one in the engine’s order', () => {
    expect(withSettings(BLOCK, { title: 'At least 10 vehicles' })).toBe(BLOCK.replace('title: Vehicles', 'title: At least 10 vehicles'));
    expect(withSettings(BLOCK, { 'colour by': '', kind: 'bars' })).toBe(BLOCK.replace('colour: Grade\n', '').replace('stacked bars', 'bars'));
    expect(withSettings(BLOCK, { by: 'Model', count: 'At least', style: 'book', show: 'chart and table' })).toBe([
      '::: chart', 'kind: stacked bars', 'title: Vehicles', 'count: At least', 'by: Model', 'colour: Grade', 'show: chart and table',
      'source: our register', 'style: book', TABLE, ':::',
    ].join('\n'));
    // a block with no settings takes them under its fence
    expect(withSettings(`::: chart\n${TABLE}\n:::`, { kind: 'pie', by: 'Grade' })).toBe(`::: chart\nkind: pie\nby: Grade\n${TABLE}\n:::`);
    expect(withSettings(BLOCK, { title: 'Vehicles' })).toBe(BLOCK);
  });

  it('replaces the rows and leaves the settings', () => {
    const rows = TABLE.replace('Al-Wahsh', 'Al Wahsh');
    expect(withTable(BLOCK, rows)).toBe(BLOCK.replace(TABLE, rows));
    expect(withTable('::: chart\nkind: bars\n:::', rows)).toBe(`::: chart\nkind: bars\n${rows}\n:::`);
  });

  it('writes a new chart in the engine’s order, the rows as they stand', () => {
    expect(newChart({ from: 'note:n1#count', by: 'Model', title: 'T', kind: 'bars', count: 'rows', caption: '' }, `${TABLE}\n`))
      .toBe(`::: chart\nkind: bars\ntitle: T\ncount: rows\nby: Model\nfrom: note:n1#count\n${TABLE}\n:::`);
  });
});

describe('where the rows came from', () => {
  const NOTE = ['# A', '', '| x |', '| --- |', '| 1 |', '', '::: chart', '| q |', '| --- |', '| 9 |', ':::', '', '## The Register',
    '', '```', '# not a heading', '| c |', '| --- |', '```', '', '| y | z |', '| --- | --- |', '| 1 | 2 |', '', '| w |', '| --- |', '| 3 |', ''].join('\n');

  it('names a table by the heading above it, the n-th with /n, a chart’s rows and code never counted', () => {
    expect(anchorFor(NOTE, 2)).toBe('a');
    expect(anchorFor(NOTE, 20)).toBe('the-register');
    expect(anchorFor(NOTE, 24)).toBe('the-register/2');
    for (const line of [2, 20, 24]) expect(tableUnder(NOTE, anchorFor(NOTE, line))).toBe(line);
    expect(tableUnder(NOTE, '')).toBe(2);
    expect(tableUnder(NOTE, '/3')).toBe(24);
    expect(tableUnder(NOTE, 'the-register/3')).toBe(-1);
    expect(tableUnder(NOTE, 'nowhere')).toBe(-1);
    expect(headingAbove(NOTE, 24)).toBe('The Register');
  });

  it('counts from the note’s start a table under no heading', () => {
    const plain = '| x |\n| --- |\n| 1 |\n\n| y |\n| --- |\n| 2 |\n';
    expect(anchorFor(plain, 0)).toBe('');
    expect(anchorFor(plain, 4)).toBe('/2');
  });

  it('slugs a heading as the HTML report does', () => {
    expect(slug('The **Register**, Ünïcode ß')).toBe('the-register-ünïcode-ss');
    expect(slug(`  ${'word '.repeat(20)}`)).toBe('word-'.repeat(12).slice(0, 59));
  });

  it('reads from: a note and its anchor, or a sheet', () => {
    expect(readOrigin('note:n1#register/2')).toEqual({ kind: 'note', id: 'n1', anchor: 'register/2' });
    expect(readOrigin('sheet:s9')).toEqual({ kind: 'sheet', id: 's9', anchor: '' });
    expect(readOrigin('layer:Vehicles')).toBeNull();
  });

  it('compares the rows on the chart’s own columns, in any order', () => {
    const chart = parseTable('| Model | Grade |\n| --- | --- |\n| A | x |\n| B | y |');
    expect(compareRows(chart, parseTable('| Grade | Model | Seen |\n| --- | --- | --- |\n| y | B | 1 |\n| x | **A** | 2 |'))).toBe('same');
    expect(compareRows(chart, parseTable('| Model | Grade |\n| --- | --- |\n| A | x |\n| B | x |'))).toBe('differs');
    expect(compareRows(chart, parseTable('| Model | Grade |\n| --- | --- |\n| A | x |'))).toBe('differs');
    expect(compareRows(chart, parseTable('| Other |\n| --- |\n| A |'))).toBe('columns');
  });
});

describe('the settings card’s choices', () => {
  it('offers rows or a column of numbers to count, and the columns of words to split and colour by', () => {
    const choices = cardChoices(parseTable(TABLE));
    expect(choices.count.map((option) => option.label)).toEqual(['Rows', 'At least']);
    expect(choices.by.map((option) => option.value)).toEqual(['Model', 'Grade']);
    expect(choices.colour.map((option) => option.value)).toEqual(['Model', 'Grade']);
  });

  it('stacks bars once they are coloured, plain again without, and writes no default show', () => {
    expect(cardChanges('colour by', 'Grade', { kind: { name: 'bars' } })).toEqual({ 'colour by': 'Grade', kind: STACKS.bars });
    expect(cardChanges('colour by', '', { kind: { name: 'stacked columns' } })).toEqual({ 'colour by': '', kind: 'columns' });
    expect(cardChanges('colour by', 'Grade', { kind: { name: 'stacked bars' } })).toEqual({ 'colour by': 'Grade' });
    expect(cardChanges('show', 'chart')).toEqual({ show: '' });
    expect(cardChanges('style', 'dark')).toEqual({ style: 'dark' });
  });
});

describe('what the route answers', () => {
  it('reads the checks, their lines in the block and their fixes', () => {
    const headers = new Headers({
      'X-Note-Warnings': JSON.stringify(['"T" counts at least: say so in its title.', 'A chart cites no source.']),
      'X-Note-Warning-Lines': JSON.stringify([1, null]),
      'X-Note-Warning-Kinds': JSON.stringify(['other', 'unsourced']),
      'X-Note-Warning-Fixes': JSON.stringify([[['title', 'At least 4']], []]),
    });
    expect(readChecks(headers)).toEqual([
      { message: '"T" counts at least: say so in its title.', line: 2, kind: 'other', fix: [['title', 'At least 4']] },
      { message: 'A chart cites no source.', line: null, kind: 'unsourced', fix: [] },
    ]);
    expect(readChecks(new Headers({ 'X-Note-Warnings': 'not json' }))).toEqual([]);
  });

  it('asks once for a drawing and a gallery, and again after a failure', async () => {
    forgetDrawings();
    const post = vi.fn(async () => ({ data: new TextEncoder().encode('<svg/>').buffer, headers: new Headers() }));
    const one = await drawChart({ caseId: 'c1', noteId: 'n1', text: BLOCK }, { post });
    await drawChart({ caseId: 'c1', noteId: 'n1', text: BLOCK }, { post });
    expect(one.svg).toBe('<svg/>');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/figure', { text: BLOCK, note: 'n1', origins: true });
    const failing = vi.fn(async () => { throw new Error('gone'); });
    expect(await chartKinds({ caseId: 'c1', text: TABLE }, { post: failing })).toEqual({ error: 'gone' });
    await chartKinds({ caseId: 'c1', text: TABLE }, { post: failing });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('names a picture by its title and where it goes, and asks the route for that size', async () => {
    expect(EXPORTS.map((destination) => [destination.id, destination.format, destination.size])).toEqual([
      ['x', 'png', 'x'], ['portrait', 'png', 'portrait'], ['square', 'png', 'square'], ['page', 'png', 'page'], ['svg', 'svg', 'page'],
    ]);
    expect(pictureName('At least 41: by "model"', EXPORTS[1])).toBe('At least 41 by model (4x5).png');
    expect(pictureName('', EXPORTS[4])).toBe('Chart.svg');
    const post = vi.fn(async () => ({ data: new Uint8Array([1]).buffer, headers: new Headers({ 'X-Chart-Title': '"Vehicles"' }) }));
    const save = vi.fn();
    expect(await exportChart({ caseId: 'c1', noteId: 'n1', text: BLOCK, destination: EXPORTS[2] }, { post, save })).toBe('Vehicles (1x1).png');
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/figure', { text: BLOCK, note: 'n1', format: 'png', size: 'square' });
    expect(save.mock.calls[0][0].type).toBe('image/png');
  });
});
