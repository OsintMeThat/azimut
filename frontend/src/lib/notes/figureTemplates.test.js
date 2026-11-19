/**
 * Figure templates in the browser (`figureTemplates.js`): what a template says it holds,
 * the figures a note offers to start one, the page's sketch, the columns step's rows and
 * answers, a column renamed in every line naming it, and a page started from a template
 * keeping the band it already said.
 *
 * Each ready template applied with no data (`tests/fixtures/figure_templates.json`, which
 * the engine's tests write and check) opens every chart panel in its own form: the panels a
 * page starts with when there is no data to read are the forms the analyst fills.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BY_HAND, COUNT_ROWS, blankText, columnChoice, columnRole, figureSaid, figuresIn, kindChoices, mapSaid, mappingOf, pageFromTemplate,
  renameColumn, sketchLayout, stepChoices, stepRows, templateColumns, templatePanels,
} from './figureTemplates.js';
import { readForm } from './editor/chartFormText.js';
import { readChart, setting } from './editor/chartText.js';
import { panelText, readInfographic } from './editor/infographicText.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../../../../tests/fixtures/figure_templates.json'), 'utf8'));

const STACKED = ['::: chart', 'kind: stacked columns', 'count: rows', 'by: Group', 'colour by: Grade', 'only: Grade is not Set aside',
  '| Grade | Group |', '| --- | --- |', ':::'].join('\n');
const PAGE = [':::: infographic', 'look: dark', 'widths: wide, half, half', '',
  '::: chart\nkind: key figures\n| Figure | What it says |\n| --- | --- |\n:::', '',
  STACKED, '', '::: map\nbase: dark\nnorth: on\n:::', '::::'].join('\n');

describe('the ready ones with no data', () => {
  it('open every chart panel in its own form', () => {
    expect(FIXTURE.ready.map((one) => one.id)).toEqual(['losses-at-a-glance', 'a-front-on-a-map', 'who-supplied-them']);
    for (const ready of FIXTURE.ready) {
      const read = readInfographic(ready.applied);
      read.panels.forEach((panel, index) => {
        if (panel.kind !== 'chart') return;
        const text = panelText(ready.applied, index);
        expect(setting(readChart(text), 'rows'), `${ready.id} panel ${index}`).toBe('own');
        const form = readForm(text);
        expect(form.form, `${ready.id} panel ${index}: ${form.why ?? ''}`).toBeTruthy();
        expect(form.model.rows).toEqual([]);
      });
    }
  });
});

describe('what a template says it holds', () => {
  it('names its panels, its look and the columns it reads, a key figures typed in', () => {
    expect(templatePanels(PAGE).map((panel) => [panel.kind, panel.chartKind, panel.width])).toEqual([
      ['chart', 'key figures', 'wide'], ['chart', 'stacked columns', 'half'], ['map', '', 'half']]);
    expect(templateColumns({ figure: 'infographic', text: PAGE })).toEqual(['Grade', 'Group']);
    expect(figureSaid({ figure: 'infographic', text: PAGE })).toBe('3 panels · Dark · reads Grade, Group');
    expect(figureSaid({ figure: 'infographic', text: blankText('infographic') })).toBe('No panel yet');
    expect(figureSaid({ figure: 'chart', text: STACKED })).toBe('Stacked columns · reads Grade, Group');
    expect(figureSaid({ figure: 'map', text: '::: map\nbase: dark\nnorth: on\nlegend: folded\n:::' })).toBe('Dark base · north arrow · legend folded');
    expect(mapSaid('::: map\n:::')).toBe('As a map starts');
  });

  it('starts blank as a page with no panel, a bars chart’s columns, a map as it starts', () => {
    expect(blankText('infographic')).toBe(':::: infographic\n::::');
    expect(readForm(blankText('chart')).form.family).toBe('categories');
    expect(blankText('map')).toBe('::: map\n:::');
  });
});

describe('the figures of a note', () => {
  it('are its pages, then its charts and maps outside a page, in the order written', () => {
    const note = ['# Losses', '', PAGE, '', '::: chart\nkind: donut\ntitle: By grade\n| Grade | N |\n| --- | --- |\n:::', '',
      '```', '::: chart', ':::', '```', '', '::: map\ntitle: The road\nlayer: Route\n:::'].join('\n');
    expect(figuresIn(note).map((one) => [one.figure, one.label])).toEqual([
      ['infographic', 'Infographic of 3 panels'], ['chart', 'By grade'], ['map', 'The road']]);
  });
});

describe('the sketch', () => {
  it('lays half panels in two columns and a wide one under both', () => {
    const { boxes, band } = sketchLayout(PAGE);
    expect(band).toBe(false);
    const [figures, stacked, map] = boxes;
    expect(figures).toMatchObject({ x: 0, y: 0, w: 1 });
    expect(stacked.y).toBeGreaterThan(figures.y + figures.h);
    expect(map.x).toBeGreaterThan(stacked.x);
    expect(map.y).toBe(stacked.y);
    expect(sketchLayout(':::: infographic\ntitle: Ours\n::::').band).toBe(true);
  });
});

describe('the columns step', () => {
  const ANSWER = {
    ask: true, columns: ['Model', 'Confidence grade', 'Made in'],
    needs: [
      { column: 'Model', match: 'Model', suggest: '', counts: false, required: true, uses: [{ panel: 1, kind: 'Bars', role: 'by' }] },
      { column: 'Grade', match: '', suggest: 'Confidence grade', counts: false, required: true,
        uses: [{ panel: 1, kind: 'Pictograms', role: 'parts' }, { panel: 3, kind: 'Segments', role: 'parts' }] },
      { column: 'Vehicles', match: '', suggest: '', counts: true, required: true, uses: [{ panel: 2, kind: 'Donut', role: 'count' }] },
      { column: 'Class', match: '', suggest: '', counts: false, required: false, uses: [{ panel: 1, kind: 'Bars', role: 'only' }] },
    ],
  };

  it('asks only what the data does not name, a suggestion picked and said', () => {
    const rows = stepRows(ANSWER);
    expect(rows.map((row) => [row.column, row.value])).toEqual([['Grade', columnChoice(1)], ['Vehicles', BY_HAND], ['Class', BY_HAND]]);
    expect(rows[0].said).toBe('Pictograms: its parts · Segments: its parts');
    expect(rows[1].said).toBe('Donut: what it counts');
  });

  it('offers the rows counted only where a column counts, and says what leaving one does', () => {
    const [grade, vehicles, only] = stepRows(ANSWER);
    expect(stepChoices(grade, ANSWER.columns).map((one) => one.label)).toEqual(['Model', 'Confidence grade', 'Made in', 'Fill it by hand']);
    expect(stepChoices(vehicles, ANSWER.columns).map((one) => one.label)).toContain('Count the rows');
    expect(stepChoices(only, ANSWER.columns).at(-1).label).toBe('Leave it out');
  });

  it('answers the server: the columns given, the rows counted, the rest by hand', () => {
    const rows = stepRows(ANSWER);
    rows[1].value = COUNT_ROWS;
    expect(mappingOf(rows, ANSWER.columns)).toEqual({ mapping: { Grade: 'Confidence grade', Vehicles: '', Class: '' }, rows: ['Vehicles'] });
  });
});

describe('a template edited in Settings', () => {
  it('renames a column in its header and every line naming it', () => {
    const next = renameColumn(STACKED, 'Grade', 'Confidence');
    expect(next).toContain('colour by: Confidence');
    expect(next).toContain('only: Confidence is not Set aside');
    expect(next).toContain('| Confidence | Group |');
    expect(next).toContain('by: Group');
    // an empty name, or another column's, changes nothing
    expect(renameColumn(STACKED, 'Grade', '  ')).toBe(STACKED);
    expect(renameColumn(STACKED, 'Grade', 'group')).toBe(STACKED);
  });

  it('says what each column does', () => {
    expect(columnRole(STACKED, 'Grade')).toBe('colour by');
    expect(columnRole(STACKED, 'Group')).toBe('by');
    const donut = '::: chart\nkind: donut\ncount: Vehicles\nby: Made in\n| Made in | Vehicles |\n| --- | --- |\n:::';
    expect(columnRole(donut, 'Made in')).toBe('parts');
    expect(columnRole(donut, 'Vehicles')).toBe('count');
    const timeline = '::: chart\nkind: timeline\nby: What\n| Day | What | Until |\n| --- | --- | --- |\n:::';
    expect(['Day', 'What', 'Until'].map((column) => columnRole(timeline, column))).toEqual(['when', 'what', 'until']);
  });

  it('turns a chart only into a kind of the same table', () => {
    expect(kindChoices('donut')).toContain('stacked bars');
    expect(kindChoices('timeline')).toEqual(['timeline']);
  });
});

describe('a page started from a template', () => {
  it('keeps the band the page already said where the template says none, and its data', () => {
    const page = ':::: infographic\ndata: sheet:s1\ntitle: At least 4 lost\n::::';
    const made = ':::: infographic\nlook: dark\n\n::: map\n:::\n::::';
    const next = pageFromTemplate(page, made);
    const read = readInfographic(next);
    expect(read.settings.title.value).toBe('At least 4 lost');
    expect(read.settings.data.value).toBe('sheet:s1');
    expect(read.settings.look.value).toBe('dark');
    expect(read.panels).toHaveLength(1);
    // the template's own band wins over nothing, and an empty answer leaves the page
    expect(readInfographic(pageFromTemplate(':::: infographic\n::::', ':::: infographic\ntitle: Ours\n::::')).settings.title.value).toBe('Ours');
    expect(pageFromTemplate(page, '')).toBe(page);
  });
});
