import { describe, expect, it } from 'vitest';
import { comparePostAbout, postCredits } from './comparePost.js';

describe('what a post is told of a kept comparison', () => {
  it('gives the left picture\'s date as before and the right one\'s as after, and the credits each said once', () => {
    const pair = { a: { imageryWhen: '2021-01-01' }, b: { imageryWhen: '2025-06-01T09:12:00Z' } };
    expect(comparePostAbout({ title: ' Harbour ', pair, credits: postCredits('Esri', ' Esri ', '', 'Contains modified Copernicus Sentinel data 2025') }))
      .toEqual({ title: 'Harbour', description: '', span: { before: '2021-01-01', after: '2025-06-01T09:12:00Z' },
        credits: 'Esri · Contains modified Copernicus Sentinel data 2025' });
    // the sides stay where they stand, a later picture on the left included
    const swapped = { a: { imageryWhen: '2025-06-01' }, b: { imageryWhen: '2021-01-01' } };
    expect(comparePostAbout({ pair: swapped }).span).toEqual({ before: '2025-06-01', after: '2021-01-01' });
  });

  it('gives an evolution\'s first and last day', () => {
    expect(comparePostAbout({ days: ['2014-02-20', '2020-01-01', '2026-09-01'] }).span).toEqual({ before: '2014-02-20', after: '2026-09-01' });
  });

  it('keeps a picture with no single date as a side with none, for the analyst to complete', () => {
    // World Imagery is a mosaic: its side is said, with no date
    expect(comparePostAbout({ pair: { a: { imageryWhen: '2024-05-01' }, b: { imageryWhen: null } } }).span)
      .toEqual({ before: '2024-05-01', after: null });
    expect(comparePostAbout({ pair: { a: {}, b: { imageryWhen: '2025-06-01' } } }).span).toEqual({ before: null, after: '2025-06-01' });
    expect(comparePostAbout().span).toEqual({ before: null, after: null });
  });
});
