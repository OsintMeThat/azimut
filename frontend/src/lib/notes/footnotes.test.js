import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { findFootnotes, footnoteLetter, footnoteMarkdown, footnotesOf, footnoteText } from './footnotes.js';

/** The Notebook finds a footnote exactly where every document prints one (`tests/fixtures/footnotes.json`). */
const { cases } = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/footnotes.json', import.meta.url), 'utf8'));

describe('where a line marks a footnote', () => {
  it.each(cases)('reads $line', ({ line, notes }) => {
    const found = findFootnotes(line);
    expect(found.map((note) => note.words)).toEqual(notes);
    for (const note of found) expect(line.slice(note.from, note.to)).toBe(`^[${note.words}]`);
  });

  it('says where each stands in the note, past fenced code', () => {
    const doc = 'One^[a].\n```\nCode^[no].\n```\nTwo^[b] and^[c].';
    expect(footnotesOf(doc).map((note) => [doc.slice(note.from, note.to), note.words])).toEqual([['^[a]', 'a'], ['^[b]', 'b'], ['^[c]', 'c']]);
    expect(findFootnotes('Seen^[x]', 10)[0]).toEqual({ from: 14, to: 18, words: 'x' });
  });
});

describe('a footnote as it is lettered, shown and written', () => {
  it('letters a to z, then aa, ab', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 702].map(footnoteLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab', 'az', 'ba', 'aaa']);
  });

  it('shows its words with no Markdown', () => {
    expect(footnoteText('See [the treaty](https://example.org/t), *now*, about [[entity:p1|the port]] \\[sic\\].')).toBe(
      'See the treaty, now, about the port [sic].');
  });

  it('writes words on one line, escaping only a bracket that would end it early', () => {
    expect(footnoteMarkdown('  The 1921 text\ncalls it so. ')).toBe('^[The 1921 text calls it so.]');
    expect(footnoteMarkdown('See [the treaty](https://example.org/t) [sic]')).toBe('^[See [the treaty](https://example.org/t) [sic]]');
    expect(footnoteMarkdown('a ] b')).toBe('^[a \\] b]');
    expect(footnoteMarkdown('a [ b')).toBe('^[a \\[ b]');
    for (const words of ['a ] b', 'a [ b', 'one ]] two [', 'x \\] y ]']) {
      const written = footnoteMarkdown(words);
      expect(findFootnotes(written)).toHaveLength(1);
      expect(findFootnotes(written)[0].to).toBe(written.length);
    }
  });
});
