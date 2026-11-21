import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, put } }));

const {
  BANDS, BAND_MAX, COVERS, DEFAULT_LOOK, FONTS, HINT_LINE, coverChoice, coverFor, ownCover, INCLUDE_LINE, SIZES, SOURCES_OFF_STYLES, STYLES, hintLine, includeLine, isPlainLook, isReport, lookFont,
  WEBS, bandStyleOwn, normaliseLook, readLook, sectionsSet, slotText, reportBody, reportLook, sourcesOn, templateLook, writeLook,
  ANNEXES, LINK_CHECKS, SOURCES_STYLES, STYLE_DEFAULTS, profileChanged, profileOf, styleOwn, stylesTable, withProfile,
  SOURCES_LISTS, includesSummary, ownSources, sourcesListOf, OWN_SECTIONS, annexListOf, ownSection,
} = await import('./look.js');

afterEach(() => vi.clearAllMocks());

describe('a note’s own Method and Geolocations', () => {
  it('reads a Method or Geolocations heading of the note as the documents do', () => {
    // `notes_markdown.own_section` reads the same file: one rule, read from both sides
    const { cases } = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/own-sections.json', import.meta.url), 'utf8'));
    expect(cases.length).toBeGreaterThan(15);
    for (const { text, method, geolocations } of cases) {
      expect(ownSection(text, 'method'), text).toBe(method);
      expect(ownSection(text, 'geolocations'), text).toBe(geolocations);
    }
  });

  it('prints the generated annex only where the note has no section of its own, until it is set', () => {
    expect(Object.keys(OWN_SECTIONS)).toEqual(['method', 'geolocations']);
    const own = '## Method\n\nHow.\n\n## Annex: our geolocations on this front\n\n| # | Place |';
    expect(annexListOf({ style: 'report' }, own, 'method')).toBe('own');
    expect(annexListOf({ style: 'report' }, own, 'geolocations')).toBe('own');
    expect(annexListOf({ style: 'report' }, 'Words.', 'method')).toBe('generated');
    expect(annexListOf({ style: 'report', method_list: 'both' }, own, 'method')).toBe('both');
    expect(normaliseLook({ geolocations_list: 'mine' }).geolocations_list).toBe('');
    expect(normaliseLook({ method_list: 'generated' }).method_list).toBe('generated');
    expect(sectionsSet({ geolocations_list: 'own' }).style).toBe(true);
    // the summary counts the annexes the document prints: the two the note writes itself are not
    expect(includesSummary(profileOf({ style: 'report' }), 'own', { method: 'own', geolocations: 'own' }))
      .toBe('Your own sources · 3 annexes · links grouped');
  });
});

describe('the list of sources a note ends on', () => {
  it('reads a Sources or References heading of the note as the documents do', () => {
    // `notes_markdown.own_sources` reads the same file: one rule, read from both sides
    const { cases } = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/own-sources.json', import.meta.url), 'utf8'));
    expect(cases.length).toBeGreaterThan(10);
    for (const { text, own } of cases) expect(ownSources(text), text).toBe(own);
  });

  it('follows the note until it is set, and is kept as a late key', () => {
    expect(SOURCES_LISTS.map((one) => one.id)).toEqual(['generated', 'own', 'both']);
    expect(sourcesListOf({ style: 'report' }, 'Words.')).toBe('generated');
    expect(sourcesListOf({ style: 'report' }, '## Sources\n\n- one')).toBe('own');
    expect(sourcesListOf({ style: 'report', sources_list: 'both' }, 'Words.')).toBe('both');
    expect(normaliseLook({ sources_list: 'mine' }).sources_list).toBe('');
    expect(normaliseLook({ sources_list: 'own' }).sources_list).toBe('own');
    expect(sectionsSet({ sources_list: 'generated' }).style).toBe(true);
  });

  it('says what a note includes in one line', () => {
    const report = profileOf({ style: 'report' });
    expect(includesSummary(report, 'generated')).toBe('Academic sources · 5 annexes · links grouped');
    expect(includesSummary(report, 'own')).toBe('Your own sources · 5 annexes · links grouped');
    expect(includesSummary(report, 'both')).toBe('Your own and academic sources · 5 annexes · links grouped');
    expect(includesSummary(profileOf({ style: 'brief', annexes: { credits: 'on' }, link_check: 'each' }), 'generated'))
      .toBe('Short sources · 1 annex · each link checked');
    expect(includesSummary(profileOf({ style: 'plain' }), 'generated')).toBe('No sources list · no annex');
  });
});

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
    expect(look.cover).toEqual({ on: true, mode: '', top: false, subtitle: 'x'.repeat(200), image: '', date: '', marks: [] });
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

  it('keeps the web page\'s layout as set, an article for anything else, as the server reads it', () => {
    expect(WEBS.map((web) => [web.id, web.label])).toEqual([['', 'Article'], ['story', 'Story'], ['map', 'Map page']]);
    expect(normaliseLook(null).web).toBe('');
    expect(normaliseLook({ web: 'story' }).web).toBe('story');
    expect(normaliseLook({ web: 'scroll' }).web).toBe('');
    expect(isPlainLook({ web: '' })).toBe(true);
    expect(isPlainLook({ web: 'story' })).toBe(false);
    expect(templateLook({ style: 'report', web: 'story' }).web).toBe('story');
    // the server's own list, read off its source, so a layout added on one end fails here
    const server = readFileSync(new URL('../../../../src/azimut/engine/notelook.py', import.meta.url), 'utf8');
    expect(server).toContain('Web = Literal["", "story", "map"]');
    expect(server).toMatch(/LATE_KEYS = \([^)]*"web"/);
  });

  it('carries what the note is on the site, so that saving a look never drops it', () => {
    const plain = normaliseLook(null);
    for (const key of ['category', 'role', 'list_image']) expect(key in plain).toBe(false);
    const set = normaliseLook({ category: '  Conflict   Watch ', role: 'page', list_image: 'e_ab12' });
    expect([set.category, set.role, set.list_image]).toEqual(['Conflict Watch', 'page', 'e_ab12']);
    expect(normaliseLook(set)).toEqual(set);
    expect(normaliseLook({ role: 'article', list_image: 'not an id', category: 'x'.repeat(90) }).category).toHaveLength(60);
    // unlisted is a role too: online, in no list
    expect(normaliseLook({ role: 'unlisted' }).role).toBe('unlisted');
    expect('role' in normaliseLook({ role: 'secret' })).toBe(false);
    const unset = normaliseLook({ role: 'article', list_image: 'not an id' });
    expect('role' in unset || 'list_image' in unset).toBe(false);
    expect(isPlainLook({ category: 'Harbour' })).toBe(false);
    // a template carries no picture of a case: not the list's either
    expect(templateLook({ category: 'Harbour', list_image: 'e_ab12' })).toMatchObject({ category: 'Harbour' });
    expect('list_image' in templateLook({ list_image: 'e_ab12' })).toBe(false);
    const server = readFileSync(new URL('../../../../src/azimut/engine/notelook.py', import.meta.url), 'utf8');
    expect(server).toMatch(/LATE_KEYS = \([^)]*"category"[^)]*"role"[^)]*"list_image"/);
    expect(server).toContain('CATEGORY_MAX = 60');
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

  it('follows the table the server prints by', () => {
    // `engine/notelook.py` PROFILES, written out once for both sides: a default moved on one end fails here
    const table = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/note-styles.json', import.meta.url), 'utf8'));
    expect(JSON.parse(JSON.stringify(STYLE_DEFAULTS))).toEqual(table);
    expect(STYLES.map((style) => style.id).sort()).toEqual(Object.keys(table).sort());
    expect(SOURCES_OFF_STYLES).toEqual(['plain']);
    for (const { id } of STYLES) expect(sourcesOn({ style: id }), id).toBe(table[id].sources);
  });

  it('keeps no picture and no day in a template', () => {
    const look = templateLook({ style: 'report', font: 'modern', size: 'small', cover: { on: true, subtitle: 'Draft', image: 'm1', date: '2026-11-04' } });
    expect(look.cover).toEqual({ on: true, mode: '', top: false, subtitle: 'Draft', image: '', date: '', marks: [] });
    expect(look).toMatchObject({ font: 'modern', size: 'small' });
  });

  it('keeps the marks of a cover in their order and only the ones it knows, and where it is signed', () => {
    const look = normaliseLook({ cover: { marks: ['signature', 'nope', 'azimut', 'azimut'] }, signed: 'end' });
    expect(look.cover.marks).toEqual(['azimut', 'signature']);
    expect(look.signed).toBe('end');
    expect(normaliseLook({ signed: 'everywhere' }).signed).toBe('');
    // signing counts as something set on the Cover tab, even with no cover
    expect(sectionsSet({ signed: 'title' }).cover).toBe(true);
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

  it('keeps a header and a footer as three one-line slots, and writes none that is empty', () => {
    expect(BANDS.map((band) => band.id)).toEqual(['header', 'footer']);
    // absent until a slot holds something, so the stored look is as an older reader wrote it
    expect('header' in normaliseLook(null)).toBe(false);
    expect(normaliseLook({ header: {}, footer: { left: '', center: '   ', right: '\n' } })).toEqual(normaliseLook(null));
    expect(JSON.stringify(normaliseLook({ footer: null }))).toBe(JSON.stringify(normaliseLook(null)));
    expect(isPlainLook({ header: { left: '', center: '', right: '' } })).toBe(true);
    const look = normaliseLook({ header: { center: '  Draft \n report ' }, footer: { left: '{date}', right: 'azimut:logo', extra: 'x' } });
    expect(look.header).toEqual({ left: '', center: 'Draft report', right: '' });
    expect(look.footer).toEqual({ left: '{date}', center: '', right: 'azimut:logo' });
    expect(isPlainLook(look)).toBe(false);
    // not an object, not a band
    expect('header' in normaliseLook({ header: 'Draft', footer: ['x'] })).toBe(false);
  });

  it('cuts a slot at 120 characters, and at the last word it kept', () => {
    expect(BAND_MAX).toBe(120);
    expect(slotText('x'.repeat(300))).toBe('x'.repeat(120));
    expect(slotText(`${'a'.repeat(119)} b`)).toBe('a'.repeat(119));
    expect(slotText(undefined)).toBe('');
    expect(normaliseLook({ footer: { right: 'y'.repeat(200) } }).footer.right).toHaveLength(120);
  });

  it('says what each style prints in a band it leaves empty', () => {
    expect(bandStyleOwn('plain')).toEqual({
      header: { left: '', center: '', right: '' }, footer: { left: '{title}', center: '', right: '{page}' },
    });
    for (const style of ['report', 'brief', 'journal']) {
      expect(bandStyleOwn(style).footer, style).toEqual({ left: '{date}', center: '', right: 'Page {page} / {pages}' });
      expect(bandStyleOwn(style).header, style).toEqual({ left: '', center: '', right: '' });
    }
  });

  it('says which sections of the Look hold something set, none for a look that sets nothing', () => {
    const none = { style: false, text: false, page: false, cover: false, bands: false };
    expect(sectionsSet(null)).toEqual(none);
    expect(sectionsSet({ style: 'plain', page: 'a4' })).toEqual(none);
    expect(sectionsSet({ style: 'report' })).toEqual({ ...none, style: true });
    for (const change of [{ toc: true }, { numbered: true }, { sources: 'on' }, { sources: 'off' }, { web: 'story' }]) expect(sectionsSet(change).style, JSON.stringify(change)).toBe(true);
    expect(sectionsSet({ font: 'book' })).toEqual({ ...none, text: true });
    expect(sectionsSet({ size: 'small' })).toEqual({ ...none, text: true });
    for (const change of [{ page: 'letter' }, { accent: '#c8102e' }, { tlp: 'green' }]) expect(sectionsSet(change), JSON.stringify(change)).toEqual({ ...none, page: true });
    expect(sectionsSet({ cover: { on: true } })).toEqual({ ...none, cover: true });
    // a subtitle kept while the cover is off is not a cover
    expect(sectionsSet({ cover: { on: false, subtitle: 'Draft' } }).cover).toBe(false);
    expect(sectionsSet({ header: { left: 'x' } })).toEqual({ ...none, bands: true });
    expect(sectionsSet({ footer: { right: 'azimut:logo' } })).toEqual({ ...none, bands: true });
    // what the look would drop is not set
    expect(sectionsSet({ footer: { left: '   ' }, accent: 'red' })).toEqual(none);
  });

  it('carries its bands into a template, which holds no case content', () => {
    const look = templateLook({ style: 'report', header: { left: 'Internal' }, footer: { right: 'azimut:my-logo' } });
    expect(look.header.left).toBe('Internal');
    expect(look.footer.right).toBe('azimut:my-logo');
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

describe('what a style carries', () => {
  it('lists the For row Report first and Plain last, each with what it gives in a line', () => {
    expect(STYLES.map((style) => style.label)).toEqual(['Report', 'Web article', 'Brief', 'Journal', 'Plain']);
    expect(STYLES.every((style) => style.note && style.note.length < 48)).toBe(true);
    expect(ANNEXES.map((annex) => annex.id)).toEqual(['geolocations', 'credits', 'method', 'limits', 'editions']);
    expect(SOURCES_STYLES.map((one) => one.id)).toEqual(['academic', 'web', 'short']);
    expect(LINK_CHECKS.map((one) => one.id)).toEqual(['each', 'grouped']);
  });

  it('keeps the profile keys a look sets, and drops values it does not know', () => {
    const look = normaliseLook({ style: 'article', sources_style: 'academic', link_check: 'loud',
      annexes: { method: 'on', credits: 'off', sketches: 'on', limits: true } });
    expect(look).toMatchObject({ style: 'article', sources_style: 'academic', link_check: '' });
    expect(look.annexes).toEqual({ credits: 'off', method: 'on' });
    expect(isPlainLook({ annexes: {} })).toBe(true);
    expect(isPlainLook({ annexes: { credits: 'on' } })).toBe(false);
    expect(sectionsSet({ sources_style: 'web' }).style).toBe(true);
    expect(sectionsSet({ annexes: { limits: 'off' } }).style).toBe(true);
    expect(templateLook({ style: 'report', annexes: { method: 'off' } }).annexes).toEqual({ method: 'off' });
  });

  it('reads each switch from the look, else its style as Settings has it, else Azimut\'s own', () => {
    expect(profileOf({ style: 'report' })).toEqual(STYLE_DEFAULTS.report);
    const settings = { report: { method: false, sources_style: 'web' }, brief: { credits: 'yes' } };
    expect(profileOf({ style: 'report' }, settings)).toMatchObject({ method: false, sources_style: 'web', limits: true });
    expect(profileOf({ style: 'brief' }, settings).credits).toBe(false);
    const own = { style: 'report', sources: 'off', link_check: 'grouped', annexes: { limits: 'off' } };
    expect(profileOf(own, settings)).toMatchObject({ sources: false, link_check: 'grouped', limits: false, method: false });
    expect(profileChanged(own)).toMatchObject({ sources: true, link_check: true, limits: true, method: false, sources_style: false });
    expect(stylesTable({ article: { editions: false }, poster: {} })).toMatchObject({ article: { editions: false, credits: true } });
    expect(Object.keys(stylesTable(null))).toEqual(Object.keys(STYLE_DEFAULTS));
    expect(styleOwn('article')).toBe("Web article's own");
  });

  it('sets one switch for the note, or hands it back to the style', () => {
    let look = withProfile({ style: 'report' }, 'method', false);
    expect(look.annexes).toEqual({ method: 'off' });
    look = withProfile(look, 'sources_style', 'short');
    look = withProfile(look, 'sources', false);
    expect(look).toMatchObject({ sources: 'off', sources_style: 'short' });
    look = withProfile(withProfile(withProfile(look, 'method', null), 'sources_style', null), 'sources', null);
    expect(isPlainLook({ ...look, style: 'plain' })).toBe(true);
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
