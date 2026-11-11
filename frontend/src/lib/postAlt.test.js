import { describe, expect, it } from 'vitest';
import {
  ALT_BOX_TITLE, ALT_LIMITS, ALT_MAX, altLength, altLimit, altRecord, altSuggestion, readAltRecord, withAltTexts,
} from './postAlt.js';

describe('the limits table', () => {
  it('says each limit, the day it was checked, where, and what was not read off a help page', () => {
    for (const [id, row] of Object.entries(ALT_LIMITS)) {
      expect(row.limit, id).toBeGreaterThan(0);
      expect(row.checked, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.source, id).toMatch(/^https:\/\//);
      expect(row.note, id).toBeTruthy();
      expect(Array.isArray(row.unverified), id).toBe(true);
    }
    expect(ALT_LIMITS.x.limit).toBe(1000);
    expect(ALT_LIMITS.bluesky.limit).toBe(2000);
    // a field takes the larger, and the counter says when the platform picked is over
    expect(ALT_MAX).toBe(Math.max(...Object.values(ALT_LIMITS).map((row) => row.limit)));
  });

  it('counts as each platform does, and falls back to X for an unknown one', () => {
    const flag = '🇺🇦';
    // two code points, four UTF-16 units
    expect(altLength('x', flag)).toBe(2);
    expect(altLength('bluesky', flag)).toBe(4);
    expect(altLength('x', null)).toBe(0);
    expect(altLimit('mastodon')).toBe(ALT_LIMITS.x);
  });

  it('keeps the hover in one clause', () => {
    expect(ALT_BOX_TITLE).toBe('Describes each picture for people using a screen reader');
  });
});

describe('what a draft keeps', () => {
  it('keeps the texts that say something, of the pictures the post carries, or nothing', () => {
    const texts = { 'proofs/a.png': 'A bridge', 'media/b.png': '   ', 'media/gone.png': 'Removed since' };
    expect(altRecord(texts, ['proofs/a.png', 'media/b.png'])).toEqual({ 'proofs/a.png': 'A bridge' });
    expect(altRecord({}, ['proofs/a.png'])).toBeNull();
    expect(altRecord(texts, [])).toBeNull();
    expect(altRecord({ 'media/long.png': 'x'.repeat(ALT_MAX + 5) }, ['media/long.png'])['media/long.png']).toHaveLength(ALT_MAX);
  });

  it('reads a saved record, leaving out what is not a text', () => {
    expect(readAltRecord({ 'proofs/a.png': 'A bridge', 'media/b.png': 4, '': 'x', 'media/c.png': '' }))
      .toEqual({ 'proofs/a.png': 'A bridge' });
    for (const nothing of [undefined, null, 'text', ['proofs/a.png'], {}]) expect(readAltRecord(nothing)).toBeNull();
  });
});

describe('the hand-off', () => {
  it('carries each picture\'s text beside its file, and leaves a post without one as it was', () => {
    const posts = [
      { text: 'Geolocated.', files: ['proofs/a.png'] },
      { text: 'Video', files: ['media/clip.mp4'] },
      { text: 'Two pictures', files: ['media/b.png', 'media/c.png'] },
    ];
    const out = withAltTexts(posts, { 'proofs/a.png': ' A bridge ', 'media/c.png': 'A port gate', 'media/b.png': '' });
    expect(out[0]).toEqual({ text: 'Geolocated.', files: ['proofs/a.png'], alt: { 'proofs/a.png': 'A bridge' } });
    expect(out[1]).toBe(posts[1]);
    expect(out[2].alt).toEqual({ 'media/c.png': 'A port gate' });
    expect(Object.keys(withAltTexts(posts, {})[0])).toEqual(['text', 'files']);
  });
});

describe('the words a field starts with', () => {
  it('describes a video thread\'s sheet and map by its places', () => {
    expect(altSuggestion({ role: 'sheet', count: 3 })).toBe('Pictures of the 3 places geolocated in the video, numbered as in the post');
    expect(altSuggestion({ role: 'map', count: 3 })).toBe('Map of the 3 places geolocated in the video, numbered as in the post');
    expect(altSuggestion({ role: 'map', count: 1 })).toBe('Map of the 1 place geolocated in the video, numbered as in the post');
  });

  it('gives a proof\'s picture its sentence, else nothing', () => {
    expect(altSuggestion({ role: 'proof', description: ' A convoy on the bridge ' })).toBe('A convoy on the bridge');
    expect(altSuggestion({ role: 'proof', description: null })).toBe('');
  });

  it('gives a Compare or Map plate picture its name and dates, the kind\'s name for a numbered post', () => {
    expect(altSuggestion({ role: 'start', kind: 'compare', name: 'Post 4', date: '2024-05-01 → 2025-06-01' }))
      .toBe('Before and after, 2024-05-01 → 2025-06-01');
    expect(altSuggestion({ role: 'start', kind: 'compare', name: 'Kherson bridge', date: '2024-05-01 → ?' }))
      .toBe('Kherson bridge, 2024-05-01 → ?');
    expect(altSuggestion({ role: 'start', kind: 'plate', name: 'Front line', date: '' })).toBe('Front line');
    expect(altSuggestion({ role: 'start', kind: 'plate', name: '', date: '2025-06-01' })).toBe('Map, 2025-06-01');
    // a free post's pictures are the analyst's own, and start empty
    expect(altSuggestion({ role: 'start', kind: 'free', name: 'Depot', date: '2025-06-01' })).toBe('');
    expect(altSuggestion({})).toBe('');
  });
});
