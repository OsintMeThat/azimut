import { describe, expect, it } from 'vitest';
import { HTML, HTML_BUDGET, PDF, keepFormat, readFormat, weightWords } from './formats.js';

/** A storage that keeps what it is given, or throws as a browser with storage off does. */
function memory({ broken = false } = {}) {
  const kept = new Map();
  return {
    kept,
    getItem: (key) => { if (broken) throw new Error('denied'); return kept.get(key) ?? null; },
    setItem: (key, value) => { if (broken) throw new Error('denied'); kept.set(key, value); },
  };
}

describe('PDF or HTML', () => {
  it('is PDF the first time, and what was kept after, the export and the page apart', () => {
    const storage = memory();
    expect(readFormat('export', storage)).toBe(PDF);
    keepFormat('page', HTML, storage);
    expect(readFormat('page', storage)).toBe(HTML);
    expect(readFormat('export', storage)).toBe(PDF);
    keepFormat('export', 'docx', storage);
    expect(storage.kept.get('azimut:note-export-format')).toBe(PDF);
  });

  it('holds for the visit in a browser that keeps nothing', () => {
    const storage = memory({ broken: true });
    expect(readFormat('page', storage)).toBe(PDF);
    expect(() => keepFormat('page', HTML, storage)).not.toThrow();
  });

  it('says what a file weighs in the words the dialog uses', () => {
    expect(weightWords(0)).toBe('');
    expect(weightWords('x')).toBe('');
    expect(weightWords(300)).toBe('1 KB');
    expect(weightWords(640 * 1024)).toBe('640 KB');
    expect(weightWords(12.44 * 1024 * 1024)).toBe('12.4 MB');
    expect(weightWords(HTML_BUDGET)).toBe('25 MB');
  });
});
