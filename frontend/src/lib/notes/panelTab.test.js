import { describe, expect, it } from 'vitest';
import { quotePreview, tabHost } from './panelTab.js';

/**
 * What the Add menu shows of the tab in front: its host and a preview of the words
 * selected. Whether it is a map comes with the tab, from the extension.
 */

describe('a tab\'s host', () => {
  it('is its host without www, or nothing for what is no address', () => {
    expect(tabHost('https://www.example.org/news/strike?a=1')).toBe('example.org');
    expect(tabHost('https://news.example.org/')).toBe('news.example.org');
    expect(tabHost('not an address')).toBe('');
    expect(tabHost('')).toBe('');
    expect(tabHost(undefined)).toBe('');
  });
});

describe('the words selected, shown short', () => {
  it('is on one line between quotes, cut at a word past 60 characters', () => {
    expect(quotePreview('Berths 10 to 14\n  were   closed.')).toBe('“Berths 10 to 14 were closed.”');
    const long = 'Berths 10 to 14 were closed on Tuesday after a strike hit the port overnight and the harbour authority said';
    expect(quotePreview(long)).toBe('“Berths 10 to 14 were closed on Tuesday after a strike hit…”');
    expect(quotePreview('x'.repeat(60))).toBe(`“${'x'.repeat(60)}”`);
    expect(quotePreview('')).toBe('');
    expect(quotePreview('  \n ')).toBe('');
    expect(quotePreview(undefined)).toBe('');
    // one long word has no place to be cut at
    expect(quotePreview('abcdefghij'.repeat(10))).toBe(`“${'abcdefghij'.repeat(6)}…”`);
  });
});
