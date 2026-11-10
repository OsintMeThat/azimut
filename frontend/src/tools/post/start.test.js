import { afterEach, describe, expect, it } from 'vitest';
import { uiState } from '../../lib/state.svelte.js';
import { startAbout, startFields, startPost } from './start.js';

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
});

describe('startFields — the composer fields a start fills', () => {
  it('writes one day as the post writes a date, two as the first to the last', () => {
    expect(startFields({ dates: ['2026-10-12'] }).date).toBe('2026-10-12');
    expect(startFields({ dates: ['2021-01-01', '2025-06-01'] }).date).toBe('2021-01-01 to 2025-06-01');
    expect(startFields({ dates: ['2026-09-10T10:12:00Z', '2026-09-01', '2026-09-05'] }).date).toBe('2026-09-01 to 2026-09-10 10:12 UTC');
    expect(startFields({}).date).toBe('');
  });

  it('names the post after what it came from and keeps its sentence and its credits', () => {
    expect(startFields({ title: 'Front, October', description: 'Lines as reported', credits: 'Esri' }))
      .toEqual({ name: 'Front, October', description: 'Lines as reported', date: '', credits: 'Esri' });
  });
});
