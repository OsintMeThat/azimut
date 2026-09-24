import { describe, expect, it } from 'vitest';
import { fileDate, pictureDate } from './pictureDate.js';

describe('the date a map picture was taken', () => {
  it('names a radar pass to the second, and exactly', () => {
    expect(pictureDate({ radarPass: { date: '2026-09-02', time: '05:42:10' } })).toEqual({
      imageryDate: '2026-09-02', imageryExact: true, imageryWhen: '2026-09-02T05:42:10Z',
    });
  });

  it('takes a pinned Sentinel-2 day as the acquisition itself', () => {
    expect(pictureDate({ pinnedDay: '2026-08-30', estimated: '2020-01-01' })).toEqual({
      imageryDate: '2026-08-30', imageryExact: true, imageryWhen: '2026-08-30',
    });
  });

  it('keeps a provider estimate, marked as one', () => {
    expect(pictureDate({ estimated: '2024-05-03' })).toMatchObject({ imageryDate: '2024-05-03', imageryExact: false });
  });

  it('states nothing it was not told', () => {
    expect(pictureDate({})).toEqual({ imageryDate: null, imageryExact: true, imageryWhen: null });
    expect(pictureDate({ estimated: 'last spring' }).imageryDate).toBeNull();
  });
});

describe('a picture date in a filename', () => {
  it('keeps the day, and a radar pass hour without a colon', () => {
    expect(fileDate('2024-05-03')).toBe('2024-05-03');
    expect(fileDate('2026-09-02T05:42:10Z')).toBe('2026-09-02T0542Z');
    expect(fileDate('')).toBe('');
    expect(fileDate(null)).toBe('');
  });
});
