import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, put } }));

const {
  DEFAULT_LOOK, FONTS, HINT_LINE, INCLUDE_LINE, SIZES, hintLine, includeLine, isPlainLook, isReport, lookFont, normaliseLook,
  readLook, reportBody, reportLook, templateLook, writeLook,
} = await import('./look.js');

afterEach(() => vi.clearAllMocks());

describe('a look', () => {
  it('is the plain one when nothing was kept', () => {
    expect(normaliseLook(null)).toEqual(JSON.parse(JSON.stringify(DEFAULT_LOOK)));
    expect(isPlainLook(undefined)).toBe(true);
    expect(isPlainLook({ style: 'plain' })).toBe(true);
    expect(isPlainLook({ toc: true })).toBe(false);
  });

  it('fills what is missing and drops what it does not know', () => {
    const look = normaliseLook({ style: 'brief', accent: '#A0B1C2', cover: { on: 1, subtitle: 'x'.repeat(300) }, extra: true });
    expect(look.style).toBe('brief');
    expect(look.accent).toBe('#a0b1c2');
    expect(look.cover).toEqual({ on: true, subtitle: 'x'.repeat(200), image: '', date: '' });
    expect('extra' in look).toBe(false);
    expect(normaliseLook({ style: 'poster', page: 'a3', tlp: 'blue', accent: 'red' })).toMatchObject({
      style: 'plain', page: 'a4', tlp: '', accent: '',
    });
  });

  it('keeps a typeface and a text size it knows, and the style\'s own for anything else', () => {
    expect(normaliseLook({ font: 'book', size: 'large' })).toMatchObject({ font: 'book', size: 'large' });
    expect(normaliseLook({ font: 'comic', size: 'huge' })).toMatchObject({ font: '', size: '' });
    expect(normaliseLook({})).toMatchObject({ font: '', size: '' });
    expect(isPlainLook({ font: '', size: '' })).toBe(true);
    expect(isPlainLook({ size: 'small' })).toBe(false);
    expect(FONTS.map((font) => font.id)).toEqual(['', 'serif', 'sans', 'book', 'modern']);
    expect(SIZES.map((size) => size.label)).toEqual(['Smaller', 'Normal', 'Larger']);
  });

  it('says which typeface a look prints in, its style\'s when none is picked', () => {
    expect(lookFont(null)).toBe('serif');
    expect(lookFont({ style: 'brief' })).toBe('sans');
    expect(lookFont({ style: 'brief', font: 'book' })).toBe('book');
  });

  it('keeps no picture and no day in a template', () => {
    const look = templateLook({ style: 'report', font: 'modern', size: 'small', cover: { on: true, subtitle: 'Draft', image: 'm1', date: '2026-11-04' } });
    expect(look.cover).toEqual({ on: true, subtitle: 'Draft', image: '', date: '' });
    expect(look).toMatchObject({ font: 'modern', size: 'small' });
  });

  it('starts a report with a cover and its contents', () => {
    expect(reportLook()).toMatchObject({ style: 'report', cover: { on: true }, toc: true, numbered: false });
  });

  it('makes a note a report by its style or its chapters', () => {
    expect(isReport({ look: null, includes: 0 })).toBe(false);
    expect(isReport({ look: { style: 'plain' } })).toBe(false);
    expect(isReport({ look: { style: 'journal' } })).toBe(true);
    expect(isReport({ look: null, includes: 2 })).toBe(true);
  });

  it('is read and written beside the note, the case notes as `case`', async () => {
    get.mockResolvedValue({ look: { style: 'report' } });
    expect((await readLook('c1', null)).style).toBe('report');
    expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/case/look');
    put.mockResolvedValue({ look: { style: 'brief', toc: true } });
    const saved = await writeLook('c1', 'n1', { style: 'brief', toc: true });
    expect(put.mock.calls[0][0]).toBe('/api/cases/c1/notes/n1/look');
    expect(put.mock.calls[0][1]).toMatchObject({ style: 'brief', toc: true, page: 'a4' });
    expect(saved.toc).toBe(true);
  });
});

describe('the lines a report is made of', () => {
  it('names a chapter by its note, alone on its line', () => {
    expect(includeLine('n1')).toBe('[[include:n1]]');
    expect(INCLUDE_LINE.exec('[[include:n_1-b]]')[1]).toBe('n_1-b');
    expect(INCLUDE_LINE.test('See [[include:n1]]')).toBe(false);
    expect(reportBody(['n2', 'case', 'n1'])).toBe('[[include:n2]]\n\n[[include:case]]\n\n[[include:n1]]\n');
    expect(reportBody([])).toBe('');
  });

  it('writes guidance as a comment the PDF leaves out', () => {
    expect(hintLine('Say who --> took it')).toBe('<!--? Say who  took it -->');
    expect(HINT_LINE.exec('<!--? Who took it -->')[1]).toBe('Who took it');
    expect(HINT_LINE.test('<!-- an old comment -->')).toBe(false);
    expect(HINT_LINE.test('Text <!--? x -->')).toBe(false);
  });
});
