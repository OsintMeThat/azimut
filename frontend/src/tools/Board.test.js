import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Board.svelte', import.meta.url), 'utf8');

describe('the board is what makes the vocabulary reachable', () => {
  it('creates the hand-made types, which nothing else could', () => {
    // before this, a case could hold a person, an account or a claim only through
    // the API: the registry declared them and the verbs accepted them, but no
    // screen made one — so a bookmark had nothing to be related to
    expect(source).toContain('creatableTypes()');
    expect(source).toContain('New entity');
    // the dialog itself is shared with the graph, so a claim is filed with the same
    // words wherever the analyst is standing (`EntityCreate.test.js`)
    expect(source).toContain("import EntityCreate from '../components/EntityCreate.svelte'");
  });

  it('opens the shared dialog on the type already being looked at', () => {
    expect(source).toContain('startType={draft.type}');
    expect(source).toContain('oncreated={(entity) => {');
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

  it('uses the primary photo when an entity has one', () => {
    expect(source).toContain('{#if entity.thumb}');
    expect(source).toContain("entity.thumb.startsWith('data:')");
    expect(source).toContain('fileUrl(caseState.current.id, entity.thumb)');
    expect(source).toContain('{:else}\n                  <Icon name={entityIcon(entity)}');
  });
});

describe('the vocabulary explains itself', () => {
  it('hands the registry’s own readings to the menus that offer them', () => {
    // families are the load-bearing idea and the one part an analyst never types, so
    // the filter menu carries the clause the registry declares rather than one of its
    // own (`FilterBar.test.js` holds the other half)
    expect(source).toContain('familyHint={familyReads}');
    expect(source).toContain('typeHint={entityHint}');
  });

  it('says what a type is where it offers one', () => {
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
    expect(source).toContain('pl.hasMore');
    expect(source).toContain('pl.loadMore()');
    expect(source).toContain('Showing {rows.length} of {matchCount}');
  });

  it('counts the answer against the whole case, since a proportion is the point', () => {
    // a denominator that shrinks with the numerator carries no information at all
    expect(source).toContain('const caseTotal = $derived(summary?.total ?? pl.total)');
    expect(source).toContain('<strong>{matchCount}</strong> of {caseTotal}');
  });

  it('counts a memory-filtered page itself, since the server never heard the term', () => {
    expect(source).toContain(
      "pl.serverMode || !filter.q.trim() ? pl.total : matching.length"
    );
  });

  it('hands the term to the list, which is what searches past one page', () => {
    // client-side filtering is switched off in server mode, so without this the box
    // goes quiet at exactly the case size that needs it
    expect(source).toContain('pl.setQuery(filter.q);');
  });

  it('drops the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
    expect(source).toContain("if (caseState.current?.id === id) summary = s;");
  });

  it('re-establishes the baseline when the question changes', () => {
    // page two of "every type" is not page two of "places", and the request itself is
    // the key: a term that changes nothing about what is asked reloads nothing
    expect(source).toMatch(
      /const asked = JSON\.stringify\(\[\s*toQuery\(filter, \{ types: wantedTypes \}\), order, analysisSearch\.snapshotId,\s*\]\)/
    );
    expect(source).toContain('void pl.reload()');
  });

  it('filters a small case in memory, so typing costs no request', () => {
    expect(source).toContain("pl.serverMode || !filter.q.trim()");
  });
});

describe('the question is one value, and one bar that never changes shape', () => {
  it('holds every term in one filter rather than a state per select', () => {
    // seven selects, four of which appeared and disappeared as the others were set:
    // a live term looked exactly like a dead one, and a control that vanished took
    // its own way back with it
    expect(source).toContain("import FilterBar from '../components/FilterBar.svelte'");
    expect(source).toContain('let filter = $state(emptyFilter());');
    expect(source).toContain('<FilterBar');
    expect(source).toContain('bind:filter');
    // and none of the old selects survive in the toolbar
    const markup = source.slice(source.indexOf('</script>'));
    expect(markup).not.toContain('Every family');
    expect(markup).not.toContain('Every type');
    expect(markup).not.toContain('Any field');
  });

  it('resolves families to types here, as the catalog endpoint speaks types', () => {
    expect(source).toContain('const wantedTypes = $derived(');
    expect(source).toContain('filter.families.length');
    expect(source).toContain('...toQuery({ ...filter, q }, { types: wantedTypes })');
  });

  it('narrows the type menu to the chosen families, and drops a type they leave out', () => {
    expect(source).toContain(
      '(entry) => !filter.families.length || filter.families.includes(entry.family)'
    );
    expect(source).toContain('if (inside.length !== filter.types.length)');
  });

  it('offers a family only where the case holds one', () => {
    // offering a family nothing is filed under is offering an empty answer
    expect(source).toContain('Object.keys(summary?.by_type ?? {})');
  });

  it('reads the fields on the click that opens their menu, not on mount', () => {
    // the scan is what reaches `kind`, which the importer writes and the vocabulary
    // declares nowhere — gating it behind picking a type first is what made the most
    // useful filter in the app invisible
    expect(source).toContain('fetchAttrFacets(id, wantedTypes)');
    expect(source).toContain('onfields={() => (fieldsWanted = true)}');
    expect(source).toContain('if (!wantedTypes.length && !fieldsWanted) {');
  });

  it('asks for a type first only on a case too large for the menu to be read', () => {
    expect(source).toContain('const FACET_SCAN_MAX = 5000');
    expect(source).toContain("facetState = 'narrow-first'");
  });

  it('drops a term the narrowing has left with nothing to answer, and says so', () => {
    // a filter still on screen that the current rows cannot carry reads as one that
    // stopped working
    expect(source).toContain("filter = clearAxis(filter, 'field');");
    expect(source).toContain('so that term went');
  });

  it('remembers the question per case, in the browser rather than in the case', () => {
    // an unnamed question is remembered locally; naming it turns it into case state
    expect(source).toContain('openAnalysisCase(id);');
    expect(source).toContain('setAnalysisFilter(caseState.current?.id, filter)');
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
    // a column blank for four rows out of five is noise, and two types picked at once
    // have no shared attributes to head
    expect(source).toContain("const onlyType = $derived(filter.types.length === 1 ? filter.types[0] : '')");
    expect(source).toContain('const columns = $derived(onlyType ? entityFields(onlyType) : [])');
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

  it('asks the case for the two orderings the store can answer', () => {
    // "newest first" over a hundred of eight hundred rows is not the newest of
    // anything, and that is the one sort a worked case needs most
    expect(source).toContain('const order = $derived(orderFor(sortKey, sortDesc))');
    expect(source).toContain('order,');
    expect(source).toContain('if (!sortKey || order) return matching;');
  });

  it('says the ordering is over the rows loaded only when it really is', () => {
    // an alphabet over the first hundred of eight hundred rows looks exactly like
    // an alphabet over the case — but the headings the store ordered have nothing
    // to warn about
    expect(source).toContain("sortKey && !order\n            ? ', sorted over the rows loaded'");
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
      '(entry) => !filter.families.length || filter.families.includes(entry.family)'
    );
    expect(source).toContain('type: onlyType || wanted[0]?.type');
  });

  it('names the first column after the chosen type, as the create form does', () => {
    expect(source).toContain(
      "const identityColumn = $derived(onlyType ? entityIdentityLabel(onlyType) : 'Name')"
    );
  });

  it('offers the row this case already holds under the same identifier', () => {
    // the warning itself lives in the shared dialog; what the Board owns is where the
    // offer lands — the existing row, opened
    expect(source).toContain('ontwin={(entity) => {');
    expect(source).toContain('openId = entity.id;');
  });

  it('asks before a close would throw away an unsaved field', () => {
    expect(source).toContain('function closeDetails()');
    expect(source).toContain('if (dirty) discarding = true;');
    expect(source).toContain('title="Discard changes?"');
  });
});

describe('a frozen analysis snapshot', () => {
  it('keeps its question and captured rows read-only while retaining details', () => {
    expect(source).toContain('const snapshotReading = $derived(Boolean(analysisSearch.snapshotId))');
    expect(source).toContain('disabled={!caseState.current || importing || snapshotReading}');
    expect(source).toContain('disabled={snapshotReading}');
    expect(source).toContain('{#if openId && !snapshotReading}');
    expect(source).toContain('{#if !snapshotReading}<span class="review">');
    expect(source).toContain('<Modal title="Snapshot details"');
    expect(source).toContain('<SnapshotDetails');
    expect(source).toContain('snapshotOpen = null;');
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

describe('handing the question to the drawing', () => {
  it('sends the question, never the rows it matched', () => {
    // ids would be capped, would bloat the URL and would go stale on the next save;
    // a filter is something the case can be asked again, and both surfaces resolve it
    // through one predicate — so what the drawing holds is what the table counted
    expect(source).toContain('uiState.drawInGraph = {');
    expect(source).toContain('terms: toGraphQuery(filter, { types: wantedTypes })');
    expect(source).toContain("uiState.tool = 'graph';");
    expect(source).not.toContain('keep:');
  });

  it('offers it only where there is an answer to draw, and says which', () => {
    expect(source).toContain('Draw these {matchCount}');
    expect(source).toContain('label: said,');
    expect(source).toContain('const drawTitle = $derived(');
  });
});

describe('a row reaches the drawing', () => {
  it('offers the graph from the row itself, not only from Details', () => {
    // a list is good at narrowing and says nothing about how things join up, so the
    // question a row most often raises is the one only the drawing answers
    expect(source).toContain('uiState.openGraphEntity = entity.id;');
    expect(source).toContain('aria-label="Show {entity.label} in the graph"');
  });

  it('keeps that click off the row it sits on', () => {
    expect(source).toMatch(/e\.stopPropagation\(\);\s*uiState\.openGraphEntity/);
  });

  it('stays quiet until the row is under the pointer, like the review clicks', () => {
    // eight hundred rows must not read as eight hundred buttons
    expect(source).toMatch(/\.table td\.go \.act \{[^}]*opacity: 0;/);
    expect(source).toContain('tr:hover td.go .act,');
  });
});

describe('adding the statements up', () => {
  it('renders the same question, through the switch the other lists already use', () => {
    // the chips stay where they are and the sentence is unchanged; what moves is how
    // the answer is drawn
    expect(source).toContain("import ViewSwitch from '../components/ViewSwitch.svelte'");
    expect(source).toContain("{ id: 'rows', label: 'Rows', icon: 'note'");
    expect(source).toContain("id: 'totals',");
    expect(source).toContain("onpick={(id) => (totalling = id === 'totals')}");
    expect(source).toContain('buildTallyQuery(caseState.current.id, toQuery(filter, { types: wantedTypes }))');
  });

  it('offers Totals from the first day, dimmed until it can draw a real line', () => {
    // a control you can see and cannot use teaches something; one that is not there
    // teaches nothing — the rule the filter menu already follows
    expect(source).toContain('disabled: nothingToDraw || empty || snapshotReading,');
    expect(source).toContain("'No statement counts anything about a subject yet'");
    expect(source).toContain("'Nothing in the table to add up'");
  });

  it('calls a line real only when a statement counts something about a subject', () => {
    // either half alone opens the total on nothing: "seen, not counted" is an answer
    // rather than a row, and a statement about nothing has no subject to sit under
    expect(source).toContain('const countable = $derived(summary?.countable ?? 0);');
    expect(source).toContain('const nothingToDraw = countable === 0;');
    expect(source).toContain('const empty = !rows.length;');
    // priced off the summary every filter term is priced from, so it costs no request
    expect(source).not.toContain('summary?.by_type?.claim');
  });

  it('re-reads after a write, since a relation is what changes a total', () => {
    // stating one while the total is on screen used to need the page reloaded before
    // it appeared; the row list and the panel's own total both read this already
    expect(source).toMatch(/caseState\.rev;\s*const url = buildTallyQuery/);
  });

  it('asks only while it is on screen, and not once per keystroke', () => {
    // a sum has no in-memory half to fall back on the way the row list does, so the
    // whole question is debounced rather than the text term alone
    expect(source).toContain('if (!totalling || snapshotReading || !caseState.current?.id) return;');
    expect(source).toContain('const TALLY_DELAY = 250;');
    expect(source).toMatch(/setTimeout\(\(\) => \{\s*tallying = true;/);
    expect(source).toContain('clearTimeout(timer);');
  });

  it('steps back to the list inside a frozen snapshot', () => {
    // a snapshot is a copy of rows rather than a question the case can still be asked
    expect(source).toContain('if (snapshotReading && totalling) totalling = false;');
    expect(source).toContain('A frozen snapshot holds rows rather than a question to add up');
  });

  it('never prints a sum without what was left out of it', () => {
    expect(source).toContain('countLines(row, claimReads)');
    expect(source).toContain('noteLines(row)');
    expect(source).toContain('readingNotes(tally)');
  });

  it('takes its words from the served registry, not from a list kept here', () => {
    expect(source).toContain("for (const field of entityFields('claim'))");
    expect(source).not.toContain("'destroyed'");
  });

  it('offers no Show more under a bounded total', () => {
    expect(source).toContain('{#if pl.hasMore && !totalling}');
  });

  it('opens the subject a row stands for', () => {
    expect(source).toContain('onclick={() => (openId = row.id)}');
  });
});

describe('Ctrl+V on the table', () => {
  it('files what the clipboard holds and opens the row it made', () => {
    expect(source).toContain("import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js'");
    expect(source).toContain("import PasteDialog from '../components/PasteDialog.svelte'");
    expect(source).toContain("resolvePaste('board', payload)");
    // opened, not just filed: the next gesture is relating it to what prompted it
    expect(source).toContain('openId = result.entity.id;');
    expect(source).toContain('openId = entity.id;');
  });

  it('only answers while it is the tool on screen', () => {
    expect(source).toMatch(/uiState\.tool !== 'board'\) return;\s*return listenForPaste/);
  });

  it('refuses to write into a frozen reading, and says why', () => {
    expect(source).toContain("toast('This snapshot is read-only. Leave it to paste.', 'warn')");
    expect(source).toContain('{#if pasted && !snapshotReading}');
  });
});
