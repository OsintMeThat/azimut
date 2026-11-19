// @vitest-environment happy-dom
/**
 * A figure template edited in Settings, mounted: each change writes the template's own text
 * with the Notebook's writers, the sketch beside it. A page's band, look and panels (moved,
 * half or wide, taken out, added, a chart's column renamed, a map's look); a map template's
 * look alone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: Editor } = await import('./FigureTemplateEditor.svelte');
const { editorProps } = await import('./figureTemplateEditor.fixture.svelte.js');

const PAGE = [':::: infographic', '', '::: chart', 'kind: key figures', '| Figure | What it says |', '| --- | --- |', ':::', '',
  '::: chart', 'kind: stacked columns', 'count: rows', 'by: Group', 'colour by: Grade', '| Grade | Group |', '| --- | --- |', ':::', '',
  '::: map', ':::', '::::'].join('\n');

let target;
let app;
let box;

function open(data) {
  target = document.createElement('div');
  document.body.append(target);
  box = editorProps(data);
  app = mount(Editor, { target, props: box });
  flushSync();
}
const text = () => box.data.text;
const press = (label) => [...target.querySelectorAll('button')].find((node) => node.textContent.trim() === label || node.getAttribute('aria-label') === label);
const change = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
};

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target?.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
});

describe('an infographic template', () => {
  it('lists its panels with what each reads, beside its sketch', () => {
    open({ figure: 'infographic', text: PAGE });
    expect([...target.querySelectorAll('.fte-panel-title')].map((node) => node.textContent)).toEqual(['Key figures', 'Stacked columns', 'Map']);
    expect(target.querySelector('.fte-panel-said').textContent).toBe('Typed in each page');
    expect(target.querySelectorAll('.fte-panel-said')[1].textContent).toBe('Reads Grade, Group');
    expect(target.querySelector('svg.fts')).not.toBeNull();
    expect(target.textContent).toContain('A template keeps no row, no title, no source');
  });

  it('writes the band, the look and the legend as the page’s own lines', () => {
    open({ figure: 'infographic', text: PAGE });
    change(target.querySelector('input[title="The small line above the title"]'), 'Our desk');
    expect(text()).toContain('kicker: Our desk');
    press('Dark').click();
    flushSync();
    expect(text()).toContain('look: dark');
    press('One per chart').click();
    flushSync();
    expect(text()).toContain('legend: each panel');
  });

  it('moves a panel, sets its width and takes one out', () => {
    open({ figure: 'infographic', text: PAGE });
    press('Move Map up').click();
    flushSync();
    expect([...target.querySelectorAll('.fte-panel-title')].map((node) => node.textContent)).toEqual(['Key figures', 'Map', 'Stacked columns']);
    target.querySelectorAll('.fte-widths')[0].querySelector('button').click();
    flushSync();
    expect(text()).toMatch(/widths: half/);
    press('Take out Map').click();
    flushSync();
    expect(text()).not.toContain('::: map');
  });

  it('renames a chart’s column in its header and its settings, and changes its kind within its table', () => {
    open({ figure: 'infographic', text: PAGE });
    target.querySelectorAll('.fte-panel-name')[1].click();
    flushSync();
    const grade = target.querySelector('input[aria-label="Column Grade"]');
    expect(grade.nextElementSibling.textContent).toBe('its colours');
    change(grade, 'Confidence');
    expect(text()).toContain('colour by: Confidence');
    expect(text()).toContain('| Confidence | Group |');
    change(target.querySelector('select[aria-label="Kind"]'), 'donut');
    expect(text()).toContain('kind: donut');
    expect(text()).toContain('by: Confidence');
    expect(text()).not.toContain('colour by:');
  });

  it('sets a map panel’s look', () => {
    open({ figure: 'infographic', text: PAGE });
    target.querySelectorAll('.fte-panel-name')[2].click();
    flushSync();
    const north = target.querySelector('[aria-label="North arrow"]');
    [...north.querySelectorAll('button')].find((node) => node.textContent === 'On').click();
    flushSync();
    expect(text()).toContain('::: map\nnorth: on\n:::');
  });

  it('adds a chart of any kind with its columns, a map or words', () => {
    open({ figure: 'infographic', text: ':::: infographic\n::::' });
    expect(target.textContent).toContain('No panel yet');
    press('Add a panel').click();
    flushSync();
    [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.includes('A chart')).click();
    flushSync();
    [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.startsWith('Timeline')).click();
    flushSync();
    expect(text()).toContain('kind: timeline');
    expect(text()).toContain('| When | What happened |');
    press('Add a panel').click();
    flushSync();
    [...document.querySelectorAll('.float-menu .fm-item')].find((node) => node.textContent.includes('Words')).click();
    flushSync();
    expect(text()).toContain('### A heading');
  });
});

describe('a map template', () => {
  it('is its look alone', () => {
    open({ figure: 'map', text: '::: map\n:::' });
    const base = target.querySelector('[aria-label="Base"]');
    [...base.querySelectorAll('button')].find((node) => node.textContent === 'Dark').click();
    flushSync();
    const legend = target.querySelector('[aria-label="Legend"]');
    [...legend.querySelectorAll('button')].find((node) => node.textContent === 'Folded').click();
    flushSync();
    target.querySelector('input[type="checkbox"]').click();
    flushSync();
    expect(text()).toBe('::: map\nbase: dark\ncard: sentence, source, verify\nlegend: folded\n:::');
  });
});
