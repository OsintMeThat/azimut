import { describe, expect, it } from 'vitest';
import {
  FORMATS, FORMAT_LABELS, HTML, HTML_BUDGET, PAGE_FORMATS, PDF, PUBLIC_ONLY, WEB, WORDPRESS, keepFormat, readFormat, weightWords,
} from './formats.js';

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

  it('offers four to export, two to the Page pane, and the web ones in the public edition only', () => {
    expect(FORMATS).toEqual([PDF, HTML, WEB, WORDPRESS]);
    expect(FORMATS.map((format) => FORMAT_LABELS[format]).join(' · ')).toBe('PDF · HTML page · Web folder · WordPress draft');
    expect(PAGE_FORMATS).toEqual([PDF, HTML]);
    expect(PUBLIC_ONLY).toEqual([WEB, WORDPRESS]);
    const storage = memory();
    keepFormat('export', WEB, storage);
    expect(readFormat('export', storage)).toBe(WEB);
    keepFormat('export', WORDPRESS, storage);
    expect(readFormat('export', storage)).toBe(WORDPRESS);
    // the Page pane draws no folder: a web format kept for it reads as PDF
    keepFormat('page', WEB, storage);
    expect(storage.kept.get('azimut:note-page-format')).toBe(PDF);
    storage.kept.set('azimut:note-page-format', WEB);
    expect(readFormat('page', storage)).toBe(PDF);
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
