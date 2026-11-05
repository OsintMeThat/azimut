import { describe, expect, it } from 'vitest';
import { keepPageView, readPageView } from './pageView.js';

/** A storage kept in a map, or one that refuses everything, as a locked-down browser does. */
function storage() {
  const kept = new Map();
  return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
}
const refusing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

describe('whether a note shows its pages', () => {
  it('is remembered apart for the Notebook, the note on the side and the extension\'s panel', () => {
    const store = storage();
    keepPageView('dock', true, store);
    expect(readPageView('dock', store)).toBe(true);
    expect(readPageView('panel', store)).toBe(false);
    expect(readPageView('notebook', store)).toBe(false);
    keepPageView('panel', true, store);
    keepPageView('dock', false, store);
    expect(readPageView('dock', store)).toBe(false);
    expect(readPageView('panel', store)).toBe(true);
    // the Notebook keeps the key it always had
    keepPageView('notebook', true, store);
    expect(store.kept.get('azimut:notebook-page')).toBe('1');
  });

  it('starts on the text when the browser keeps nothing', () => {
    expect(readPageView('dock', refusing)).toBe(false);
    expect(() => keepPageView('dock', true, refusing)).not.toThrow();
  });
});
