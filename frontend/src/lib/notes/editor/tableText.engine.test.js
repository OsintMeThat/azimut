import { readFileSync } from 'node:fs';
import { GFM, parser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { tablesIn } from './tableText.js';
import { writeLook } from './tableLook.js';

/**
 * The renderers' reading of two corpora, pinned by `tests/test_notes_table_text.py`
 * from the engine itself (markdown-it after `case_references`): this module must
 * find the same tables and the same cells, and the same settings line under a table.
 */
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PINNED = JSON.parse(fixture('tables.engine.json'));

/** `[[entity:…]]`, `[[media:…]]{…}` and a picture's braces as the engine rewrites them before it parses (`case_references`). */
const quote = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const asEngine = (cell) => cell
  .replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)\s*\{([^}\n]+)\}/g, (_match, alt, href, title, attrs) => `![${alt}](${href}${href.includes('?') ? '&' : '?'}__azimut_attrs=${quote(attrs)}${title ? ` "${title}"` : ''})`)
  .replace(/\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]/g, (_match, id, label) => `[${label}](azimut://entity/${id})`)
  .replace(/\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?/g, (_match, id, label, attrs) => `![${label}](azimut://media/${id}${attrs ? `?__azimut_attrs=${quote(attrs)}` : ''})`);

function ours(text) {
  const lineOf = (offset) => text.slice(0, offset).split('\n').length - 1;
  return tablesIn(text).map(({ from, end, table, look }) => ({
    line: lineOf(from),
    end: lineOf(end) + 1,
    header: table.header.map(asEngine),
    align: table.align,
    rows: table.rows.map((row) => row.map(asEngine)),
    ...(look ? { look: writeLook(look) } : {}),
  }));
}

describe('the renderers\' reading', () => {
  it.each(['edge-tables', 'real-tables'])('finds the tables and cells of %s the engine finds', (name) => {
    expect(ours(fixture(`${name}.md`))).toEqual(PINNED[name]);
  });
});

describe('the editor\'s own parser', () => {
  /** Where the editor's Lezer parser sees tables, as [from, to]. */
  function lezerTables(text) {
    const found = [];
    parser.configure(GFM).parse(text).iterate({
      enter(node) {
        if (node.name !== 'Table') return true;
        found.push([node.from, node.to]);
        return false;
      },
    });
    return found;
  }

  it('draws every table of the real notes on the same lines', () => {
    const text = fixture('real-tables.md');
    expect(lezerTables(text)).toEqual(tablesIn(text).map(({ from, end }) => [from, end]));
  });

  it('differs on three edge cases, which is why the grid takes its lines from here', () => {
    const text = fixture('edge-tables.md');
    // a settings line stands in the table's block, as the parser reads it a row
    const mine = tablesIn(text).map(({ from, end }) => `${from}-${end}`);
    const theirs = lezerTables(text).map(([from, to]) => `${from}-${to}`);
    const only = (ranges, others) => ranges.filter((range) => !others.includes(range)).map((range) => text.slice(...range.split('-').map(Number)));
    // its table starts after the first line's indent, runs on to a block's closing `:::`,
    // and a header of only an escaped pipe is no table to it
    expect(only(mine, theirs)).toEqual([
      '   | a | b |\n   |---|---|\n   | 1\t2 | 3 |',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      'a \\| b\n---',
    ]);
    expect(only(theirs, mine)).toEqual([
      '| a | b |\n   |---|---|\n   | 1\t2 | 3 |',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n:::',
    ]);
  });
});
