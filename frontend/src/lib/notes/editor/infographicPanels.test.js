import { describe, expect, it, vi } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';

vi.mock('../../api.js', () => ({ api: { post: vi.fn(() => new Promise(() => {})), postBytes: vi.fn(() => new Promise(() => {})) } }));

import { chartPanel, noteMaps, noteTables, pickStarter, starterFor, starterText } from './infographicPanels.js';
import { EMPTY_INFOGRAPHIC, infographicsIn, panelText, readInfographic, withPanelText } from './infographicText.js';
import { readChart, setting, withSettings } from './chartText.js';
import { replaceBlock } from './infographicBlock.js';

/**
 * What an infographic's panels are made from (`infographicPanels.js`): the note's own
 * tables, drawn by the chart's kind picker and written as a chart under its table would be,
 * and a chart panel's settings written inside the page, one Undo each.
 */

const MAKERS = ['| Made in | Vehicles |', '| --- | ---: |', '| UAE | 22 |', '| USA | 9 |'].join('\n');
const FIGURES = ['| Figure | Words |', '| --- | --- |', '| 51 of 54 | placed |'].join('\n');
const CHART = ['::: chart', 'kind: bars', '| Inside | N |', '| --- | ---: |', '| a | 1 |', ':::'].join('\n');
const MAP = ['::: map', 'title: Where they lie', 'layer: Vehicles', ':::'].join('\n');
const NOTE = ['# Losses', '', '## Makers', '', MAKERS, '', '## Figures', '', FIGURES, '', CHART, '', MAP, '', '```', MAKERS, '```', ''].join('\n');

/** The kind picker's answer for a table, as `POST /notes/figure/kinds` gives it. */
const kindsFor = (text) => ({
  rows: 2,
  kinds: text.includes('Figure') ? [{ kind: 'key figures', label: 'Key figures', settings: { kind: 'key figures' }, title: '', svg: '<svg/>' }]
    : [
      { kind: 'bars', label: 'Bars', settings: { kind: 'bars', count: 'Vehicles', by: 'Made in' }, title: 'At least 31 vehicles, by maker', svg: '<svg/>' },
      { kind: 'donut', label: 'Donut', settings: { kind: 'donut', count: 'Vehicles', by: 'Made in' }, title: 'At least 31 vehicles', svg: '<svg/>' },
    ],
});

describe('the note’s tables and maps', () => {
  it('finds the tables standing on their own, under their heading, never a chart’s rows or code', () => {
    const tables = noteTables(NOTE);
    expect(tables.map((found) => [found.heading, found.table.rows.length])).toEqual([['Makers', 2], ['Figures', 1]]);
    expect(NOTE.slice(tables[0].from, tables[0].to)).toBe(MAKERS);
  });

  it('leaves out what an infographic already holds', () => {
    const inside = `${NOTE}\n:::: infographic\n\n${MAKERS}\n\n${MAP}\n::::\n`;
    expect(noteTables(inside)).toHaveLength(2);
    expect(noteMaps(inside)).toEqual([{ title: 'Where they lie', block: MAP }]);
  });
});

describe('a chart panel', () => {
  it('is written as a chart under its table would be: its kind, title, columns, rows and where they came from', () => {
    const [found] = noteTables(NOTE);
    const made = chartPanel(NOTE, found, kindsFor(MAKERS).kinds[1], 'n1');
    const chart = readChart(made);
    expect(setting(chart, 'kind')).toBe('donut');
    expect(setting(chart, 'title')).toBe('At least 31 vehicles');
    expect(setting(chart, 'from')).toBe('note:n1#makers');
    expect(made.endsWith(`${MAKERS}\n:::`)).toBe(true);
  });

  it('takes its settings from the chart’s card inside the page, one Undo a choice', () => {
    const [found] = noteTables(NOTE);
    const block = `:::: infographic\n\n${chartPanel(NOTE, found, kindsFor(MAKERS).kinds[0], 'n1')}\n::::`;
    const note = `${NOTE}\n${block}\n`;
    let state = EditorState.create({ doc: note, extensions: [history()] });
    const view = { get state() { return state; }, dispatch(input) { state = (input instanceof Transaction ? input : state.update(input)).state; } };
    const [page] = infographicsIn(note);
    const written = withPanelText(page.source, 0, withSettings(panelText(page.source, 0), { title: 'Who made them', 'colour by': '' }));
    expect(replaceBlock(view, page.from, page.to, written, page.source)).toBe(true);
    expect(undoDepth(view.state)).toBe(1);
    const panel = readChart(panelText(infographicsIn(view.state.doc.toString())[0].source, 0));
    expect(setting(panel, 'title')).toBe('Who made them');
    expect(readInfographic(written).panels).toHaveLength(1);
    // only the title's line changed, inside the page
    expect(view.state.doc.toString()).toBe(note.replace('title: At least 31 vehicles, by maker', 'title: Who made them'));
    undo(view);
    expect(view.state.doc.toString()).toBe(note);
  });
});

describe('the starter', () => {
  it('picks the key figures, the main chart and a chart of the parts, never one table drawn twice the same way', () => {
    const galleries = noteTables(NOTE).map((found) => ({ found, kinds: kindsFor(NOTE.slice(found.from, found.to)).kinds }));
    expect(pickStarter(galleries).map(({ kind }) => kind.kind)).toEqual(['key figures', 'bars', 'donut']);
  });

  it('is made of the note’s own tables and its map, each width written', async () => {
    const asked = [];
    const text = await starterFor({ caseId: 'c1', noteId: 'n1', text: NOTE }, { ask: async (request) => { asked.push(request); return kindsFor(request.text); } });
    expect(asked.map((request) => request.text)).toEqual([MAKERS, FIGURES]);
    const read = readInfographic(text);
    expect(read.panels.map((panel) => panel.chartKind || panel.kind)).toEqual(['key figures', 'bars', 'donut', 'map']);
    expect(read.settings.widths.value).toBe('wide, half, half, wide');
    // every row of every chart is a row of the note
    for (const panel of read.panels.filter((one) => one.kind === 'chart')) {
      for (const row of readChart(panelText(text, read.panels.indexOf(panel))).table.rows) expect(NOTE).toContain(`| ${row.join(' | ')} |`);
    }
  });

  it('is the empty page, saying how to fill it, when the note holds no table and no map', async () => {
    const ask = vi.fn();
    expect(await starterFor({ caseId: 'c1', text: '# Notes\n\nJust words.\n' }, { ask })).toBe(EMPTY_INFOGRAPHIC);
    expect(ask).not.toHaveBeenCalled();
    expect(starterText([])).toBe(EMPTY_INFOGRAPHIC);
  });

  it('makes a lone half panel at the end wide', () => {
    expect(starterText([{ text: '### A', wide: true }, { text: MAP, wide: false }])).toContain('widths: wide, wide');
  });
});
