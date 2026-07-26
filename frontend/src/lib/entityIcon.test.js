import { describe, expect, it } from 'vitest';
import { entityIcon, isVideoEntity } from './entityIcon.js';

describe('entityIcon', () => {
  it('maps a type to its icon and falls back to the note glyph', () => {
    expect(entityIcon({ type: 'place', attrs: {} })).toBe('pin');
    expect(entityIcon({ type: 'capture', attrs: {} })).toBe('satellite');
    expect(entityIcon({ type: 'whatever-new', attrs: {} })).toBe('note');
  });

  it('tells video media from images', () => {
    expect(entityIcon({ type: 'media', attrs: { kind: 'video' } })).toBe('video');
    expect(entityIcon({ type: 'media', attrs: { kind: 'image' } })).toBe('image');
  });
});

describe('isVideoEntity', () => {
  it('falls back to the extension for media filed before `kind` existed', () => {
    expect(isVideoEntity({ attrs: { path: 'raw/clip_04.MP4' } })).toBe(true);
    expect(isVideoEntity({ attrs: { path: 'raw/frame.png' } })).toBe(false);
    expect(isVideoEntity({ attrs: {} })).toBe(false);
  });

  it('trusts `kind` over the extension', () => {
    expect(isVideoEntity({ attrs: { kind: 'image', path: 'weird.mp4' } })).toBe(false);
  });
});
