import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./FilterBar.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'));

describe('a bar that never changes shape', () => {
  it('keeps the search and the one menu on screen whatever is asked', () => {
    // the fault of the row of selects it replaces: four of them appeared and
    // disappeared as the others were set, so the bar moved under the pointer
    const always = markup.slice(
      markup.indexOf('<div class="line">'),
      markup.indexOf("aria-expanded={open === '+'}")
    );
    expect(always).toContain('class="search-box"');
    expect(always).toContain('<button');
    // nothing between the top of the bar and its menu button is conditional, so
    // neither control ever moves under the pointer
    expect(always).not.toContain('{#if');
  });

  it('leaves an axis it cannot ask in the menu, with the reason beside it', () => {
    // a control you can see and cannot use teaches something; one that is not there
    // teaches nothing, which is how the field filter stayed invisible
    expect(markup).toContain('disabled={state.off}');
    expect(markup).toContain('title={state.off ? `${axis.hint} — ${state.note}` : axis.hint}');
    expect(source).toContain("{ off: true, note: 'no stored fields here' }");
    expect(source).toContain("{ off: true, note: 'nothing is linked yet' }");
  });

  it('says what every term does, in the menu and on hover', () => {
    // "I do not know what to click" is the fault a name and a count leave behind
    expect(markup).toContain('<span class="why">{axis.hint}</span>');
    expect(markup).toContain('<span class="why">{question.hint}</span>');
    expect(markup).toContain("title={axis?.hint ?? 'Change this term'}");
    expect(markup).toContain('class="heading titled"');
  });

  it('opens the field menu before the fields are known, since the click reads them', () => {
    // gated behind picking a type first, `kind = video` was a filter nobody could
    // reach — and being greyed out is indistinguishable from not existing
    expect(source).toContain("if (facetState === 'unasked') return { off: false, note: '' }");
    expect(source).toContain("if (facetState === 'loading') return { off: false, note: 'reading…' }");
    expect(markup).toContain('Reading what the case stores…');
    // and it opens whatever the case holds: no size ever turns the row off
    expect(source).not.toMatch(/narrow-first/);
    expect(markup).not.toMatch(/Pick a type first/);
  });

  it('offers a way out of every term, and out of all of them at once', () => {
    expect(markup).toContain('aria-label="Remove this filter"');
    expect(markup).toContain('clearAxis(filter, chip.axis)');
    expect(markup).toContain('Clear all');
  });
});

describe('the menu opens on questions, not on axes', () => {
  it('leads with the four every case is asked', () => {
    expect(markup).toContain('<p class="heading">Questions</p>');
    expect(markup).toContain('{#each QUESTIONS as question');
    expect(markup).toContain('<p class="heading">Narrow by</p>');
  });

  it('counts a question only where the summary can answer it honestly', () => {
    // a date range needs a query, so it says nothing rather than a wrong number
    expect(source).toContain("if (id === 'review') return summary?.by_status?.suggested ?? 0");
    expect(source).toContain("if (id === 'loose') return summary?.unlinked ?? 0");
    expect(source).toContain('return null;');
    expect(markup).toContain('{#if count != null}');
  });
});

describe('every term is chosen from what the case holds', () => {
  it('counts each option, so a term says how much of an answer it is', () => {
    expect(markup).toContain('<em>{summary?.by_type?.[entry.type] ?? 0}</em>');
    expect(markup).toContain('<em>{row.count}</em>');
    expect(markup).toContain('<em>{count}</em>');
  });

  it('offers a type only where the case holds one', () => {
    expect(source).toContain(
      'const held = $derived(types.filter((entry) => summary?.by_type?.[entry.type]))'
    );
  });

  it('prices "linked to" by what it would answer with, not by what the case holds', () => {
    // four media pointing at one place is four here and one under "type: place":
    // a count answering the neighbouring question looks like an answer and is not one
    expect(source).toContain('const reachable = $derived(');
    expect(source).toContain('summary?.linked_to?.[entry.type]');
    expect(markup).toContain('{#each reachable as entry (entry.type)}');
    expect(markup).toContain('<em>{entry.count}</em>');
    // and a type nothing links to is not offered at all
    expect(source).toContain("{ off: true, note: 'nothing is linked yet' }");
  });

  it('counts a folder the way the chip beside it reads', () => {
    // "and under" is a different number from the folder's own, and showing one for
    // the other is a count nobody can trust
    expect(markup).toContain('{filter.recursive ? row.under : row.direct}');
    expect(source).toContain('.reduce((sum, other) => sum + (direct.get(other) ?? 0), 0),');
  });

  it('offers every level of the tree, not only the folders holding rows', () => {
    // the summary counts a folder's own rows, so a parent whose whole contents sit in
    // its children — `Sources` over `Sources/Accounts` — was missing from the menu,
    // and "include subfolders" had nothing to be ticked on
    expect(source).toContain('const paths = new Set([...direct.keys(), ...caseFolders]);');
    expect(source).toContain('for (let cut = 1; cut < parts.length; cut += 1)');
    expect(markup).toContain('style="padding-left: {8 + row.depth * 12}px"');
  });

  it('reads a folder that holds nothing itself as the subtree it stands for', () => {
    // a heading rather than a bucket: answering it with an empty table is answering
    // a question nobody asked
    expect(source).toContain('function pickFolder(row)');
    expect(source).toContain('recursive: same ? false : filter.recursive || (!row.direct && row.under > 0)');
  });

  it('works out unfiled from what the folders do not cover', () => {
    expect(source).toContain('const unfiledCount = $derived(');
  });

  it('takes a field in two numbered steps and asks nothing between them', () => {
    expect(markup).toContain('<p class="heading">1 · which field</p>');
    expect(markup).toContain('{#if filter.attrKey}');
    expect(markup).toContain('<p class="heading">2 · which value</p>');
  });

  it('lets a date range be typed when a preset is the wrong shape', () => {
    expect(markup).toContain('type="date"');
    // and the two spellings of the same axis never both apply
    expect(markup).toContain("since: event.currentTarget.value, added: ''");
  });
});

describe('the vocabulary explains itself', () => {
  it('carries the registry’s clause on the two menus of words nobody types', () => {
    expect(markup).toContain('title={familyHint(family)}');
    expect(markup).toContain('title={typeHint(entry.type)}');
  });

  it('writes no reading of its own for a family or a type', () => {
    expect(markup).not.toMatch(/title="[a-z ]*(claim|bookmark|capture|actor|material)/i);
  });
});

describe('a toggle has no menu to open', () => {
  it('acts on the click that chose it, since there is nothing to pick', () => {
    expect(source).toContain("if (axis === 'connections')");
    expect(source).toContain("connections: filter.connections === 'none' ? '' : 'none'");
  });

  it('reads the fields only when that axis is opened', () => {
    expect(source).toContain("if (axis === 'field') onfields();");
  });
});

describe('the popovers close', () => {
  it('on a press anywhere but inside the one that is open, and on Escape', () => {
    // scoped to the open control rather than to the bar: pressing the search box or
    // another chip is as much "somewhere else" as pressing the table
    expect(source).toContain("if (event.target.closest?.('.anchor.live')) return;");
    expect(source).toContain("open = '';");
    expect(source).toContain("event.key === 'Escape' && (open = '')");
    expect(markup).toContain("class:live={open === '+'}");
    expect(markup).toContain('class:live={open === chip.axis}');
  });

  it('hangs each one off the control that opened it, measuring nothing', () => {
    expect(source).toMatch(/\.anchor \{[^}]*position: relative;/);
    expect(source).toMatch(/\.pop \{[^}]*position: absolute;/);
  });
});
