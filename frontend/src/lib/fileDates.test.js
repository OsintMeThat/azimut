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

  it('offers what was already stated for the file first, a proof’s date before a correction', () => {
    const stated = (raw, sources, extra = {}) => ({
      owner_id: `claim-${raw}`, kind: 'claim', raw, category: 'statement', time_role: 'observed',
      subject_entities: [{ id: 'm1', label: 'clip', type: 'media' }], source_entities: sources, ...extra,
    });
    const offers = fileDateOffers([
      row('published', '2026-03-14'),
      row('captured', '2026-03-12T14:02:00Z'),
      stated('2026-03-10', []),
      stated('2026-03-11~', [{ id: 'p1', label: 'Dated proof', type: 'proof' }]),
      // an event that only names the file happened then, it does not date the footage
      stated('2026-03-09', [], { time_role: 'occurred' }),
      // and one about another file says nothing about this one
      stated('2026-03-08', [], { subject_entities: [{ id: 'm2', label: 'other', type: 'media' }] }),
    ], 'm1');
    expect(offers.map((offer) => offer.kind)).toEqual(['proof', 'stated', 'captured', 'published']);
    expect(offers[0]).toMatchObject({ value: '2026-03-11~', hint: 'Use the date its proof gives' });
    expect(offers[0].words).toBe('proof 11 Mar 2026');
  });

  it('keeps one press per date, the stated one when the camera agrees', () => {
    const offers = fileDateOffers([
      row('captured', '2026-03-12'),
      { owner_id: 'c1', kind: 'claim', raw: '2026-03-12', time_role: 'observed',
        subject_entities: [{ id: 'm1' }], source_entities: [{ id: 'p1', type: 'proof' }] },
    ], 'm1');
    expect(offers.map((offer) => offer.kind)).toEqual(['proof']);
  });

  it('reads the file’s own rows off the Timeline projection', async () => {
    const get = vi.fn(async () => ({ items: [row('imagery', '2026-03-11')] }));
    const offers = await fetchFileDates('case-a', 'm1', { get });
    expect(offers.map((offer) => offer.words)).toEqual(['imagery 11 Mar 2026']);
    expect(get.mock.calls[0][0]).toContain('/api/cases/case-a/timeline?entity=m1');
    expect(get.mock.calls[0][0]).toContain('category=media');
    // and the statements about it, which is where a proof's date lives
    expect(get.mock.calls[0][0]).toContain('category=statement');
  });
});
