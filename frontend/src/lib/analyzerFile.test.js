import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { analyzerFileUrl, importAnalyzerFile, importNotes } from './analyzerFile.js';

vi.mock('./api.js', () => ({ api: { post: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

const asFile = (text) => ({ text: async () => text });

it('asks for the checks unless they were left behind, and escapes the name in the path', () => {
  expect(analyzerFileUrl('custom-abc')).toBe('/api/compare/analyzers/custom-abc/share');
  expect(analyzerFileUrl('custom-abc', { checks: false })).toBe('/api/compare/analyzers/custom-abc/share?checks=false');
  expect(analyzerFileUrl('a/b')).toBe('/api/compare/analyzers/a%2Fb/share');
});

it('sends the file it was handed, and says plainly when it is not JSON at all', async () => {
  const file = asFile('{"azimut":"azimut-analyzer","version":1,"recipe":{"name":"Burn"}}');
  await importAnalyzerFile(file);
  expect(api.post).toHaveBeenCalledWith('/api/compare/analyzers/import', {
    azimut: 'azimut-analyzer', version: 1, recipe: { name: 'Burn' },
  });

  await expect(importAnalyzerFile(asFile('not json at all'))).rejects.toThrow(/not JSON/);
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('says nothing about an analyzer that arrived able to do everything it did', () => {
  expect(importNotes({ analyzer: { name: 'Burn' }, renamed_from: '', missing_layers: [], ignored_fields: [] })).toEqual([]);
});

it('names the rename, the layer this machine lacks and what a newer build wrote', () => {
  const notes = importNotes({
    analyzer: { name: 'Fresh burn 2' },
    renamed_from: 'Fresh burn',
    missing_layers: ['BURN_NBR', 'NBR2'],
    ignored_fields: ['certainty'],
    written_by: '9.9.9',
  });
  expect(notes).toHaveLength(3);
  expect(notes[0]).toBe('You already had an analyzer called “Fresh burn”, so this one is “Fresh burn 2”.');
  expect(notes[1]).toContain('BURN_NBR and NBR2');
  expect(notes[2]).toContain('Azimut 9.9.9');
  expect(notes[2]).toContain('certainty');
});

it('falls back to a newer Azimut when the file never said which build wrote it', () => {
  const notes = importNotes({ analyzer: { name: 'X' }, ignored_fields: ['certainty'], written_by: '' });
  expect(notes[0]).toContain('a newer Azimut');
});
