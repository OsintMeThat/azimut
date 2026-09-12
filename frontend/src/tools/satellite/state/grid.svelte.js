/**
 * Grid Search: lay a metric lattice over an area and sweep it cell by cell.
 *
 * A case holds several grids — files under `search/`, working aids rather than
 * entities — and each act saves the open one. What that costs is a set of rules
 * about *when* a grid is written and what a switch away from it means:
 *
 * - **Drawing an area always makes a new grid.** Resizing the one you are on is
 *   the handles; a fresh outline is a fresh sweep, and the marks already made
 *   are not a thing to silently redraw underneath.
 * - **The grid being left is flushed before the next one opens.** Marks are
 *   debounced, so switching on the last keypress of a sweep would drop it.
 * - **A lattice too fine for its area is refused, not truncated.** Past the cell
 *   ceiling the previous shape is kept and said so, because half a grid over an
 *   area reads as an area that was swept.
 *
 * Three layers, not one: the cells answer their own clicks, the area outline
 * carries the drag handles, and the draft ring is what a polygon looks like
 * before it is confirmed. The eye toggle hides all three and keeps the grid.
 *
 * The geometry is `lib/gridSearch.js`; this holds what is open, what is drawn,
 * where the sweep is, and what the case has on disk.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => string|undefined} deps.caseId the open case
 * @param {() => Promise<{id: string}>} deps.ensureCase a grid needs a case to hold it
 * @param {() => Promise<any>} deps.reloadCase
 * @param {(lat: number, lon: number) => string} deps.coords how a point is titled
 * @param {() => number} deps.zoom the view zoom, for a cell filed as a place
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import * as gridSearch from '../../../lib/gridSearch.js';
import { createSurface } from '../../../lib/map/surface.js';
import { onEvent } from '../../../lib/events.js';

const MAX_CELLS = gridSearch.MAX_CELLS;
const SAVE_DEBOUNCE = 600;
/** Marks travel sooner than the shape does: the other surface sweeping this
 *  grid is drawing what this one has marked, and a second of lag there reads as
 *  two people marking the same cell twice. */
const MARK_DEBOUNCE = 250;

/**
 * Status → cell paint. Unchecked is a bright thin outline so the lattice reads
 * clearly over dark imagery; cleared greys the cell out; flagged fills yellow —
 * chosen over red so it reads for colour-blind analysts too.
 */
const CELL_STYLE = {
  unchecked: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.7, fill: '#fff', fillOpacity: 0 },
  cleared: { stroke: '#ffffff', strokeWidth: 1, strokeOpacity: 0.55, fill: '#2b3040', fillOpacity: 0.62 },
  flagged: { stroke: '#ffcf33', strokeWidth: 1.5, strokeOpacity: 1, fill: '#ffdb4d', fillOpacity: 0.6 },
};
/** The cell under review: cyan, distinct from both the yellow flag and the
 *  grey fill for a colour-blind reader. */
const REVIEW_STYLE = { stroke: '#33c9ff', strokeWidth: 2.5, strokeOpacity: 1 };
const AOI_STYLE = {
  stroke: '#f5a623',
  strokeWidth: 1.5,
  strokeOpacity: 0.9,
  dash: '5 4',
  interactive: false,
};
const DRAFT_STYLE = { stroke: '#f5a623', strokeWidth: 1.5, strokeOpacity: 0.95, dash: '5 4' };
/** A handle is an empty box the CSS draws; the shape only says where it is. */
const HANDLE = { className: 'grid-handle', size: [16, 16], anchor: [8, 8] };
const CORNERS = ['sw', 'se', 'nw', 'ne'];
const AOI_OUTLINE = 'outline'; // the one shape the drag handles reshape live
const DRAFT_RING = 'ring';
/** A drag under this many px either way is a stray click, not an area. */
const MIN_DRAG_PX = 12;

export function createGridState({
  engine,
  api,
  notify,
  caseId,
  ensureCase,
  reloadCase,
  coords,
  zoom,
  surface = createSurface,
}) {
  let on = $state(false);
  let grid = $state(null); // the open grid spec, or null
  let name = $state(null); // slug of the open grid's file
  // Which revision of the file on disk this grid was built from. The same sweep
  // can be worked from the capture extension over another map, and a save
  // carrying our whole spec would put back the cells it marked in between.
  // Claiming the base is what lets the server refuse that rather than lose them.
  let baseRevision = null;
  let list = $state([]); // summaries of this case's saved grids
  let collapsed = $state(false);
  let cellMetres = $state(500); // what the next area is drawn with
  let drawMode = $state(null); // null | 'rect' | 'polygon'
  let draft = $state([]); // polygon vertices being placed, [{ lat, lon }]
  let editArea = $state(false);
  let hidden = $state(false); // keep the grid, take it off the map
  let renaming = $state(false);
  let renameText = $state('');
  let reviewKey = $state(null); // 'i:j' of the cell under review

  let cellsLayer = null;
  let aoiLayer = null;
  let draftLayer = null;
  let dragBounds = null; // live rect bounds while a corner handle is dragged
  let liveVerts = null; // live polygon vertices while a vertex handle is dragged
  let saveTimer = null;
  let listedFor = null; // the case the list was read for
  //. Cells marked since the file was last told: "i:j" -> status, or null for one
  //. cleared back to unchecked. Kept as a patch rather than as a copy of the
  //. grid, for the reason `sendMarks` states.
  let unsent = {};
  let markTimer = null;
  //. Whether the shape or the title has moved since the file was last written.
  let specDirty = false;

  // -- layers ---------------------------------------------------------------

  function ensureLayers() {
    const map = engine();
    if (!map) return false;
    cellsLayer ??= surface(map);
    aoiLayer ??= surface(map);
    draftLayer ??= surface(map);
    syncVisibility();
    return true;
  }

  function syncVisibility() {
    for (const layer of [cellsLayer, aoiLayer, draftLayer]) layer?.visible(!hidden);
  }

  function clearLayers() {
    cellsLayer?.clear();
    aoiLayer?.clear();
    draftLayer?.clear();
  }

  function cellStyle(key) {
    const base = CELL_STYLE[grid?.statuses[key] || 'unchecked'];
    return key === reviewKey ? { ...base, ...REVIEW_STYLE } : base;
  }

  function renderCells() {
    if (!ensureLayers()) return;
    if (!grid) {
      cellsLayer.clear();
      return;
    }
    cellsLayer.set(
      [...gridSearch.cellsInAoi(grid)].map(([i, j]) => ({
        id: gridSearch.cellKey(i, j),
        kind: 'rect',
        bounds: gridSearch.cellBounds(grid, i, j),
        style: cellStyle(gridSearch.cellKey(i, j)),
        onClick: () => cycleCell(i, j),
        onContextMenu: () => flagCell(i, j),
      }))
    );
  }

  /** One cell of a thousand, on every keypress of a sweep: never a rebuild. */
  function restyleCell(key) {
    cellsLayer?.patch(key, { style: cellStyle(key) });
  }

  function renderAoi() {
    if (!ensureLayers()) return;
    if (!grid || !editArea) {
      aoiLayer.clear();
      return;
    }
    const handle = (id, at, onDragStart, onDrag) => ({
      id,
      kind: 'marker',
      at,
      ...HANDLE,
      draggable: true,
      keyboard: false,
      zIndex: 1200,
      onDragStart,
      onDrag,
      onDragEnd: () => (grid.aoi.type === 'rect' ? commitResize() : commitVertEdit()),
    });
    if (grid.aoi.type === 'rect') {
      const bounds = gridSearch.aoiBounds(grid.aoi);
      aoiLayer.set([
        { id: AOI_OUTLINE, kind: 'rect', bounds, style: AOI_STYLE },
        ...CORNERS.map((corner) => {
          const [lat, lon] = gridSearch.cornerLatLng(bounds, corner);
          return handle(
            corner,
            { lat, lon },
            () => (dragBounds = { ...gridSearch.aoiBounds(grid.aoi) }),
            (at) => onCornerDrag(corner, at)
          );
        }),
      ]);
      return;
    }
    // reshape a confirmed polygon: a draggable handle on every vertex
    aoiLayer.set([
      {
        id: AOI_OUTLINE,
        kind: 'polygon',
        points: grid.aoi.vertices.map(([lat, lon]) => ({ lat, lon })),
        style: AOI_STYLE,
      },
      ...grid.aoi.vertices.map(([lat, lon], k) =>
        handle(
          k,
          { lat, lon },
          () => (liveVerts = grid.aoi.vertices.map((vertex) => [...vertex])),
          (at) => onVertexDrag(k, at)
        )
      ),
    ]);
  }

  function draftRing() {
    return gridSearch
      .closeRing(draft.map((point) => [point.lat, point.lon]))
      .map(([lat, lon]) => ({ lat, lon }));
  }

  function renderDraft() {
    if (!ensureLayers()) return;
    if (drawMode !== 'polygon') {
      draftLayer.clear();
      return;
    }
    draftLayer.set([
      { id: DRAFT_RING, kind: 'line', points: draftRing(), style: DRAFT_STYLE },
      ...draft.map((point, k) => ({
        id: k,
        kind: 'marker',
        at: point,
        ...HANDLE,
        draggable: true,
        keyboard: false,
        zIndex: 1200,
        onDrag: (at) => {
          draft[k] = at;
          draftLayer.patch(DRAFT_RING, { points: draftRing() });
        },
        onDragEnd: renderDraft,
      })),
    ]);
  }

  function render() {
    renderCells();
    renderAoi();
  }

  // -- marking cells --------------------------------------------------------

  /** One cell marked: on screen at once, on disk as a patch a moment later. */
  function markCell(key, status) {
    if (status) grid.statuses[key] = status;
    else delete grid.statuses[key];
    unsent[key] = status ?? null;
    restyleCell(key);
    scheduleMarks();
  }

  function cycleCell(i, j) {
    const key = gridSearch.cellKey(i, j);
    // during a sweep, clicking the cell you're reviewing clears it and moves on
    // (same as the Clear button) — you're looking right at it
    if (reviewKey && key === reviewKey) {
      markReview('cleared');
      return;
    }
    markCell(key, gridSearch.cycleStatus(grid.statuses[key]));
  }

  function flagCell(i, j) {
    const key = gridSearch.cellKey(i, j);
    markCell(key, grid.statuses[key] === 'flagged' ? null : 'flagged');
  }

  // -- reshaping the area ---------------------------------------------------

  function onCornerDrag(corner, at) {
    if (!dragBounds) return;
    if (corner[0] === 'n') dragBounds.north = at.lat;
    else dragBounds.south = at.lat;
    if (corner[1] === 'e') dragBounds.east = at.lon;
    else dragBounds.west = at.lon;
    aoiLayer.patch(AOI_OUTLINE, { bounds: gridSearch.normalizeBounds(dragBounds) });
  }

  function onVertexDrag(k, at) {
    if (!liveVerts) return;
    liveVerts[k] = [at.lat, at.lon];
    aoiLayer.patch(AOI_OUTLINE, { points: liveVerts.map(([lat, lon]) => ({ lat, lon })) });
  }

  /** Keep a reshaped grid, or refuse it and snap the handles back. */
  function adopt(resized, refusal) {
    if (gridSearch.estimateCells(resized) > MAX_CELLS) {
      notify(refusal, 'warn', 5000);
      renderAoi(); // snap the handles back
      return false;
    }
    grid = resized;
    render();
    scheduleSave();
    return true;
  }

  function commitResize() {
    if (!dragBounds || !grid) return;
    const bounds = gridSearch.normalizeBounds(dragBounds);
    dragBounds = null;
    adopt(
      gridSearch.resizeRect(grid, bounds),
      `That area is too fine for ${grid.cell_m} m cells. Keeping the previous size`
    );
  }

  function commitVertEdit() {
    if (!liveVerts || !grid) return;
    const vertices = liveVerts;
    liveVerts = null;
    adopt(
      gridSearch.resizePolygon(grid, vertices),
      `That shape is too fine for ${grid.cell_m} m cells. Keeping the previous one`
    );
  }

  // -- drawing a new area ---------------------------------------------------

  function cancelDraw() {
    const wasDrawing = drawMode;
    drawMode = null;
    draft = [];
    draftLayer?.clear();
    if (wasDrawing && grid) renderCells(); // restore the cells hidden while drawing
  }

  /**
   * Drawing an area always makes a *new* grid: the case can hold several, and
   * the one being left stays saved. Resizing the current one is the handles.
   */
  async function applyArea(aoi) {
    const metres = Math.max(10, Number(cellMetres) || 500); // never a NaN lattice
    const next = gridSearch.createGrid(aoi, metres);
    if (gridSearch.estimateCells(next) > MAX_CELLS) {
      notify(`That area exceeds the ${MAX_CELLS}-cell limit. Use a larger cell size.`, 'warn', 6000);
      renderCells(); // restore the previous grid we hid to draw
      return null;
    }
    await ensureCase(); // a grid is case state; make sure there is one to hold it
    await flushSave(); // persist the grid we're leaving before switching
    const centre = gridSearch.aoiCenter(aoi);
    next.title = coords(centre.lat, centre.lon);
    grid = next;
    name = `grid-${Date.now().toString(36)}`;
    baseRevision = null; // nothing on disk to be behind yet
    // a patch belongs to the file it was made on, and that file is not this one
    unsent = {};
    specDirty = false;
    listedFor = caseId();
    reviewKey = null;
    editArea = false;
    hidden = false;
    render();
    await save(); // create it on disk now, then refresh the picker
    await refreshList();
    return grid;
  }

  // -- the sweep ------------------------------------------------------------

  function stopReview() {
    if (reviewKey) setReview(null);
  }

  function setReview(key) {
    const previous = reviewKey;
    reviewKey = key;
    if (previous) restyleCell(previous);
    if (key) restyleCell(key);
  }

  function flyToCell([i, j]) {
    setReview(gridSearch.cellKey(i, j));
    engine()?.fitBounds(gridSearch.cellBounds(grid, i, j), {
      padding: [80, 80],
      maxZoom: 20,
      animate: true,
    });
  }

  function advance() {
    const next = gridSearch.nextUnchecked(grid, reviewKey);
    if (!next) {
      setReview(null);
      notify('Sweep complete', 'ok');
      return;
    }
    flyToCell(next);
  }

  function markReview(status) {
    if (!reviewKey) return;
    markCell(reviewKey, status ?? null);
    advance();
  }

  // -- persistence ----------------------------------------------------------
  //
  // A sweep is two different things in one file, and they are written
  // differently because they fail differently.
  //
  // **Marks are a patch.** The same grid is swept from here and from the
  // extension's panel over another map, and a whole-spec save carries every
  // cell: the copy this tab loaded goes back over whatever the other one marked
  // in between. So a marked cell travels as the cell that was marked
  // (`api/satellite.py`, `apply_grid_marks`), two sweeps of different cells both
  // land, and the same cell twice resolves last-writer-wins — which is what
  // anybody marking the same cell twice expects.
  //
  // **The shape is a spec.** Redrawing an area or renaming it is one analyst's
  // decision about the whole file, so it claims the revision it was built from
  // and is refused if the file has moved on. Refused is not lost: what moved the
  // file was someone's marks, and marks and shape are separate halves — so they
  // are put together and written once more rather than handed back to be redone.

  function scheduleSave() {
    specDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, SAVE_DEBOUNCE);
  }

  function scheduleMarks() {
    clearTimeout(markTimer);
    markTimer = setTimeout(() => {
      markTimer = null;
      sendMarks();
    }, MARK_DEBOUNCE);
  }

  /** Persist every pending change to the *current* grid before switching away.
   *  The shape only where it moved: a spec written for nothing is a revision
   *  bump that refuses whatever the other surface had in hand. */
  async function flushSave() {
    clearTimeout(markTimer);
    markTimer = null;
    clearTimeout(saveTimer);
    saveTimer = null;
    await sendMarks();
    if (specDirty) await save();
  }

  /** The cells marked here since the last send, as the patch that carries them. */
  async function sendMarks() {
    const id = caseId();
    if (!id || !grid || !name || !Object.keys(unsent).length) return;
    // Nothing on disk to patch: this grid has never been written — its own save
    // is what carries these, and what writes the file they would be patching.
    if (baseRevision === null) return save();
    const slug = name;
    const marks = unsent;
    unsent = {};
    try {
      const answer = await api.post(`/api/cases/${id}/search-grids/${slug}/marks`, { marks });
      if (name === slug) baseRevision = answer?.revision ?? baseRevision;
    } catch (e) {
      // Put them back, without stepping on any made since: a mark that has been
      // forgotten is a cell the analyst believes is swept and nothing recorded.
      unsent = { ...marks, ...unsent };
      notify(`Could not save that mark: ${e.message}`, 'danger', 5000);
    }
  }

  async function save({ merge = true } = {}) {
    const id = caseId();
    if (!id || !grid || !name) return;
    const slug = name;
    // the spec below carries these, so they stop being unsent — and go back if
    // it never lands
    const carried = unsent;
    unsent = {};
    try {
      const spec = JSON.parse(JSON.stringify(grid)); // strip the $state proxy
      const saved = await api.put(`/api/cases/${id}/search-grids/${slug}`, {
        spec,
        title: grid.title,
        base_revision: baseRevision,
      });
      if (name === slug) {
        baseRevision = saved?.revision ?? null;
        specDirty = false;
      }
    } catch (e) {
      unsent = { ...carried, ...unsent };
      // One retry, and only one: a second refusal is a file being written faster
      // than this can read it, and looping on that is worse than saying so.
      if (e.status === 409 && merge) return saveOverTheirMarks(slug);
      notify(`Could not save the grid: ${e.message}`, 'danger', 5000);
    }
  }

  /** Their marks, our shape, written once. */
  async function saveOverTheirMarks(slug) {
    const id = caseId();
    try {
      const fresh = await api.get(`/api/cases/${id}/search-grids/${slug}`);
      if (name !== slug) return; // moved on already
      grid.statuses = mergedStatuses(fresh);
      baseRevision = fresh.revision ?? 0;
      render();
      await save({ merge: false });
    } catch (e) {
      notify(`This sweep changed elsewhere and could not be merged: ${e.message}`, 'danger', 6000);
    }
  }

  /** What the file says has been swept, with anything marked here that it has
   *  not been told about yet on top — the only copy of those. */
  function mergedStatuses(fresh) {
    const statuses = { ...(fresh.statuses || {}) };
    for (const [key, status] of Object.entries(unsent)) {
      if (status) statuses[key] = status;
      else delete statuses[key];
    }
    return statuses;
  }

  /**
   * The open sweep, re-read because something else wrote it.
   *
   * The file wins whole — the other surface may have reshaped the area, not only
   * marked a cell — and the marks still in hand here go back on top. Skipped
   * while a shape of ours has not reached the file: that save is about to claim
   * it, and adopting first would throw the reshape away. Nothing is lost by
   * waiting, because a save that is refused merges instead.
   */
  async function adoptFile(slug) {
    const id = caseId();
    if (!id || specDirty) return;
    try {
      const fresh = await api.get(`/api/cases/${id}/search-grids/${slug}`);
      if (name !== slug) return;
      const statuses = mergedStatuses(fresh);
      grid = { ...fresh, statuses };
      baseRevision = fresh.revision ?? 0;
      render();
    } catch {
      // deleted, or the case closed: the picker refresh that follows says so
    }
  }

  /**
   * One nudge about a grid (`api/events.py`), from anywhere but here.
   *
   * The app's own map and every map panel the extension has open work the same
   * files, and each of them hears its own writes come back. A revision this
   * surface is already holding is one of those, and re-reading the file for it
   * would be a request per marked cell.
   */
  function onGridEvent(event) {
    if (!event || event.case_id !== caseId()) return;
    if (event.type === 'grid-removed') {
      if (name === event.name) {
        close();
        notify('This sweep was discarded elsewhere', 'warn', 5000);
      }
      refreshList();
      return;
    }
    // a grid drawn anywhere is a picker entry here, open or not
    if (event.type === 'grid') refreshList();
    if (name !== event.name || Number(event.revision) <= (baseRevision ?? 0)) return;
    adoptFile(event.name);
  }

  const listening = [
    onEvent('grid', onGridEvent),
    onEvent('grid-marks', onGridEvent),
    onEvent('grid-removed', onGridEvent),
  ];

  async function refreshList() {
    const id = caseId();
    if (!id) {
      list = [];
      return;
    }
    try {
      list = await api.get(`/api/cases/${id}/search-grids`);
    } catch {
      list = [];
    }
  }

  /** Close the open grid — it stays on disk; the draw buttons start a fresh one. */
  function close() {
    clearTimeout(markTimer);
    markTimer = null;
    unsent = {};
    specDirty = false;
    grid = null;
    name = null;
    baseRevision = null;
    reviewKey = null;
    editArea = false;
    cancelDraw();
    clearLayers();
  }

  return {
    get on() {
      return on;
    },
    get grid() {
      return grid;
    },
    get name() {
      return name;
    },
    get collapsed() {
      return collapsed;
    },
    set collapsed(value) {
      collapsed = value;
    },
    get cellMetres() {
      return cellMetres;
    },
    set cellMetres(value) {
      cellMetres = value;
    },
    get drawMode() {
      return drawMode;
    },
    get draft() {
      return draft;
    },
    get editArea() {
      return editArea;
    },
    get hidden() {
      return hidden;
    },
    get renaming() {
      return renaming;
    },
    set renaming(value) {
      renaming = value;
    },
    get renameText() {
      return renameText;
    },
    set renameText(value) {
      renameText = value;
    },
    get reviewKey() {
      return reviewKey;
    },
    get coverage() {
      return grid ? gridSearch.coverage(grid) : null;
    },
    /** The picker lists the grids you could switch to — never the open one. */
    get others() {
      return list.filter((entry) => entry.name !== name);
    },

    /** Open the mode. Exclusivity with the other map modes is the tool's. */
    open() {
      on = true;
      hidden = false;
      ensureLayers();
      refreshList();
      if (grid) render();
    },

    exit() {
      on = false;
      cancelDraw();
      stopReview();
      editArea = false;
      clearLayers();
    },

    toggleHidden() {
      hidden = !hidden;
      syncVisibility();
      return hidden;
    },

    startRename() {
      if (!grid) return;
      renameText = grid.title || '';
      renaming = true;
    },

    commitRename() {
      renaming = false;
      if (!grid) return;
      const title = renameText.trim();
      if (title && title !== grid.title) {
        grid.title = title;
        scheduleSave();
      }
    },

    /** Show the area box, to resize a rect's corners or reshape a polygon. */
    toggleEditArea() {
      if (!grid) return;
      stopReview();
      cancelDraw();
      editArea = !editArea;
      renderAoi();
    },

    startDraw(type) {
      cancelDraw();
      stopReview();
      editArea = false;
      hidden = false;
      drawMode = type;
      // hide the current cells while drawing so map clicks reach the canvas
      // (polygon vertices) instead of being swallowed by a cell underneath
      cellsLayer?.clear();
      if (type === 'polygon') {
        draft = [];
        renderDraft();
      }
    },

    cancelDraw,

    /** A map click, while a polygon is being placed. False means it was not ours. */
    addVertex(at) {
      if (drawMode !== 'polygon') return false;
      draft = [...draft, at];
      renderDraft();
      return true;
    },

    /** The rectangle drag finished. `null` — or a box too small to be meant —
     *  restores the cells that were hidden to draw over them. */
    finishRect(corners) {
      const wasDrawing = drawMode === 'rect';
      drawMode = null;
      if (!wasDrawing || !corners) {
        if (grid) renderCells();
        return null;
      }
      const { p1, p2, widthPx, heightPx } = corners;
      if (widthPx < MIN_DRAG_PX || heightPx < MIN_DRAG_PX) {
        if (grid) renderCells();
        return null;
      }
      return applyArea({
        type: 'rect',
        bounds: gridSearch.normalizeBounds({
          south: p1.lat,
          north: p2.lat,
          west: p1.lon,
          east: p2.lon,
        }),
      });
    },

    confirmPolygon() {
      if (draft.length < 3) return null;
      const vertices = draft.map((point) => [point.lat, point.lon]);
      drawMode = null;
      draft = [];
      draftLayer?.clear();
      return applyArea({ type: 'polygon', vertices });
    },

    startReview() {
      if (!grid) return;
      editArea = false;
      const cell = gridSearch.nextUnchecked(grid, null);
      if (!cell) {
        notify('Every cell is marked. Sweep complete', 'ok');
        return;
      }
      flyToCell(cell);
    },

    advance,
    markReview,

    stopReview,

    /** Flag the cell under review and file its centre as a place — a hit the
     *  analyst promotes into the case graph. */
    async reviewToPlace() {
      if (!reviewKey || !grid) return;
      const [i, j] = gridSearch.parseKey(reviewKey);
      const centre = gridSearch.cellCenter(grid, i, j);
      markCell(reviewKey, 'flagged');
      try {
        const open = await ensureCase();
        await api.post(`/api/cases/${open.id}/satellite/place`, {
          lat: centre.lat,
          lon: centre.lon,
          zoom: Math.max(zoom(), 16),
          bearing: 0,
        });
        await reloadCase();
        notify('Cell flagged and saved as a place', 'ok');
      } catch (e) {
        notify(`Could not save place: ${e.message}`, 'danger', 6000);
      }
    },

    async load(slug) {
      const id = caseId();
      if (!id) return;
      cancelDraw();
      stopReview();
      editArea = false;
      hidden = false;
      await flushSave(); // persist the grid we're leaving
      try {
        grid = await api.get(`/api/cases/${id}/search-grids/${slug}`);
        name = slug;
        unsent = {}; // whatever is left belonged to the grid we just left
        specDirty = false;
        baseRevision = grid.revision ?? 0;
        reviewKey = null;
        ensureLayers();
        render();
        await refreshList(); // the grid we left becomes a picker entry
      } catch (e) {
        notify(`Could not load grid: ${e.message}`, 'danger', 6000);
      }
    },

    /** The Discard button: persist the pending rename/marks, close, then relist
     *  so the just-closed grid shows its latest title. */
    async discard() {
      await flushSave();
      close();
      await refreshList();
    },

    async remove(slug) {
      const id = caseId();
      if (id) {
        try {
          await api.del(`/api/cases/${id}/search-grids/${slug}`);
        } catch {
          /* the file may already be gone — nothing left to do */
        }
      }
      if (name === slug) close();
      await refreshList();
    },

    /** A different case: drop whatever was open and read its own grids. True
     *  when the case actually changed. */
    forCase(id) {
      if (listedFor === id) return false;
      listedFor = id;
      clearTimeout(saveTimer); // the grid it belonged to is gone
      saveTimer = null;
      close();
      refreshList();
      return true;
    },

    render,
    destroy() {
      clearTimeout(saveTimer);
      clearTimeout(markTimer);
      for (const off of listening) off();
      for (const layer of [cellsLayer, aoiLayer, draftLayer]) layer?.destroy();
      cellsLayer = aoiLayer = draftLayer = null;
    },
  };
}
