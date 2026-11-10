import { describe, expect, it } from 'vitest';
import { NO_PIN, pinPostAbout, pinsPostHint, postablePins } from './pinPost.js';

describe('what a Detect post carries', () => {
  it('is the pins, never a candidate only kept, as many as one post holds', () => {
    const rows = [{ review: 'noted', entity_id: 'x' }, { review: 'kept' }, ...[1, 2, 3, 4, 5].map((n) => ({ review: 'kept', entity_id: `p${n}` }))];
    expect(postablePins(rows).map((row) => row.entity_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(postablePins(null)).toEqual([]);
  });

  it('says what it carries, or that only a pin has a picture', () => {
    expect(pinsPostHint(0)).toBe(NO_PIN);
    expect(pinsPostHint(1)).toBe('A free post with the pinned picture');
    expect(pinsPostHint(4, 9)).toBe('A free post with the 4 pinned pictures, the first 4 of 9');
  });

  it('tells the post the days of the passes, one pass for a single-pass method', () => {
    const pairs = [{ a: { date: '2026-03-02' }, b: { date: '2026-03-14' } }, { a: { release: 3 }, b: { date: '2026-04-01T10:12:00Z' } }];
    expect(pinPostAbout({ title: ' Port ', description: 'Roof', pairs }))
      .toEqual({ title: 'Port', description: 'Roof', dates: ['2026-03-02', '2026-03-14', '2026-04-01'] });
    expect(pinPostAbout({ pairs, single: true }).dates).toEqual(['2026-03-14', '2026-04-01']);
  });
});
