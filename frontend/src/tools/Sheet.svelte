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
   * No rules live in this file. The table, the selection, the clipboard and the undo
   * stack are all pure modules; what is here is the screen.
   */
  import { untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import { caseState, toast } from '../lib/state.svelte.js';
  import {
    DEFAULT_WIDTH,
    ID_COLUMN,
    ROW_COLOURS,
    addColumn,
    addRow,
    applyEdits,
    cellRange,
    dropChip,
    emptyMeta,
    fillDownEdits,
    fillEdits,
    filterChips,
    isFilterActive,
    keysBetween,
    linkAt,
    linkLabel,
    moveColumn,
    nextSort,
    rangeValues,
    removeColumn,
    removeRows,
    renameColumn,
    rowKey,
    scrollFromThumb,
    scrollThumb,
    setCells,
    setColour,
    setFilterWithout,
    setFrozen,
    setLink,
    setWidth,
    shownKeys,
    stickyOffsets,
    toggleFilterFill,
    toggleFilterValue,
    toggleHidden,
    urlsIn,
    visibleColumns,
    visibleRows,
  } from '../lib/sheet.js';
  import { linkRows, looksLikeLinks, parseBlock, pasteBlock, toBlock } from '../lib/sheetClipboard.js';
  import { cellsEntry, createSheetHistory, snapshotEntry } from '../lib/sheetHistory.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import EntityDetails from '../components/EntityDetails.svelte';
  import SheetColumnMenu from '../components/SheetColumnMenu.svelte';
  import SheetEntityPicker from '../components/SheetEntityPicker.svelte';
  import SheetRowPanel from '../components/SheetRowPanel.svelte';

  /** One row's height, and the reason the grid can hold twenty thousand of them:
   *  only the rows on screen are in the DOM. Fixed, so the arithmetic is one
   *  division — a cell that holds sentences shows one line here and opens into a
   *  box that grows when it is edited. */
  const ROW_H = 30;
  const HEAD_H = 32;
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

  let query = $state('');
  let filters = $state({}); // column -> what is asked of it
  let cursor = $state({ row: -1, column: -1 }); // in table coordinates
  /** The other end of a selected rectangle, in table coordinates. */
  let anchor = $state(null);
  let editing = $state(null); // { row, column, value }
  let picked = $state(new Set()); // row keys ticked in the gutter
  /** The last row ticked by hand, so shift-click knows where the range starts. */
  let lastTicked = $state(null);

  let picker = $state(null); // the sheet menu
  let creating = $state(null); // { title } | { title, text } for an import or a paste
  let confirming = $state(null);
  let detailsId = $state(null); // an entity opened from a linked cell
  let detailsDirty = $state(false); // Details holds edits its own Save has not taken
  let discarding = $state(false); // asking before those edits are thrown away
  let linking = $state(null); // { row, column }
  let rowPanel = $state(null); // a row read down instead of across, by table index
  let menuFor = $state(null); // a column heading's menu, by index
  let columnsOpen = $state(false);
  let filling = $state(null); // { column } while a column is filled in bulk
  /** The answer being written, kept beside `filling` rather than inside it: an input
   *  bound into an object still reads it once as the object is cleared away. */
  let fillValue = $state('');
  let dragColumn = $state(null); // { from, over } while a heading is dragged
  let dropping = $state(false); // a file is over the grid
  // Each popover's own wrapper, holding both its trigger and its panel. Bound so a
  // pointer landing outside closes it — and so a pointer on the trigger does not,
  // which would close and reopen it in one click.
  let pickerAnchor = $state(null);
  let columnsAnchor = $state(null);
  let columnMenuAnchor = $state(null);

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
  const shown = $derived(visibleRows(table, { query, filters, sort: meta.sort }));
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
  const template = $derived(
    ['34px', ...drawn.map((column) => `${meta.widths?.[column.name] ?? DEFAULT_WIDTH}px`)].join(' '),
  );
  /** The heading row carries one track more than a body row: the button that adds
   *  a column. Without it that button falls onto an implicit second row. */
  const headTemplate = $derived(`${template} 34px`);
  const hThumb = $derived(scrollThumb(extent.clientW, extent.scrollW, extent.left));
  const vThumb = $derived(scrollThumb(extent.clientH, extent.scrollH, extent.top));
  const first = $derived(Math.max(0, Math.floor((scrollTop - HEAD_H) / ROW_H) - OVERSCAN));
  const last = $derived(
    Math.min(shown.length, Math.ceil((scrollTop - HEAD_H + viewport) / ROW_H) + OVERSCAN),
  );
  const window_ = $derived(shown.slice(first, Math.max(first, last)));

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
      if (!openId && sheets.length) open(sheets[0].id);
    } catch {
      sheets = [];
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
    saveState = 'idle';
    if (reset) {
      resetView();
      history.reset();
      canUndo = false;
      canRedo = false;
    }
  }

  function close() {
    openId = null;
    table = { columns: [], rows: [] };
    meta = emptyMeta();
    stamp = '';
    conflict = false;
    resetView();
  }

  function resetView() {
    query = '';
    filters = {};
    cursor = { row: -1, column: -1 };
    anchor = null;
    editing = null;
    picked = new Set();
    lastTicked = null;
    rowPanel = null;
    filling = null;
    if (scroller) scroller.scrollTop = 0;
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
   *  retrying behind them would be a queue of refusals. */
  function touch() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
    saveState = 'dirty';
    clearTimeout(saveTimer);
    if (!conflict) saveTimer = setTimeout(save, 900);
  }

  /** Record a run of cell edits and apply them. The common path, and the cheap one:
   *  what is kept is the cells, not the table. */
  function editCells(edits) {
    if (!edits?.length) return;
    table = applyEdits(table, edits, 'forward');
    history.record(cellsEntry(edits));
    touch();
  }

  /** Record a change no list of cells describes — a column added, moved or dropped,
   *  rows deleted, a paste that grew the sheet — by keeping the table on both sides.
   *  `withTable: false` is for a change that only touches the sidecar, which is
   *  kilobytes rather than megabytes on a long sheet. */
  function structural(change, { withTable = true } = {}) {
    const before = snapshot({ withTable });
    change();
    history.record(snapshotEntry(before, snapshot({ withTable })));
    touch();
  }

  async function save({ force = false } = {}) {
    clearTimeout(saveTimer);
    if (!openId || !caseId) return;
    const id = openId;
    saveState = 'saving';
    try {
      const saved = await api.put(`/api/cases/${caseId}/sheets/${id}`, {
        columns: table.columns,
        rows: table.rows,
        meta,
        // Forcing is the analyst answering the banner: write over what is there.
        ...(force ? {} : { stamp }),
      });
      if (openId !== id) return; // the analyst moved on while this was in flight
      // The server is the one that cleans the sidecar, so what comes back is what
      // the case holds; adopting it is how a stale colour stops being drawn.
      meta = { ...emptyMeta(), ...(saved.meta ?? {}) };
      table = { columns: saved.columns, rows: saved.rows };
      stamp = saved.stamp ?? '';
      assigned = false;
      conflict = false;
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

  $effect(() => () => clearTimeout(saveTimer));

  // -- the sheet list --------------------------------------------------------

  async function create() {
    const name = (creating?.title ?? '').trim();
    if (!name) return;
    const body = creating.text === undefined ? { title: name } : { title: name, text: creating.text };
    const route = creating.text === undefined ? 'sheets' : 'sheets/import';
    try {
      const sheet = await api.post(`/api/cases/${caseId}/${route}`, body);
      creating = null;
      await list(caseId);
      openId = null;
      await open(sheet.id);
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

  /** A dropped or picked file becomes a new sheet, named after itself. The text goes
   *  to the import route: the delimiter is guessed on the side that writes the file
   *  back, so a semicolon export and a tab export both land. */
  function importFile(files) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      creating = { title: file.name.replace(/\.[^.]+$/, ''), text: String(reader.result ?? '') };
    };
    reader.readAsText(file);
  }

  function onDrop(event) {
    event.preventDefault();
    dropping = false;
    importFile(event.dataTransfer?.files);
  }

  // -- edits -----------------------------------------------------------------

  function edit(row, column) {
    cursor = { row, column };
    anchor = { row, column };
    editing = { row, column, value: table.rows[row]?.[column] ?? '' };
  }

  function commitEdit(move = null) {
    if (!editing) return;
    const { row, column, value } = editing;
    editing = null;
    const before = table.rows[row]?.[column];
    if (before !== value) editCells([{ row, column, before, after: value }]);
    if (move) step(move);
  }

  /** Move the cursor by one cell, in display order rather than file order. */
  function step(direction, { extend = false } = {}) {
    const at = shown.indexOf(cursor.row);
    const columns = drawn.map((column) => column.index);
    const column = columns.indexOf(cursor.column);
    let next = cursor;
    if (direction === 'down' && at < shown.length - 1) next = { ...cursor, row: shown[at + 1] };
    if (direction === 'up' && at > 0) next = { ...cursor, row: shown[at - 1] };
    if (direction === 'right' && column < columns.length - 1)
      next = { ...cursor, column: columns[column + 1] };
    if (direction === 'left' && column > 0) next = { ...cursor, column: columns[column - 1] };
    cursor = next;
    if (!extend) anchor = { ...next };
    scrollIntoView();
  }

  function scrollIntoView() {
    const at = shown.indexOf(cursor.row);
    if (at === -1 || !scroller) return;
    const top = HEAD_H + at * ROW_H;
    if (top < scroller.scrollTop + HEAD_H) scroller.scrollTop = top - HEAD_H;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = top + ROW_H - scroller.clientHeight;
  }

  /** Click a cell: the cursor, and the anchor a range would start from. */
  function pointAt(row, column, extend = false) {
    cursor = { row, column };
    if (!extend || !anchor) anchor = { row, column };
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
    columnsOpen = false;
    menuFor = null;
    filling = null;
    fillValue = '';
    rowPanel = null;
  }

  const somethingOpen = $derived(
    Boolean(picker) || columnsOpen || menuFor !== null || Boolean(filling) || rowPanel !== null,
  );

  // A pointer outside a popover closes it. The bound element wraps the trigger too,
  // so clicking the trigger stays a plain toggle.
  $effect(() => (picker ? closeOnOutsidePointer(pickerAnchor, () => (picker = null)) : undefined));
  $effect(() =>
    columnsOpen ? closeOnOutsidePointer(columnsAnchor, () => (columnsOpen = false)) : undefined,
  );
  $effect(() =>
    menuFor !== null
      ? closeOnOutsidePointer(columnMenuAnchor, () => (menuFor = null))
      : undefined,
  );

  function onKey(event) {
    if (creating || confirming || detailsId || linking || discarding) return;
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
        commitEdit(event.shiftKey ? 'left' : 'right');
      }
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
    if (event.key === 'Enter') {
      event.preventDefault();
      edit(cursor.row, cursor.column);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      step(event.shiftKey ? 'left' : 'right');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      clearSelection();
      return;
    }
    // Typing a printable character starts an edit on that character, the way a
    // grid is expected to behave.
    if (event.key.length === 1 && !meta_ && !isKeyColumn(cursor.column)) {
      event.preventDefault();
      editing = { row: cursor.row, column: cursor.column, value: event.key };
    }
  }

  function isKeyColumn(index) {
    return String(table.columns[index] ?? '').toLowerCase() === ID_COLUMN;
  }

  // -- the clipboard ---------------------------------------------------------

  /** Copy the selected rectangle as a block a spreadsheet will read back. */
  function onCopy(event) {
    if (!openId || inAField(event.target) || editing || cursor.row === -1) return;
    const block = toBlock(rangeValues(table, range));
    if (!block) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', block);
  }

  /**
   * Paste a block into the sheet, from the cursor.
   *
   * A wall of links with no tabs is the "to be sorted" inbox every field binder
   * keeps, so it becomes one row per link rather than one cell holding forty. Any
   * other block is a table, and lands as a rectangle from where the cursor is.
   */
  function onPaste(event) {
    if (!openId || inAField(event.target) || editing) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;
    event.preventDefault();
    const block = looksLikeLinks(text) ? linkRows(text) : parseBlock(text);
    if (!block.length) return;
    const at = {
      row: cursor.row === -1 ? 0 : cursor.row,
      column: cursor.column === -1 ? firstWritableColumn() : cursor.column,
    };
    let landed = null;
    structural(() => {
      landed = pasteBlock(table, block, at);
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

  /** Which column a bulk fill offers first. The same rule, by name: the handle is
   *  not on offer, so the picker never opens on a column that refuses to be written. */
  function firstFillable() {
    return table.columns.find((name) => String(name).toLowerCase() !== ID_COLUMN) ?? '';
  }

  // -- filling ---------------------------------------------------------------

  /** Empty every selected cell. One step in the undo stack, not one per cell. */
  function clearSelection() {
    editCells(range.columns.flatMap((column) => fillEdits(table, column, range.rows, '')));
  }

  function fillDown() {
    editCells(fillDownEdits(table, range));
  }

  /** Write one answer into one column for every ticked row. The worklist gesture:
   *  forty rows checked in one pass, then all forty marked at once. */
  function applyFill() {
    const columnIndex = table.columns.indexOf(filling?.column);
    const rows = table.rows
      .map((row, index) => index)
      .filter((index) => picked.has(rowKey(table.columns, table.rows[index])));
    if (columnIndex !== -1) editCells(fillEdits(table, columnIndex, rows, fillValue));
    filling = null;
    fillValue = '';
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

  function appendRow() {
    structural(() => {
      table = addRow(table);
    });
    cursor = { row: table.rows.length - 1, column: firstWritableColumn() };
    anchor = { ...cursor };
    scrollIntoView();
  }

  function deletePicked() {
    const indices = table.rows
      .map((row, index) => index)
      .filter((index) => picked.has(rowKey(table.columns, table.rows[index])));
    structural(() => {
      table = removeRows(table, indices);
    });
    picked = new Set();
    lastTicked = null;
    rowPanel = null;
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

  function paint(colour) {
    structural(
      () => {
        let next = meta;
        for (const key of picked) next = setColour(next, key, colour);
        meta = next;
      },
      { withTable: false },
    );
  }

  function appendColumn() {
    structural(() => {
      table = addColumn(table, 'Column');
    });
    menuFor = table.columns.length - 1;
  }

  function applyRename(index, name) {
    if (String(name ?? '').trim() === table.columns[index]) return;
    structural(() => {
      const moved = renameColumn(table, meta, index, name);
      table = moved.table;
      meta = moved.meta;
    });
  }

  function dropColumn(index) {
    menuFor = null;
    structural(() => {
      const moved = removeColumn(table, meta, index);
      table = moved.table;
      meta = moved.meta;
    });
  }

  function sortBy(name) {
    structural(
      () => {
        meta = { ...meta, sort: nextSort(meta.sort, name) };
      },
      { withTable: false },
    );
  }

  function hideColumn(name) {
    menuFor = null;
    structural(
      () => {
        meta = toggleHidden(meta, name);
      },
      { withTable: false },
    );
  }

  function freezeColumn(name) {
    menuFor = null;
    structural(
      () => {
        meta = setFrozen(meta, name);
      },
      { withTable: false },
    );
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

  function toggleValue(column, value) {
    filters = toggleFilterValue(filters, column, value);
  }

  // -- the grid's own scrollbars ---------------------------------------------

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

  function linkOf(rowIndex, columnName) {
    return linkAt(meta, rowKey(table.columns, table.rows[rowIndex]), columnName);
  }

  /** Escape and the backdrop both close a modal, and the Details panel's fields wait
   *  for its own Save: closing over half-typed edits threw them away without a word.
   *  The ask is only raised when there is something to lose. */
  function closeDetails() {
    if (detailsDirty) discarding = true;
    else detailsId = null;
  }

  /** The row panel walks the rows the analyst can see, not the file's own order. */
  function stepPanel(by) {
    const at = shown.indexOf(rowPanel);
    if (at === -1) return;
    const next = shown[at + by];
    if (next !== undefined) rowPanel = next;
  }

  const saveWord = $derived(
    { idle: '', dirty: 'Unsaved', saving: 'Saving', saved: 'Saved', failed: 'Not saved' }[saveState],
  );
</script>

<svelte:window onkeydown={onKey} oncopy={onCopy} onpaste={onPaste} />

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
      <div class="anchor" bind:this={pickerAnchor}>
        <button class="btn btn-ghost btn-sm" aria-expanded={Boolean(picker)}
                onclick={() => (picker = picker ? null : 'list')}>
          {sheets.length} in this case <Icon name="chevronDown" size={13} />
        </button>
        {#if picker}
          <div class="sheet-menu">
            {#each sheets as sheet (sheet.id)}
              <button class="sheet-row" class:active={sheet.id === openId}
                      onclick={() => open(sheet.id)}>
                <Icon name="table" size={13} />
                <span>{sheet.title}</span>
                <small>{sheet.rows} rows · {sheet.columns} columns</small>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="spacer"></div>
    {#if saveWord}<span class="save-state {saveState}">{saveWord}</span>{/if}
    <button class="btn btn-sm" onclick={() => (creating = { title: '' })}>
      <Icon name="plus" size={13} /> New
    </button>
    <label class="btn btn-sm">
      <Icon name="upload" size={13} /> Import
      <input type="file" accept=".csv,.tsv,text/csv,text/plain" hidden
             onchange={(event) => { importFile(event.currentTarget.files); event.currentTarget.value = ''; }} />
    </label>
    <button class="btn btn-sm" title="Paste a table as a new sheet"
            onclick={() => (creating = { title: '', text: '' })}>
      <Icon name="copy" size={13} /> Paste
    </button>
    {#if openId}
      <button class="btn btn-sm btn-danger" title="Delete this sheet"
              onclick={() => (confirming = true)}>
        <Icon name="trash" size={13} />
      </button>
    {/if}
  </header>

  {#if !openId}
    <div class="empty">
      {#if loading}
        <p>Opening.</p>
      {:else}
        <Icon name="table" size={30} />
        <p>No sheet in this case.</p>
        <small>A sheet is a CSV in the case folder. Build one, or bring one in.</small>
        <div class="row-actions">
          <button class="btn btn-primary btn-sm" onclick={() => (creating = { title: '' })}>
            New sheet
          </button>
          <label class="btn btn-sm">
            Import CSV
            <input type="file" accept=".csv,.tsv,text/csv,text/plain" hidden
                   onchange={(event) => { importFile(event.currentTarget.files); event.currentTarget.value = ''; }} />
          </label>
          <button class="btn btn-sm" onclick={() => (creating = { title: '', text: '' })}>
            Paste a table
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="question">
      <div class="search">
        <Icon name="search" size={13} />
        <input class="input" placeholder="Search these rows" bind:this={searchBox}
               bind:value={query} />
      </div>
      {#each chips as chip (chip.column + chip.part + chip.value)}
        <button class="chip" onclick={() => (filters = dropChip(filters, chip))}>
          <span class="chip-key">{chip.column}</span>
          {chip.label}
          <Icon name="x" size={11} />
        </button>
      {/each}
      <span class="count">
        <strong>{shown.length}</strong> of {table.rows.length}
      </span>
      <div class="spacer"></div>
      {#if picked.size}
        <span class="count">{picked.size} ticked</span>
        <button class="btn btn-ghost btn-sm" class:active={Boolean(filling)}
                onclick={() => (filling = filling ? null : { column: firstFillable() })}>
          <Icon name="edit" size={13} /> Fill a column
        </button>
        <div class="swatches">
          {#each ROW_COLOURS as colour (colour)}
            <button class="swatch c-{colour}" title="Paint these rows {colour}"
                    aria-label="Paint these rows {colour}" onclick={() => paint(colour)}></button>
          {/each}
          <button class="swatch none" title="Clear the colour" aria-label="Clear the colour"
                  onclick={() => paint(null)}></button>
        </div>
        <button class="btn btn-sm btn-danger" onclick={deletePicked}>
          <Icon name="trash" size={12} /> Delete
        </button>
      {/if}
      <button class="btn btn-ghost btn-sm" title="Undo" disabled={!canUndo} onclick={undo}>
        <Icon name="undo" size={13} />
      </button>
      <button class="btn btn-ghost btn-sm" title="Redo" disabled={!canRedo} onclick={redo}>
        <Icon name="redo" size={13} />
      </button>
      <div class="anchor" bind:this={columnsAnchor}>
        <button class="btn btn-ghost btn-sm" class:active={columnsOpen}
                aria-expanded={columnsOpen} onclick={() => (columnsOpen = !columnsOpen)}>
          <Icon name="layers" size={13} /> Columns
        </button>
        {#if columnsOpen}
          <div class="columns-menu">
            {#each table.columns as name (name)}
              {#if String(name).toLowerCase() !== ID_COLUMN}
                <label class="column-toggle">
                  <input type="checkbox" checked={!meta.hidden?.includes(name)}
                         onchange={() => hideColumn(name)} />
                  <span>{name}</span>
                </label>
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
        <div class="fill-columns">
          {#each table.columns as name (name)}
            {#if String(name).toLowerCase() !== ID_COLUMN}
              <button class="chip" class:on={filling.column === name}
                      onclick={() => (filling = { column: name })}>{name}</button>
            {/if}
          {/each}
        </div>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" autofocus aria-label="What to write into {filling.column}"
               placeholder="to this, on the {picked.size} ticked rows"
               bind:value={fillValue}
               onkeydown={(event) => event.key === 'Enter' && applyFill()} />
        <button class="btn btn-sm" onclick={() => (filling = null)}>Cancel</button>
        <button class="btn btn-primary btn-sm" onclick={applyFill}>Fill</button>
      </div>
    {/if}

    {#if conflict}
      <p class="notice danger" role="alert">
        This file changed on disk since it was opened. Reload it, or write over what is
        there.
        <button class="btn btn-sm" onclick={reload}>Reload</button>
        <button class="btn btn-sm btn-danger" onclick={() => save({ force: true })}>
          Overwrite
        </button>
      </p>
    {:else if assigned}
      <p class="notice">
        This file has no <code>id</code> column. Saving adds one, so colours and links
        keep their rows.
      </p>
    {/if}

    <div class="grid-panel">
    <div class="grid-wrap" class:dropping
         ondragover={(event) => { event.preventDefault(); dropping = true; }}
         ondragleave={() => (dropping = false)}
         ondrop={onDrop}
         role="presentation">
    <div class="grid" id="sheet-grid" role="grid" aria-label="Sheet rows" bind:this={scroller}
         onscroll={(event) => { scrollTop = event.currentTarget.scrollTop; measure(); }}
         bind:clientHeight={viewport}>
      <div class="head" role="row" style="grid-template-columns: {headTemplate}">
        <div class="cell gutter">
          <input type="checkbox" checked={allShownTicked} onchange={toggleAllShown}
                 aria-label="Tick every row shown"
                 title={allShownTicked ? 'Untick these rows' : 'Tick every row shown'} />
        </div>
        {#each drawn as column (column.name)}
          {@const sticky = offsets[column.name]}
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
               onpointerenter={() => dragOver(column.index)}>
            <button class="grip" aria-label="Move {column.name}" title="Drag to move this column"
                    onpointerdown={(event) => grabColumn(event, column.index)}>
              <Icon name="grip" size={11} />
            </button>
            <button class="heading-name" onclick={() => sortBy(column.name)} title="Sort by {column.name}">
              <span>{column.name}</span>
              {#if meta.sort?.column === column.name}
                <Icon name={meta.sort.desc ? 'chevronDown' : 'chevronUp'} size={12} />
              {/if}
            </button>
            <button class="heading-menu" title="Column options"
                    aria-label="Options for {column.name}"
                    aria-expanded={menuFor === column.index}
                    onclick={(event) => {
                      if (menuFor === column.index) { menuFor = null; return; }
                      // The heading holds both this button and the menu, so a click
                      // on the button is inside and stays a plain toggle.
                      columnMenuAnchor = event.currentTarget.closest('.heading');
                      menuFor = column.index;
                    }}>
              <Icon name="more" size={15} stroke={2.6} />
            </button>
            <button class="resize" aria-label="Resize {column.name}"
                    onpointerdown={(event) => startResize(event, column.name)}></button>

            {#if menuFor === column.index}
              <SheetColumnMenu
                {table} {meta} {column} filter={filters[column.name]}
                onrename={(name) => applyRename(column.index, name)}
                ondrop={() => dropColumn(column.index)}
                onhide={() => hideColumn(column.name)}
                onfreeze={freezeColumn}
                onvalue={(value) => toggleValue(column.name, value)}
                onfill={(fill) => (filters = toggleFilterFill(filters, column.name, fill))}
                onwithout={(term) => (filters = setFilterWithout(filters, column.name, term))}
                onclose={() => (menuFor = null)} />
            {/if}
          </div>
        {/each}
        <button class="cell add-column" title="Add a column" onclick={appendColumn}>
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div class="body" style="height: {shown.length * ROW_H}px">
        <div class="rows" style="transform: translateY({first * ROW_H}px)">
          {#each window_ as rowIndex (rowKey(table.columns, table.rows[rowIndex]))}
            {@const key = rowKey(table.columns, table.rows[rowIndex])}
            <div class="row c-{meta.colours?.[key] ?? 'none'}" class:ticked={picked.has(key)}
                 role="row" style="grid-template-columns: {template}">
              <div class="cell gutter">
                <input type="checkbox" checked={picked.has(key)} aria-label="Tick this row"
                       onclick={(event) => togglePicked(key, event.shiftKey)} />
              </div>
              {#each drawn as column (column.name)}
                {@const linked = linkOf(rowIndex, column.name)}
                {@const sticky = offsets[column.name]}
                {@const links = urlsIn(table.rows[rowIndex][column.index])}
                <!-- The grid owns the keyboard: arrows move the cursor, Enter opens
                     the editor, and typing a character starts one (`onKey`). A
                     handler per cell would be a second, divergent model. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="cell"
                     class:cursor={cursor.row === rowIndex && cursor.column === column.index}
                     class:picked={hasRange && selectedRows.has(rowIndex) && selectedColumns.has(column.index)}
                     class:sticky={sticky !== undefined}
                     class:key-cell={String(column.name).toLowerCase() === ID_COLUMN}
                     style={sticky !== undefined ? `left: ${sticky}px` : ''}
                     role="gridcell" tabindex="-1"
                     onclick={(event) => pointAt(rowIndex, column.index, event.shiftKey)}
                     ondblclick={() => !isKeyColumn(column.index) && edit(rowIndex, column.index)}>
                  {#if editing && editing.row === rowIndex && editing.column === column.index}
                    <!-- Read and written by hand rather than bound: committing
                         clears `editing`, and a two-way binding writes back into
                         it on the way out. -->
                    <!-- svelte-ignore a11y_autofocus -->
                    <textarea class="editor" autofocus value={editing.value}
                              oninput={(event) => (editing = { ...editing, value: event.currentTarget.value })}
                              onblur={() => commitEdit()}></textarea>
                  {:else}
                    {#if linked}
                      <button class="link-mark" title="Open this entity"
                              aria-label="Open the entity this cell points at"
                              onclick={(event) => { event.stopPropagation(); detailsId = linked; }}>
                        <Icon name="link" size={11} />
                      </button>
                    {/if}
                    {#if links.length}
                      <!-- A URL is worth opening, and worth reading as its host: a
                           hundred and twenty characters of query string in a cell
                           thirty pixels tall says nothing at all. -->
                      <span class="value">
                        {#each links as url (url)}
                          <a class="cell-url" href={url} target="_blank" rel="noreferrer noopener"
                             title={url} onclick={(event) => event.stopPropagation()}>
                            {linkLabel(url)}
                          </a>
                        {/each}
                      </span>
                    {:else}
                      <span class="value" class:linked>{table.rows[rowIndex][column.index]}</span>
                    {/if}
                    {#if String(column.name).toLowerCase() === ID_COLUMN}
                      <button class="cell-open" title="Read this row field by field"
                              aria-label="Read this row field by field"
                              onclick={(event) => { event.stopPropagation(); rowPanel = rowIndex; }}>
                        <Icon name="panelRight" size={11} />
                      </button>
                    {:else}
                      <button class="cell-link" title={linked ? 'Change what this cell points at' : 'Point this cell at an entity'}
                              aria-label="Point this cell at an entity"
                              onclick={(event) => { event.stopPropagation(); openLinkPicker(rowIndex, column.index); }}>@</button>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>

    </div>

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
      <button class="add-row" onclick={appendRow}>
        <Icon name="plus" size={13} /> Row
      </button>
      <span class="foot-note">{table.columns.length} columns</span>
      {#if hasRange}
        <span class="foot-note">
          {range.rows.length} × {range.columns.length} selected
        </span>
      {/if}
    </div>
    </div>

    {#if rowPanel !== null && table.rows[rowPanel]}
      <SheetRowPanel {table} rowIndex={rowPanel} {linkOf}
                     onedit={(row, column, value) => {
                       const before = table.rows[row]?.[column];
                       if (before !== value) editCells([{ row, column, before, after: value }]);
                     }}
                     onlink={openLinkPicker}
                     onopenentity={(id) => (detailsId = id)}
                     onstep={stepPanel}
                     onclose={() => (rowPanel = null)} />
    {/if}
    </div>
  {/if}
</div>

{#if creating}
  <Modal title={creating.text === undefined ? 'New sheet' : 'A table as a new sheet'}
         onclose={() => (creating = null)} width="520px">
    <label class="label" for="sheet-title">Name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="sheet-title" class="input" autofocus bind:value={creating.title}
           placeholder="Candidates"
           onkeydown={(event) => event.key === 'Enter' && creating.text === undefined && create()} />
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

{#if confirming}
  <ConfirmDialog
    title="Delete this sheet"
    message="Its table and everything the grid remembers about it go to the trash."
    confirmLabel="Delete"
    onconfirm={remove}
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
    message="This entity has edits its own Save has not taken."
    confirmLabel="Discard them"
    onconfirm={() => { discarding = false; detailsDirty = false; detailsId = null; }}
    oncancel={() => (discarding = false)} />
{/if}

<style>
  .tool { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .spacer { flex: 1; }
  .save-state { font-size: var(--fs-xs); color: var(--text-3); }
  .save-state.failed { color: var(--danger); }
  .save-state.saved { color: var(--ok); }

  /* -- popovers ------------------------------------------------------------ */
  /* Each one hangs off a wrapper that also holds its trigger. That is what lets a
     pointer landing outside close it while a pointer on the trigger stays a plain
     toggle — closing on the press and reopening on the click leaves it open. */
  .anchor { position: relative; display: flex; }
  .sheet-menu {
    position: absolute; z-index: 8; top: calc(100% + 4px); left: 0; width: 320px;
    max-height: min(420px, calc(100vh - 140px)); overflow: auto; padding: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
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

  .fill-bar {
    display: flex; align-items: center; gap: 8px; padding: 7px 16px;
    border-bottom: 1px solid var(--border); background: var(--bg-1);
  }
  .fill-bar .label { margin: 0; color: var(--text-3); font-size: var(--fs-sm); }
  .fill-bar input { flex: 1; min-width: 160px; }
  .fill-columns { display: flex; flex-wrap: wrap; gap: 4px; }
  .fill-columns .chip.on { border-color: var(--accent); color: var(--accent); }

  .columns-menu {
    position: absolute; z-index: 8; top: calc(100% + 4px); right: 0; width: 240px;
    max-height: min(380px, calc(100vh - 140px)); overflow: auto;
    display: flex; flex-direction: column; gap: 2px; padding: 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-1); box-shadow: 0 12px 30px #0004;
  }
  .column-toggle {
    display: flex; align-items: center; gap: 7px; padding: 5px 6px;
    border-radius: var(--r-sm); font-size: var(--fs-sm); color: var(--text-2);
  }
  .column-toggle:hover { background: var(--bg-2); color: var(--text-1); }
  .column-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .notice {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 6px 16px; font-size: var(--fs-sm); color: var(--text-2);
    background: var(--info-soft); border-bottom: 1px solid var(--border);
  }
  .notice.danger { background: var(--danger-soft); color: var(--text-1); }
  .notice code { font-family: var(--font-mono); font-size: 0.92em; }

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
  }
  .grid::-webkit-scrollbar { width: 0; height: 0; }

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
  .heading-name {
    display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;
    height: 100%; color: inherit; font-size: inherit; font-weight: inherit;
  }
  .heading-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  .rows { position: absolute; top: 0; left: 0; width: 100%; }
  .row {
    height: 30px; border-bottom: 1px solid var(--border);
    background: var(--row-tint, transparent);
  }
  .row:hover { background: var(--bg-2); }
  /* Ticking marks the gutter, not the whole row: a row washed in amber hid the
     colour that had just been painted on it, which is the one thing the analyst
     was looking at. The checkbox and the edge say it instead. */
  .row.ticked .cell.gutter { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }
  .row .cell.gutter { border-left: 3px solid var(--mark, transparent); }
  .row .cell.key-cell { color: var(--text-3); font-family: var(--font-mono); font-size: var(--fs-xs); }
  .cell .value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell .value.linked { color: var(--accent); }
  .cell-url { color: var(--accent); text-decoration: none; margin-right: 8px; }
  .cell-url:hover { text-decoration: underline; }
  .cell.cursor { outline: 2px solid var(--accent); outline-offset: -2px; }
  .cell.picked { background-color: var(--accent-soft); }
  .cell-link, .cell-open {
    opacity: 0; color: var(--text-3); font-weight: 600; padding: 0 2px;
    font-family: var(--font-mono);
  }
  .cell-open { display: flex; font-weight: 400; }
  /* Shown on hover, and on the cell under the cursor: reaching a cell by keyboard
     should not hide the two things that can be done to it. */
  .cell:hover .cell-link, .cell:hover .cell-open,
  .cell.cursor .cell-link, .cell.cursor .cell-open { opacity: 1; }
  .cell-link:hover, .cell-open:hover { color: var(--accent); }
  .link-mark { display: flex; color: var(--accent); }
  .editor {
    position: absolute; z-index: 4; left: 0; top: 0; width: 100%; min-height: 30px;
    max-height: 180px; padding: 5px 8px; resize: none;
    border: 2px solid var(--accent); border-radius: 2px;
    background: var(--bg-2); color: var(--text-1);
    font-size: var(--fs-sm); font-family: inherit; line-height: 1.4;
  }
  .editor:focus { outline: none; }

  /* A strip under the grid rather than a button floating inside it: pinned inside
     the scroller it sat on top of whichever row happened to be at the bottom. */
  .foot {
    grid-area: 3 / 1 / 4 / 3; display: flex; align-items: center; gap: 12px;
    padding: 0 12px; height: 30px;
    background: var(--bg-1); border-top: 1px solid var(--border);
  }
  .foot-note { color: var(--text-3); font-size: var(--fs-xs); }
  .add-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-sm);
  }
  .add-row:hover { color: var(--accent); background: var(--bg-2); }

  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .paste-box { width: 100%; font-family: var(--font-mono); font-size: var(--fs-xs); resize: vertical; }
  .hint { color: var(--text-3); font-size: var(--fs-sm); margin-top: 8px; }

  /* Row marks, from the annotation palette. The amber accent is not in here: it
     means selection, and a row painted with it would read as a selected row. */
  .c-red { --mark: var(--anno-1); --row-tint: rgba(255, 82, 82, 0.1); }
  .c-orange { --mark: var(--anno-6); --row-tint: rgba(255, 158, 64, 0.1); }
  .c-yellow { --mark: var(--anno-3); --row-tint: rgba(255, 215, 64, 0.1); }
  .c-green { --mark: var(--anno-4); --row-tint: rgba(105, 240, 174, 0.1); }
  .c-blue { --mark: var(--anno-2); --row-tint: rgba(64, 196, 255, 0.1); }
  .c-grey { --mark: var(--text-3); --row-tint: rgba(160, 160, 160, 0.08); }
</style>
