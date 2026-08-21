import { describe, expect, it } from 'vitest';
import { canStateSource, isSourceUrl, sourceProblem } from './statedSource.js';

describe('a stated source', () => {
  it('is an http(s) address or nothing', () => {
    expect(isSourceUrl('https://t.me/channel/42')).toBe(true);
    expect(isSourceUrl('  http://example.org/a  ')).toBe(true);
    expect(isSourceUrl('ftp://host/file')).toBe(false);
    expect(isSourceUrl('a friend sent it')).toBe(false);
    expect(isSourceUrl('')).toBe(false);
  });

  it('says nothing about an empty field: stating no origin is a real answer', () => {
    expect(sourceProblem('')).toBe('');
    expect(sourceProblem('   ')).toBe('');
    expect(sourceProblem(null)).toBe('');
  });

  it('names what is wrong with an address that is not one', () => {
    expect(sourceProblem('sent on Signal')).toBe('The source must be an http(s) address.');
  });
});

describe('whose origin the analyst gets to state', () => {
  it('is the material they brought in themselves', () => {
    expect(canStateSource({ source: { type: 'upload' } })).toBe(true);
    expect(canStateSource({ source: { type: 'clipboard' } })).toBe(true);
    expect(canStateSource({ source: { type: 'manual' } })).toBe(true);
  });

  it('is never what a tool fetched or made', () => {
    // a download's address is what was actually pulled, and a frame's origin is
    // the video it came out of — neither is a later edit's to rewrite
    expect(canStateSource({ source: { type: 'download', url: 'https://x.com/a/1' } })).toBe(false);
    expect(canStateSource({ source: { type: 'inspect', from: 'media/clip.mp4' } })).toBe(false);
    expect(canStateSource({ source: { type: 'satellite' } })).toBe(false);
    expect(canStateSource(null)).toBe(false);
  });
});
