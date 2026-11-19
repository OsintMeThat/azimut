// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { markdownHtml } from '../../markdown.js';
import { DEFAULT_LOOK, readLook, withoutLookLines, writeLook } from './tableLook.js';
import { tablesIn } from './tableText.js';
import CASES from './fixtures/table-looks.json';

/**
 * A table's settings line, read and written as the engine reads and writes it
 * (`engine/notes_tables.py`, held to the same cases by `tests/test_notes_tables.py`),
 * found under a table's last row by the grid's reading, and no row to the Markdown
 * shown as HTML.
 */
describe('the line', () => {
  it.each(CASES.map((one) => [one.line, one.written]))('reads %j and writes it as %j', (line, written) => {
    const look = readLook(line);
    expect(look === null ? null : writeLook(look)).toBe(written);
  });

  it('writes nothing for a table with nothing set, and cleans the words it quotes', () => {
    expect(writeLook(DEFAULT_LOOK)).toBe('');
    expect(writeLook({ caption: ' "quoted" {braces} | pipe ' })).toBe('{caption="quoted braces pipe"}');
    expect(writeLook({ stripes: false, colour: 'Grade', rest: 'kept=1' })).toBe('{stripes=off colour="Grade" kept=1}');
  });
});

describe('a table read for the grid', () => {
  const TABLE = '| Model | Grade |\n| --- | --- |\n| Cougar | confirmed |\n| Tygor | almost sure |';

  it('takes the line under its last row as its settings, its rows ending above it', () => {
    const text = `Before.\n\n${TABLE}\n{stripes colour="Grade"}\n\nAfter.`;
    const [found] = tablesIn(text);
    expect(found.table.rows).toEqual([['Cougar', 'confirmed'], ['Tygor', 'almost sure']]);
    expect(text.slice(found.from, found.to)).toBe(TABLE);
    expect(text.slice(found.look.from, found.look.to)).toBe('{stripes colour="Grade"}');
    expect(found.end).toBe(found.look.to);
    expect(found.look).toMatchObject({ stripes: true, colour: 'Grade', search: 'auto' });
  });

  it('has no settings without the line, its block ending at its last row', () => {
    const [found] = tablesIn(`${TABLE}\n\nAfter.`);
    expect(found.look).toBeNull();
    expect(found.end).toBe(found.to);
  });

  it('keeps braces that name no setting, or stand above a row, as rows', () => {
    expect(tablesIn('| Only |\n| --- |\n| a |\n{x}').at(0).table.rows).toEqual([['a'], ['{x}']]);
    const [between] = tablesIn('| a | b |\n| --- | --- |\n| 1 | 2 |\n{stripes}\n| 3 | 4 |');
    expect(between.look).toBeNull();
    expect(between.table.rows).toEqual([['1', '2'], ['{stripes}', ''], ['3', '4']]);
  });
});

describe('the Markdown shown as HTML', () => {
  it('draws the table without its line, which stays where it is in the text', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n{stripes}\n\n> | c |\n> | --- |\n> | 3 |\n> {fold=20}\n\nA line {stripes}';
    expect(withoutLookLines(text)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> | c |\n> | --- |\n> | 3 |\n\nA line {stripes}');
    const drawn = markdownHtml(text);
    expect(drawn).not.toContain('stripes</td>');
    expect(drawn).not.toContain('fold=20');
    expect(drawn.match(/<tr>/g)).toHaveLength(4);
  });
});
