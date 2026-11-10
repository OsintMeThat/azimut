import { describe, expect, it } from 'vitest';
import { comparePostAbout, postCredits } from './comparePost.js';

describe('what a post is told of a kept comparison', () => {
  it('gives the date of each picture of a pair, and the credits each said once', () => {
    const pair = { a: { imageryWhen: '2021-01-01' }, b: { imageryWhen: '2025-06-01T09:12:00Z' } };
    expect(comparePostAbout({ title: ' Harbour ', pair, credits: postCredits('Esri', ' Esri ', '', 'Contains modified Copernicus Sentinel data 2025') }))
      .toEqual({ title: 'Harbour', description: '', dates: ['2021-01-01', '2025-06-01T09:12:00Z'],
        credits: 'Esri · Contains modified Copernicus Sentinel data 2025' });
  });

  it('gives an evolution\'s first and last day, and leaves out a picture with no date', () => {
    expect(comparePostAbout({ days: ['2014-02-20', '2020-01-01', '2026-09-01'] }).dates).toEqual(['2014-02-20', '2026-09-01']);
    expect(comparePostAbout({ pair: { a: {}, b: { imageryWhen: '2025-06-01' } } }).dates).toEqual(['2025-06-01']);
    expect(comparePostAbout().dates).toEqual([]);
  });
});
