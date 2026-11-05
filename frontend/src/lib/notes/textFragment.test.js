import { describe, expect, it } from 'vitest';
import { encodeTerm, passageLink, textDirective } from './textFragment.js';

/**
 * A quote links to the passage itself (WICG Text Fragments), built from the words
 * alone: whole when short, by its first and last words when long or across
 * paragraphs, the page's own fragment kept before `:~:`.
 */

describe('a term', () => {
  it('encodes the marks the syntax reads as its own, and a Markdown link would end at', () => {
    expect(encodeTerm('well-known, cats & dogs')).toBe('well%2Dknown%2C%20cats%20%26%20dogs');
    expect(encodeTerm('(see) it\'s *here*!')).toBe('%28see%29%20it%27s%20%2Ahere%2A%21');
    expect(encodeTerm('café — 50% #1')).toBe('caf%C3%A9%20%E2%80%94%2050%25%20%231');
  });
});

describe('the directive', () => {
  it('matches a short passage whole, its spacing collapsed', () => {
    expect(textDirective('  The port   was closed. ')).toBe('text=The%20port%20was%20closed.');
  });

  it('matches a long passage by its first and last five words', () => {
    const words = 'one two three four five six seven eight nine ten eleven twelve';
    expect(textDirective(words)).toBe('text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%20twelve');
  });

  it('matches a passage across paragraphs by its first and last lines, since a term never crosses one', () => {
    expect(textDirective('Strike at dawn.\n\nBerths 10 to 14 were closed.')).toBe('text=Strike%20at%20dawn.,10%20to%2014%20were%20closed.');
    expect(textDirective('First, a line\r\nthen-another')).toBe('text=First%2C%20a%20line,then%2Danother');
  });

  it('is empty for no words', () => {
    expect(textDirective(' \n\t ')).toBe('');
    expect(textDirective(undefined)).toBe('');
  });
});

describe('the link', () => {
  it('adds the directive after a fragment-less address', () => {
    expect(passageLink('https://example.org/news/strike', 'The port was closed'))
      .toBe('https://example.org/news/strike#:~:text=The%20port%20was%20closed');
  });

  it('keeps the page\'s own fragment before the directive, and replaces a directive it carried', () => {
    expect(passageLink('https://example.org/a?x=1#section-2', 'closed')).toBe('https://example.org/a?x=1#section-2:~:text=closed');
    expect(passageLink('https://example.org/a#top:~:text=old', 'new')).toBe('https://example.org/a#top:~:text=new');
    expect(passageLink('https://example.org/a#:~:text=old', 'new')).toBe('https://example.org/a#:~:text=new');
  });

  it('is the address itself with no words, and nothing for what is not a web address', () => {
    expect(passageLink('https://example.org/a#top', '')).toBe('https://example.org/a#top');
    expect(passageLink('https://example.org/a', '')).toBe('https://example.org/a');
    expect(passageLink('javascript:alert(1)', 'x')).toBe('');
    expect(passageLink('not a link', 'x')).toBe('');
  });
});
