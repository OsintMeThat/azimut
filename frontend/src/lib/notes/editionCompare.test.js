import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, post } }));

const {
  NOW, compareEditions, draftCorrection, firstPair, paragraphPlace, readComparison, shortDay, textChoices, wordsLine,
} = await import('./editionCompare.js');
const { correctionFor, keepCorrection, readEditions, reloadEditions } = await import('./editions.svelte.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const record = (at, format, text, edition = 'public') => ({
  at, edition, format, file: `Front - ${at.slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'html'}`, folder: 'exports',
  pages: 2, sha256: 'c'.repeat(64), pdf_sha256: 'c'.repeat(64), text_sha256: text,
});

function memory() {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
}

beforeEach(() => reloadEditions(memory()));
afterEach(() => vi.clearAllMocks());

describe('the texts a note can be compared on', () => {
  it('offers each kept public text once, newest first, numbered as published, with every format that printed it', () => {
    const editions = [
      record('2026-11-19T14:03:00Z', 'html', B),
      record('2026-11-19T14:00:00Z', 'pdf', B),
      record('2026-11-18T09:30:00Z', 'html', A),
      record('2026-11-18T09:00:00Z', 'pdf', 'd'.repeat(64), 'internal'),
      record('2026-11-17T09:00:00Z', 'html', 'e'.repeat(64)),
    ];
    const choices = textChoices(editions, [B, A], new Date('2026-11-20T00:00:00Z'));
    expect(choices.map((choice) => [choice.sha, choice.number, choice.formats])).toEqual([[B, 3, ['HTML', 'PDF']], [A, 2, ['HTML']]]);
    expect(choices[0].label).toMatch(/^Edition 3 · 19 Nov, \d\d:\d\d · HTML, PDF$/);
    // the year is said when it is not this one
    expect(shortDay('2025-03-02T10:00:00Z', new Date('2026-11-20T00:00:00Z'))).toMatch(/^2 Mar 2025, \d\d:\d\d$/);
    // the dialog opens on the newest against the note now
    expect(firstPair(choices)).toEqual({ before: B, after: NOW });
    expect(firstPair([])).toEqual({ before: '', after: NOW });
  });

  it('reads the kept list beside the editions, and only SHA-256s in it', async () => {
    get.mockResolvedValue({ editions: [record('2026-11-19T14:03:00Z', 'html', A)], kept: [A, 'nope', null] });
    const read = await readEditions('c1', 'n1');
    expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/editions');
    expect(read.kept).toEqual([A]);
    expect(read.editions).toHaveLength(1);
  });
});

describe('a comparison', () => {
  const ANSWER = {
    same: false,
    sentences: [
      { kind: 'chart', said: 'The chart “At least 41 armoured…” now counts 42, not 41.', figure: 'chart:4' },
      { kind: 'picture', said: '“Figure 1” shows another picture.' },
      { kind: 'mystery', said: 'Something else changed.' },
      { kind: 'chart' },
    ],
    paragraphs: [
      { state: 'changed', under: 'Summary', heading: false, parts: [['=', 'at least'], ['-', '41'], ['+', '42'], ['?', 'x']] },
      { state: 'added', under: 'Method', heading: true, parts: [['+', 'Second count']] },
      { state: 'changed', under: 'Summary', heading: false, what: 'The caption of “Figure 1”', parts: [['+', 'burnt']] },
      { state: 'odd', parts: [] },
    ],
    unchanged: 12,
    more: -3,
  };

  it('is asked of the server with the two texts, and read part by part', async () => {
    post.mockResolvedValue(ANSWER);
    const read = await compareEditions('c1', null, A, NOW);
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/case/editions/compare', { before: A, after: NOW });
    expect(read.sentences.map((sentence) => sentence.kind)).toEqual(['chart', 'picture', 'other']);
    expect(read.sentences[0]).toEqual({ kind: 'chart', said: ANSWER.sentences[0].said, figure: 'chart:4', short: '' });
    expect(read.paragraphs).toHaveLength(3);
    expect(read.paragraphs[0].parts).toEqual([{ op: '=', text: 'at least' }, { op: '-', text: '41' }, { op: '+', text: '42' }]);
    expect(read.unchanged).toBe(12);
    expect(read.more).toBe(0);
    expect(readComparison(null)).toBeNull();
  });

  it('says where each paragraph stands', () => {
    const read = readComparison(ANSWER);
    expect(read.paragraphs.map(paragraphPlace)).toEqual([
      'Under “Summary”', 'Under “Method” · new heading', 'The caption of “Figure 1”',
    ]);
    expect(paragraphPlace({ state: 'removed', under: '', heading: false })).toBe('At the start · paragraph taken out');
  });
});

describe('Write the correction from this', () => {
  const comparison = (sentences, paragraphs = []) => readComparison({ same: false, sentences, paragraphs });

  it('drafts the figures in reading order, then one line on the words', () => {
    const drafted = draftCorrection(comparison(
      [{ kind: 'chart', said: 'The chart “At least 41 armoured…” now counts 42, not 41.' },
        { kind: 'picture', said: '“Figure 1” shows another picture.' }],
      [{ state: 'changed', under: 'Summary', parts: [['-', '41'], ['+', '42']] },
        { state: 'changed', under: 'Method', parts: [['+', 'twice']] },
        { state: 'changed', under: 'Summary', what: 'The caption of “Figure 1”', parts: [['+', 'burnt']] }],
    ));
    expect(drafted).toBe('The chart “At least 41 armoured…” now counts 42, not 41. “Figure 1” shows another picture. '
      + 'Text revised in “Summary” and “Method”.');
  });

  it('takes one sentence per figure, in the words a reader needs', () => {
    const drafted = draftCorrection(comparison([
      { kind: 'chart', figure: 'chart:9', said: 'The chart “At least 41 armoured…” now counts 42, not 41.' },
      { kind: 'chart', figure: 'chart:9', said: 'In the chart “At least 41 armoured…”, the row “12 · Al-Wahsh” now reads Confirmed under “Grade”, not Almost sure.' },
      { kind: 'picture', figure: 'picture:12', said: '“Figure 1” shows another picture: “12.73, 43.48” in place of “Left behind”.',
        short: '“Figure 1” shows another picture.' },
      { kind: 'link', figure: 'link:30', said: 'In “Sources”, the link “BBC” now leads to another address.' },
      { kind: 'link', figure: 'link:31', said: 'In “Sources”, the link “Reuters” now leads to another address.' },
    ]));
    expect(drafted).toBe('The chart “At least 41 armoured…” now counts 42, not 41. “Figure 1” shows another picture. '
      + 'In “Sources”, the link “BBC” now leads to another address. In “Sources”, the link “Reuters” now leads to another address.');
  });

  it('names two sections of words at most', () => {
    const paragraphs = ['A', 'B', 'C', 'D'].map((under) => ({ state: 'changed', under, parts: [] }));
    expect(wordsLine(readComparison({ paragraphs }).paragraphs)).toBe('Text revised in “A”, “B” and 2 other sections.');
    expect(wordsLine([{ state: 'added', under: '', parts: [] }])).toBe('Text revised.');
    expect(wordsLine([])).toBe('');
  });

  it('stays within the line the page prints, saying what it left out', () => {
    const long = Array.from({ length: 8 }, (_, index) => ({ kind: 'table', said: `In the table under “Losses”, the row “Model ${index}” now reads ${index + 2}, not ${index + 1}.` }));
    const drafted = draftCorrection(comparison(long), 300);
    expect(drafted.length).toBeLessThanOrEqual(300);
    expect(drafted.startsWith('In the table under “Losses”, the row “Model 0” now reads 2, not 1.')).toBe(true);
    expect(drafted.endsWith('Other smaller changes.')).toBe(true);
  });

  it('drafts nothing when nothing changed', () => {
    expect(draftCorrection(readComparison({ same: true, sentences: [], paragraphs: [] }))).toBe('');
    expect(draftCorrection(null)).toBe('');
  });

  it('keeps the line for the note next export, and lets it go once empty', () => {
    const storage = memory();
    keepCorrection('c1', 'n1', '  The count   is 42. ', storage);
    expect(correctionFor('c1', 'n1')).toBe('The count is 42.');
    expect(correctionFor('c1', 'n2')).toBe('');
    reloadEditions(storage);
    expect(correctionFor('c1', 'n1')).toBe('The count is 42.');
    keepCorrection('c1', 'n1', '', storage);
    expect(correctionFor('c1', 'n1')).toBe('');
    keepCorrection('c1', 'n1', 'x'.repeat(400), storage);
    expect(correctionFor('c1', 'n1')).toHaveLength(300);
  });
});
