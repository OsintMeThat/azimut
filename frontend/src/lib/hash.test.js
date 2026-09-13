import { describe, expect, it } from 'vitest';
import { buildHash, readSolo, splitHash } from './hash.js';

describe('the location hash', () => {
  it('reads a bare route, the way every tool link is written', () => {
    const { route, params } = splitHash('#satellite');
    expect(route).toBe('satellite');
    expect([...params]).toEqual([]);
  });

  it('reads a route with the tool\'s own state after it', () => {
    const { route, params } = splitHash('#satellite?ll=48.8,2.3&z=17');
    expect(route).toBe('satellite');
    expect(params.get('ll')).toBe('48.8,2.3');
    expect(params.get('z')).toBe('17');
  });

  it('reads a workspace route the same way', () => {
    expect(splitHash('#compose/post?x=1').route).toBe('compose/post');
  });

  it('survives an empty, missing or hash-less input', () => {
    for (const input of ['', '#', undefined, 'satellite']) {
      expect(() => splitHash(input)).not.toThrow();
    }
    expect(splitHash(undefined).route).toBe('');
  });

  it('writes the plain route back when the tool asked for nothing', () => {
    expect(buildHash('satellite', {})).toBe('#satellite');
    expect(buildHash('satellite')).toBe('#satellite');
    expect(buildHash('satellite', new URLSearchParams())).toBe('#satellite');
  });

  it('round-trips what a tool put there', () => {
    const written = buildHash('satellite', { ll: '48.8,2.3', z: '17' });
    expect(written).toBe('#satellite?ll=48.8%2C2.3&z=17');
    expect(splitHash(written).params.get('ll')).toBe('48.8,2.3');
  });
});

describe('a tab holding one tool and nothing else', () => {
  it('is what a detached window says it is', () => {
    expect(readSolo(splitHash('#satellite?ll=48.8,2.3&w=2&solo=1').params)).toBe(true);
    expect(readSolo({ solo: '1' })).toBe(true);
  });

  it('is not what an ordinary window is', () => {
    expect(readSolo(splitHash('#satellite').params)).toBe(false);
    expect(readSolo(splitHash('#satellite?ll=48.8,2.3').params)).toBe(false);
    expect(readSolo(undefined)).toBe(false);
  });

  it('takes nothing else for a yes, since an address is typed by hand', () => {
    // the app around the tool is not something to lose to a stray character
    for (const raw of ['0', 'true', 'yes', '', 'solo']) {
      expect(readSolo({ solo: raw })).toBe(false);
    }
  });
});
