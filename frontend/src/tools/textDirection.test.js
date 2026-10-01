/**
 * Every surface that shows or takes the analyst's own words reads them in their own
 * direction: an Arabic label, a Hebrew note, a Persian statement start on the right
 * wherever they sit in an English interface. HTML gets `dir="auto"`; a canvas node
 * name and an SVG plate, which no attribute reaches, get `bidiIsolate`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('text direction on the surfaces that hold the analyst\'s words', () => {
  it.each([
    ['./Timeline.svelte', [
      'dir="auto"\n                          >{item.label}</span>',
      '<strong dir="auto">{item.label}</strong>\n                              <small>',
      'class="list-links" dir="auto">{names(item.subject_entities)}',
      '<h2 dir="auto">{selected.label}</h2>',
      '<blockquote dir="auto">{inspectorChain.entity.attrs.verbatim}</blockquote>',
      '<strong dir="auto">{track.label}</strong>',
    ]],
    ['./Board.svelte', [
      '<span class="name" dir="auto">{row.label}</span>',
      '<span class="name" dir="auto">{entity.label}</span>',
    ]],
    ['../components/EntityDetails.svelte', [
      'class="input"\n      dir="auto"\n      bind:value={infoTitle}',
      'dir="auto" bind:value={infoNotes}',
    ]],
    ['../components/TemporalClaimEditor.svelte', [
      'id="temporal-statement"\n    class="textarea"\n    dir="auto"',
      'dir="auto" bind:value={method}',
      'dir="auto" bind:value={verbatim}',
    ]],
  ])('%s', (path, expected) => {
    const source = read(path);
    for (const line of expected) expect(source).toContain(line);
  });

  it('isolates what a canvas or a plate draws', () => {
    expect(read('./Graph.svelte')).toContain('text: bidiIsolate(shortLabel(data.caption ?? data.label)),');
    expect(read('../lib/plate.js')).toContain('const clean = bidiIsolate(text);');
  });
});
