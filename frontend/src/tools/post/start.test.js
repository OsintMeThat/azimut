import { afterEach, describe, expect, it } from 'vitest';
import { uiState } from '../../lib/state.svelte.js';
import { spanNote, startAbout, startFields, startPost } from './start.js';

afterEach(() => {
  uiState.postStart = null;
  uiState.tool = 'overview';
});

describe('startPost — what another tool hands Post', () => {
  it('names the kind, the case files in their order and what they show, and shows Post', () => {
    startPost('plate', ['media/Front.mp4', '', null, 3], {
      title: 'Front, October', dates: ['2026-10-12', '2026-10-01'], credits: 'Esri, Maxar · Made with Azimut',
    });
    expect(uiState.tool).toBe('post');
    expect(uiState.postStart).toEqual({
      kind: 'plate',
      media: ['media/Front.mp4'],
      about: { title: 'Front, October', description: '', dates: ['2026-10-01', '2026-10-12'], credits: 'Esri, Maxar · Made with Azimut' },
    });
  });

  it('starts with nothing said when nothing is, and an unknown kind as a geolocation', () => {
    startPost('telegram');
    expect(uiState.postStart).toEqual({ kind: 'geolocation', media: [], about: { title: '', description: '', dates: [], credits: '' } });
  });
});

describe('startAbout — only what the composer can use', () => {
  it('keeps the dates the case stores, each once, oldest first, and drops the rest', () => {
    const about = startAbout({ dates: ['2026-09-10T10:12:00Z', 'yesterday', '2026-09-01', '2026-09-01', 12, '2026-09~'] });
    expect(about.dates).toEqual(['2026-09-01', '2026-09-10T10:12:00Z']);
  });

  it('folds a title and a credit to one line, and caps each', () => {
    const about = startAbout({ title: '  Port\n gate ', credits: `A\t B ${'x'.repeat(3000)}`, description: ' Two lines\nkept ' });
    expect(about.title).toBe('Port gate');
    expect(about.credits).toHaveLength(2000);
    expect(about.description).toBe('Two lines\nkept');
  });

  it('reads anything that is not an object as nothing said', () => {
    for (const odd of [null, undefined, 'a', ['b'], 4]) expect(startAbout(odd)).toEqual({ title: '', description: '', dates: [], credits: '' });
  });

  it('keeps a before and after on its sides, a side with no date as null', () => {
    expect(startAbout({ span: { before: '2025-06-01', after: ' 2021-01-01 ' } }).span).toEqual({ before: '2025-06-01', after: '2021-01-01' });
    expect(startAbout({ span: { before: '2024-05-01', after: 'mosaic' } }).span).toEqual({ before: '2024-05-01', after: null });
    expect(startAbout({ span: {} }).span).toEqual({ before: null, after: null });
    // only when the tool gave one
    expect('span' in startAbout({ dates: ['2024-05-01'] })).toBe(false);
    expect('span' in startAbout({ span: ['2024-05-01'] })).toBe(false);
  });
});

describe('startFields — the composer fields a start fills', () => {
  it('writes one day as the post writes a date, several as the first → the last', () => {
    expect(startFields({ dates: ['2026-10-12'] }).date).toBe('2026-10-12');
    expect(startFields({ dates: ['2021-01-01', '2025-06-01'] }).date).toBe('2021-01-01 → 2025-06-01');
    expect(startFields({ dates: ['2026-09-10T10:12:00Z', '2026-09-01', '2026-09-05'] }).date).toBe('2026-09-01 → 2026-09-10 10:12 UTC');
    expect(startFields({}).date).toBe('');
  });

  it('writes a before and after as both sides in their order, a side with no date as ?', () => {
    expect(startFields({ span: { before: '2024-05-01', after: '2025-06-01' } }).date).toBe('2024-05-01 → 2025-06-01');
    // never sorted: the before stays first
    expect(startFields({ span: { before: '2025-06-01', after: '2024-05-01' } }).date).toBe('2025-06-01 → 2024-05-01');
    expect(startFields({ span: { before: '2024-05-01', after: null } }).date).toBe('2024-05-01 → ?');
    expect(startFields({ span: { before: null, after: '2025-06-01T09:12:00Z' } }).date).toBe('? → 2025-06-01 09:12 UTC');
    expect(startFields({ span: { before: null, after: null } }).date).toBe('? → ?');
    // one day twice is that day
    expect(startFields({ span: { before: '2025-06-01', after: '2025-06-01' } }).date).toBe('2025-06-01');
    // a span says the date, whatever days came with it
    expect(startFields({ dates: ['2020-01-01'], span: { before: '2024-05-01', after: null } }).date).toBe('2024-05-01 → ?');
  });

  it('names the post after what it came from and keeps its sentence and its credits', () => {
    expect(startFields({ title: 'Front, October', description: 'Lines as reported', credits: 'Esri' }))
      .toEqual({ name: 'Front, October', description: 'Lines as reported', date: '', credits: 'Esri' });
  });
});

describe('spanNote — a ? never goes out unnoticed', () => {
  it('names the side still to complete while the field holds ?', () => {
    expect(spanNote('2024-05-01 → ?')).toBe('The after picture has no known date.');
    expect(spanNote('? → 2025-06-01')).toBe('The before picture has no known date.');
    expect(spanNote('? → ?')).toBe('Neither picture has a known date.');
    // as the analyst may type it back
    expect(spanNote('2024-05-01→?')).toBe('The after picture has no known date.');
  });

  it('says nothing once both sides are dated, or on any other date', () => {
    for (const date of ['2024-05-01 → 2025-06-01', '2024-05-01', '', null, '2024-05-01 → ~2025', 'Why? → when']) {
      expect(spanNote(date)).toBe('');
    }
  });
});
