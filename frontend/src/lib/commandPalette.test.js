import { describe, expect, it } from 'vitest';
import { isPaletteKey, matchRuns, paletteTools } from './commandPalette.js';

describe('the palette shortcut', () => {
  it('opens with Control or Command, including from a text field', () => {
    expect(isPaletteKey({ key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } })).toBe(true);
    expect(isPaletteKey({ key: 'k', metaKey: true })).toBe(true);
  });

  it('leaves composition, held keys and other shortcuts alone', () => {
    for (const extra of [{ isComposing: true }, { repeat: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }]) {
      expect(isPaletteKey({ key: 'k', ctrlKey: true, ...extra })).toBe(false);
    }
    expect(isPaletteKey({ key: 'k' })).toBe(false);
    expect(isPaletteKey({ key: 'n', ctrlKey: true })).toBe(false);
  });
});

describe('matched runs', () => {
  const marked = (runs) => runs.filter((run) => run.hit).map((run) => run.text);

  it('marks every term where the label holds it, whatever the case', () => {
    expect(matchRuns('Port Sudan quay', 'port QUAY')).toEqual([
      { text: 'Port', hit: true }, { text: ' Sudan ', hit: false }, { text: 'quay', hit: true },
    ]);
    expect(marked(matchRuns('Geo Proof', 'o'))).toEqual(['o', 'oo']);
  });

  it('points a folded match back at the accented letters', () => {
    expect(marked(matchRuns('Étude de Straße', 'etude strasse'))).toEqual(['Étude', 'Straße']);
  });

  it('leaves the label whole without a query or a match', () => {
    expect(matchRuns('Harbour', '  ')).toEqual([{ text: 'Harbour', hit: false }]);
    expect(matchRuns('Harbour', 'airfield')).toEqual([{ text: 'Harbour', hit: false }]);
    expect(matchRuns('', 'a')).toEqual([{ text: '', hit: false }]);
  });
});

describe('tool search', () => {
  const tools = [
    { id: 'satellite', label: 'Satellite' },
    { id: 'compare', label: 'Compare' },
    { id: 'proof', label: 'Geo Proof' },
    { id: 'settings', label: 'Settings' },
  ];

  it('finds a workspace as well as an individual tool, with folded text', () => {
    expect(paletteTools(tools, 'MÁP').map((row) => row.id)).toEqual(['satellite', 'compare']);
    expect(paletteTools(tools, 'compose proof').map((row) => row.id)).toEqual(['proof']);
    expect(paletteTools(tools, 'satellite').map((row) => row.label)).toEqual(['Satellite']);
  });

  it('includes Settings and ranks a named tool before workspace matches', () => {
    expect(paletteTools(tools, '').map((row) => row.id)).toEqual(tools.map((tool) => tool.id));
    expect(paletteTools(tools, 'settings')[0]).toMatchObject({ label: 'Settings', icon: 'settings' });
    expect(paletteTools([{ id: 'proof', label: 'Geo Proof' }, { id: 'notebook', label: 'Compose notes' }], 'compose')[0].id).toBe('notebook');
  });
});
