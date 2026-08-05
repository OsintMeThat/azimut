import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Board.svelte', import.meta.url), 'utf8');

describe('the board is what makes the vocabulary reachable', () => {
  it('creates the hand-made types, which nothing else could', () => {
    // before this, a case could hold a person, an account or a claim only through
    // the API: the registry declared them and the verbs accepted them, but no
    // screen made one — so a bookmark had nothing to be related to
    expect(source).toContain('creatableTypes()');
    expect(source).toContain(`api.post(\`/api/cases/\${caseState.current.id}/entities\``);
    expect(source).toContain('New entity');
  });

  it('builds the create form from the registry instead of a form per type', () => {
    expect(source).toContain("import AttrFields from '../components/AttrFields.svelte'");
    expect(source).toContain('<AttrFields type={draft.type} bind:values={draft.attrs} />');
  });

  it('names the identity field for the chosen type and accepts notes before creation', () => {
    expect(source).toContain('entityIdentityLabel(draft?.type)');
    expect(source).toContain('entityIdentityPlaceholder(draft?.type)');
    expect(source).toContain('for="board-notes"');
    expect(source).toContain("...(draft.notes.trim() ? { notes: draft.notes.trim() } : {})");
    expect(source).not.toContain('>Name</label>');
  });

  it('keeps Details compact while typed fields use the available row', () => {
    expect(source).toContain('width="640px"');
  });

  it('opens what it just created, since a claim exists to be pointed at things', () => {
    expect(source).toContain('openId = entity.id;');
  });

  it('opens any row in the one Details panel every other surface uses', () => {
    expect(source).toContain("import EntityDetails from '../components/EntityDetails.svelte'");
    expect(source).toContain('ondeleted={() => (openId = null)}');
  });

  it('takes its icons from the registry rather than a fifth hand-kept map', () => {
    expect(source).toContain("import { entityIcon } from '../lib/entityIcon.js'");
    expect(source).not.toContain('ENTITY_ICON');
  });
});

describe('the vocabulary explains itself', () => {
  it('says what a family is where it offers one', () => {
    // families are the load-bearing idea and the one part an analyst never types
    expect(source).toContain("title={familyReads(family) || 'Filter by family'}");
  });

  it('says what a type is where it offers one, including in the create menu', () => {
    expect(source).toContain("title={entityHint(type) || 'Filter by type'}");
    expect(source).toContain('title={entityHint(draft.type)}');
    expect(source).toContain('title={entityHint(entity.type)}');
  });

  it('says what a proposal is, since the tag is the only thing marking one', () => {
    expect(source).toContain('title="a tool proposed this, and nobody has confirmed it"');
  });

  it('takes every reading from the registry rather than writing one here', () => {
    const markup = source.slice(source.indexOf('</script>'));
    // the only titles in the markup are either registry readings or the fallback
    // that names the control itself
    expect(markup).not.toMatch(/title="[a-z ]*(claim|bookmark|capture|actor|material)/i);
  });
});

describe('bounded loading', () => {
  it('reads one page of the catalog, never the whole graph', () => {
    expect(source).toContain('createPagedList');
    expect(source).toContain('buildCatalogQuery');
    expect(source).toContain('limit: PAGE');
    expect(source).toContain('/catalog/summary');
  });

  it('offers Show more with an honest total', () => {
    expect(source).toContain('{#if pl.hasMore}');
    expect(source).toContain('pl.loadMore()');
    expect(source).toContain('Showing {rows.length} of {total}');
  });

  it('counts against the filtered page, not the case-wide summary', () => {
    // "40 of 5000" while showing only places is a denominator from another question
    expect(source).toContain(
      'const total = $derived(filtering ? pl.total : summary?.total ?? pl.total)'
    );
  });

  it('hands the term to the list, which is what searches past one page', () => {
    // client-side filtering is switched off in server mode, so without this the box
    // goes quiet at exactly the case size that needs it
    expect(source).toContain('pl.setQuery(query);');
  });

  it('drops the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
    expect(source).toContain("if (caseState.current?.id === id) summary = s;");
  });

  it('re-establishes the baseline when a filter changes', () => {
    // page two of "every type" is not page two of "places"
    expect(source).toContain('const key = `${family}|${type}|${status}`');
    expect(source).toContain('void pl.reload()');
  });

  it('filters a small case in memory, so typing costs no request', () => {
    expect(source).toContain('pl.serverMode || !query.trim()');
  });
});

describe('filters', () => {
  it('filters by family and by type, the family resolved to its types here', () => {
    // the family layer is server vocabulary; the catalog endpoint speaks types, so
    // one is turned into the other rather than growing a route
    expect(source).toContain('entityFamilies()');
    expect(source).toContain('type ? [type] : family ? typesInFamily.map((entry) => entry.type) : []');
    expect(source).toContain('types: wantedTypes');
  });

  it('narrows the type menu to the chosen family, and drops a type it leaves behind', () => {
    expect(source).toContain('entityTypes().filter((entry) => !family || entry.family === family)');
    expect(source).toContain('function setFamily(value)');
  });

  it('separates what a tool proposed from what the analyst stated', () => {
    expect(source).toContain("status: status || undefined");
    expect(source).toContain('<option value="suggested">Suggested</option>');
  });
});

describe('one table, and it scrolls', () => {
  it('is the tool shell, so the rows scroll instead of the page growing', () => {
    // `.tool` is a full-height flex column; a body without min-height:0 pushes the
    // column past the viewport and nothing scrolls at all
    expect(source).toContain('<div class="tool">');
    expect(source).toContain('.body {');
    expect(source).toMatch(/\.body \{[^}]*min-height: 0;/);
    expect(source).toMatch(/\.body \{[^}]*overflow: auto;/);
  });

  it('keeps the headings in place while the rows move under them', () => {
    expect(source).toMatch(/\.table th \{[^}]*position: sticky;/);
  });

  it('offers one view rather than two readings of the same rows', () => {
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toContain('class="views"');
    expect(source).not.toContain("view = 'list'");
  });

  it('adds a type’s own columns only when a single type is picked', () => {
    // a column blank for four rows out of five is noise
    expect(source).toContain('const columns = $derived(type ? entityFields(type) : [])');
  });

  it('reads cells rather than editing them, and imports nothing', () => {
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toContain('contenteditable');
    expect(markup).not.toMatch(/\bCSV\b/);
    // no cell holds an input: the Sheet is the editable view, this is the list
    expect(markup.slice(markup.indexOf('<table'), markup.indexOf('</table>'))).not.toContain('<input');
  });
});

describe('sorting', () => {
  it('sorts on any heading, and reverses on a second click', () => {
    expect(source).toContain('function sortBy(key)');
    expect(source).toContain('if (sortKey === key) sortDesc = !sortDesc;');
    expect(source).toContain('aria-sort={sortKey === column.key');
  });

  it('sorts a number as a number', () => {
    // "100" before "25" is the classic table bug
    expect(source).toContain("if (field.kind === 'number')");
    expect(source).toContain('(left - right) * direction');
  });

  it('compares text the way the reader’s language does', () => {
    expect(source).toContain('localeCompare');
  });

  it('drops the ordering when its column leaves the table', () => {
    expect(source).toContain('if (sortKey && !keys.includes(sortKey)) sortKey = ');
  });

  it('says the ordering is over the rows loaded while there are more', () => {
    // an alphabet over the first hundred of eight hundred rows looks exactly like
    // an alphabet over the case
    expect(source).toContain("sortKey ? ', sorted over the rows loaded' : ''");
  });
});

describe('a proposal can be settled here', () => {
  it('offers the two clicks on the row, not only inside the panel', () => {
    // filtering to Suggested and then having to open each row to accept it made
    // the filter a list nobody could act on
    expect(source).toContain('async function confirmEntity(entity)');
    expect(source).toContain('async function dismissEntity(entity)');
    expect(source).toContain("status: 'confirmed',");
    expect(source).toContain('title="Confirm this item"');
  });

  it('dismisses through the standard delete, so it stays recoverable', () => {
    expect(source).toContain("import { deletedToast } from '../lib/trash.js'");
    expect(source).toContain('deletedToast(caseId, result, entity.label)');
  });

  it('keeps a review click off the row it sits on', () => {
    expect(source).toContain('e.stopPropagation(); confirmEntity(entity);');
    expect(source).toContain('e.stopPropagation(); dismissEntity(entity);');
  });
});

describe('the table answers a keyboard', () => {
  it('makes each row focusable and Enter open it', () => {
    expect(source).toContain('tabindex="0"');
    expect(source).toContain("if (e.key === 'Enter' || e.key === ' ')");
    expect(source).toContain('.table tbody tr:focus-visible {');
  });
});

describe('creating one', () => {
  it('starts from the family already being looked at', () => {
    expect(source).toContain(
      'creatableTypes().filter((entry) => !family || entry.family === family)'
    );
  });

  it('names the first column after the chosen type, as the create form does', () => {
    expect(source).toContain("const identityColumn = $derived(type ? entityIdentityLabel(type) : 'Name')");
  });

  it('warns when an identifier value is already in the case', () => {
    // in that family the value is the identity, so a second record is two rows for
    // one thing — a warning, never a block: merging is not shipped
    expect(source).toContain("entityFamily(kind) !== 'identifier'");
    expect(source).toContain('This case already holds');
    expect(source).toContain('disabled={saving || !draft.type || !draft.label.trim()}');
  });

  it('asks before a close would throw away an unsaved field', () => {
    expect(source).toContain('function closeDetails()');
    expect(source).toContain('if (dirty) discarding = true;');
    expect(source).toContain('title="Discard changes?"');
  });
});

describe('taking a file into the case', () => {
  it('imports through the one media chokepoint rather than a second path', () => {
    // hash, dedupe, sidecar, thumbnail, enrichment and provenance all hang off it
    expect(source).toContain('/media/upload');
    expect(source).toContain("form.append('file', file)");
    expect(source).toContain('Add file');
  });

  it('takes a drop on the list as well as a click', () => {
    expect(source).toContain('ondrop=');
    expect(source).toContain('importFiles(e.dataTransfer?.files)');
    expect(source).toContain('Drop to file it in this case');
  });

  it('says what happened, duplicates included', () => {
    // the same bytes twice is not an error and not a second item
    expect(source).toContain('result.duplicate');
    expect(source).toContain('duplicate${duplicates > 1');
  });

  it('opens one file where the analyst can say what it is, and a batch nowhere', () => {
    expect(source).toContain('if (files.length === 1 && last) openId = last;');
  });
});

describe('where a graph-only type is read', () => {
  it('opens the entity another surface handed over', () => {
    // a person, an account, a claim have no tool of their own to be reopened in
    expect(source).toContain('uiState.openBoardEntity');
    expect(source).toContain('openId = id;');
  });
});
