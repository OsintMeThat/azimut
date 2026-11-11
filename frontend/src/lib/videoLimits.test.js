import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CLIP_AUDIO_KBPS, CLIP_MAX_SECONDS, CLIP_MIN_SECONDS, CLIP_VIDEO_KBPS } from './postClip.js';
import { PLATFORMS, VIDEO_LIMITS, clipBytesAtMost, overOn, overWords, passageFits, videoFits } from './videoLimits.js';

/** What X and Bluesky take, checked on a date, and whether a video fits. */

describe('the table', () => {
  it('says for each platform where and when its limits were checked', () => {
    expect(PLATFORMS).toEqual(['x', 'bluesky']);
    for (const table of Object.values(VIDEO_LIMITS)) {
      expect(table.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(table.source).toMatch(/^https:\/\//);
      expect(table.seconds).toBeGreaterThan(0);
      expect(table.bytes).toBeGreaterThan(0);
      expect(Array.isArray(table.unverified)).toBe(true);
      for (const field of table.unverified) expect(table, field).toHaveProperty(field);
    }
    expect([VIDEO_LIMITS.x.seconds, VIDEO_LIMITS.x.bytes]).toEqual([1200, 8e9]);
    expect([VIDEO_LIMITS.bluesky.seconds, VIDEO_LIMITS.bluesky.bytes]).toEqual([600, 3e8]);
  });
});

describe('whether a video fits', () => {
  it('says what is over, and never counts what it was not told', () => {
    expect(videoFits('bluesky', { seconds: 120, bytes: 40e6 })).toEqual({
      fits: true, over: [], unknown: [], limit: { seconds: 600, bytes: 3e8 },
    });
    expect(videoFits('bluesky', { seconds: 900, bytes: 4e8 }).over).toEqual(['seconds', 'bytes']);
    expect(videoFits('x', { seconds: 900 })).toMatchObject({ fits: true, unknown: ['bytes'] });
    expect(videoFits('x', { seconds: 0.2 }).over).toEqual(['seconds']);
    expect(() => videoFits('tiktok', {})).toThrow();
  });

  it('reads Premium where the platform has it', () => {
    expect(videoFits('x', { seconds: 3600 }).fits).toBe(false);
    expect(videoFits('x', { seconds: 3600 }, { premium: true }).fits).toBe(true);
    expect(videoFits('bluesky', { seconds: 900 }, { premium: true }).fits).toBe(false);
  });

  it('names the platforms a whole video is too long for, which is when the cut is offered', () => {
    expect(overOn({ seconds: 15 * 60, bytes: 2e8 })).toEqual(['Bluesky']);
    expect(overOn({ seconds: 30 * 60, bytes: 2e8 })).toEqual(['X', 'Bluesky']);
    expect(overOn({ seconds: 60, bytes: 2e7 })).toEqual([]);
  });

  it('knows a passage fits before it is cut, by the ceiling of the cut\'s rate', () => {
    expect(clipBytesAtMost(CLIP_MAX_SECONDS)).toBeLessThan(VIDEO_LIMITS.bluesky.bytes);
    expect(passageFits('bluesky', { start: 0, end: CLIP_MAX_SECONDS }).fits).toBe(true);
    expect(passageFits('bluesky', { start: 0, end: CLIP_MAX_SECONDS + 60 }).over).toContain('seconds');
    expect(passageFits('x', { start: 10, end: 10 + CLIP_MIN_SECONDS }).fits).toBe(true);
    expect(passageFits('x', { start: 10, end: null }).unknown).toEqual(['seconds', 'bytes']);
  });
});

describe('the cut, as the server makes it', () => {
  it('has the length and rates `engine/postclips.py` holds', () => {
    const engine = readFileSync(new URL('../../../src/azimut/engine/postclips.py', import.meta.url), 'utf8');
    const value = (name) => engine.match(new RegExp(`^${name} = "?([0-9.]+)k?"?`, 'm'))?.[1];
    expect(Number(value('MAX_SECONDS'))).toBe(CLIP_MAX_SECONDS);
    expect(Number(value('MIN_SECONDS'))).toBe(CLIP_MIN_SECONDS);
    expect(Number(value('MAXRATE'))).toBe(CLIP_VIDEO_KBPS);
    expect(Number(value('AUDIO_RATE'))).toBe(CLIP_AUDIO_KBPS);
  });
});

describe('what a composer says of a video over the limit', () => {
  it('says how long it runs and what the platform takes, a free account\'s where there is a paid tier', () => {
    const long = { seconds: 24 * 60 + 10, bytes: 400 * 1000 ** 2 };
    expect(overWords('x', videoFits('x', long), long)).toBe('This video runs 24:10, and X takes 20 minutes from a free account.');
    expect(overWords('bluesky', videoFits('bluesky', long), long)).toBe('This video runs 24:10, and Bluesky takes 10 minutes.');
  });

  it('says how big it is when the size is what is over', () => {
    const big = { seconds: 120, bytes: 400 * 1000 ** 2 };
    expect(overWords('bluesky', videoFits('bluesky', big), big)).toBe('This video is 400 MB, and Bluesky takes 300 MB.');
    const huge = { seconds: 120, bytes: 9.25 * 1000 ** 3 };
    expect(overWords('x', videoFits('x', huge), huge)).toBe('This video is 9.3 GB, and X takes 8 GB from a free account.');
  });

  it('says nothing of a video that fits or a platform it does not know', () => {
    const short = { seconds: 30, bytes: 1000 };
    expect(overWords('x', videoFits('x', short), short)).toBe('');
    expect(overWords('mastodon', { fits: false, over: ['seconds'] }, short)).toBe('');
  });
});
