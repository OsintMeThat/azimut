import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { areaFileUrl, importAreaNotes, importAreasFile, importedGround } from './areaFile.js';

vi.mock('./api.js', () => ({ api: { post: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

const asFile = (text) => ({ text: async () => text });

it('points at the area or the group it was asked for, escaping both names', () => {
  expect(areaFileUrl('case-1', 'areas', 'abc')).toBe('/api/cases/case-1/analysis/areas/abc/share');
  expect(areaFileUrl('case-1', 'zones', 'g1')).toBe('/api/cases/case-1/analysis/zones/g1/share');
  expect(areaFileUrl('a/b', 'areas', 'c d')).toBe('/api/cases/a%2Fb/analysis/areas/c%20d/share');
});

it('sends the file into the case it was dropped on, and says when it is not JSON', async () => {
  await importAreasFile('case-1', asFile('{"azimut":"azimut-areas","version":1,"areas":[]}'));
  expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/analysis/areas/import', {
    azimut: 'azimut-areas', version: 1, areas: [],
  });

  await expect(importAreasFile('case-1', asFile('nope'))).rejects.toThrow(/not JSON/);
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('counts what arrived, and leaves the folder out when none came', () => {
  expect(importedGround({ areas: [1, 2, 3], groups: [1] })).toBe('3 areas and 1 group');
  expect(importedGround({ areas: [1], groups: [] })).toBe('1 area');
});

it('says nothing about ground that arrived exactly as it was sent', () => {
  expect(importAreaNotes({ areas: [1], groups: [], renamed: [], ignored_fields: [] })).toEqual([]);
});

it('names the clashes it numbered and what a newer build wrote', () => {
  const notes = importAreaNotes({
    renamed: ['Pump 1', 'Pumping stations'], ignored_fields: ['elevation'], written_by: '9.9.9',
  });
  expect(notes).toHaveLength(2);
  expect(notes[0]).toBe('This case already had Pump 1, Pumping stations, so what arrived is numbered.');
  expect(notes[1]).toContain('Azimut 9.9.9');
  expect(notes[1]).toContain('elevation');
});
