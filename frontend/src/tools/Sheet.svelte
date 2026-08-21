<script>
  /**
   * The Case Sheet: a table the analyst works in, which is a real CSV in the case.
   *
   * Three things an investigation needs and no other tool here does. A **comparison
   * grid** — candidates down, criteria across — which is how eleven leads out of
   * twelve get ruled out. A **worklist**: seen, ruled out, to check, the reason
   * written beside it, and a count that says where you are. And a place for the
   * **half-facts**: a plate half read, a name with no surname, things too soft to be
   * entities but too valuable to lose. The graph says what the case believes; a
   * sheet says what it is checking.
   *
   * It is not a spreadsheet. No formulas, no cell types, no second copy of the case:
   * `sheets/<name>.csv` is the artifact, and it opens in LibreOffice the day Azimut
   * is gone. What the analyst *found* — a status, a verdict, a note — is a column of
   * that file. What the *grid* remembers — widths, colours, which column stays in
   * view, which entity a cell points at — is a sidecar beside it, and losing it costs
   * presentation only.
   *
   * Two consequences of the file being the artifact run through everything here.
   *
   * The browser never parses or writes **CSV**: it sends a table and gets a table
   * back (`engine/sheets.py` owns both ends), so an imported file and a saved grid
   * cannot drift into two readings of the same rows. A clipboard block is not that
   * case — it is TSV, and a paste is a patch into a selection whose geometry only
   * this side knows — so `lib/sheetClipboard.js` owns it and a paste costs no round
   * trip.
   *
   * And the analyst may have the same file open in a spreadsheet. So a read hands out
   * a stamp, every save presents it back, and a save that would overwrite work the
   * grid never saw is refused: the banner asks, rather than the file losing.
   *
   * What a **heading** offers is split three ways, by how often each is wanted: the funnel
   * asks something of the rows, a right-click (or the `...`) is the short list of gestures
   * — sort, insert, duplicate, rename, split, hide, delete — and that list's last row opens
   * the setup panel, where a column is told what it is. The gutter has a menu of its own for
   * the same reason. Before that split, the `...` opened the panel and half of what an
   * analyst does to a column had no door at all.
   *
   * No rules live in this file. The table, the selection, the clipboard, the cleaning passes
   * and the undo stack are all pure modules; what is here is the screen.
   */
  import { tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { CASE_FOLDER_LABEL, destinationLabel, readDestinations } from '../lib/exportDest.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';
  import {
    DEFAULT_WIDTH,
    GUTTER_WIDTH,
    ID_COLUMN,
    ROW_COLOURS,
    addColumn,
    addRow,
    applyEdits,
    cellRange,
    clearFilter,
    clearFilters,
    dropChip,
    duplicateColumn,
    duplicateRows,
    emptyMeta,
    explodeRow,
    fillDownEdits,
    fillEdits,
    filterChips,
    filterSummary,
    highlightParts,
    insertColumn,
    insertRow,
    isFilterActive,
    keyIndex,
    keysBetween,
    linkAt,
    linkedEntityIds,
    linkLabel,
    mergeRows,
    moveColumn,
    nextSecondSort,
    nextSort,
    onlyFilterValue,
    rangeValues,
    readFilters,
    removeColumn,
    removeRows,
    renameColumn,
    renameFilterColumn,
    rowHeight,
    rowKey,
    scrollFromThumb,
    scrollThumb,
    serializeFilters,
    setCells,
    setColour,
    setFilterContains,
    setFilterRange,
    setFilterWithout,
    setFrozen,
    setLegend,
    setLink,
    setPinned,
    setTall,
    setWidth,
    shownKeys,
    stickyOffsets,
    toggleFilterFill,
    toggleFilterValue,
    toggleHidden,
    tooBigBy,
    urlsIn,
    visibleColumns,
    visibleRows,
    withoutEntities,
  } from '../lib/sheet.js';
  import { appendRows } from '../lib/sheetAppend.js';
  import { linkRows, looksLikeLinks, parseBlock, pasteBlock, toBlock } from '../lib/sheetClipboard.js';
  import { describeDiff, diffTables, sameTable } from '../lib/sheetDiff.js';
  import { exportCsv, provenance, revealSheetExports, toMarkdown, viewTable } from '../lib/sheetExport.js';
  import { cellsEntry, createSheetHistory, snapshotEntry } from '../lib/sheetHistory.js';
  import { checkLinks, chunk, readVerdicts, urlsInColumn } from '../lib/sheetLinks.js';
  import {
    cellChips,
    columnProgress,
    cycleTick,
    flipBoolean,
    isChipped,
    numberTotals,
    duplicateGroups,
    formatLatLon,
    nearbyPairs,
    parseLatLon,
    parseWhen,
    pictureRef,
    precisionMetres,
    readsCell,
    suggestProgressColumn,
    tickState,
  } from '../lib/sheetRoles.js';
  import { backLinks, rowLabel, rowTargets } from '../lib/sheetRows.js';
  import { SHEET_TEMPLATES, sheetTemplate, templateMeta } from '../lib/sheetTemplates.js';
  import { canBuild, columnKinds } from '../lib/sheetBuild.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import SheetAppend from '../components/SheetAppend.svelte';
  import SheetCellEditor from '../components/SheetCellEditor.svelte';
  import SheetClean from '../components/SheetClean.svelte';
  import SheetColumnPanel from '../components/SheetColumnPanel.svelte';
  import SheetEntityPicker from '../components/SheetEntityPicker.svelte';
  import SheetFilterMenu from '../components/SheetFilterMenu.svelte';
  import SheetFromCase from '../components/SheetFromCase.svelte';
  import SheetGeocode from '../components/SheetGeocode.svelte';
  import SheetHeadingMenu from '../components/SheetHeadingMenu.svelte';
  import SheetHelp from '../components/SheetHelp.svelte';
  import SheetLegend from '../components/SheetLegend.svelte';
  import SheetAnchors from '../components/SheetAnchors.svelte';
  import SheetToCase from '../components/SheetToCase.svelte';
  import SheetBuildProofs from '../components/SheetBuildProofs.svelte';
  import SheetMove from '../components/SheetMove.svelte';
  import SheetRowMenu from '../components/SheetRowMenu.svelte';
  import SheetRowPanel from '../components/SheetRowPanel.svelte';

  const HEAD_H = 32;
  /** How long the two lines above the grid may be. Mirrors `engine/sheets.MAX_DESCRIPTION`,
   *  which is what actually holds: this only stops the box growing past what is read. */
  const MAX_DESCRIPTION = 400;
  const OVERSCAN = 10;

  let sheets = $state([]);
  let openId = $state(null);
  let title = $state('');
  let table = $state({ columns: [], rows: [] });
  let meta = $state(emptyMeta());
  /** The file on disk has no key column yet — someone edited it elsewhere. */
  let assigned = $state(false);
  /** What the file looked like when it was read. Presented back on every save. */
  let stamp = $state('');
  /** The file moved on under the grid: nothing more is written until this is answered. */
  let conflict = $state(false);
  let loading = $state(false);
  let saveState = $state('idle'); // 'idle' | 'dirty' | 'saving' | 'saved' | 'failed'
  /** Counted up by every edit. A write carries the number the grid was at when it left,
   *  so a reply can be told from an out-of-date one. Not reactive: nothing draws it. */
  let revision = 0;
  /** The write in flight, so the next one queues behind it rather than racing it. */
  let inFlight = null;
  /**
   * Whether anything unsaved touches the **table**, rather than only the sidecar.
   *
   * What decides which of the two save routes a pass takes. A filter, a colour, a width, a
   * hidden column and a pinned row are the grid: they go through `PUT .../meta`, which
   * leaves the CSV byte-identical — because rewriting the file to record that a funnel was
   * clicked moved its modification time, which is what the stamp is made of, and the
   * analyst's own next save then answered a conflict nobody caused.
   *
   * Sticky until a full save lands: a table change still pending means the sidecar may
   * refer to a column that is not on disk yet, and the meta route cleans against the file.
   */
  let pendingTable = false;
  /** The file moved on under the grid but nothing is lost yet — said softly, because the
   *  analyst is mid-sentence and the answer is theirs. `{ diff }` once it is read. */
  let stale = $state(null);
  let comparing = $state(false);

  /**
   * What is typed, and what the grid is filtered on.
   *
   * Two values because they answer on different clocks: the box has to echo the keystroke
   * at once, and narrowing twenty thousand rows must not run on every letter of `kherson`.
   * The delay is short enough to read as instant and long enough that a word costs one pass
   * rather than seven.
   */
  let queryInput = $state('');
  let query = $state('');
  let queryTimer = null;
  let filters = $state({}); // column -> what is asked of it
  let cursor = $state({ row: -1, column: -1 }); // in table coordinates
  /** The other end of a selected rectangle, in table coordinates. */
  let anchor = $state(null);
  let editing = $state(null); // { row, column, value }
  let picked = $state(new Set()); // row keys ticked in the gutter
  /** The last row ticked by hand, so shift-click knows where the range starts. */
  let lastTicked = $state(null);

  let picker = $state(null); // the sheet menu
  /** The ways a sheet is started, under one button: a blank one, a file, a paste, the
   *  case's own entities, and rows into the sheet already open. */
  let newOpen = $state(false);
  let newAnchor = $state(null);
  let creating = $state(null); // { title } | { title, text } for an import or a paste
  /** What is waiting to be confirmed, and which of the three it is. Every delete here
   *  goes through it: a column carries a role and a note nothing else remembers, and a
   *  batch of rows is however many were ticked, which is exactly the number nobody
   *  wants to find out afterwards. */
  let confirming = $state(null); // { kind: 'sheet' | 'column' | 'rows', ... }
  let exporting = $state(false);
  let detailsId = $state(null); // an entity opened from a linked cell
  let detailsDirty = $state(false); // Details holds edits its own Save has not taken
  let discarding = $state(false); // asking before those edits are thrown away
  let linking = $state(null); // { row, column }
  let rowPanel = $state(null); // a row read down instead of across, by table index
  /** Which column the right-hand panel is showing, by table index. It follows the
   *  next heading clicked rather than closing, which is what a menu could not do. */
  let columnPanel = $state(null);
  let columnsOpen = $state(false);
  /**
   * Which heading's filter menu is open, and where to draw it.
   *
   * The position travels with the state because the menu is rendered **outside** the
   * scroller: inside it, `overflow: auto` would clip it and the grid's own scrollbars
   * would grow to account for a menu that is not content. So it is placed from the
   * funnel's rectangle, read once — and the grid scrolling closes it, since the
   * heading it belongs to has moved.
   */
  let filterAt = $state(null); // { index, x, y }
  let filterMenu = $state(null);
  /** Every heading's funnel, by column name. Bound so the columns list can open the
   *  menu of a column that is not on screen, after bringing it there. */
  const funnels = $state({});
  /** A cell's own menu: filtering where the answer actually is, rather than by walking
   *  up to the heading of the column it is in. */
  let cellMenu = $state(null); // { row, column, value, x, y }
  let cellMenuEl = $state(null);
  let filling = $state(null); // { column } while a column is filled in bulk
  /** The answer being written, kept beside `filling` rather than inside it: an input
   *  bound into an object still reads it once as the object is cleared away. */
  let fillValue = $state('');
  let dragColumn = $state(null); // { from, over } while a heading is dragged
  let dropping = $state(false); // a file is over the grid
  let selecting = $state(false); // a pointer is held down, pulling a selection
  // Each popover's own wrapper, holding both its trigger and its panel. Bound so a
  // pointer landing outside closes it — and so a pointer on the trigger does not,
  // which would close and reopen it in one click.
  let pickerAnchor = $state(null);
  let columnsAnchor = $state(null);
  /** Roles the file lost, because a column they named is gone. Said, not swallowed. */
  let droppedRoles = $state([]);
  /** A reading over one column, shown under the question bar until it is dismissed:
   *  what a column repeats, or which of its points sit on top of each other. */
  let reading = $state(null);
  /** What changed in a row this session, keyed by the row's own key rather than its
   *  position, so a sort or a delete cannot move a log onto another row. Session-only:
   *  a durable one would be a new file, which means a Trash and a bundle decision. */
  let rowLog = $state(new Map());
  let promoting = $state(false); // the ticked rows are being turned into entities
  let promoteOpen = $state(false);
  /** Building proofs out of a geolocation index: the one road out of a sheet that fetches
   *  files, so it runs as a job with a progress and a stop rather than as a request. */
  let buildOpen = $state(false);
  let buildJob = $state(null); // { id, progress } while the press is running
  let buildReport = $state(null); // what the press came back with, until the screen closes
  /** The named moments an offset column counts from. One sheet, several of them. */
  let anchorsOpen = $state(false);
  /** Moving the ticked rows up a floor, into another sheet at the same schema. */
  let moving = $state(false);
  /** Which row is being given a case file to carry, by row key. */
  let attaching = $state(null);
  /** Entity id → what it is called, for the pieces a row carries. Presentation only: the
   *  sidecar holds ids, and this is what the read answers so the panel can name them. */
  let pieces = $state({});
  /** The two lines above the grid, while they are being written. */
  let describing = $state(false);
  let describeText = $state('');
  /** The heading's short menu — the frequent gestures, one press from the heading itself
   *  and from a right-click on it. `{ index, x, y }`. */
  let headMenu = $state(null);
  let headMenuEl = $state(null);
  /** The gutter's own menu, on the row under the pointer. `{ row, x, y }`. */
  let rowMenu = $state(null);
  let rowMenuEl = $state(null);
  /** Which heading is being renamed in place, by table index. Double-click, which is what
   *  a spreadsheet does and what the panel made a two-click trip. */
  let renaming = $state(null);
  let renameText = $state('');
  /** A cleaning pass being set up: `{ column, mode }`. */
  let cleaning = $state(null);
  /** A whole column being pointed at the case, by table index. */
  /** The worklist being built out of the catalog. */
  let fromCase = $state(false);
  let building = $state(false);
  /** A batch of rows being added to the sheet that is already open. */
  let appending = $state(false);
  /** A geocoding pass being set up: `{ index, mode }`, forward or reverse. */
  let geocoding = $state(null);
  /** Which way to hand the sheet over, when that menu is open. */
  let exportOpen = $state(false);
  let exportAnchor = $state(null);
  /** Where a CSV lands: `null` until Settings answers, `''` for the case's own folder. */
  let destination = $state(null);
  let destPicker = $state(false);
  /** The list of gestures, which nothing else in the tool announces. */
  let helpOpen = $state(false);
  /** What each row colour means in this sheet. */
  let legendOpen = $state(false);
  let legendAnchor = $state(null);
  /** Narrowing the sheet list, once a case holds more than a handful. */
  let sheetTerm = $state('');
  /** A link sweep in flight: `{ column, done, total }`. */
  let checking = $state(null);

  const history = createSheetHistory();
  // The stack itself is plain, so its two answers are mirrored into state the
  // buttons can read — the same shape Inspect's collage history uses.
  let canUndo = $state(false);
  let canRedo = $state(false);
  let saveTimer = null;
  let scroller = $state(null);
  let searchBox = $state(null);
  let scrollTop = $state(0);
  let viewport = $state(600);
  /** What the scroller measures, re-read on every scroll and resize. The bars are
   *  drawn from this rather than from the browser's own. */
  let extent = $state({ scrollW: 0, clientW: 0, scrollH: 0, clientH: 0, left: 0, top: 0 });
  let dragging = $state(null); // 'x' | 'y' while a thumb is held

  const caseId = $derived(caseState.current?.id ?? null);
  const drawn = $derived(visibleColumns(table.columns, meta));
  const roles = $derived(meta.roles ?? {});
  /** One row's height, and the reason the grid can hold twenty thousand of them: only the
   *  rows on screen are in the DOM. Fixed for a given sheet, so the arithmetic stays one
   *  division — but the sheet chooses which of the two heights, because a worklist wants
   *  thirty pixels and the column the reasoning is written in cannot live in one line. */
  const rowH = $derived(rowHeight(meta));
  const matching = $derived(visibleRows(table, { query, filters, sort: meta.sort, roles }));
  /** The row kept under the heading, by table index, when it is one of the rows the filter
   *  left: a reference pinned and then filtered away is not on screen, and drawing it there
   *  anyway would be the grid disagreeing with its own count. */
  const pinnedAt = $derived(
    meta.pinned
      ? matching.find((index) => rowKey(table.columns, table.rows[index]) === meta.pinned) ?? -1
      : -1,
  );
  /** What scrolls: everything matching except the pinned row, which is drawn above it. */
  const shown = $derived(pinnedAt === -1 ? matching : matching.filter((index) => index !== pinnedAt));
  /** Which column says how far along the work is, and what it says. Any column, with or
   *  without a role: the binder this most has to replace is a geolocation index with no
   *  status column at all, and its question is the fill rate of one column. */
  const progressAt = $derived(table.columns.indexOf(meta.progress ?? ''));
  const progress = $derived(
    progressAt === -1 ? null : columnProgress(table, progressAt, roles[meta.progress]),
  );
  const chips = $derived(filterChips(filters));
  const offsets = $derived(stickyOffsets(drawn, meta));
  const range = $derived(cellRange(shown, drawn, anchor, cursor));
  const selectedRows = $derived(new Set(range.rows));
  const selectedColumns = $derived(new Set(range.columns));
  /** Whether the selection is more than the one cell under the cursor: what decides
   *  if copying and filling down have something to work on. */
  const hasRange = $derived(range.rows.length > 1 || range.columns.length > 1);
  const allShownTicked = $derived(
    shown.length > 0 && shownKeys(table, shown).every((key) => picked.has(key)),
  );

  /**
   * The rows every action that works on *rows* works on.
   *
   * There were two selections and they disagreed. Ticking rows in the gutter drove the
   * fill, the paint, the delete and the promotion; dragging across cells drove the copy,
   * the fill-down and the clear. So a screenful of rows selected by dragging offered no
   * way to paint them, and forty ticked rows could not be copied.
   *
   * One rule now: **what is ticked, or failing that what is selected.** Ticking is
   * deliberate and survives a scroll, so it wins where both exist; a drag over three rows
   * is a selection like any other and gets the same actions. The bar says which of the
   * two it is holding, because "40 rows" that turn out to be the wrong forty is the one
   * thing this must not do.
   */
  const batchIndices = $derived(
    picked.size
      ? table.rows
          .map((row, index) => index)
          .filter((index) => picked.has(rowKey(table.columns, table.rows[index])))
      : range.rows.length > 1
        ? range.rows
        : [],
  );
  const batchKeys = $derived(batchIndices.map((index) => rowKey(table.columns, table.rows[index])));
  /** The same rows, said one by one, for the screen that asks before it moves them: a
   *  key, whatever the row is called, and the colour it was painted. */
  const batchRows = $derived(
    batchIndices.map((index) => {
      const row = table.rows[index] ?? [];
      const at = keyIndex(table.columns);
      const said = row.find((cell, column) => column !== at && String(cell ?? '').trim());
      const key = rowKey(table.columns, row);
      return { key, label: String(said ?? '').trim().slice(0, 90), colour: meta.colours?.[key] };
    }),
  );
  const template = $derived(
    ['34px', ...drawn.map((column) => `${meta.widths?.[column.name] ?? DEFAULT_WIDTH}px`)].join(' '),
  );
  /** The heading row carries one track more than a body row: the button that adds
   *  a column. Without it that button falls onto an implicit second row. */
  const headTemplate = $derived(`${template} 34px`);
  const hThumb = $derived(scrollThumb(extent.clientW, extent.scrollW, extent.left));
  const vThumb = $derived(scrollThumb(extent.clientH, extent.scrollH, extent.top));
  /** What sits above the scrolling rows and stays there: the heading, and the pinned
   *  reference row when there is one. Everything that turns a scroll position into a row
   *  index goes through it, or the cursor lands underneath the row it was walked to. */
  const headRoom = $derived(HEAD_H + (pinnedAt === -1 ? 0 : rowH));
  const first = $derived(Math.max(0, Math.floor((scrollTop - headRoom) / rowH) - OVERSCAN));
  const last = $derived(
    Math.min(shown.length, Math.ceil((scrollTop - headRoom + viewport) / rowH) + OVERSCAN),
  );
  const window_ = $derived(shown.slice(first, Math.max(first, last)));
  /** How many rows carry each colour, for the legend: a colour nothing uses is not worth
   *  naming, and the count is what says so. */
  const colourCounts = $derived(
    Object.values(meta.colours ?? {}).reduce(
      (counts, colour) => ({ ...counts, [colour]: (counts[colour] ?? 0) + 1 }),
      {},
    ),
  );
  /** The colours actually in the sheet, with what they were said to mean. Drawn in the
   *  footer, so the meaning sits under the rows rather than in one analyst's head. */
  const legendUsed = $derived(
    ROW_COLOURS.filter((colour) => colourCounts[colour]).map((colour) => ({
      colour,
      label: meta.legend?.[colour] ?? '',
      rows: colourCounts[colour],
    })),
  );
  const sheetsShown = $derived(
    sheetTerm.trim()
      ? sheets.filter((sheet) =>
          String(sheet.title ?? '').toLowerCase().includes(sheetTerm.trim().toLowerCase()),
        )
      : sheets,
  );

  // -- loading ---------------------------------------------------------------

  $effect(() => {
    const id = caseId;
    caseState.rev; // re-list when the case reloads: a sheet may have been deleted
    if (!id) return;
    untrack(() => list(id));
  });

  async function list(id) {
    try {
      const answer = await api.get(`/api/cases/${id}/sheets`);
      sheets = answer.sheets ?? [];
      if (openId && !sheets.some((sheet) => sheet.id === openId)) close();
      // The one that was being worked on, and the first sheet only as a fallback. A tool
      // that reopened on sheet number one sent the analyst back through the picker every
      // morning, and on a case holding nine worklists that is the wrong nine times out of
      // ten.
      if (!openId && sheets.length) {
        const last = lastOpened(id);
        open(sheets.some((sheet) => sheet.id === last) ? last : sheets[0].id);
      }
    } catch {
      sheets = [];
    }
  }

  /** Which sheet this case was last left on. Kept in the browser rather than in the case:
   *  it is where *this* analyst was reading, not something the case believes, and a bundle
   *  carrying it would hand a colleague somebody else's place in the work. */
  const LAST_KEY = 'azimut.sheet.last';

  function lastOpened(id) {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}')[id] ?? null;
    } catch {
      return null;
    }
  }

  function rememberOpened(id, sheetId) {
    try {
      const held = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...held, [id]: sheetId }));
    } catch {
      // A browser refusing storage is not a reason to refuse the sheet.
    }
  }

  async function open(id) {
    if (id === openId) return;
    await flush();
    loading = true;
    picker = null;
    try {
      adopt(await api.get(`/api/cases/${caseId}/sheets/${id}`), { reset: true });
      openId = id;
      rememberOpened(caseId, id);
    } catch (error) {
      toast(error.message || 'This sheet could not be opened.', 'error');
    } finally {
      loading = false;
    }
  }

  /** Take a table the server just handed over. `reset` is a different sheet or the
   *  same one re-read from disk, and either way the undo stack no longer describes
   *  anything: keeping it would let an undo replay edits onto rows that moved. */
  function adopt(sheet, { reset = false } = {}) {
    title = sheet.title ?? title;
    table = { columns: sheet.columns ?? [], rows: sheet.rows ?? [] };
    meta = { ...emptyMeta(), ...(sheet.meta ?? {}) };
    assigned = Boolean(sheet.assigned);
    stamp = sheet.stamp ?? '';
    conflict = false;
    stale = null;
    saveState = 'idle';
    if (sheet.dropped_roles?.length) droppedRoles = sheet.dropped_roles;
    // What the case files a row carries are called. Answered by the read rather than
    // stored beside the ids, because a label kept in the sidecar goes stale the moment
    // the entity is renamed — and merged rather than replaced, since a save answers no
    // pieces and one attached a second ago would lose its name.
    if (sheet.pieces) pieces = { ...pieces, ...sheet.pieces };
    if (reset) {
      resetView();
      history.reset();
      rowLog = new Map();
      canUndo = false;
      canRedo = false;
      // The question the sheet was left on, and only that. A head start used to be posted
      // on top of it — the progress column's empty rows, as a chip — and it could not tell
      // "the analyst cleared their filters" from "this sheet has never been asked
      // anything", because both are an empty table in the sidecar. So it came back every
      // time the sheet was reopened, which reads exactly as a filter appearing from
      // nowhere. The footer already offers those rows in one click, named and asked for.
      filters = readFilters(meta.filters, table.columns);
      queryInput = meta.query ?? '';
      query = queryInput;
    }
  }

  /**
   * Open on the rows still to do, when the sheet says which column that is.
   *
   * Posted as an ordinary filter, so it shows as a chip and one click clears it. A sheet
   * that opened having quietly hidden three hundred rows would be a bug to whoever
   * opened it — the point is a head start, not a hidden state.
   *
   * And only when there is actually something left. A finished worklist used to open on a
   * filter matching nothing: an empty grid over `0 of 468`, which reads as a lost sheet
   * rather than as a job done.
   */

  function close() {
    openId = null;
    table = { columns: [], rows: [] };
    meta = emptyMeta();
    stamp = '';
    conflict = false;
    stale = null;
    resetView();
  }

  function resetView() {
    query = '';
    queryInput = '';
    filters = {};
    cursor = { row: -1, column: -1 };
    anchor = null;
    editing = null;
    picked = new Set();
    lastTicked = null;
    rowPanel = null;
    columnPanel = null;
    reading = null;
    filling = null;
    if (scroller) scroller.scrollTop = 0;
  }

  /**
   * What is typed, applied a moment later.
   *
   * The pass over the table is cheap per row and there are twenty thousand of them, so a
   * letter costing a full pass is a box that stutters. The term is also part of the reading,
   * so it is written to the sidecar — through the same debounce, since a save per keystroke
   * would be worse than the pass.
   */
  function onQuery(value) {
    queryInput = value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      query = queryInput;
      rememberView();
    }, 180);
  }

  /**
   * Write down what the analyst is looking at.
   *
   * The sidecar always carried half a reading — the sort, the hidden columns, the widths —
   * and the half that decides which rows are on screen lived in this tab and died with it.
   * So a sheet reopened showing all four hundred rows and the question had to be rebuilt
   * every morning, on a tool whose stated answer to saved views is *the sheet is its own
   * saved reading*.
   *
   * It is a **view** change: it never enters the undo stack, because Ctrl+Z is for what was
   * written, not for what was asked, and it goes out through the sidecar-only route.
   */
  function rememberView() {
    if (!openId) return;
    const asked = serializeFilters(filters);
    if (JSON.stringify(asked) === JSON.stringify(meta.filters ?? {}) && (meta.query ?? '') === query) {
      return;
    }
    meta = { ...meta, filters: asked, query };
    touch({ table: false });
  }

  /** Change one column's filter and remember it. Every funnel, chip and cell menu goes
   *  through here, so none of them can be the one that forgets. */
  function ask(next) {
    filters = next;
    rememberView();
  }

  // -- saving ----------------------------------------------------------------
  //
  // A grid autosaves. Asking someone to press Save after every cell is asking them
  // to lose work, and the file is the artifact — it should hold what is on screen.

  function snapshot({ withTable = true } = {}) {
    return JSON.stringify(withTable ? { table, meta } : { meta });
  }

  /** Mark the sheet unsaved and schedule the write. Nothing is scheduled while a
   *  conflict stands: the analyst has to say whether to reload or to overwrite, and
   *  retrying behind them would be a queue of refusals.
   *
   *  `table: false` says the change is the sidecar's alone — a filter, a colour, a width —
   *  which is what lets the write go out without rewriting the CSV. Sticky until a full
   *  save lands: a table change still pending means the file does not hold the columns the
   *  sidecar talks about yet. */
  function touch({ table: touchesTable = true } = {}) {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
    revision += 1;
    if (touchesTable) pendingTable = true;
    saveState = 'dirty';
    clearTimeout(saveTimer);
    if (!conflict) saveTimer = setTimeout(save, 900);
  }

  /** Record a run of cell edits and apply them. The common path, and the cheap one:
   *  what is kept is the cells, not the table. */
  function editCells(edits) {
    if (!edits?.length) return;
    // A cell emptied loses what it pointed at. A blank cell still holding a link is a
    // link nobody can see, reach or clear — and it would keep its `mentions` edge on
    // every save, so the case would go on believing a row that says nothing.
    const orphans = edits.filter(
      (edit) => !String(edit.after ?? '').trim() && linkOf(edit.row, table.columns[edit.column]),
    );
    if (orphans.length) {
      logEdits(edits);
      // The sidecar moves too, so this is one whole-table step rather than a patch.
      structural(() => {
        table = applyEdits(table, edits, 'forward');
        let next = meta;
        for (const edit of orphans) {
          const key = rowKey(table.columns, table.rows[edit.row]);
          next = setLink(next, key, table.columns[edit.column], null);
        }
        meta = next;
      });
      return;
    }
    logEdits(edits);
    table = applyEdits(table, edits, 'forward');
    history.record(cellsEntry(edits));
    touch();
  }

  /** Note what changed, before the table moves: the row's key is still the one the edit
   *  was aimed at, and it is filed against that key rather than the row's position — a
   *  sort between two edits would otherwise file the second against somebody else's row. */
  function logEdits(edits) {
    const log = new Map(rowLog);
    for (const edit of edits) {
      const key = rowKey(table.columns, table.rows[edit.row]);
      if (!key) continue;
      const entries = [...(log.get(key) ?? [])];
      entries.push({ column: table.columns[edit.column], before: edit.before, after: edit.after });
      log.set(key, entries.slice(-40));
    }
    rowLog = log;
  }

  /** Record a change no list of cells describes — a column added, moved or dropped,
   *  rows deleted, a paste that grew the sheet — by keeping the table on both sides.
   *  `withTable: false` is for a change that only touches the sidecar, which is
   *  kilobytes rather than megabytes on a long sheet. */
  function structural(change, { withTable = true } = {}) {
    const before = snapshot({ withTable });
    change();
    history.record(snapshotEntry(before, snapshot({ withTable })));
    // The same flag answers both questions, because they are the same question: a step the
    // undo stack can describe with the sidecar alone is a step the save can write with the
    // sidecar alone.
    touch({ table: withTable });
  }

  /**
   * Write the sheet, one write at a time.
   *
   * Serialised rather than fired off, because every write presents the `stamp` it read
   * the file at. Two in the air present the same one, the second is answered with the
   * conflict banner, and the analyst is asked to arbitrate a race between their own
   * keystrokes. Queueing behind the one in flight is what makes the stamp current
   * again by the time the next write reads it.
   */
  async function save({ force = false } = {}) {
    clearTimeout(saveTimer);
    if (!openId || !caseId) return;
    const mine = (inFlight = inFlight ? inFlight.then(() => write(force)) : write(force));
    try {
      await mine;
    } finally {
      if (inFlight === mine) inFlight = null;
    }
  }

  /**
   * One write, down whichever of the two roads the change needs.
   *
   * A sheet's state is two things and they are not written the same way. The **table** is
   * the artifact: it goes with the stamp, and a save that would overwrite work the grid
   * never saw is refused. The **sidecar** is the grid: widths, colours, the sort, the
   * filters, the pinned row. Sending the sidecar through the table's route meant rewriting
   * the CSV to record that a funnel had been clicked — which moved the modification time
   * the stamp is made of, so the analyst's own next save answered a conflict nobody caused,
   * and a spreadsheet open on the same file was told it had been overwritten.
   */
  async function write(force) {
    const id = openId;
    const sent = revision;
    const tableToo = pendingTable;
    saveState = 'saving';
    try {
      const saved = tableToo
        ? await api.put(`/api/cases/${caseId}/sheets/${id}`, {
            columns: table.columns,
            rows: table.rows,
            meta,
            // Forcing is the analyst answering the banner: write over what is there.
            ...(force ? {} : { stamp }),
          })
        : await api.put(`/api/cases/${caseId}/sheets/${id}/meta`, { meta });
      if (openId !== id) return; // the analyst moved on while this was in flight
      // Only the table's own route writes the file, so only it hands back a new stamp.
      if (tableToo) stamp = saved.stamp ?? '';
      conflict = false;
      stale = null;
      // Edits landed while this was in the air, so what came back describes the sheet
      // as it was *before* them. Adopting it would flip the cell they just ticked back
      // under their hand and then write that revert on the next pass. The sheet stays
      // unsaved and the write `touch` already scheduled carries them instead — including
      // the fact that the table is dirty, which is why the flag is cleared only here.
      if (revision !== sent) {
        saveState = 'dirty';
        return;
      }
      if (tableToo) pendingTable = false;
      // The server is the one that cleans the sidecar, so what comes back is what
      // the case holds; adopting it is how a stale colour stops being drawn.
      meta = { ...emptyMeta(), ...(saved.meta ?? {}) };
      if (tableToo) {
        table = { columns: saved.columns, rows: saved.rows };
        assigned = false;
      }
      saveState = 'saved';
    } catch (error) {
      saveState = 'failed';
      if (error?.status === 409) {
        // Said by the banner, which offers the two ways out. A toast on top of it
        // would say the same thing twice and then vanish.
        conflict = true;
        return;
      }
      toast(error.message || 'This sheet could not be saved.', 'error');
    }
  }

  /**
   * Whether the grid is holding work the file does not have yet.
   *
   * Which is exactly what `Reload` throws away, and what the banner had no word for: it
   * dressed `Overwrite` as the dangerous one and left `Reload` looking like the safe
   * default, when in a conflict it is the analyst's *own* unsaved edits that it drops —
   * along with the undo stack, since a re-read resets it.
   */
  const unsaved = $derived(saveState === 'dirty' || saveState === 'failed' || conflict);

  /** Re-read the file and lose the grid's version of it. */
  async function reload() {
    try {
      adopt(await api.get(`/api/cases/${caseId}/sheets/${openId}`), { reset: true });
    } catch (error) {
      toast(error.message || 'This sheet could not be opened.', 'error');
    }
  }

  /** Write anything pending before leaving the sheet, so switching never drops an edit. */
  async function flush() {
    if (saveState === 'dirty') await save();
  }

  $effect(() => () => {
    clearTimeout(saveTimer);
    clearTimeout(queryTimer);
  });

  /**
   * Ask the file whether it is still the one this grid read, when the window comes back.
   *
   * The stamp was only ever checked by a save, which meant an analyst who edited the CSV in
   * a spreadsheet went on working in a grid showing the old table — sometimes for an hour —
   * and found out at the moment they were least able to choose: a refusal, with their own
   * edits on one side and somebody's on the other.
   *
   * A stat is cheap enough to ask on every focus. It is deliberately **not** a conflict:
   * nothing has been refused, so the banner says what is on disk and offers to read it.
   */
  async function checkStamp() {
    if (!openId || !caseId || conflict || !stamp || uiState.tool !== 'sheet') return;
    try {
      const answer = await api.get(`/api/cases/${caseId}/sheets/${openId}/stamp`);
      if (answer.stamp && answer.stamp !== stamp) stale = { diff: null };
    } catch {
      // Offline or the sheet is gone: the ordinary save will say so, in the place that can.
    }
  }

  /**
   * Read what the file holds and say how it differs, without taking it.
   *
   * The whole point of the banner having a third button. "Reload" and "Overwrite" are both
   * irreversible in the direction that matters, and until now the analyst chose between them
   * over one sentence saying the file had moved on — three rows a colleague added and one
   * stray cell they fixed themselves were the same press.
   */
  async function compare() {
    if (!openId || comparing) return;
    comparing = true;
    try {
      const disk = await api.get(`/api/cases/${caseId}/sheets/${openId}`);
      const diff = diffTables(table, { columns: disk.columns, rows: disk.rows });
      // A spreadsheet that opened the file and saved it unchanged rewrote every byte of it,
      // which moves the stamp and changes nothing. Saying so is the answer that ends it.
      if (sameTable(diff)) {
        stamp = disk.stamp ?? stamp;
        stale = null;
        conflict = false;
        toast('The file holds the same table.');
        return;
      }
      if (conflict) conflict = true;
      stale = { diff };
    } catch (error) {
      toast(error.message || 'That file could not be read.', 'error');
    } finally {
      comparing = false;
    }
  }

  // -- the sheet list --------------------------------------------------------

  /**
   * File a new sheet, or a pasted table as one.
   *
   * A **template** is columns and what the app should know about them: a verification
   * worklist arrives with its status column already a state, a geolocation index with its
   * coordinates already a point. Those are the four tables an analyst rebuilds by hand every
   * case, ten minutes of naming columns before any work happens — and each one slightly
   * different, which is why two of their sheets never compare.
   *
   * The roles are laid on afterwards rather than at creation: the browser owns reading a
   * role, so a create route that also took a sidecar would be a second way to write one.
   */
  async function create() {
    const name = (creating?.title ?? '').trim();
    if (!name) return;
    const pasted = creating.text !== undefined;
    const template = pasted ? null : sheetTemplate(creating.template);
    const body = pasted
      ? { title: name, text: creating.text }
      : { title: name, ...(template.columns ? { columns: template.columns } : {}) };
    const route = pasted ? 'sheets/import' : 'sheets';
    try {
      const sheet = await api.post(`/api/cases/${caseId}/${route}`, body);
      creating = null;
      await list(caseId);
      openId = null;
      await open(sheet.id);
      if (template && (Object.keys(template.roles).length || template.progress)) {
        meta = templateMeta(meta, template);
        await save();
      }
    } catch (error) {
      toast(error.message || 'This sheet could not be created.', 'error');
    }
  }

  async function rename() {
    const name = title.trim();
    const current = sheets.find((sheet) => sheet.id === openId);
    if (!openId || !name || name === current?.title) return;
    try {
      await api.patch(`/api/cases/${caseId}/entities/${openId}`, { label: name });
      await list(caseId);
    } catch (error) {
      toast(error.message || 'This sheet could not be renamed.', 'error');
      title = current?.title ?? title;
    }
  }

  async function remove() {
    confirming = null;
    try {
      await api.del(`/api/cases/${caseId}/entities/${openId}`);
      close();
      await list(caseId);
    } catch (error) {
      toast(error.message || 'This sheet could not be deleted.', 'error');
    }
  }

  /**
   * Fork this sheet, sidecar and all.
   *
   * This app's answer to saved views has always been *another reading of these rows is
   * another sheet* — and there was no button behind it: forking meant exporting the CSV and
   * importing it back, which arrives stripped of every colour, role, note and link. So the
   * copy carries the whole sidecar, and what is being forked is the work rather than the
   * headings.
   */
  /**
   * A second sheet from this one: the whole thing, or only its shape.
   *
   * Both are the same write with one flag between them, and both answer the same question
   * — "another reading of these rows is another sheet", which is why this app has no named
   * views. `empty` is the one a binder is actually built out of: an inbox, a worklist and
   * a reference table at one schema, and the next floor up starts as this floor's columns
   * with nothing under them.
   */
  async function duplicateSheet({ empty = false } = {}) {
    picker = null;
    if (!openId) return;
    try {
      await flush();
      const made = await api.post(`/api/cases/${caseId}/sheets/${openId}/duplicate`, { empty });
      await list(caseId);
      openId = null;
      await open(made.id);
      await reloadCase();
      toast(
        empty
          ? `“${made.label ?? 'Sheet'}” created, with the columns and no rows.`
          : `“${made.label ?? 'Sheet'}” created, with the rows and everything the grid knows.`,
      );
    } catch (error) {
      toast(error.message || 'This sheet could not be copied.', 'error');
    }
  }

  /**
   * Add a batch of rows to the sheet that is already open.
   *
   * Import files a new sheet, which is right the first time and wrong every time after it:
   * the daily batch of links belongs in the worklist that already carries the statuses. The
   * mapping is the analyst's (`SheetAppend`), and the rows land as one undoable step through
   * the ordinary save — nothing here is a second write path.
   */
  function appendBatch(incoming, mapping) {
    if (!room({ rows: incoming?.rows?.length ?? 0 })) return;
    const grown = appendRows(table, incoming, mapping);
    appending = false;
    if (!grown.added) {
      toast('No column of that table matches this sheet.', 'error');
      return;
    }
    structural(() => {
      table = grown.table;
    });
    toast(`${grown.added} ${grown.added === 1 ? 'row' : 'rows'} added.`);
  }

  /**
   * Write the sheet out as a CSV the analyst hands to someone else.
   *
   * What travels is **what is on screen**: the columns drawn, in the order they are
   * drawn, and the rows the filter and the sort left. The case folder already holds
   * `sheets/<name>.csv`, so exporting the file would hand over a copy of something
   * they have; the reading is what they do not have. The toast says how much of the
   * sheet that was, because an export of twelve rows out of four hundred is worth
   * hearing before it is mailed.
   */
  async function download({ ticked = false } = {}) {
    if (!openId || exporting) return;
    exporting = true;
    exportOpen = false;
    // The ticked rows in the order they are drawn, so an export of a selection reads the
    // way the screen does rather than the way the file happens to hold it.
    const rows = ticked ? shown.filter((index) => batchIndices.includes(index)) : shown;
    try {
      await flush();
      const written = await exportCsv(caseId, openId, viewTable(table, drawn, rows));
      const all = rows.length === table.rows.length && drawn.length === table.columns.length;
      const how = all
        ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
        : `${rows.length} of ${table.rows.length} rows, ${drawn.length} of ${table.columns.length} columns`;
      // Where it landed **and a way to get there**, which is what every other export in the
      // app offers: a sentence naming a folder is a folder the analyst then goes looking
      // for, and a file nobody finds is a file exported twice.
      toast(`${how} written to ${destinationLabel(written.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => showExports(),
      });
    } catch (error) {
      toast(error.message || 'This sheet could not be exported.', 'error');
    } finally {
      exporting = false;
    }
  }

  /** Open the folder those CSVs go to. Same offer the note PDFs and the plates make. */
  async function showExports() {
    exportOpen = false;
    try {
      await revealSheetExports(caseId);
    } catch (error) {
      toast(error.message || 'That folder could not be opened.', 'error');
    }
  }

  /** Which folder the CSVs land in, read when the menu opens rather than on mount: it is a
   *  settings fetch, and a sheet that asked for it every time a case loaded would ask for
   *  nothing the analyst can see. */
  function readDestination() {
    if (destination !== null) return;
    readDestinations()
      .then((dirs) => {
        destination = dirs.sheets;
      })
      .catch(() => {
        destination = '';
      });
  }

  /** A dropped or picked file becomes a new sheet, named after itself. The text goes
   *  to the import route: the delimiter is guessed on the side that writes the file
   *  back, so a semicolon export and a tab export both land. */
  /**
   * A file the analyst picked, whatever format it is in.
   *
   * A CSV is read here and filed as one sheet through the naming dialog. A **workbook**
   * cannot be: it is a zip, it holds several tables, and reading it in the browser would
   * be a second parser for the one artifact this app promises any spreadsheet can open.
   * So it goes up whole and comes back as one sheet per tab, keeping the tabs' names —
   * which is how a binder arrives, and what asking the analyst to export six tabs by hand
   * was really asking.
   */
  function importFile(files) {
    const file = files?.[0];
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) return importWorkbook(file);
    const reader = new FileReader();
    reader.onload = () => {
      creating = { title: file.name.replace(/\.[^.]+$/, ''), text: String(reader.result ?? '') };
    };
    reader.readAsText(file);
  }

  async function importWorkbook(file) {
    if (!caseId || building) return;
    building = true;
    try {
      const body = new FormData();
      body.append('file', file);
      const made = await api.post(`/api/cases/${caseId}/sheets/import-xlsx`, body);
      await list(caseId);
      if (made.sheets?.length) {
        openId = null;
        await open(made.sheets[0].id);
      }
      await reloadCase();
      const count = made.sheets?.length ?? 0;
      // What did not land, named. Two tabs of a timeline binder hold nothing but pasted
      // screenshots, and two empty sheets nobody asked for would be worse than the sentence.
      const empty = made.empty?.length
        ? ` ${made.empty.length === 1 ? 'One tab holds' : `${made.empty.length} tabs hold`} no cells: ${made.empty.join(', ')}.`
        : '';
      // And what the three ceilings left out. A thirty thousand row export arriving as
      // twenty thousand under a toast reading "5 tabs filed" is a sheet that looks whole.
      const dropped = made.dropped?.length ? ` Not read: ${made.dropped.join(', ')}.` : '';
      const cut = (made.cut ?? [])
        .map((tab) => {
          const kept = [tab.rows && `${tab.rows} rows`, tab.columns && `${tab.columns} columns`]
            .filter(Boolean)
            .join(' and ');
          return ` ${tab.title} was cut to ${kept}.`;
        })
        .join('');
      toast(
        `${count} ${count === 1 ? 'tab' : 'tabs'} filed as ${count === 1 ? 'a sheet' : 'sheets'}.${empty}${dropped}${cut}`,
        dropped || cut ? 'warn' : 'info',
      );
    } catch (error) {
      toast(error.message || 'This workbook could not be read.', 'error');
    } finally {
      building = false;
    }
  }

  /**
   * A file dropped on the grid: a table, or a picture for the row it landed on.
   *
   * An image dropped on a row is the gesture a geolocation index is worked with — the frame
   * is on the desktop and the row is the lead — and it used to be read as an attempt to
   * import a CSV. Now it goes into the case's own `media/`, the cell cites the file by its
   * case-relative path so a collaborator opening the CSV can find it, and the cell points at
   * the media entity so the graph knows the row rests on it.
   */
  function onDrop(event) {
    event.preventDefault();
    dropping = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const cell = event.target?.closest?.('[data-row]');
      const row = Number(cell?.dataset?.row ?? -1);
      if (row >= 0) {
        bringIn(file, row, Number(cell.dataset.column));
        return;
      }
    }
    importFile(event.dataTransfer.files);
  }

  /** Which column a dropped picture belongs in: the one it was dropped on when anything may
   *  be written there, the sheet's picture column otherwise. A drop on the row's handle is
   *  still a drop on the row. */
  function pictureColumn(columnIndex) {
    if (Number.isInteger(columnIndex) && writable(table.columns[columnIndex])) return columnIndex;
    const declared = table.columns.findIndex((name) => roles[name]?.kind === 'picture');
    return declared;
  }

  async function bringIn(file, rowIndex, columnIndex) {
    const at = pictureColumn(columnIndex);
    if (at === -1) {
      toast('Declare a column a picture first, then drop the image on it.', 'error');
      return;
    }
    try {
      const body = new FormData();
      body.append('file', file);
      const made = await api.post(`/api/cases/${caseId}/media/upload`, body);
      const path = made.item?.path;
      if (!path) throw new Error('that file did not land in the case');
      const key = rowKey(table.columns, table.rows[rowIndex]);
      structural(() => {
        table = setCells(table, [{ row: rowIndex, column: at, value: path }]);
        // The link as well as the words: the CSV says where the file is and the graph says
        // which media the row rests on, which is what makes the row reachable from it.
        if (made.entity?.id) meta = setLink(meta, key, table.columns[at], made.entity.id);
      });
      await reloadCase();
      toast(made.duplicate ? 'Already in the case. The cell now cites it.' : 'Picture added to the case.');
    } catch (error) {
      toast(error.message || 'That picture could not be brought in.', 'error');
    }
  }

  // -- edits -----------------------------------------------------------------

  /** Open the editor on a cell. Refused on the key column and on the two the app
   *  writes: an editor over a value the next save overwrites is a box that lies. */
  function edit(row, column) {
    cursor = { row, column };
    anchor = { row, column };
    if (isKeyColumn(column) || appFilled(table.columns[column])) return;
    if (roles[table.columns[column]]?.kind === 'boolean') return flipCell(row, column);
    editing = { row, column, value: table.rows[row]?.[column] ?? '' };
  }

  function commitEdit(move = null) {
    if (!editing) return;
    const { row, column, value } = editing;
    editing = null;
    const before = table.rows[row]?.[column];
    if (before !== value) editCells([{ row, column, before, after: value }]);
    // `newrow` is Tab off the end of the sheet: the row is grown rather than the cursor
    // stopping dead, which is what typing a list into a grid actually feels like.
    if (move === 'newrow') appendRow();
    else if (move) step(move);
  }

  /** Whether the cursor is on the last cell of the last row on screen. What decides whether
   *  Tab steps across or grows the sheet. */
  function atLastCell() {
    const columns = drawn.map((column) => column.index);
    return (
      shown.indexOf(cursor.row) === shown.length - 1 &&
      columns.indexOf(cursor.column) === columns.length - 1
    );
  }

  /**
   * Move the cursor, in display order rather than file order.
   *
   * One function for the arrows, Tab, Home, End and the page keys, because they are one
   * gesture with different distances: a second walker would be a second answer to what
   * "the next row" means under a filter.
   */
  function step(direction, { extend = false } = {}) {
    const at = shown.indexOf(cursor.row);
    const columns = drawn.map((column) => column.index);
    const column = columns.indexOf(cursor.column);
    const page = Math.max(1, Math.floor((scroller?.clientHeight ?? viewport) / rowH) - 1);
    const rowAt = (index) => ({ ...cursor, row: shown[Math.max(0, Math.min(index, shown.length - 1))] });
    const columnAt = (index) => ({
      ...cursor,
      column: columns[Math.max(0, Math.min(index, columns.length - 1))],
    });
    let next = cursor;
    if (direction === 'down' && at < shown.length - 1) next = rowAt(at + 1);
    if (direction === 'up' && at > 0) next = rowAt(at - 1);
    if (direction === 'right' && column < columns.length - 1) next = columnAt(column + 1);
    if (direction === 'left' && column > 0) next = columnAt(column - 1);
    if (direction === 'pagedown') next = rowAt(at + page);
    if (direction === 'pageup') next = rowAt(at - page);
    if (direction === 'top') next = rowAt(0);
    if (direction === 'bottom') next = rowAt(shown.length - 1);
    if (direction === 'rowstart') next = columnAt(0);
    if (direction === 'rowend') next = columnAt(columns.length - 1);
    cursor = next;
    if (!extend) anchor = { ...next };
    scrollIntoView();
  }

  /**
   * Bring the cursor into view, in **both** directions.
   *
   * Only the vertical half existed, which on a fourteen-column binder meant walking right
   * with the arrow keys moved the cursor behind the frozen columns and off the edge: the
   * grid stayed where it was and the analyst was typing into a cell they could not see. The
   * sticky columns are subtracted from the left edge for the same reason — a cell scrolled
   * flush to the viewport's edge is a cell underneath the row's handle.
   */
  function scrollIntoView() {
    if (!scroller) return;
    const at = shown.indexOf(cursor.row);
    if (at !== -1) {
      const top = headRoom + at * rowH;
      if (top < scroller.scrollTop + headRoom) scroller.scrollTop = top - headRoom;
      else if (top + rowH > scroller.scrollTop + scroller.clientHeight)
        scroller.scrollTop = top + rowH - scroller.clientHeight;
    }
    const column = drawn.findIndex((entry) => entry.index === cursor.column);
    if (column === -1) return;
    // Where the column starts, walked rather than measured: the drawn widths are the only
    // truth about that and the DOM node may not exist yet on a column just scrolled to.
    let left = GUTTER_WIDTH;
    for (const entry of drawn.slice(0, column)) {
      left += meta.widths?.[entry.name] ?? DEFAULT_WIDTH;
    }
    const width = meta.widths?.[drawn[column].name] ?? DEFAULT_WIDTH;
    if (offsets[drawn[column].name] !== undefined) return; // it never leaves the screen
    if (left < scroller.scrollLeft + stickyWidth) scroller.scrollLeft = left - stickyWidth;
    else if (left + width > scroller.scrollLeft + scroller.clientWidth)
      scroller.scrollLeft = left + width - scroller.clientWidth;
    measure();
  }

  /** Whether a pointer landed on something inside a cell that has its own job — a chip,
   *  the entity mark, the `@`. Those are not places to start a selection from. */
  function onOwnControl(target) {
    return Boolean(target?.closest?.('button, a, textarea, input'));
  }

  /**
   * Press a cell: place the cursor, and start a drag that extends the selection.
   *
   * Pointer rather than click, because a spreadsheet's selection is a drag: press a cell,
   * pull across the ones wanted, release. Shift keeps the anchor where it was, so
   * shift-clicking a far corner still selects the rectangle between them.
   */
  function startCellDrag(event, row, column) {
    if (onOwnControl(event.target)) return;
    cursor = { row, column };
    if (!event.shiftKey || !anchor) anchor = { row, column };
    selecting = true;
    const stop = () => {
      selecting = false;
      document.removeEventListener('pointerup', stop);
    };
    document.addEventListener('pointerup', stop);
  }

  /** Pull the selection over a cell the pointer is passing across, while held. */
  function overCell(row, column) {
    if (selecting) cursor = { row, column };
  }

  /** Whether the keystroke belongs to a box the analyst is typing in.
   *
   *  Without this the search field was unusable: every letter typed into it also
   *  reached the grid and started editing whatever cell the cursor sat on. The cell
   *  editor is deliberately not excluded — it is a textarea, and its own branch in
   *  `onKey` is what gives Enter, Tab and Escape their meaning there. */
  function inAField(target) {
    if (!target || target.isContentEditable) return false;
    const tag = target.tagName;
    return (tag === 'INPUT' || tag === 'TEXTAREA') && !target.classList.contains('editor');
  }

  /** Everything the grid can have open over it, closed. One list, so a new popover
   *  is dismissable the day it is added rather than the day someone notices. */
  function closePopovers() {
    picker = null;
    newOpen = false;
    columnsOpen = false;
    filterAt = null;
    cellMenu = null;
    headMenu = null;
    rowMenu = null;
    exportOpen = false;
    legendOpen = false;
    renaming = null;
    filling = null;
    fillValue = '';
    rowPanel = null;
    columnPanel = null;
  }

  const somethingOpen = $derived(
    Boolean(picker) ||
      newOpen ||
      columnsOpen ||
      filterAt !== null ||
      cellMenu !== null ||
      headMenu !== null ||
      rowMenu !== null ||
      exportOpen ||
      legendOpen ||
      renaming !== null ||
      Boolean(filling) ||
      rowPanel !== null ||
      columnPanel !== null,
  );

  // A pointer outside a popover closes it. The bound element wraps the trigger too,
  // so clicking the trigger stays a plain toggle.
  $effect(() => (picker ? closeOnOutsidePointer(pickerAnchor, () => (picker = null)) : undefined));
  $effect(() => (newOpen ? closeOnOutsidePointer(newAnchor, () => (newOpen = false)) : undefined));
  $effect(() =>
    columnsOpen ? closeOnOutsidePointer(columnsAnchor, () => (columnsOpen = false)) : undefined,
  );
  // Two elements for these two, because the menu is drawn away from the control that
  // opens it: without the trigger in the list, its own click would close and reopen.
  $effect(() =>
    filterAt
      ? closeOnOutsidePointer([filterMenu, funnels[table.columns[filterAt.index]]], () => (filterAt = null))
      : undefined,
  );
  $effect(() =>
    cellMenu ? closeOnOutsidePointer(cellMenuEl, () => (cellMenu = null)) : undefined,
  );
  $effect(() =>
    headMenu ? closeOnOutsidePointer(headMenuEl, () => (headMenu = null)) : undefined,
  );
  $effect(() => (rowMenu ? closeOnOutsidePointer(rowMenuEl, () => (rowMenu = null)) : undefined));
  $effect(() =>
    exportOpen ? closeOnOutsidePointer(exportAnchor, () => (exportOpen = false)) : undefined,
  );
  $effect(() =>
    legendOpen ? closeOnOutsidePointer(legendAnchor, () => (legendOpen = false)) : undefined,
  );

  /**
   * Whether this grid is the tool on screen.
   *
   * Tools stay mounted once visited and are hidden with CSS, so every handler on `window`
   * goes on firing behind whatever is in front. For most tools that is harmless; here it was
   * data loss: with a cell cursor left somewhere, `Delete` pressed while the map was on
   * screen emptied those cells and autosaved the CSV, a letter opened an editor nobody could
   * see, and `Ctrl+C` quietly replaced the clipboard with a rectangle from a sheet.
   */
  function mine() {
    return uiState.tool === 'sheet';
  }

  function onKey(event) {
    if (!mine()) return;
    if (creating || confirming || detailsId || linking || discarding || promoteOpen) return;
    if (cleaning || fromCase || appending || geocoding || buildOpen) return;
    if (helpOpen || destPicker) return;
    // Escape backs out of whatever is over the grid, before the grid's own keys get
    // a look: a menu left open by a stray click is the most common way to be stuck.
    if (event.key === 'Escape' && !editing && somethingOpen) {
      event.preventDefault();
      closePopovers();
      return;
    }
    const meta_ = event.ctrlKey || event.metaKey;
    // The search is reachable from the grid, and only from the grid: pressing it
    // inside a field would fight whatever that field does with the same keys.
    if (meta_ && event.key.toLowerCase() === 'f' && !inAField(event.target)) {
      event.preventDefault();
      searchBox?.focus();
      searchBox?.select();
      return;
    }
    if (inAField(event.target)) return;
    // The list of gestures, on the key every reader tries. Not behind a modifier: it is a
    // question, and a question mark is how one is asked.
    if (event.key === '?' && !editing) {
      event.preventDefault();
      helpOpen = true;
      return;
    }
    if (meta_ && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
      return;
    }
    if (meta_ && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (meta_ && event.key === 'Enter') {
      event.preventDefault();
      appendRow();
      return;
    }
    if (editing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        editing = null;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitEdit('down');
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        // On the last cell of the last row, Tab is how a grid grows: the alternative is
        // reaching for the mouse at the end of every line typed.
        if (!event.shiftKey && atLastCell()) commitEdit('newrow');
        else commitEdit(event.shiftKey ? 'left' : 'right');
      }
      // Reaching here means the editor is open and the textarea has **not** taken the
      // focus yet: a field that has it exits this handler further up. Svelte mounts on
      // the next tick, and a fast typist is inside that window — so the cell opened on
      // `m` and swallowed the `ine` that followed. The characters are kept here and the
      // editor mounts holding them.
      if (event.key.length === 1 && !meta_) {
        event.preventDefault();
        editing = { ...editing, value: editing.value + event.key };
      }
      return;
    }
    // Every row on screen, ticked. The one selection gesture the grid was missing, and the
    // header's own box is three hundred pixels away from the keyboard.
    if (meta_ && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      picked = new Set(shownKeys(table, shown));
      lastTicked = null;
      return;
    }
    // Escape with nothing open drops the selection, cursor and all: a rectangle left
    // behind is what makes the next Delete act on more than the analyst has in mind.
    if (event.key === 'Escape' && (picked.size || hasRange || cursor.row !== -1)) {
      event.preventDefault();
      dropSelection();
      return;
    }
    if (cursor.row === -1) return;
    if (meta_ && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      fillDown();
      return;
    }
    const moves = { ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right', ArrowLeft: 'left' };
    if (moves[event.key]) {
      event.preventDefault();
      step(moves[event.key], { extend: event.shiftKey });
      return;
    }
    // The keys that cross a long sheet. Ctrl takes the whole column rather than a screen,
    // which is what it does in every grid.
    const jumps = {
      PageDown: 'pagedown',
      PageUp: 'pageup',
      Home: meta_ ? 'top' : 'rowstart',
      End: meta_ ? 'bottom' : 'rowend',
    };
    if (jumps[event.key]) {
      event.preventDefault();
      step(jumps[event.key], { extend: event.shiftKey });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      edit(cursor.row, cursor.column);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (!event.shiftKey && atLastCell()) appendRow();
      else step(event.shiftKey ? 'left' : 'right');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      clearSelection();
      return;
    }
    // Typing a printable character starts an edit on that character, the way a
    // grid is expected to behave.
    if (
      event.key.length === 1 &&
      !meta_ &&
      !isKeyColumn(cursor.column) &&
      !appFilled(table.columns[cursor.column])
    ) {
      event.preventDefault();
      editing = { row: cursor.row, column: cursor.column, value: event.key };
    }
  }

  /** Every part of a selection let go at once: the ticks, the dragged rectangle and the
   *  cursor itself. On Escape, and on the bar's own button, since anything left behind is
   *  what makes the next Delete act on more than the analyst has in mind. */
  function dropSelection() {
    picked = new Set();
    lastTicked = null;
    cursor = { row: -1, column: -1 };
    anchor = null;
  }

  function isKeyColumn(index) {
    return String(table.columns[index] ?? '').toLowerCase() === ID_COLUMN;
  }

  /** A cell as chips, or null when the column is not a set of values. Returned rather
   *  than a flag so the template asks once and draws from the answer. */
  function chipsFor(rowIndex, column) {
    const role = roles[column.name];
    if (!isChipped(role)) return null;
    const read = cellChips(table.rows[rowIndex][column.index], role);
    if (!read.length) return null;
    // A `row` column has no vocabulary: what makes one of its names *known* is that it
    // reaches exactly one other row. Read from the words, so a name somebody renamed a row
    // out from under is marked here rather than sitting in the cell looking answered.
    if (role.kind !== 'row') return read;
    const reached = rowPointers.find((entry) => entry.index === column.index);
    const missing = new Set(
      reached?.targets.get(rowKey(table.columns, table.rows[rowIndex]))?.missing ?? [],
    );
    return read.map((chip) => ({ ...chip, known: !missing.has(chip.value) }));
  }

  /**
   * Press a chip in a cell.
   *
   * A yes/no column **flips**: two words is a toggle, and the tooltip said as much while
   * the only way to do it was a double-click or Enter. Everything else **filters** on the
   * value pressed — on the value and not on the cell's text, so `2x S-125` asks for
   * `S-125` and finds the rows holding three of them too.
   */
  function onChipClick(rowIndex, column, chip) {
    if (roles[column.name]?.kind === 'boolean') {
      flipCell(rowIndex, column.index);
      return;
    }
    toggleValue(column.name, chip.value);
  }

  /**
   * A yes/no column answers a click rather than opening an editor: two words is not a
   * menu, it is a toggle, and making the analyst pick from a list of two is a click too
   * many on the column they will touch most.
   *
   * A column drawn as **tick boxes** cycles through three rather than flipping between
   * two, because its box is drawn on an empty cell as well as a filled one: without
   * the third state, *not answered yet* and *no* would look the same and there would
   * be no way back. One function, so the box, the chip and Enter all agree.
   */
  function flipCell(rowIndex, columnIndex) {
    const role = roles[table.columns[columnIndex]];
    const before = table.rows[rowIndex][columnIndex];
    const after = role?.tick ? cycleTick(role, before) : flipBoolean(role, before);
    editCells([{ row: rowIndex, column: columnIndex, before, after }]);
  }

  /** Whether this column draws its cells as boxes. Asked once here so the grid's own
   *  branch and the cell's click read the same answer. */
  function ticked(column) {
    const role = roles[column.name];
    return role?.kind === 'boolean' && Boolean(role.tick);
  }

  /**
   * What each number column adds up to over the rows on screen.
   *
   * On screen, not in the sheet: filtering to the twelve rows left to check and then being
   * told the total of all four hundred answers a question nobody asked. This is the one
   * reading in the footer that follows the filter, and it follows it for that reason.
   */
  const numberFooters = $derived(
    drawn
      .filter((column) => roles[column.name]?.kind === 'number')
      .map((column) => ({
        name: column.name,
        summary: roles[column.name].summary ?? 'sum',
        unit: roles[column.name].unit ?? '',
        ...numberTotals(table, column.index, shown),
      }))
      .filter((entry) => entry.summary !== 'none' && (entry.count || entry.unreadable)),
  );

  /** How each role reads in a heading: one glyph and one word. The word is the same one
   *  the role editor offers, so the heading and the panel cannot say two things. */
  const ROLE_MARKS = {
    state: { icon: 'chart', label: 'State' },
    choice: { icon: 'stack', label: 'Values' },
    boolean: { icon: 'check', label: 'Yes / no' },
    number: { icon: 'hash', label: 'Number' },
    latlon: { icon: 'pin', label: 'Point' },
    when: { icon: 'clock', label: 'Date or time' },
    picture: { icon: 'image', label: 'Picture' },
    url: { icon: 'external', label: 'Source' },
    row: { icon: 'link', label: 'Another row' },
    offset: { icon: 'clock', label: 'Offset' },
    stamped: { icon: 'save', label: 'Added on' },
    computed: { icon: 'globe', label: 'On map' },
  };

  /** And what a computed column's heading says, now that there are three of them: a column
   *  answering "how complete" is not on a map, and one glyph for all three would be a
   *  heading that lies about two of them. */
  const NATURE_MARKS = {
    has_point: { icon: 'globe', label: 'On map' },
    filled_of: { icon: 'chart', label: 'How complete' },
    yes_of: { icon: 'check', label: 'Score' },
    point: { icon: 'pin', label: 'Its point' },
    relations: { icon: 'graph', label: 'What it is joined to' },
  };

  /** The mark a column's heading draws, or nothing. One place, so the heading, the columns
   *  list and the tooltip agree. */
  function roleMark(name) {
    const role = roles[name];
    if (!role) return null;
    if (role.kind === 'computed') return NATURE_MARKS[role.of ?? 'has_point'] ?? NATURE_MARKS.has_point;
    return ROLE_MARKS[role.kind] ?? null;
  }

  /** Whether this cell is one its column's own type cannot read. Marked in the grid
   *  rather than refused, and the mark is the whole point: a permissive column that says
   *  nothing about the cells it skipped is a column whose total nobody can check. Only
   *  where nothing else already says it — a value outside a vocabulary is drawn as a
   *  dashed chip, which says it better than a badge would. */
  function unreadable(rowIndex, column) {
    const role = roles[column.name];
    if (!role || isChipped(role) || appFilled(column.name)) {
      return false;
    }
    return !readsCell(role, table.rows[rowIndex][column.index]);
  }

  /** The unit to write after this cell, or nothing. Only where the column asked for it
   *  in the cells, and never after an empty one: a blank means unknown, and `%` on its
   *  own would be a reading of a cell nobody has filled. */
  function unitOf(rowIndex, column) {
    const role = roles[column.name];
    if (role?.kind !== 'number' || !role.unit || !role.unitInCells) return '';
    return String(table.rows[rowIndex][column.index] ?? '').trim() ? role.unit : '';
  }

  /** A number written the way its column writes them. The unit is the whole of the
   *  formatting: a percentage and a currency differ by what follows the digits. */
  function spellNumber(value, unit) {
    if (value === null || value === undefined) return '—';
    return unit ? `${value} ${unit}` : `${value}`;
  }

  /**
   * Whether pointing this cell at an entity means anything.
   *
   * The `@` used to be drawn on every cell of every column, which read as an offer to point
   * a *status* at a person: a yes/no cell, a date, a number and a vocabulary value are not
   * things the case holds an entity for. So it is offered where a cell can plausibly name
   * something — text, and a point, which names a place — and on any cell that already
   * carries a link, because a link that cannot be seen or cleared is worse than one offered
   * where it is not wanted.
   */
  function linkable(name) {
    const kind = roles[name]?.kind;
    // `locked` is here and no other written role is: its whole purpose is a cell that
    // opens the entity the app filled it from. A stamped date and a computed count point
    // at nothing, so offering the `@` on them would offer a link to nowhere.
    return !kind || kind === 'latlon' || kind === 'picture' || kind === 'locked';
  }

  /** Whether the app writes this column rather than the analyst. None of the three is
   *  typed into: the editor would be a box whose value is overwritten on the next save,
   *  or on the next refresh for a column the case owns. */
  function appFilled(name) {
    const kind = roles[name]?.kind;
    return kind === 'stamped' || kind === 'computed' || kind === 'locked';
  }

  /** Whether an edit may land in this column at all. The row's handle is the case's,
   *  and the two roles the app fills are rewritten on every save — a bulk fill into
   *  either writes a value that is gone before it is read. */
  function writable(name) {
    return String(name ?? '').toLowerCase() !== ID_COLUMN && !appFilled(name);
  }

  const fillable = $derived(table.columns.filter(writable));

  // -- the cell bar ----------------------------------------------------------

  /**
   * The cell under the cursor, written in a box wide enough to read it.
   *
   * A grid cell is thirty pixels tall and as wide as its column, and the sentences an
   * analyst writes into `Title` are neither. The bar is the same cell, at the top, with
   * the whole value in one place: what a spreadsheet's formula bar is for.
   *
   * The draft carries **the cell it belongs to**, not just the text. The box loses the
   * focus by the analyst clicking another cell, and the grid has already moved the cursor
   * there by the time the blur lands — a draft that only knew its text would be committed
   * into whichever cell was clicked next.
   */
  let barDraft = $state(null); // { row, column, value }
  const barColumn = $derived(cursor.row === -1 ? null : (table.columns[cursor.column] ?? null));
  /** What the bar shows when nothing is being typed in it. The open cell editor wins:
   *  two boxes on one cell that disagree is the worse of the two bugs. */
  const barCell = $derived.by(() => {
    if (cursor.row === -1) return '';
    if (editing && editing.row === cursor.row && editing.column === cursor.column) {
      return editing.value;
    }
    return table.rows[cursor.row]?.[cursor.column] ?? '';
  });
  const barValue = $derived(
    barDraft?.row === cursor.row && barDraft?.column === cursor.column ? barDraft.value : barCell,
  );
  const barWritable = $derived(Boolean(barColumn) && writable(barColumn));
  /** Why the box refuses, when it does. The two reasons are different ones: the key is the
   *  case's handle on the row, and the stamped columns are rewritten on every save. */
  const barLocked = $derived.by(() => {
    if (!barColumn || barWritable) return '';
    return String(barColumn).toLowerCase() === ID_COLUMN
      ? 'The row’s handle'
      : 'Written by the app on every save';
  });

  /** Taking over from the cell's own editor. Closed rather than left open behind the
   *  bar, so the value being typed is only ever in one box. */
  function barFocus() {
    if (editing) commitEdit();
  }

  function commitBar({ down = false } = {}) {
    const draft = barDraft;
    barDraft = null;
    if (!draft || !writable(table.columns[draft.column])) return;
    const before = table.rows[draft.row]?.[draft.column];
    if (before !== draft.value) {
      editCells([{ row: draft.row, column: draft.column, before, after: draft.value }]);
    }
    if (down) step('down');
  }

  function onBarKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commitBar({ down: true });
      scroller?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      barDraft = null;
      scroller?.focus();
    }
  }

  // -- the clipboard ---------------------------------------------------------

  /** Copy the selected rectangle as a block a spreadsheet will read back.
   *
   *  A rectangle of empty cells is copied too, as empty. Bailing there left the
   *  keystroke to the browser, which has nothing to take from a grid that is not
   *  selectable text — so Ctrl+C looked like it worked and the next Ctrl+V pasted
   *  whatever had been on the clipboard before. */
  function onCopy(event) {
    if (!mine() || !openId || inAField(event.target) || editing || cursor.row === -1) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', toBlock(rangeValues(table, range)));
  }

  /**
   * Paste a block into the sheet, from the cursor.
   *
   * A wall of links with no tabs is the "to be sorted" inbox every field binder
   * keeps, so it becomes one row per link rather than one cell holding forty. Any
   * other block is a table, and lands as a rectangle from where the cursor is.
   */
  function onPaste(event) {
    if (!mine() || !openId || inAField(event.target) || editing) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;
    event.preventDefault();
    const block = looksLikeLinks(text) ? linkRows(text) : parseBlock(text);
    if (!block.length) return;
    const at = {
      row: cursor.row === -1 ? (shown[0] ?? 0) : cursor.row,
      column: cursor.column === -1 ? firstWritableColumn() : cursor.column,
    };
    // The rows and the columns as they are drawn, because that is what was copied: a
    // rectangle read off a filtered or re-sorted screen has to land on the rows the
    // analyst is looking at, not on whatever sits at those places in the file.
    const view = { rows: shown, columns: drawn.map((column) => column.index) };
    // What the block would add past the last row on screen, which is the only way a
    // paste grows the sheet: it never adds a column, it clips to the ones there are.
    const from = view.rows.indexOf(at.row);
    const wouldAdd =
      from === -1
        ? Math.max(0, at.row + block.length - table.rows.length)
        : Math.max(0, from + block.length - view.rows.length);
    if (!room({ rows: wouldAdd })) return;
    let landed = null;
    structural(() => {
      landed = pasteBlock(table, block, at, view);
      table = landed.table;
    });
    if (landed?.clipped) {
      toast(`${landed.clipped} pasted ${landed.clipped === 1 ? 'column' : 'columns'} did not fit.`);
    }
  }

  /** Where a paste goes when no cell has been clicked yet: the first column that is
   *  not the row's handle, because the handle is never written. */
  function firstWritableColumn() {
    return drawn.find((column) => String(column.name).toLowerCase() !== ID_COLUMN)?.index ?? 0;
  }

  /** Which column a bulk fill offers first: the first one an edit may land in, so the
   *  bar never opens on a column that would refuse or overwrite what is written. */
  function firstFillable() {
    return fillable[0] ?? '';
  }

  // -- filling ---------------------------------------------------------------

  /** The selected rectangle with the columns nothing may write taken out, so a sweep
   *  over a selection that happens to include `Added on` leaves it alone. */
  const writableRange = $derived({
    rows: range.rows,
    columns: range.columns.filter((index) => writable(table.columns[index])),
  });

  /** Empty every selected cell. One step in the undo stack, not one per cell. */
  function clearSelection() {
    editCells(
      writableRange.columns.flatMap((column) => fillEdits(table, column, range.rows, '')),
    );
  }

  function fillDown() {
    editCells(fillDownEdits(table, writableRange));
  }

  /** Write one answer into one column for every row in the batch. The worklist gesture:
   *  forty rows checked in one pass, then all forty marked at once. */
  function applyFill() {
    const columnIndex = table.columns.indexOf(filling?.column);
    if (columnIndex !== -1 && writable(filling.column)) {
      editCells(fillEdits(table, columnIndex, batchIndices, fillValue));
    }
    filling = null;
    fillValue = '';
  }

  /** What one set of promotion answers would do to the case, without doing it. Asked of
   *  the server rather than worked out here: the plan the analyst confirms and the plan
   *  the promotion executes have to be the same one. */
  /**
   * The three other roads out of a sheet, each planned before it is done.
   *
   * Same shape as the row promotion because it is the same promise: the analyst reads what
   * would happen, presses, and the server executes exactly that plan. What differs is the
   * grain — words for a column, statements for a column of hours, edges for a column of
   * row names — and the answer each one gives back.
   */
  /** The moments this sheet times rows against. Sidecar only, so it goes through the
   *  meta-only save like every other thing the grid remembers. */
  /** What this sheet is for, in the sidecar. Two lines, so it is written where it is
   *  read rather than in a dialog of its own. */
  function commitDescription() {
    if (!describing) return;
    describing = false;
    const text = describeText.trim().slice(0, MAX_DESCRIPTION);
    if (text === (meta.description ?? '')) return;
    structural(
      () => {
        meta = { ...meta, description: text };
      },
      { withTable: false },
    );
  }

  function setAnchors(anchors) {
    structural(
      () => {
        meta = { ...meta, anchors };
      },
      { withTable: false },
    );
  }

  /**
   * A case file the row carries, and the ones it already does.
   *
   * A reference and not a copy: the entity is already the case's, so nothing new is filed
   * and no artifact is owned twice. What it buys is the thing the binders kept two whole
   * tabs of pasted screenshots for — the proof of the hour, attached to the row it is the
   * proof of instead of floating beside it.
   */
  const carried = $derived(meta.attachments ?? {});
  const rowPieces = $derived(
    rowPanel === null
      ? []
      : (carried[rowKey(table.columns, table.rows[rowPanel] ?? [])] ?? []).map((id) => ({
          id,
          label: pieces[id]?.label ?? '',
          type: pieces[id]?.type ?? '',
        })),
  );

  function setAttachments(key, ids) {
    const next = { ...carried };
    if (ids.length) next[key] = ids;
    else delete next[key];
    structural(
      () => {
        meta = { ...meta, attachments: next };
      },
      { withTable: false },
    );
  }

  /** The picker hands back the **entity**, not its id: the sidecar stores ids only, and a
   *  whole object put there is dropped by the writer without a word — which is exactly how
   *  this read as "attaching does nothing". Its name is kept beside the read's own answer
   *  so the panel can say it before the next reload. */
  function attachPiece(key, entity) {
    attaching = null;
    const entityId = entity?.id;
    if (!entityId) return;
    pieces = { ...pieces, [entityId]: { label: entity.label ?? '', type: entity.type ?? '' } };
    const held = carried[key] ?? [];
    if (held.includes(entityId)) return;
    setAttachments(key, [...held, entityId]);
  }

  function detachPiece(key, entityId) {
    setAttachments(key, (carried[key] ?? []).filter((id) => id !== entityId));
  }

  /**
   * What the library already downloaded from this row's links.
   *
   * The two halves of one page: the analyst has the video and the row pointing at its post
   * could not say so. Matched on the **source URL the download recorded**, never on a
   * title resembling a filename — the same rule the whole bridge runs on.
   */
  async function findRowMedia(key) {
    const index = table.rows.findIndex((row) => rowKey(table.columns, row) === key);
    if (index === -1) return;
    const urls = table.rows[index].flatMap((cell) => urlsIn(cell));
    if (!urls.length) return;
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/${openId}/media`, { urls });
      const found = Object.values(answer.media ?? {});
      if (!found.length) {
        toast('Nothing in the library came from these links.');
        return;
      }
      pieces = {
        ...pieces,
        ...Object.fromEntries(
          found.map((entry) => [entry.id, { label: entry.label, type: entry.type }]),
        ),
      };
      const held = carried[key] ?? [];
      setAttachments(key, [
        ...held,
        ...found.map((entry) => entry.id).filter((id) => !held.includes(id)),
      ]);
      toast(`${found.length} ${found.length === 1 ? 'file' : 'files'} attached to this row.`);
    } catch (error) {
      toast(error.message || 'The library could not be searched.', 'error');
    }
  }

  /**
   * Which rows a `row` column reaches, and the other direction of it.
   *
   * Derived from the words on every read rather than stored, which is exactly what the
   * binders could not do: theirs was a spreadsheet validation, it could not survive a row
   * moving, and in the real file it had already decayed to `#REF!`. Here the same decay is
   * a count of names that reach nothing.
   */
  const rowColumns = $derived(
    table.columns
      .map((name, index) => ({ name, index, role: roles[name] }))
      .filter((entry) => entry.role?.kind === 'row'),
  );
  const rowPointers = $derived(
    rowColumns.map((entry) => ({
      ...entry,
      targets: rowTargets(table, entry.index, entry.role),
    })),
  );
  /** Who points at each row, across **every** row column: a registry may name its parent
   *  in one and its neighbours in another, and reading only the first would answer half. */
  const pointedAt = $derived.by(() => {
    const merged = new Map();
    for (const entry of rowPointers) {
      for (const [key, from] of backLinks(entry.targets)) {
        const held = merged.get(key) ?? [];
        merged.set(key, [...held, ...from.filter((one) => !held.includes(one))]);
      }
    }
    return merged;
  });
  const rowPointedBy = $derived(
    rowPanel === null || !rowPointers.length
      ? []
      : (pointedAt.get(rowKey(table.columns, table.rows[rowPanel] ?? [])) ?? []).map((key) =>
          rowLabel(table, key, rowPointers[0].role),
        ),
  );

  /**
   * Move the chosen rows into another sheet, each column landing where the dialog said.
   *
   * Both sheets are written by one call, so there is no window in which a row is in both
   * or in neither. What was dropped is said twice — once on the second screen before the
   * press, once here — because a silent loss reads as a clean move.
   */
  async function moveRows(to, keys, mapping) {
    if (!openId || promoting) return;
    promoting = true;
    clearTimeout(saveTimer);
    await inFlight;
    // The table as it stands, kept before the write: it *is* the undo, since a move drops
    // the columns the destination does not have and replaying it backwards would hand the
    // rows back with holes in them. Safe to hold by reference — every pass over the grid
    // builds a new table rather than editing this one.
    const before = { columns: table.columns, rows: table.rows, meta };
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/${openId}/move`, {
        columns: table.columns,
        rows: table.rows,
        meta,
        stamp,
        to,
        keys,
        mapping,
      });
      adopt({ ...answer, title });
      moving = false;
      picked = new Set();
      await list(caseId);
      const lost = answer.dropped?.length
        ? ` ${answer.dropped.join(', ')} ${answer.dropped.length === 1 ? 'is' : 'are'} not in that sheet, so ${answer.dropped.length === 1 ? 'it was' : 'they were'} dropped.`
        : '';
      // The one write in this tool the grid's own undo cannot reach, and it is two files.
      toast(`${answer.moved} moved to “${answer.to.title}”.${lost}`, 'ok', 9000, {
        label: 'Undo',
        onClick: () => undoMove(before, to, answer.landed ?? [], keys),
      });
      await reloadCase();
    } catch (error) {
      if (error?.status === 409) conflict = true;
      else toast(error.message || 'Those rows could not be moved.', 'error');
    } finally {
      promoting = false;
    }
  }

  /**
   * Put a move back: this sheet as it stood, and the rows it sent taken out over there.
   *
   * The stamp presented is the current one rather than the one the snapshot was read at:
   * the move itself moved the file on, and what has to be refused is an undo pressed after
   * the analyst has typed into the sheet since.
   */
  async function undoMove(before, to, landed, mine) {
    if (!openId || promoting || !landed.length) return;
    promoting = true;
    clearTimeout(saveTimer);
    await inFlight;
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/${openId}/move/undo`, {
        columns: before.columns,
        rows: before.rows,
        meta: before.meta,
        stamp,
        to,
        keys: landed,
      });
      adopt({ ...answer, title });
      // Ticked again, because the rows are back and the analyst was in the middle of
      // choosing where to send them. Their own keys, not the ones they landed under: a
      // key already taken over there was minted fresh, and this sheet never saw that one.
      picked = new Set(mine);
      await list(caseId);
      toast(`${answer.undone} put back.`, 'ok');
      await reloadCase();
    } catch (error) {
      if (error?.status === 409) conflict = true;
      else toast(error.message || 'That move could not be put back.', 'error');
    } finally {
      promoting = false;
    }
  }

  function previewPass(declaration) {
    return api.post(`/api/cases/${caseId}/sheets/${openId}/promote/preview`, {
      columns: table.columns,
      rows: table.rows,
      meta,
      keys: batchKeys,
      ...declaration,
    });
  }

  /**
   * Send the ticked rows to the case: every column's mode, and the edges between them.
   *
   * One request, which is also a save: the analyst sends what is on screen, edits and all,
   * and the links the pass earns are what makes a second press an update rather than a
   * twin — so they have to land in the same write. The reply is the sheet, adopted as any
   * save's is, plus what happened to the case.
   */
  async function sendToCase(declaration) {
    if (!openId || promoting) return;
    promoting = true;
    clearTimeout(saveTimer);
    // A write in the air holds the stamp this pass has to present. Going past it presents
    // the one it replaced, and the case answers a conflict nobody caused.
    await inFlight;
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/${openId}/promote`, {
        columns: table.columns,
        rows: table.rows,
        meta,
        stamp,
        keys: batchKeys,
        ...declaration,
      });
      adopt({ ...answer, title });
      promoteOpen = false;
      toast(said(answer));
      await reloadCase();
    } catch (error) {
      if (error?.status === 409) conflict = true;
      else toast(error.message || 'These rows could not be sent to the case.', 'error');
    } finally {
      promoting = false;
    }
  }

  /** Whether this sheet can feed a build at all: two columns of addresses and one of
   *  coordinates, which is what a geolocation index is. Offered on nothing else, because a
   *  button that answers "this sheet cannot do that" should not have been there. */
  const buildable = $derived(canBuild(columnKinds(table, meta)));

  /** Whether this sheet was built out of the case's proofs, and can therefore be brought
   *  back level with them. Read off the sidecar rather than off the column names: a sheet
   *  whose headings happen to spell `Title` is not this shape, and `built` is the record
   *  only the build writes. */
  const refreshable = $derived(Object.keys(meta.built ?? {}).length > 0);
  let refreshing = $state(false);

  /**
   * Bring a proofs sheet level with the case, on a press.
   *
   * Never on open. A sheet that rewrites itself when it is looked at is a sheet whose file
   * moves under an analyst who only wanted to read it, and it would fight the stamp — which
   * exists precisely so two readers of one file cannot silently overwrite each other.
   *
   * Nothing is ever removed here. A proof deleted since the build keeps its row and says NO
   * in its `In case` column: the notes on that row are the analyst's, and throwing them away
   * to tidy the table is not a decision this button gets to make.
   */
  async function refreshFromCase() {
    if (refreshing || !openId) return;
    refreshing = true;
    try {
      const answer = await api.post(`/api/cases/${caseId}/sheets/${openId}/refresh`, {
        columns: table.columns,
        rows: table.rows,
        meta,
        stamp,
      });
      adopt({ ...answer, title });
      await reloadCase();
      const said = [
        answer.added ? `${answer.added} row${answer.added === 1 ? '' : 's'} added` : '',
        answer.gone ? `${answer.gone} proof${answer.gone === 1 ? '' : 's'} no longer in the case` : '',
      ].filter(Boolean);
      toast(said.length ? `${said.join(', ')}.` : 'Already level with the case.');
    } catch (error) {
      toast(error.message || 'This sheet could not be refreshed.', 'error');
    } finally {
      refreshing = false;
    }
  }

  function previewBuild(declaration) {
    return api.post(`/api/cases/${caseId}/sheets/${openId}/proofs/preview`, {
      columns: table.columns,
      rows: table.rows,
      keys: batchKeys,
      ...declaration,
    });
  }

  /**
   * Build the ticked rows, and watch it happen.
   *
   * A job rather than a request, and the only sheet road that is one: a hundred downloads
   * take minutes, and what an analyst watches for those minutes is the row count moving.
   * Nothing is written to the sheet while it runs — the file is this tab's to save, and a
   * job holding a stamp for two minutes would fight every autosave in the window.
   */
  async function startBuild(declaration) {
    if (!openId || buildJob) return;
    buildReport = null;
    try {
      const { job_id } = await api.post(`/api/cases/${caseId}/sheets/${openId}/proofs`, {
        columns: table.columns,
        rows: table.rows,
        keys: batchKeys,
        ...declaration,
      });
      buildJob = { id: job_id, progress: {} };
      await watchBuild(job_id);
    } catch (error) {
      buildJob = null;
      toast(error.message || 'That build could not be started.', 'error');
    }
  }

  async function watchBuild(jobId) {
    for (;;) {
      const status = await api.get(`/api/jobs/${jobId}`);
      if (status.status === 'running') {
        buildJob = { id: jobId, progress: status.progress ?? {} };
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      buildJob = null;
      if (status.status !== 'done') {
        toast(status.error || 'That build stopped.', 'error');
        return;
      }
      buildReport = status.result ?? null;
      built(buildReport);
      return;
    }
  }

  async function stopBuild() {
    if (!buildJob) return;
    await api.post(`/api/jobs/${buildJob.id}/cancel`, {});
  }

  /**
   * What a finished build leaves on the sheet: a chip per cell, and a line in the log.
   *
   * The sidecar is written here rather than by the job, because the file is this tab's to
   * save. Losing it costs the chips and never a duplicate — a second press finds the proof
   * by the name it was saved under, so the case is what remembers.
   */
  function built(report) {
    if (!report) return;
    const links = report.links ?? {};
    if (Object.keys(links).length) {
      structural(
        () => {
          let next = meta;
          for (const [key, cells] of Object.entries(links)) {
            for (const [column, entityId] of Object.entries(cells)) {
              next = setLink(next, key, column, entityId);
            }
          }
          meta = next;
        },
        { withTable: false },
      );
    }
    const log = new Map(rowLog);
    for (const row of report.rows ?? []) {
      const entries = [...(log.get(row.key) ?? [])];
      entries.push({
        column: 'Build',
        before: '',
        after: row.outcome === 'failed' ? row.reason : row.outcome,
      });
      log.set(row.key, entries.slice(-40));
    }
    rowLog = log;
    const counts = report.counts ?? {};
    const words = [
      counts.built && `${counts.built} built`,
      counts.restated && `${counts.restated} refreshed`,
      counts.failed && `${counts.failed} failed`,
      report.stopped && 'stopped',
    ].filter(Boolean);
    toast(words.length ? words.join(' · ') : 'Nothing was built.');
    reloadCase();
  }

  /**
   * What a pass did, in the words that distinguish it.
   *
   * Counted apart rather than summed: "forty sent" hides whether the case gained forty
   * subjects or recognised thirty-nine it already had, and it hides the two rows nothing
   * could be read out of. The edges are counted apart again, because they are the half the
   * older roads could not draw at all.
   */
  function said(answer) {
    const tally = { make: 0, join: 0, update: 0, skip: 0, error: 0 };
    for (const layer of answer.entities ?? []) {
      for (const word of Object.keys(tally)) tally[word] += layer[word] ?? 0;
    }
    const drawn = (answer.joins ?? []).reduce((total, join) => total + (join.drawn ?? 0), 0);
    const words = [
      tally.make && `${tally.make} added`,
      tally.join && `${tally.join} joined`,
      tally.update && `${tally.update} updated`,
      drawn && `${drawn} ${drawn === 1 ? 'edge' : 'edges'}`,
      tally.skip && `${tally.skip} left out`,
      tally.error && `${tally.error} could not be read`,
    ].filter(Boolean);
    return words.length ? words.join(' · ') : 'Nothing to send in those rows.';
  }

  function undo() {
    apply(history.undo());
  }

  function redo() {
    apply(history.redo());
  }

  function apply(step_) {
    if (!step_) return;
    const { entry, direction } = step_;
    if (entry.kind === 'cells') {
      table = applyEdits(table, entry.edits, direction);
    } else {
      const parsed = JSON.parse(direction === 'backward' ? entry.before : entry.after);
      if (parsed.table) table = parsed.table;
      meta = { ...emptyMeta(), ...parsed.meta };
    }
    editing = null;
    touch();
  }

  // -- rows and columns ------------------------------------------------------

  /**
   * Grow the sheet by one row, and make sure the analyst can see it.
   *
   * A blank row does not answer most filters, so under an active question the row was
   * written to the file and vanished from the screen in the same breath — which reads as
   * the press having done nothing, and the row is then found by somebody else a week later.
   * The filter is the analyst's, so it is not cleared behind them; what happens is that the
   * grid says the row is there and offers to show it.
   */
  function appendRow() {
    if (!room({ rows: 1 })) return false;
    structural(() => {
      table = addRow(table);
    });
    const at = table.rows.length - 1;
    cursor = { row: at, column: firstWritableColumn() };
    anchor = { ...cursor };
    if (!shown.includes(at)) {
      toast('That row is hidden by the current filter.', 'ok', 6000, {
        label: 'Show it',
        onClick: showEverything,
      });
      return false;
    }
    scrollIntoView();
    return true;
  }

  /** Every question dropped at once — the chips and the search together, since a row the
   *  one hides is hidden by the other in exactly the same way. */
  function showEverything() {
    clearTimeout(queryTimer);
    queryInput = '';
    query = '';
    ask(clearFilters());
  }

  /**
   * The empty line at the end of the grid, made real by being typed in.
   *
   * What every spreadsheet does, and what a `+ Row` button in the footer was standing in
   * for: the most ordinary thing a grid does cost a trip to the bottom of the screen and
   * then a second one back to the column being filled. The editor opens where the click
   * landed, so the gesture ends where the typing starts — on the column the app writes,
   * the first one that takes an edit instead.
   */
  function startGhost(columnIndex) {
    // Only where the row actually landed on screen: an editor opened on a row the filter
    // has already taken away is a box nothing draws and a state nothing can leave.
    if (!appendRow()) return;
    const name = table.columns[columnIndex];
    edit(table.rows.length - 1, writable(name) ? columnIndex : firstWritableColumn());
  }

  /** A row where the analyst is reading rather than four hundred rows below it. The cursor
   *  follows it, because a line inserted to be filled in is a line to type in. */
  function addRowAt(index, where) {
    if (!room({ rows: 1 })) return;
    const at = where === 'above' ? index : index + 1;
    structural(() => {
      table = insertRow(table, at);
    });
    cursor = { row: at, column: firstWritableColumn() };
    anchor = { ...cursor };
    scrollIntoView();
  }

  /**
   * Refuse a gesture that would grow the sheet past what the file can hold, and say why.
   *
   * Asked **before** the edit. The bounds are the server's and they were only the
   * server's, so the grid took the eight hundredth row over the limit and then answered
   * 422 on every autosave from that moment on: the work was on screen, unsaved, and the
   * only way out was to guess how much to delete. Refusing the press costs the analyst
   * one paste; refusing the save cost them the afternoon.
   */
  function room(growth) {
    const full = tooBigBy(table, growth);
    if (full) toast(full, 'error');
    return !full;
  }

  /** The rows a gesture made *on one row* is about: the batch when that row is part of it,
   *  and that row alone otherwise. One rule, so painting, duplicating and deleting from the
   *  gutter cannot disagree about what "these" means. */
  function rowsAround(index) {
    return batchIndices.includes(index) && batchIndices.length ? batchIndices : [index];
  }

  /** Copy the rows this menu is about, each under its own. The gesture is a candidate that
   *  turns out to be two — one address, two hypotheses — and the copies come back ticked so
   *  the next thing done to them is done to the copies. */
  function duplicateBatch(index) {
    const wanted = rowsAround(index);
    if (!room({ rows: wanted.length })) return;
    let made = [];
    structural(() => {
      const grown = duplicateRows(table, wanted);
      table = grown.table;
      made = grown.keys;
    });
    picked = new Set(made);
    lastTicked = null;
    toast(`${made.length} ${made.length === 1 ? 'row' : 'rows'} duplicated.`);
  }

  /** Ask before the rows go. The count is the whole reason: the batch is whatever was
   *  ticked or dragged over, and "40 rows" that turn out to be the wrong forty is
   *  exactly what a confirmation is for. */
  function askDeleteBatch() {
    if (batchIndices.length) confirming = { kind: 'rows', count: batchIndices.length };
  }

  /** The same ask, from the gutter. The rows travel with it: the batch can change between
   *  the question and the answer, and a delete that acted on a different set than the one
   *  counted would be the exact failure the ask exists to prevent. */
  function askDeleteRows(index) {
    const rows = rowsAround(index);
    if (rows.length) confirming = { kind: 'rows', count: rows.length, rows };
  }

  function deleteBatch() {
    const indices = confirming?.rows ?? batchIndices;
    confirming = null;
    if (!indices.length) return;
    structural(() => {
      table = removeRows(table, indices);
    });
    picked = new Set();
    lastTicked = null;
    rowPanel = null;
    cursor = { row: -1, column: -1 };
    anchor = null;
  }

  /** Tick a row, or — held with shift — everything between it and the last one
   *  ticked, in the order the grid draws rather than the order the file holds. */
  function togglePicked(key, extend = false) {
    const next = new Set(picked);
    if (extend && lastTicked && lastTicked !== key) {
      for (const between of keysBetween(table, shown, lastTicked, key)) next.add(between);
    } else if (!next.delete(key)) next.add(key);
    picked = next;
    lastTicked = key;
  }

  function toggleAllShown() {
    const keys = shownKeys(table, shown);
    picked = allShownTicked ? new Set() : new Set(keys);
    lastTicked = null;
  }

  /** Paint from the gutter, on the batch or on the one row pressed. */
  function paintRows(index, colour) {
    const keys = rowsAround(index).map((at) => rowKey(table.columns, table.rows[at]));
    structural(
      () => {
        let next = meta;
        for (const key of keys) next = setColour(next, key, colour);
        meta = next;
      },
      { withTable: false },
    );
  }

  function paint(colour) {
    structural(
      () => {
        let next = meta;
        for (const key of batchKeys) next = setColour(next, key, colour);
        meta = next;
      },
      { withTable: false },
    );
  }

  function appendColumn() {
    if (!room({ columns: 1 })) return;
    structural(() => {
      table = addColumn(table, 'Column');
    });
    showColumn(table.columns.length - 1);
  }

  /** A column beside the one being worked on. The `+` at the far right is still there for
   *  a column appended to the end; this is the one that was missing, and dragging a new
   *  heading back across twelve columns was the workaround. */
  function addColumnAt(index, side) {
    if (!room({ columns: 1 })) return;
    const at = side === 'left' ? index : index + 1;
    let name = null;
    structural(() => {
      table = insertColumn(table, at, 'Column');
      name = table.columns[at];
    });
    columnPanel = null;
    renameColumnAt(at, name);
  }

  function copyColumn(index) {
    if (!room({ columns: 1 })) return;
    let made = null;
    structural(() => {
      const grown = duplicateColumn(table, meta, index);
      table = grown.table;
      meta = grown.meta;
      made = grown.name;
    });
    if (made) toast(`“${made}” written.`);
  }

  /** Rename in the heading itself. Double-click, or the row in the heading menu: the panel
   *  can still do it, and going two screens away to fix a spelling is not a rename. */
  function renameColumnAt(index, name = null) {
    renaming = index;
    renameText = name ?? table.columns[index] ?? '';
  }

  function commitHeadingRename() {
    if (renaming === null) return;
    const index = renaming;
    const name = renameText;
    renaming = null;
    applyRename(index, name);
  }

  function applyRename(index, name) {
    const previous = table.columns[index];
    if (String(name ?? '').trim() === previous) return;
    structural(() => {
      const moved = renameColumn(table, meta, index, name);
      table = moved.table;
      meta = moved.meta;
      // The sidecar's half is moved by `renameColumn`; this is the grid's own copy of the
      // question, which is held as sets while it is being matched against. Without it the
      // rows on screen changed because a heading was spelled again.
      filters = renameFilterColumn(filters, previous, table.columns[index]);
    });
  }

  /** Ask before a column goes, and say what goes with it. A column carries cells the
   *  file holds, and a role, a note and a width nothing else remembers — none of which
   *  a heading shows, so the count is how the click stops being a guess. */
  function askDropColumn(index) {
    const name = table.columns[index];
    if (name === undefined) return;
    confirming = {
      kind: 'column',
      index,
      name,
      filled: table.rows.filter((row) => String(row[index] ?? '').trim()).length,
      role: Boolean(roles[name]),
    };
  }

  /** Delete a column, and close the panel that was showing it.
   *
   *  The index is read from the argument rather than from the panel, and the panel is
   *  closed **after** the table moves. Closing it first read `column.index` off a
   *  derived that had just lost its column, which threw before the delete ever ran —
   *  the column stayed, and the only sign was a line in the console. */
  function dropColumn(index) {
    confirming = null;
    if (index < 0 || index >= table.columns.length) return;
    structural(() => {
      const moved = removeColumn(table, meta, index);
      table = moved.table;
      meta = moved.meta;
    });
    columnPanel = null;
    filterAt = null;
    cursor = { row: -1, column: -1 };
    anchor = null;
    editing = null;
  }

  /** A pass that rewrote cells: one undoable step, and a word about what it did. */
  function cleanCells(edits, said) {
    editCells(edits);
    toast(said);
  }

  /** A pass that grew or shrank the table: whole-table step, because the columns moved.
   *
   *  The bound is checked on the table the pass **produced** rather than on what it was
   *  about to do: splitting one column into six is the pass that reaches the ceiling, and
   *  only the pass itself knows how many it made. */
  function cleanTable(next, said) {
    const full = tooBigBy(next.table);
    if (full) {
      toast(full, 'error');
      return;
    }
    structural(() => {
      table = next.table;
      meta = { ...emptyMeta(), ...next.meta };
    });
    columnPanel = null;
    toast(said);
  }

  /**
   * Fold the rows this gesture is about into the first of them.
   *
   * The other half of "this value is said twice". Finding the duplicates and painting them
   * was already here; what followed was retyping one row out of three by hand, which on an
   * imported inbox where the same address arrives from three channels is the whole job. The
   * fullest answer per column wins (`lib/sheet.mergeRows`), and the surviving row keeps its
   * key, so its colour, its links and its promotion record survive with it.
   */
  function mergeBatch(index) {
    const wanted = rowsAround(index);
    if (wanted.length < 2) return;
    let folded = 0;
    let kept = null;
    structural(() => {
      const merged = mergeRows(table, wanted);
      table = merged.table;
      folded = merged.folded;
      kept = merged.key;
    });
    picked = kept ? new Set([kept]) : new Set();
    lastTicked = null;
    cursor = { row: -1, column: -1 };
    anchor = null;
    toast(`${folded + 1} rows folded into one. Undo puts them back.`);
  }

  /**
   * One cell's values as one row each.
   *
   * The shape every "to be sorted" inbox arrives in: a row holding five links, or a cell
   * reading `Buk-M2E, ZU23-2, S-300` in a worklist that wants a line per system. Splitting a
   * column into *columns* answers a different question and already existed.
   */
  function explodeCell(rowIndex, columnIndex) {
    const role = roles[table.columns[columnIndex]];
    const cell = String(table.rows[rowIndex]?.[columnIndex] ?? '');
    // What the values are written between: the column's own separator where it declares one,
    // a line per link where the cell holds several, and commas as the last resort — which is
    // what a pasted list holds.
    const separator = role?.multi ?? (urlsIn(cell).length > 1 || cell.includes('\n') ? '\n' : ',');
    // One row is already there, so only the values after the first are new rows.
    const parts = cell.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1 && !room({ rows: parts.length - 1 })) return;
    let made = [];
    structural(() => {
      const grown = explodeRow(table, rowIndex, columnIndex, separator);
      table = grown.table;
      made = grown.keys;
    });
    if (!made.length) {
      toast('That cell holds one value.');
      return;
    }
    toast(`${made.length + 1} rows out of one.`);
  }

  /** Keep one row under the heading, or let it go. */
  function pinRow(index) {
    const key = rowKey(table.columns, table.rows[index]);
    structural(
      () => {
        meta = setPinned(meta, key);
      },
      { withTable: false },
    );
  }

  /** Say what a colour means in this sheet. */
  function nameColour(colour, label) {
    if ((meta.legend?.[colour] ?? '') === String(label ?? '').trim()) return;
    structural(
      () => {
        meta = setLegend(meta, colour, label);
      },
      { withTable: false },
    );
  }

  /** One line per row, or the four a note needs. */
  function toggleTall() {
    structural(
      () => {
        meta = setTall(meta, !meta.tall);
      },
      { withTable: false },
    );
  }

  /**
   * Ask whether a column of sources still answers.
   *
   * The only reading that reaches the network, and it goes on this press. Walked in batches
   * so the count moves and a long column can be left half done — and over the rows on
   * screen, like every other pass here.
   */
  async function checkColumnLinks(name) {
    const at = table.columns.indexOf(name);
    if (at === -1 || checking) return;
    const entries = urlsInColumn(table, at, shown);
    if (!entries.length) {
      toast('No links in this column, over the rows on screen.');
      return;
    }
    checking = { column: name, done: 0, total: entries.length };
    const verdicts = {};
    try {
      for (const batch of chunk(entries.map((entry) => entry.url))) {
        Object.assign(verdicts, await checkLinks(caseId, openId, batch));
        checking = { ...checking, done: Math.min(checking.total, checking.done + batch.length) };
      }
      reading = { kind: 'links', column: name, ...readVerdicts(entries, verdicts) };
    } catch (error) {
      toast(error.message || 'Those links could not be checked.', 'error');
    } finally {
      checking = null;
    }
  }

  /**
   * Build a sheet out of the entities the case holds.
   *
   * The other direction of the promotion road, and the server owns all of it: the rows, the
   * links back and the `mentions` edges land in one write, so a worklist made from forty
   * places is connected to them before it is opened.
   */
  async function buildFromCase(choice) {
    if (building) return;
    building = true;
    try {
      const sheet = await api.post(`/api/cases/${caseId}/sheets/from-case`, choice);
      fromCase = false;
      await list(caseId);
      openId = null;
      await open(sheet.id);
      await reloadCase();
      toast(
        sheet.taken < sheet.total
          ? `${sheet.taken} of ${sheet.total} taken into the sheet.`
          : `${sheet.taken} ${sheet.taken === 1 ? 'row' : 'rows'} taken into the sheet.`,
      );
    } catch (error) {
      toast(error.message || 'This sheet could not be built.', 'error');
    } finally {
      building = false;
    }
  }

  /** The reading as a Markdown table, on the clipboard. What goes into a note, a ticket or
   *  a message — retyping twelve rows into the Notebook is where citing the sheet stops. */
  /**
   * The reading as a Markdown table, with the provenance that makes it citable.
   *
   * The header is what this app kept from the idea of a sheet plate and the only part of
   * it worth keeping: twelve rows pasted into a ticket with no case, no filter and no
   * timestamp are twelve rows nobody can check a week later, and `12 of 468` read without
   * seeing that a filter was on is a sample presented as a set.
   */
  async function copyMarkdown() {
    exportOpen = false;
    const text = toMarkdown(
      viewTable(table, drawn, shown),
      provenance({
        caseName: caseState.current?.name ?? '',
        sheet: title,
        filter: chips.map((chip) => chip.label).join(' · '),
        sort: meta.sort ? `${meta.sort.column}${meta.sort.desc ? ', descending' : ''}` : '',
        shown: shown.length,
        total: table.rows.length,
        at: new Date().toISOString(),
      }),
    );
    try {
      await navigator.clipboard.writeText(text);
      toast(`${shown.length} ${shown.length === 1 ? 'row' : 'rows'} copied as a table.`);
    } catch {
      toast('Copying failed. Export the CSV instead.', 'error');
    }
  }

  function sortBy(name) {
    structural(
      () => {
        meta = { ...meta, sort: nextSort(meta.sort, name) };
      },
      { withTable: false },
    );
  }

  /** Sorted the way the menu names it, and pressing the same row again turns it off — the
   *  heading's own click still cycles, which is what a heading does. A second key already in
   *  place travels with it: it is a tiebreak on this sort, not a sort of its own. */
  function sortDirection(name, desc) {
    const same = meta.sort?.column === name && meta.sort.desc === desc;
    structural(
      () => {
        const then = meta.sort?.then && meta.sort.then.column !== name ? { then: meta.sort.then } : {};
        meta = { ...meta, sort: same ? null : { column: name, desc, ...then } };
      },
      { withTable: false },
    );
  }

  /** Break the first key's ties with this column: ascending, descending, off. */
  function secondSort(name) {
    structural(
      () => {
        meta = { ...meta, sort: nextSecondSort(meta.sort, name) };
      },
      { withTable: false },
    );
  }

  function hideColumn(name) {
    structural(
      () => {
        meta = toggleHidden(meta, name);
      },
      { withTable: false },
    );
  }

  function freezeColumn(name) {
    structural(
      () => {
        meta = setFrozen(meta, name);
      },
      { withTable: false },
    );
  }

  // -- what a column knows ---------------------------------------------------
  //
  // Every one of these writes the sidecar and nothing else. A role is a lens: it changes
  // what the grid shows and how it sorts, never what the file says. The two exceptions
  // are declared as such — `stamped` and `computed` are written into the CSV by the
  // server, and normalising is an edit the analyst asks for by name.

  /**
   * Declare, change or clear a column's role.
   *
   * Almost every role is sidecar-only, so the step it records is the sidecar alone —
   * kilobytes rather than the whole table. The two exceptions are the roles the **server
   * writes into the CSV** on the next save: undoing one of those has to put the cells
   * back as well, or the column keeps its `YES`/`NO` after the role that produced them is
   * gone, and the undo reads as having done nothing at all.
   */
  function setRole(name, role) {
    const touchesFile = appFilled(name) || ['stamped', 'computed', 'locked'].includes(role?.kind);
    structural(
      () => {
        const next = { ...(meta.roles ?? {}) };
        if (role) next[name] = role;
        else delete next[name];
        meta = { ...meta, roles: next };
      },
      { withTable: touchesFile },
    );
  }

  /** Take a word the cell holds into the column's own vocabulary, from the cell.
   *
   *  The column panel could always do this, and that is two screens away from the moment
   *  it is wanted: the analyst is typing `OK en cours` into a status column *now*, and
   *  the choice is between adopting it here or leaving it outside the words for good. */
  function addValue(name, word) {
    const role = roles[name];
    if (!role || !word) return;
    setRole(name, { ...role, values: [...(role.values ?? []), word] });
  }

  function setNote(name, text) {
    const clean = String(text ?? '').trim();
    if ((meta.notes?.[name] ?? '') === clean) return;
    structural(
      () => {
        const next = { ...(meta.notes ?? {}) };
        if (clean) next[name] = clean;
        else delete next[name];
        meta = { ...meta, notes: next };
      },
      { withTable: false },
    );
  }

  function setProgress(name) {
    structural(
      () => {
        meta = { ...meta, progress: meta.progress === name ? null : name };
      },
      { withTable: false },
    );
  }

  /** Offer the column the sheet is plainly being worked through, once, and only when
   *  nobody has said. A suggestion in the footer rather than a setting applied behind
   *  the analyst: the whole point is that they choose it. */
  const suggestedProgress = $derived(
    meta.progress ? null : suggestProgressColumn(table, roles, ID_COLUMN),
  );

  /**
   * Hand a column of coordinates to the map, as a session layer.
   *
   * The points travel rather than the sheet: the map is shown what this column says
   * right now, and nothing is written anywhere. Same shape as the window Timeline hands
   * over — `uiState` carries it, the map consumes it and clears it.
   */
  function toMap(name, rows = shown) {
    const at = table.columns.indexOf(name);
    const points = rows.map((index) => pointOf(index, at)).filter(Boolean);
    if (!points.length) {
      toast('No coordinates could be read in this column.', 'error');
      return;
    }
    uiState.mapSheetPoints = { points, sheet: title, column: name };
    uiState.tool = 'satellite';
  }

  /** The first column of a kind, or nothing: which column the batch handoffs read without
   *  asking, since a sheet holds one column of coordinates and one of dates far more often
   *  than it holds two. */
  function firstOfKind(kind) {
    return table.columns.find((name) => roles[name]?.kind === kind) ?? null;
  }

  /**
   * The rows that are ticked, on the map or on the Timeline.
   *
   * The column handoffs sent everything on screen, which is the wrong question as often as
   * it is the right one: an analyst who has just ticked eleven candidates out of four hundred
   * wants those eleven drawn, not the field. The selection is what they said.
   */
  function batchToMap() {
    const name = firstOfKind('latlon');
    if (!name) {
      toast('No column is set to coordinates.', 'error');
      return;
    }
    toMap(name, batchIndices);
  }

  function batchToTimeline() {
    const name = firstOfKind('when');
    if (!name) {
      toast('No column is set to dates.', 'error');
      return;
    }
    toTimeline(name, batchIndices);
  }

  /**
   * One cell's point, on the map, on its own.
   *
   * The column's handoff one point wide, because that is the question a worklist asks
   * most: not *where are all four hundred* but *where is this one*. Through the same
   * layer, so the pin carries the same circle when the cell was written to a kilometre
   * — a row sent over alone deserves that warning more than a field of pins does.
   */
  function cellToMap(rowIndex, columnIndex) {
    const point = pointOf(rowIndex, columnIndex);
    if (!point) return;
    uiState.mapSheetPoints = {
      points: [point],
      sheet: title,
      column: table.columns[columnIndex],
    };
    uiState.tool = 'satellite';
  }

  /** A cell as a point the map can take, or null where it cannot be read. The label is
   *  how the row will name itself once it is a pin: the first column that is neither the
   *  coordinates being drawn nor the handle, and the handle when there is nothing else. */
  function pointOf(rowIndex, columnIndex) {
    const point = parseLatLon(table.rows[rowIndex][columnIndex]);
    if (!point || point.outOfBounds) return null;
    const name = table.columns[columnIndex];
    const label = table.columns.find((column) => column !== name && column !== ID_COLUMN);
    const labelAt = label ? table.columns.indexOf(label) : -1;
    return {
      lat: point.lat,
      lon: point.lon,
      label:
        (labelAt !== -1 ? table.rows[rowIndex][labelAt] : '') ||
        table.rows[rowIndex][keyIndex(table.columns)],
      decimals: point.decimals,
    };
  }

  /**
   * Hand a column of dates to the Timeline, as a session layer.
   *
   * What travels is the window the column covers, which is what the Timeline is built to
   * take: it already knows how to draw a period of the case. A bare clock is left behind
   * — a time with no date cannot be put on an axis, and inventing the date would be
   * inventing evidence.
   */
  function toTimeline(name, rows = shown) {
    const at = table.columns.indexOf(name);
    const role = roles[name];
    const moments = rows
      .map((index) => parseWhen(table.rows[index][at], role))
      .filter((read) => read?.shape === 'moment')
      .map((read) => read.key);
    if (!moments.length) {
      toast('No date in this column could be read.', 'error');
      return;
    }
    const day = 86_400_000;
    uiState.timelineRange = {
      from: new Date(Math.min(...moments)).toISOString(),
      to: new Date(Math.max(...moments) + day).toISOString(),
    };
    uiState.tool = 'timeline';
  }

  /** Rewrite every point of a column in one form. The one action here that touches the
   *  file, asked for by name, in one undoable step — because a role by itself never
   *  improves the file, and the binders hold three formats in one column. */
  function normalise(name) {
    const at = table.columns.indexOf(name);
    const edits = [];
    table.rows.forEach((row, index) => {
      const point = parseLatLon(row[at]);
      if (!point) return;
      const after = formatLatLon(point);
      if (after !== row[at]) edits.push({ row: index, column: at, before: row[at], after });
    });
    if (!edits.length) {
      toast('Every point is already written the same way.');
      return;
    }
    editCells(edits);
    toast(`${edits.length} ${edits.length === 1 ? 'point' : 'points'} rewritten.`);
  }

  function showDuplicates(name) {
    const at = table.columns.indexOf(name);
    const groups = duplicateGroups(table, at, roles[name]);
    reading = { kind: 'duplicates', column: name, groups };
  }

  function showNearby(name) {
    const at = table.columns.indexOf(name);
    reading = { kind: 'nearby', column: name, ...nearbyPairs(table, at, NEARBY_M) };
  }

  /** How close two points have to be before the grid calls them one place. Wide enough
   *  that two readings of the same building match, tight enough that two ends of a
   *  street do not. */
  const NEARBY_M = 150;

  /** Paint the rows a reading points at, so the answer lands in the table itself rather
   *  than staying a list beside it. */
  function paintReading(rowIndices, colour = 'yellow') {
    const keys = rowIndices.map((index) => rowKey(table.columns, table.rows[index]));
    structural(
      () => {
        let next = meta;
        for (const key of keys) next = setColour(next, key, colour);
        meta = next;
      },
      { withTable: false },
    );
    picked = new Set(keys);
  }

  // -- dragging a column into place ------------------------------------------
  //
  // Pointer events rather than HTML drag and drop: the grid already owns the pointer
  // for resizing and for its own scrollbars, and mixing the two gesture models on
  // one heading is how a resize starts a reorder.

  function grabColumn(event, index) {
    event.preventDefault();
    event.stopPropagation();
    dragColumn = { from: index, over: index };
    const up = () => {
      const move = dragColumn;
      dragColumn = null;
      document.removeEventListener('pointerup', up);
      if (!move || move.over === move.from) return;
      structural(() => {
        table = moveColumn(table, move.from, move.over);
      });
    };
    document.addEventListener('pointerup', up);
  }

  function dragOver(index) {
    if (dragColumn && dragColumn.over !== index) dragColumn = { ...dragColumn, over: index };
  }

  // -- filtering -------------------------------------------------------------
  //
  // A heading has two doors, and they are split by how often each is wanted. The
  // funnel asks something of the column, which is the gesture of the day; the `...`
  // sets the column up, which is done once and then left alone. One door for both
  // made the constant thing cost what the rare thing costs — and it was the rare
  // thing the door was named after.

  function toggleValue(column, value) {
    ask(toggleFilterValue(filters, column, value));
  }

  /** Open the filter on the heading under the pointer, or close it if it is that
   *  heading's that is open. Placed from the funnel's own rectangle. */
  function openFilter(event, column) {
    const box = event.currentTarget.getBoundingClientRect();
    const same = filterAt?.index === column.index;
    cellMenu = null;
    filterAt = same ? null : { index: column.index, x: box.left, y: box.bottom + 4 };
  }

  /**
   * Filter a column the analyst cannot see.
   *
   * The columns list is the map of a sheet too wide to read at once, so asking
   * something of a column from there has to bring its heading over first — a menu
   * placed on a funnel that is off screen is a menu off screen. Unhides it too: being
   * asked about is a reason to be visible.
   */
  async function filterColumn(name) {
    columnsOpen = false;
    if ((meta.hidden ?? []).includes(name)) hideColumn(name);
    await tick();
    scrollColumnIntoView(name);
    await tick();
    const funnel = funnels[name];
    if (!funnel?.isConnected) return;
    const box = funnel.getBoundingClientRect();
    filterAt = { index: table.columns.indexOf(name), x: box.left, y: box.bottom + 4 };
  }

  /** How wide the columns that stay put are, together. Where a column brought into
   *  view has to land, or it arrives underneath the frozen ones. */
  const stickyWidth = $derived(
    Object.entries(offsets).reduce(
      (edge, [name, left]) => Math.max(edge, left + (meta.widths?.[name] ?? DEFAULT_WIDTH)),
      GUTTER_WIDTH,
    ),
  );

  /**
   * Keep an open filter menu on the heading it belongs to while the grid scrolls.
   *
   * Followed rather than closed, because the scroll is often the analyst's own doing on
   * the way to reading the rows the filter just left. It closes when the heading has
   * gone behind the frozen columns or off the far edge, which is the point at which a
   * menu is no longer attached to anything.
   */
  function followFilter() {
    if (!filterAt) return;
    const funnel = funnels[table.columns[filterAt.index]];
    const grid = scroller?.getBoundingClientRect();
    if (!funnel?.isConnected || !grid) {
      filterAt = null;
      return;
    }
    const box = funnel.getBoundingClientRect();
    if (box.right < grid.left + stickyWidth || box.left > grid.right) {
      filterAt = null;
      return;
    }
    filterAt = { ...filterAt, x: box.left, y: box.bottom + 4 };
  }

  function scrollColumnIntoView(name) {
    if (!scroller) return;
    let left = GUTTER_WIDTH;
    for (const column of drawn) {
      if (column.name === name) break;
      left += meta.widths?.[column.name] ?? DEFAULT_WIDTH;
    }
    scroller.scrollLeft = Math.max(0, left - stickyWidth - 8);
    measure();
  }

  /**
   * The heading's short menu, from the `...` and from a right-click on the heading.
   *
   * Placed from the pointer where there is one and from the button's own rectangle
   * otherwise, so both gestures land somewhere sensible. Everything else over the grid
   * closes: two menus open at once is two answers to one press.
   */
  function openHeadMenu(event, column) {
    event.preventDefault();
    event.stopPropagation();
    const same = headMenu?.index === column.index;
    filterAt = null;
    cellMenu = null;
    rowMenu = null;
    if (same) {
      headMenu = null;
      return;
    }
    const box = event.currentTarget?.getBoundingClientRect?.();
    headMenu = {
      index: column.index,
      x: event.clientX || box?.left || 0,
      y: event.clientY || (box ? box.bottom + 4 : 0),
    };
  }

  /** The gutter's menu. It acts on the batch when the row pressed is part of it, which is
   *  what "these forty" means when forty are ticked. */
  function openRowMenu(event, rowIndex) {
    event.preventDefault();
    event.stopPropagation();
    filterAt = null;
    cellMenu = null;
    headMenu = null;
    rowMenu = { row: rowIndex, x: event.clientX, y: event.clientY };
  }

  /** How many rows a row menu is about: the batch when this row is in it, or this one. */
  const rowMenuCount = $derived(
    rowMenu && batchIndices.includes(rowMenu.row) ? batchIndices.length : 1,
  );

  /**
   * A cell's own menu.
   *
   * The fastest filter there is, because the answer is already under the pointer: the
   * analyst reads `Kherson` in a row and wants the other rows saying it, and walking
   * up to the heading of a column they can see is the step that was in the way. A
   * blank cell asks the one question a blank cell can: which others are blank too.
   */
  function openCellMenu(event, rowIndex, column) {
    event.preventDefault();
    filterAt = null;
    cursor = { row: rowIndex, column: column.index };
    anchor = { ...cursor };
    cellMenu = {
      row: rowIndex,
      column: column.name,
      index: column.index,
      value: String(table.rows[rowIndex]?.[column.index] ?? '').trim(),
      x: event.clientX,
      y: event.clientY,
    };
  }

  /** The value a cell menu filters on. On a column drawn as chips it is the chip, not
   *  the cell: `Buk-M2E, ZU23-2` is two answers, and asking for the pair would ask for
   *  something no second row holds. */
  function menuValues(entry) {
    const role = roles[entry.column];
    if (!isChipped(role)) return entry.value ? [entry.value] : [];
    // Distinct: a cell holding one word twice asks one question, and a menu offering
    // “Only “S-125”” twice is the same filter drawn twice.
    return [...new Set(cellChips(entry.value, role).map((chip) => chip.value))];
  }

  // -- the grid's own scrollbars ---------------------------------------------

  /**
   * What a scroll changes, and only that.
   *
   * `measure()` also reads `scrollWidth` and `clientHeight`, and asking a scroller for
   * those in the middle of a scroll forces the layout it is halfway through — on a wide
   * grid with sticky columns, a reflow per tick. The four sizes cannot change under a
   * scroll anyway: a column resized, one hidden or rows filtered away all go through the
   * effect below, and the panel changing shape goes through the ResizeObserver.
   */
  function trackScroll() {
    if (!scroller) return;
    extent = { ...extent, left: scroller.scrollLeft, top: scroller.scrollTop };
  }

  function measure() {
    if (!scroller) return;
    extent = {
      scrollW: scroller.scrollWidth,
      clientW: scroller.clientWidth,
      scrollH: scroller.scrollHeight,
      clientH: scroller.clientHeight,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    };
  }

  // Re-measured when the scroller appears and whenever what it holds changes
  // shape: a column resized, one hidden, rows filtered away.
  $effect(() => {
    const node = scroller;
    void [template, shown.length, drawn.length];
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  /** Drag a thumb. The pointer is captured, so leaving the bar keeps the grab. */
  function grabThumb(event, axis) {
    event.preventDefault();
    event.stopPropagation();
    dragging = axis;
    const thumb = axis === 'x' ? hThumb : vThumb;
    const start = axis === 'x' ? event.clientX : event.clientY;
    const from = thumb?.position ?? 0;
    const move = (moved) => {
      const at = axis === 'x' ? moved.clientX : moved.clientY;
      const offset = scrollFromThumb(thumb, from + at - start);
      if (axis === 'x') scroller.scrollLeft = offset;
      else scroller.scrollTop = offset;
      measure();
    };
    const up = () => {
      dragging = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  /** Click the empty part of a bar: jump one panel that way, as a scrollbar does. */
  function pageBy(event, axis) {
    const thumb = axis === 'x' ? hThumb : vThumb;
    if (!thumb) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = axis === 'x' ? event.clientX - box.left : event.clientY - box.top;
    const forward = at > thumb.position + thumb.size / 2;
    const page = axis === 'x' ? extent.clientW : extent.clientH;
    if (axis === 'x') scroller.scrollLeft += forward ? page : -page;
    else scroller.scrollTop += forward ? page : -page;
    measure();
  }

  // -- resizing --------------------------------------------------------------

  function startResize(event, name) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = meta.widths?.[name] ?? DEFAULT_WIDTH;
    const before = snapshot({ withTable: false });
    const move = (moved) => {
      meta = setWidth(meta, name, startW + moved.clientX - startX);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      history.record(snapshotEntry(before, snapshot({ withTable: false })));
      touch();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // -- entity links ----------------------------------------------------------

  function openLinkPicker(row, column) {
    linking = { row, column };
  }

  function attach(entity) {
    const { row, column } = linking;
    const key = rowKey(table.columns, table.rows[row]);
    linking = null;
    structural(() => {
      meta = setLink(meta, key, table.columns[column], entity.id);
      // An empty cell takes the entity's name: the file has to say in words what
      // the link says in the graph, or the CSV reads as a blank where the work was
      // done.
      if (!String(table.rows[row][column] ?? '').trim()) {
        table = setCells(table, [{ row, column, value: entity.label ?? '' }]);
      }
    });
  }

  function detach(row, column) {
    const key = rowKey(table.columns, table.rows[row]);
    linking = null;
    structural(
      () => {
        meta = setLink(meta, key, table.columns[column], null);
      },
      { withTable: false },
    );
  }

  /**
   * Let go of what the case has deleted.
   *
   * A link is an id in the sidecar rather than an edge, so a delete on another screen
   * cannot reach the copy this grid is holding: the cell went on showing a link to a row
   * the case no longer had, and the next save would have written the dead id back over
   * the file that the delete had just cleared (`engine/sheets.forget_entities`).
   *
   * Asked once per case change, and only about the ids this sheet actually points at.
   * The screen is brought to where the file already is, so nothing is marked unsaved and
   * nothing the analyst is typing is touched.
   */
  let sweptRev = null;
  $effect(() => {
    const rev = caseState.rev;
    const id = caseId;
    if (!id || !openId) return;
    if (sweptRev === null || sweptRev === rev) {
      sweptRev = rev; // the read that opened the sheet is already current
      return;
    }
    sweptRev = rev;
    untrack(() => void forgetDeleted(id));
  });

  async function forgetDeleted(id) {
    const ids = linkedEntityIds(meta);
    if (!ids.length) return;
    let missing = [];
    try {
      ({ missing = [] } = await api.post(`/api/cases/${id}/entities/missing`, { ids }));
    } catch {
      return; // the file is already clear; the next read of the sheet settles the screen
    }
    if (!missing.length || id !== caseId) return;
    const next = withoutEntities(meta, new Set(missing));
    if (next === meta) return;
    meta = next;
    toast(`Dropped ${missing.length} link${missing.length > 1 ? 's' : ''} to deleted items`, 'info');
  }

  function linkOf(rowIndex, columnName) {
    return linkAt(meta, rowKey(table.columns, table.rows[rowIndex]), columnName);
  }

  /**
   * Whether this cell has been rewritten since the case took what it said.
   *
   * The link alone cannot answer it: it is the same link after the label is edited, so a
   * promoted row and a promoted row that has moved on looked identical. The sidecar keeps
   * the words the promotion read, and the difference is what the mark says. Promotion
   * runs one way — nothing here writes the cell back from the graph — so the answer is
   * "this row and the case no longer agree", which is the analyst's to settle.
   */
  function editedSincePromotion(rowIndex, column) {
    const key = rowKey(table.columns, table.rows[rowIndex]);
    const said = meta.promoted?.[key]?.[column.name];
    if (said === undefined) return false;
    return said !== String(table.rows[rowIndex][column.index] ?? '').trim();
  }

  /** Escape and the backdrop both close a modal, and the Details panel's fields wait
   *  for its own Save: closing over half-typed edits threw them away without a word.
   *  The ask is only raised when there is something to lose. */
  function closeDetails() {
    if (detailsDirty) discarding = true;
    else detailsId = null;
  }

  /**
   * The two right-hand panels, which share one slot.
   *
   * Exclusive in the state rather than only in the template: a slot showing one of them
   * while the other is still set is a panel that comes back on its own when the first is
   * closed. Opening either puts the other away, which is the whole rule.
   */
  function showColumn(index) {
    rowPanel = null;
    columnPanel = index;
  }

  function showRow(index) {
    columnPanel = null;
    rowPanel = index;
  }

  /** The row panel walks the rows the analyst can see, not the file's own order. */
  function stepPanel(by) {
    const at = shown.indexOf(rowPanel);
    if (at === -1) return;
    const next = shown[at + by];
    if (next !== undefined) showRow(next);
  }

  const saveWord = $derived(
    { idle: '', dirty: 'Unsaved', saving: 'Saving', saved: 'Saved', failed: 'Not saved' }[saveState],
  );
</script>

<!-- The focus listener is what turns "the file moved on" from a refusal into a warning:
     the stamp is a stat, so asking on every return is cheap, and hearing it now beats
     hearing it at the save. -->
<svelte:window onkeydown={onKey} oncopy={onCopy} onpaste={onPaste} onfocus={checkStamp} />

<div class="tool">
  <header class="tool-header">
    <Icon name="table" size={17} />
    <h2>Sheet</h2>
    {#if openId}
      <input
        class="input title-input"
        bind:value={title}
        onblur={rename}
        onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        aria-label="Sheet name"
      />
      <!-- What the table is for, beside its name, because that is what it is: a subtitle.
           The binders carried a whole "How to use" tab of annotated screenshots; most of
           what it said belongs on the columns it was about, which is a column's note, and
           this is the sentence left over. One line, quiet, and the only door it needs. -->
      {#if describing}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input describe-input" autofocus maxlength={MAX_DESCRIPTION}
               placeholder="what this sheet is for"
               aria-label="What this sheet is for" bind:value={describeText}
               onkeydown={(event) => {
                 if (event.key === 'Enter') commitDescription();
                 if (event.key === 'Escape') describing = false;
               }}
               onblur={commitDescription} />
      {:else if meta.description}
        <button class="describe-text" title="Edit this description"
                onclick={() => { describeText = meta.description; describing = true; }}>
          {meta.description}
        </button>
      {:else}
        <!-- A pencil and not an `i`: the `i` in this header is the help, the way it is in
             every other tool, and two of them side by side asked the same question twice. -->
        <button class="btn btn-ghost btn-sm" title="Add a description"
                aria-label="Add a description"
                onclick={() => { describeText = ''; describing = true; }}>
          <Icon name="edit" size={13} />
        </button>
      {/if}
      <div class="anchor" bind:this={pickerAnchor}>
        <button class="btn btn-ghost btn-sm" aria-expanded={Boolean(picker)}
                onclick={() => (picker = picker ? null : 'list')}>
          {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
          <Icon name="chevronDown" size={13} />
        </button>
        {#if picker}
          <div class="sheet-menu">
            {#if sheets.length > 8}
              <!-- A case that has grown nine worklists is a case where the picker is a list
                   to be searched rather than read. -->
              <!-- svelte-ignore a11y_autofocus -->
              <div class="sheet-search-row">
                <input class="input" autofocus bind:value={sheetTerm}
                       placeholder="Find a sheet" aria-label="Find a sheet" />
              </div>
            {/if}
            <!-- Only the list scrolls. The two actions below make a sheet **out of this
                 one**, so a case holding fourteen of them must not scroll them out of
                 reach — the same shape the case switcher uses for the same reason. -->
            <div class="sheet-list">
              {#each sheetsShown as sheet (sheet.id)}
                <button class="sheet-row" class:active={sheet.id === openId}
                        onclick={() => open(sheet.id)}>
                  <Icon name="table" size={13} />
                  <span>{sheet.title}</span>
                  <small>{sheet.rows} rows · {sheet.columns} columns</small>
                </button>
              {:else}
                <p class="menu-note">No match.</p>
              {/each}
            </div>
            {#if openId}
              <div class="sheet-foot">
                <!-- The app's answer to saved views is "another reading is another sheet". -->
                <button class="menu-row" onclick={() => duplicateSheet()}>
                  <Icon name="copy" size={12} /><span>Duplicate this sheet</span>
                </button>
                <!-- And the fork a binder is actually built out of: an inbox, a worklist
                     and a reference table at one schema, the next starting as this one's
                     columns with nothing under them. -->
                <button class="menu-row" onclick={() => duplicateSheet({ empty: true })}>
                  <Icon name="table" size={12} /><span>New sheet with these columns</span>
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    <div class="spacer"></div>
    {#if saveWord}<span class="save-state {saveState}">{saveWord}</span>{/if}
    <!-- Five ways of getting rows in, under one button. As five buttons they were five
         sixths of a header that had to fit a title, a subtitle, the sheet list, an export
         and a delete: on a laptop the last of them ran off the edge. They are also asked
         once per sheet, where the grid's own controls are asked all day. -->
    <div class="anchor" bind:this={newAnchor}>
      <button class="btn btn-sm" aria-expanded={newOpen} onclick={() => (newOpen = !newOpen)}>
        <Icon name="plus" size={13} /> New <Icon name="chevronDown" size={12} />
      </button>
      {#if newOpen}
        <div class="new-menu">
          <button class="menu-row" onclick={() => { newOpen = false; creating = { title: '' }; }}>
            <Icon name="table" size={12} /><span>Blank sheet</span>
          </button>
          <!-- One row for both, because the analyst has a file and not a format: a CSV
               lands as one sheet, a workbook as one sheet per tab under the tabs' names. -->
          <label class="menu-row">
            <Icon name="upload" size={12} /><span>Import a file</span>
            <input type="file" accept=".csv,.tsv,.xlsx,text/csv,text/plain" hidden
                   onchange={(event) => {
                     newOpen = false;
                     importFile(event.currentTarget.files);
                     event.currentTarget.value = '';
                   }} />
          </label>
          <button class="menu-row"
                  onclick={() => { newOpen = false; creating = { title: '', text: '' }; }}>
            <Icon name="copy" size={12} /><span>Paste a table</span>
          </button>
          <!-- The other direction of the promotion road: what the case believes, as rows
               to work through. -->
          <button class="menu-row" onclick={() => { newOpen = false; fromCase = true; }}>
            <Icon name="graph" size={12} /><span>From the case</span>
          </button>
          {#if openId}
            <div class="menu-rule"></div>
            <!-- The daily batch belongs in the worklist that already carries the statuses,
                 not in a thirteenth sheet nobody compares. -->
            <button class="menu-row" onclick={() => { newOpen = false; appending = true; }}>
              <Icon name="plus" size={12} /><span>Add rows to this sheet</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
    {#if openId}
      <!-- What is on screen, as a file to hand over. Named for what it produces
           rather than for the machinery: the sheet is already a CSV in the case. -->
      <div class="anchor" bind:this={exportAnchor}>
        <button class="btn btn-sm" disabled={exporting} aria-expanded={exportOpen}
                onclick={() => { exportOpen = !exportOpen; if (exportOpen) readDestination(); }}>
          <Icon name="download" size={13} /> Export <Icon name="chevronDown" size={12} />
        </button>
        {#if exportOpen}
          <div class="export-menu">
            <button class="menu-row" onclick={() => download()}>
              <Icon name="download" size={12} />
              <span>Save {shown.length} rows on screen as CSV</span>
            </button>
            <button class="menu-row" disabled={!batchKeys.length}
                    onclick={() => download({ ticked: true })}>
              <Icon name="check" size={12} />
              <span>{batchKeys.length ? `Save ${batchKeys.length} selected rows as CSV` : 'No rows selected'}</span>
            </button>
            <!-- What goes into a note, a ticket or a message. Retyping twelve rows into
                 the Notebook is where citing the sheet stops. -->
            <button class="menu-row" onclick={copyMarkdown}>
              <Icon name="copy" size={12} /><span>Copy as a Markdown table</span>
            </button>
            <div class="menu-rule"></div>
            <!-- Where it lands, named and changeable **here** — the same offer the plates
                 and the note PDFs make. Sending the analyst to Settings to file a table
                 somewhere else was the one export in the app that did that. -->
            <div class="dest">
              <span>Folder</span>
              <span class="dest-path" title={destination || CASE_FOLDER_LABEL}>
                {destination === null ? 'reading…' : destinationLabel(destination)}
              </span>
              <button class="link" onclick={() => { exportOpen = false; destPicker = true; }}>
                Change
              </button>
            </div>
            <button class="menu-row" onclick={showExports}>
              <Icon name="folderOpen" size={12} /><span>Open this folder</span>
            </button>
          </div>
        {/if}
      </div>
      <button class="btn btn-sm btn-danger" title="Delete this sheet"
              onclick={() => (confirming = { kind: 'sheet' })}>
        <Icon name="trash" size={13} />
      </button>
    {/if}
    <!-- The grid keeps its power under a right-click, which is right — and a right-click
         nobody tries is a feature nobody has. So one door says what there is. -->
    <button class="btn btn-ghost btn-sm" title="Keys and gestures (?)" aria-label="Keys and gestures"
            onclick={() => (helpOpen = true)}>
      <Icon name="info" size={14} />
    </button>
  </header>

  {#if !openId}
    <div class="empty">
      {#if loading}
        <p>Opening.</p>
      {:else}
        <Icon name="table" size={30} />
        <p>No sheet in this case.</p>
        <small>A sheet is a CSV in the case folder.</small>
        <!-- What the grid is *for*, in an empty state that used to say only that it was
             empty. A worklist, a comparison grid and the half-facts are the three things no
             other tool here covers, and an analyst who does not know that files a
             spreadsheet somewhere else instead. -->
        <ul class="empty-what">
          <li>A worklist that counts what is left</li>
          <li>A comparison grid: candidates down, criteria across</li>
          <li>Notes too rough for the graph</li>
        </ul>
        <div class="row-actions">
          <button class="btn btn-primary btn-sm" onclick={() => (creating = { title: '' })}>
            New sheet
          </button>
          <!-- The same file kinds the header takes, workbooks included: an empty state that
               refused an `.xlsx` the menu accepts is the app disagreeing with itself. -->
          <label class="btn btn-sm">
            Import a file
            <input type="file" accept=".csv,.tsv,.xlsx,text/csv,text/plain" hidden
                   onchange={(event) => { importFile(event.currentTarget.files); event.currentTarget.value = ''; }} />
          </label>
          <button class="btn btn-sm" onclick={() => (creating = { title: '', text: '' })}>
            Paste a table
          </button>
          <button class="btn btn-sm" onclick={() => (fromCase = true)}>
            From the case
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="question">
      {#if refreshable}
        <!-- Beside the search rather than up in the header: it acts on the rows, and this
             bar is the one that does. Pressed, never automatic — refreshing on open would
             rewrite a file somebody opened to read. It adds and never removes. -->
        <button class="btn btn-ghost btn-sm" disabled={refreshing} onclick={refreshFromCase}
                title="File the proofs added since, and restate the columns the case owns">
          <Icon name="reset" size={13} /> {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      {/if}
      <div class="search">
        <Icon name="search" size={13} />
        <!-- Written by hand rather than bound: the box echoes the keystroke and the grid
             narrows a moment later, and one binding cannot hold both clocks. -->
        <input class="input" placeholder="Search these rows" bind:this={searchBox}
               value={queryInput} oninput={(event) => onQuery(event.currentTarget.value)} />
      </div>
      {#each chips as chip (chip.column + chip.part + chip.value)}
        <button class="chip" onclick={() => ask(dropChip(filters, chip))}>
          <span class="chip-key">{chip.column}</span>
          {chip.label}
          <Icon name="x" size={11} />
        </button>
      {/each}
      {#if chips.length > 1}
        <!-- Taking six chips off one at a time is six presses to ask the sheet the question
             it opened on. -->
        <button class="link" onclick={() => ask(clearFilters())}>Clear all</button>
      {/if}
      <span class="count">
        <strong>{shown.length}</strong> of {table.rows.length}
      </span>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}>
        <Icon name="undo" size={13} />
      </button>
      <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}>
        <Icon name="redo" size={13} />
      </button>
      <!-- Thirty pixels is right for a worklist and wrong for the column the reasoning is
           written in, so the sheet says which it is. Named rather than drawn: a lone glyph
           whose meaning arrives on hover is a button nobody presses. -->
      <button class="btn btn-ghost btn-sm" class:active={Boolean(meta.tall)}
              aria-pressed={Boolean(meta.tall)} onclick={toggleTall}>
        <Icon name="text" size={13} /> {meta.tall ? 'Short rows' : 'Tall rows'}
      </button>
      {#if legendUsed.length}
        <!-- Six colours and no legend is six colours whose meaning lives in one analyst's
             head, on a case that gets handed over. -->
        <div class="anchor" bind:this={legendAnchor}>
          <button class="btn btn-ghost btn-sm" class:active={legendOpen} aria-expanded={legendOpen}
                  title="What the colours mean"
                  onclick={() => (legendOpen = !legendOpen)}>
            <Icon name="square" size={13} /> Colours
          </button>
          {#if legendOpen}
            <SheetLegend {meta} counts={colourCounts} onlabel={nameColour} />
          {/if}
        </div>
      {/if}
      <div class="anchor" bind:this={columnsAnchor}>
        <button class="btn btn-ghost btn-sm" class:active={columnsOpen}
                aria-expanded={columnsOpen} onclick={() => (columnsOpen = !columnsOpen)}>
          <Icon name="layers" size={13} /> Columns
        </button>
        {#if columnsOpen}
          <!-- The map of the sheet, not a list of checkboxes. On a fourteen-column
               binder the column being asked about is usually off screen, so this says
               what each one is and what is being asked of it, and its funnel brings it
               over and opens its filter there. -->
          <div class="columns-menu">
            {#each table.columns as name (name)}
              {@const hidden = meta.hidden?.includes(name)}
              {@const mark = roleMark(name)}
              {#if String(name).toLowerCase() !== ID_COLUMN}
                <div class="column-row" class:off={hidden}>
                  <input type="checkbox" checked={!hidden} aria-label="Show {name}"
                         title={hidden ? 'Show this column' : 'Hide this column'}
                         onchange={() => hideColumn(name)} />
                  <span class="column-name">{name}</span>
                  {#if meta.sort?.column === name}
                    <Icon name={meta.sort.desc ? 'chevronDown' : 'chevronUp'} size={11} />
                  {/if}
                  {#if mark}
                    <span class="column-kind" title={mark.label}>
                      <Icon name={mark.icon} size={11} />
                    </span>
                  {/if}
                  <button class="column-ask" class:on={isFilterActive(filters[name])}
                          title={isFilterActive(filters[name])
                            ? `Filtered: ${filterSummary(filters[name])}`
                            : `Filter ${name}`}
                          aria-label="Filter {name}"
                          onclick={() => filterColumn(name)}>
                    <Icon name="filter" size={12} />
                  </button>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if filling}
      <!-- Buttons rather than a dropdown: on a fourteen-column binder, the column
           being written is worth reading at a glance, and a closed menu hides which
           one is about to be overwritten. -->
      <div class="fill-bar">
        <span class="label">Set</span>
        <!-- The two columns the app fills are not on offer: a value written into
             `Added on` or `On map` is rewritten by the next save, so a bar that took it
             would be a bar that appeared to work. -->
        {#if fillable.length > 10}
          <!-- Past a dozen columns the chips wrap into three rows and push the box that is
               about to be typed in off the bar. A binder is exactly that wide. -->
          <select class="input fill-pick" aria-label="Which column to fill"
                  value={filling.column}
                  onchange={(event) => (filling = { column: event.currentTarget.value })}>
            {#each fillable as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        {:else}
          <div class="fill-columns">
            {#each fillable as name (name)}
              <button class="chip" class:on={filling.column === name}
                      onclick={() => (filling = { column: name })}>{name}</button>
            {/each}
          </div>
        {/if}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" autofocus aria-label="What to write into {filling.column}"
               placeholder="Value" bind:value={fillValue}
               onkeydown={(event) => event.key === 'Enter' && applyFill()} />
        <span class="label">on {batchKeys.length} {batchKeys.length === 1 ? 'row' : 'rows'}</span>
        <button class="btn btn-sm" onclick={() => (filling = null)}>Cancel</button>
        <button class="btn btn-primary btn-sm" onclick={applyFill}>Fill</button>
      </div>
    {/if}

    {#if droppedRoles.length}
      <p class="notice" role="alert">
        {droppedRoles.length === 1
          ? `“${droppedRoles[0]}” is no longer in the file, so its type, its words and its note are gone.`
          : `${droppedRoles.length} columns are no longer in the file, so their types, words and notes are gone: ${droppedRoles.join(', ')}.`}
        Renaming a column outside the app does this.
        <button class="btn btn-sm" onclick={() => (droppedRoles = [])}>OK</button>
      </p>
    {/if}

    {#if checking}
      <!-- The one reading here that leaves the machine, so it says how far it has got.
           Nominatim's pacing and a rotting host are both slow for honest reasons. -->
      <p class="notice" role="status">
        Checking the links in “{checking.column}”: {checking.done} of {checking.total}.
      </p>
    {/if}

    {#if reading}
      <div class="reading">
        {#if reading.kind === 'duplicates'}
          <strong>{reading.groups.length}</strong>
          {reading.groups.length === 1 ? 'value appears' : 'values appear'} more than once in
          <em>{reading.column}</em>
          {#if reading.groups.length}
            <div class="found">
              {#each reading.groups.slice(0, 12) as group (group.value)}
                <button class="chip" onclick={() => paintReading(group.rows)}>
                  {group.value} <small>×{group.rows.length}</small>
                </button>
              {/each}
              {#if reading.groups.length > 12}
                <span class="foot-note">and {reading.groups.length - 12} more</span>
              {/if}
            </div>
          {/if}
        {:else if reading.kind === 'links'}
          <!-- Counted apart, because they are different facts: a 403 behind a login says
               nothing about whether the page is there, and folding it into "dead" is how a
               source gets thrown away for having a paywall. -->
          <strong>{reading.bad.length}</strong>
          {reading.bad.length === 1 ? 'link' : 'links'} did not answer in
          <em>{reading.column}</em>
          <span class="foot-note">
            {reading.ok} answered{reading.refused ? `, ${reading.refused} blocked` : ''}{reading.skipped
              ? `, ${reading.skipped} not tried`
              : ''}
          </span>
          {#if reading.bad.length}
            <div class="found">
              {#each reading.bad.slice(0, 12) as entry (entry.url)}
                <button class="chip" title="{entry.url} — {entry.state}{entry.code ? ` (${entry.code})` : ''}"
                        onclick={() => paintReading(entry.rows, 'red')}>
                  {linkLabel(entry.url)} <small>×{entry.rows.length}</small>
                </button>
              {/each}
              {#if reading.bad.length > 12}
                <span class="foot-note">and {reading.bad.length - 12} more</span>
              {/if}
              <button class="chip" onclick={() => paintReading(reading.rows, 'red')}>
                Paint all {reading.rows.length}
              </button>
            </div>
          {/if}
        {:else}
          <strong>{reading.pairs.length}</strong>
          {reading.pairs.length === 1 ? 'pair' : 'pairs'} within {NEARBY_M} m in
          <em>{reading.column}</em>
          {#if reading.capped}<span class="foot-note">(list cut short)</span>{/if}
          {#if reading.pairs.length}
            <div class="found">
              {#each reading.pairs.slice(0, 12) as pair (pair.rows.join(':'))}
                <button class="chip" onclick={() => paintReading(pair.rows, 'orange')}>
                  {rowKey(table.columns, table.rows[pair.rows[0]])} ·
                  {rowKey(table.columns, table.rows[pair.rows[1]])}
                  <small>{pair.metres} m</small>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" aria-label="Close"
                onclick={() => (reading = null)}>
          <Icon name="x" size={13} />
        </button>
      </div>
    {/if}

    {#if conflict || stale}
      <!-- Two banners' worth of news in one place, because it is one fact told at two
           volumes. The soft one comes from the stamp checked on focus: nothing has been
           refused, so it says what happened and waits. The hard one is a save that was
           refused, and until it is answered nothing more is written.

           Both offer to **read the file first**. Reload and Overwrite are each
           irreversible in the direction that matters, and choosing between them over one
           sentence made three rows a colleague added and one stray cell the same press. -->
      <div class="notice stacked" class:danger={conflict} role="alert">
        <p>
          {conflict
            ? 'This file changed on disk. Nothing is being saved until you answer.'
            : 'This file changed on disk after it was opened. Nothing is lost.'}
          {#if stale?.diff}<span class="diff-said">{describeDiff(stale.diff)}</span>{/if}
        </p>
        {#if stale?.diff?.changed.length}
          <!-- The sample that makes the count believable. -->
          <ul class="diff-rows">
            {#each stale.diff.changed as change (change.key + change.column)}
              <li>
                <code>{change.key}</code>
                <em>{change.column}</em>
                <span class="was">{change.mine || '—'}</span>
                <Icon name="arrowRight" size={11} />
                <span>{change.theirs || '—'}</span>
              </li>
            {/each}
            {#if stale.diff.cellsChanged > stale.diff.changed.length}
              <li class="foot-note">
                and {stale.diff.cellsChanged - stale.diff.changed.length} more
              </li>
            {/if}
          </ul>
        {/if}
        <div class="notice-row">
          {#if !stale?.diff}
            <button class="btn btn-sm" disabled={comparing} onclick={compare}>
              {comparing ? 'Reading…' : 'See what changed'}
            </button>
          {/if}
          <!-- Both are destructive and each destroys the other side's work, so both say
               so. Reload is the one that used to look free. -->
          <button class="btn btn-sm" class:btn-danger={unsaved}
                  onclick={() => (unsaved ? (confirming = { kind: 'reload' }) : reload())}>
            Reload
          </button>
          <button class="btn btn-sm btn-danger" onclick={() => (confirming = { kind: 'overwrite' })}>
            Overwrite
          </button>
          {#if !conflict}
            <button class="btn btn-ghost btn-sm" onclick={() => (stale = null)}>Later</button>
          {/if}
        </div>
      </div>
    {:else if assigned}
      <p class="notice">
        This file has no <code>id</code> column. Saving adds one, so colours and links
        keep their rows.
      </p>
    {/if}

    <!-- The cell under the cursor, in a box the width of the tool. A cell thirty pixels
         tall is where a value is read; this is where a long one is written.

         Always drawn, empty and all, rather than appearing with the cursor: a bar that
         arrives on the first click pushes the grid down under the pointer, and the drag
         that click started then paints a selection across cells nobody aimed at.

         A textarea rather than a box one line tall, because the cells hold paragraphs and
         the corner pulls the bar as far open as the value needs. Enter commits it — a
         newline is Shift+Enter, as it is in the cell's own editor. -->
    <div class="cell-bar" class:idle={!barColumn}>
      {#if barColumn}
        <span class="cell-bar-where">
          <strong>{shown.indexOf(cursor.row) + 1}</strong>{barColumn}
        </span>
      {/if}
      <textarea class="input cell-bar-box" rows="1" spellcheck="false"
                aria-label="The cell under the cursor"
                placeholder={barColumn ? '' : 'Click a cell'}
                disabled={!barColumn}
                readonly={Boolean(barColumn) && !barWritable}
                title={barLocked}
                value={barValue}
                onfocus={barFocus}
                oninput={(event) => (barDraft = {
                  row: cursor.row, column: cursor.column, value: event.currentTarget.value,
                })}
                onkeydown={onBarKey}
                onblur={() => commitBar()}></textarea>
    </div>

    <div class="grid-panel">
    <div class="grid-wrap" class:dropping
         ondragover={(event) => { event.preventDefault(); dropping = true; }}
         ondragleave={() => (dropping = false)}
         ondrop={onDrop}
         role="presentation">
    <!-- The grid takes the focus itself and says which cell the cursor is on, because the
         keyboard is answered on `window` and the cells are never focused: without this a
         screen reader followed none of it. -->
    <div class="grid" class:tall={meta.tall} id="sheet-grid" role="grid" aria-label="Sheet rows"
         tabindex="0"
         aria-activedescendant={cursor.row === -1
           ? undefined
           : `sheet-cell-${cursor.row}-${cursor.column}`}
         bind:this={scroller}
         onscroll={(event) => {
           scrollTop = event.currentTarget.scrollTop;
           trackScroll();
           followFilter();
           cellMenu = null;
         }}
         bind:clientHeight={viewport}>
      <div class="head" role="row" style="grid-template-columns: {headTemplate}">
        <div class="cell gutter">
          <input type="checkbox" checked={allShownTicked} onchange={toggleAllShown}
                 aria-label="Tick every row shown"
                 title={allShownTicked ? 'Untick these rows' : 'Tick every row shown'} />
        </div>
        {#each drawn as column (column.name)}
          {@const sticky = offsets[column.name]}
          {@const mark = roleMark(column.name)}
          <div class="cell heading" class:sorted={meta.sort?.column === column.name}
               class:asked={isFilterActive(filters[column.name])}
               class:sticky={sticky !== undefined}
               class:dragged={dragColumn?.from === column.index}
               class:target={dragColumn && dragColumn.over === column.index && dragColumn.from !== column.index}
               style={sticky !== undefined ? `left: ${sticky}px` : ''}
               role="columnheader" tabindex="-1"
               aria-sort={meta.sort?.column === column.name
                 ? (meta.sort.desc ? 'descending' : 'ascending')
                 : 'none'}
               oncontextmenu={(event) => openHeadMenu(event, column)}
               onpointerenter={() => dragOver(column.index)}>
            <button class="grip" aria-label="Move {column.name}" title="Drag to move this column"
                    onpointerdown={(event) => grabColumn(event, column.index)}>
              <Icon name="grip" size={11} />
            </button>
            <!-- What the column is, in the heading rather than two clicks away in the
                 panel. A grid where the type is invisible is a grid where a sort that
                 reads dates and a sort that reads words look identical. -->
            {#if mark}
              <span class="role-mark" title="{mark.label}: {column.name}">
                <Icon name={mark.icon} size={11} />
              </span>
            {/if}
            {#if renaming === column.index}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="input heading-rename" autofocus bind:value={renameText}
                     aria-label="Rename {column.name}"
                     onkeydown={(event) => {
                       if (event.key === 'Enter') event.currentTarget.blur();
                       if (event.key === 'Escape') renaming = null;
                     }}
                     onblur={commitHeadingRename} />
            {:else}
              <button class="heading-name" onclick={() => sortBy(column.name)}
                      ondblclick={() => !isKeyColumn(column.index) && renameColumnAt(column.index)}
                      title="Sort by {column.name} · double-click to rename">
                <span>{column.name}</span>
                <!-- The unit where a spreadsheet writes it: beside the name, once. It
                     belongs to every cell of the column, and the file holds the digits
                     alone — repeating it down four hundred rows would be four hundred
                     copies of one fact, in cells thirty pixels tall. -->
                {#if roles[column.name]?.unit}
                  <small class="unit">{roles[column.name].unit}</small>
                {/if}
                {#if meta.sort?.column === column.name}
                  <Icon name={meta.sort.desc ? 'chevronDown' : 'chevronUp'} size={12} />
                {:else if meta.sort?.then?.column === column.name}
                  <!-- Smaller and quieter than the first key, because it is a tiebreak on
                       that key rather than a sort of its own. -->
                  <span class="then-mark" title="Breaks ties on {meta.sort.column}">
                    <Icon name={meta.sort.then.desc ? 'chevronDown' : 'chevronUp'} size={10} />
                  </span>
                {/if}
              </button>
            {/if}
            <!-- The heading's two visible doors. The funnel stays lit whether or not the
                 heading is hovered: hiding the one gesture made a hundred times a day
                 behind a hover is how an analyst concludes a grid cannot filter. -->
            {#if String(column.name).toLowerCase() !== ID_COLUMN}
              <button class="heading-filter" class:asking={isFilterActive(filters[column.name])}
                      bind:this={funnels[column.name]}
                      title={isFilterActive(filters[column.name])
                        ? `Filtered: ${filterSummary(filters[column.name])}`
                        : `Filter ${column.name}`}
                      aria-label="Filter {column.name}"
                      aria-expanded={filterAt?.index === column.index}
                      onclick={(event) => openFilter(event, column)}>
                <Icon name="filter" size={12} />
              </button>
            {/if}
            <!-- What this used to open was the setup panel: 340px of grid, for a role and
                 a note that are declared once. What an analyst wants from a heading all
                 day — insert one beside it, copy it, rename it, split it — had no door at
                 all. So it opens the short list, and that list's last row is the panel. -->
            <button class="heading-menu" title="Column menu"
                    aria-label="What to do with {column.name}"
                    aria-expanded={headMenu?.index === column.index}
                    onclick={(event) => openHeadMenu(event, column)}>
              <Icon name="more" size={15} stroke={2.6} />
            </button>
            <button class="resize" aria-label="Resize {column.name}"
                    onpointerdown={(event) => startResize(event, column.name)}></button>
          </div>
        {/each}
        <button class="cell add-column" title="Add a column" onclick={appendColumn}>
          <Icon name="plus" size={13} />
        </button>
      </div>

      <!-- One row, written once and drawn twice: down the virtualised list, and again
           pinned under the heading. A second copy of a hundred lines of cell reading is
           two grids that disagree by the next change, so it is a snippet. -->
      <!-- `copy` is the pinned drawing of a row that is also down the list. It carries no
           cell ids, because two elements answering to one id is a grid whose cursor a
           screen reader reads twice. -->
      {#snippet bodyRow(rowIndex, number, copy = false)}
        {@const key = rowKey(table.columns, table.rows[rowIndex])}
        <div class="row c-{meta.colours?.[key] ?? 'none'}" class:ticked={picked.has(key)}
             role="row" style="grid-template-columns: {template}; height: {rowH}px">
          <!-- The number, and the tick box in its place on hover or once anything is
               ticked. A gutter that only ever held a checkbox left the analyst with no
               way to say which row they mean out loud, and the key is a handle
               (`r7a3f…`) rather than a position. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cell gutter" class:ticking={picked.size > 0} data-row={rowIndex}
               oncontextmenu={(event) => openRowMenu(event, rowIndex)}>
            <span class="row-number">{number}</span>
            <input type="checkbox" checked={picked.has(key)} aria-label="Tick this row"
                   onclick={(event) => togglePicked(key, event.shiftKey)} />
          </div>
          {#each drawn as column (column.name)}
            {@const linked = linkOf(rowIndex, column.name)}
            {@const sticky = offsets[column.name]}
            {@const links = urlsIn(table.rows[rowIndex][column.index])}
            <!-- Read once and held, rather than once to choose the branch and again inside
                 it: at forty rows by fourteen columns, twice is five hundred readings of a
                 role per frame of scrolling. -->
            {@const chips = chipsFor(rowIndex, column)}
            {@const unit = unitOf(rowIndex, column)}
            <!-- The grid owns the keyboard: arrows move the cursor, Enter opens
                 the editor, and typing a character starts one (`onKey`). A
                 handler per cell would be a second, divergent model. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="cell"
                 id={copy ? undefined : `sheet-cell-${rowIndex}-${column.index}`}
                 class:cursor={cursor.row === rowIndex && cursor.column === column.index}
                 class:picked={hasRange && selectedRows.has(rowIndex) && selectedColumns.has(column.index)}
                 class:sticky={sticky !== undefined}
                 class:key-cell={String(column.name).toLowerCase() === ID_COLUMN}
                 style={sticky !== undefined ? `left: ${sticky}px` : ''}
                 role="gridcell" tabindex="-1"
                 data-row={rowIndex} data-column={column.index}
                 onpointerdown={(event) => startCellDrag(event, rowIndex, column.index)}
                 onpointerenter={() => overCell(rowIndex, column.index)}
                 oncontextmenu={(event) => openCellMenu(event, rowIndex, column)}
                 ondblclick={() => edit(rowIndex, column.index)}>
              {#if editing && editing.row === rowIndex && editing.column === column.index}
                <!-- Read and written by hand rather than bound: committing
                     clears `editing`, and a two-way binding writes back into
                     it on the way out. -->
                <SheetCellEditor
                  value={editing.value}
                  role={roles[column.name]}
                  {column} {table}
                  oninput={(next) => (editing = { ...editing, value: next })}
                  onaddvalue={(word) => addValue(column.name, word)}
                  oncommit={() => commitEdit()} />
              {:else}
                {#if linked}
                  {@const moved = editedSincePromotion(rowIndex, column)}
                  <button class="link-mark" class:moved
                          title={moved ? 'Edited since the case took it' : 'Open this entity'}
                          aria-label="Open the linked entity"
                          onclick={(event) => { event.stopPropagation(); detailsId = linked; }}>
                    <Icon name={moved ? 'alert' : 'link'} size={11} />
                  </button>
                {/if}
                {#if ticked(column)}
                  <!-- A yes/no column drawn as a box, and read the way a box is read:
                       ticked is yes, an empty box is no. The file still holds the two
                       words — a tick is how the cell is *drawn*, not what it is — and
                       the box has a third state because it is drawn on an empty cell
                       too: no answer yet is not the same as no, so it is the same
                       empty box gone faint. -->
                  {@const held = tickState(roles[column.name], table.rows[rowIndex][column.index])}
                  <button class="cell-tick" data-state={held}
                          title="{roles[column.name].values?.[0]} / {roles[column.name].values?.[1]}"
                          aria-label="{column.name}: {held === 'blank' ? 'not answered' : table.rows[rowIndex][column.index]}"
                          onclick={(event) => { event.stopPropagation(); flipCell(rowIndex, column.index); }}>
                    {#if held === 'yes'}<Icon name="check" size={11} stroke={3} />{/if}
                  </button>
                  {#if held === 'other'}
                    <span class="value">{table.rows[rowIndex][column.index]}</span>
                  {/if}
                {:else if chips}
                  <span class="value chips">
                    <!-- Keyed on the position, not the value: a cell may hold the same
                         word twice, and a cell is drawn as what it says. -->
                    {#each chips as chip, at (at)}
                      <button class="cell-chip c-{chip.colour ?? 'none'}"
                              class:unknown={!chip.known} class:tinted={chip.colour}
                              title={chip.known ? chip.value : `${chip.value}, outside this column's words`}
                              onclick={(event) => { event.stopPropagation(); onChipClick(rowIndex, column, chip); }}>
                        {#if chip.count > 1}<b>{chip.count}×</b>{/if}{chip.value}
                      </button>
                    {/each}
                  </span>
                {:else if roles[column.name]?.kind === 'latlon'}
                  {@const point = parseLatLon(table.rows[rowIndex][column.index])}
                  <span class="value">{table.rows[rowIndex][column.index]}</span>
                  {#if point?.outOfBounds}
                    <span class="badge bad" title="Outside the globe">!</span>
                  {:else if !point && table.rows[rowIndex][column.index]}
                    <span class="badge bad" title="Not read as a point">?</span>
                  {:else if point && point.decimals <= 2}
                    <span class="badge" title="About {precisionMetres(point.decimals)} m at {point.decimals} decimals">
                      ±{precisionMetres(point.decimals)}m
                    </span>
                  {/if}
                  {#if point && !point.outOfBounds}
                    <!-- The column's handoff, from the row being read. A worklist is
                         worked row by row, and walking up to the heading to send the
                         whole column over is not what "where is this one" asks. -->
                    <button class="cell-map" title="Show on the map"
                            aria-label="Show this point on the map"
                            onclick={(event) => { event.stopPropagation(); cellToMap(rowIndex, column.index); }}>
                      <Icon name="satellite" size={11} />
                    </button>
                  {/if}
                {:else if roles[column.name]?.kind === 'picture'}
                  {@const shot = pictureRef(table.rows[rowIndex][column.index])}
                  {@const url = shot?.kind === 'case' ? fileUrl(caseId, shot.value) : shot?.value}
                  <!-- A picture the case holds, or an address. The case's own files are why
                       a frame can be dropped on a row: a geolocation index is worked on the
                       images in the case folder, and only a `case` cell stays on the
                       machine. -->
                  {#if url}
                    <a class="cell-shot" href={url} target="_blank" rel="noreferrer noopener"
                       title={shot.value} onclick={(event) => event.stopPropagation()}>
                      <img src={url} alt="" loading="lazy" />
                    </a>
                    <span class="value">
                      {shot.kind === 'case' ? shot.value : linkLabel(shot.value)}
                    </span>
                  {:else}
                    <span class="value">{table.rows[rowIndex][column.index]}</span>
                    {#if table.rows[rowIndex][column.index]}
                      <span class="badge bad" title="Not a case file or an address">?</span>
                    {/if}
                  {/if}
                {:else if unreadable(rowIndex, column)}
                  <!-- Shown as it is, and marked. The value stays — the file keeps the
                       words — but a number column that quietly skipped this cell would
                       be a total the analyst cannot check. -->
                  <span class="value">{table.rows[rowIndex][column.index]}</span>
                  <span class="badge bad"
                        title="Not read as {ROLE_MARKS[roles[column.name].kind].label.toLowerCase()}">?</span>
                {:else if links.length}
                  <!-- A URL is worth opening, and worth reading as its host: a
                       hundred and twenty characters of query string in a cell
                       thirty pixels tall says nothing at all. -->
                  <span class="value">
                    {#each links as url, at (at)}
                      <a class="cell-url" href={url} target="_blank" rel="noreferrer noopener"
                         title={url} onclick={(event) => event.stopPropagation()}>
                        {linkLabel(url)}
                      </a>
                    {/each}
                  </span>
                {:else if unit}
                  <!-- The unit after the number, when the column asked for it there.
                       Beside the value and not in it: the cell holds the digits the
                       file holds, and what is copied out of the grid is the file. -->
                  <span class="value">{table.rows[rowIndex][column.index]}</span>
                  <span class="cell-unit">{unit}</span>
                {:else if query.trim()}
                  <!-- Marked, because a grid that narrows to 23 rows out of 1 204 and
                       leaves the analyst to find the word in each of them has done half
                       the job — often in a column that is off screen. -->
                  <span class="value" class:linked>
                    {#each highlightParts(table.rows[rowIndex][column.index], query) as part, piece (piece)}
                      {#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}
                    {/each}
                  </span>
                {:else}
                  <span class="value" class:linked>{table.rows[rowIndex][column.index]}</span>
                {/if}
                {#if String(column.name).toLowerCase() === ID_COLUMN}
                  <button class="cell-open" title="Open this row"
                          aria-label="Open this row field by field"
                          onclick={(event) => { event.stopPropagation(); showRow(rowIndex); }}>
                    <Icon name="panelRight" size={11} />
                  </button>
                {:else if linkable(column.name) || linked}
                  <!-- Not on every column: a yes/no cell, a date, a number and a value
                       out of a vocabulary are not things the case holds an entity for,
                       and an `@` on them read as an offer to point a status at a
                       person. A cell that already carries a link keeps it either way. -->
                  <button class="cell-link" title={linked ? 'Change the link' : 'Link to an entity'}
                          aria-label="Point this cell at an entity"
                          onclick={(event) => { event.stopPropagation(); openLinkPicker(rowIndex, column.index); }}>@</button>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/snippet}

      <!-- The row the others are read against — the confirmed case, the sample that sets
           the standard — kept under the heading instead of scrolling away at the moment it
           is being compared to. Drawn only while the filter leaves it: a reference the
           count says is not on screen would be the grid disagreeing with itself. -->
      {#if pinnedAt !== -1}
        <div class="pinned" role="presentation" style="top: {HEAD_H}px; height: {rowH}px">
          {@render bodyRow(pinnedAt, matching.indexOf(pinnedAt) + 1, true)}
        </div>
      {/if}

      <!-- One row taller than the sheet, because the last line is a ghost. -->
      <!-- The three wrappers hold the virtual list up and say nothing: without
           `presentation` they sit between the grid and its rows in the accessibility tree,
           which is a grid a screen reader reads as having no rows at all. -->
      <div class="body" role="presentation" style="height: {(shown.length + 1) * rowH}px">
        <div class="rows" role="presentation" style="transform: translateY({first * rowH}px)">
          {#each window_ as rowIndex, at (rowKey(table.columns, table.rows[rowIndex]))}
            {@render bodyRow(rowIndex, first + at + 1)}
          {/each}
        </div>
        <!-- The empty line every spreadsheet ends on: click it or type in it and the row
             exists. Adding a row used to be a trip to a button in the footer, for the most
             ordinary thing a grid does. -->
        <div class="rows ghost" role="presentation"
             style="transform: translateY({shown.length * rowH}px)">
          <div class="row" role="row" style="grid-template-columns: {template}; height: {rowH}px">
            <div class="cell gutter"><Icon name="plus" size={12} /></div>
            {#each drawn as column (column.name)}
              {@const sticky = offsets[column.name]}
              <button class="cell ghost-cell" class:sticky={sticky !== undefined}
                      style={sticky !== undefined ? `left: ${sticky}px` : ''}
                      aria-label="Add a row and write in {column.name}"
                      onclick={() => startGhost(column.index)}></button>
            {/each}
          </div>
        </div>
      </div>

    </div>

    <!-- What can be done to the rows that are chosen, over the grid rather than above it.
         In the question bar these ten controls doubled its width, so ticking a row wrapped
         the bar onto a second line and pushed the table down a row height — under the
         pointer that had just done the ticking. Here nothing moves: the bar is drawn on top
         of the last rows, the way it is wherever a table has a selection. -->
    {#if batchKeys.length}
      <div class="selection" role="toolbar" aria-label="What to do with the chosen rows">
        <!-- One selection, said out loud. Ticking wins where both exist, and the word says
             which of the two these rows came from. -->
        <span class="count">{batchKeys.length} {picked.size ? 'ticked' : 'selected'}</span>
        <div class="selection-rule"></div>
        <button class="btn btn-ghost btn-sm" class:active={Boolean(filling)}
                onclick={() => (filling = filling ? null : { column: firstFillable() })}>
          <Icon name="edit" size={13} /> Fill a column
        </button>
        <!-- One road into the case, where there were four. Each column says what it is —
             a subject, a set of words, a point, addresses, an hour, a name of other rows —
             and the vocabulary says what may join them. -->
        <button class="btn btn-ghost btn-sm" onclick={() => (promoteOpen = true)}>
          <Icon name="graph" size={13} /> To the case
        </button>
        <!-- The one road that fetches bytes, so it is a button of its own and only on a
             sheet that can feed it: two columns of addresses and one of coordinates. -->
        {#if buildable}
          <button class="btn btn-ghost btn-sm" title="Download what these rows point at and compose the proofs"
                  onclick={() => (buildOpen = true)}>
            <Icon name="download" size={13} /> Build proofs
          </button>
        {/if}
        <!-- Up a floor. An inbox, a worklist and a reference table at one schema is what a
             binder is, and copying a row across by hand loses its colour and its links. -->
        <button class="btn btn-ghost btn-sm" onclick={() => (moving = true)}>
          <Icon name="arrowRight" size={13} /> Move
        </button>
        <!-- The handoffs, on the rows that were chosen. A column's own buttons send
             everything on screen, which is the wrong question for an analyst who has just
             ticked eleven candidates out of four hundred. Named like the rest of the bar:
             two lone glyphs among six labels read as a different kind of control. -->
        <button class="btn btn-ghost btn-sm" title="Show these rows on the map"
                onclick={batchToMap}>
          <Icon name="satellite" size={13} /> Map
        </button>
        <button class="btn btn-ghost btn-sm" title="Show these rows on the Timeline"
                onclick={batchToTimeline}>
          <Icon name="clock" size={13} /> Timeline
        </button>
        <div class="swatches">
          {#each ROW_COLOURS as colour (colour)}
            <button class="swatch c-{colour}" title="Paint these rows {colour}"
                    aria-label="Paint these rows {colour}" onclick={() => paint(colour)}></button>
          {/each}
          <button class="swatch none" title="Clear the colour" aria-label="Clear the colour"
                  onclick={() => paint(null)}></button>
        </div>
        <button class="btn btn-sm btn-danger" onclick={askDeleteBatch}>
          <Icon name="trash" size={12} /> Delete
        </button>
        <div class="selection-rule"></div>
        <!-- Escape does this too, and Escape is not on the screen. -->
        <button class="btn btn-ghost btn-sm" title="Drop the selection"
                aria-label="Drop the selection" onclick={dropSelection}>
          <Icon name="x" size={13} />
        </button>
      </div>
    {/if}

    <!-- The grid draws its own bars: the app's chrome is thin everywhere, and on
         Linux the native ones are overlays that fade. Here they are the control. -->
    {#if vThumb}
      <div class="bar vertical" class:held={dragging === 'y'} role="presentation"
           onpointerdown={(event) => pageBy(event, 'y')}>
        <div class="thumb" role="scrollbar" tabindex="-1" aria-label="Scroll the rows"
             aria-controls="sheet-grid" aria-orientation="vertical"
             aria-valuenow={Math.round((extent.top / Math.max(1, vThumb.maxScroll)) * 100)}
             style="top: {vThumb.position}px; height: {vThumb.size}px"
             onpointerdown={(event) => grabThumb(event, 'y')}></div>
      </div>
    {/if}
    {#if hThumb}
      <div class="bar horizontal" class:held={dragging === 'x'} role="presentation"
           onpointerdown={(event) => pageBy(event, 'x')}>
        <div class="thumb" role="scrollbar" tabindex="-1" aria-label="Scroll the columns"
             aria-controls="sheet-grid" aria-orientation="horizontal"
             aria-valuenow={Math.round((extent.left / Math.max(1, hThumb.maxScroll)) * 100)}
             style="left: {hThumb.position}px; width: {hThumb.size}px"
             onpointerdown={(event) => grabThumb(event, 'x')}></div>
      </div>
    {/if}

    <div class="foot">
      <span class="foot-note">{table.columns.length} columns</span>
      {#if hasRange}
        <span class="foot-note">
          {range.rows.length} × {range.columns.length} selected
        </span>
      {/if}
      <!-- What the colours mean, under the rows they are painted on rather than in one
           analyst's head. Only the ones the sheet actually uses: a colour nothing carries
           is not worth naming, and the count is what says so. -->
      {#each legendUsed as entry (entry.colour)}
        <button class="legend-chip" title="Rename the colours"
                onclick={() => (legendOpen = true)}>
          <span class="swatch c-{entry.colour}"></span>
          {entry.label || 'unnamed'}
        </button>
      {/each}
      <div class="spacer"></div>
      <!-- How far along the work is, off whichever column carries it. `23 of 969`
           answers a question nobody asked; the real one is how many are left. -->
      <!-- One answer per number column, the one the column was told to give. `Count 20
           over 2 8–12` was four numbers in a strip nobody could parse, and the reading
           that mattered — that it had only read two cells of fifteen — was the smallest
           of them. Now the answer is chosen and the cells it could not read are a
           button that shows them. -->
      {#each numberFooters as total (total.name)}
        <span class="progress">
          <span class="progress-key">{total.name}</span>
          <!-- Which reading this is, in the strip itself. A bare `52 km over 3` was a
               number whose meaning lived in a panel two clicks away, and a total and an
               average look identical from the footer. -->
          {#if total.summary === 'count'}
            <strong>{total.count}</strong><span>read</span>
          {:else if total.summary === 'mean'}
            <span>average</span>
            <strong>{spellNumber(total.mean, total.unit)}</strong>
            <span>over {total.count}</span>
          {:else if total.summary === 'range'}
            <span>from</span>
            <strong>{spellNumber(total.min, total.unit)}</strong>
            <span>to</span>
            <strong>{spellNumber(total.max, total.unit)}</strong>
          {:else}
            <span>total</span>
            <strong>{spellNumber(total.sum, total.unit)}</strong>
            <span>over {total.count}</span>
          {/if}
          {#if total.unreadable}
            <button class="progress-left"
                    title="Cells that are not numbers"
                    onclick={() => ask(toggleFilterFill(filters, total.name, 'unreadable'))}>
              {total.unreadable} to check
            </button>
          {/if}
        </span>
      {/each}
      {#if progress}
        <span class="progress">
          <span class="progress-key">{meta.progress}</span>
          {#if progress.kind === 'fill'}
            <strong>{progress.filled}</strong> filled ·
            <button class="progress-left" onclick={() => ask(toggleFilterFill(filters, meta.progress, 'blank'))}>
              {progress.empty} left
            </button>
          {:else}
            {#each progress.buckets.filter((bucket) => bucket.count) as bucket (bucket.value)}
              <span><strong>{bucket.count}</strong> {bucket.value}</span>
            {/each}
            {#if progress.other}<span>{progress.other} other</span>{/if}
            {#if progress.empty}
              <button class="progress-left" onclick={() => ask(toggleFilterFill(filters, meta.progress, 'blank'))}>
                {progress.empty} empty
              </button>
            {/if}
          {/if}
        </span>
      {:else if suggestedProgress}
        <button class="suggest-progress" onclick={() => setProgress(suggestedProgress)}>
          <Icon name="chart" size={12} /> Count progress on “{suggestedProgress}”
        </button>
      {/if}
    </div>
    </div>

    <!-- One slot on the right, and the two panels take turns in it: you are either reading
         a row across its fields or working on a column down the rows. Opening one puts the
         other away (`showColumn` / `showRow`), so the slot never has two claims on it —
         and the column panel stays open as the next heading is clicked, which is what
         makes declaring six roles six clicks rather than six trips. -->
    {#if columnPanel !== null && table.columns[columnPanel] !== undefined}
      {@const column = { name: table.columns[columnPanel], index: columnPanel }}
      <SheetColumnPanel
        {table} {meta} {column} filter={filters[column.name]}
        onrename={(name) => applyRename(column.index, name)}
        onfreeze={freezeColumn}
        onclearfilter={() => ask(clearFilter(filters, column.name))}
        onrole={(role) => setRole(column.name, role)}
        onnote={(text) => setNote(column.name, text)}
        onprogress={setProgress}
        onmap={toMap}
        ontimeline={toTimeline}
        onnormalise={normalise}
        onduplicates={showDuplicates}
        onnearby={showNearby}
        onvalue={(value) => ask(onlyFilterValue(filters, column.name, value))}
        ongeocode={(mode) => (geocoding = { index: column.index, mode })}
        oncheck={checkColumnLinks}
        onanchors={() => { columnPanel = null; anchorsOpen = true; }}
        onclose={() => (columnPanel = null)} />
    {:else if rowPanel !== null && table.rows[rowPanel]}
      <SheetRowPanel {table} rowIndex={rowPanel} {linkOf} {roles}
                     rowKey={rowKey(table.columns, table.rows[rowPanel])}
                     attached={rowPieces}
                     pointedBy={rowPointedBy}
                     changes={rowLog.get(rowKey(table.columns, table.rows[rowPanel])) ?? []}
                     onedit={(row, column, value) => {
                       const before = table.rows[row]?.[column];
                       if (before !== value) editCells([{ row, column, before, after: value }]);
                     }}
                     onlink={openLinkPicker}
                     onattach={(key) => (attaching = key)}
                     ondetach={(id) =>
                       detachPiece(rowKey(table.columns, table.rows[rowPanel]), id)}
                     onfindmedia={findRowMedia}
                     onopenentity={(id) => (detailsId = id)}
                     onstep={stepPanel}
                     onclose={() => (rowPanel = null)} />
    {/if}
    </div>
  {/if}
</div>

<!-- Both menus are drawn out here, outside the scroller: inside it, `overflow: auto`
     clips them and the grid's own scrollbars grow to account for a menu. -->
{#if filterAt !== null && table.columns[filterAt.index] !== undefined}
  {@const name = table.columns[filterAt.index]}
  <div bind:this={filterMenu}>
    <SheetFilterMenu
      {table} column={{ name, index: filterAt.index }} role={roles[name]}
      filter={filters[name]} at={filterAt}
      onvalue={(value) => toggleValue(name, value)}
      onfill={(fill) => ask(toggleFilterFill(filters, name, fill))}
      oncontains={(term) => ask(setFilterContains(filters, name, term))}
      onwithout={(term) => ask(setFilterWithout(filters, name, term))}
      onrange={(bounds) => ask(setFilterRange(filters, name, bounds))}
      onclear={() => ask(clearFilter(filters, name))}
      onclose={() => (filterAt = null)} />
  </div>
{/if}

{#if headMenu !== null && table.columns[headMenu.index] !== undefined}
  <!-- The index is read here and not inside the handlers: every row of the menu closes it
       before it acts — a menu left open over the change it made hides it — so a handler
       reaching back for `headMenu.index` would be reading what it has just cleared. -->
  {@const at = headMenu?.index ?? -1}
  {@const name = table.columns[at]}
  <div bind:this={headMenuEl}>
    <SheetHeadingMenu
      column={{ name, index: at }} {meta} at={headMenu}
      onsort={(desc) => sortDirection(name, desc)}
      onsecondsort={() => secondSort(name)}
      onfilter={() => filterColumn(name)}
      oninsert={(side) => addColumnAt(at, side)}
      onduplicate={() => copyColumn(at)}
      onrename={() => renameColumnAt(at)}
      onclean={() => (cleaning = { index: at, mode: 'replace' })}
      onsplit={() => (cleaning = { index: at, mode: 'split' })}
      onfreeze={() => freezeColumn(name)}
      onhide={() => hideColumn(name)}
      ondrop={() => askDropColumn(at)}
      onsetup={() => showColumn(at)}
      onclose={() => (headMenu = null)} />
  </div>
{/if}

{#if rowMenu !== null && table.rows[rowMenu.row]}
  {@const row = rowMenu?.row ?? -1}
  <div bind:this={rowMenuEl}>
    <SheetRowMenu
      at={rowMenu} count={rowMenuCount}
      pinned={meta.pinned === rowKey(table.columns, table.rows[row])}
      onread={() => showRow(row)}
      oninsert={(where) => addRowAt(row, where)}
      onduplicate={() => duplicateBatch(row)}
      onpaint={(colour) => paintRows(row, colour)}
      onpin={() => pinRow(row)}
      onmerge={() => mergeBatch(row)}
      ondelete={() => askDeleteRows(row)}
      onclose={() => (rowMenu = null)} />
  </div>
{/if}

{#if cellMenu}
  {@const values = menuValues(cellMenu)}
  <div class="cell-menu" bind:this={cellMenuEl} role="menu"
       style="left: {cellMenu.x}px; top: {cellMenu.y}px">
    <p class="cell-menu-head">{cellMenu.column}</p>
    {#if values.length}
      {#each values as value (value)}
        <button class="menu-row" role="menuitem"
                onclick={() => { ask(onlyFilterValue(filters, cellMenu.column, value)); cellMenu = null; }}>
          <Icon name="filter" size={12} /><span>Only “{value}”</span>
        </button>
      {/each}
      {#if isFilterActive(filters[cellMenu.column])}
        {#each values as value (value)}
          <button class="menu-row" role="menuitem"
                  onclick={() => { ask(toggleFilterValue(filters, cellMenu.column, value)); cellMenu = null; }}>
            <Icon name="plus" size={12} /><span>Also “{value}”</span>
          </button>
        {/each}
      {/if}
    {:else}
      <button class="menu-row" role="menuitem"
              onclick={() => { ask(toggleFilterFill(filters, cellMenu.column, 'blank')); cellMenu = null; }}>
        <Icon name="filter" size={12} /><span>Only the empty ones</span>
      </button>
    {/if}
    {#if isFilterActive(filters[cellMenu.column])}
      <button class="menu-row" role="menuitem"
              onclick={() => { ask(clearFilter(filters, cellMenu.column)); cellMenu = null; }}>
        <Icon name="x" size={12} /><span>Clear this filter</span>
      </button>
    {/if}
    {#if cellMenu.value}
      <div class="menu-rule"></div>
      <!-- The shape every "to be sorted" inbox arrives in: one row holding five links, or a
           cell reading `Buk-M2E, ZU23-2, S-300` in a worklist that wants a line each. -->
      <button class="menu-row" role="menuitem"
              onclick={() => { const at = cellMenu; cellMenu = null; explodeCell(at.row, at.index); }}>
        <Icon name="stack" size={12} /><span>Split into rows</span>
      </button>
    {/if}
    <button class="menu-row" role="menuitem"
            onclick={() => { const column = cellMenu.column; cellMenu = null; filterColumn(column); }}>
      <Icon name="sliders" size={12} /><span>Filter this column…</span>
    </button>
  </div>
{/if}

{#if creating}
  <Modal title={creating.text === undefined ? 'New sheet' : 'A table as a new sheet'}
         onclose={() => (creating = null)} width="520px">
    <label class="label" for="sheet-title">Name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="sheet-title" class="input" autofocus bind:value={creating.title}
           placeholder="Candidates"
           onkeydown={(event) => event.key === 'Enter' && creating.text === undefined && create()} />
    {#if creating.text === undefined}
      <!-- Columns and what the app should know about them. The four tables an analyst
           rebuilds by hand every case, each one slightly different — which is why two of
           their sheets never compare. Renamed and dropped like any others afterwards. -->
      <p class="label">Start from</p>
      <div class="templates">
        {#each SHEET_TEMPLATES as entry (entry.id)}
          <button class="template" class:on={(creating.template ?? 'blank') === entry.id}
                  onclick={() => (creating = { ...creating, template: entry.id })}>
            <strong>{entry.label}</strong>
            <small>{entry.hint}</small>
          </button>
        {/each}
      </div>
    {/if}
    {#if creating.text !== undefined}
      <label class="label" for="sheet-text">The table</label>
      <textarea id="sheet-text" class="input paste-box" rows="8" bind:value={creating.text}
                placeholder="Paste rows here, or drop a CSV on the grid"></textarea>
      <p class="hint">The delimiter is guessed, and every row is keyed on import.</p>
    {/if}
    <div class="modal-row">
      <div class="spacer"></div>
      <button class="btn" onclick={() => (creating = null)}>Cancel</button>
      <button class="btn btn-primary"
              disabled={!creating.title.trim() || (creating.text !== undefined && !creating.text.trim())}
              onclick={create}>
        {creating.text === undefined ? 'Create' : 'Import'}
      </button>
    </div>
  </Modal>
{/if}

{#if geocoding !== null && table.columns[geocoding.index] !== undefined}
  {@const column = { name: table.columns[geocoding.index], index: geocoding.index }}
  <Modal
    title={geocoding.mode === 'forward'
      ? `Read “${column.name}” into coordinates`
      : `Read “${column.name}” into place names`}
    onclose={() => (geocoding = null)} width="720px">
    <SheetGeocode
      {caseId} sheetId={openId} {table} {meta} {column} mode={geocoding.mode} rows={shown}
      writable={table.columns
        .map((name, index) => ({ name, index }))
        .filter((entry) => writable(entry.name))}
      onedits={(edits, said) => { geocoding = null; cleanCells(edits, said); }}
      onclose={() => (geocoding = null)} />
  </Modal>
{/if}

{#if appending}
  <Modal title="Add rows to this sheet" onclose={() => (appending = false)} width="720px">
    <SheetAppend {caseId} {table} onappend={appendBatch} onclose={() => (appending = false)} />
  </Modal>
{/if}

{#if helpOpen}
  <Modal title="Keys and gestures" onclose={() => (helpOpen = false)} width="760px">
    <SheetHelp onclose={() => (helpOpen = false)} />
  </Modal>
{/if}

{#if destPicker}
  <ExportFolderPicker kind="sheets" current={destination ?? ''}
                      onclose={() => (destPicker = false)}
                      onchosen={(path) => (destination = path)} />
{/if}

{#if cleaning !== null && table.columns[cleaning.index] !== undefined}
  {@const column = { name: table.columns[cleaning.index], index: cleaning.index }}
  <Modal title="Clean up “{column.name}”" onclose={() => (cleaning = null)} width="760px">
    <SheetClean
      {table} {meta} {column} mode={cleaning.mode}
      writable={table.columns
        .map((name, index) => ({ name, index }))
        .filter((entry) => writable(entry.name))}
      rows={shown}
      onedits={cleanCells}
      ontable={cleanTable}
      onclose={() => (cleaning = null)} />
  </Modal>
{/if}

{#if fromCase}
  <Modal title="A sheet out of this case" onclose={() => (fromCase = false)} width="560px">
    <SheetFromCase {caseId} busy={building} onmake={buildFromCase}
                   onclose={() => (fromCase = false)} />
  </Modal>
{/if}

{#if promoteOpen}
  <Modal title="Send these rows to the case" onclose={() => (promoteOpen = false)} width="700px">
    <!-- The word the selection bar uses, carried across: forty rows that turn out to be the
         wrong forty is the one thing this must not do, and "ticked" over a drag is that. -->
    <!-- The sync points open *over* this rather than instead of it: the declaration on
         screen is what sent the analyst there, and an undated shot is the only thing
         standing between its offsets and real hours. -->
    <SheetToCase {table} {meta} count={batchKeys.length} scope={picked.size ? 'ticked' : 'selected'}
                 busy={promoting} onpreview={previewPass} onpass={sendToCase}
                 onanchors={() => (anchorsOpen = true)}
                 onclose={() => (promoteOpen = false)} />
  </Modal>
{/if}

{#if buildOpen}
  <!-- Closing does not abandon the press. The downloads are already happening and what
       they produce still has to reach the sidecar, so the watcher runs on and the screen
       reopens onto the same progress. -->
  <Modal title="Build proofs from these rows" width="700px"
         onclose={() => { buildOpen = false; buildReport = null; }}>
    <SheetBuildProofs {table} {meta} count={batchKeys.length}
                      scope={picked.size ? 'ticked' : 'selected'}
                      busy={Boolean(buildJob)} progress={buildJob?.progress ?? null}
                      report={buildReport}
                      onpreview={previewBuild} onbuild={startBuild} oncancel={stopBuild}
                      onclose={() => { buildOpen = false; buildReport = null; }} />
  </Modal>
{/if}

{#if moving}
  <Modal title="Move these rows" onclose={() => (moving = false)} width="520px">
    <!-- The word the selection bar uses, carried across: the lot is whatever the grid was
         holding, and "ticked" over a drag would be the dialog lying about which. -->
    <SheetMove {sheets} sheetId={openId} columns={table.columns} rows={batchRows}
               scope={picked.size ? 'ticked' : 'selected'}
               busy={promoting} onmove={moveRows} onclose={() => (moving = false)} />
  </Modal>
{/if}

{#if anchorsOpen}
  <Modal title="Sync points" onclose={() => (anchorsOpen = false)} width="560px">
    <SheetAnchors {table} {meta} onchange={setAnchors} onclose={() => (anchorsOpen = false)} />
  </Modal>
{/if}

{#if attaching}
  <Modal title="Attach a case file to this row" onclose={() => (attaching = null)} width="580px">
    <SheetEntityPicker
      {caseId}
      cellText=""
      current={null}
      onpick={(entity) => attachPiece(attaching, entity)}
      onclose={() => (attaching = null)} />
  </Modal>
{/if}

{#if linking}
  <Modal title="Point this cell at an entity" onclose={() => (linking = null)} width="580px">
    <SheetEntityPicker
      {caseId}
      cellText={table.rows[linking.row]?.[linking.column] ?? ''}
      current={linkOf(linking.row, table.columns[linking.column])}
      onpick={attach}
      onclear={() => detach(linking.row, linking.column)}
      onclose={() => (linking = null)} />
  </Modal>
{/if}

{#if confirming?.kind === 'sheet'}
  <ConfirmDialog
    title="Delete this sheet"
    message="The CSV and everything the grid remembers about it go to the trash."
    confirmLabel="Delete"
    onconfirm={remove}
    oncancel={() => (confirming = null)} />
{:else if confirming?.kind === 'column'}
  <!-- What a heading does not show is what the ask is for: the cells go, and so does
       the role, the note and the width, none of which is written in the file. -->
  <ConfirmDialog
    title="Delete “{confirming.name}”"
    message={confirming.filled
      ? `${confirming.filled} ${confirming.filled === 1 ? 'cell has' : 'cells have'} a value.`
      : 'This column is empty.'}
    detail={confirming.role
      ? 'Its type, its words and its note go with it.'
      : ''}
    confirmLabel="Delete the column"
    restorable="Undo puts it back until the sheet is closed."
    onconfirm={() => dropColumn(confirming.index)}
    oncancel={() => (confirming = null)} />
{:else if confirming?.kind === 'reload'}
  <!-- The press that reads as "go back to normal" and is the one that costs the analyst
       their afternoon: it is their own unsaved edits that go, not the file's. -->
  <ConfirmDialog
    title="Read the file and lose your edits"
    message="This grid is holding changes that were never written. Reading the file replaces them with what is on disk."
    detail="Undo cannot bring them back afterwards."
    confirmLabel="Reload"
    onconfirm={() => { confirming = null; reload(); }}
    oncancel={() => (confirming = null)} />
{:else if confirming?.kind === 'overwrite'}
  <ConfirmDialog
    title="Write over the file"
    message="What is on disk was changed outside this grid. Saving replaces it with what is on screen."
    detail="Whoever made those changes loses them."
    confirmLabel="Overwrite"
    onconfirm={() => { confirming = null; save({ force: true }); }}
    oncancel={() => (confirming = null)} />
{:else if confirming?.kind === 'rows'}
  <ConfirmDialog
    title="Delete {confirming.count} {confirming.count === 1 ? 'row' : 'rows'}"
    message="They leave the file, with their colours and their links."
    confirmLabel="Delete"
    restorable="Undo puts them back until the sheet is closed."
    onconfirm={deleteBatch}
    oncancel={() => (confirming = null)} />
{/if}

{#if detailsId}
  <!-- EntityDetails is panel content, not a dialog: it draws no chrome of its own, so
       hosting it bare rendered it into nowhere. Board and Timeline both wrap it. -->
  <Modal title="Details" onclose={closeDetails} width="640px">
    <EntityDetails
      entityId={detailsId}
      bind:dirty={detailsDirty}
      onclose={() => (detailsId = null)}
      ondeleted={() => { detailsId = null; save(); }} />
  </Modal>
{/if}

{#if discarding}
  <ConfirmDialog
    title="Close without saving?"
    message="This entity has unsaved edits."
    confirmLabel="Discard them"
    onconfirm={() => { discarding = false; detailsDirty = false; detailsId = null; }}
    oncancel={() => (discarding = false)} />
{/if}

<style>
  .tool { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .spacer { flex: 1; }
  /* Held at a width, because the four words it cycles through are four lengths: without
     it the whole row of buttons stepped sideways on every save. */
  .save-state {
    flex: none; min-width: 54px; text-align: right;
    font-size: var(--fs-xs); color: var(--text-3);
  }
  .save-state.failed { color: var(--danger); }
  .save-state.saved { color: var(--ok); }

  /* -- popovers ------------------------------------------------------------ */
  /* Each one hangs off a wrapper that also holds its trigger. That is what lets a
     pointer landing outside close it while a pointer on the trigger stays a plain
     toggle — closing on the press and reopening on the click leaves it open. */
  .anchor { position: relative; display: flex; }
  /* A column, so only the list scrolls: the search stays reachable at the top and the
     two actions stay reachable at the bottom however long the list gets. */
  .sheet-menu {
    position: absolute; z-index: 8; top: calc(100% + 4px); left: 0; width: 320px;
    max-height: min(420px, calc(100vh - 140px));
    display: flex; flex-direction: column; overflow: hidden;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
  .sheet-search-row { padding: 6px 6px 2px; }
  .sheet-search-row .input { width: 100%; }
  .sheet-list { flex: 1; min-height: 0; overflow: auto; padding: 6px; }
  .sheet-foot { padding: 5px 6px; border-top: 1px solid var(--border); }
  .sheet-row {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
    gap: 8px; width: 100%; padding: 7px; border-radius: var(--r-sm);
    color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .sheet-row:hover { background: var(--bg-2); color: var(--text-1); }
  .sheet-row.active { color: var(--accent); }
  .sheet-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sheet-row small { color: var(--text-3); font-size: var(--fs-xs); }

  /* -- empty state --------------------------------------------------------- */
  .empty {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; color: var(--text-3);
  }
  .empty p { color: var(--text-2); font-size: var(--fs-md); }
  .empty small { font-size: var(--fs-sm); }
  /* What the grid is for, in the state that has nothing to show. A list without
     bullets: three short lines read as three answers, and the browser's own discs
     and indent read as prose in a panel that is centred. */
  .empty-what {
    display: flex; flex-direction: column; gap: 3px;
    margin: 4px 0 2px; padding: 0; list-style: none; text-align: center;
    color: var(--text-3); font-size: var(--fs-sm);
  }
  .row-actions { display: flex; gap: 8px; margin-top: 6px; }

  /* -- the question bar ---------------------------------------------------- */
  .question {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 7px 16px; border-bottom: 1px solid var(--border);
  }
  .search { display: flex; align-items: center; gap: 6px; color: var(--text-3); }
  .search .input { width: 220px; }
  .count { font-size: var(--fs-sm); color: var(--text-3); }
  .count strong { color: var(--text-1); font-weight: 600; }
  /* The cell under the cursor. Flat against the grid it belongs to — a bar of its own
     chrome above a grid of chrome is two headers — and as short as one line of text,
     since it is drawn whether or not anything is being written in it. */
  .cell-bar {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 3px 16px; border-bottom: 1px solid var(--border); background: var(--bg-1);
  }
  .cell-bar-where {
    display: inline-flex; align-items: baseline; gap: 6px; flex: none;
    min-width: 96px; max-width: 220px; padding-top: 5px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: var(--fs-xs); color: var(--text-3);
  }
  .cell-bar-where strong {
    color: var(--text-2); font-weight: 600; font-variant-numeric: tabular-nums;
  }
  /* One line tall until the corner is pulled, and it stays where it is pulled to: the
     value the analyst is reading is the reason they opened it that far. */
  .cell-bar-box {
    flex: 1; min-width: 0; height: 26px; min-height: 26px; max-height: 40vh;
    padding: 3px 8px; resize: vertical; line-height: 1.5;
    font-family: inherit; white-space: pre-wrap; overflow-y: auto;
  }
  .cell-bar-box[readonly] { color: var(--text-3); }
  /* Nothing picked yet: a line of text at the margin rather than an empty field. A box
     drawn around nothing, with a grab handle on the far end of it, is furniture. */
  .cell-bar-box:disabled {
    background: none; border-color: transparent; resize: none; padding-left: 0;
  }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs);
  }
  .chip:hover { border-color: var(--border-strong); }
  .chip-key { color: var(--text-3); }
  .swatches { display: flex; gap: 4px; }
  .swatch {
    width: 16px; height: 16px; border-radius: var(--r-sm);
    border: 1px solid var(--border-strong); background: var(--mark, var(--bg-3));
  }
  .swatch.none { background: repeating-linear-gradient(45deg, var(--bg-2) 0 3px, var(--bg-3) 3px 6px); }
  /* The same answer to a pointer the gutter menu's swatches give: a colour that does
     not light up under the cursor reads as a legend rather than a button. */
  .swatch:hover { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* The ways a sheet is started. Same drawer the export uses, because they are the same
     kind of thing: a short list of rare presses hanging off one button. */
  .new-menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; width: 240px;
    display: flex; flex-direction: column; gap: 1px;
    padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  .new-menu label.menu-row { cursor: pointer; }

  .export-menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; width: 260px;
    display: flex; flex-direction: column; gap: 1px;
    padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  .export-menu .menu-row {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .export-menu .menu-row:hover:not(:disabled) { background: var(--bg-2); color: var(--text-1); }
  .export-menu .menu-row:disabled { color: var(--text-3); }
  .export-menu .menu-row span {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .export-menu .menu-note {
    padding: 6px 7px 3px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5;
  }
  /* Where the file lands, and the way to send it elsewhere. The path is the one thing
     here that can be arbitrarily long, so it is the part that gives: a folder name that
     overran pushed Change out of a 260px menu. */
  .dest {
    display: flex; align-items: baseline; gap: 6px; padding: 4px 7px;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .dest-path {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-2); font-family: var(--font-mono);
  }

  /* One per table an analyst rebuilds by hand every case. */
  .templates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
  .template {
    display: flex; flex-direction: column; gap: 2px; padding: 7px 9px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); text-align: left;
  }
  .template:hover { border-color: var(--border-strong); }
  .template.on { border-color: var(--accent); background: var(--accent-soft); }
  .template strong { color: var(--text-1); font-size: var(--fs-sm); font-weight: 500; }
  .template small { color: var(--text-3); font-size: var(--fs-xs); }

  .fill-bar {
    display: flex; align-items: center; gap: 8px; padding: 7px 16px;
    border-bottom: 1px solid var(--border); background: var(--bg-1);
  }
  .fill-bar .label { margin: 0; color: var(--text-3); font-size: var(--fs-sm); }
  .fill-bar input { flex: 1; min-width: 160px; }
  .fill-columns { display: flex; flex-wrap: wrap; gap: 4px; }
  .fill-columns .chip.on { border-color: var(--accent); color: var(--accent); }
  /* Past a dozen columns the chips wrap into three rows and push the box that is about to
     be typed in off the bar. A binder is exactly that wide. */
  .fill-pick { flex: none; max-width: 220px; }

  .columns-menu {
    position: absolute; z-index: 8; top: calc(100% + 4px); right: 0; width: 240px;
    max-height: min(380px, calc(100vh - 140px)); overflow: auto;
    display: flex; flex-direction: column; gap: 2px; padding: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
  .column-row {
    display: flex; align-items: center; gap: 7px; padding: 4px 6px;
    border-radius: var(--r-sm); font-size: var(--fs-sm); color: var(--text-2);
  }
  .column-row:hover { background: var(--bg-2); color: var(--text-1); }
  /* A hidden column is still listed — that is the point of the list — but reads as
     put away rather than as one of the columns on screen. */
  .column-row.off .column-name { color: var(--text-3); }
  .column-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .column-kind { display: flex; color: var(--text-3); }
  .column-ask { flex: none; display: flex; padding: 3px; border-radius: var(--r-sm); color: var(--text-3); }
  .column-ask:hover { background: var(--bg-3); color: var(--text-1); }
  .column-ask.on { color: var(--accent); }

  /* -- a cell's own menu --------------------------------------------------- */
  /* At the pointer, outside the scroller, and narrow: it asks one question about the
     value that was right-clicked. */
  .cell-menu {
    position: fixed; z-index: 20; min-width: 200px; max-width: 300px;
    display: flex; flex-direction: column; gap: 1px; padding: 5px;
    border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0005;
  }
  .cell-menu-head {
    padding: 2px 7px 5px; color: var(--text-3); font-size: var(--fs-xs);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .menu-row {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .menu-row:hover { background: var(--bg-2); color: var(--text-1); }
  .menu-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The line between two kinds of row in a menu. Same rule the heading and gutter menus
     draw, so a separator means the same thing wherever one is. */
  .menu-rule { height: 1px; margin: 4px 2px; background: var(--border); }

  .notice {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 6px 16px; font-size: var(--fs-sm); color: var(--text-2);
    background: var(--info-soft); border-bottom: 1px solid var(--border);
  }
  .notice.danger { background: var(--danger-soft); color: var(--text-1); }

  /* What this sheet is for, beside its name. Quiet on purpose: it is read once by
     whoever inherits the case and then it is furniture, so it takes a line and not a
     band. Bounded, because the header carries seven other controls. */
  .describe-input { width: 280px; font-size: var(--fs-sm); }
  .describe-text {
    max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-3); text-align: left; font-size: var(--fs-sm);
  }
  .describe-text:hover { color: var(--text-1); }

  /* A column of row names read as edges. Its own small screen rather than a component,
     because there is one question on it and the answer is a list. */
  .edges { display: flex; flex-direction: column; min-height: 0; }
  .edges-lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .edges-plan {
    max-height: 300px; overflow: auto; margin-top: 12px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .edges-row {
    display: flex; align-items: center; gap: 8px; padding: 4px 7px;
    border-bottom: 1px solid var(--border); font-size: var(--fs-xs);
  }
  .edges-row:last-child { border-bottom: 0; }
  .edges-mark { flex: none; width: 44px; color: var(--text-3); }
  .edges-row.make .edges-mark { color: var(--ok); }
  .edges-row.error .edges-mark { color: var(--danger); }
  .edges-name { color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edges-says { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edges-tally { color: var(--text-3); font-size: var(--fs-xs); }
  .notice code { font-family: var(--font-mono); font-size: 0.92em; }
  /* The file-moved banner is a sentence, a sample of what differs and a row of answers,
     so it stacks instead of running along one line like the other notices. */
  .notice.stacked { flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px 16px; }
  .diff-said { color: var(--text-3); }
  .diff-rows {
    display: flex; flex-direction: column; gap: 2px; max-width: 100%;
    font-size: var(--fs-xs); color: var(--text-2);
  }
  .diff-rows li { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .diff-rows li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .diff-rows em { color: var(--text-3); font-style: italic; }
  /* What the grid holds, struck through: the file's answer is the one being offered. */
  .diff-rows .was { color: var(--text-3); text-decoration: line-through; }
  .notice-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .link:hover { text-decoration: underline; }

  /* -- the grid ------------------------------------------------------------ */
  /* Scrolls both ways. The header, the body and every row are `max-content`
     wide so a table wider than the panel actually scrolls sideways instead of
     squeezing its columns; `min-width: 100%` keeps a narrow one filling the
     panel. Both bars are drawn heavier than the app's default thin ones,
     because here they are how the analyst navigates rather than a hint that
     there is more below. */
  /* The panel is a two-by-two: the scroller, then a strip per bar. A bar that is
     not needed is not rendered and its `auto` track collapses, so a sheet that
     fits gives back the space. */
  .grid-panel { flex: 1; min-height: 0; display: flex; }
  .grid-wrap {
    flex: 1; min-width: 0; min-height: 0; display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr) auto auto;
  }
  .grid-wrap.dropping { outline: 2px dashed var(--accent); outline-offset: -3px; }
  .grid {
    grid-area: 1 / 1; position: relative; min-height: 0; overflow: auto;
    /* The native bars are hidden because the tool draws its own just outside. */
    scrollbar-width: none;
    /* Dragging across cells is how a rectangle is chosen, so the press must not also
       start a text highlight: it painted the headings, the row numbers and whatever
       sat past the table blue, and left that highlight behind as the thing Ctrl+C
       would have taken. Typing gets it back below. */
    user-select: none;
  }
  .grid::-webkit-scrollbar { width: 0; height: 0; }
  /* Where text is being written rather than picked: the cell editor and the boxes the
     grid's own popovers hold. */
  .grid :global(textarea),
  .grid :global(input) { user-select: text; }

  /* Over the last rows, in the scroller's own cell of the panel rather than inside it, so
     it neither scrolls with the table nor pushes it. Centred, because it belongs to the
     rows rather than to either edge. */
  .selection {
    grid-area: 1 / 1; z-index: 6; align-self: end; justify-self: center;
    max-width: calc(100% - 24px); margin-bottom: 12px;
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 5px 8px; border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--bg-1); box-shadow: 0 10px 26px #0006;
  }
  .selection .count { flex: none; padding: 0 3px; }
  .selection-rule { flex: none; width: 1px; height: 18px; background: var(--border); }

  .bar { position: relative; background: var(--bg-0); }
  .bar.vertical { grid-area: 1 / 2; width: 13px; border-left: 1px solid var(--border); }
  .bar.horizontal { grid-area: 2 / 1; height: 13px; border-top: 1px solid var(--border); }
  .bar .thumb { position: absolute; border-radius: 5px; background: var(--border-strong); }
  .bar.vertical .thumb { left: 2px; right: 2px; }
  .bar.horizontal .thumb { top: 2px; bottom: 2px; }
  .bar .thumb:hover { background: var(--border-strong); }
  .bar.held .thumb { background: var(--accent); }
  .head, .row { display: grid; align-items: stretch; width: max-content; min-width: 100%; }
  .head {
    position: sticky; top: 0; z-index: 3; height: 32px;
    background: var(--bg-1); border-bottom: 1px solid var(--border-strong);
  }
  .cell {
    position: relative; display: flex; align-items: center; gap: 4px;
    min-width: 0; padding: 0 8px; border-right: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  /* The tick box and the columns the analyst kept stay put while the table scrolls
     sideways: on a wide comparison grid, losing which row you are on is losing the
     grid. The offsets are computed (`stickyOffsets`), not written here, because a
     column moved by dragging changes them. */
  .cell.gutter {
    position: sticky; left: 0; z-index: 2;
    justify-content: center; padding: 0; background: var(--bg-1);
  }
  /* The row's place on screen, swapped for its tick box on hover or once anything is
     ticked. Two controls in 34 pixels would be neither, and a number is what an analyst
     says out loud — the key is a handle, not a position. */
  .row .cell.gutter .row-number {
    color: var(--text-3); font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
  }
  .row .cell.gutter input[type='checkbox'] { display: none; }
  .row:hover .cell.gutter .row-number,
  .cell.gutter.ticking .row-number { display: none; }
  .row:hover .cell.gutter input[type='checkbox'],
  .cell.gutter.ticking input[type='checkbox'] { display: inline-block; }
  /* Opaque underneath, tinted on top: a sticky cell has to hide the cells sliding
     under it, and a translucent row colour cannot do that on its own. */
  .cell.sticky {
    position: sticky; z-index: 2; background-color: var(--bg-1);
    background-image: linear-gradient(var(--row-tint, transparent), var(--row-tint, transparent));
  }
  .head .cell.heading { padding: 0 2px 0 4px; color: var(--text-2); font-weight: 500; }
  .head .cell.heading.sorted { color: var(--accent); }
  .head .cell.heading.asked { box-shadow: inset 0 -2px 0 var(--accent); }
  .head .cell.heading.dragged { opacity: 0.45; }
  .head .cell.heading.target { box-shadow: inset 2px 0 0 var(--accent); }
  /* The handle is a hover affordance and the settings are not: three controls always
     lit on every heading is a header nobody can read, and the one that has to be
     found without hunting is the menu. */
  .grip {
    display: flex; color: var(--text-3); cursor: grab; padding: 0 1px;
    opacity: 0; transition: opacity 90ms;
  }
  .head .cell.heading:hover .grip { opacity: 1; }
  .grip:hover { color: var(--text-1); }
  /* What the column is, beside its name. Quiet: the type is read once when a column
     is set up and glanced at afterwards, so it sits at the weight of the grip. */
  .role-mark { display: flex; flex: none; color: var(--text-3); }
  .head .cell.heading:hover .role-mark { color: var(--text-2); }
  .heading-name {
    display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;
    height: 100%; color: inherit; font-size: inherit; font-weight: inherit;
  }
  .heading-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The second sort key, marked smaller and fainter than the first: it breaks that key's
     ties, and two chevrons at the same weight would read as two sorts. */
  .then-mark { display: flex; flex: none; color: var(--text-3); }
  /* Quieter than the name: the unit qualifies the column, it does not name it. */
  .heading-name .unit {
    flex: none; color: var(--text-3); font-size: var(--fs-xs); font-weight: 400;
  }
  /* The funnel is quiet at rest and loud when it holds something. Quiet because three
     controls always lit on fourteen headings is a header nobody reads; loud when the
     column is filtered because then it is not decoration — it is where the filter is
     read and taken off, and it says the rows on screen are not all of them. */
  /* Lit at all times, faintly. It used to appear on hover, which meant the one gesture an
     analyst makes a hundred times a day was invisible until the pointer happened to cross
     the heading — and a grid that looks like it cannot filter is a grid nobody filters. */
  .heading-filter {
    display: flex; align-items: center; color: var(--text-3);
    padding: 0 2px; border-radius: var(--r-sm);
    opacity: 0.55; transition: opacity 90ms, color 90ms;
  }
  .head .cell.heading:hover .heading-filter { opacity: 1; }
  .heading-filter:hover { color: var(--accent); background: var(--bg-2); }
  .heading-filter.asking,
  .heading-filter[aria-expanded='true'] { opacity: 1; color: var(--accent); }
  .heading-rename {
    flex: 1; min-width: 0; height: 22px; padding: 0 5px;
    font-size: var(--fs-sm); font-weight: 500;
  }
  .heading-menu {
    display: flex; align-items: center; color: var(--text-2);
    padding: 0 2px; border-radius: var(--r-sm);
  }
  .heading-menu:hover { color: var(--accent); background: var(--bg-2); }
  .heading-menu[aria-expanded='true'] { color: var(--accent); background: var(--bg-2); }
  .resize {
    position: absolute; right: -3px; top: 0; width: 7px; height: 100%;
    cursor: col-resize; background: transparent;
  }
  .resize:hover { background: var(--accent-soft); }
  .add-column {
    display: flex; align-items: center; justify-content: center; width: 34px;
    color: var(--text-3); border-right: 1px solid var(--border);
  }
  .add-column:hover { color: var(--accent); background: var(--bg-2); }

  .body { position: relative; width: max-content; min-width: 100%; }
  /* Both lists are moved with a transform, and a transform is a stacking context: without
     these two, the ghost simply painted last and sat on top of anything a row put over it.
     The list a cell editor's offers belong to has to win — the menu opens downwards, so on
     the last rows of a short sheet it lands right across the empty line, and a click meant
     for a word added a row instead. */
  .rows { position: absolute; top: 0; left: 0; width: 100%; z-index: 1; }
  .rows.ghost { z-index: 0; }
  /* The height is written inline, from the sheet's own answer: a worklist wants thirty
     pixels and the column the reasoning is written in cannot live in one line. */
  /* The colour is a layer over the background rather than the background itself, the way
     a sticky cell already paints. As the background it was replaced by the hover, so
     running the pointer down a painted worklist rubbed out the colour under it — the one
     thing the analyst was reading. */
  .row {
    border-bottom: 1px solid var(--border);
    background-image: linear-gradient(var(--row-tint, transparent), var(--row-tint, transparent));
  }
  .row:hover { background-color: var(--bg-2); }
  /* A tall row is a row with room to read, so its cells stop being one clipped line and
     sit at the top of the space rather than floating in the middle of it. */
  .grid.tall .cell { align-items: flex-start; padding-top: 5px; }
  .grid.tall .cell .value {
    display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 4; line-clamp: 4;
    white-space: pre-wrap; overflow: hidden; text-overflow: clip; line-height: 1.4;
  }
  /* The reference row, held under the heading. Opaque and shadowed because the rows it is
     being compared to slide underneath it. */
  .pinned {
    position: sticky; z-index: 2; width: max-content; min-width: 100%;
    background: var(--bg-1); box-shadow: 0 3px 8px #0003;
  }
  .pinned .row { border-bottom: 1px solid var(--border-strong); }
  /* The empty line the grid always ends on. Faint, because it is an offer rather than a
     row: it holds nothing and counts for nothing until it is typed in. */
  .ghost .row { border-bottom: 1px dashed var(--border); background: none; }
  .ghost .cell.gutter { color: var(--text-3); background: var(--bg-1); }
  .ghost-cell { background: none; }
  .ghost .row:hover .cell.gutter { color: var(--accent); }
  .ghost-cell:hover { background: var(--bg-2); }
  /* Ticking marks the gutter, not the whole row: a row washed in amber hid the
     colour that had just been painted on it, which is the one thing the analyst
     was looking at. The checkbox and the edge say it instead. */
  .row.ticked .cell.gutter { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .row .cell.gutter { border-left: 3px solid var(--mark, transparent); }
  .row .cell.key-cell { color: var(--text-3); font-family: var(--font-mono); font-size: var(--fs-xs); }
  .cell .value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell .value.linked { color: var(--accent); }
  /* A cell of a column that is a set of values, one chip per value. Clicking one filters
     on it: the chip is the answer and the way to ask for more of it. */
  .value.chips { display: flex; align-items: center; gap: 3px; }
  .cell-chip {
    flex: none; max-width: 100%; padding: 1px 6px; border-radius: 9px;
    border: 1px solid var(--border-strong); background: var(--bg-2);
    color: var(--text-1); font-size: var(--fs-xs);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cell-chip:hover { border-color: var(--accent); color: var(--accent); }
  .cell-chip b { color: var(--text-3); font-weight: 600; margin-right: 2px; }
  /* Outside the column's own words. Shown, never hidden: the binders write outside
     their vocabulary on every page, and a lens that hid that would hide the work. */
  .cell-chip.unknown { border-style: dashed; color: var(--text-2); }
  /* A value given a colour in the column's own vocabulary wears it. The `.c-*` classes
     below set `--mark`, so the chip reads in the same palette a row is painted with. */
  .cell-chip.tinted {
    border-color: var(--mark); color: var(--mark);
    background: color-mix(in srgb, var(--mark) 12%, transparent);
  }
  /* A yes/no column drawn as a box, in three states the eye tells apart from a screen
     away: answered yes is ticked, answered no is the empty box, and a cell nobody has
     been through yet is that box faded back. Without that third drawing, four hundred
     unopened rows and four hundred noes look the same. The border is drawn off the
     text ramp rather than off `--border-strong`: an outline the grid's own rules can
     out-shout is an outline the analyst has to hunt for. */
  .cell-tick {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 3px;
    border: 1.5px solid var(--text-3); background: var(--bg-2); color: var(--text-2);
  }
  .cell-tick:hover { border-color: var(--accent); }
  .cell-tick[data-state='yes'] { border-color: var(--ok); background: var(--ok); color: var(--bg-0); }
  .cell-tick[data-state='blank'] { border-width: 1px; border-color: var(--border-strong); background: none; }
  /* A word the column's pair does not hold. Kept and shown beside the box: the file
     keeps the words, and a cell reading `maybe` is a finding, not a mistake. */
  .cell-tick[data-state='other'] { border-style: dashed; border-color: var(--danger); }
  .badge {
    flex: none; padding: 0 4px; border-radius: var(--r-sm);
    background: var(--bg-3); color: var(--text-3); font-size: var(--fs-xs);
  }
  .badge.bad { background: var(--danger-soft); color: var(--danger); font-weight: 600; }
  /* Quieter than the number it follows, in the grid as in the heading: the unit is the
     same word on every row, and reading it at full weight four hundred times is reading
     the column rather than the values. */
  .cell-unit { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
  .cell-url { color: var(--accent); text-decoration: none; margin-right: 8px; }
  .cell-url:hover { text-decoration: underline; }
  .cell.cursor { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cell.picked { background-color: var(--accent-soft); }
  .cell-link, .cell-open, .cell-map {
    opacity: 0; color: var(--text-3); font-weight: 600; padding: 0 2px;
    font-family: var(--font-mono);
  }
  .cell-open, .cell-map { display: flex; flex: none; font-weight: 400; }
  /* Shown on hover, and on the cell under the cursor: reaching a cell by keyboard
     should not hide the things that can be done to it. */
  .cell:hover .cell-link, .cell:hover .cell-open, .cell:hover .cell-map,
  .cell.cursor .cell-link, .cell.cursor .cell-open, .cell.cursor .cell-map { opacity: 1; }
  .cell-link:hover, .cell-open:hover, .cell-map:hover { color: var(--accent); }
  .link-mark { display: flex; color: var(--accent); }
  /* A thumbnail inside a 30px row: enough to tell two photographs apart, and the link is
     the full-size one. Fetched from wherever the cell points, which is why the role says
     so before it is chosen. */
  .cell-shot {
    flex: none; display: flex; width: 34px; height: 22px; overflow: hidden;
    border-radius: 2px; background: var(--bg-3);
  }
  .cell-shot img { width: 100%; height: 100%; object-fit: cover; }
  .cell .value mark {
    background: var(--accent-soft); color: var(--accent); border-radius: 2px;
  }
  /* The row and the case no longer say the same thing. Amber rather than red: it is a
     divergence to settle, not an error. */
  .link-mark.moved { color: var(--warn); }
  /* A strip under the grid rather than a button floating inside it: pinned inside
     the scroller it sat on top of whichever row happened to be at the bottom. */
  .foot {
    grid-area: 3 / 1 / 4 / 3; display: flex; align-items: center; gap: 12px;
    padding: 0 12px; height: 30px;
    background: var(--bg-1); border-top: 1px solid var(--border);
  }
  .foot-note { color: var(--text-3); font-size: var(--fs-xs); }
  /* What a colour means, under the rows carrying it. Pressing one opens the panel that
     names them, so the strip is both the reading and the way to write it. */
  .legend-chip {
    display: flex; align-items: center; gap: 5px;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .legend-chip:hover { color: var(--text-1); }
  .legend-chip .swatch {
    width: 9px; height: 9px; border-radius: 2px;
    border: 1px solid var(--border-strong); background: var(--mark, var(--bg-3));
  }
  .progress { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-3); }
  .progress strong { color: var(--text-1); font-weight: 600; }
  .progress-key { color: var(--text-3); font-style: italic; }
  .progress-left { color: var(--accent); font-size: inherit; }
  .progress-left:hover { text-decoration: underline; }
  .suggest-progress {
    display: flex; align-items: center; gap: 5px; padding: 2px 7px;
    border-radius: var(--r-sm); color: var(--text-3); font-size: var(--fs-xs);
  }
  .suggest-progress:hover { color: var(--accent); background: var(--bg-2); }

  /* A reading over one column — what it repeats, which of its points overlap — as a
     strip under the question rather than a dialog: the answer is meant to be compared
     against the table it came from, which a modal would cover. */
  .reading {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 6px 16px; font-size: var(--fs-sm); color: var(--text-2);
    background: var(--bg-1); border-bottom: 1px solid var(--border);
  }
  .reading strong { color: var(--text-1); }
  .reading em { color: var(--text-3); font-style: italic; }
  .found { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .found .chip small { color: var(--text-3); }

  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .paste-box { width: 100%; font-family: var(--font-mono); font-size: var(--fs-xs); resize: vertical; }
  .hint { color: var(--text-3); font-size: var(--fs-sm); margin-top: 8px; }

  /* The `.c-*` marks live in `app.css`: the grid, the cell editor and the column
     panel all paint with them, and a scoped copy each is three lists that drift. */
</style>
