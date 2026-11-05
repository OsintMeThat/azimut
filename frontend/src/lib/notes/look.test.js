import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, put } }));

const {
  COVERS, DEFAULT_LOOK, FONTS, HINT_LINE, coverChoice, coverFor, ownCover, INCLUDE_LINE, SIZES, SOURCES_OFF_STYLES, STYLES, hintLine, includeLine, isPlainLook, isReport, lookFont,
  normaliseLook, readLook, reportBody, reportLook, sourcesOn, templateLook, writeLook,
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
    expect(look.cover).toEqual({ on: true, mode: '', top: false, subtitle: 'x'.repeat(200), image: '', date: '' });
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

  it('keeps the list of sources as set, and the style\'s own for anything else', () => {
    expect(normaliseLook({ sources: 'on' }).sources).toBe('on');
    expect(normaliseLook({ sources: 'off' }).sources).toBe('off');
    expect(normaliseLook({ sources: 'yes' }).sources).toBe('');
    expect(normaliseLook({ sources: true }).sources).toBe('');
    expect(isPlainLook({ sources: '' })).toBe(true);
    expect(isPlainLook({ sources: 'on' })).toBe(false);
    expect(templateLook({ style: 'report', sources: 'off' }).sources).toBe('off');
  });

  it('lists the sources at the end for every style but Plain, unless set', () => {
    expect(sourcesOn(null)).toBe(false);
    expect(sourcesOn({ style: 'plain' })).toBe(false);
    expect(sourcesOn({ style: 'plain', sources: 'on' })).toBe(true);
    for (const style of ['report', 'brief', 'journal']) {
      expect(sourcesOn({ style }), style).toBe(true);
      expect(sourcesOn({ style, sources: 'off' }), style).toBe(false);
    }
  });

  it('follows the rule the server prints by', () => {
    // read off the server's own source, so a style changing sides on one end fails here
    const python = readFileSync(new URL('../../../../src/azimut/engine/notelook.py', import.meta.url), 'utf8');
    const tuple = /^SOURCES_OFF_STYLES[^=]*= \(([^)]*)\)/m.exec(python)?.[1];
    expect(tuple, 'SOURCES_OFF_STYLES in engine/notelook.py').toBeDefined();
    const off = [...tuple.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(SOURCES_OFF_STYLES).toEqual(off);
    for (const { id } of STYLES) expect(sourcesOn({ style: id }), id).toBe(!off.includes(id));
  });

  it('keeps no picture and no day in a template', () => {
    const look = templateLook({ style: 'report', font: 'modern', size: 'small', cover: { on: true, subtitle: 'Draft', image: 'm1', date: '2026-11-04' } });
    expect(look.cover).toEqual({ on: true, mode: '', top: false, subtitle: 'Draft', image: '', date: '' });
    expect(look).toMatchObject({ font: 'modern', size: 'small' });
  });

  it('prints no cover, the style\'s, or the analyst\'s own page, set to the top or centred', () => {
    expect(COVERS.map((cover) => cover.label)).toEqual(['Off', "The style's", 'Your own page']);
    expect(coverChoice(null)).toBe('off');
    expect(coverChoice({ cover: { on: true } })).toBe('style');
    expect(coverChoice({ cover: { on: true, mode: 'own' } })).toBe('own');
    // a mode alone is no cover: Off stays off
    expect(coverChoice({ cover: { mode: 'own' } })).toBe('off');
    expect(normaliseLook({ cover: { on: true, mode: 'poster', top: 1 } }).cover).toMatchObject({ mode: '', top: true });
    expect(isPlainLook({ cover: { mode: '', top: false } })).toBe(true);
    const own = ownCover({ style: 'report', cover: { subtitle: 'Kept', date: '2026-11-05' } });
    expect(own.cover).toMatchObject({ on: true, mode: 'own', subtitle: 'Kept', date: '2026-11-05' });
    expect(coverFor('style')).toEqual({ on: true, mode: '' });
    expect(coverFor('off')).toEqual({ on: false, mode: '' });
    // a template keeps its own page and where it sits, with no day of a case
    expect(templateLook({ cover: { on: true, mode: 'own', top: true, date: '2026-11-05' } }).cover)
      .toMatchObject({ on: true, mode: 'own', top: true, date: '' });
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
