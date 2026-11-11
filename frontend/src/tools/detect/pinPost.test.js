import { describe, expect, it } from 'vitest';
import { NO_PIN, pinPostAbout, pinsPostHint, postablePins } from './pinPost.js';

describe('what a Detect post carries', () => {
  it('is the pins, never a candidate only kept, as many as one post holds', () => {
    const rows = [{ review: 'noted', entity_id: 'x' }, { review: 'kept' }, ...[1, 2, 3, 4, 5].map((n) => ({ review: 'kept', entity_id: `p${n}` }))];
    expect(postablePins(rows).map((row) => row.entity_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(postablePins(null)).toEqual([]);
  });

  it('says what it carries, and how to get a picture when nothing is pinned', () => {
    expect(NO_PIN).toBe('Pin a candidate to post it');
    expect(pinsPostHint(1)).toBe('A free post with the pinned picture');
    expect(pinsPostHint(4, 9)).toBe('A free post with the 4 pinned pictures, the first 4 of 9');
  });

  it('tells the post a pin\'s passes as its before and after', () => {
    const pairs = [{ a: { date: '2026-03-02' }, b: { date: '2026-03-14' } }];
    expect(pinPostAbout({ title: ' Port ', description: 'Roof', pairs }))
      .toEqual({ title: 'Port', description: 'Roof', span: { before: '2026-03-02', after: '2026-03-14' } });
  });

  it('tells the post a run\'s pins as the earliest before and the latest after', () => {
    const pairs = [
      { a: { date: '2026-03-05' }, b: { date: '2026-03-14' } },
      { a: { date: '2026-03-02' }, b: { date: '2026-04-01T10:12:00Z' } },
      { a: { date: '2026-03-09' }, b: { date: '2026-03-20' } },
    ];
    expect(pinPostAbout({ pairs }).span).toEqual({ before: '2026-03-02', after: '2026-04-01' });
  });

  it('says a pass that names a release rather than a day as a side with no known date', () => {
    expect(pinPostAbout({ pairs: [{ a: { release: 3 }, b: { date: '2026-04-01' } }] }).span).toEqual({ before: null, after: '2026-04-01' });
    expect(pinPostAbout({ pairs: [] }).span).toEqual({ before: null, after: null });
  });

  it('gives a method that reads one pass the days it was seen on, with no before', () => {
    const pairs = [{ a: null, b: { date: '2026-03-14' } }, { a: null, b: { date: '2026-03-02' } }];
    expect(pinPostAbout({ pairs, single: true })).toEqual({ title: '', description: '', dates: ['2026-03-02', '2026-03-14'] });
  });
});
