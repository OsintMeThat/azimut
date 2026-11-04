import { describe, expect, it } from 'vitest';
import { firstOpening } from './noteDock.svelte.js';

/** A storage the size of what the panel keeps in it. */
function memory() {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
}

describe('the note on the side, opened for the first time', () => {
  it('says what it is for once in a browser, and never again', () => {
    const storage = memory();
    expect(firstOpening(storage)).toBe(true);
    expect(firstOpening(storage)).toBe(false);
    expect(firstOpening(storage)).toBe(false);
  });

  it('says nothing when the browser keeps nothing', () => {
    const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(firstOpening(refusing)).toBe(false);
  });
});
