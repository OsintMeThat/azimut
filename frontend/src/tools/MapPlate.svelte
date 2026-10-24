<script>
  /**
   * Map plates: a page laid out round the case's maps, for a report, a print or a post.
   *
   * A plate opens on the house layout (a title, the map, a legend, an inset, the
   * scale, the north and the credits) over the ground the Map is looking at, with the
   * layers switched on there. Everything on it is moved and resized by the hand, and
   * set in the inspector; the plate saves itself. A plate draws the case's layers by
   * name, so it is what they are when it is opened, and a tracked layer is drawn as it
   * stood on the plate's day, which the bar under the page moves and plays.
   *
   * On a plate played through its days, what is added on the map (labels, arrows,
   * zones…) belongs to the day it was made on: the next day starts without it, and
   * brings it back by a press when it should stay. So a video shows each day's
   * annotations, and only those.
   *
   * A day can hold steps, played after it in order (the strip over the date bar).
   * What is added while a step is shown belongs to that step, over what the day
   * shows; a video stands on a step, and the step runs as long as its clip. So one
   * day can play several videos one after another, each beside its place.
   *
   * A day or a step after the first keeps the framing before it until its map bar's
   * "Keep the previous framing" is unticked; then its maps are framed for it alone.
   * With the video's transitions on, the MP4 goes from one to the next by a fade, the
   * maps moving to their new framing, and what is new fading in or drawn.
   *
   * A template is the same page with the data taken out. A plate can be kept as one,
   * and a new plate opened from one; Settings lists them too, and editing one opens
   * it here, over the Map's ground.
   *
   * Round the page, the list and the inspector are widened by their edge and put
   * away from the header, and kept so (`lib/plate/layout.svelte.js`). Focus (F) gives
   * the page the whole screen: the app's bars step aside and the panels come back
   * over the page when called. A plate opens in a tab of its own, on another screen,
   * and is only ever edited in one tab at a time (`lib/plate/oneTab.js`).
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import NoCase from '../components/NoCase.svelte';
  import Modal from '../components/Modal.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import PlatePage from './plate/PlatePage.svelte';
  import PlateElements from './plate/PlateElements.svelte';
  import PlateInspector from './plate/PlateInspector.svelte';
  import PlateExportDialog from './plate/PlateExportDialog.svelte';
  import PlateSteps from './plate/PlateSteps.svelte';
  import PlateAdd from './plate/PlateAdd.svelte';
  import PanelEdge from '../components/PanelEdge.svelte';
  import LayerTimeCursor from './satellite/LayerTimeCursor.svelte';
  import { api } from '../lib/api.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { caseState, deleteTemplate, prefs, saveTemplate, toast, uiState } from '../lib/state.svelte.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { categoryColour } from '../lib/map/addedLayers.js';
  import { NEW_COLOUR, badgeImage, personalMarkerImage } from '../lib/map/addedLayer.js';
  import { layerPalette } from '../lib/map/layerPalette.svelte.js';
  import { MARKER_PIXELS, drawMarker, drawOwnMarker, isBadge, ownMarkerSide } from '../lib/map/markerGlyphs.js';
  import { layerIconUrl, loadPicture, readyPicture } from '../lib/map/ownIcons.js';
  import symbols from '../lib/map/layerSymbols.json';
  import { asOf, hasHistory, isTracked, momentLabel, momentNow, stateAt } from '../lib/map/layerHistory.js';
  import { revealPlates } from '../lib/plateExport.js';
  import '../lib/plateFontFaces.js';
  import { plateCredits } from '../lib/plate/credits.js';
  import { canvasBlob, composePage, copyPage, evolutionSheet, postExport, QUALITIES, release, scaleFor, scaleForWidth, stagedPictures, videoSize } from '../lib/plate/exportPlate.js';
  import { KIND_LABELS, PAPERS, longDay, MAP_KINDS, MAX_MAPS, ON_THE_GROUND, PX_PER_MM, SIGNATURE, THEMES, TOO_MANY_MAPS, facesOf, mapCount, inLook, addStep, pickedDays, beatKey, beatKeys, bornAt, currentStep, dayOf, framedAs, framingOf,
    fromTemplate, hasSteps, houseLayout, labelBox, listedOf, mainMap, mapsFirst, movedStep, newId, onPaper, pageSize, placeOf, settleOn, shownOn, stepsOf, SYMBOL, templateOf, textMeasurer,
    transitionsOf, unsettled, withoutStep, restacked, stepOf } from '../lib/plate/page.js';
  import { changes, transitionPlan, tweenFrames } from '../lib/plate/tween.js';
  import { defaultSize } from '../lib/plate/words.js';
  import { FIRST_SECONDS, beatClips, beats, boundSeconds, clipRange, daySeconds, plateSeconds, playDays, posterKey, posterOf, totalSeconds } from '../lib/plate/clip.js';
  import { legendRows } from '../lib/plate/legend.js';
  import { numbered, pasted, placeLabels, tableRows } from '../lib/plate/arrange.js';
  import { drawOver, pictureKey } from '../lib/plate/draw.js';
  import { inFrame, project, scaleRatio } from '../lib/plate/geo.js';
  import { WAYBACK_ID } from '../lib/wayback.js';
  import { inspectorWidth, layout, listWidth, togglePanel } from '../lib/plate/layout.svelte.js';
  import { plateTabs } from '../lib/plate/oneTab.js';
  import { buildHash, readSolo, splitHash } from '../lib/hash.js';
  import { settlePlace } from '../lib/backButton.js';
  import { followFullscreen } from '../lib/fullscreen.js';

  const caseId = $derived(caseState.current?.id ?? null);
  $effect(() => addedLayers.load(caseId, caseState.rev));
  $effect(() => layerPalette.load(caseId));
  const rows = $derived(addedLayers.rows);

  /** `{ name, title, spec, caseId }` of the open plate, `{ template: { id, name }, title, spec }` of a template, or null. */
  let plate = $state(null);
  /** Bumped when another plate opens, so the page starts afresh rather than keeping the last one's camera. */
  let opened = $state(0);
  let titleField = $state('');
  let selection = $state([]);
  const selected = $derived(selection.at(-1) ?? '');
  let framing = $state('');
  let placing = $state(null);
  /** The symbol set last, which the next one placed takes: its marker, colour and size. */
  let lastSymbol = $state({ ...SYMBOL, colour: null });
  let views = $state({});
  let plates = $state([]);
  let templates = $state([]);
  let providers = $state([]);
  let relief = $state(null);
  let releases = $state([]);
  let exporting = $state(false);
  let exportPreview = $state('');
  let progress = $state('');
  /** The day an export is drawing, ahead of the plate's own. */
  let exportTime = $state(null);
  /** The days a played export's legend speaks for, so it stays still from frame to frame. */
  let legendDays = $state(null);
  let naming = $state(null);
  let renaming = $state(null);
  let playing = $state(false);
  /** The day and the step the play is on, `{ day, step }`: shown, never written into the plate until it stops. */
  let playBeat = $state(null);
  /** The step an export is drawing, with its day. */
  let exportStep = $state(null);
  let speed = $state(1);
  let loop = $state(false);
  let ghosts = $state(false);
  /** The elements whose words run past their box, each with the height it needs when known (`drawPage`). */
  let overflow = $state(new Map());
  let menu = $state(null);
  let templateMenu = $state(null);
  /** The button the Add panel opens under, while it is open. */
  let adding = $state(null);
  let addButton = $state(null);
  let focusAdd = $state(null);
  /** The page alone, the panels called back over it one by one. Never kept: it is a moment. */
  let focus = $state(false);
  let floating = $state({ list: false, inspector: false });
  /** The play bar's height, which the panels floating in focus stop above. */
  let barHeight = $state(0);
  /** What focus hands the screen to. */
  let toolEl = $state(null);
  const handles = new Map();
  let images = $state(new Map());

  // What the plate offers to draw its maps on, read once: free grounds, no quota spent.
  const FREE = ['esri-world-imagery', WAYBACK_ID, 'osm', 'opentopomap'];
  const grounds = $derived([['plain', 'Plain'], ['plain-dark', 'Plain, dark'], ['plain-topo', 'Topographic, heights in colour'], ['plain-staff', 'Staff map'],
    ...providers.filter((entry) => FREE.includes(entry.id)).map((entry) => [entry.id, entry.id === WAYBACK_ID ? 'World Imagery Wayback, dated' : entry.label ?? entry.id])]);
  let asked = false;
  $effect(() => {
    if (uiState.tool !== 'plate' || asked) return;
    asked = true;
    api.get('/api/satellite/providers').then((list) => { providers = Array.isArray(list) ? list : []; }, () => {});
    api.get('/api/terrain/sources').then((info) => { relief = info; }, () => {});
  });
  /** The Wayback releases, read when a map is first set on one: the dates a dated ground offers. */
  let releasesAsked = false;
  function readReleases() {
    if (releasesAsked) return;
    releasesAsked = true;
    api.get('/api/satellite/wayback/releases').then((answer) => {
      releases = (answer?.releases ?? []).map((entry) => ({ release: entry.release ?? entry.number, date: entry.date ?? entry.label ?? '' }))
        .filter((entry) => entry.release);
    }, () => { releasesAsked = false; });
  }
  $effect(() => { if (plate?.spec.elements.some((element) => element.basemap === WAYBACK_ID)) untrack(readReleases); });

  // -- the list, and opening ---------------------------------------------------------

  async function refresh() {
    if (!caseId) { plates = []; return; }
    try { plates = await api.get(`/api/cases/${caseId}/map-plates`); } catch { plates = []; }
  }
  async function readTemplates() {
    try { templates = (await api.get('/api/templates')).map ?? []; } catch { templates = []; }
  }
  $effect(() => { if (uiState.tool === 'plate') untrack(() => { refresh(); readTemplates(); }); });
  // Another case: whatever was waiting is written to the case it was made in (the plate carries it), then let go.
  $effect(() => { void caseId; untrack(() => { autosave.flush(); plate = null; selection = []; refresh(); }); });

  /**
   * Where a new plate looks: the Map's ground, at the Map's zoom, turned as the Map
   * is; before the Map has looked anywhere, the ground its layers cover, else the
   * ground every layer of the case covers, else the whole world rather than a place
   * the case has nothing to do with.
   */
  function mapGround(names = mapLayers()) {
    const view = uiState.mapView;
    if (view) return { lat: view.lat, lon: view.lon, zoom: Math.max(0, (view.zoom ?? 10) - 1), bearing: -(view.bearing ?? 0) };
    return framed(rows.filter((row) => names.includes(row.name)).map((row) => row.bbox).filter(Boolean))
      ?? framed(rows.map((row) => row.bbox).filter(Boolean))
      ?? WORLD;
  }
  const WORLD = { lat: 20, lon: 0, zoom: 1, bearing: 0 };
  /** A view holding every box `[west, south, east, north]`, on a frame about 700 pixels wide. */
  function framed(boxes) {
    if (!boxes.length) return null;
    const west = Math.min(...boxes.map((box) => box[0]));
    const south = Math.min(...boxes.map((box) => box[1]));
    const east = Math.max(...boxes.map((box) => box[2]));
    const north = Math.max(...boxes.map((box) => box[3]));
    const span = Math.max(east - west, (north - south) * 1.4, 0.005);
    return { lat: (south + north) / 2, lon: (west + east) / 2, zoom: Math.max(1, Math.min(16, Math.log2((360 * 700) / (512 * span * 1.3)))), bearing: 0 };
  }
  /** The layers a new plate draws: those switched on in the Map, else the analyst's own. */
  function mapLayers() {
    const on = addedLayers.drawn.map((row) => row.name);
    return on.length ? on : rows.filter((row) => row.editable).map((row) => row.name);
  }

  function openSpec(next) {
    autosave.cancel();
    selection = []; framing = ''; placing = null; views = {}; handles.clear(); playing = false; playBeat = null;
    history = []; future = [];
    next.spec.elements = mapsFirst(next.spec.elements);
    plate = { ...next, caseId };
    opened += 1;
    titleField = next.title;
    saved = signed(next.title, next.spec);
    remember();
    tuckSidebar(true);
  }

  function newPlate(template = null) {
    const spec = template ? fromTemplate(template.data, { view: mapGround(), layers: mapLayers() })
      : houseLayout({ view: mapGround(), layers: mapLayers() });
    openSpec({ name: null, title: caseState.current?.name ? `${caseState.current.name} map` : 'Map plate', spec });
    // never written yet: the first save files it, whether or not anything moves
    saved = '';
    autosave.schedule();
  }

  async function open(name) {
    try {
      const loaded = await api.get(`/api/cases/${caseId}/map-plates/${encodeURIComponent(name)}`);
      openSpec({ name: loaded.name, title: loaded.title, spec: loaded.spec, pictured: !!loaded.thumb, savedAt: loaded.updated_at ?? null });
    } catch (error) { toast(error.message, 'danger'); }
  }

  /** A template opened to be edited, from Settings or from the list of plates, where Done goes back to. */
  async function editTemplate(id, from = 'plates') {
    await readTemplates();
    const found = templates.find((item) => item.id === id);
    if (!found) { toast('That template is no longer kept', 'warn'); return; }
    openSpec({ template: { id: found.id, name: found.name, from }, title: found.name,
      spec: fromTemplate(found.data, { view: mapGround(), layers: [] }) });
  }

  // Handed over from Files, the Board, Settings or the Map.
  $effect(() => {
    const name = uiState.openPlate;
    if (uiState.tool !== 'plate' || !name || !caseId) return;
    uiState.openPlate = null;
    untrack(() => open(name));
  });
  $effect(() => {
    const id = uiState.openPlateTemplate;
    if (uiState.tool !== 'plate' || !id) return;
    uiState.openPlateTemplate = null;
    untrack(() => editTemplate(id, 'settings'));
  });
  $effect(() => {
    if (uiState.tool !== 'plate' || !uiState.newPlate || !caseId) return;
    uiState.newPlate = false;
    untrack(async () => { await autosave.flush(); newPlate(); });
  });

  /**
   * The case's own column folds while a plate is open, so the page has the room; it
   * comes back as it was when the plate closes or the tool is left.
   */
  let sidebarWas = null;
  function tuckSidebar(on) {
    if (on && sidebarWas === null) { sidebarWas = uiState.sidebarOpen; uiState.sidebarOpen = false; }
    else if (!on && sidebarWas !== null) { uiState.sidebarOpen = sidebarWas; sidebarWas = null; }
  }
  // folded while a plate is open on this tool, back as it was otherwise, a case change included
  $effect(() => { const on = uiState.tool === 'plate' && !!plate; untrack(() => tuckSidebar(on)); });

  /** A template's edit ends where it began: in Settings, or on the list of plates. */
  async function leaveTemplate() {
    const back = plate?.template?.from;
    await close();
    if (back === 'settings') uiState.tool = 'settings';
  }

  async function close() {
    await autosave.flush();
    // the list shows the plate as it was left: a preview still owed is drawn before its maps go
    await Promise.race([previewNow(), wait(4000)]);
    plate = null;
    tuckSidebar(false);
    refresh();
  }

  // -- room round the page -------------------------------------------------------------

  const listShown = $derived(focus ? floating.list : layout.list);
  const inspectorShown = $derived(focus ? floating.inspector : layout.inspector);
  /** The list or the inspector put away or brought back: beside the page, or over it in focus. */
  function panel(which) {
    if (focus) floating = { ...floating, [which]: !floating[which] };
    else togglePanel(which);
  }
  /**
   * Focus on, and the screen asked for at the same press, as browsers want; a
   * browser that refuses leaves the page the whole window instead. Off, the screen
   * is given back.
   */
  function setFocus(on) {
    focus = on;
    floating = { list: false, inspector: false };
    adding = null;
    if (on && toolEl?.requestFullscreen && !document.fullscreenElement) toolEl.requestFullscreen().catch(() => {});
    if (!on && toolEl && document.fullscreenElement === toolEl) document.exitFullscreen().catch(() => {});
  }
  // Esc leaves the screen without asking the page: focus ends with it
  $effect(() => toolEl ? followFullscreen(toolEl, (held) => { if (!held && focus) setFocus(false); }) : undefined);
  // focus ends with the plate or the tool; while it holds, the app's bars and rail step aside
  $effect(() => { if (uiState.tool !== 'plate' || !plate) untrack(() => { if (focus) setFocus(false); }); });
  $effect(() => { uiState.focusMode = focus; });
  const toggleAdd = (anchor) => { adding = adding ? null : anchor; };

  // -- a tab of its own ----------------------------------------------------------------

  const opening = splitHash(location.hash);
  /** This tab is the plate on its own, opened from another (`lib/hash.js`): the app takes its bars away. */
  const solo = readSolo(opening.params);
  /** The plate the address names, opened once its case is. */
  let waiting = solo && opening.route === 'plate' && opening.params.get('plate')
    ? { caseId: opening.params.get('case'), name: opening.params.get('plate') } : null;
  $effect(() => {
    if (!waiting || !caseId || uiState.tool !== 'plate') return;
    const { caseId: owner, name } = waiting;
    waiting = null;
    if (!owner || owner === caseId) untrack(() => open(name));
  });
  // the address keeps naming the plate shown, so a reload opens it again
  $effect(() => {
    if (!solo || uiState.tool !== 'plate') return;
    const params = { case: caseId ?? '', plate: plate && !plate.template ? plate.name ?? '' : '', solo: '1' };
    untrack(() => settlePlace('plate', params));
  });

  /**
   * The plate in a tab of its own, to put on another screen. It is written first so
   * the tab opens on what is here, and this tab goes back to the list rather than
   * saving over it. The tab is opened at the press, as browsers allow, and pointed
   * at the plate once it is written.
   */
  async function detach() {
    if (!plate || plate.template) return;
    const tab = window.open('', '_blank');
    if (!tab) { toast('The browser refused a new tab. Allow pop-ups for this page', 'warn', 8000); return; }
    const doc = plate;
    try { await autosave.flush(); } catch { /* the save status says what was not written */ }
    if (!doc.name || !doc.caseId) { tab.close(); toast('The plate could not be written, so it stays here', 'warn'); return; }
    tab.location.href = `${location.pathname}${location.search}${buildHash('plate', { case: doc.caseId, plate: doc.name, solo: '1' })}`;
    if (plate === doc) await close();
    toast(`“${doc.title}” is open in its own tab`, 'info', 3000);
  }

  /** One plate, one tab: a tab that opens this plate takes it, and this one writes what it has and lets it go. */
  const tabs = plateTabs({
    onlost: async (held) => {
      const doc = plate;
      if (!doc || doc.caseId !== held.caseId || doc.name !== held.name) return;
      try { await autosave.flush(); } catch { /* the save status says what was not written */ }
      if (plate === doc) { plate = null; refresh(); }
      tabs.saved(held.caseId, held.name);
      toast(`“${doc.title}” is open in another tab now`, 'info', 4000);
    },
    // written by the tab that let it go after this one read it: read it again, unless something was done here meanwhile
    onsaved: (held) => {
      if (plate?.name !== held.name || plate.caseId !== held.caseId || canUndo) return;
      if (signed(plate.title, plate.spec) === saved) open(held.name);
    },
  });
  onDestroy(() => tabs.close());
  $effect(() => {
    const owner = plate && !plate.template ? plate.caseId : null;
    const name = plate?.name ?? null;
    untrack(() => tabs.hold(owner, name));
  });

  async function remove(row) {
    try {
      await api.del(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}`);
      toast(`“${row.title}” is in the Trash`, 'ok');
      refresh();
    } catch (error) { toast(error.message, 'danger'); }
  }

  /** A copy of a plate, to make a variant of it: the same page under the next free name, its preview with it. */
  async function duplicatePlate(row) {
    try {
      const answer = await api.post(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}/duplicate`, {});
      toast(`“${answer.title}” made`, 'ok');
      await refresh();
    } catch (error) { toast(error.message, 'danger'); }
  }

  async function renamePlate(row, title) {
    const name = title.trim();
    if (!name || name === row.title) return;
    try {
      const loaded = await api.get(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}`);
      await api.post(`/api/cases/${caseId}/map-plates`, { title: name, spec: loaded.spec, rename_from: row.name });
      await refresh();
    } catch (error) { toast(error.message, 'danger'); }
  }

  // -- saving --------------------------------------------------------------------------

  let saved = '';
  /** The plate as written, worked out once a change for the save, the undo and the page, which all watch it. */
  const written = $derived(plate ? JSON.stringify(plate.spec) : '');
  /** What a save is compared on: the name and the plate. */
  const signed = (title, spec, text = JSON.stringify(spec)) => `${title}\u0000${text}`;
  const autosave = createAutosave({ write: () => write() });
  $effect(() => {
    if (!plate) return;
    const signature = signed(plate.title, null, written);
    if (signature !== saved) untrack(() => autosave.schedule());
  });
  $effect(() => { if (uiState.tool !== 'plate') untrack(() => autosave.flush()); });

  /**
   * Write the plate as it is now, into the case it was opened in, whichever case is
   * open by the time the write runs. A name another plate holds is refused by the
   * server; the plate keeps the name it had, and says so, rather than failing every
   * save after it.
   */
  async function write() {
    const doc = plate;
    if (!doc) return;
    const signature = signed(doc.title, doc.spec);
    if (signature === saved) return;
    if (doc.template) {
      await saveTemplate('map', { id: doc.template.id, name: doc.title, data: templateOf(doc.spec) });
      saved = signature;
      return;
    }
    if (!doc.caseId) return;
    let answer;
    try {
      answer = await api.post(`/api/cases/${doc.caseId}/map-plates`, {
        title: doc.title, spec: doc.spec, ...(doc.name ? { rename_from: doc.name } : {}) });
    } catch (error) {
      if (error.status === 409 && doc.name && plate === doc) {
        toast(`${error.message}; the plate keeps the name “${doc.name}”`, 'warn', 6000);
        doc.title = doc.name;
        titleField = doc.name;
        return;
      }
      throw error;
    }
    if (plate !== doc) return;
    saved = signed(answer.title, doc.spec);
    if (doc.name !== answer.name || doc.title !== answer.title) {
      doc.name = answer.name;
      doc.title = answer.title;
      titleField = answer.title;
      saved = signed(doc.title, doc.spec);
    }
    keepPreview();
  }

  function commitTitle() {
    const title = titleField.trim();
    if (!title) { titleField = plate.title; return; }
    plate.title = title;
  }

  // The preview the lists show, drawn a while after the last change, from the maps as they are.
  let previewTimer = null;
  /** A change is written whose preview is not drawn yet. */
  let previewOwed = false;
  function keepPreview() {
    clearTimeout(previewTimer);
    previewOwed = true;
    previewTimer = setTimeout(drawPreview, 4000);
  }
  async function drawPreview() {
    clearTimeout(previewTimer);
    if (!plate?.name || plate.template || !plate.caseId || exporting || playing) return;
    previewOwed = false;
    const { name, caseId: owner } = plate;
    try {
      // the page as it shows, on the plate's own day
      const canvas = await render(160 / pageSize(plate.spec.page).width, undefined, { quick: true });
      const blob = await canvasBlob(canvas);
      release(canvas);
      const body = new FormData();
      body.append('file', blob, 'preview.png');
      if (plate?.name === name) await api.put(`/api/cases/${owner}/map-plates/${encodeURIComponent(name)}/thumb`, body);
      if (plate?.name === name) plate.pictured = true;
    } catch { /* the list shows the plate without its picture */ }
  }
  /** The preview drawn now when one is owed, or when the plate never had one, before the plate is let go. */
  function previewNow() {
    if (!plate?.name || plate.template || (!previewOwed && plate.pictured)) return Promise.resolve();
    return drawPreview();
  }

  // -- undo ----------------------------------------------------------------------------

  let history = [];
  let future = [];
  let last = '';
  let undoTimer = null;
  /** A change that has held still for half a second is one step back. */
  function remember() { last = JSON.stringify(plate?.spec ?? null); }
  $effect(() => {
    if (!plate) return;
    const now = written;
    untrack(() => {
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        if (now === last) return;
        history = [...history.slice(-49), last];
        future = [];
        last = now;
        canUndo = true; canRedo = false;
      }, 500);
    });
  });
  let canUndo = $state(false);
  let canRedo = $state(false);
  function undo() {
    if (!history.length || !plate) return;
    clearTimeout(undoTimer);
    future = [JSON.stringify(plate.spec), ...future];
    last = history.at(-1);
    history = history.slice(0, -1);
    plate.spec = JSON.parse(last);
    canUndo = history.length > 0; canRedo = true;
    selection = selection.filter((id) => plate.spec.elements.some((element) => element.id === id));
  }
  function redo() {
    if (!future.length || !plate) return;
    clearTimeout(undoTimer);
    history = [...history, JSON.stringify(plate.spec)];
    last = future[0];
    future = future.slice(1);
    plate.spec = JSON.parse(last);
    canUndo = true; canRedo = future.length > 0;
    selection = selection.filter((id) => plate.spec.elements.some((element) => element.id === id));
  }

  // -- the plate's day -----------------------------------------------------------------

  const spec = $derived(plate?.spec ?? null);
  const elements = $derived(spec?.elements ?? []);

  /** The plate's tracked layers, on any of its maps. */
  const tracked = $derived(rows.filter((row) => isTracked(row) && elements.some((element) => element.kind === 'map'
    && element.layers?.some((entry) => entry.name === row.name))));
  const moments = $derived([...new Set(tracked.flatMap((row) => addedLayers.moments(row.name)))].sort());
  const playable = $derived(moments.length > 0 && !plate?.template);
  const time = $derived(exportTime ?? (playBeat ? { ...(spec?.time ?? {}), at: playBeat.day } : spec?.time) ?? { at: null, trail: true, since: null, window: null });
  const at = $derived(time.at ?? null);
  /** The days a played plate goes through: each change of its layers, each day that holds steps, each day added to it. */
  const playedDays = $derived(spec && playable ? playDays(spec, moments) : moments);
  /** Whether the play goes through the day shown. */
  const dayPlayed = $derived(!playable || playedDays.includes(dayOf(at)));

  /**
   * A plate whose layers change stands on a day of the calendar, never on a now that
   * would slide to the next day. One that stands on none, or keeps something under its
   * page, is put on the day it was last saved, on its layers' clock (today for a new
   * one), and opens there. Settling it is not a step to take back.
   */
  $effect(() => {
    if (!plate || !playable || plate.template || !unsettled(plate.spec)) return;
    untrack(() => {
      const saved = new Date(plate.savedAt ?? Date.now());
      const day = momentNow(tracked[0]?.track, Number.isFinite(saved.getTime()) ? saved : new Date());
      Object.assign(plate.spec, settleOn(plate.spec, day));
      remember();
    });
  });

  // -- the steps of the day ------------------------------------------------------------

  const stepped = $derived(!!spec && hasSteps(spec));
  /** The step shown: the play's, an export's, else the plate's own, while its day holds it. */
  const stepId = $derived(playBeat ? playBeat.step : exportTime ? exportStep : currentStep(spec, at)?.id ?? null);
  const place = $derived(spec ? placeOf(spec, at, stepId) : null);
  const daySteps = $derived(spec ? stepsOf(spec, at) : []);
  /** The play bar under the page: the plate's days, the day's steps; nothing on a plate that plays nothing. */
  const barShown = $derived(!!plate && !plate.template && (moments.length > 0 || daySteps.length > 0));
  const stepIndex = $derived(daySteps.findIndex((item) => item.id === stepId));

  function pickStep(id) {
    if (playing) stop();
    spec.time.step = id;
    selection = selection.filter((sid) => spec.elements.some((element) => element.id === sid && shownOn(element, at, placeOf(spec, at, id))));
  }
  /** A new step after the one shown, or at the end of the day from the day itself; shown at once. */
  function newStep() {
    if (playing) stop();
    const after = stepId ?? daySteps.at(-1)?.id ?? null;
    const made = addStep(spec, at, after);
    spec.steps = made.steps;
    spec.time.step = made.step.id;
    selection = [];
    return made.step.id;
  }
  function dropStep(id) {
    plate.spec = withoutStep(plate.spec, id);
    selection = selection.filter((sid) => plate.spec.elements.some((element) => element.id === sid));
  }
  /** A step as the strip names it: its own name, else its place in the day. */
  const stepName = (index, day = at) => stepsOf(spec, day)[index]?.name || `Step ${index + 1}`;
  /** The days and steps the play goes through, from the plate's day when it has none followed over time. */
  const sequence = $derived(spec ? beats(spec, playable ? playedDays : [at]) : []);
  /** How long a played export runs over `days`, each beat held its own seconds, an MP4's transitions included. */
  const runtime = (days, format = 'mp4') => {
    const list = beats(spec, playable ? days : [at]);
    const moves = transitionsOf(spec);
    return totalSeconds(list) + (moves.on && format === 'mp4' ? (list.length - 1) * moves.seconds : 0);
  };

  // -- framing a map day by day ---------------------------------------------------------

  /** The days and steps in the order they are played, as their framings are kept. */
  const order = $derived(beatKeys(sequence));
  /** The day or the step shown, as its framing is kept. */
  const shownKey = $derived(beatKey(at, stepId));
  /** How a map is framed on the day or step shown. */
  const framingFor = (map) => framingOf(spec, map, order, shownKey);
  /** The map framed by the hand on the day or step shown: its own framing there, or the map's view on the first. */
  function mapView(map, view) {
    const framed = framingFor(map);
    if (framed.own) spec.framing = framedAs(spec, shownKey, map.id, view);
    else if (framed.first) map.view = view;
  }
  /** The day or step shown keeps the framing before it, or takes a copy of it to frame the map its own way. */
  function keepFraming(map, keep) {
    spec.framing = framedAs(spec, shownKey, map.id, keep ? null : { ...framingFor(map).view });
  }

  function changeStep(id, patch) {
    const list = stepsOf(spec, at).map((item) => (item.id === id ? { ...item, ...patch } : item));
    spec.steps = { ...(spec.steps ?? {}), [dayOf(at)]: list };
  }
  /** The day shown held its own seconds in the video, or (null) the plate's again. */
  function holdDay(seconds) {
    const holds = { ...(spec.holds ?? {}) };
    const bound = seconds === null ? null : boundSeconds(seconds);
    if (bound === null) delete holds[dayOf(at)]; else holds[dayOf(at)] = bound;
    spec.holds = holds;
  }
  /** Every day that says nothing of its own held these seconds. */
  function holdPlate(seconds) {
    const bound = boundSeconds(seconds);
    if (bound !== null) spec.time.hold = bound;
  }

  // -- playing -------------------------------------------------------------------------

  let playTimer = null;
  /**
   * Through the days the plate's layers change on, each followed by its steps, the
   * steps' clips running in their boxes, without writing a day of it until it stops.
   */
  function play() {
    if (playing) { stop(); return; }
    const list = sequence;
    if (list.length < 2) return;
    playing = true;
    let index = list.findIndex((beat) => dayOf(beat.day) === dayOf(spec.time.at) && beat.step === stepId) + 1;
    if (index <= 0 || index >= list.length) index = 0;
    const next = () => {
      if (!playing || !plate) return;
      const beat = list[index];
      playBeat = { day: beat.day, step: beat.step };
      // the beat holds what it holds in the video
      const held = (beat.seconds * 1000) / speed;
      index += 1;
      if (index >= list.length) {
        if (!loop) { playTimer = setTimeout(stop, held); return; }
        index = 0;
      }
      playTimer = setTimeout(next, held);
    };
    next();
  }
  /** The play stops on the day and the step it reached, which the plate then keeps. */
  function stop() {
    clearTimeout(playTimer);
    playing = false;
    if (playBeat && plate) { plate.spec.time.at = playBeat.day; plate.spec.time.step = playBeat.step; }
    playBeat = null;
  }
  $effect(() => { if (!plate || uiState.tool !== 'plate') untrack(() => { if (playing) stop(); }); });

  // -- the page's elements -------------------------------------------------------------

  const measure = $derived(textMeasurer(spec?.theme));
  const birth = () => bornAt(at, playable, stepId);

  /** Put new elements on the page, maps under the rest, and pick the last. */
  function put(...added) {
    spec.elements = mapsFirst([...spec.elements, ...added]);
    selection = [added.at(-1).id];
  }

  function add(kind) {
    if (!spec) return;
    if (kind === 'step') { if (!plate.template) newStep(); return; }
    const was = placing;
    placing = null;
    const main = mainMap(spec);
    const placed = { label: 'label', number: 'label', note: 'label', arrow: 'arrow', measure: 'measure', ring: 'ring', cone: 'cone', zone: 'zone',
      spotlight: 'zone', line: 'line', symbol: 'symbol' };
    if (placed[kind]) {
      if (!main) { toast('Put a map on the page first', 'warn'); return; }
      // a second press on the armed tool puts it down
      placing = was?.preset === kind ? null : { kind: placed[kind], preset: kind };
      return;
    }
    const { width, height } = pageSize(spec.page);
    const of = main?.id;
    const needsMap = ['inset', 'legend', 'scale', 'north', 'credits', 'detail'].includes(kind);
    if (needsMap && !of) { toast('Put a map on the page first', 'warn'); return; }
    if (['map', 'detail', 'inset'].includes(kind) && mapCount(spec.elements) >= MAX_MAPS) { toast(TOO_MANY_MAPS, 'warn', 6000); return; }
    const [mx, my, mw, mh] = main?.box ?? [10, 10, width - 20, height - 20];
    const box = (x, y, w, h) => [x, y, w, h].map((value) => Math.round(value * 10) / 10);
    const id = newId(kind);
    let element;
    switch (kind) {
      case 'map': element = { id, kind: 'map', box: box(width * 0.3, height * 0.3, width * 0.4, height * 0.4), view: { ...(main?.view ?? mapGround()) },
        basemap: main?.basemap ?? 'plain', overlays: [...(main?.overlays ?? ['relief'])], layers: JSON.parse(JSON.stringify(main?.layers ?? [])), grid: 'none' }; break;
      case 'detail': element = { id, kind: 'map', of, box: box(mx + mw - 64, my + 4, 60, 45), view: { ...main.view, zoom: Math.min(20, main.view.zoom + 2.5) },
        basemap: main.basemap, overlays: [...(main.overlays ?? [])], layers: JSON.parse(JSON.stringify(main.layers ?? [])), grid: 'none', name: 'Detail' }; break;
      case 'inset': element = { id, kind: 'inset', of, box: box(mx + mw - 52, my + mh - 42, 48, 38), border: true, zoom: null }; break;
      case 'legend': element = { id, kind: 'legend', of, box: box(mx + 4, my + 4, 55, 40), size: 8, border: true, fill: spec.theme.paper }; break;
      case 'scale': element = { id, kind: 'scale', of, box: box(mx + 4, my + mh - 10, 40, 6), fill: spec.theme.paper }; break;
      case 'north': element = { id, kind: 'north', of, box: box(mx + mw - 12, my + 4, 8, 12), fill: spec.theme.paper }; break;
      case 'credits': element = { id, kind: 'credits', of, box: box(mx, my + mh + 1, mw, 5), size: 5.5, align: 'right' }; break;
      case 'timeline': element = { id, kind: 'timeline', box: box(mx, my + mh - 16, mw, 12), size: 7, fill: spec.theme.paper }; break;
      case 'text': element = { id, kind: 'text', box: box(width / 2 - 40, height / 2 - 5, 80, 10), text: 'Text', size: 11, weight: 400, align: 'left' }; break;
      case 'stamp': element = { id, kind: 'text', name: 'Stamp', box: box(width / 2 - 45, height / 2 - 9, 90, 18), text: 'UNCONFIRMED', size: 28, weight: 700,
        align: 'center', valign: 'middle', colour: spec.theme.accent, border: true, upper: true, tracking: 12, rotate: -12, opacity: 0.6 }; break;
      case 'banner': element = { id, kind: 'text', name: 'Banner', box: box(0, height - 9, width, 9), text: '{case} · {date}', size: 9, weight: 700,
        align: 'center', valign: 'middle', colour: '#ffffff', fill: spec.theme.accent, upper: true, tracking: 6 }; break;
      case 'key': element = { id, kind: 'key', box: box(width - 70, height / 2 - 20, 60, 40), size: 8, border: true, fill: spec.theme.paper }; break;
      case 'table': element = { id, kind: 'table', box: box(width - 90, height / 2 - 30, 80, 60), size: 7, source: 'events', rows: 12, border: true, fill: spec.theme.paper }; break;
      case 'qr': element = { id, kind: 'qr', box: box(width - 30, height - 30, 22, 22), text: '' }; break;
      case 'image': element = { id, kind: 'image', box: box(width / 2 - 25, height / 2 - 20, 50, 40) }; break;
      case 'signature': element = { id, kind: 'signature', box: box(width - 64, height - 15, 56, 9), text: '{handle}\n{today}', size: 7, align: 'right' }; break;
      case 'brand': element = { id, kind: 'brand', box: box(width - 52, height - 7.5, 46, 4.5), text: 'Made with', size: 6, align: 'right' }; break;
      case 'logo': element = { id, kind: 'image', name: 'Logo', src: SIGNATURE, box: box(width - 34, 6, 26, 14) }; break;
      case 'rect': element = { id, kind: 'shape', shape: 'rect', box: box(width / 2 - 30, height / 2 - 20, 60, 40), width: 1, ...birth() }; break;
      case 'ellipse': element = { id, kind: 'shape', shape: 'ellipse', box: box(width / 2 - 25, height / 2 - 20, 50, 40), width: 1, ...birth() }; break;
      case 'rule': element = { id, kind: 'shape', shape: 'line', box: box(width / 2 - 40, height / 2 - 2, 80, 4), width: 1 }; break;
      case 'video': {
        // a video plays on a step: this one while it holds none, else a new one after it
        const free = stepId && !spec.elements.some((item) => item.kind === 'video' && item.step === stepId);
        const on = free ? stepId : newStep();
        element = { id, kind: 'video', box: box(width / 2 - 50, height / 2 - 28, 100, 56.2), step: on, carry: false, src: '', clip: [0, FIRST_SECONDS],
          sound: false, volume: 1, caption: true, text: '', size: 7, fit: 'contain', border: true };
        break;
      }
      default: return;
    }
    // what is made while a step is shown belongs to it
    if (stepId && !element.step) Object.assign(element, bornAt(at, playable, stepId));
    put(element);
  }

  /** What a press on a map placed, made into its element, on the plate's day when the plate is played. */
  function placed({ map, at: point, to, page, points }) {
    const kind = placing?.kind;
    const preset = placing?.preset;
    const target = placing?.id;
    placing = null;
    if (!kind || !map) return;
    const of = map.id;
    const day = birth();
    if (kind === 'callout') {
      const picture = spec.elements.find((item) => item.id === target);
      if (picture) Object.assign(picture, { at: point.map((value) => Math.round(value * 1e6) / 1e6), of, leader: picture.leader ?? 'straight' });
      return;
    }
    let element;
    // words on the ground are given their size, so the plate saved and opened again writes them as it does now
    const size = (of) => ({ size: defaultSize(of) });
    if (kind === 'label' && preset === 'note') {
      // a text on the map: no leader, standing over its point, moved with it
      element = { id: newId('label'), kind: 'label', name: 'Text on the map', of, at: point.map((value) => Math.round(value * 1e6) / 1e6),
        box: [page[0], page[1], 20, 6], text: 'Text', size: 10, weight: 600, style: 'plain', leader: 'none', end: 'none', ...day };
      const [, , w, h] = labelBox(element, measure);
      element.box = [Math.round((page[0] - w / 2) * 10) / 10, Math.round((page[1] - h / 2) * 10) / 10, w, h];
    } else if (kind === 'label') {
      element = { id: newId('label'), kind: 'label', of, at: point.map((value) => Math.round(value * 1e6) / 1e6), box: [page[0] + 3, page[1] - 9, 28, 6],
        text: preset === 'number' ? 'What this number marks' : 'Label', size: 9, weight: 600, style: preset === 'number' ? 'number' : 'bubble', ...day };
      element.box = labelBox(element, measure);
      if (preset === 'number') element.box = [page[0] + 2, page[1] - 8, element.box[2], element.box[3]];
    } else if (kind === 'arrow') element = { id: newId('arrow'), kind: 'arrow', of, at: point, to, box: [0, 0, 1, 1], width: 1.2, ...size('arrow'), ...day };
    else if (kind === 'measure') element = { id: newId('measure'), kind: 'measure', of, at: point, to, box: [0, 0, 1, 1], width: 1, line: 'dashed', ...size('measure'), ...day };
    else if (kind === 'ring') {
      const km = Math.max(0.01, Math.round((distanceKm(point, to)) * 100) / 100);
      element = { id: newId('ring'), kind: 'ring', of, at: point, box: [0, 0, 1, 1], radii: [km, km * 2, km * 3].map((value) => Math.round(value * 100) / 100), look: 'outline', width: 1,
        ...size('ring'), ...day };
    } else if (kind === 'cone') {
      element = { id: newId('cone'), kind: 'cone', of, at: point, box: [0, 0, 1, 1], bearing: Math.round(bearing(point, to)), spread: 60,
        reach: Math.max(0.01, Math.round(distanceKm(point, to) * 100) / 100), look: 'fill', width: 1, ...size('cone'), ...day };
    } else if (kind === 'zone') {
      element = { id: newId('zone'), kind: 'zone', of, points, box: [0, 0, 1, 1], look: preset === 'spotlight' ? 'outline' : 'hatch', width: 1,
        ...(preset === 'spotlight' ? { mask: { on: true, darkness: 0.55 } } : {}), ...size('zone'), ...day };
    } else if (kind === 'line') {
      element = { id: newId('line'), kind: 'line', of, points, box: [0, 0, 1, 1], width: 1.4, line: 'solid', shape: 'line', heads: 'none', ...size('line'), ...day };
    } else if (kind === 'symbol') {
      // the last symbol set, standing over its point; the tool stays in hand for the next one
      const side = lastSymbol.size;
      element = { id: newId('symbol'), kind: 'symbol', of, at: point.map((value) => Math.round(value * 1e6) / 1e6), symbol: lastSymbol.symbol,
        colour: lastSymbol.colour ?? spec.theme.accent, box: [Math.round((page[0] - side / 2) * 10) / 10, Math.round((page[1] - side / 2) * 10) / 10, side, side], ...day };
      put(element);
      placing = { kind: 'symbol', preset: 'symbol' };
      return;
    }
    if (element) put(element);
  }
  const distanceKm = ([lon1, lat1], [lon2, lat2]) => {
    const rad = Math.PI / 180;
    const s = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * 6378.137 * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  const bearing = ([lon1, lat1], [lon2, lat2]) => {
    const rad = Math.PI / 180;
    const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
    return ((Math.atan2(y, x) / rad) + 360) % 360;
  };

  /**
   * Take an element off the page, and with a map what reads it. The credits stay
   * while a map is left: they move to it rather than leave its sources unsaid.
   */
  function removeElement(element) {
    if (!spec.elements.includes(element)) return;
    let dependants = [];
    if (element.kind === 'map') {
      const other = spec.elements.find((item) => item.kind === 'map' && item.id !== element.id && item.of !== element.id);
      for (const item of spec.elements) {
        if (item.of !== element.id) continue;
        if (item.kind === 'credits' && other) item.of = other.id;
        else if (item.kind === 'map') item.of = null;
        else dependants.push(item);
      }
    } else if (element.kind === 'credits' && spec.elements.filter((item) => item.kind === 'credits').length < 2) return;
    spec.elements = spec.elements.filter((item) => item.id !== element.id && !dependants.includes(item));
    selection = selection.filter((id) => spec.elements.some((item) => item.id === id));
  }
  function duplicate(element) {
    if (MAP_KINDS.includes(element.kind) && mapCount(spec.elements) >= MAX_MAPS) { toast(TOO_MANY_MAPS, 'warn', 6000); return; }
    const copies = pasted([element], mainMap(spec)?.id, new Set(spec.elements.map((item) => item.id)));
    if (copies.length) put(...copies);
  }
  /** The elements as the list shows them, top first: one step forward or back is among these. */
  const listed = $derived(spec ? listedOf(spec, at, place) : []);
  /** One step forward (`by` 1) or back (-1) among the rows the list shows; nothing when it can go no further. */
  function restackBy(element, by) {
    const to = stepOf(listed, element.id, by);
    if (to !== null) spec.elements = restacked(spec.elements, listed, element.id, to);
  }
  /** The list's drag: the element let go above the row at `index` of the list, top first. */
  function restack(id, index) {
    spec.elements = restacked(spec.elements, listed, id, index);
  }
  function paper(page) {
    plate.spec = onPaper(plate.spec, page);
  }
  /** A look set at one press: the page, its face and colours, and every map's ground. */
  function applyTheme(id) {
    if (THEMES[id]) plate.spec = inLook(plate.spec, id);
  }
  function group(on) {
    const id = on ? newId('g') : null;
    for (const element of spec.elements) if (selection.includes(element.id)) element.group = id;
  }

  /**
   * A label for every named feature of a layer the map shows, each tied to its feature
   * (shown when it is), placed so no two cover each other, and each moved by hand
   * afterwards. A feature already labelled is left as it is.
   */
  async function labelFeatures(map, row) {
    const live = views[map.id];
    if (!live) return;
    let collection;
    try { collection = await addedLayers.drawing(caseId, row.name); } catch { return; }
    const labelled = new Set(spec.elements.filter((item) => item.ref?.layer === row.name).map((item) => item.ref.key));
    const day = at ?? '￿';
    const found = [];
    for (const feature of collection.features ?? []) {
      const standing = isTracked(row) && hasHistory(feature) ? stateAt(feature, day) : feature;
      const name = String(standing?.properties?.name ?? '').trim();
      const key = standing?.properties?.key ?? '';
      // a map in 3D places its ground through its own camera
      if (!standing || !name || (key && labelled.has(key)) || !inFrame(standing.geometry, live.view, live.frame, 0, live.project)) continue;
      const point = anchor(standing.geometry);
      if (!point) continue;
      const [px, py] = live.project ? live.project(point) : project(live.view, live.frame, point);
      found.push({ name, key, point, x: map.box[0] + px / PX_PER_MM, y: map.box[1] + py / PX_PER_MM });
    }
    const chosen = found.slice(0, 40);
    if (!chosen.length) { toast(found.length ? 'Every named feature on the map has its label' : 'No named feature of this layer is on the map', 'info'); return; }
    const sizes = chosen.map((item) => labelBox({ text: item.name, size: 7.5, weight: 600, style: 'plain', box: [0, 0, 0, 0] }, measure));
    const taken = spec.elements.filter((item) => item.kind === 'label' || item.kind === 'text').map((item) => item.box);
    const boxes = placeLabels(chosen.map((item, index) => ({ x: item.x, y: item.y, width: sizes[index][2], height: sizes[index][3] })), taken);
    const added = chosen.map((item, index) => ({ id: newId('label'), kind: 'label', of: map.id, at: item.point.map((value) => Math.round(value * 1e6) / 1e6),
      box: boxes[index], text: item.name, size: 7.5, weight: 600, style: 'plain', leader: 'straight', end: 'dot',
      ...(item.key ? { ref: { layer: row.name, key: item.key } } : {}) }));
    spec.elements = mapsFirst([...spec.elements, ...added]);
    toast(found.length > 40 ? `${added.length} labels added, the first 40; press again for the rest` : `${added.length} labels added; drag them where they read best`, 'ok', 4500);
  }

  function anchor(geometry) {
    const walk = (node) => (typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk));
    const points = walk(geometry?.coordinates);
    if (!points.length) return null;
    if (geometry.type === 'Point') return points[0];
    if (String(geometry.type).includes('Line')) return points[Math.floor(points.length / 2)];
    return [points.reduce((sum, [lon]) => sum + lon, 0) / points.length, points.reduce((sum, [, lat]) => sum + lat, 0) / points.length];
  }

  // -- the keyboard --------------------------------------------------------------------

  /** Where the last press landed: a delete or a nudge acts on the page only after a press there. */
  let pressedOnPage = false;
  function press(event) {
    pressedOnPage = !!event.target?.closest?.('.viewport, .elements .row');
  }

  const CLIPBOARD = 'azimut:plate-clipboard';
  function copySelection() {
    const chosen = spec.elements.filter((item) => selection.includes(item.id));
    if (!chosen.length) return;
    // a map copied takes what reads it along
    const ids = new Set(chosen.map((item) => item.id));
    const withDependants = [...chosen, ...spec.elements.filter((item) => item.of && ids.has(item.of) && !ids.has(item.id) && !MAP_KINDS.includes(item.kind))];
    try { localStorage.setItem(CLIPBOARD, JSON.stringify(withDependants)); } catch { /* this browser keeps nothing */ }
    toast(`${withDependants.length === 1 ? 'One element' : `${withDependants.length} elements`} copied; paste them here or on another plate`, 'info', 2400);
  }
  function pasteSelection() {
    let copied = null;
    try { copied = JSON.parse(localStorage.getItem(CLIPBOARD) ?? 'null'); } catch { copied = null; }
    if (!Array.isArray(copied) || !copied.length) return;
    // pasted on a step, everything belongs to it; on the day, nothing belongs to a step, and a video, which needs one, stays out
    const fresh = pasted(copied, mainMap(spec)?.id, new Set(spec.elements.map((item) => item.id)))
      .map(({ step, carry, ...item }) => (stepId || (ON_THE_GROUND.includes(item.kind) && playable) ? { ...item, ...birth() } : item))
      .filter((item) => item.kind !== 'video' || item.step);
    if (!fresh.length) { toast(copied.some((item) => item.kind === 'video') ? 'A video goes on a step: show one, then paste' : 'Put a map on the page first', 'warn'); return; }
    if (mapCount(spec.elements) + mapCount(fresh) > MAX_MAPS) { toast(TOO_MANY_MAPS, 'warn', 6000); return; }
    spec.elements = mapsFirst([...spec.elements, ...fresh]);
    selection = fresh.map((item) => item.id);
  }

  function keydown(event) {
    if (uiState.tool !== 'plate' || !plate) return;
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]');
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === 'z' && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (typing || document.querySelector('[role="dialog"], .float-menu')) return;
    if (event.key === 'Escape') {
      if (placing) { placing = null; return; }
      if (!framing && selection.length) { selection = []; return; }
      if (!framing && focus) { setFocus(false); return; }
    }
    // A opens Add, F gives the page the whole window and gives it back
    if (!ctrl && !event.altKey && !event.repeat && (key === 'a' || key === 'f')) {
      event.preventDefault();
      if (key === 'a') adding = focus ? focusAdd : addButton;
      else setFocus(!focus);
      return;
    }
    if (ctrl && key === 'v') { event.preventDefault(); pasteSelection(); return; }
    const chosen = spec.elements.filter((item) => selection.includes(item.id));
    if (!chosen.length) return;
    if (ctrl && key === 'c') { event.preventDefault(); copySelection(); return; }
    if (ctrl && key === 'g') { event.preventDefault(); group(!event.shiftKey); return; }
    if (ctrl && key === 'd') { event.preventDefault(); for (const element of chosen) if (element.kind !== 'credits') duplicate(element); return; }
    // a key that changes the page only after a press on it: a key on a button of the inspector never deletes
    if (!pressedOnPage) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      for (const element of chosen) if (!element.locked) removeElement(element);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      for (const element of chosen) {
        if (element.locked || (ON_THE_GROUND.includes(element.kind) && element.kind !== 'label')) continue;
        element.box = [element.box[0] + dx, element.box[1] + dy, element.box[2], element.box[3]];
      }
    }
  }

  // -- what the page shows beside its maps --------------------------------------------

  const symbolNames = Object.fromEntries(symbols.map((choice) => [choice.id, choice.label]));
  const since = $derived(time.since === 'previous' ? 'the state before' : momentLabel(time.since));
  const legend = $derived.by(() => {
    if (!spec) return {};
    const out = {};
    for (const element of elements.filter((item) => item.kind === 'legend')) {
      const map = elements.find((item) => item.id === element.of);
      if (!map) continue;
      const live = views[map.id];
      out[element.id] = legendRows({ ...map, offmap: element.offmap, off: element.off, order: element.order, names: element.names, extra: element.extra }, {
        rows, collection: (name) => addedLayers.collection(name), view: live?.view, frame: live?.frame, place: live?.project,
        days: legendDays ?? [at],
        standing: (row, feature, day) => (isTracked(row) && hasHistory(feature) ? stateAt(feature, day ?? '￿') : feature),
        past: (row, collection, day) => (isTracked(row) ? asOf(collection, day, { trail: time.trail !== false, since: time.since ?? null, window: time.window ?? null }).features : []),
        colourName: (hex) => layerPalette.nameOf(hex), symbolName: (id) => symbolNames[id] ?? id, categoryColour, newColour: NEW_COLOUR, ink: spec.theme.ink,
        newLabel: `New on ${momentLabel(at)}`, trailLabel: at ? `Before ${momentLabel(at)}` : 'The state before',
        gainedLabel: `Gained since ${since}`, lostLabel: `Lost since ${since}`,
      });
    }
    return out;
  });
  // a table reading a layer no map draws reads it all the same
  $effect(() => {
    const names = elements.filter((element) => element.kind === 'table' && element.layer).map((element) => element.layer);
    if (!caseId || !names.length) return;
    untrack(() => { for (const name of names) if (!addedLayers.collection(name)) addedLayers.drawing(caseId, name).catch(() => {}); });
  });
  /** The features a set of a map's layers holds, for its tables and its credits. */
  function featuresOf(names) {
    return names.flatMap((name) => addedLayers.collection(name)?.features ?? []);
  }
  const credits = $derived.by(() => {
    if (!spec) return {};
    const names = elements.filter((element) => element.kind === 'map').flatMap((map) => (map.layers ?? []).map((entry) => entry.name));
    const extra = [...new Set(featuresOf(names).map((feature) => feature.properties?.credit).filter(Boolean))];
    const text = plateCredits(spec, { providers, rows, relief, releases, extra });
    return Object.fromEntries(elements.filter((element) => element.kind === 'map').map((map) => [map.id, text]));
  });
  const tables = $derived.by(() => {
    if (!spec) return {};
    const main = mainMap(spec);
    return Object.fromEntries(elements.filter((element) => element.kind === 'table').map((element) => {
      const names = element.layer ? [element.layer] : (main?.layers ?? []).map((entry) => entry.name);
      return [element.id, tableRows(element, featuresOf(names), at)];
    }));
  });
  /** A label's feature is on the map on the plate's day: a label tied to it follows it. */
  function refShown(element) {
    if (!element.ref) return true;
    const collection = addedLayers.collection(element.ref.layer);
    if (!collection) return true;
    const feature = collection.features?.find((item) => item.properties?.key === element.ref.key);
    if (!feature) return false;
    const row = rows.find((item) => item.name === element.ref.layer);
    return !(row && isTracked(row) && hasHistory(feature)) || !!stateAt(feature, at ?? '￿');
  }
  const numbers = $derived(spec ? numbered(elements, at, refShown, place) : []);
  /** The pictures the main map's features carry, offered to a picture that points at its feature. */
  const featurePictures = $derived.by(() => {
    const main = mainMap(spec);
    if (!main) return [];
    const out = [];
    for (const entry of main.layers ?? []) {
      for (const feature of addedLayers.collection(entry.name)?.features ?? []) {
        const said = feature.properties ?? {};
        const path = said.entity_picture || said.source_picture;
        const point = anchor(feature.geometry);
        if (!path || !point || out.length >= 60) continue;
        out.push({ key: `${entry.name}/${said.key ?? out.length}`, path, title: said.name || said.entity_label || 'Feature',
          at: point.map((value) => Math.round(value * 1e6) / 1e6), of: main.id });
      }
    }
    return out;
  });
  const updated = $derived(rows.filter((row) => elements.some((element) => element.kind === 'map' && element.layers?.some((entry) => entry.name === row.name)))
    .map((row) => String(row.updated_at ?? '').slice(0, 10)).sort().at(-1) ?? '');
  const imagery = $derived.by(() => {
    const main = mainMap(spec);
    if (main?.basemap !== WAYBACK_ID) return '';
    return (releases.find((entry) => entry.release === main.release) ?? releases[0])?.date ?? '';
  });
  const tokens = $derived({ date: at, updated, imagery, caseName: caseState.current?.name ?? '', title: plate?.title ?? '',
    scale: mainMap(spec)?.view ? scaleRatio(mainMap(spec).view, PX_PER_MM) : '', handle: prefs.signatureHandle ?? '' });

  // The pictures the page shows, each loaded once, and again when it changes.
  const sources = new Map();
  $effect(() => {
    const wanted = elements.filter((element) => element.kind === 'image' && (element.src || element.data))
      .map((element) => [pictureKey(element), element.data ? element.data : element.src === SIGNATURE ? '/api/settings/signature.png' : caseId ? fileUrl(caseId, element.src) : null]);
    if (spec?.page?.background?.kind === 'image' && spec.page.background.data) wanted.push(['data:background', spec.page.background.data]);
    if (elements.some((element) => element.kind === 'signature')) wanted.push(['@signature', '/api/settings/signature.png']);
    // a video's frame where its clip starts, which an export draws under the running clip
    const posters = caseId ? elements.filter((element) => element.kind === 'video' && element.src) : [];
    untrack(() => {
      for (const element of posters) {
        const key = posterKey(element);
        if (sources.has(key)) continue;
        sources.set(key, key);
        posterOf(fileUrl(caseId, element.src), clipRange(element)[0]).then((still) => { if (still) images = new Map(images).set(key, still); });
      }
    });
    untrack(() => {
      for (const [key, url] of wanted) {
        if (!url || sources.get(key) === url) continue;
        sources.set(key, url);
        const picture = new Image();
        picture.onload = () => { if (sources.get(key) === url) images = new Map(images).set(key, picture); };
        picture.src = url;
      }
    });
  });

  const markers = new Map();
  /** Bumped as an own icon's picture arrives, so a legend drawn before it is drawn again. */
  let iconsRead = $state(0);
  /** A marker's picture, `pixels` wide at least: drawn larger for a symbol on a print, in steps so few are kept. */
  function markerImage(symbol, colour, marks = {}, pixels = MARKER_PIXELS) {
    const times = Math.max(1, Math.min(8, Math.ceil(pixels / MARKER_PIXELS)));
    const own = marks.icon;
    const key = `${own ? `own-${own.key}-${own.mode}` : symbol}|${colour}|${marks.status ?? ''}|${times}`;
    if (markers.has(key)) return markers.get(key);
    let canvas = null;
    if (own) {
      // one of the analyst's icons, from the copy its layer keeps; read once, then drawn
      const url = layerIconUrl(caseId, own.layer, own.key);
      const picture = readyPicture(url);
      if (!picture) { loadPicture(url).then((read) => { if (read) iconsRead += 1; }); return null; }
      const side = ownMarkerSide(picture.image, own.mode);
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = side * times;
      const ctx = canvas.getContext('2d');
      if (ctx) drawOwnMarker(ctx, picture.image, colour, { mode: own.mode, status: marks.status ?? '', box: picture.box }, times);
    } else if (times > 1) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = MARKER_PIXELS * times;
      const ctx = canvas.getContext('2d');
      if (ctx) drawMarker(ctx, symbol, colour, marks, times);
    } else {
      const data = isBadge(symbol) ? badgeImage(symbol, colour, marks) : personalMarkerImage(symbol, colour, marks);
      if (data) {
        canvas = document.createElement('canvas');
        canvas.width = data.width; canvas.height = data.height;
        canvas.getContext('2d')?.putImageData(data, 0, 0);
      }
    }
    markers.set(key, canvas);
    return canvas;
  }

  const decor = $derived({ legend, credits, images, markerImage, iconsRead, tokens, imperial: prefs.units === 'imperial', numbered: numbers,
    numberOf: (id) => numbers.find((item) => item.id === id)?.number, tables, moments, dayLabel: momentLabel, refShown, place });

  // -- export --------------------------------------------------------------------------

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Maps an export drew before all their tiles were in, so the file is not called whole when it is not. */
  let tilesMissing = 0;
  /** At most this many frames of transitions in one video (`engine/mapplates.MAX_TWEENS`). */
  const MAX_TWEENS = 480;

  /**
   * The page drawn at `scale` canvas pixels a millimetre, on the day `day` and its
   * step `step` (`day` undefined: the plate's own day and step, as shown).
   */
  async function render(scale, day, options = {}) {
    const { canvas, context } = await drawBeat(scale, day, options);
    // the maps' pictures are on the page now
    release(...Object.values(context.maps));
    return canvas;
  }

  /**
   * The page drawn as `render` draws it, with what it was drawn from: `{ canvas, context }`,
   * the context holding the maps' pictures, which a transition carries to the next beat.
   * The paper is see-through only when a PNG asks for it, whatever the page says.
   */
  async function drawBeat(scale, day, { quick = false, transparent = false, step = null } = {}) {
    if (day !== undefined) { exportTime = { ...spec.time, at: day }; exportStep = step; await tick(); await wait(quick ? 0 : 250); }
    // the faces are in before a word is written, or the page goes out in the browser's default
    await Promise.all(facesOf(spec).map((face) => document.fonts?.load?.(face)?.catch(() => [])));
    const maps = {};
    const ratio = quick ? Math.min(2, window.devicePixelRatio || 1) : scale / PX_PER_MM;
    let gaps = 0;
    for (const element of elements.filter((item) => item.kind === 'map' || item.kind === 'inset')) {
      const handle = handles.get(element.id);
      if (!handle || element.hidden || !shownOn(element, at, place)) continue;
      const shot = await handle.snapshot(ratio);
      maps[element.id] = shot?.canvas ?? null;
      if (shot && !shot.complete) gaps += 1;
    }
    tilesMissing += gaps;
    const page = { ...spec, page: { ...spec.page, transparent } };
    const context = { ...decor, views, maps, at: (exportTime ?? time).at, tokens: { ...tokens, date: (exportTime ?? time).at } };
    return { canvas: composePage(page, scale, context), context };
  }

  /** What stands over the running clips of the step drawn now, on a see-through page of the same size. */
  function overPage(scale) {
    const { width, height } = pageSize(spec.page);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    drawOver(canvas.getContext('2d'), spec, { ...decor, scale, views, at, place, editing: false });
    return canvas;
  }

  /** What runs past its box on the page, by the name the list gives it, for the export to say before it goes out. */
  const pastBox = $derived(elements.filter((element) => overflow.has(element.id) && !element.hidden)
    .map((element) => element.name || KIND_LABELS[element.kind] || element.kind));

  async function openExport() {
    exporting = true;
    exportPreview = '';
    await tick();
    try {
      const canvas = await render(280 / pageSize(spec.page).width, undefined, { quick: true });
      exportPreview = canvas.toDataURL('image/png');
      release(canvas);
    } catch { exportPreview = ''; }
  }

  /** The export under way, which Cancel stops between two pictures and on its way to the server. */
  let exportRun = null;
  const stopped = () => Object.assign(new Error('The export was stopped'), { stopped: true });

  async function runExport({ format, quality, side, days, filename, pixels = 0, transparent = false }) {
    const { width: widthMm, height: heightMm } = pageSize(spec.page);
    const name = filename || plate.title;
    const run = new AbortController();
    exportRun = run;
    const check = () => { if (run.signal.aborted) throw stopped(); };
    framing = ''; selection = [];
    tilesMissing = 0;
    // a played plate's pictures, sent as they are drawn
    let pictures = null;
    try {
      let answer;
      if (format === 'png' || format === 'pdf') {
        progress = 'Drawing the page…';
        const scale = format === 'png' && pixels ? scaleForWidth(spec, pixels) : scaleFor(spec, QUALITIES[quality].dpi);
        const canvas = await render(scale, undefined, { transparent: format === 'png' && transparent });
        check();
        progress = 'Writing…';
        const page = await canvasBlob(canvas);
        release(canvas);
        answer = await postExport(caseId, { format, frames: [page], widthMm, heightMm, transparent: format === 'png' && transparent,
          filename: name === plate.title ? [name, spec.time.at?.replace('T', ' ').replaceAll(':', 'h'), stepIndex >= 0 ? stepName(stepIndex) : '']
            .filter(Boolean).join(' ') : name, signal: run.signal });
      } else {
        const picked = playable ? days.slice(0, 120) : [at];
        legendDays = picked;
        if (format === 'sheet') {
          const scale = scaleForWidth(spec, 900);
          const pages = [];
          for (const [index, day] of picked.entries()) {
            check();
            progress = `Drawing ${momentLabel(day) || 'the page'} (${index + 1} of ${picked.length})…`;
            pages.push(await render(scale, day));
          }
          check();
          progress = 'Writing…';
          const sheet = evolutionSheet(pages, picked.map((day) => momentLabel(day) || 'The page'), spec.theme);
          const drawn = await canvasBlob(sheet);
          release(sheet, ...pages);
          answer = await postExport(caseId, { format: 'png', frames: [drawn], widthMm, heightMm, filename: `${name} evolution`, signal: run.signal });
        } else {
          // each day, then each of its steps, each held its own seconds; a step's clips run over its picture in an MP4
          const scale = videoSize(spec, side).width / widthMm;
          const list = beats(spec, picked).slice(0, 120);
          pictures = stagedPictures(caseId, { signal: run.signal });
          const sent = [];
          // an MP4 goes from one beat to the next by the plate's transitions, drawn here from the two beats
          const moves = format === 'mp4' ? transitionsOf(spec) : { on: false };
          let before = null;
          for (const [index, beat] of list.entries()) {
            check();
            progress = `Drawing ${momentLabel(beat.day) || 'the page'}${beat.step ? `, ${stepName(stepsOf(spec, beat.day).findIndex((item) => item.id === beat.step), beat.day)}` : ''} (${index + 1} of ${list.length})…`;
            const drawn = await drawBeat(scale, beat.day, { step: beat.step });
            await pictures.add('frames', await canvasBlob(drawn.canvas, 'image/jpeg', 0.9));
            // a transition is drawn from what the page was drawn from, never from the page itself
            release(drawn.canvas);
            let tween = null;
            if (before && moves.on) {
              const changed = changes(spec, before, drawn);
              const cut = !!beat.step && stepsOf(spec, beat.day).find((item) => item.id === beat.step)?.transition === 'none';
              const plan = transitionPlan(moves, changed, { cut });
              if (plan && pictures.count('tweens') + plan.frames <= MAX_TWEENS) {
                const start = pictures.count('tweens');
                // a map on the move is drawn again by its own engine at each frame of the way
                const sitting = (id) => handles.get(id)?.sitting?.(scale / PX_PER_MM) ?? null;
                if (plan.move) progress = `Drawing the move to ${momentLabel(beat.day) || 'the next step'}…`;
                for await (const canvas of tweenFrames(spec, scale, before, drawn, plan, changed, { sitting })) {
                  check();
                  await pictures.add('tweens', await canvasBlob(canvas, 'image/jpeg', 0.88));
                }
                tween = [start, pictures.count('tweens') - start];
              }
            }
            // only the beat just drawn is carried to the next: the maps of the one before go
            if (before) release(...Object.values(before.context.maps));
            before = drawn;
            const clips = format === 'mp4' ? beatClips(spec, beat).map((element) => {
              const [start, end] = clipRange(element);
              const [x, y, w, h] = element.box.map((value) => Math.round(value * scale));
              return { src: element.src, start, end, box: [Math.max(0, x), Math.max(0, y), Math.max(2, w), Math.max(2, h)], fit: element.fit ?? 'contain',
                sound: !!element.sound, volume: element.volume ?? 1 };
            }) : [];
            if (clips.length) {
              const over = overPage(scale);
              await pictures.add('overs', await canvasBlob(over));
              release(over);
            }
            sent.push({ seconds: Math.round(beat.seconds * 1000) / 1000, ...(clips.length ? { clips, over: pictures.count('overs') - 1 } : {}), ...(tween ? { tween } : {}) });
          }
          if (before) release(...Object.values(before.context.maps));
          check();
          progress = format === 'mp4' && pictures.count('overs') ? 'Making the video, clips included…' : 'Writing…';
          // beats all held alike and nothing else to say go out as one interval; otherwise each beat says its own
          const held = sent[0]?.seconds ?? 1;
          const alike = !stepped && !pictures.count('tweens') && sent.every((beat) => beat.seconds === held) && held >= 0.15 && held <= 6;
          answer = await pictures.finish({ format, widthMm, heightMm, interval: Math.round(held * 1000), filename: name, beats: alike ? null : sent });
        }
      }
      const show = { label: 'Show', onClick: () => revealPlates(caseId).catch((error) => toast(error.message, 'warn')) };
      if (tilesMissing) toast(`${answer.file} written, but some map tiles had not loaded: a map may have blank patches. Export again once the map is drawn`, 'warn', 9000, show);
      else toast(`${answer.file} written`, 'ok', 5200, show);
    } catch (error) {
      // the pictures already sent wait for nothing now
      pictures?.drop();
      if (error.stopped || error.name === 'AbortError' || run.signal.aborted) { toast('The export was stopped; nothing was written', 'info', 3500); throw stopped(); }
      toast(error.message || 'The plate could not be exported', 'danger', 6000);
      throw error;
    } finally {
      if (exportRun === run) exportRun = null;
      exportTime = null;
      exportStep = null;
      legendDays = null;
      progress = '';
    }
  }
  function stopExport() {
    exportRun?.abort();
  }

  async function copyImage() {
    try {
      const canvas = await render(scaleForWidth(spec, 1600));
      await copyPage(canvas);
      release(canvas);
      toast('The page is on the clipboard', 'ok', 2400);
    } catch (error) {
      toast(error?.message ? `The page could not be copied: ${error.message}` : 'The page could not be copied', 'warn');
      throw error;
    }
  }

  // -- templates -----------------------------------------------------------------------

  async function keepAsTemplate(name) {
    try {
      await saveTemplate('map', { name, data: templateOf(spec) });
      toast(`“${name}” kept as a template`, 'ok');
      readTemplates();
    } catch (error) { toast(error.message, 'danger'); }
  }
  async function renameTemplate(template, name) {
    if (!name.trim() || name.trim() === template.name) return;
    try { await saveTemplate('map', { id: template.id, name: name.trim(), data: template.data }); readTemplates(); } catch (error) { toast(error.message, 'danger'); }
  }
  async function dropTemplate(template) {
    try { await deleteTemplate('map', template.id); toast(`“${template.name}” is no longer kept`, 'ok'); readTemplates(); } catch (error) { toast(error.message, 'danger'); }
  }
  /** What a plate's tile says under its name: its paper, turned, and the day it was last changed. */
  function tileSaid(row) {
    const paper = PAPERS[row.paper]?.label.split(',')[0] ?? '';
    const turned = row.paper && row.paper !== 'square' && row.paper !== 'custom' ? (row.orientation === 'portrait' ? ', upright' : ', wide') : '';
    return [paper ? `${paper}${turned}` : '', longDay(String(row.updated_at ?? '').slice(0, 10))].filter(Boolean).join(' · ');
  }
  /** A template drawn as its page: each box in the colour of what it holds. */
  const TINTS = { map: '#8fb2c9', inset: '#b8cbd8', legend: '#d9c8a5', text: '#5d6470', credits: '#a0a0a0', image: '#c2a5d9', scale: '#5d6470', north: '#5d6470' };
</script>

<svelte:window onkeydown={keydown} onpointerdowncapture={press} />

<div class="tool" bind:this={toolEl}>
  {#if plate}
    {#if !focus}
    <div class="tool-header">
      {#if plate.template?.from === 'settings'}
        <BackButton label="Settings" title="Back to the templates in Settings" onclick={leaveTemplate} />
      {:else}
        <BackButton label="Plates" title="Back to the plates" onclick={close} />
      {/if}
      {#if plate.template}<span class="kind">Template</span>{/if}
      <input class="input title-input" bind:value={titleField} onblur={commitTitle} maxlength="200"
        onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Plate name" />
      {#if autosave.state.status === 'saving' || autosave.state.status === 'pending'}<span class="status">Saving…</span>
      {:else if autosave.state.status === 'saved'}<span class="status"><Icon name="check" size={12} /> Saved</span>
      {:else if autosave.state.status === 'error'}
        <span class="status error"><Icon name="alert" size={12} /> Not saved: {autosave.state.error}</span>
        <button class="btn btn-ghost btn-xs" onclick={() => autosave.flush()}>Retry</button>
      {/if}
      <div class="spacer"></div>
      <button class="btn btn-sm add-btn" class:on={!!adding} bind:this={addButton} aria-haspopup="dialog" aria-expanded={!!adding}
        title="Add to the page (A)" data-guide="plate.add" onclick={() => toggleAdd(addButton)}><Icon name="plus" size={14} /> Add</button>
      <span class="rule" role="presentation"></span>
      <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={15} /></button>
      <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={15} /></button>
      <span class="rule" role="presentation"></span>
      <button class="btn btn-ghost btn-sm toggle" class:on={layout.list} aria-pressed={layout.list} aria-label="The list"
        title={layout.list ? 'Hide the list' : 'Show the list'} onclick={() => panel('list')}><Icon name="panelLeft" size={15} /></button>
      <button class="btn btn-ghost btn-sm toggle" class:on={layout.inspector} aria-pressed={layout.inspector} aria-label="The inspector"
        title={layout.inspector ? 'Hide the inspector' : 'Show the inspector'} onclick={() => panel('inspector')}><Icon name="panelRight" size={15} /></button>
      <button class="btn btn-ghost btn-sm" aria-label="Focus on the page" title="Focus on the page, full screen (F)" onclick={() => setFocus(true)}><Icon name="maximize" size={15} /></button>
      {#if !solo && !plate.template}
        <button class="btn btn-ghost btn-sm" aria-label="Open in its own tab" title="Open in its own tab, for another screen" onclick={detach}><Icon name="external" size={15} /></button>
      {/if}
      <span class="rule" role="presentation"></span>
      {#if !plate.template}
        <button class="btn btn-sm" onclick={() => (naming = { value: plate.title })} title="Keep this layout, without its data, to start other plates from">
          <Icon name="save" size={14} /> Keep as template</button>
        <button class="btn btn-primary btn-sm" data-guide="plate.export" onclick={openExport}><Icon name="download" size={14} /> Export</button>
      {:else}
        <button class="btn btn-primary btn-sm" title={plate.template.from === 'settings' ? 'Keep the template and go back to Settings' : 'Keep the template and go back to the plates'}
          onclick={leaveTemplate}><Icon name="check" size={14} /> Done</button>
      {/if}
    </div>
    {/if}

    <div class="work" class:focus style:--below="{barShown ? barHeight : 0}px">
      {#if listShown}
        <div class="dock left" style:width="{layout.listW}px" data-guide="plate.list">
          <PlateElements spec={plate.spec} bind:selection {at} {place} {playable} bind:ghosts {tokens} onrestack={restack} onhide={() => panel('list')} />
          <PanelEdge bind:width={layout.listW} helpers={listWidth} side="right" label="Resize the list" />
        </div>
      {/if}

      <div class="centre">
        {#key opened}
          <PlatePage spec={plate.spec} bind:selection bind:framing {placing} onplace={placed} caseId={plate.caseId ?? caseId ?? ''} {rows} {providers} {relief}
            {time} stepPlace={place} {playing} {speed} bind:views {decor} bind:overflow {grounds} ghosts={ghosts && playable}
            {framingFor} onmapview={mapView} onkeep={keepFraming} beat={shownKey} {written}
            glide={transitionsOf(plate.spec).on && transitionsOf(plate.spec).move ? (transitionsOf(plate.spec).seconds * 1000) / speed : 0}
            onmap={(id, handle) => handles.set(id, handle)} top={focus ? 44 : 0} />
        {/key}
        {#if focus}
          <div class="focus-bar" role="toolbar" aria-label="The plate">
            <button type="button" class="fb add" class:on={!!adding} bind:this={focusAdd} aria-haspopup="dialog" aria-expanded={!!adding}
              title="Add to the page (A)" onclick={() => toggleAdd(focusAdd)}><Icon name="plus" size={14} /> Add</button>
            <span class="fb-rule" role="presentation"></span>
            <button type="button" class="fb" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={15} /></button>
            <button type="button" class="fb" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={15} /></button>
            <span class="fb-rule" role="presentation"></span>
            <button type="button" class="fb" class:on={floating.list} aria-pressed={floating.list} aria-label="The list"
              title={floating.list ? 'Hide the list' : 'Show the list'} onclick={() => panel('list')}><Icon name="panelLeft" size={15} /></button>
            <button type="button" class="fb" class:on={floating.inspector} aria-pressed={floating.inspector} aria-label="The inspector"
              title={floating.inspector ? 'Hide the inspector' : 'Show the inspector'} onclick={() => panel('inspector')}><Icon name="panelRight" size={15} /></button>
            {#if autosave.state.status === 'error'}
              <button type="button" class="fb error" title={`Not saved: ${autosave.state.error}. Press to try again`} onclick={() => autosave.flush()}>
                <Icon name="alert" size={13} /> Not saved</button>
            {/if}
            <span class="fb-rule" role="presentation"></span>
            {#if !plate.template}
              <button type="button" class="fb" aria-label="Export" title="Export" onclick={openExport}><Icon name="download" size={15} /></button>
            {/if}
            <button type="button" class="fb" aria-label="Leave focus" title="Leave focus (F or Esc)" onclick={() => setFocus(false)}><Icon name="minimize" size={15} /></button>
          </div>
        {/if}
        {#if stepId && !playing}
          <p class="on-step">{stepName(stepIndex)}: what you add belongs to it</p>
        {/if}
        {#if barShown}
          <!-- the plate's days and the day's steps on one bar; a plate that plays nothing has none, Add holds its first step -->
          <div class="timebar" bind:clientHeight={barHeight}>
            <button type="button" class="play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : moments.length ? 'Play the days and their steps' : 'Play the steps'}
              disabled={sequence.length < 2} onclick={play}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
            <button type="button" class="speed" title="How fast the plate plays" onclick={() => (speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1)}>{speed}×</button>
            <button type="button" class="speed" class:on={loop} aria-pressed={loop} title="Start again from the beginning" onclick={() => (loop = !loop)}>Loop</button>
            {#if moments.length}
              <div class="cursor"><LayerTimeCursor time={time} moments={playedDays} precision={tracked[0]?.track?.precision ?? 'day'}
                zone={tracked[0]?.track?.zone ?? 'UTC'} label="The plate's day"
                onchange={(patch) => { if (playing) stop(); if ('at' in patch && patch.at !== plate.spec.time.at) plate.spec.time.step = null; Object.assign(plate.spec.time, patch); }} /></div>
            {/if}
            <!-- the day itself and its steps, each tile saying how long it holds in the video -->
            <PlateSteps steps={daySteps} current={stepId} dayLabel={at ? momentLabel(at) : 'The page'} elements={plate.spec.elements}
              transitions={transitionsOf(plate.spec).on} daySeconds={daySeconds(plate.spec, at)} dayOwn={!!plate.spec.holds?.[dayOf(at)]}
              plateSeconds={plateSeconds(plate.spec)} ondayhold={holdDay}
              {dayPlayed} dayPicked={(plate.spec.days ?? []).includes(dayOf(at))}
              onplayday={playable ? (on) => (spec.days = pickedDays(spec, dayOf(at), on)) : null}
              caseId={plate.caseId ?? caseId ?? ''} onpick={pickStep} onadd={newStep} onremove={dropStep} onchange={changeStep}
              onmove={(id, index) => (spec.steps = movedStep(spec, at, id, index))} />
          </div>
        {/if}
      </div>

      {#if inspectorShown}
        <div class="dock right" style:width="{layout.inspectorW}px" data-guide="plate.inspector">
          <PanelEdge bind:width={layout.inspectorW} helpers={inspectorWidth} side="left" label="Resize the inspector" />
          <PlateInspector spec={plate.spec} {selection} caseId={plate.caseId ?? caseId ?? ''} {rows} {grounds} {releases} {legend} {framing} {at} moments={playable ? moments : []}
            {place} step={stepIndex >= 0 ? { id: stepId, name: stepName(stepIndex) } : null}
            {overflow} {featurePictures} onpaper={paper} ontheme={applyTheme} onremove={removeElement} onduplicate={duplicate} onorder={restackBy} canorder={(element, by) => stepOf(listed, element.id, by) !== null} ongroup={group} onwayback={readReleases}
            {framingFor} onmapview={mapView} onkeep={keepFraming} plays={!plate.template && sequence.length > 1}
            onsymbol={(style) => (lastSymbol = { ...lastSymbol, ...style })}
            onframe={(element) => (framing = framing === element.id ? '' : element.id)} onlabels={labelFeatures}
            onpoint={(element) => { if (!mainMap(spec)) { toast('Put a map on the page first', 'warn'); return; } placing = { kind: 'callout', id: element.id }; }} />
        </div>
      {/if}
    </div>

    {#if adding}
      <PlateAdd anchor={adding} {placing} template={!!plate.template} onadd={add} onclose={() => (adding = null)} />
    {/if}
  {:else if !caseState.current}
    <NoCase icon="plate" what="lay out a map plate" />
  {:else}
    <div class="start">
      <div class="start-col">
        <div class="start-head">
          <div>
            <h3>Map plates</h3>
            <p>A page laid out round the case's maps, exported as an image, a PDF or a video.</p>
          </div>
          <button class="btn btn-primary" onclick={() => newPlate()}><Icon name="plus" size={15} /> New plate</button>
        </div>
        <p class="hint">A new plate opens on the ground the Map is looking at, with the layers switched on there.</p>
        {#if templates.length}
          <h4>From a template</h4>
          <div class="tiles">
            {#each templates as template (template.id)}
              {@const size = pageSize(template.data?.page)}
              <div class="tile template">
                <button type="button" class="open" onclick={() => newPlate(template)} title="A new plate laid out as this template">
                  <svg class="sketch" viewBox="0 0 {size.width} {size.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                    <rect width={size.width} height={size.height} fill={template.data?.theme?.paper ?? '#ffffff'} />
                    {#each template.data?.elements ?? [] as element (element.id)}
                      <rect x={element.box[0]} y={element.box[1]} width={element.box[2]} height={element.box[3]}
                        fill={TINTS[element.kind] ?? '#9aa3ad'} opacity={element.kind === 'text' ? 0.55 : 0.8} />
                    {/each}
                  </svg>
                  <span class="name">{template.name}</span><span class="said">{PAPERS[template.data?.page?.paper]?.label.split(',')[0] ?? ''}</span></button>
                <button type="button" class="more" aria-label={`Actions for ${template.name}`} title="More"
                  onclick={(event) => (templateMenu = { template, anchor: event.currentTarget })}><Icon name="more" size={13} /></button>
              </div>
            {/each}
          </div>
        {/if}
        <h4>In this case</h4>
        {#if plates.length}
          <div class="tiles">
            {#each plates as row (row.name)}
              <div class="tile">
                <button type="button" class="open" onclick={() => open(row.name)} title={`Open ${row.title}`}>
                  {#if row.thumb}<img src={`${fileUrl(caseId, row.thumb)}?v=${encodeURIComponent(row.updated_at ?? '')}`} alt="" />{:else}<span class="blank"><Icon name="plate" size={22} /></span>{/if}
                  <span class="name">{row.title}</span>
                  <span class="said">{tileSaid(row)}</span></button>
                <button type="button" class="more" aria-label={`Actions for ${row.title}`} title="More" onclick={(event) => (menu = { row, anchor: event.currentTarget })}>
                  <Icon name="more" size={13} /></button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-note">No plate yet.</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if menu}
  <FloatingMenu anchor={menu.anchor} align="end" width={190} label="Plate actions" onclose={() => (menu = null)}>
    <button type="button" class="fm-item" onclick={() => { const row = menu.row; menu = null; open(row.name); }}><Icon name="edit" size={14} /><span class="fm-grow">Open</span></button>
    <button type="button" class="fm-item" onclick={() => { const row = menu.row; menu = null; duplicatePlate(row); }}><Icon name="copy" size={14} /><span class="fm-grow">Duplicate</span></button>
    <button type="button" class="fm-item" onclick={() => { const row = menu.row; menu = null; renaming = { kind: 'plate', row, value: row.title }; }}><Icon name="text" size={14} /><span class="fm-grow">Rename…</span></button>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" onclick={() => { const row = menu.row; menu = null; remove(row); }}><Icon name="trash" size={14} /><span class="fm-grow">Move to the Trash</span></button>
  </FloatingMenu>
{/if}

{#if templateMenu}
  <FloatingMenu anchor={templateMenu.anchor} align="end" width={190} label="Template actions" onclose={() => (templateMenu = null)}>
    <button type="button" class="fm-item" onclick={() => { const { template } = templateMenu; templateMenu = null; newPlate(template); }}><Icon name="plus" size={14} /><span class="fm-grow">New plate from it</span></button>
    <button type="button" class="fm-item" onclick={() => { const { template } = templateMenu; templateMenu = null; editTemplate(template.id); }}><Icon name="edit" size={14} /><span class="fm-grow">Edit the template</span></button>
    <button type="button" class="fm-item" onclick={() => { const { template } = templateMenu; templateMenu = null; renaming = { kind: 'template', template, value: template.name }; }}><Icon name="text" size={14} /><span class="fm-grow">Rename…</span></button>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" onclick={() => { const { template } = templateMenu; templateMenu = null; dropTemplate(template); }}><Icon name="trash" size={14} /><span class="fm-grow">Delete</span></button>
  </FloatingMenu>
{/if}

{#if exporting}
  <PlateExportDialog moments={playedDays} {stepped} {runtime} {progress} past={pastBox} name={plate?.title ?? 'Map plate'} preview={exportPreview} transparent={!!spec?.page?.transparent}
    page={spec?.page} hold={spec ? plateSeconds(spec) : 1} onhold={holdPlate}
    onexport={runExport} oncopy={copyImage} oncancel={stopExport} onclose={() => (exporting = false)} />
{/if}

{#if naming}
  <Modal title="Keep as a template" onclose={() => (naming = null)} width="360px">
    <p class="dialog-note">The layout, its paper and its colours, and the pictures kept inside it, without the ground, the layers or what stands on them.</p>
    <form onsubmit={(event) => { event.preventDefault(); const name = naming.value.trim(); if (name) { naming = null; keepAsTemplate(name); } }}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" aria-label="Template name" bind:value={naming.value} maxlength="120" autofocus />
      <div class="dialog-acts"><button type="button" class="btn" onclick={() => (naming = null)}>Cancel</button>
        <button class="btn btn-primary" disabled={!naming.value.trim()}>Keep</button></div>
    </form>
  </Modal>
{/if}

{#if renaming}
  <Modal title={renaming.kind === 'plate' ? 'Rename the plate' : 'Rename the template'} onclose={() => (renaming = null)} width="360px">
    <form onsubmit={(event) => { event.preventDefault(); const job = renaming; renaming = null;
      if (job.kind === 'plate') renamePlate(job.row, job.value); else renameTemplate(job.template, job.value); }}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" aria-label="New name" bind:value={renaming.value} maxlength="120" autofocus />
      <div class="dialog-acts"><button type="button" class="btn" onclick={() => (renaming = null)}>Cancel</button>
        <button class="btn btn-primary" disabled={!renaming.value.trim()}>Rename</button></div>
    </form>
  </Modal>
{/if}

<style>
  .tool { display: flex; flex-direction: column; height: 100%; }
  .tool:fullscreen { background: var(--bg-0, #0d0f12); }
  .tool-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .title-input { width: 280px; }
  .kind { padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--text-1); font-size: 11px; font-weight: 600; }
  .status { display: flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status.error { color: var(--danger); }
  .spacer { flex: 1; }
  .tool-header .rule { width: 1px; height: 20px; margin: 0 3px; background: var(--border); }
  .add-btn { gap: 5px; }
  .add-btn.on, .toggle.on { color: var(--text-1); }
  .add-btn.on { border-color: var(--accent); background: var(--accent-soft); }
  .toggle { color: var(--text-3); }
  .work { position: relative; flex: 1; min-height: 0; display: flex; }
  .centre { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .dock { position: relative; flex: none; display: flex; min-height: 0; background: var(--bg-1); }
  .dock.left { border-right: 1px solid var(--border); }
  .dock.right { border-left: 1px solid var(--border); }
  /* in focus the panels float over the page rather than push it, and stop above the play bar */
  .work.focus .dock { position: absolute; z-index: 9; top: 62px; bottom: calc(var(--below, 0px) + 12px); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-2); animation: rise .16s ease-out; }
  .work.focus .dock.left { left: 12px; }
  /* the inspector stops over the page's zoom, which stays in reach */
  .work.focus .dock.right { right: 12px; top: 12px; bottom: calc(var(--below, 0px) + 58px); }
  .work.focus .dock > :global(aside) { border-radius: inherit; }
  @keyframes rise { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .focus-bar { position: absolute; top: 12px; left: 12px; z-index: 8; display: flex; align-items: center; gap: 2px; padding: 4px;
    border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--bg-1) 92%, transparent);
    box-shadow: var(--shadow-2); backdrop-filter: blur(8px); animation: rise .16s ease-out; }
  .fb { display: inline-flex; align-items: center; gap: 5px; height: 30px; min-width: 30px; justify-content: center; padding: 0 7px;
    border-radius: 7px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
  .fb:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .fb:disabled { opacity: .35; cursor: default; }
  .fb.on { background: var(--accent-soft); color: var(--text-1); }
  .fb.add { padding: 0 10px; background: var(--accent); color: var(--accent-text); }
  .fb.add:hover { background: var(--accent); filter: brightness(1.08); color: var(--accent-text); }
  .fb.error { color: var(--danger); }
  .fb-rule { width: 1px; height: 18px; margin: 0 3px; background: var(--border); }
  .on-step { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 7; margin: 0; padding: 3px 12px; border-radius: 999px;
    background: var(--accent); color: var(--accent-text); font-size: 11px; font-weight: 600; pointer-events: none; white-space: nowrap; }
  .timebar { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-top: 1px solid var(--border); background: var(--bg-1); }
  .cursor { flex: 1 1 320px; min-width: 220px; max-width: 720px; }
  .timebar > :global(.steps) { flex: 0 1 auto; }
  .cursor + :global(.steps) { padding-left: 10px; border-left: 1px solid var(--border); }
  .cursor :global(.cursor) { padding-left: 0; }
  .play { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: var(--accent-text); cursor: pointer; }
  .play:disabled { opacity: .4; cursor: default; }
  .speed { min-width: 34px; height: 26px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .speed:hover, .speed.on { border-color: var(--accent); color: var(--text-1); }
  .speed.on { background: var(--accent-soft); }
  .start { flex: 1; min-height: 0; overflow: auto; }
  .start-col { max-width: 860px; margin: 0 auto; padding: 28px 20px; }
  .start-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .start-head h3 { margin: 0 0 4px; }
  .start-head p, .hint, .empty-note { margin: 0; color: var(--text-3); font-size: var(--fs-sm); }
  .hint { margin: 8px 0 18px; font-size: var(--fs-xs); }
  h4 { margin: 18px 0 8px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .tile { position: relative; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); overflow: hidden; }
  .tile:hover { border-color: var(--accent); }
  .open { display: flex; flex-direction: column; width: 100%; padding: 0; cursor: pointer; text-align: left; }
  /* the whole page shows, whatever its shape, on the tile's ground */
  .open img, .blank, .sketch { display: grid; place-items: center; width: 100%; aspect-ratio: 1.414; object-fit: contain; background: var(--bg-2); color: var(--text-3); }
  .name { padding: 7px 9px 0; color: var(--text-1); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .said { padding: 1px 9px 7px; color: var(--text-3); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-sm);
    background: rgba(0, 0, 0, .6); color: #fff; cursor: pointer; }
  .dialog-note { margin: 0 0 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .dialog-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  form .input { width: 100%; }
</style>
