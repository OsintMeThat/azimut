import { describe, it, expect } from 'vitest';
import { bidiIsolate, bidiSafe, FSI, hasRtl, LRI, PDI } from './bidi.js';

const ARABIC = 'قصف على المدينة';

describe('hasRtl', () => {
  it('detects Arabic and Hebrew, not Latin', () => {
    expect(hasRtl(ARABIC)).toBe(true);
    expect(hasRtl('עיר עתיקה')).toBe(true);
    expect(hasRtl('Strike on the city, 48.8584, 2.2945')).toBe(false);
    expect(hasRtl('')).toBe(false);
    expect(hasRtl(null)).toBe(false);
  });
});

describe('bidiSafe — isolates LTR runs inside RTL text', () => {
  it('leaves LTR-only text completely untouched', () => {
    const text = 'Kyiv - 8GXG+Q8\n50.450100, 30.523400\n@GeoConfirmed\nhttps://x.com/a/1';
    expect(bidiSafe(text)).toBe(text);
  });

  it('wraps a coordinate pair so the comma cannot flip', () => {
    const out = bidiSafe(`${ARABIC}\n50.450100, 30.523400`);
    expect(out).toContain(`${LRI}50.450100, 30.523400${PDI}`);
  });

  it('wraps URLs, mentions and plus codes', () => {
    const out = bidiSafe(`${ARABIC} @GeoConfirmed 8GXG+Q8 https://t.me/chan/42`);
    expect(out).toContain(`${LRI}@GeoConfirmed${PDI}`);
    expect(out).toContain(`${LRI}8GXG+Q8${PDI}`);
    expect(out).toContain(`${LRI}https://t.me/chan/42${PDI}`);
  });

  it('keeps the RTL prose itself unwrapped', () => {
    const out = bidiSafe(`${ARABIC}\nhttps://x.com/a/1`);
    expect(out.startsWith(ARABIC)).toBe(true);
  });

  it('is idempotent — re-applying never double-wraps', () => {
    const once = bidiSafe(`${ARABIC} 50.450100, 30.523400`);
    expect(bidiSafe(once)).toBe(once);
  });

  it('handles empty/nullish input', () => {
    expect(bidiSafe('')).toBe('');
    expect(bidiSafe(null)).toBe('');
  });
});

// Bluesky's own detectors, as its app posts with them: `URL_REGEX` and `MENTION_REGEX`
// from `@bsky/sdk` 1.3.2 (dist/rich-text/util.js, the version bluesky-social/social-app
// pins), word for word the same in `@atproto/api` 0.31.2, read 2026-11-13. Copyright (c)
// 2022-2026 Bluesky Social PBC and contributors, under the MIT or the Apache-2.0
// license. Its `detectFacets` makes a link of `[2]` and a mention of `[3]`.
const BLUESKY_URL_REGEX = /(^|\s|\()((https?:\/\/[\S]+)|((?<domain>[a-z][a-z0-9]*(\.[a-z0-9]+)+)[\S]*))/gim;
const BLUESKY_MENTION_REGEX = /(^|\s|\()(@)([a-zA-Z0-9.-]+)(\b)/g;

describe('bidiSafe on Bluesky — its links and mentions stay ones', () => {
  const POST = `${ARABIC}\n7H872G9H+FC\n16.018740, 45.528599\n@geoconfirmed.org\nSource: https://x.com/a/status/1`;
  const links = (text) => [...text.matchAll(BLUESKY_URL_REGEX)].map((found) => found[2]);
  const handles = (text) => [...text.matchAll(BLUESKY_MENTION_REGEX)].map((found) => found[3]);

  it('finds both in the words as written, and neither once they are isolated as for X', () => {
    expect(links(POST)).toEqual(['https://x.com/a/status/1']);
    expect(handles(POST)).toEqual(['geoconfirmed.org']);
    const forX = bidiSafe(POST);
    expect(links(forX)).toEqual([]);
    expect(handles(forX)).toEqual([]);
  });

  it('leaves them bare there, so Bluesky finds the link and the whole handle, and still pins the rest', () => {
    const out = bidiSafe(POST, 'bluesky');
    expect(links(out)).toEqual(['https://x.com/a/status/1']);
    expect(handles(out)).toEqual(['geoconfirmed.org']);
    expect(out).toContain(`${LRI}7H872G9H+FC${PDI}`);
    expect(out).toContain(`${LRI}16.018740, 45.528599${PDI}`);
    expect(bidiSafe(out, 'bluesky')).toBe(out);
  });

  it('isolates no point inside a link', () => {
    const text = `${ARABIC} https://maps.example.test/?q=16.018740,45.528599`;
    expect(bidiSafe(text, 'bluesky')).toBe(text);
    expect(links(bidiSafe(text, 'bluesky'))).toEqual(['https://maps.example.test/?q=16.018740,45.528599']);
  });

  it('changes nothing on X', () => {
    expect(bidiSafe(POST, 'x')).toBe(bidiSafe(POST));
    expect(bidiSafe(POST, 'x')).toContain(`${LRI}https://x.com/a/status/1${PDI}`);
  });
});

describe('bidiIsolate — a drawn label reads in its own direction', () => {
  it('isolates a label holding RTL, so its number and ellipsis stay on its side', () => {
    expect(bidiIsolate('مسجد 12')).toBe(`${FSI}مسجد 12${PDI}`);
    expect(bidiIsolate('שלום…')).toBe(`${FSI}שלום…${PDI}`);
  });

  it('leaves every other label exactly as it was', () => {
    expect(bidiIsolate('Quay 4')).toBe('Quay 4');
    expect(bidiIsolate('Москва')).toBe('Москва');
    expect(bidiIsolate(null)).toBe('');
  });
});
