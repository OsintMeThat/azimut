// @vitest-environment happy-dom
/**
 * The template picker, mounted: the analyst's templates of one figure, then the ready ones
 * for a page; one picked is applied by the server, which writes nothing, and a column the
 * data does not name is asked in *Match the columns*, a page's map panels too when its note
 * holds maps. What it hands up is the server's answer, maps put in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: Picker } = await import('./FigureTemplatePicker.svelte');
const { templatesState } = await import('../lib/state.svelte.js');

const OURS = { id: 'fg_1', name: 'Losses, our way', data: { figure: 'infographic', text: ':::: infographic\n\n::: chart\nkind: donut\ncount: rows\nby: Grade\n| Grade |\n| --- |\n:::\n\n::: map\nnorth: on\n:::\n::::' } };
const CHART = { id: 'fg_2', name: 'Grades donut', data: { figure: 'chart', text: '::: chart\nkind: donut\ncount: rows\nby: Grade\n| Grade |\n| --- |\n:::' } };
const READY = [{ id: 'who-supplied-them', name: 'Who supplied them', about: 'Silhouette rows with their flags, and a donut', data: { figure: 'infographic', text: ':::: infographic\n::::' } }];
const DATA = { table: '| Model | Confidence |\n| --- | --- |\n| A | Confirmed |', origin: 'sheet:s1', name: 'Sheet “Register”' };
const ASKED = {
  ask: true, columns: ['Model', 'Confidence'],
  needs: [{ column: 'Grade', match: '', suggest: 'Confidence', counts: false, required: true, uses: [{ panel: 0, kind: 'Donut', role: 'parts' }] }],
};
const PAGE = ':::: infographic\ndata: sheet:s1\n\n::: chart\nkind: donut\ncount: rows\nby: Confidence\n| Model | Confidence |\n| --- | --- |\n| A | Confirmed |\n:::\n\n::: map\nnorth: on\n:::\n::::';

let target;
let app;
let props;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); };
const panel = () => document.querySelector('.float-menu');
const items = () => [...panel().querySelectorAll('.fm-item')];
const item = (text) => items().find((node) => node.textContent.includes(text));

async function open(extra = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const anchor = document.createElement('button');
  document.body.append(anchor);
  props = { anchor, figure: 'infographic', data: null, maps: [], onapply: vi.fn(), onclose: vi.fn(), apply: vi.fn(), ready: vi.fn(async () => READY), ...extra };
  app = mount(Picker, { target, props });
  await settle();
}

beforeEach(() => { templatesState.figure = [OURS, CHART]; });
afterEach(() => {
  if (app) unmount(app);
  app = null;
  target?.remove();
  document.querySelectorAll('.float-menu, button').forEach((node) => node.remove());
  templatesState.figure = [];
});

describe('the list', () => {
  it('shows a page’s templates, yours then the ready ones, and says what it meets', async () => {
    await open({ data: DATA });
    expect([...panel().querySelectorAll('.fm-head')].map((head) => head.textContent)).toEqual(['Start from a template', 'Yours', 'Ready']);
    expect(items().map((node) => node.querySelector('.fm-grow').textContent)).toEqual(['Losses, our way', 'Who supplied them']);
    expect(panel().textContent).toContain('With Sheet “Register”: its panels read its columns by name');
  });

  it('says how to start without data, and where a chart’s templates are made when there is none', async () => {
    await open();
    expect(panel().textContent).toContain('No data yet: each panel opens its own form.');
    unmount(app);
    document.querySelectorAll('.float-menu').forEach((node) => node.remove());
    templatesState.figure = [];
    await open({ figure: 'chart', data: { table: '| A |\n| --- |', origin: '', name: 'This chart' } });
    expect(panel().textContent).toContain('No chart template yet. Settings › Templates › Figures makes one');
    expect(props.ready).not.toHaveBeenCalled();
  });
});

describe('applying one', () => {
  it('hands up what the server wrote when every column is named', async () => {
    await open({ figure: 'chart', data: { table: DATA.table, origin: '', name: 'This chart' } });
    props.apply.mockResolvedValue({ ask: false, reads: 'data', changes: { kind: 'donut', by: 'Grade' }, needs: [] });
    item('Grades donut').click();
    await settle();
    expect(props.apply).toHaveBeenCalledWith({ template: CHART.data, table: DATA.table, origin: '' });
    expect(props.onapply).toHaveBeenCalledWith(expect.objectContaining({ changes: { kind: 'donut', by: 'Grade' } }), CHART);
    expect(props.onclose).toHaveBeenCalled();
  });

  it('asks the columns the data does not name, its suggestion picked, then writes with them', async () => {
    await open({ data: DATA });
    props.apply.mockResolvedValueOnce(ASKED).mockResolvedValueOnce({ ask: false, text: PAGE, panels: [{ index: 0, reads: 'data' }, { index: 1, reads: 'map' }] });
    item('Losses, our way').click();
    await settle();
    const step = panel().querySelector('[aria-label="Match the columns"]');
    expect(step.textContent).toContain('Grade');
    expect(step.textContent).toContain('Donut: its parts');
    const select = step.querySelector('select[aria-label="The data’s column for Grade"]');
    expect([...select.options].map((option) => option.textContent)).toEqual(['Model', 'Confidence', 'Fill it by hand']);
    expect(select.selectedOptions[0].textContent).toBe('Confidence');
    [...panel().querySelectorAll('button')].find((node) => node.textContent === 'Apply').click();
    await settle();
    expect(props.apply).toHaveBeenLastCalledWith({ template: OURS.data, table: DATA.table, origin: 'sheet:s1', mapping: { Grade: 'Confidence' }, rows: [] });
    expect(props.onapply).toHaveBeenCalledWith(expect.objectContaining({ text: PAGE }), OURS);
  });

  it('puts a map of the note in a map panel, in the template’s look, or leaves it empty', async () => {
    const maps = [{ label: 'The road', text: '::: map\ntitle: The road\nlayer: Route\nbase: topographic\n:::' }];
    await open({ data: DATA, maps });
    props.apply.mockResolvedValue({ ask: false, text: PAGE, panels: [{ index: 0, reads: 'data' }, { index: 1, reads: 'map' }] });
    item('Losses, our way').click();
    await settle();
    const select = panel().querySelector('select[aria-label="The map for map panel 1"]');
    expect([...select.options].map((option) => option.textContent)).toEqual(['The road', 'An empty map']);
    [...panel().querySelectorAll('button')].find((node) => node.textContent === 'Apply').click();
    await settle();
    const [answer] = props.onapply.mock.calls[0];
    expect(answer.text).toContain('::: map\ntitle: The road\nlayer: Route\nnorth: on\n:::');
    expect(answer.text).not.toContain('base: topographic');
  });

  it('changes nothing in a chart when a column it needs is left to the hand, and says so', async () => {
    await open({ figure: 'chart', data: { table: DATA.table, origin: '', name: 'This chart' } });
    props.apply.mockResolvedValueOnce({ ...ASKED }).mockResolvedValueOnce({ ask: false, reads: 'own', changes: {}, notes: ['a column it needs was not given: nothing was changed'] });
    item('Grades donut').click();
    await settle();
    const select = panel().querySelector('select');
    select.value = 'hand';
    select.dispatchEvent(new Event('change'));
    [...panel().querySelectorAll('button')].find((node) => node.textContent === 'Apply').click();
    await settle();
    expect(props.onapply).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('Nothing changed: a column it needs was not given');
  });

  it('says a failure and stays open', async () => {
    await open({ figure: 'chart', data: { table: DATA.table, origin: '', name: 'This chart' } });
    props.apply.mockRejectedValue(new Error('HTTP 422'));
    item('Grades donut').click();
    await settle();
    expect(panel().textContent).toContain('Not applied: HTTP 422');
    expect(props.onclose).not.toHaveBeenCalled();
  });
});
