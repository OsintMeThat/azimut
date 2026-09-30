import { describe, expect, it, vi } from 'vitest';
import { fetchFileDates, fileDateOffers } from './fileDates.js';

const row = (kind, raw, owner = 'm1') => ({ owner_id: owner, kind, raw, category: 'media' });

describe('the dates a file offers', () => {
  it('names each date, the camera first and the post last', () => {
    const offers = fileDateOffers(
      [row('published', '2026-03-14'), row('captured', '2026-03-12T14:02:00Z')],
      'm1'
    );
    expect(offers.map((offer) => offer.words)).toEqual([
      'captured 12 Mar 2026, 14:02:00 UTC',
      'published 14 Mar 2026',
    ]);
    expect(offers.map((offer) => offer.value)).toEqual(['2026-03-12T14:02:00Z', '2026-03-14']);
  });

  it('says a post date is rarely when it happened', () => {
    const [post] = fileDateOffers([row('published', '2026-03-14')], 'm1');
    expect(post.hint).toBe("Use the post's date, rarely when it happened");
  });

  it('reads a camera clock to the second, which is what a press puts in the field', () => {
    const [camera] = fileDateOffers([row('captured', '2023-06-22T17:07:16.000000Z')], 'm1');
    expect(camera).toMatchObject({ value: '2023-06-22T17:07:16Z', words: 'captured 22 Jun 2023, 17:07:16 UTC' });
  });

  it('leaves out when the analyst had the file, dates owned by something else, and repeats', () => {
    expect(
      fileDateOffers(
        [row('collected', '2026-08-01'), row('added', '2026-08-01'), row('imagery', '2026-03-11', 'other')],
        'm1'
      )
    ).toEqual([]);
    expect(fileDateOffers([row('captured', '2026-03-12'), row('taken', '2026-03-12')], 'm1')).toHaveLength(1);
  });

  it('reads the file’s own rows off the Timeline projection', async () => {
    const get = vi.fn(async () => ({ items: [row('imagery', '2026-03-11')] }));
    const offers = await fetchFileDates('case-a', 'm1', { get });
    expect(offers.map((offer) => offer.words)).toEqual(['imagery 11 Mar 2026']);
    expect(get.mock.calls[0][0]).toContain('/api/cases/case-a/timeline?entity=m1');
    expect(get.mock.calls[0][0]).toContain('category=media');
  });
});
