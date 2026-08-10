<script>
  /**
   * The case as its graph: every entity the case holds, filtered, sorted and opened.
   *
   * Until this existed the vocabulary was reachable only through the API. A case
   * could hold a `person`, a `claim` or an `account` — the registry declared them,
   * the relation verbs accepted them — but no screen created one, so a bookmark had
   * nothing to be related *to* and a statement had nowhere to be read. That is what
   * this tool is: create the hand-made types, list what the case holds, and open any
   * row in the same Details panel every other surface uses.
   *
   * Bounded like every other list here (docs/STORAGE_AND_PERFORMANCE.md): one page
   * off the catalog endpoint, filters applied server-side, "Show more" for the rest.
   * A case that fits one page filters in memory, so typing costs no request.
   *
   * One view, a table. Two views of the same rows only asked which one was the real
   * one. The graph is what comes next, and that is a different question, not a
   * different rendering of this list.
  */
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    analysisSearch,
    openAnalysisCase,
    setAnalysisFilter,
  } from '../lib/analysisSearch.svelte.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { buildCatalogQuery, fetchAttrFacets } from '../lib/catalog.js';
  import { createPagedList } from '../lib/pagedList.svelte.js';
  import { entitySearchMatches, matchesEntity } from '../lib/entitySearch.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { folderOf } from '../lib/folderTree.js';
  import { deletedToast } from '../lib/trash.js';
  import {
    chipsOf,
    clearAxis,
    emptyFilter,
    isFiltering,
    normalizeFilter,
    orderFor,
    toGraphQuery,
    toQuery,
  } from '../lib/entityFilter.js';
  import {
    creatableTypes,
    entityFamily,
    entityFields,
    entityHint,
    entityIdentityLabel,
    entityLabel,
    entityTypes,
    familyReads,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import AnalysisViews from '../components/AnalysisViews.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import EntityCreate from '../components/EntityCreate.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import SnapshotDetails from '../components/SnapshotDetails.svelte';

  const PAGE = 100;
  /**
   * How large a case may be before a field menu asks for a type first.
   *
   * The field facets are read by scanning the stored attributes of everything the
   * narrowing covers, which is what lets the menu reach `kind` — a field the importer
   * writes and the vocabulary declares nowhere. Over a whole case that scan is worth
   * paying once, behind the click that opens the menu, and not worth paying at all on
   * a case where the menu it builds would be unreadable anyway.
   */
  const FACET_SCAN_MAX = 5000;

  loadEntityTypes();

  /**
   * The question being asked of the case, as one value (`lib/entityFilter.js`).
   *
   * It used to be six variables behind six selects, four of which appeared and
   * disappeared as the others were set — so a term that was live looked exactly like
   * one that was not, and the most useful filter in the app was invisible until you
   * happened to narrow by type first. One object, one chip per term, one bar that
   * never changes shape.
   */
  let filter = $state(emptyFilter());
  let facets = $state([]); // the fields these types hold, and their values
  /** Whether the field menu has anything to offer, or why it has not: nothing is
   *  scanned for a menu nobody has opened. */
  let facetState = $state('unasked'); // 'unasked' | 'loading' | 'ready' | 'narrow-first'
  let sortKey = $state(''); // '' = the catalog's own stable order
  let sortDesc = $state(false);
  let summary = $state(null); // { total, by_type, by_status, by_folder, by_source, unlinked }
  let openId = $state(null); // the row whose Details are open
  let snapshotOpen = $state(null); // a captured row, read without touching the live case
  let draft = $state(null); // the entity being created, or null
  let busyId = $state(null); // the row whose review action is in flight
  let discarding = $state(false); // Details closing with unsaved fields on screen
  let dirty = $state(false); // Details has edits the panel's Save has not taken

  /** The families the case actually holds, read off the summary: a filter offering a
   *  family nothing is filed under is offering an empty answer. */
  const families = $derived(
    [
      ...new Set(
        Object.keys(summary?.by_type ?? {})
          .map((type) => entityFamily(type))
          .filter(Boolean)
      ),
    ].sort()
  );
  /** The type menu follows the family chips: picking "actor" leaves two types to
   *  choose between rather than seventeen. */
  const typeOptions = $derived(
    entityTypes().filter(
      (entry) => !filter.families.length || filter.families.includes(entry.family)
    )
  );

  /** What the request asks for: the types picked, or every type of the families
   *  picked, or nothing at all — the family layer is server vocabulary, so it
   *  resolves to types here rather than needing a route of its own. */
  const wantedTypes = $derived(
    filter.types.length
      ? filter.types
      : filter.families.length
        ? typeOptions.map((entry) => entry.type)
        : []
  );

  /** The one type on screen, or '' for a mixed list. What decides the declared
   *  columns and what the first one is called: a column of addresses headed "Name" is
   *  the lie this vocabulary went to the trouble of avoiding, and a mixed list has no
   *  such reading to give. */
  const onlyType = $derived(filter.types.length === 1 ? filter.types[0] : '');

  /** A type left outside the families now chosen would filter to nothing, so it goes
   *  with them — the same rule the family select used to apply on its way out. */
  $effect(() => {
    if (!filter.families.length || !filter.types.length) return;
    const inside = filter.types.filter((type) =>
      typeOptions.some((entry) => entry.type === type)
    );
    if (inside.length !== filter.types.length) filter = { ...filter, types: inside };
  });

  const pl = createPagedList({
    fetchPage: ({ query: q, cursor }) =>
      api.get(
        buildCatalogQuery(caseState.current.id, {
          cursor,
          limit: PAGE,
          ...toQuery({ ...filter, q }, { types: wantedTypes }),
          order,
          view: analysisSearch.snapshotId || undefined,
        })
      ),
  });

  // Hand the term to the list, which records it on a small case and debounces a
  // server search on a large one. Without this the box would go quiet at exactly
  // the size that needs it: past one page, the rows are the server's answer and
  // filtering them here would search the page rather than the case.
  $effect(() => {
    pl.setQuery(filter.q);
  });

  // A small case never reaches the server for a keystroke, so the term is applied
  // here; a large one is already searching server-side and the rows are the answer.
  // Same predicate either way (`lib/entitySearch.js`), or the box would answer one
  // way under a hundred rows and another way over.
  const matching = $derived(
    pl.serverMode || !filter.q.trim()
      ? pl.items
      : pl.items.filter((e) => matchesEntity(e, filter.q))
  );
  const filtering = $derived(isFiltering(filter));
  const snapshotReading = $derived(Boolean(analysisSearch.snapshotId));
  /** How many the question matches, across the case. The page's own count, except on
   *  a small case searching in memory — there the server was never told the term, so
   *  its count would answer a wider question than the one on screen. */
  const matchCount = $derived(
    pl.serverMode || !filter.q.trim() ? pl.total : matching.length
  );
  /** What the answer is a part of. The **whole case**, always: a proportion is the
   *  information a count carries, and a denominator that shrinks with the numerator
   *  carries none. */
  const caseTotal = $derived(summary?.total ?? pl.total);

  /** The columns a table shows beyond the ones every entity has. Only when a single
   *  type is picked: a mixed list has no shared attributes, and a column that is
   *  blank for four rows out of five is noise. Read-only here — editing cells and
   *  CSV are the Case Sheet's, not this list's. */
  const columns = $derived(onlyType ? entityFields(onlyType) : []);

  /** What the first column is called. Once a single type is picked it holds that
   *  type's own identity — an IP address, a handle — and the create form already
   *  says so; "Name" over a column of addresses is the same lie this vocabulary
   *  went to the trouble of avoiding. Mixed rows have no such reading. */
  const identityColumn = $derived(onlyType ? entityIdentityLabel(onlyType) : 'Name');

  /**
   * Which ordering the store is being asked for, or '' when the sort is this page's
   * own (`lib/entityFilter.js`).
   *
   * Two of the headings name a column the case can be ordered by, and clicking one
   * asks the **case** for its newest or its alphabet rather than sorting the hundred
   * rows that happen to be loaded. The other headings have no such column, so they
   * keep the client sort and say so. One gesture either way: which of the two it is
   * is a property of the column, not a second control the analyst has to find.
   */
  const order = $derived(orderFor(sortKey, sortDesc));

  /** Sorted here only when the store did not sort it. What the note beside "Show
   *  more" is about: an alphabet over the first hundred of eight hundred rows looks
   *  exactly like an alphabet over the case. */
  const rows = $derived.by(() => {
    if (!sortKey || order) return matching;
    const direction = sortDesc ? -1 : 1;
    return [...matching].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
  });

  function sortValue(entity, key) {
    if (key === 'label') return (entity.label ?? '').toLowerCase();
    if (key === 'type') return entityLabel(entity.type).toLowerCase();
    if (key === 'folder') return folderName(entity).toLowerCase();
    if (key === 'created') return entity.provenance?.at ?? '';
    const field = columns.find((column) => column.key === key);
    if (!field) return '';
    // a number sorts as one: "100" before "25" is the classic table bug
    if (field.kind === 'number') {
      const value = Number(entity.attrs?.[field.key]);
      return Number.isFinite(value) ? value : -Infinity;
    }
    return cell(entity, field).toLowerCase();
  }

  /** Click a heading to sort by it, click it again to reverse. A third click is not
   *  a third state: the catalog's order is what the empty sort already is. */
  function sortBy(key) {
    if (sortKey === key) sortDesc = !sortDesc;
    else {
      sortKey = key;
      sortDesc = false;
    }
  }

  let loadedFor = null;
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // a save, a delete or a relation stated in the panel
    if (!id) {
      pl.clear();
      summary = null;
      loadedFor = null;
      return;
    }
    if (loadedFor !== id) {
      loadedFor = id;
      pl.clear();
      // The question travels with the case, not with the tab: reopening Azimut on a
      // case lands on what was being asked of it.
      openAnalysisCase(id);
      filter = normalizeFilter(analysisSearch.filter);
      fieldsWanted = false;
      facetState = 'unasked';
    }
    void pl.reload();
    api
      .get(`/api/cases/${id}/catalog/summary`)
      .then((s) => {
        if (caseState.current?.id === id) summary = s;
      })
      .catch(() => {});
  });

  // Graph edits the same Search+ value while this mounted tool is hidden. Mirror
  // that value back into the local bindable object without waiting for a case reload.
  $effect(() => {
    const id = caseState.current?.id;
    const shared = JSON.stringify(analysisSearch.filter);
    if (
      !id || analysisSearch.caseId !== id ||
      shared === untrack(() => JSON.stringify(filter))
    ) return;
    untrack(() => (filter = normalizeFilter(analysisSearch.filter)));
  });

  // A filter is a different request, so the baseline is re-established rather than
  // filtered out of what is already loaded — page two of "every type" is not page
  // two of "places".
  // Seeded with the filter's own initial value, so opening the board is one request
  // rather than this effect and the case effect above both asking for page one.
  let lastAsked = null;
  $effect(() => {
    const asked = JSON.stringify([
      toQuery(filter, { types: wantedTypes }), order, analysisSearch.snapshotId,
    ]);
    if (asked === lastAsked) {
      setAnalysisFilter(caseState.current?.id, filter);
      return;
    }
    const first = lastAsked === null;
    lastAsked = asked;
    setAnalysisFilter(caseState.current?.id, filter);
    // The text term is the paged list's own, debounced there; asking again here would
    // be a second request per keystroke.
    if (!first && caseState.current?.id) void pl.reload();
  });

  /**
   * The fields on offer follow the types being listed, in one bounded read.
   *
   * **Read on demand**, which is the change that stopped the field filter being
   * invisible: the scan costs the stored attributes of everything the narrowing
   * covers, so it used to be gated behind picking a type first — and an analyst who
   * had not picked one never learnt the filter existed. Now the gate is the click
   * that opens the menu, which is the explicit act the cost was always worth paying
   * behind, and only a case too large for the menu to be readable still asks for a
   * type first.
   *
   * A field that survives a narrowing keeps its value, since changing the type filter
   * must not silently drop the term beside it; one that does not is cleared and said,
   * because a question about a field nothing on screen carries has no answer.
   */
  let fieldsWanted = $state(false);
  let facetsFor = null;
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // a save can add the first entity carrying a field
    const key = `${id ?? ''}|${wantedTypes.join(',')}|${caseState.rev}`;
    if (!id) {
      facets = [];
      facetsFor = null;
      facetState = 'unasked';
      return;
    }
    if (!wantedTypes.length && (summary?.total ?? 0) > FACET_SCAN_MAX) {
      facets = [];
      facetsFor = null;
      facetState = 'narrow-first';
      return;
    }
    if (!wantedTypes.length && !fieldsWanted) {
      facets = [];
      facetsFor = null;
      facetState = 'unasked';
      return;
    }
    if (facetsFor === key) return;
    facetsFor = key;
    facetState = 'loading';
    fetchAttrFacets(id, wantedTypes)
      .then((rows) => {
        if (caseState.current?.id !== id) return;
        facets = rows;
        facetState = 'ready';
        if (filter.attrKey && !rows.some((row) => row.key === filter.attrKey && row.values.length)) {
          const dropped = filter.attrKey;
          filter = clearAxis(filter, 'field');
          toast(`Nothing on screen carries ${dropped}, so that term went`, 'warn');
        }
      })
      .catch(() => {
        facets = [];
        facetState = 'ready';
      });
  });

  // A value that is no longer among the field's own is not a term the table can
  // answer, and left on screen it would read as a filter that stopped working.
  $effect(() => {
    if (!filter.attrValue) return;
    const held = facets.find((row) => row.key === filter.attrKey)?.values ?? [];
    if (held.length && !held.some((row) => row.value === filter.attrValue)) {
      filter = { ...filter, attrValue: '' };
    }
  });

  // A column that is no longer on screen cannot go on ordering the table.
  $effect(() => {
    const keys = ['label', 'type', 'folder', 'created', ...columns.map((c) => c.key)];
    if (sortKey && !keys.includes(sortKey)) sortKey = '';
  });

  /** Start from what the analyst is already looking at: the chosen type, or the
   *  first type of the chosen family. Opening on "Person" while the family chip
   *  says Identifier is the menu ignoring the question just asked. */
  function startCreate() {
    if (snapshotReading) return;
    const wanted = creatableTypes().filter(
      (entry) => !filter.families.length || filter.families.includes(entry.family)
    );
    draft = {
      type: onlyType || wanted[0]?.type || creatableTypes()[0]?.type || '',
      label: '',
      notes: '',
      attrs: {},
    };
  }

  /** Accept a machine's proposal. The far end of its suggested relations comes with
   *  it, which is the invariant the API keeps: an edge is confirmed together with
   *  the entity it hangs off, or neither is. */
  async function confirmEntity(entity) {
    if (snapshotReading) return;
    if (busyId) return;
    busyId = entity.id;
    try {
      await api.patch(`/api/cases/${caseState.current.id}/entities/${entity.id}`, {
        status: 'confirmed',
      });
      await reloadCase();
      toast('Confirmed', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  /** Drop a proposal. The standard delete, so it lands in the case trash with the
   *  same Undo as every other one — dismissing a machine's reading is not a reason
   *  to make it unrecoverable. */
  async function dismissEntity(entity) {
    if (snapshotReading) return;
    if (busyId) return;
    busyId = entity.id;
    const caseId = caseState.current.id;
    try {
      const result = await api.del(`/api/cases/${caseId}/entities/${entity.id}`);
      await reloadCase();
      deletedToast(caseId, result, entity.label);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busyId = null;
    }
  }

  /**
   * Take a file into the case: a PDF, a scan, a plan, an exported mail.
   *
   * The same import the Media Library runs, offered where the case is read rather
   * than only under "Media" — a word that says nothing about a scanned plan. The
   * file lands as a `media` of whatever kind its bytes are (ONTOLOGY §2), hashed,
   * deduped on that hash, and relatable like everything else here.
   */
  let fileInput = $state();
  let importing = $state(false);
  let dragOver = $state(false);

  async function importFiles(fileList) {
    const files = [...(fileList ?? [])];
    if (snapshotReading) return;
    if (!files.length || !caseState.current || importing) return;
    const caseId = caseState.current.id;
    importing = true;
    let added = 0;
    let duplicates = 0;
    let last = null;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        try {
          const result = await api.post(`/api/cases/${caseId}/media/upload`, form);
          if (result.duplicate) duplicates++;
          else added++;
          last = result.entity?.id ?? last;
        } catch (e) {
          toast(`${file.name}: ${e.message}`, 'danger');
        }
      }
      await reloadCase();
      if (added) toast(`${added} file${added > 1 ? 's' : ''} added to the case`, 'ok');
      // The same bytes twice is not an error and not a second item: the case keeps
      // the one it has, and saying so is what stops the analyst importing again.
      if (duplicates) {
        toast(
          `${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped (same SHA-256)`,
          'warn'
        );
      }
      // One file opens where the analyst can say what it is; a batch does not, since
      // a panel over the list would be about whichever one happened to land last.
      if (files.length === 1 && last) openId = last;
    } finally {
      importing = false;
    }
  }

  function closeDetails() {
    if (dirty) discarding = true;
    else openId = null;
  }

  // Following a relation to a person, an account or a claim lands here: those types
  // have no tool of their own, so `navigate.openEntity` hands the id over instead.
  $effect(() => {
    const id = uiState.openBoardEntity;
    if (!id) return;
    uiState.openBoardEntity = null;
    if (snapshotReading) {
      snapshotOpen = analysisSearch.activeView?.spec?.snapshot?.entities?.find(
        (entity) => entity.id === id
      ) ?? null;
    } else {
      openId = id;
    }
  });

  /** The slug with a capital, not a second vocabulary: the families are code, and
   *  inventing readings for them here is how two lists start. */
  const familyTitle = (family) => family.charAt(0).toUpperCase() + family.slice(1);

  /** The question as one sentence, which is what the graph writes over the drawing
   *  so nobody has to remember what they asked two tabs ago. */
  const said = $derived(
    [
      filter.q.trim() ? `“${filter.q.trim()}”` : '',
      ...chipsOf(filter, { type: entityLabel, family: familyTitle }).map((chip) => chip.text),
    ]
      .filter(Boolean)
      .join(' · ')
  );
  const drawTitle = $derived(`Draw this question in the graph: ${said}`);

  /**
   * Hand the question to the graph.
   *
   * The **filter** goes over, never the ids it matched. A list of ids would be capped,
   * would bloat the URL, and would go stale the moment anything was saved; the filter
   * is a question the case can be asked again, and both surfaces resolve it through
   * one predicate — so what the drawing holds is what the table counted.
   */
  function drawAnswer() {
    uiState.drawInGraph = {
      terms: toGraphQuery(filter, { types: wantedTypes }),
      label: said,
      filter: normalizeFilter(filter),
    };
    uiState.tool = 'graph';
  }

  /** The portable recipe. Snapshot rows are resolved server-side from the same
   *  question, so a case larger than the page is never silently cut to what loaded. */
  function captureAnalysisView() {
    return {
      version: 1,
      query: {
        filter: normalizeFilter(filter),
        terms: toGraphQuery(filter, { types: wantedTypes }),
        label: said,
      },
      board: { order, sortKey, sortDesc },
      timeline: { from: null, to: null, field: null },
    };
  }

  async function openAnalysisView(view) {
    openId = null;
    snapshotOpen = null;
    filter = normalizeFilter(view.spec?.query?.filter);
    const board = view.spec?.board ?? {};
    sortKey = typeof board.sortKey === 'string' ? board.sortKey : '';
    sortDesc = board.sortDesc === true;
    if (view.surface === 'graph') uiState.tool = 'graph';
  }

  let appliedViewId = null;
  $effect(() => {
    const view = analysisSearch.activeView;
    if (!view) {
      appliedViewId = null;
      return;
    }
    if (view.surface !== 'board' || view.id === appliedViewId) return;
    appliedViewId = view.id;
    untrack(() => void openAnalysisView(view));
  });

  let observedLiveView = null;
  let observedLiveState = '';
  $effect(() => {
    const view = analysisSearch.activeView;
    if (!view || view.mode !== 'live' || view.surface !== 'board') {
      observedLiveView = null;
      observedLiveState = '';
      return;
    }
    const savedFilter = normalizeFilter(view.spec?.query?.filter);
    const savedBoard = view.spec?.board ?? {};
    const current = JSON.stringify({
      filter: normalizeFilter(filter),
      sortKey,
      sortDesc,
    });
    const saved = JSON.stringify({
      filter: savedFilter,
      sortKey: typeof savedBoard.sortKey === 'string' ? savedBoard.sortKey : '',
      sortDesc: savedBoard.sortDesc === true,
    });
    if (observedLiveView !== view.id) {
      observedLiveView = view.id;
      observedLiveState = current;
    } else if (current !== observedLiveState) {
      observedLiveState = current;
      analysisSearch.changeVersion += 1;
    }
    analysisSearch.modified = current !== saved;
  });

  function leaveAnalysisReading() {
    appliedViewId = null;
    openId = null;
    snapshotOpen = null;
    filter = normalizeFilter(analysisSearch.filter);
  }

  const matchReasons = (entity) =>
    entity.matches?.length ? entity.matches : entitySearchMatches(entity, filter.q);
  const folderName = (entity) => folderOf(entity) || '';
  const created = (entity) => (entity.provenance?.at ?? '').slice(0, 10);
  const isSuggested = (entity) => entity.provenance?.status === 'suggested';
  /** Declared fields hold text, a number or a closed grade. A shape is not
   *  a cell, so it says what it is rather than spilling coordinates across a row. */
  const cell = (entity, field) => {
    const value = entity.attrs?.[field.key];
    if (value == null || value === '') return '';
    if (field.kind === 'geojson') return 'traced area';
    return String(value);
  };
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Board</h2>
    <span class="sub">Everything this case holds</span>
    <div class="spacer"></div>
    <AnalysisViews
      surface="board"
      capture={captureAnalysisView}
      onopen={openAnalysisView}
      onleave={leaveAnalysisReading}
    />
    <button
      class="btn"
      title="Take a file into the case: a document, a scan, a plan, an image"
      disabled={!caseState.current || importing || snapshotReading}
      onclick={() => fileInput?.click()}
    >
      <Icon name="upload" size={14} /> {importing ? 'Adding…' : 'Add file'}
    </button>
    <input
      type="file"
      multiple
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        importFiles(e.currentTarget.files);
        e.currentTarget.value = '';
      }}
    />
    <button class="btn btn-primary" onclick={startCreate} disabled={!caseState.current || snapshotReading}>
      <Icon name="plus" size={14} /> New entity
    </button>
  </div>

  <!-- The question, as a bar that never changes shape: a search, one menu, and a chip
       per term. Every menu behind it is built from what the case holds and counted,
       so a term says how much of an answer it is before it is chosen. -->
  <FilterBar
    bind:filter
    {summary}
    {facets}
    {facetState}
    {families}
    caseFolders={caseState.current?.folders ?? []}
    types={typeOptions}
    familyName={familyTitle}
    typeName={entityLabel}
    familyHint={familyReads}
    typeHint={entityHint}
    onfields={() => (fieldsWanted = true)}
    disabled={snapshotReading}
  />

  <!-- The answer, and what it is an answer out of. The denominator is the whole case
       even under a filter: a proportion is the information a count carries. -->
  <p class="answer">
    {#if !caseState.current}
      &nbsp;
    {:else if filtering}
      <strong>{matchCount}</strong> of {caseTotal}
      <!-- The table is good at narrowing and says nothing about how things join up;
           the drawing is the opposite. This is the one gesture between them, and it
           hands over the **question** rather than the rows it matched — so it works at
           any size, and the drawing stays live as the case changes under it. -->
      <button class="as-link" onclick={drawAnswer} title={drawTitle}>
        Draw these {matchCount}
      </button>
    {:else}
      {caseTotal} in this case
    {/if}
  </p>

  <!-- Dropping a file onto the list files it, the way the Media Library takes one.
       `dragleave` is guarded on the container itself: the event fires for every
       child the pointer crosses, so an unguarded handler flickers the overlay off
       halfway across the table. -->
  <div
    class="body"
    role="presentation"
    ondragover={(e) => {
      if (!caseState.current || snapshotReading) return;
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={(e) => {
      if (e.target === e.currentTarget) dragOver = false;
    }}
    ondrop={(e) => {
      e.preventDefault();
      dragOver = false;
      importFiles(e.dataTransfer?.files);
    }}
  >
    {#if dragOver}
      <div class="drop-overlay">
        <div class="drop-box">
          <Icon name="upload" size={28} />
          <span>Drop to file it in this case</span>
        </div>
      </div>
    {/if}
    {#if !caseState.current}
      <p class="empty">Open a case to see what it holds.</p>
    {:else if !rows.length && !pl.loading}
      <p class="empty">{filtering ? 'Nothing matches.' : 'Nothing filed in this case yet.'}</p>
    {:else}
      <table class="table">
        <thead>
          <tr>
            {#each [
              { key: 'label', label: identityColumn },
              { key: 'type', label: 'Type' },
              { key: 'folder', label: 'Folder', hint: 'the My-work folder it is filed in' },
              { key: 'created', label: 'Created', hint: 'when it was filed into the case' },
              ...columns,
            ] as column (column.key)}
              <th aria-sort={sortKey === column.key ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
                <button class="sorter" title={column.hint ?? ''} onclick={() => sortBy(column.key)}>
                  {column.label}
                  {#if sortKey === column.key}
                    <Icon name={sortDesc ? 'chevronDown' : 'chevronUp'} size={11} />
                  {/if}
                </button>
              </th>
            {/each}
            <!-- The action column has nothing to head and nothing to sort by: the
                 button under it says what it does, and a heading over an icon would
                 be a second name for one act. -->
            <th class="go"></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as entity (entity.id)}
            <!-- A row is a control: focusable and answering Enter, because a table
                 nobody can walk with the keyboard is a table half the analysts
                 cannot use. -->
            <tr
              class:suggested={isSuggested(entity)}
              class:busy={busyId === entity.id}
              tabindex="0"
              onclick={() => {
                if (snapshotReading) snapshotOpen = entity;
                else openId = entity.id;
              }}
              onkeydown={(e) => {
                // only the row's own key press: Enter on the confirm button inside
                // it is that button's, and would otherwise open Details as well
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (snapshotReading) snapshotOpen = entity;
                  else openId = entity.id;
                }
              }}
            >
              <td>
                {#if entity.thumb}
                  <img
                    class="entity-thumb"
                    src={entity.thumb.startsWith('data:')
                      ? entity.thumb
                      : fileUrl(caseState.current.id, entity.thumb)}
                    alt=""
                    loading="lazy"
                  />
                {:else}
                  <Icon name={entityIcon(entity)} size={12} />
                {/if}
                <span class="name">{entity.label}</span>
                {#if filter.q.trim() && matchReasons(entity)[0]}
                  {@const match = matchReasons(entity)[0]}
                  <span class="match-reason" title={match.value}>
                    {match.label}: {match.value}
                  </span>
                {/if}
                {#if isSuggested(entity)}
                  <span class="tag" title="a tool proposed this, and nobody has confirmed it">
                    suggested
                  </span>
                  <!-- Settled where it is read. Filtering to the proposals and then
                       having to open each one to accept it made the filter a list
                       nobody could act on. -->
                  {#if !snapshotReading}<span class="review">
                    <button
                      class="btn btn-ghost btn-sm act ok"
                      title="Confirm this item"
                      disabled={busyId === entity.id}
                      onclick={(e) => { e.stopPropagation(); confirmEntity(entity); }}
                    >
                      <Icon name="check" size={12} />
                    </button>
                    <button
                      class="btn btn-ghost btn-sm act no"
                      title="Dismiss this item, recoverable from the trash"
                      disabled={busyId === entity.id}
                      onclick={(e) => { e.stopPropagation(); dismissEntity(entity); }}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>{/if}
                {/if}
              </td>
              <td title={entityHint(entity.type)}>{entityLabel(entity.type)}</td>
              <td class="dim">{folderName(entity)}</td>
              <td class="dim mono">{created(entity)}</td>
              {#each columns as column (column.key)}<td class="dim">{cell(entity, column)}</td>{/each}
              <!-- The row's one way out of the table. A list is good at narrowing and
                   says nothing about how things join up, so the question a row most
                   often raises is the one only the drawing answers. Quiet until the
                   row is under the pointer, like the review clicks beside it. -->
              <td class="go">
                {#if !snapshotReading}
                <button
                  class="btn btn-ghost btn-sm act"
                  aria-label="Show {entity.label} in the graph"
                  title="Show it in the graph, with what it is connected to"
                  onclick={(e) => {
                    e.stopPropagation();
                    uiState.openGraphEntity = entity.id;
                    uiState.tool = 'graph';
                  }}
                >
                  <Icon name="graph" size={13} />
                </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if pl.hasMore}
      <div class="more">
        <!-- A sort the store could not answer runs over what is loaded, so it says
             so while there is more: an alphabet over the first hundred of eight
             hundred rows looks exactly like an alphabet over the case. The two
             headings the case can order by say nothing, because there is nothing to
             warn about. -->
        <span class="dim">
          Showing {rows.length} of {matchCount}{sortKey && !order
            ? ', sorted over the rows loaded'
            : ''}
        </span>
        <button class="btn btn-ghost btn-sm" onclick={() => pl.loadMore()} disabled={pl.loading}>
          {pl.loading ? 'Loading…' : 'Show more'}
        </button>
      </div>
    {/if}
  </div>
</div>

{#if draft}
  <!-- The one create dialog, shared with the graph: a `claim` is filed with the same
       words and the same duplicate warning wherever the analyst is standing. -->
  <EntityCreate
    startType={draft.type}
    ontwin={(entity) => {
      draft = null;
      openId = entity.id;
    }}
    oncreated={(entity) => {
      draft = null;
      // Create it, then open it: a claim exists in order to be pointed at things, so
      // landing on its own Details with the relation picker is the next gesture.
      openId = entity.id;
    }}
    onclose={() => (draft = null)}
  />
{/if}

{#if openId && !snapshotReading}
  <!-- Escape and the backdrop both close a modal, and the panel's fields wait for
       Save: closing over unsaved edits threw them away without a word. The ask is
       only raised when there is something to lose. -->
  <Modal title="Details" onclose={closeDetails} width="640px">
    <!-- The panel's own `onclose` is its hand-off to another tool — it has already
         navigated by the time it fires, so it closes rather than asking. -->
    <EntityDetails
      entityId={openId}
      bind:dirty
      onclose={() => (openId = null)}
      ondeleted={() => (openId = null)}
    />
  </Modal>
{/if}

{#if snapshotOpen && snapshotReading}
  <Modal title="Snapshot details" onclose={() => (snapshotOpen = null)} width="640px">
    <SnapshotDetails
      entity={snapshotOpen}
      entities={analysisSearch.activeView?.spec?.snapshot?.entities ?? []}
      links={analysisSearch.activeView?.spec?.snapshot?.links ?? []}
    />
  </Modal>
{/if}

{#if discarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => { discarding = false; dirty = false; openId = null; }}
    oncancel={() => (discarding = false)}
  />
{/if}

<style>
  .spacer {
    flex: 1;
  }
  .answer {
    margin: 0;
    padding: 8px 16px 2px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .answer strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .answer .as-link {
    margin-left: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .answer .as-link:hover {
    text-decoration: underline;
  }
  /* The one scrolling region. `.tool` is a full-height flex column, so the body
     needs min-height:0 or the table pushes the column taller than the viewport and
     nothing scrolls at all. */
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 16px 16px;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-1) 82%, transparent);
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
  .drop-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 22px 30px;
    border: 1px dashed var(--accent);
    border-radius: var(--r);
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .empty {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 24px 2px;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  /* the headings stay put while the rows scroll under them */
  .table th {
    position: sticky;
    top: 0;
    z-index: 1;
    text-align: left;
    padding: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .sorter {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 8px 10px 8px 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }
  .sorter:hover {
    color: var(--text-1);
  }
  .table td {
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .table tbody tr {
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  /* a machine's proposal, marked the way the relation rows mark one */
  .table tbody tr.suggested {
    border-left-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .table tbody tr:hover td,
  .table tbody tr:focus-visible td {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .table tbody tr:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .table tbody tr.busy {
    opacity: 0.5;
  }
  /* the two review clicks, quiet until the row is under the pointer or focused */
  .review {
    display: inline-flex;
    gap: 1px;
    margin-left: 4px;
    opacity: 0.55;
    vertical-align: -3px;
  }
  tr:hover .review,
  tr:focus-within .review {
    opacity: 1;
  }
  .act {
    padding-inline: 5px;
  }
  /* The row's way into the drawing: right-aligned, and quiet until the row is under
     the pointer or focused — the same restraint as the review clicks, so a table of
     eight hundred rows is not eight hundred buttons. */
  .table .go {
    width: 1%;
    padding-right: 0;
    text-align: right;
    white-space: nowrap;
  }
  .table td.go .act {
    opacity: 0;
    color: var(--text-3);
  }
  tr:hover td.go .act,
  tr:focus-within td.go .act,
  tr:focus-visible td.go .act {
    opacity: 1;
  }
  .table td.go .act:hover {
    color: var(--accent);
  }
  .act.ok:hover {
    color: var(--ok, #46a758);
  }
  .act.no:hover {
    color: var(--danger);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .match-reason {
    display: block;
    max-width: 290px;
    margin: 2px 0 0 18px;
    overflow: hidden;
    color: var(--accent);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entity-thumb {
    width: 26px;
    height: 26px;
    display: inline-block;
    margin-right: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    object-fit: cover;
    vertical-align: middle;
    background: var(--bg-2);
  }
  .dim {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .tag {
    font-size: 10px;
    padding: 1px 5px;
    margin-left: 6px;
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .table td :global(svg) {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 6px;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
  }
</style>
