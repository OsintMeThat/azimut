// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FOLDED_FIRST, inspectorWidth, isOpen, layout, listWidth, readLayout, toggleFold, togglePanel } from './layout.svelte.js';

beforeEach(() => {
  localStorage.clear();
  Object.assign(layout, { list: true, inspector: true, folded: [], opened: [] });
});

describe('the plate editor layout', () => {
  it('reads both panels shown and nothing folded from nothing or garbage', () => {
    for (const raw of [null, '', '{', '[]', '{"list":"no"}', 42]) {
      expect(readLayout(raw)).toEqual({ list: true, inspector: true, folded: [], opened: [], tab: 'page' });
    }
  });

  it('keeps a panel put away and the folded titles, once each', () => {
    expect(readLayout('{"list":false,"folded":["Grid","Grid",3,"","Layers"],"opened":["3D",4]}')).toEqual({ list: false, inspector: true, folded: ['Grid', 'Layers'], opened: ['3D'], tab: 'page' });
  });

  it('keeps the list on its Layers tab, and on what the page holds from anything else', () => {
    expect(readLayout('{"tab":"layers"}').tab).toBe('layers');
    for (const raw of ['{"tab":"maps"}', '{"tab":3}', '{}']) expect(readLayout(raw).tab).toBe('page');
  });

  it('folds a section by its title and remembers it', () => {
    expect(isOpen('Ground')).toBe(true);
    toggleFold('Ground');
    expect(isOpen('Ground')).toBe(false);
    expect(layout.folded).toEqual(['Ground']);
    expect(readLayout(localStorage.getItem('azimut:plateLayout')).folded).toEqual(['Ground']);
    toggleFold('Ground');
    expect(layout.folded).toEqual([]);
  });

  it('opens simple: the sections few plates need start folded, and stay open once opened', () => {
    for (const title of ['3D', 'Grid', 'The imagery', 'The plain ground', 'Video transitions', 'Size', 'More']) expect(isOpen(title)).toBe(false);
    expect(FOLDED_FIRST).toContain('More');
    toggleFold('Grid');
    expect(isOpen('Grid')).toBe(true);
    expect(readLayout(localStorage.getItem('azimut:plateLayout')).opened).toEqual(['Grid']);
    toggleFold('Grid');
    expect(isOpen('Grid')).toBe(false);
    // a layout kept before folds nothing the analyst had open: only these few start folded
    expect(isOpen('Ground', readLayout('{"folded":[]}'))).toBe(true);
  });

  it('puts a panel away and back, and remembers it', () => {
    togglePanel('inspector');
    expect(layout.inspector).toBe(false);
    expect(readLayout(localStorage.getItem('azimut:plateLayout')).inspector).toBe(false);
    togglePanel('inspector');
    expect(layout.inspector).toBe(true);
  });

  it('gives the inspector room for two columns without eating a laptop screen', () => {
    expect(inspectorWidth.clampWidth(10_000, 3000)).toBe(720);
    expect(inspectorWidth.clampWidth(10_000, 1280)).toBe(640);
    expect(listWidth.clampWidth(10, 1280)).toBe(170);
  });
});
