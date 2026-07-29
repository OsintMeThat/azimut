import { describe, expect, it } from 'vitest';
import { buildMediaQuery } from './mediaQuery.js';

describe('buildMediaQuery', () => {
  it('omits unset filters', () => {
    expect(buildMediaQuery('c1', {})).toBe('/api/cases/c1/media/page');
  });

  it('carries only the params that are set', () => {
    expect(
      buildMediaQuery('c1', {
        q: 'bridge kyiv',
        kind: 'image',
        category: 'satellite',
        folder: 'Sources/Telegram',
        sort: 'name',
        direction: 'desc',
        limit: 50,
        cursor: '2',
      })
    ).toBe(
      '/api/cases/c1/media/page?q=bridge+kyiv&kind=image&category=satellite&folder=Sources%2FTelegram&sort=name&direction=desc&limit=50&cursor=2'
    );
  });

  it('keeps an empty folder distinct from an unset one', () => {
    expect(buildMediaQuery('c1', { folder: '' })).toBe('/api/cases/c1/media/page?folder=');
  });
});

describe('buildMediaQuery — position filter', () => {
  it('asks for only the located files when the filter is on', () => {
    expect(buildMediaQuery('c1', { gps: true })).toBe('/api/cases/c1/media/page?gps=true');
  });

  it('says nothing when it is off, so the default page is unfiltered', () => {
    expect(buildMediaQuery('c1', { gps: false })).toBe('/api/cases/c1/media/page');
  });
});
