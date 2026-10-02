<script>
  /**
   * The case as an index: who, what and where, then the material it is built from.
   *
   * Until this existed the vocabulary was reachable only through the API. A case
   * could hold a `person`, a `claim` or an `account`, the registry declared them and
   * the relation verbs accepted them, but no screen created one. That is what this
   * tool is: create the hand-made types, list what the case holds, and read any row
   * in the same Details every other surface uses.
   *
   * **Grouped by family, never hidden.** A case is mostly files, and one table of
   * everything answered "what is in the database" rather than "who is this about".
   * So the rows fall into groups (`lib/boardGroups.js`): people, identifiers, places
   * and things open first, each saying how many events name it and when; the events,
   * files and work fold underneath, one click from the tool that reads them. The
   * question is still the one Board and Graph share, so a count, a total or a drawing
   * never depends on which groups are open. "Group: None" is the flat table, and a
   * view saved before the groups opens that way.
   *
   * **Details beside the list** when there is room for both, so reading five people is
   * five presses of an arrow key rather than five modals opened and closed.
   *
   * Bounded like every other list here (docs/STORAGE_AND_PERFORMANCE.md): one count
   * of the answer per type, one page per open group, one events read per page of rows.
   * A folded group reads nothing.
   */
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import {
    analysisSearch,
    catalogViews,
    openAnalysisCase,
    setAnalysisFilter,
    setAnalysisPeriod,
  } from '../lib/analysisSearch.svelte.js';
  import {
    analysisPeriodQuery,
    analysisPeriodSpec,
    emptyAnalysisPeriod,
    hasAnalysisPeriod,
    normalizeAnalysisPeriod,
  } from '../lib/analysisPeriod.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import { buildCatalogQuery, buildTallyQuery, fetchAttrFacets } from '../lib/catalog.js';
  import {
    confidenceLine,
    countLines,
    isEmpty as nothingTotalled,
    noteLines,
    readingNotes,
  } from '../lib/tally.js';
  import { createPagedList } from '../lib/pagedList.svelte.js';
  import { entitySearchMatches, matchesEntity } from '../lib/entitySearch.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { folderOf } from '../lib/folderTree.js';
  import { deletedToast, deleteEntities, entityDeletePrompt } from '../lib/trash.js';
  import { toggleCheck } from '../lib/gridSelect.js';
  import {
    askQuestion,
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
    familyTitle,
    loadEntityTypes,
  } from '../lib/entityTypes.svelte.js';
  import { createBookmark } from '../lib/bookmarks.js';
  import { windowWords } from '../lib/timeline.js';
  import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import AnalysisViews from '../components/AnalysisViews.svelte';
  import AnalysisPeriodBar from '../components/AnalysisPeriodBar.svelte';
  import FilterBar from '../components/FilterBar.svelte';
  import EntityCreate from '../components/EntityCreate.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import PasteDialog from '../components/PasteDialog.svelte';
  import SnapshotDetails from '../components/SnapshotDetails.svelte';
  import ViewSwitch from '../components/ViewSwitch.svelte';
  import BoardGroup from './board/BoardGroup.svelte';
  import { loadRelationTypes } from '../lib/relations.svelte.js';
  import { fetchEventRows } from '../lib/catalog.js';
  import { offerNote } from '../lib/noteHere.svelte.js';
  import NoCase from '../components/NoCase.svelte';
  import {
    BOARD_GROUPS,
    GROUPINGS,
    GROUP_SORTS,
    boardGroup,
    groupCounts,
    groupOfType,
    groupOpen,
    holdsSubjects,
    loadLayout,
    saveLayout,
    viewLayout,
    waitingOf,
  } from '../lib/boardGroups.js';

  const PAGE = 100;
  /** A group's page: enough to read a group at a glance, small enough that the next
   *  group is one scroll away. */
  const GROUP_PAGE = 40;
  /** Below this width Details opens over the list rather than beside it. */
  const DOCK_WIDTH = 1100;

  loadEntityTypes();
  // Details beside a row offers an event where the verb registry gives it a seat.
  loadRelationTypes();

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
  let facetState = $state('unasked'); // 'unasked' | 'loading' | 'ready'
  let sortKey = $state(''); // '' = the catalog's own stable order
  let sortDesc = $state(false);
  let summary = $state(null); // { total, by_type, by_status, by_folder, by_source, unlinked }
  let openId = $state(null); // the row whose Details are open
  let snapshotOpen = $state(null); // a captured row, read without touching the live case
  let draft = $state(null); // the entity being created, or null
  let busyId = $state(null); // the row whose review action is in flight
  let discarding = $state(false); // Details closing with unsaved fields on screen
  let dirty = $state(false); // Details has edits the panel's Save has not taken
  let selected = $state([]); // the ticked rows, by id
  let anchor = null; // the last box touched, which shift measures a run from
  let confirmState = $state(null); // the delete being asked about, or null
  let confirmBusy = $state(false);

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
  const activePeriod = $derived(hasAnalysisPeriod(analysisSearch.period));

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
          ...(catalogViews.snapshotId ? {} : analysisPeriodQuery(analysisSearch.period)),
          order,
          view: catalogViews.snapshotId || undefined,
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
  const filtering = $derived(isFiltering(filter) || activePeriod);
  const snapshotReading = $derived(Boolean(catalogViews.snapshotId));
  /** How many the question matches, across the case. The page's own count, except on
   *  a small case searching in memory — there the server was never told the term, so
   *  its count would answer a wider question than the one on screen. */
  const matchCount = $derived(
    grouped
      ? groupedTotal
      : pl.serverMode || !filter.q.trim()
        ? pl.total
        : matching.length
  );
  /** What the answer is a part of. The **whole case**, always: a proportion is the
   *  information a count carries, and a denominator that shrinks with the numerator
   *  carries none. */
  const caseTotal = $derived(summary?.total ?? pl.total);

  // ── the groups ───────────────────────────────────────────────────────────────
  /** How this analyst lays the Board out for this case: grouped or flat, the sort,
   *  the folds. Kept in this browser (`lib/boardGroups.js`). A Board view states its
   *  own grouping and sort, which hold while it is open. */
  let layout = $state(loadLayout(null));
  let viewShape = $state(null); // { group, sort } while a Board view is open
  const shape = $derived(viewShape ?? { group: layout.group, sort: layout.sort });
  const grouped = $derived(shape.group === 'kind' && !totalling);

  /** Folds made under the current question, forgotten when it changes: a question
   *  opens every group that holds an answer, and a fold made while reading it should
   *  not outlive it. */
  let asked = $state({});
  /** Groups opened for the analyst this session, by a file just imported or a row
   *  followed here, until they fold the group themselves. */
  let revealed = $state({});

  function setShape(next) {
    if (viewShape) viewShape = { ...viewShape, ...next };
    else {
      layout = { ...layout, ...next };
      saveLayout(caseState.current?.id, layout);
    }
  }

  /** The answer counted per type, which every group reads its size from. */
  let byType = $state(null);
  const counts = $derived(groupCounts(byType ?? {}, entityFamily));
  const groupedTotal = $derived(
    Object.values(byType ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
  );
  /** Whether the case holds anything an investigation is about. A case of files only
   *  opens its files, rather than an index with nothing in it. */
  const subjects = $derived(holdsSubjects(summary?.by_type ?? {}, entityFamily));

  function isOpen(group) {
    if (filtering) return groupOpen(group, { asked, filtering: true });
    if (group.id in revealed) return revealed[group.id];
    return groupOpen(group, { folds: layout.folds, subjects });
  }

  function toggleGroup(group) {
    const next = !isOpen(group);
    if (filtering) asked = { ...asked, [group.id]: next };
    else {
      const { [group.id]: _dropped, ...rest } = revealed;
      revealed = rest;
      layout = { ...layout, folds: { ...layout.folds, [group.id]: next } };
      saveLayout(caseState.current?.id, layout);
    }
    if (next && !lists[group.id].items.length) loadGroup(group.id);
  }

  /** Open the group a type falls in, so what the analyst just made or followed is on
   *  screen rather than folded away. */
  function reveal(type) {
    if (!type) return;
    const group = groupOfType(type, entityFamily);
    if (filtering) asked = { ...asked, [group.id]: true };
    else revealed = { ...revealed, [group.id]: true };
    if (!lists[group.id].items.length) loadGroup(group.id);
  }

  /** The types each group's page asks for: the ones the answer holds in it. */
  const groupTypes = $derived.by(() => {
    const out = Object.fromEntries(BOARD_GROUPS.map((group) => [group.id, []]));
    for (const [type, n] of Object.entries(byType ?? {})) {
      if (Number(n) > 0) out[groupOfType(type, entityFamily).id].push(type);
    }
    for (const list of Object.values(out)) list.sort();
    return out;
  });

  /** One bounded list per group, each paging on its own. Always a server answer:
   *  the text term is counted server-side too, and a group filtered in memory while
   *  its count came from the server could say two different numbers. */
  const lists = Object.fromEntries(
    BOARD_GROUPS.map((group) => [
      group.id,
      createPagedList({
        fetchPage: ({ cursor }) =>
          api.get(
            buildCatalogQuery(caseState.current.id, {
              cursor,
              limit: GROUP_PAGE,
              ...toQuery(filter, { types: groupTypes[group.id] }),
              ...(catalogViews.snapshotId ? {} : analysisPeriodQuery(analysisSearch.period)),
              order: groupOrder(group),
              view: catalogViews.snapshotId || undefined,
            })
          ),
      }),
    ])
  );

  /** "Most noted" orders the subjects; the material under them reads newest first,
   *  since a file is sought by when it came in rather than by how often it is cited. */
  function groupOrder(group) {
    return group.kind === 'material' && shape.sort === '-events' ? '-created' : shape.sort;
  }

  function loadGroup(id) {
    if (!caseState.current?.id) return;
    const list = lists[id];
    if (!groupTypes[id]?.length) {
      list.clear();
      return;
    }
    untrack(() => void list.reload().catch(() => {}));
  }

  /**
   * Count the answer, then read the open groups that hold some of it.
   *
   * One request says how much each group holds; a group then asks for its own page
   * only if it is open and not empty. Asked again on every change to the question, the
   * sort or the case, and a quarter second after a keystroke, which is the paged
   * list's own delay for the same box.
   */
  let countedAsk = '';
  let countedQ = '';
  let countSeq = 0;
  $effect(() => {
    const id = caseState.current?.id;
    if (!id || !grouped) return;
    const period = catalogViews.snapshotId ? null : analysisPeriodQuery(analysisSearch.period);
    const query = toQuery(filter, { types: wantedTypes });
    const ask = JSON.stringify([
      id, caseState.rev, query, period, shape.sort, catalogViews.snapshotId,
    ]);
    if (ask === countedAsk) return;
    const typing = countedAsk !== '' && filter.q !== countedQ;
    const mine = ++countSeq;
    const timer = setTimeout(async () => {
      countedAsk = ask;
      countedQ = filter.q;
      try {
        const page = await api.get(
          buildCatalogQuery(id, {
            limit: 1,
            counts: 'type',
            ...query,
            ...(period ?? {}),
            view: catalogViews.snapshotId || undefined,
          })
        );
        if (mine !== countSeq || caseState.current?.id !== id) return;
        byType = page.by_type ?? {};
        for (const group of BOARD_GROUPS) {
          if (counts[group.id] && isOpen(group)) loadGroup(group.id);
          else lists[group.id].clear();
        }
      } catch {
        if (mine === countSeq) countedAsk = '';
      }
    }, typing ? 250 : 0);
    return () => clearTimeout(timer);
  });

  // A new question opens every group that answers it, whatever was folded under the
  // last one.
  $effect(() => {
    JSON.stringify(filter);
    JSON.stringify(analysisSearch.period);
    untrack(() => (asked = {}));
  });

  /** The groups on screen, with their rows, in reading order. */
  const shownGroups = $derived(
    BOARD_GROUPS.filter((group) => counts[group.id] > 0).map((group) => ({
      group,
      open: isOpen(group),
      list: lists[group.id],
    }))
  );
  /** Every row the groups show, in the order they show them: what a tick range, the
   *  selection bar and the arrow keys walk. */
  const groupedRows = $derived(
    shownGroups.filter((entry) => entry.open).flatMap((entry) => entry.list.items)
  );

  /**
   * What the events say about the subject rows on screen: one read per page of rows,
   * refreshed with the case. A snapshot is a frozen reading and asks nothing of the
   * live case, so its rows draw without it.
   */
  let events = $state({});
  let eventsRev = -1;
  let eventsCase = null;
  $effect(() => {
    const id = caseState.current?.id;
    const rev = caseState.rev;
    const frozen = Boolean(catalogViews.snapshotId);
    const ids = shownGroups
      .filter((entry) => entry.open && entry.group.kind === 'subject')
      .flatMap((entry) => entry.list.items.map((entity) => entity.id));
    if (!id || !grouped || frozen) {
      if (Object.keys(untrack(() => events)).length) events = {};
      return;
    }
    const fresh = rev !== eventsRev || id !== eventsCase;
    const held = fresh ? {} : untrack(() => events);
    const missing = ids.filter((one) => !(one in held));
    if (!missing.length) return;
    eventsRev = rev;
    eventsCase = id;
    fetchEventRows(id, missing)
      .then((body) => {
        if (caseState.current?.id !== id || caseState.rev !== rev) return;
        events = { ...(fresh ? {} : events), ...(body?.rows ?? {}) };
      })
      .catch(() => {});
  });

  function openRow(entity) {
    if (snapshotReading) snapshotOpen = entity;
    else requestOpen(entity.id);
  }

  /** Change the open row, asking first when Details holds edits Save has not taken:
   *  an arrow key is too easy a way to throw a half-typed field away. */
  let pendingOpen = null;
  function requestOpen(id) {
    if (id === openId) return;
    if (dirty && openId) {
      pendingOpen = id;
      discarding = true;
      return;
    }
    openId = id;
  }

  // The row Details is open on is what the topbar's Add event seats here.
  $effect(() => {
    const id = openId ?? snapshotOpen?.id ?? null;
    const entity = id && !snapshotReading ? shownRows.find((row) => row.id === id) ?? null : null;
    offerNote('board', entity);
  });

  function showInGraph(entity) {
    uiState.openGraphEntity = entity.id;
    uiState.tool = 'graph';
  }

  const thumbUrl = (thumb) =>
    thumb.startsWith('data:') ? thumb : fileUrl(caseState.current.id, thumb);

  /** The waiting questions, priced: shown while nothing is being asked, since a
   *  question already on the bar is the one being read. */
  const waiting = $derived(
    !filtering && !snapshotReading && !totalling ? waitingOf(summary) : []
  );

  // ── Details beside the list ─────────────────────────────────────────────────
  let measuredWidth = $state(0);
  /** The width the Board last had on screen. A hidden tab measures nothing, and
   *  reading that as a narrow window would turn Details beside the list into a modal
   *  over whichever tool the analyst moved to. */
  let toolWidth = $state(0);
  $effect(() => {
    if (measuredWidth > 0) toolWidth = measuredWidth;
  });
  /** Beside the list or over it is decided when Details opens, and kept until it
   *  closes: switching on a resize would remount it, and a remount throws away the
   *  fields being typed and the dialog opened from it. */
  let dockedWhenOpened = $state(null);
  $effect(() => {
    if (!openId && !snapshotOpen) {
      dockedWhenOpened = null;
      return;
    }
    if (dockedWhenOpened === null) dockedWhenOpened = untrack(() => toolWidth >= DOCK_WIDTH);
  });
  const docked = $derived(dockedWhenOpened ?? toolWidth >= DOCK_WIDTH);
  const FICHE_KEY = 'azimut:boardDetailsW';
  const FICHE_MIN = 420;
  let ficheWidth = $state(readFicheWidth());
  function readFicheWidth() {
    try {
      const stored = Number(localStorage.getItem(FICHE_KEY));
      return Number.isFinite(stored) && stored >= FICHE_MIN ? stored : 560;
    } catch {
      return 560;
    }
  }
  /** Never so wide that the list beside it stops being a list. */
  const ficheShown = $derived(
    Math.round(
      Math.min(
        Math.max(FICHE_MIN, Math.min(ficheWidth, 900, toolWidth - 480)),
        // a window narrowed while it is open: Details keeps the room there is
        toolWidth || Infinity
      )
    )
  );
  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ficheShown;
    const move = (ev) => (ficheWidth = Math.max(FICHE_MIN, startWidth + (startX - ev.clientX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(FICHE_KEY, String(Math.round(ficheWidth)));
      } catch {
        /* the width holds for the session */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function nudgeFiche(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    ficheWidth = ficheShown + (e.key === 'ArrowLeft' ? 24 : -24);
    try {
      localStorage.setItem(FICHE_KEY, String(Math.round(ficheWidth)));
    } catch {
      /* the width holds for the session */
    }
  }

  /** The arrow keys walk the rows, and with Details open beside the list they carry
   *  it along: reading five people is five presses rather than five modals. */
  let bodyElement = $state();
  function walkRows(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const row = e.target;
    if (!(row instanceof HTMLElement) || row.tagName !== 'TR') return;
    const all = [...(bodyElement?.querySelectorAll('tbody tr[tabindex]') ?? [])];
    const next = all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (docked && (openId || snapshotOpen)) next.click();
  }

  /** Escape closes Details beside the list, unless it is closing something inside
   *  it first (a menu, a field being typed in). */
  function escapeFiche(e) {
    if (e.key !== 'Escape' || !docked || (!openId && !snapshotOpen)) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]'))
    ) {
      return;
    }
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (snapshotOpen) snapshotOpen = null;
    else closeDetails();
  }

  /**
   * The same question, added up instead of listed.
   *
   * Not a second view of these rows — the one thing this tool refuses (see the top of
   * this file) — but the one answer the rows cannot give. A case that follows a
   * conflict writes *two of these destroyed here* twenty times over, and twenty rows
   * later what the analyst wants is the total, which a table gives only by being added
   * up by hand.
   *
   * So it is a **gesture on the question**, exactly like "Draw these": the chips stay
   * where they are, the sentence is unchanged, and what moves is what is done with the
   * answer. Every rule about what may enter a sum is the server's
   * (`engine/tally.py`), and every word about what was left out of one is
   * `lib/tally.js` — a total printed bare is true and misleading in the same breath.
   */
  let totalling = $state(false);
  let tally = $state(null);
  let tallying = $state(false);

  /**
   * The two renderings, as the switch offers them.
   *
   * **Totals is offered from the first day and dimmed until it can draw a real line**,
   * rather than appearing the day a case gains one — the rule the filter menu already
   * follows: a control you can see and cannot use teaches something, one that is not
   * there teaches nothing.
   *
   * What makes a line real is both halves at once: a statement carrying a **number**,
   * and pointing at **something** (`summary.countable`). Either alone opens the total
   * on nothing — *seen, not counted* is an answer rather than a row, and a statement
   * about nothing has no subject to sit under — and a reading that opens on an empty
   * answer reads as a finding about the case instead of as a control that was not
   * ready. Priced by the same summary every filter term is priced from, so it costs no
   * request of its own.
   *
   * The state currently on is never dimmed (`ViewSwitch` enforces it too), or the
   * screen would show itself as unavailable while being what is on screen.
   */
  const countable = $derived(summary?.countable ?? 0);
  const viewOptions = $derived.by(() => {
    const nothingToDraw = countable === 0;
    const empty = !rows.length;
    return [
      { id: 'rows', label: 'Rows', icon: 'note', hint: 'One row per thing the case holds' },
      {
        id: 'totals',
        label: 'Totals',
        icon: 'hash',
        disabled: nothingToDraw || empty || snapshotReading,
        hint: snapshotReading
          ? 'A frozen snapshot holds rows rather than a question to add up'
          : nothingToDraw
            ? 'No claim counts anything about a subject yet'
            : empty
              ? 'Nothing in the table to add up'
              : 'What the claims about these come to, per subject',
      },
    ];
  });

  /**
   * Read on the same terms as the page, and only while it is on screen: a total
   * nobody is looking at is a request nobody is waiting for.
   *
   * Debounced on **every** term rather than on the text one alone. The search box is
   * the only term that changes per keystroke, but a sum has no in-memory half to fall
   * back on the way the row list does — the arithmetic is the server's at any case
   * size — so one delay for the whole question is one rule instead of a term-by-term
   * bookkeeping, and a quarter second after a chip click is not felt.
   */
  const TALLY_DELAY = 250; // the paged list's own, for the same box
  $effect(() => {
    if (!totalling || snapshotReading || !caseState.current?.id) return;
    // A statement stated, counted or related changes what the case comes to, and the
    // total is the one reading where that is the whole point. Read like the row list
    // beside it and like the panel's own total, or a relation added while this is on
    // screen would need the page reloaded to appear in it.
    caseState.rev;
    const url = buildTallyQuery(caseState.current.id, {
      ...toQuery(filter, { types: wantedTypes }),
      ...analysisPeriodQuery(analysisSearch.period),
    });
    let current = true;
    const timer = setTimeout(() => {
      tallying = true;
      api
        .get(url)
        .then((body) => {
          if (current) tally = body;
        })
        .catch(() => {
          if (current) tally = null;
        })
        .finally(() => {
          if (current) tallying = false;
        });
    }, TALLY_DELAY);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });

  /** A snapshot is a frozen copy of rows rather than a question the case can still be
   *  asked, so the addition has nothing to run over and steps back to the list. */
  $effect(() => {
    if (snapshotReading && totalling) totalling = false;
  });

  /** The condition and confidence words, from the served registry rather than spelled
   *  again here: a level added there reads correctly in the tally with no edit. */
  const claimReads = $derived.by(() => {
    const reads = {};
    for (const field of entityFields('claim')) {
      for (const option of field.options ?? []) reads[option.value] = option.label;
    }
    return (value) => reads[value] ?? value;
  });

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

  // ── ticked rows ──────────────────────────────────────────────────────────────
  /**
   * Several rows at once, because the mistake is rarely one row.
   *
   * An import of the wrong folder, a scraper run that filed forty of the wrong
   * thing, a paste into the case next to the intended one: undoing that used to
   * mean opening Details forty times. A box per row gathers what goes, and the
   * delete behind them lands as **one** trash group, so the Undo in the toast
   * takes the whole act back rather than the last row of it.
   *
   * The boxes cover what is loaded. The table is bounded like every list here, so
   * a selection cannot claim rows nobody has seen, and the count beside *Show
   * more* is what says the rest is still out there.
   */
  const ticked = $derived(new Set(selected));
  /** The rows on screen, grouped or flat, in the order they are shown. */
  const shownRows = $derived(grouped ? groupedRows : rows);
  /** The ticked rows themselves, in the order the table is showing them. It is what
   *  the bar counts and what Delete sends, so the number on screen is never a row
   *  the table has since stopped showing. */
  const chosen = $derived(shownRows.filter((entity) => ticked.has(entity.id)));
  const allTicked = $derived(shownRows.length > 0 && chosen.length === shownRows.length);

  function tick(entity, shift) {
    const result = toggleCheck(
      selected,
      entity.id,
      { shift },
      shownRows.map((row) => row.id),
      anchor
    );
    selected = result.selected;
    anchor = result.anchor;
  }

  function tickAll(on) {
    selected = on ? shownRows.map((row) => row.id) : [];
    anchor = null;
  }

  function untickAll() {
    selected = [];
    anchor = null;
  }

  // A tick belongs to the answer it was made in. Change the question, the case or
  // the reading and the boxes go: a row that scrolled out of the narrowing would
  // still be going, unseen, when Delete is pressed.
  $effect(() => {
    caseState.current?.id;
    JSON.stringify(filter);
    JSON.stringify(analysisSearch.period);
    totalling;
    snapshotReading;
    shape.group;
    untrack(untickAll);
  });

  async function askDeleteSelected() {
    if (snapshotReading || confirmState || !caseState.current || !chosen.length) return;
    const going = chosen;
    const caseId = caseState.current.id;
    confirmState = {
      ...(await entityDeletePrompt(caseId, going)),
      action: async () => {
        const result = await deleteEntities(caseId, going.map((entity) => entity.id));
        await reloadCase();
        untickAll();
        deletedToast(caseId, result, going[0].label);
      },
    };
  }

  async function runConfirm() {
    const asked = confirmState;
    if (!asked) return;
    confirmBusy = true;
    try {
      await asked.action();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      confirmBusy = false;
      confirmState = null;
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
      byType = null;
      return;
    }
    if (loadedFor !== id) {
      loadedFor = id;
      pl.clear();
      for (const list of Object.values(lists)) list.clear();
      byType = null;
      // The question travels with the case, not with the tab: reopening Azimut on a
      // case lands on what was being asked of it. So does the way it was laid out.
      openAnalysisCase(id);
      filter = normalizeFilter(analysisSearch.filter);
      layout = loadLayout(id);
      revealed = {};
      fieldsWanted = false;
      facetState = 'unasked';
    }
    // The flat table reads its own page; the groups read theirs off the count.
    if (!grouped) void pl.reload();
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
      toQuery(filter, { types: wantedTypes }),
      analysisPeriodQuery(analysisSearch.period),
      order,
      catalogViews.snapshotId,
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
    if (!first && caseState.current?.id && !untrack(() => grouped)) void pl.reload();
  });

  /**
   * The fields on offer follow the types being listed, in one bounded read.
   *
   * **Read on demand**, which is the change that stopped the field filter being
   * invisible: the scan costs the stored attributes of everything the narrowing
   * covers, so it used to be gated behind picking a type first — and an analyst who
   * had not picked one never learnt the filter existed. Now the gate is the click
   * that opens the menu, which is the explicit act the cost was always worth paying
   * behind.
   *
   * **The size of the case decides nothing.** It used to: past five thousand entities
   * the menu went dark and asked for a type first, which is exactly backwards — a case
   * that large is the one where a field is the only practical way to narrow. The scan
   * is linear and small (measured: 50 000 entities in 0.3 s, 100 000 in 0.7 s), and
   * what keeps the menu readable is the server's own bound on **values** — a field
   * holding more of them than the limit comes back with none and says it was cut. That
   * was always the right bound; the entity count never was.
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
  function startCreate(type = '') {
    if (snapshotReading) return;
    const wanted = creatableTypes().filter(
      (entry) => !filter.families.length || filter.families.includes(entry.family)
    );
    draft = {
      type: type || onlyType || wanted[0]?.type || creatableTypes()[0]?.type || '',
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
      // What was filed shows in its group. One file opens where the analyst can say
      // what it is; a batch does not, since Details would be about whichever one
      // happened to land last.
      if (added || duplicates) reveal('media');
      if (files.length === 1 && last) requestOpen(last);
    } finally {
      importing = false;
    }
  }

  // ── paste ────────────────────────────────────────────────────────────────────
  /**
   * Ctrl+V files what the clipboard holds and opens the row it made.
   *
   * The table is where the case is read as a list, and a screenshot or a link
   * arriving while reading it has somewhere to be: filed, then open, so the next
   * gesture is relating it to whatever prompted the paste.
   */
  let pasted = $state(null);
  let pasteBusy = $state(false);
  $effect(() => {
    if (uiState.tool !== 'board') return;
    return listenForPaste((payload) => {
      if (snapshotReading) {
        toast('This snapshot is read-only. Leave it to paste.', 'warn');
        return;
      }
      pasted ??= resolvePaste('board', payload);
    });
  });

  async function confirmPaste(resolved) {
    const caseId = caseState.current?.id;
    if (pasteBusy || !caseId) return;
    pasteBusy = true;
    const { kind, values, payload } = resolved;
    try {
      if (kind === 'image') {
        const result = await pasteImage(caseId, {
          file: payload.file,
          title: values.title,
          sourceUrl: values.source,
        });
        pasted = null;
        await reloadCase();
        // The same bytes twice is not an error and not a second row: the case keeps
        // the one it has, and saying so is what stops the analyst pasting again.
        if (result.duplicate) toast('Already in the case (same SHA-256)', 'warn');
        reveal(result.entity.type ?? 'media');
        requestOpen(result.entity.id);
      } else {
        const entity = await createBookmark(caseId, { ...values, url: payload.url });
        pasted = null;
        await reloadCase();
        reveal(entity.type ?? 'bookmark');
        requestOpen(entity.id);
      }
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      pasteBusy = false;
    }
  }

  function closeDetails() {
    pendingOpen = null;
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
      snapshotOpen = catalogViews.activeView?.spec?.snapshot?.entities?.find(
        (entity) => entity.id === id
      ) ?? null;
      reveal(snapshotOpen?.type);
    } else {
      requestOpen(id);
      // Its group opens too, so the row followed here is on screen beside its Details.
      const caseId = caseState.current?.id;
      if (caseId) {
        api
          .get(`/api/cases/${caseId}/entities/${id}/chain`)
          .then((chain) => {
            if (caseState.current?.id === caseId) reveal(chain?.entity?.type);
          })
          .catch(() => {});
      }
    }
  });


  /** The question as one sentence, which is what the graph writes over the drawing
   *  so nobody has to remember what they asked two tabs ago. */
  const said = $derived(
    [
      filter.q.trim() ? `“${filter.q.trim()}”` : '',
      ...chipsOf(filter, { type: entityLabel, family: familyTitle }).map((chip) => chip.text),
      activePeriod ? `Fact time · ${windowWords(
        analysisSearch.period.from, analysisSearch.period.to, 'UTC'
      )}` : '',
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

  function openPeriodInTimeline() {
    uiState.timelineRange = {
      from: analysisSearch.period.from,
      to: analysisSearch.period.to,
    };
    uiState.tool = 'timeline';
  }

  function openPeriodOnMap() {
    uiState.mapTimelineRange = {
      from: analysisSearch.period.from,
      to: analysisSearch.period.to,
      categories: analysisSearch.period.categories ?? [],
    };
    uiState.tool = 'satellite';
  }

  function clearPeriod() {
    setAnalysisPeriod(caseState.current?.id, emptyAnalysisPeriod());
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
      // The grouping and its sort travel with the view: a Board view reopens laid out
      // the way it was saved.
      board: { order, sortKey, sortDesc, group: shape.group, groupSort: shape.sort },
      timeline: analysisPeriodSpec(analysisSearch.period),
    };
  }

  async function openAnalysisView(view) {
    openId = null;
    snapshotOpen = null;
    filter = normalizeFilter(view.spec?.query?.filter);
    // Board and Graph read one saved question, and each surface restores only the
    // presentation it saved. A Graph view opened here brings its question to the rows
    // and leaves the analyst in the tool they are working in; its lens, folds and
    // arrangement wait for the Graph, which restores them off the same active view.
    // The table's own sort is left alone, because such a view never stated one.
    if (view.surface !== 'board') return;
    const board = view.spec?.board ?? {};
    sortKey = typeof board.sortKey === 'string' ? board.sortKey : '';
    sortDesc = board.sortDesc === true;
    // A view saved before the groups states none, and opens flat as it was saved.
    viewShape = viewLayout(board);
  }

  let appliedViewId = null;
  $effect(() => {
    const view = catalogViews.activeView;
    if (!view) {
      appliedViewId = null;
      viewShape = null;
      return;
    }
    if (view.surface !== 'board' || view.id === appliedViewId) return;
    appliedViewId = view.id;
    untrack(() => void openAnalysisView(view));
  });

  let observedLiveView = null;
  let observedLiveState = '';
  $effect(() => {
    const view = catalogViews.activeView;
    if (!view || view.mode !== 'live' || view.surface !== 'board') {
      observedLiveView = null;
      observedLiveState = '';
      return;
    }
    const savedFilter = normalizeFilter(view.spec?.query?.filter);
    const savedBoard = view.spec?.board ?? {};
    const savedShape = viewLayout(savedBoard);
    const current = JSON.stringify({
      filter: normalizeFilter(filter),
      period: normalizeAnalysisPeriod(analysisSearch.period),
      sortKey,
      sortDesc,
      group: shape.group,
      groupSort: shape.sort,
    });
    const saved = JSON.stringify({
      filter: savedFilter,
      period: normalizeAnalysisPeriod(view.spec?.timeline),
      sortKey: typeof savedBoard.sortKey === 'string' ? savedBoard.sortKey : '',
      sortDesc: savedBoard.sortDesc === true,
      group: savedShape.group,
      groupSort: savedShape.sort,
    });
    if (observedLiveView !== view.id) {
      observedLiveView = view.id;
      observedLiveState = current;
    } else if (current !== observedLiveState) {
      observedLiveState = current;
      catalogViews.changeVersion += 1;
    }
    catalogViews.modified = current !== saved;
  });

  function leaveAnalysisReading() {
    appliedViewId = null;
    viewShape = null;
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

<div class="tool" bind:clientWidth={measuredWidth}>
  <div class="tool-header">
    <h2>Board</h2>
    <span class="sub">{grouped ? 'People, places and things first' : 'Everything this case holds'}</span>
    <div class="spacer"></div>
    <AnalysisViews
      surface="board"
      capture={captureAnalysisView}
      onopen={openAnalysisView}
      onleave={leaveAnalysisReading}
    />
    <button
      class="btn"
      title="Add a file to the case"
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
    <button class="btn btn-primary" onclick={() => startCreate()} disabled={!caseState.current || snapshotReading}>
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

  {#if activePeriod}
    <AnalysisPeriodBar
      period={analysisSearch.period}
      ontimeline={openPeriodInTimeline}
      onmap={openPeriodOnMap}
      onclear={clearPeriod}
    />
  {/if}

  <!-- The answer, and what it is an answer out of. The denominator is the whole case
       even under a filter: a proportion is the information a count carries. -->
  <p class="answer">
    <span class="said">
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
    </span>
    <!-- How the rows are laid out: grouped by what they are, and in which order
         across the case, or the one flat table. Neither changes the answer. -->
    {#if caseState.current && !totalling}
      <span class="layout">
        {#if grouped}
          <label class="pick-one" title="How each group is ordered, across the whole case">
            <span>Sort</span>
            <select
              class="select"
              value={shape.sort}
              onchange={(e) => setShape({ sort: e.currentTarget.value })}
            >
              {#each GROUP_SORTS as option (option.id)}
                <option value={option.id} title={option.hint}>{option.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="pick-one" title="Group the rows by what they are, or show one table">
          <span>Group</span>
          <select
            class="select"
            value={shape.group}
            onchange={(e) => setShape({ group: e.currentTarget.value })}
          >
            {#each GROUPINGS as option (option.id)}
              <option value={option.id} title={option.hint}>{option.label}</option>
            {/each}
          </select>
        </label>
      </span>
    {/if}
    <!-- How this screen renders the answer, in the control Files and the Media Library
         already use for the same job. What a single subject comes to is read where
         that subject is, in its own Details; this one reads several at once, ranked. -->
    <ViewSwitch
      options={viewOptions}
      value={totalling ? 'totals' : 'rows'}
      onpick={(id) => (totalling = id === 'totals')}
    />
  </p>

  <!-- The Board's standing questions, priced, while nothing else is being asked:
       what is waiting on the analyst, one click from the rows it counts. -->
  {#if waiting.length}
    <p class="waiting-line">
      <span class="lead-in">Waiting</span>
      {#each waiting as item (item.id)}
        <button
          class="as-link"
          title="Show them"
          onclick={() => (filter = askQuestion(filter, item.id))}
        ><strong>{item.count}</strong> {item.words}</button>
      {/each}
    </p>
  {/if}

  <!-- What the ticks come to, and the one thing they are for. Outside the scrolling
       body so a selection made at the top of eight hundred rows is still actionable
       at the bottom of them. -->
  {#if chosen.length}
    <div class="picked">
      <span><strong>{chosen.length}</strong> selected</span>
      <button class="btn btn-ghost btn-sm" onclick={untickAll}>Clear</button>
      <button class="btn btn-ghost btn-sm drop" onclick={askDeleteSelected}>
        <Icon name="trash" size={12} /> Delete
      </button>
    </div>
  {/if}

  <!-- Dropping a file onto the list files it, the way the Media Library takes one.
       `dragleave` is guarded on the container itself: the event fires for every
       child the pointer crosses, so an unguarded handler flickers the overlay off
       halfway across the table. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="split" onkeydown={escapeFiche}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    bind:this={bodyElement}
    onkeydown={walkRows}
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
      <NoCase icon="grid" what="see what it holds" />
    {:else if totalling}
      <!-- The addition. One row per subject the statements point at, and every number
           beside what it left out: a sum that hid its uncounted and its ruled-out
           statements would be arithmetically right and read as more than it is. -->
      {#if nothingTotalled(tally)}
        {#if !tallying}
          <p class="empty">No claim in this narrowing.</p>
        {/if}
      {:else}
        {#each readingNotes(tally) as note (note)}
          <p class="reading-note">{note}</p>
        {/each}
        <table class="table tally">
          <thead>
            <tr>
              <th>Subject</th>
              <th title="added over the ones that carried a number">
                What the claims come to
              </th>
              <th title="how many of them point at this subject">Claims</th>
            </tr>
          </thead>
          <tbody>
            {#each tally.rows as row (row.id)}
              {@const lines = countLines(row, claimReads)}
              {@const notes = noteLines(row)}
              {@const sure = confidenceLine(row, claimReads)}
              <tr
                tabindex="0"
                class:current={openId === row.id}
                onclick={() => requestOpen(row.id)}
                onkeydown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    requestOpen(row.id);
                  }
                }}
              >
                <td>
                  <Icon name={entityIcon(row)} size={12} />
                  <span class="name" dir="auto">{row.label}</span>
                  <span class="dim">{entityLabel(row.type)}</span>
                </td>
                <td>
                  {#if lines.length}
                    {#each lines as line (line.value)}
                      <span class="sum">{line.text}</span>
                    {/each}
                  {:else}
                    <span class="dim">—</span>
                  {/if}
                </td>
                <td class="dim">
                  {row.statements}
                  {#each notes as note (note)}<span class="note">{note}</span>{/each}
                  {#if sure}<span class="sure">{sure}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if grouped}
      {#if byType && !groupedTotal}
        <p class="empty">{filtering ? 'Nothing matches.' : 'Nothing filed in this case yet.'}</p>
      {:else}
        {#if byType && !filtering && !subjects && !snapshotReading}
          <!-- A case of files only: nothing to index yet, and the way one arrives. -->
          <div class="no-subjects">
            <strong>No people, places or things yet.</strong>
            <span>Name one with @ when you add an event, or</span>
            <button class="as-link" onclick={() => startCreate()}>create one</button>
          </div>
        {/if}
        {#each shownGroups as entry, index (entry.group.id)}
          {#if index > 0 && entry.group.kind === 'material' && shownGroups[index - 1].group.kind === 'subject'}
            <div class="divider" role="presentation"></div>
          {/if}
          <BoardGroup
            group={entry.group}
            count={counts[entry.group.id]}
            open={entry.open}
            rows={entry.list.items}
            types={groupTypes[entry.group.id]}
            loading={entry.list.loading}
            hasMore={entry.list.hasMore}
            {events}
            currentId={openId ?? snapshotOpen?.id ?? null}
            {ticked}
            {busyId}
            readOnly={snapshotReading}
            query={filter.q}
            creatable={creatableTypes().filter((type) => entry.group.families.includes(type.family))}
            {matchReasons}
            {thumbUrl}
            {folderName}
            {created}
            ontoggle={() => toggleGroup(entry.group)}
            onopen={openRow}
            ontick={tick}
            onconfirm={confirmEntity}
            ondismiss={dismissEntity}
            ongraph={showInGraph}
            oncreate={(type) => startCreate(type)}
            onreads={(tool) => (uiState.tool = tool)}
            onmore={() => entry.list.loadMore()}
          />
        {/each}
      {/if}
    {:else if !rows.length && !pl.loading}
      <p class="empty">{filtering ? 'Nothing matches.' : 'Nothing filed in this case yet.'}</p>
    {:else}
      <table class="table">
        <thead>
          <tr>
            {#if !snapshotReading}
              <!-- The heading's box reads the selection rather than the rows: ticked
                   with anything ticked, dashed while it is only part of the table.
                   So a click on a part-ticked table **clears** it — the browser would
                   otherwise complete the selection, ticking the very row that had
                   been left out on purpose, and the state it lands on is the one the
                   box was already showing. -->
              <th class="pick">
                <input
                  type="checkbox"
                  aria-label={chosen.length ? 'Clear the selection' : 'Select the rows loaded'}
                  title={chosen.length ? 'Clear the selection' : 'Select the rows loaded'}
                  checked={chosen.length > 0}
                  indeterminate={chosen.length > 0 && !allTicked}
                  onclick={(e) => e.stopPropagation()}
                  onchange={() => tickAll(!chosen.length)}
                />
              </th>
            {/if}
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
              class:current={(openId ?? snapshotOpen?.id) === entity.id}
              data-row-id={entity.id}
              tabindex="0"
              onclick={() => openRow(entity)}
              onkeydown={(e) => {
                // only the row's own key press: Enter on the confirm button inside
                // it is that button's, and would otherwise open Details as well
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openRow(entity);
                }
              }}
            >
              {#if !snapshotReading}
                <!-- The click is taken from the row underneath, never from the box
                     itself: a click always flips the box it is on, so the browser's
                     own toggle and the state it produces agree, and the rest of a
                     shift-run is written from the state. -->
                <td class="pick">
                  <input
                    type="checkbox"
                    aria-label="Select {entity.label}"
                    checked={ticked.has(entity.id)}
                    onclick={(e) => {
                      e.stopPropagation();
                      tick(entity, e.shiftKey);
                    }}
                  />
                </td>
              {/if}
              <td>
                {#if entity.thumb}
                  <img class="entity-thumb" src={thumbUrl(entity.thumb)} alt="" loading="lazy" />
                {:else}
                  <Icon name={entityIcon(entity)} size={12} />
                {/if}
                <span class="name" dir="auto">{entity.label}</span>
                {#if filter.q.trim() && matchReasons(entity)[0]}
                  {@const match = matchReasons(entity)[0]}
                  <span class="match-reason" title={match.value} dir="auto">
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
              {#each columns as column (column.key)}<td class="dim" dir="auto">{cell(entity, column)}</td>{/each}
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
                    showInGraph(entity);
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

    <!-- Paging belongs to the list. The addition is bounded server-side and says so on
         its own line, so a "Show more" under it would offer to lengthen a total. -->
    {#if pl.hasMore && !totalling && !grouped}
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

  <!-- Details beside the list, when there is room for both: the row stays in view
       while it is read, and the arrow keys walk from one to the next. -->
  {#if docked && ((openId && !snapshotReading) || (snapshotOpen && snapshotReading))}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Details"
      aria-valuemin={FICHE_MIN}
      aria-valuemax="900"
      aria-valuenow={ficheShown}
      tabindex="0"
      title="Drag to resize"
      onpointerdown={startResize}
      onkeydown={nudgeFiche}
    ></div>
    <aside class="fiche" style="width: {ficheShown}px" aria-label="Details">
      <div class="fiche-bar">
        <span class="fiche-title">{snapshotReading ? 'Snapshot details' : 'Details'}</span>
        <span class="fiche-keys">↑ ↓ next row · Esc close</span>
        <button
          class="btn btn-ghost btn-sm"
          aria-label="Close Details"
          title="Close (Esc)"
          onclick={() => (snapshotReading ? (snapshotOpen = null) : closeDetails())}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div class="fiche-body">
        {#if snapshotReading}
          <SnapshotDetails
            caseId={caseState.current?.id}
            entity={snapshotOpen}
            entities={catalogViews.activeView?.spec?.snapshot?.entities ?? []}
            links={catalogViews.activeView?.spec?.snapshot?.links ?? []}
          />
        {:else}
          <!-- The tab stays as the rows change, so walking five people on their
               Connections tab reads five sets of connections. -->
          <EntityDetails
            entityId={openId}
            bind:dirty
            onclose={() => (openId = null)}
            ondeleted={() => (openId = null)}
          />
        {/if}
      </div>
    </aside>
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
      reveal(entity.type);
      requestOpen(entity.id);
    }}
    oncreated={(entity) => {
      draft = null;
      // Create it, then open it in its group: a new subject exists in order to be
      // pointed at, so its own Details is where the next gesture is.
      reveal(entity.type);
      requestOpen(entity.id);
    }}
    onclose={() => (draft = null)}
  />
{/if}

<!-- Ctrl+V: a screenshot or a link, filed and opened -->
{#if pasted && !snapshotReading}
  <PasteDialog
    resolved={pasted}
    busy={pasteBusy}
    onconfirm={confirmPaste}
    onclose={() => (pasted = null)}
  />
{/if}

{#if openId && !snapshotReading && !docked && uiState.tool === 'board'}
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

{#if snapshotOpen && snapshotReading && !docked && uiState.tool === 'board'}
  <Modal title="Snapshot details" onclose={() => (snapshotOpen = null)} width="640px">
    <SnapshotDetails
      caseId={caseState.current?.id}
      entity={snapshotOpen}
      entities={catalogViews.activeView?.spec?.snapshot?.entities ?? []}
      links={catalogViews.activeView?.spec?.snapshot?.links ?? []}
    />
  </Modal>
{/if}

{#if confirmState}
  <ConfirmDialog
    title={confirmState.title}
    message={confirmState.message}
    detail={confirmState.detail}
    consequences={confirmState.consequences}
    restorable={confirmState.restorable}
    confirmLabel={confirmState.confirmLabel}
    tone={confirmState.tone}
    icon={confirmState.icon}
    busy={confirmBusy}
    onconfirm={runConfirm}
    oncancel={() => (confirmState = null)}
  />
{/if}

{#if discarding}
  <ConfirmDialog
    title="Discard changes?"
    message="This item has edits that Save has not taken."
    confirmLabel="Discard"
    icon="alert"
    onconfirm={() => {
      discarding = false;
      dirty = false;
      openId = pendingOpen;
      pendingOpen = null;
    }}
    oncancel={() => {
      discarding = false;
      pendingOpen = null;
    }}
  />
{/if}

<style>
  .spacer {
    flex: 1;
  }
  /* One height across the header. Views comes from a shared component and is `btn-sm`,
     the tool's own two are not, and three buttons of two heights read as a mistake.
     Stated from the same tokens a plain `.btn` is built from — its text plus its
     padding and rule — rather than as a number that would drift from them. */
  .tool-header :global(.btn) { min-height: calc(var(--fs-sm) * 1.5 + 12px); }
  /* The count reads first because it is the answer; the control that decides how that
     answer is drawn sits at the other end, directly above what it governs. */
  .answer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 16px 2px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  /* The whole sentence is one flex item, or the gap would fall between "23" and
     "of 1204" as well as around the control. */
  .answer .said {
    margin-right: auto;
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
  /* What the ticks come to. It appears only with a selection, so it is the one bar
     in the tool that changes the height of what is under it, and it sits above the
     scrolling body rather than floating over the rows it is about. */
  .picked {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 6px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .picked strong {
    color: var(--text-1);
  }
  .picked .drop:hover {
    color: var(--danger);
  }
  /* The list and Details beside it. `.tool` is a full-height flex column, so the row
     needs min-height:0 or the table pushes the column taller than the viewport and
     nothing scrolls at all. */
  .split {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  /* The list's own scrolling region. */
  .body {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 0 16px 16px;
  }
  /* Details beside the list: its own scroll, its own edge, resized from the rule. */
  .grip {
    position: relative;
    flex: 0 0 5px;
    margin-left: -2px;
    cursor: col-resize;
    border-left: 1px solid var(--border);
  }
  .grip:hover,
  .grip:focus-visible {
    border-left-color: var(--accent);
    outline: none;
  }
  .fiche {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
    background: var(--bg-1);
  }
  .fiche-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 16px;
    border-bottom: 1px solid var(--border);
  }
  .fiche-title {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .fiche-keys {
    margin-left: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .fiche-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px 16px;
  }
  /* Grouping and sort sit with the switch they share a job with, quiet until used. */
  .layout {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .pick-one {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .pick-one .select {
    width: auto;
    min-height: 0;
    padding: 2px 22px 2px 6px;
    font-size: var(--fs-xs);
  }
  /* What is waiting on the analyst, one line under the count. */
  .waiting-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 14px;
    margin: 0;
    padding: 0 16px 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .waiting-line .lead-in {
    color: var(--text-3);
    font-weight: 600;
  }
  .waiting-line .as-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font: inherit;
    cursor: pointer;
  }
  .waiting-line .as-link strong {
    color: var(--accent);
    font-weight: 600;
  }
  .waiting-line .as-link:hover {
    color: var(--text-1);
  }
  /* A case holding files only: the line that says how the index fills. */
  .no-subjects {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    margin: 10px 0 14px;
    padding: 12px 14px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .no-subjects strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .no-subjects .as-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  /* Between what the case is about and what it is built from. */
  .divider {
    height: 14px;
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
    border-radius: var(--r-md);
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
  /* The boxes take the width they need and no more, so the identity column keeps
     the room it had. */
  .table th.pick,
  .table td.pick {
    width: 1%;
    padding: 6px 8px 6px 2px;
  }
  .table .pick input {
    display: block;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
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
  /* The row whose Details are open beside the list. */
  .table tbody tr.current td {
    background: var(--accent-soft);
    color: var(--text-1);
  }
  .table tbody tr.current {
    border-left-color: var(--accent);
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
  /* The addition. A sum reads as one figure per condition rather than as a sentence,
     and everything it left out sits under the count it was left out of. */
  .reading-note {
    margin: 0 0 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .tally .sum {
    display: block;
    font-variant-numeric: tabular-nums;
  }
  .tally .note,
  .tally .sure {
    display: block;
    margin-top: 2px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .tally .sure {
    font-style: italic;
  }
  .tally td .dim {
    margin-left: 6px;
  }
</style>
