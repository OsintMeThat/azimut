import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OWN_ROWS, readChart, withSettings } from './chartText.js';
import { inherits } from './infographicText.js';
import {
  FORMS, SCRATCH_KINDS, TIMELINE_LAYOUTS, atPrecision, baseHeading, caseDay, countedRows, eventRows, formKind, hasRows, layoutSaid, leftOutSaid,
  pictureCell, pictureRef, pictureRows, readColours, readFloor, readForm, readWhen, starterBlock, timelineColumns, timelineLayout,
  wallPictureColumn, writeColours, writeForm, writeWhen,
} from './chartFormText.js';

/**
 * A chart's form as text: the block each kind's form writes, byte for byte, and read back
 * into the same form (`tests/fixtures/chart_forms.json`, which the engine's tests draw too);
 * a day at the day, the month or the year; what Fill from the case writes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../../../../../tests/fixtures/chart_forms.json'), 'utf8'));
const empty = (kind) => `::: chart\nkind: ${kind}\n:::`;

describe('what each form writes', () => {
  it.each(FIXTURE.forms.map((form) => [form.name, form]))('%s', (_, form) => {
    expect(writeForm(empty(form.kind), form.kind, form.model)).toBe(form.block);
    const read = readForm(form.block);
    expect(read.kind).toBe(form.kind);
    expect(read.model).toEqual(form.model);
    // written again unchanged, nothing moves
    expect(writeForm(form.block, form.kind, read.model)).toBe(form.block);
  });

  it('starts every kind with its columns and no row', () => {
    expect(Object.keys(FIXTURE.starters)).toEqual(SCRATCH_KINDS);
    for (const kind of SCRATCH_KINDS) {
      expect(starterBlock(kind)).toBe(FIXTURE.starters[kind]);
      expect(hasRows(starterBlock(kind))).toBe(false);
      expect(readForm(starterBlock(kind)).model.rows).toEqual([]);
    }
  });

  it('keeps the lines it does not own, and the cells nobody changed', () => {
    const block = '::: chart\nkind: timeline\ntitle: The fall of the front\nsource: our register\nfrom: note:n1#events\n| When | What happened |\n| --- | --- |\n| 18 Oct 2026 | [[entity:e_1|Proof 17]] seen |\n:::';
    const read = readForm(block);
    expect(read.model.rows[0].what).toBe('[[entity:e_1|Proof 17]] seen');
    const next = writeForm(block, 'timeline', { ...read.model, rows: [...read.model.rows, { when: '20 Oct 2026', what: 'Later', until: '' }] });
    expect(next).toBe(block.replace('seen |\n:::', 'seen |\n| 20 Oct 2026 | Later |\n:::'));
  });

  it('writes a period’s column only once a row is one', () => {
    const model = { heads: { when: 'When', what: 'What happened', until: 'Until' }, rows: [{ when: '2026', what: 'A year', until: '' }] };
    expect(writeForm(empty('timeline'), 'timeline', model)).toBe('::: chart\nkind: timeline\n| When | What happened |\n| --- | --- |\n| 2026 | A year |\n:::');
  });

  it('renames the columns it reads by, and takes a colour or an icon out with its category', () => {
    const donut = FIXTURE.forms.find((form) => form.kind === 'donut');
    const read = readForm(donut.block);
    const renamed = writeForm(donut.block, 'donut', { ...read.model, heads: { ...read.model.heads, category: 'Type' }, rows: read.model.rows.filter((row) => row.category !== 'Tank') });
    expect(renamed).toContain('by: Type\n');
    expect(renamed).toContain('| Type | Vehicles (at least) |');
    expect(renamed).not.toContain('colours:');
    const plain = writeForm(donut.block, 'donut', { ...read.model, floor: false });
    expect(plain).toContain('count: Vehicles\n');
    expect(plain).toContain('| Class | Vehicles |');
  });

  it('reads a floor in the counts’ heading or a cell, and a whole as a number', () => {
    const block = '::: chart\nkind: waffle\nof: 60\n| Part | Count |\n| --- | ---: |\n| Destroyed | ≥ 14 |\n:::';
    const { model } = readForm(block);
    expect(model.floor).toBe(true);
    expect(model.rows[0].count).toBe('14');
    expect(model.whole).toEqual({ name: '', amount: '60' });
    expect(writeForm(block, 'waffle', model)).toBe('::: chart\nkind: waffle\ncount: Count (at least)\nby: Part\nof: 60\n| Part | Count (at least) |\n| --- | ---: |\n| Destroyed | 14 |\n:::');
  });

  it('opens no form on a table it cannot hold, and says why', () => {
    const register = '::: chart\nkind: bars\ncount: rows\nby: Model\n| Model | Grade |\n| --- | --- |\n| A | identified |\n| B | almost sure |\n:::';
    expect(readForm(register).form).toBeNull();
    expect(readForm(register).why).toBe('Its rows are counted, one a line: edit them as a table.');
    const wide = '::: chart\nkind: timeline\n| When | What | Where | Who |\n| --- | --- | --- | --- |\n| 1 Oct 2026 | A | B | C |\n| 2 Oct 2026 | A | B | C |\n:::';
    expect(readForm(wide).why).toBe('Its table holds more columns than this kind reads: edit it as a table.');
    expect(readForm('::: chart\nkind: radar\n| A | B |\n| --- | --- |\n:::').form).toBeNull();
  });

  it('reads the kind however the block writes it', () => {
    expect(formKind('Doughnut')).toBe('donut');
    expect(formKind('stacked')).toBe('stacked bars');
    expect(formKind('')).toBe('bars');
    expect(formKind('radar')).toBe('');
    expect(Object.values(FORMS).every((form) => form.needs && form.label)).toBe(true);
  });
});

describe('in an infographic with data', () => {
  it('keeps the rows a form wrote, marked as its own, out of the page’s data', () => {
    const own = withSettings(starterBlock('donut'), { rows: OWN_ROWS });
    expect(own).toBe('::: chart\nkind: donut\ncount: Count\nby: Category\nrows: own\n| Category | Count |\n| --- | ---: |\n:::');
    // the form writes over it, the mark kept
    const filled = writeForm(own, 'donut', { ...readForm(own).model, rows: [{ category: 'MRAP', split: '', count: '23' }] });
    expect(filled).toContain('rows: own\n| Category | Count |\n| --- | ---: |\n| MRAP | 23 |');
    const page = `:::: infographic\ndata: sheet:e_s1\n\n${filled}\n\n${starterBlock('donut')}\n::::`;
    expect([0, 1].map((index) => inherits(page, index, ['Category', 'Count']))).toEqual([false, true]);
  });
});

describe('days', () => {
  it('reads a day, a month or a year, and words it cannot', () => {
    expect(readWhen('5 Oct 2026')).toEqual({ precision: 'day', year: 2026, month: 10, day: 5 });
    expect(readWhen('2026-10-05')).toEqual({ precision: 'day', year: 2026, month: 10, day: 5 });
    expect(readWhen('Oct 5, 2026')).toEqual({ precision: 'day', year: 2026, month: 10, day: 5 });
    expect(readWhen('October 2026')).toEqual({ precision: 'month', year: 2026, month: 10, day: 0 });
    expect(readWhen('2026')).toEqual({ precision: 'year', year: 2026, month: 0, day: 0 });
    expect(readWhen('31 Feb 2026')).toEqual({ precision: 'text', text: '31 Feb 2026' });
    expect(readWhen('early October')).toEqual({ precision: 'text', text: 'early October' });
    expect(readWhen('').empty).toBe(true);
  });

  it('writes a day as the chart prints it, and nothing while it is not whole', () => {
    expect(writeWhen({ precision: 'day', year: 2026, month: 10, day: 5 })).toBe('5 Oct 2026');
    expect(writeWhen({ precision: 'month', year: 2026, month: 10 })).toBe('Oct 2026');
    expect(writeWhen({ precision: 'year', year: 2026 })).toBe('2026');
    expect(writeWhen({ precision: 'month', year: 2026, month: 0 })).toBe('');
    expect(writeWhen({ precision: 'year', year: 26 })).toBe('');
    expect(writeWhen(atPrecision(readWhen('5 Oct 2026'), 'month'))).toBe('Oct 2026');
    expect(writeWhen(atPrecision(readWhen('Oct 2026'), 'day'))).toBe('');
  });
});

describe('the small readers', () => {
  it('reads floors, headings and colours', () => {
    expect(readFloor('at least 60')).toEqual({ text: '60', floor: true });
    expect(readFloor('41+')).toEqual({ text: '41', floor: true });
    expect(readFloor('12')).toEqual({ text: '12', floor: false });
    expect(baseHeading('Vehicles (at least)', 'Count')).toBe('Vehicles');
    expect(baseHeading('At least', 'Count')).toBe('Count');
    expect(readColours('Tank #E34948, UAE #eb6834, wrong')).toEqual([['Tank', '#e34948'], ['UAE', '#eb6834']]);
    expect(writeColours([['Tank', '#e34948'], ['A, B', '#000000']])).toBe('Tank #e34948');
  });
});

describe('Fill from the case', () => {
  const EVENTS = [
    { id: 'p1', type: 'proof', day: '2026-10-18', last: '', precision: 'day', approximate: true, what: 'Giants Brigades on a peak', refuted: false },
    { id: 'p2', type: 'proof', day: '2026-11-10', last: '2026-11-14', precision: 'day', approximate: false, what: 'Presence near Huwayrib', refuted: false },
    { id: 'c1', type: 'claim', day: '2026-11-01', last: '2026-11-30', precision: 'month', approximate: false, what: 'A strike on the port', refuted: true },
    { id: 'p3', type: 'proof', day: '2026-11-13', last: '', precision: 'day', approximate: false, what: 'Recaptured Al-Subayhah', refuted: false },
    { id: 'p4', type: 'proof', day: '2026-11-13', last: '', precision: 'day', approximate: false, what: 'Recaptured Al-Subayhah', refuted: false },
  ];

  it('proposes each event as a timeline row, ticking only what is new, true and said once', () => {
    const held = [{ when: '18 Oct 2026', what: 'Giants Brigades on a peak', until: '' }];
    const proposed = eventRows(EVENTS, held);
    expect(proposed.map((one) => one.row)).toEqual([
      { when: '18 Oct 2026', until: '', what: 'Giants Brigades on a peak' },
      { when: '10 Nov 2026', until: '14 Nov 2026', what: 'Presence near Huwayrib' },
      { when: 'Nov 2026', until: '', what: 'A strike on the port' },
      { when: '13 Nov 2026', until: '', what: 'Recaptured Al-Subayhah' },
      { when: '13 Nov 2026', until: '', what: 'Recaptured Al-Subayhah' },
    ]);
    expect(proposed.map((one) => [one.ticked, one.said])).toEqual([
      [false, 'already in the chart'], [true, ''], [false, 'refuted'], [true, ''], [false, 'the same as the one above'],
    ]);
    expect(caseDay('2026-10-05', 'year')).toBe('2026');
  });

  it('writes counts as categories, figures or a line’s series, and says what was left out', () => {
    const answer = { rows: [{ value: 'MRAP', split: 'Identified', count: '8' }, { value: 'MRAP', split: 'Almost sure', count: '2' }, { value: 'APC', split: 'Identified', count: '3' }], floor: true, blank: 2, unread: 0, totals: 1 };
    expect(countedRows(answer, 'categories', { split: true })).toEqual([
      { category: 'MRAP', split: 'Identified', count: '8' }, { category: 'MRAP', split: 'Almost sure', count: '2' }, { category: 'APC', split: 'Identified', count: '3' }]);
    expect(countedRows(answer, 'figures')[0]).toEqual({ figure: '8', words: 'MRAP', floor: true });
    expect(countedRows(answer, 'line')).toEqual({ series: ['Identified', 'Almost sure'], rows: [{ x: 'MRAP', values: ['8', '2'] }, { x: 'APC', values: ['3', ''] }] });
    expect(leftOutSaid(answer)).toBe('Left out: 2 with no value, 1 total row.');
    expect(leftOutSaid({})).toBe('');
  });
});

describe('a picture wall', () => {
  it('reads a picture by its chip or its id, as the engine does', () => {
    expect(pictureRef('[[media:e_13b435e301|Vehicles one by one.jpg]]')).toBe('e_13b435e301');
    expect(pictureRef('[[entity:e_13b435e301|Proof 17]]')).toBe('e_13b435e301');
    expect(pictureRef(' e_13b435e301 ')).toBe('e_13b435e301');
    expect(pictureRef('#7')).toBe('');
    expect(pictureCell({ id: 'e_1', label: 'a [b] | c.jpg' })).toBe('[[media:e_1|a b  c.jpg]]');
    expect(formKind('gallery')).toBe('pictures');
    expect(formKind('Picture wall')).toBe('pictures');
  });

  it('finds its column of pictures, and reads a wall written by hand with its words left', () => {
    expect(wallPictureColumn(['#', 'Frame'], [['#1', 'e_0000000001'], ['#2', '[[media:e_0000000002|b]]']])).toBe(1);
    expect(wallPictureColumn(['Picture', '#'], [])).toBe(0);
    const block = '::: chart\nkind: picture wall\nby: Model\ncolour by: Grade\n| Frame | # | State | Model | Grade |\n| --- | --- | --- | --- | --- |\n'
      + '| [[media:e_0000000001|v1.jpg]] | #1 | burned | Cougar | Confirmed |\n:::';
    const read = readForm(block);
    expect(read.kind).toBe('pictures');
    expect(read.model.heads).toEqual({ picture: 'Frame', label: '#', words: 'State', group: 'Model', colour: 'Grade' });
    expect(read.model.rows).toEqual([{ picture: '[[media:e_0000000001|v1.jpg]]', label: '#1', words: 'burned', group: 'Cougar', colour: 'Confirmed' }]);
    // a column past what the wall reads is edited as a table
    expect(readForm(block.replace('| Frame |', '| Frame | Video |').replace('| --- |', '| --- | --- |').replace('| [[media', '| v1 | [[media')).form).toBe(null);
  });

  it('writes the group and the colour only once a row holds one, and the shape past the first', () => {
    const empty = '::: chart\nkind: pictures\n:::';
    const model = { heads: { picture: 'Picture', label: '#', words: 'Words', group: 'Group', colour: 'Grade' }, rows: [
      { picture: 'e_0000000001', label: '#1', words: '', group: '', colour: '' }], shape: '3:2' };
    expect(writeForm(empty, 'pictures', model)).toBe('::: chart\nkind: pictures\npicture: Picture\nlabel: #\n| Picture | # |\n| --- | --- |\n| e_0000000001 | #1 |\n:::');
    const grouped = writeForm(empty, 'pictures', { ...model, shape: '1:1', rows: [{ ...model.rows[0], group: 'Cougar' }] });
    expect(grouped).toContain('by: Group\n');
    expect(grouped).toContain('shape: 1:1\n');
    expect(grouped).toContain('| e_0000000001 | #1 | Cougar |');
  });

  it('adds the pictures picked from the case a row each, labelled by the number in their name', () => {
    const entities = [{ id: 'e_1', label: 'vehicle-07.jpg' }, { id: 'e_2', label: 'Harbour at dawn.png' }, { id: 'e_3', label: 'held.jpg' }];
    expect(pictureRows(entities, [{ picture: '[[media:e_3|held.jpg]]' }])).toEqual([
      { picture: '[[media:e_1|vehicle-07.jpg]]', label: '#7', words: '', group: '', colour: '' },
      { picture: '[[media:e_2|Harbour at dawn.png]]', label: 'Harbour at dawn', words: '', group: '', colour: '' },
    ]);
  });
});

describe('a timeline’s kinds, layout and labels', () => {
  const BLOCK = ['::: chart', 'kind: timeline', 'colour by: Kind', 'layout: numbered', 'labels: short', '| Day | What | Kind |', '| --- | --- | --- |',
    '| 9 Oct 2026 | The strait announced cleared | Claim |', '| 19 Oct 2026 | Footage on the north edge | Geolocated |', ':::'].join('\n');

  it('reads the column its events are coloured by, its layout and its short labels', () => {
    const { model } = readForm(BLOCK);
    expect(model.heads).toEqual({ when: 'Day', what: 'What', until: 'Until', colour: 'Kind' });
    expect(model.rows[0]).toEqual({ when: '9 Oct 2026', what: 'The strait announced cleared', until: '', colour: 'Claim' });
    expect(model.layout).toBe('numbered');
    expect(model.short).toBe(true);
    // a layout it does not know reads as Auto; a column no setting names is still more than it reads
    expect(readForm(BLOCK.replace('layout: numbered', 'layout: diagonal')).model.layout).toBe('auto');
    expect(readForm(BLOCK.replace('colour by: Kind\n', '')).form).toBe(null);
  });

  it('writes the kinds’ column and its line only once an event has one, and Auto and full labels as no line', () => {
    const { model } = readForm(BLOCK);
    expect(writeForm(BLOCK, 'timeline', model)).toBe(BLOCK);
    const plain = writeForm(BLOCK, 'timeline', { ...model, layout: 'auto', short: false, rows: model.rows.map((row) => ({ ...row, colour: '' })) });
    expect(plain).toBe(['::: chart', 'kind: timeline', '| Day | What |', '| --- | --- |', '| 9 Oct 2026 | The strait announced cleared |',
      '| 19 Oct 2026 | Footage on the north edge |', ':::'].join('\n'));
    const started = readForm(starterBlock('timeline')).model;
    const one = writeForm(starterBlock('timeline'), 'timeline', { ...started, layout: 'list', rows: [{ when: '5 Oct 2026', what: 'Offensive opens', until: '', colour: 'Claim' }] });
    expect(one).toBe(['::: chart', 'kind: timeline', 'colour by: Kind', 'layout: list', '| When | What happened | Kind |', '| --- | --- | --- |',
      '| 5 Oct 2026 | Offensive opens | Claim |', ':::'].join('\n'));
  });

  it('offers to colour by the columns that are neither its days nor its words, and says the layout drawn', () => {
    const table = readChart(BLOCK).table;
    expect(timelineColumns(table, readChart(BLOCK))).toEqual({ when: 'Day', what: 'What', until: '', colours: ['Kind'] });
    expect(timelineColumns(table, readChart(BLOCK.replace('colour by: Kind\n', ''))).colours).toEqual(['Kind']);
    expect(timelineLayout(readChart(BLOCK))).toBe('numbered');
    expect(layoutSaid('auto', 'numbered')).toBe('Drawn numbered here');
    expect(layoutSaid('across', 'numbered')).toBe('Too crowded across: drawn numbered');
    expect(layoutSaid('list', 'list')).toBe('');
    expect(layoutSaid('auto', undefined)).toBe('');
    expect(TIMELINE_LAYOUTS.map((one) => one.value)).toEqual(['auto', 'across', 'numbered', 'list']);
  });
});
