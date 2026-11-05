import { describe, expect, it } from 'vitest';
import { noteTemplateFile, noteTemplateFileName, readNoteTemplateFile } from './templateFile.js';

describe('a Notebook template as a file', () => {
  it('goes out with its name, body and look, and comes back the same', async () => {
    const record = {
      id: 'nt_1',
      name: 'Field brief',
      data: { body: '## Claim\n<!--? Who said it -->\n', folder: 'Briefs', look: { style: 'brief', tlp: 'amber', cover: { on: true, subtitle: 'Draft' } } },
    };
    const text = await noteTemplateFile(record).text();
    const parsed = JSON.parse(text);
    expect(parsed.azimut_note_template).toBe(1);
    expect(parsed).not.toHaveProperty('id');
    const back = readNoteTemplateFile(text);
    expect(back.name).toBe('Field brief');
    expect(back.data.body).toBe(record.data.body);
    expect(back.data.folder).toBe('Briefs');
    expect(back.data.look).toMatchObject({ style: 'brief', tlp: 'amber', cover: { on: true, subtitle: 'Draft', image: '', date: '' } });
  });

  it('carries no picture or day of a case, even if one slipped in', async () => {
    const text = await noteTemplateFile({ name: 'x', data: { body: '', look: { cover: { on: true, image: 'm1', date: '2026-01-02' } } } }).text();
    expect(JSON.parse(text).data.look.cover).toEqual({ on: true, mode: '', top: false, subtitle: '', image: '', date: '' });
    const crafted = JSON.stringify({ azimut_note_template: 1, name: 'y', data: { body: '', look: { cover: { image: 'm9' } } } });
    expect(readNoteTemplateFile(crafted).data.look.cover.image).toBe('');
  });

  it('carries its own first page and where it sits', async () => {
    const own = { cover: { on: true, mode: 'own', top: true, date: '2026-01-02' } };
    const text = await noteTemplateFile({ name: 'x', data: { body: '<!-- cover -->', look: own } }).text();
    expect(readNoteTemplateFile(text).data.look.cover).toMatchObject({ on: true, mode: 'own', top: true, date: '' });
  });

  it('reads a template written before looks, as a plain one', () => {
    const old = JSON.stringify({ azimut_note_template: 1, name: 'Old', data: { body: '## A' } });
    expect(readNoteTemplateFile(old).data.look.style).toBe('plain');
  });

  it('refuses anything else, in one sentence', () => {
    for (const text of ['not json', '{}', '{"azimut_note_template": 2, "data": {"body": ""}}',
      '{"azimut_note_template": 1, "data": {}}', '{"azimut_map_template": 1, "data": {"body": ""}}']) {
      expect(() => readNoteTemplateFile(text)).toThrow('That file is not a Notebook template');
    }
    expect(readNoteTemplateFile('{"azimut_note_template": 1, "data": {"body": ""}}').name).toBe('Imported template');
  });

  it('is saved under a name a disk accepts', () => {
    expect(noteTemplateFileName('A/B: brief?')).toBe('A_B_ brief_.azimut-note.json');
  });
});
