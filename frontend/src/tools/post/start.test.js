import { afterEach, describe, expect, it } from 'vitest';
import { uiState } from '../../lib/state.svelte.js';
import { MAX_PIECES, MAX_PIECE_TEXT, spanNote, startAbout, startFields, startPieces, startPost } from './start.js';

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

  it('carries the pieces a note hands over, and none when it hands none', () => {
    startPost('free', [], { title: 'Depot report' }, [{ kind: 'text', text: 'Words.' }, { kind: 'nope' }]);
    expect(uiState.postStart.pieces).toEqual([{ kind: 'text', text: 'Words.' }]);
    startPost('free', [], null, [{ kind: 'text', text: '  ' }]);
    expect(uiState.postStart).not.toHaveProperty('pieces');
  });
});

describe('startPieces — what a note hands over, kept to what Post can use', () => {
  it('keeps each kind as Post reads it, its id beside', () => {
    expect(startPieces([
      { kind: 'text', text: '  Title  ', heading: true },
      { kind: 'text', text: 'A paragraph.\n- a list', heading: 'yes' },
      { kind: 'media', path: 'media/a.jpg', type: 'image', id: 'e1' },
      { kind: 'media', path: 'exports/plate.mp4' },
      { kind: 'media', path: 'media/loop.gif' },
      { kind: 'proof', name: 'depot-strike', id: 'e2' },
      { kind: 'source', url: ' https://x.com/a/status/1 ', label: 'The video' },
      { kind: 'source', url: 'https://t.me/s/chan/2', label: 'https://t.me/s/chan/2' },
    ])).toEqual([
      { kind: 'text', text: 'Title', heading: true },
      { kind: 'text', text: 'A paragraph.\n- a list' },
      { kind: 'media', path: 'media/a.jpg', type: 'image', id: 'e1' },
      { kind: 'media', path: 'exports/plate.mp4', type: 'video' },
      { kind: 'media', path: 'media/loop.gif', type: 'gif' },
      { kind: 'proof', name: 'depot-strike', id: 'e2' },
      { kind: 'source', url: 'https://x.com/a/status/1', label: 'The video' },
      { kind: 'source', url: 'https://t.me/s/chan/2' },
    ]);
  });

  it('drops what Post cannot use: an unknown kind, no words, a path out of the case, a source that is no web address', () => {
    expect(startPieces([
      null, 'text', { kind: 'table', text: '| a |' },
      { kind: 'text', text: '   ' },
      { kind: 'media', path: '../secret.png' },
      { kind: 'media', path: '/etc/passwd' },
      { kind: 'media', path: 'media/..\\x.png' },
      { kind: 'proof', name: '  ' },
      { kind: 'source', url: 'javascript:alert(1)' },
      { kind: 'source', url: 'https://a b' },
    ])).toEqual([]);
    expect(startPieces('not a list')).toEqual([]);
  });

  it('keeps the alt text a picture comes with, a chart’s title, on one line and capped; never on a video', () => {
    expect(startPieces([
      { kind: 'media', path: 'media/Chart.png', type: 'image', id: 'e3', alt: '  At least 41 armoured\nvehicles  ' },
      { kind: 'media', path: 'media/long.png', type: 'image', alt: 'x'.repeat(2100) },
      { kind: 'media', path: 'media/clip.mp4', type: 'video', alt: 'A clip' },
      { kind: 'media', path: 'media/b.png', type: 'image', alt: 7 },
    ])).toEqual([
      { kind: 'media', path: 'media/Chart.png', type: 'image', id: 'e3', alt: 'At least 41 armoured vehicles' },
      { kind: 'media', path: 'media/long.png', type: 'image', alt: 'x'.repeat(2000) },
      { kind: 'media', path: 'media/clip.mp4', type: 'video' },
      { kind: 'media', path: 'media/b.png', type: 'image' },
    ]);
  });

  it('keeps a piece named by its id alone, for Post to say it was not found', () => {
    expect(startPieces([{ kind: 'media', id: 'e9' }, { kind: 'proof', id: 'e8' }])).toEqual([
      { kind: 'media', path: '', type: 'image', id: 'e9' },
      { kind: 'proof', name: '', id: 'e8' },
    ]);
  });

  it('caps the pieces and the words of a text', () => {
    const many = Array.from({ length: MAX_PIECES + 5 }, (_, i) => ({ kind: 'text', text: `P${i}` }));
    expect(startPieces(many)).toHaveLength(MAX_PIECES);
    expect(startPieces([{ kind: 'text', text: 'x'.repeat(MAX_PIECE_TEXT + 10) }])[0].text).toHaveLength(MAX_PIECE_TEXT);
    // a cut never splits an emoji in two
    const emoji = `${'x'.repeat(MAX_PIECE_TEXT - 1)}😀`;
    expect(startPieces([{ kind: 'text', text: emoji }])[0].text).toBe('x'.repeat(MAX_PIECE_TEXT - 1));
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
