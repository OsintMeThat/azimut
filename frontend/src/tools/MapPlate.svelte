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
   * A template is the same page with the data taken out. A plate can be kept as one,
   * and a new plate opened from one; Settings lists them too, and editing one opens
   * it here, over the Map's ground.
   */
  import { tick, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import NoCase from '../components/NoCase.svelte';
  import Modal from '../components/Modal.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import PlatePage from './plate/PlatePage.svelte';
  import PlateElements from './plate/PlateElements.svelte';
  import PlateInspector from './plate/PlateInspector.svelte';
  import PlateExportDialog from './plate/PlateExportDialog.svelte';
  import PlateSteps from './plate/PlateSteps.svelte';
  import LayerTimeCursor from './satellite/LayerTimeCursor.svelte';
  import { api } from '../lib/api.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { caseState, deleteTemplate, prefs, saveTemplate, toast, uiState } from '../lib/state.svelte.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { categoryColour } from '../lib/map/addedLayers.js';
  import { NEW_COLOUR, badgeImage, personalMarkerImage } from '../lib/map/addedLayer.js';
  import { layerPalette } from '../lib/map/layerPalette.svelte.js';
  import { isBadge } from '../lib/map/markerGlyphs.js';
  import symbols from '../lib/map/layerSymbols.json';
  import { asOf, hasHistory, isTracked, momentLabel, stateAt } from '../lib/map/layerHistory.js';
  import { revealPlates } from '../lib/plateExport.js';
  import '../lib/plateFontFaces.js';
  import { plateCredits } from '../lib/plate/credits.js';
  import { canvasBlob, composePage, copyPage, evolutionSheet, postExport, QUALITIES, scaleFor, scaleForWidth } from '../lib/plate/exportPlate.js';
  import { MAP_KINDS, ON_THE_GROUND, PX_PER_MM, SIGNATURE, THEMES, inLook, addStep, bornAt, currentStep, dayOf, fromTemplate, hasSteps, houseLayout,
    labelBox, mainMap, mapsFirst, movedStep, newId, onPaper, pageSize, placeOf, shownOn, stepsOf, templateOf, textMeasurer, withoutStep } from '../lib/plate/page.js';
  import { FIRST_SECONDS, beatClips, beats, clipRange, playDays, posterKey, posterOf, totalSeconds } from '../lib/plate/clip.js';
  import { legendRows } from '../lib/plate/legend.js';
  import { numbered, pasted, placeLabels, tableRows } from '../lib/plate/arrange.js';
  import { drawOver, pictureKey } from '../lib/plate/draw.js';
  import { inFrame, project, scaleRatio } from '../lib/plate/geo.js';
  import { WAYBACK_ID } from '../lib/wayback.js';

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
  let overflow = $state(new Set());
  let menu = $state(null);
  let templateMenu = $state(null);
  const handles = new Map();
  let images = $state(new Map());

  // What the plate offers to draw its maps on, read once: free grounds, no quota spent.
  const FREE = ['esri-world-imagery', WAYBACK_ID, 'osm', 'opentopomap'];
  const grounds = $derived([['plain', 'Plain'], ['plain-dark', 'Plain, dark'],
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
   * is; before the Map has looked anywhere, the ground its layers cover.
   */
  function mapGround(names = mapLayers()) {
    const view = uiState.mapView;
    if (view) return { lat: view.lat, lon: view.lon, zoom: Math.max(0, (view.zoom ?? 10) - 1), bearing: -(view.bearing ?? 0) };
    return framed(rows.filter((row) => names.includes(row.name)).map((row) => row.bbox).filter(Boolean))
      ?? { lat: 48.85, lon: 2.35, zoom: 9, bearing: 0 };
  }
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
    saved = JSON.stringify([next.title, next.spec]);
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
      openSpec({ name: loaded.name, title: loaded.title, spec: loaded.spec });
    } catch (error) { toast(error.message, 'danger'); }
  }

  async function editTemplate(id) {
    await readTemplates();
    const found = templates.find((item) => item.id === id);
    if (!found) { toast('That template is no longer kept', 'warn'); return; }
    openSpec({ template: { id: found.id, name: found.name }, title: found.name,
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
    untrack(() => editTemplate(id));
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

  async function close() {
    await autosave.flush();
    plate = null;
    tuckSidebar(false);
    refresh();
  }

  async function remove(row) {
    try {
      await api.del(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}`);
      toast(`“${row.title}” is in the Trash`, 'ok');
      refresh();
    } catch (error) { toast(error.message, 'danger'); }
  }

  /** A copy of a plate, to make a variant of it: the same page under the next free name. */
  async function duplicatePlate(row) {
    try {
      const loaded = await api.get(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}`);
      const answer = await api.post(`/api/cases/${caseId}/map-plates`, { title: `${row.title} copy`, spec: loaded.spec });
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
  const autosave = createAutosave({ write: () => write() });
  $effect(() => {
    if (!plate) return;
    const signature = JSON.stringify([plate.title, plate.spec]);
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
    const signature = JSON.stringify([doc.title, doc.spec]);
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
    saved = JSON.stringify([answer.title, doc.spec]);
    if (doc.name !== answer.name || doc.title !== answer.title) {
      doc.name = answer.name;
      doc.title = answer.title;
      titleField = answer.title;
      saved = JSON.stringify([doc.title, doc.spec]);
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
  function keepPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!plate?.name || plate.template || !plate.caseId || exporting || playing) return;
      const { name, caseId: owner } = plate;
      try {
        // the page as it shows, on the plate's own day
        const canvas = await render(160 / pageSize(plate.spec.page).width, undefined, { quick: true });
        const blob = await canvasBlob(canvas);
        const body = new FormData();
        body.append('file', blob, 'preview.png');
        if (plate?.name === name) await api.put(`/api/cases/${owner}/map-plates/${encodeURIComponent(name)}/thumb`, body);
      } catch { /* the list shows the plate without its picture */ }
    }, 4000);
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
    const now = JSON.stringify(plate.spec);
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
  const time = $derived(exportTime ?? (playBeat ? { ...(spec?.time ?? {}), at: playBeat.day } : spec?.time) ?? { at: null, trail: true, since: null, window: 7 });
  const at = $derived(time.at ?? null);

  // -- the steps of the day ------------------------------------------------------------

  const stepped = $derived(!!spec && hasSteps(spec));
  /** The step shown: the play's, an export's, else the plate's own, while its day holds it. */
  const stepId = $derived(playBeat ? playBeat.step : exportTime ? exportStep : currentStep(spec, at)?.id ?? null);
  const place = $derived(spec ? placeOf(spec, at, stepId) : null);
  const daySteps = $derived(spec ? stepsOf(spec, at) : []);
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
  const sequence = $derived(spec ? beats(spec, playable ? playDays(spec, moments) : [at], 1100) : []);
  /** How long a played export runs over `days`, each day held `interval` milliseconds. */
  const runtime = (days, interval) => totalSeconds(beats(spec, playable ? playDays(spec, days) : [at], interval));

  function changeStep(id, patch) {
    const list = stepsOf(spec, at).map((item) => (item.id === id ? { ...item, ...patch } : item));
    spec.steps = { ...(spec.steps ?? {}), [dayOf(at)]: list };
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
      const held = (beat.step ? beat.seconds * 1000 : 1100) / speed;
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
    const was = placing;
    placing = null;
    const main = mainMap(spec);
    const placed = { label: 'label', number: 'label', arrow: 'arrow', measure: 'measure', ring: 'ring', cone: 'cone', zone: 'zone', spotlight: 'zone' };
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
    if (kind === 'label') {
      element = { id: newId('label'), kind: 'label', of, at: point.map((value) => Math.round(value * 1e6) / 1e6), box: [page[0] + 3, page[1] - 9, 28, 6],
        text: preset === 'number' ? 'What this number marks' : 'Label', size: 9, weight: 600, style: preset === 'number' ? 'number' : 'bubble', ...day };
      element.box = labelBox(element, measure);
      if (preset === 'number') element.box = [page[0] + 2, page[1] - 8, element.box[2], element.box[3]];
    } else if (kind === 'arrow') element = { id: newId('arrow'), kind: 'arrow', of, at: point, to, box: [0, 0, 1, 1], width: 1.2, ...day };
    else if (kind === 'measure') element = { id: newId('measure'), kind: 'measure', of, at: point, to, box: [0, 0, 1, 1], width: 1, line: 'dashed', ...day };
    else if (kind === 'ring') {
      const km = Math.max(0.01, Math.round((distanceKm(point, to)) * 100) / 100);
      element = { id: newId('ring'), kind: 'ring', of, at: point, box: [0, 0, 1, 1], radii: [km, km * 2, km * 3].map((value) => Math.round(value * 100) / 100), look: 'outline', width: 1, ...day };
    } else if (kind === 'cone') {
      element = { id: newId('cone'), kind: 'cone', of, at: point, box: [0, 0, 1, 1], bearing: Math.round(bearing(point, to)), spread: 60,
        reach: Math.max(0.01, Math.round(distanceKm(point, to) * 100) / 100), look: 'fill', width: 1, ...day };
    } else if (kind === 'zone') {
      element = { id: newId('zone'), kind: 'zone', of, points, box: [0, 0, 1, 1], look: preset === 'spotlight' ? 'outline' : 'hatch', width: 1,
        ...(preset === 'spotlight' ? { mask: { on: true, darkness: 0.55 } } : {}), ...day };
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
    const copies = pasted([element], mainMap(spec)?.id, new Set(spec.elements.map((item) => item.id)));
    if (copies.length) put(...copies);
  }
  function order(element, step) {
    const list = [...spec.elements];
    const index = list.indexOf(element);
    const to = Math.max(0, Math.min(list.length - 1, index + step));
    list.splice(index, 1);
    list.splice(to, 0, element);
    spec.elements = mapsFirst(list);
  }
  /** The list's drag: `index` is the place in the list, top first, which is the page's order turned over. */
  function restack(id, index) {
    const shown = [...spec.elements].reverse();
    const from = shown.findIndex((item) => item.id === id);
    if (from < 0) return;
    const [element] = shown.splice(from, 1);
    shown.splice(index > from ? index - 1 : index, 0, element);
    spec.elements = mapsFirst(shown.reverse());
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
      if (!standing || !name || (key && labelled.has(key)) || !inFrame(standing.geometry, live.view, live.frame, 0)) continue;
      const point = anchor(standing.geometry);
      if (!point) continue;
      const [px, py] = project(live.view, live.frame, point);
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
        if (element.locked || ON_THE_GROUND.includes(element.kind)) continue;
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
        rows, collection: (name) => addedLayers.collection(name), view: live?.view, frame: live?.frame,
        days: legendDays ?? [at],
        standing: (row, feature, day) => (isTracked(row) && hasHistory(feature) ? stateAt(feature, day ?? '￿') : feature),
        past: (row, collection, day) => (isTracked(row) ? asOf(collection, day, { trail: time.trail !== false, since: time.since ?? null, window: time.window ?? 7 }).features : []),
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
  function markerImage(symbol, colour, marks = {}) {
    const key = `${symbol}|${colour}|${marks.status ?? ''}`;
    if (markers.has(key)) return markers.get(key);
    const data = isBadge(symbol) ? badgeImage(symbol, colour, marks) : personalMarkerImage(symbol, colour, marks);
    let canvas = null;
    if (data) {
      canvas = document.createElement('canvas');
      canvas.width = data.width; canvas.height = data.height;
      canvas.getContext('2d')?.putImageData(data, 0, 0);
    }
    markers.set(key, canvas);
    return canvas;
  }

  const decor = $derived({ legend, credits, images, markerImage, tokens, imperial: prefs.units === 'imperial', numbered: numbers,
    numberOf: (id) => numbers.find((item) => item.id === id)?.number, tables, moments, dayLabel: momentLabel, refShown, place });

  // -- export --------------------------------------------------------------------------

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * The page drawn at `scale` canvas pixels a millimetre, on the day `day` and its
   * step `step` (`day` undefined: the plate's own day and step, as shown).
   */
  async function render(scale, day, { quick = false, transparent = false, step = null } = {}) {
    if (day !== undefined) { exportTime = { ...spec.time, at: day }; exportStep = step; await tick(); await wait(quick ? 0 : 250); }
    const maps = {};
    const ratio = quick ? Math.min(2, window.devicePixelRatio || 1) : scale / PX_PER_MM;
    for (const element of elements.filter((item) => item.kind === 'map' || item.kind === 'inset')) {
      const handle = handles.get(element.id);
      if (handle && !element.hidden && shownOn(element, at, place)) maps[element.id] = await handle.snapshot(ratio);
    }
    const page = transparent ? { ...spec, page: { ...spec.page, transparent: true } } : spec;
    return composePage(page, scale, { ...decor, views, maps, at: (exportTime ?? time).at,
      tokens: { ...tokens, date: (exportTime ?? time).at } });
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

  async function openExport() {
    exporting = true;
    exportPreview = '';
    await tick();
    try {
      const canvas = await render(280 / pageSize(spec.page).width, undefined, { quick: true });
      exportPreview = canvas.toDataURL('image/png');
    } catch { exportPreview = ''; }
  }

  async function runExport({ format, quality, width, days, interval, filename, pixels = 0, transparent = false }) {
    const { width: widthMm, height: heightMm } = pageSize(spec.page);
    const name = filename || plate.title;
    framing = ''; selection = [];
    try {
      let answer;
      if (format === 'png' || format === 'pdf') {
        progress = 'Drawing the page…';
        const scale = format === 'png' && pixels ? scaleForWidth(spec, pixels) : scaleFor(spec, QUALITIES[quality].dpi);
        const canvas = await render(scale, undefined, { transparent: format === 'png' && transparent });
        progress = 'Writing…';
        answer = await postExport(caseId, { format, frames: [await canvasBlob(canvas)], widthMm, heightMm, transparent: format === 'png' && transparent,
          filename: name === plate.title ? [name, spec.time.at?.replace('T', ' ').replaceAll(':', 'h'), stepIndex >= 0 ? stepName(stepIndex) : '']
            .filter(Boolean).join(' ') : name });
      } else {
        const picked = playable ? playDays(spec, days.slice(0, 120)) : [at];
        legendDays = picked;
        if (format === 'sheet') {
          const scale = scaleForWidth(spec, 900);
          const pages = [];
          for (const [index, day] of picked.entries()) {
            progress = `Drawing ${momentLabel(day) || 'now'} (${index + 1} of ${picked.length})…`;
            pages.push(await render(scale, day));
          }
          progress = 'Writing…';
          const sheet = evolutionSheet(pages, picked.map((day) => momentLabel(day) || 'Now'), spec.theme);
          answer = await postExport(caseId, { format: 'png', frames: [await canvasBlob(sheet)], widthMm, heightMm, filename: `${name} evolution` });
        } else {
          // each day, then each of its steps; a step's clips run over its picture in an MP4
          const scale = scaleForWidth(spec, width);
          const list = stepped ? beats(spec, picked, interval).slice(0, 120) : picked.map((day) => ({ day, step: null, seconds: interval / 1000 }));
          const frames = [];
          const sent = [];
          const overs = [];
          for (const [index, beat] of list.entries()) {
            progress = `Drawing ${momentLabel(beat.day) || 'the page'}${beat.step ? `, ${stepName(stepsOf(spec, beat.day).findIndex((item) => item.id === beat.step), beat.day)}` : ''} (${index + 1} of ${list.length})…`;
            frames.push(await canvasBlob(await render(scale, beat.day, { step: beat.step }), 'image/jpeg', 0.9));
            const clips = format === 'mp4' ? beatClips(spec, beat).map((element) => {
              const [start, end] = clipRange(element);
              const [x, y, w, h] = element.box.map((value) => Math.round(value * scale));
              return { src: element.src, start, end, box: [Math.max(0, x), Math.max(0, y), Math.max(2, w), Math.max(2, h)], fit: element.fit ?? 'contain',
                sound: !!element.sound, volume: element.volume ?? 1 };
            }) : [];
            if (clips.length) overs.push(await canvasBlob(overPage(scale)));
            sent.push({ seconds: Math.round(beat.seconds * 1000) / 1000, ...(clips.length ? { clips, over: overs.length - 1 } : {}) });
          }
          progress = format === 'mp4' && overs.length ? 'Making the video, clips included…' : 'Writing…';
          answer = await postExport(caseId, { format, frames, widthMm, heightMm, interval, filename: name, beats: stepped ? sent : null, overs });
        }
      }
      toast(`${answer.file} written`, 'ok', 5200, { label: 'Show', onClick: () => revealPlates(caseId).catch((error) => toast(error.message, 'warn')) });
    } catch (error) {
      toast(error.message || 'The plate could not be exported', 'danger', 6000);
      throw error;
    } finally {
      exportTime = null;
      exportStep = null;
      legendDays = null;
      progress = '';
    }
  }

  async function copyImage() {
    try {
      const canvas = await render(scaleForWidth(spec, 1600));
      await copyPage(canvas);
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
  /** A template drawn as its page: each box in the colour of what it holds. */
  const TINTS = { map: '#8fb2c9', inset: '#b8cbd8', legend: '#d9c8a5', text: '#5d6470', credits: '#a0a0a0', image: '#c2a5d9', scale: '#5d6470', north: '#5d6470' };
</script>

<svelte:window onkeydown={keydown} onpointerdowncapture={press} />

<div class="tool">
  {#if plate}
    <div class="tool-header">
      <button class="btn btn-ghost btn-sm" title="Back to the plates" aria-label="Back to the plates" onclick={close}><Icon name="chevronLeft" size={14} /></button>
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
      <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={15} /></button>
      <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={15} /></button>
      {#if !plate.template}
        <button class="btn btn-sm" onclick={() => (naming = { value: plate.title })} title="Keep this layout, without its data, to start other plates from">
          <Icon name="save" size={14} /> Keep as template</button>
        <button class="btn btn-primary btn-sm" onclick={openExport}><Icon name="download" size={14} /> Export</button>
      {:else}
        <button class="btn btn-primary btn-sm" onclick={async () => { await autosave.flush(); plate = null; tuckSidebar(false); uiState.tool = 'settings'; }}>
          <Icon name="check" size={14} /> Done</button>
      {/if}
    </div>

    <div class="work">
      <PlateElements spec={plate.spec} bind:selection {at} {place} {playable} bind:ghosts {placing} {tokens} onadd={add} onrestack={restack} />

      <div class="centre">
        {#key opened}
          <PlatePage spec={plate.spec} bind:selection bind:framing {placing} onplace={placed} caseId={plate.caseId ?? caseId ?? ''} {rows} {providers} {relief}
            {time} stepPlace={place} {playing} {speed} bind:views {decor} bind:overflow {grounds} ghosts={ghosts && playable}
            onmap={(id, handle) => handles.set(id, handle)} />
        {/key}
        {#if stepId && !playing}
          <p class="on-step">{stepName(stepIndex)}: what you add belongs to it</p>
        {/if}
        {#if !plate.template}
          {#if daySteps.length}
            <PlateSteps steps={daySteps} current={stepId} dayLabel={at ? momentLabel(at) : playable ? 'Now' : 'The page'} elements={plate.spec.elements}
              caseId={plate.caseId ?? caseId ?? ''} onpick={pickStep} onadd={newStep} onremove={dropStep} onchange={changeStep}
              onmove={(id, index) => (spec.steps = movedStep(spec, at, id, index))} />
          {/if}
          <div class="timebar" class:slim={!moments.length}>
            {#if moments.length || stepped}
              <button type="button" class="play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : moments.length ? 'Play the days and their steps' : 'Play the steps'}
                disabled={sequence.length < 2} onclick={play}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
              <button type="button" class="speed" title="How fast the plate plays" onclick={() => (speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1)}>{speed}×</button>
              <button type="button" class="speed" class:on={loop} aria-pressed={loop} title="Start again from the beginning" onclick={() => (loop = !loop)}>Loop</button>
            {/if}
            {#if moments.length}
              <div class="cursor"><LayerTimeCursor time={time} {moments} precision={tracked[0]?.track?.precision ?? 'day'}
                zone={tracked[0]?.track?.zone ?? 'UTC'} label="The plate's day"
                onchange={(patch) => { if (playing) stop(); if ('at' in patch && patch.at !== plate.spec.time.at) plate.spec.time.step = null; Object.assign(plate.spec.time, patch); }} /></div>
            {:else}<span class="spacer"></span>{/if}
            {#if !daySteps.length}
              <button type="button" class="speed add-step" onclick={newStep}
                title="Add a step, played after the day"><Icon name="plus" size={11} /> Step</button>
            {/if}
          </div>
        {/if}
      </div>

      <PlateInspector spec={plate.spec} {selection} caseId={plate.caseId ?? caseId ?? ''} {rows} {grounds} {releases} {legend} {framing} {at} moments={playable ? moments : []}
        {place} step={stepIndex >= 0 ? { id: stepId, name: stepName(stepIndex) } : null}
        {overflow} {featurePictures} onpaper={paper} ontheme={applyTheme} onremove={removeElement} onduplicate={duplicate} onorder={order} ongroup={group} onwayback={readReleases}
        onframe={(element) => (framing = framing === element.id ? '' : element.id)} onlabels={labelFeatures}
        onpoint={(element) => { if (!mainMap(spec)) { toast('Put a map on the page first', 'warn'); return; } placing = { kind: 'callout', id: element.id }; }} />
    </div>
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
                  <span class="name">{template.name}</span></button>
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
                <button type="button" class="open" onclick={() => open(row.name)}>
                  {#if row.thumb}<img src={fileUrl(caseId, row.thumb)} alt="" />{:else}<span class="blank"><Icon name="plate" size={22} /></span>{/if}
                  <span class="name">{row.title}</span></button>
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
  <PlateExportDialog {moments} {stepped} {runtime} {progress} name={plate?.title ?? 'Map plate'} preview={exportPreview} transparent={!!spec?.page?.transparent}
    onexport={runExport} oncopy={copyImage} onclose={() => (exporting = false)} />
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
  .tool-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .title-input { width: 280px; }
  .kind { padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--text-1); font-size: 11px; font-weight: 600; }
  .status { display: flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status.error { color: var(--danger); }
  .spacer { flex: 1; }
  .work { flex: 1; min-height: 0; display: flex; }
  .centre { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .on-step { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 7; margin: 0; padding: 3px 12px; border-radius: 999px;
    background: var(--accent); color: var(--accent-text); font-size: 11px; font-weight: 600; pointer-events: none; white-space: nowrap; }
  .timebar { display: flex; align-items: center; gap: 8px; padding: 6px 14px 8px; border-top: 1px solid var(--border); background: var(--bg-1); }
  .timebar.slim { padding-top: 5px; padding-bottom: 5px; }
  .cursor { flex: 1; min-width: 0; max-width: 720px; }
  .add-step { display: inline-flex; align-items: center; gap: 3px; flex: none; }
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
  .open img, .blank, .sketch { display: grid; place-items: center; width: 100%; aspect-ratio: 1.414; object-fit: cover; background: var(--bg-2); color: var(--text-3); }
  .name { padding: 7px 9px; color: var(--text-1); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-sm);
    background: rgba(0, 0, 0, .6); color: #fff; cursor: pointer; }
  .dialog-note { margin: 0 0 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .dialog-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  form .input { width: 100%; }
</style>
