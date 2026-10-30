import { describe, expect, it } from 'vitest';
import { readTemplateFile, templateFile } from './templateFile.js';

describe('a map template as a file', () => {
  it('goes out with its name and layout and comes back the same', async () => {
    const record = { id: 'x', name: 'House style', data: { page: { paper: 'a3' }, elements: [] } };
    const text = await templateFile(record).text();
    expect(readTemplateFile(text)).toEqual({ name: 'House style', data: record.data });
  });

  it('refuses anything else, in one sentence', () => {
    for (const text of ['not json', '{}', '{"azimut_map_template": 2, "data": {}}', '{"azimut_map_template": 1}']) {
      expect(() => readTemplateFile(text)).toThrow('That file is not a map template');
    }
    expect(readTemplateFile('{"azimut_map_template": 1, "data": {"elements": []}}').name).toBe('Imported template');
  });
});
