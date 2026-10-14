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
   * A template is the same page with the data taken out. A plate can be kept as one,
   * and a new plate opened from one; Settings lists them, and editing one opens it
   * here, over the Map's ground.
   */
  import { tick, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import NoCase from '../components/NoCase.svelte';
  import Modal from '../components/Modal.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import PlatePage from './plate/PlatePage.svelte';
  import PlateInspector from './plate/PlateInspector.svelte';
  import PlateExportDialog from './plate/PlateExportDialog.svelte';
  import LayerTimeCursor from './satellite/LayerTimeCursor.svelte';
  import { api } from '../lib/api.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { caseState, prefs, saveTemplate, toast, uiState } from '../lib/state.svelte.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { categoryColour } from '../lib/map/addedLayers.js';
  import { NEW_COLOUR, badgeImage, kindOf, personalMarkerImage } from '../lib/map/addedLayer.js';
  import { layerPalette } from '../lib/map/layerPalette.svelte.js';
  import { isBadge } from '../lib/map/markerGlyphs.js';
  import { asOf, hasHistory, isTracked, momentLabel, stateAt } from '../lib/map/layerHistory.js';
  import { revealPlates } from '../lib/plateExport.js';
  import { plateCredits } from '../lib/plate/credits.js';
  import { canvasBlob, composePage, evolutionSheet, postExport, QUALITIES, scaleFor, scaleForWidth } from '../lib/plate/exportPlate.js';
  import { PX_PER_MM, KIND_LABELS, fillTokens, fromTemplate, labelBox, houseLayout, mainMap, newId, onPaper, pageSize, templateOf } from '../lib/plate/page.js';
  import { project } from '../lib/plate/geo.js';

  const caseId = $derived(caseState.current?.id ?? null);
  $effect(() => addedLayers.load(caseId, caseState.rev));
  $effect(() => layerPalette.load(caseId));
  const rows = $derived(addedLayers.rows);

  /** `{ name, title, spec }` of the open plate, `{ template: { id, name }, title, spec }` of a template, or null. */
  let plate = $state(null);
  let titleField = $state('');
  let selected = $state('');
  let framing = $state('');
  let placing = $state(null);
  let views = $state({});
  let plates = $state([]);
  let templates = $state([]);
  let providers = $state([]);
  let relief = $state(null);
  let exporting = $state(false);
  let progress = $state('');
  /** The day an export is drawing, ahead of the plate's own. */
  let exportTime = $state(null);
  let naming = $state(null);
  let playing = $state(false);
  let menu = $state(null);
  const handles = new Map();
  let images = $state(new Map());

  // What the plate offers to draw its maps on, read once: free grounds, no quota spent.
  const FREE = ['esri-world-imagery', 'osm', 'opentopomap'];
  const grounds = $derived([['plain', 'Plain'], ['plain-dark', 'Plain, dark'],
    ...providers.filter((entry) => FREE.includes(entry.id)).map((entry) => [entry.id, entry.label ?? entry.id])]);
  let asked = false;
  $effect(() => {
    if (uiState.tool !== 'plate' || asked) return;
    asked = true;
    api.get('/api/satellite/providers').then((list) => { providers = Array.isArray(list) ? list : []; }, () => {});
    api.get('/api/terrain/sources').then((info) => { relief = info; }, () => {});
  });

  // -- the list, and opening ---------------------------------------------------------

  async function refresh() {
    if (!caseId) { plates = []; return; }
    try { plates = await api.get(`/api/cases/${caseId}/map-plates`); } catch { plates = []; }
  }
  async function readTemplates() {
    try { templates = (await api.get('/api/templates')).map ?? []; } catch { templates = []; }
  }
  $effect(() => { if (uiState.tool === 'plate') untrack(() => { refresh(); readTemplates(); }); });
  $effect(() => { void caseId; untrack(() => { autosave.flush(); plate = null; refresh(); }); });

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
    selected = ''; framing = ''; placing = null; views = {}; handles.clear();
    history = []; future = [];
    plate = next;
    titleField = next.title;
    saved = JSON.stringify([next.title, next.spec]);
    remember();
  }

  function newPlate(template = null) {
    const spec = template ? fromTemplate(template.data, { view: mapGround(), layers: mapLayers() })
      : houseLayout({ view: mapGround(), layers: mapLayers(), title: caseState.current?.name ?? '' });
    openSpec({ name: null, title: 'Map plate', spec });
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

  // Handed over from Files, the Board or Settings.
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

  async function close() {
    await autosave.flush();
    plate = null;
    refresh();
  }

  async function remove(row) {
    try {
      await api.del(`/api/cases/${caseId}/map-plates/${encodeURIComponent(row.name)}`);
      toast(`“${row.title}” is in the Trash`, 'ok');
      refresh();
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

  async function write() {
    if (!plate) return;
    const signature = JSON.stringify([plate.title, plate.spec]);
    if (signature === saved) return;
    if (plate.template) {
      await saveTemplate('map', { id: plate.template.id, name: plate.title, data: templateOf(plate.spec) });
      saved = signature;
      return;
    }
    if (!caseId) return;
    const answer = await api.post(`/api/cases/${caseId}/map-plates`, {
      title: plate.title, spec: plate.spec, ...(plate.name ? { rename_from: plate.name } : {}) });
    saved = JSON.stringify([answer.title, plate.spec]);
    if (plate.name !== answer.name || plate.title !== answer.title) {
      plate.name = answer.name;
      plate.title = answer.title;
      titleField = answer.title;
      saved = JSON.stringify([plate.title, plate.spec]);
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
      if (!plate?.name || plate.template || !caseId || exporting) return;
      const name = plate.name;
      try {
        // the page as it shows, on the plate's own day
        const canvas = await render(160 / pageSize(plate.spec.page).width, undefined, { quick: true });
        const blob = await canvasBlob(canvas);
        const body = new FormData();
        body.append('file', blob, 'preview.png');
        if (plate?.name === name) await api.put(`/api/cases/${caseId}/map-plates/${encodeURIComponent(name)}/thumb`, body);
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
    future = [JSON.stringify(plate.spec), ...future];
    last = history.at(-1);
    history = history.slice(0, -1);
    plate.spec = JSON.parse(last);
    canUndo = history.length > 0; canRedo = true;
  }
  function redo() {
    if (!future.length || !plate) return;
    history = [...history, JSON.stringify(plate.spec)];
    last = future[0];
    future = future.slice(1);
    plate.spec = JSON.parse(last);
    canUndo = true; canRedo = future.length > 0;
  }

  // -- the page's elements -------------------------------------------------------------

  const spec = $derived(plate?.spec ?? null);
  const elements = $derived(spec?.elements ?? []);

  function add(kind) {
    if (!spec) return;
    if (kind === 'label' || kind === 'arrow') {
      if (!mainMap(spec)) { toast('Put a map on the page first', 'warn'); return; }
      placing = { kind };
      return;
    }
    const { width, height } = pageSize(spec.page);
    const main = mainMap(spec);
    const of = main?.id;
    const needsMap = ['inset', 'legend', 'scale', 'north', 'credits'].includes(kind);
    if (needsMap && !of) { toast('Put a map on the page first', 'warn'); return; }
    const [mx, my, mw, mh] = main?.box ?? [10, 10, width - 20, height - 20];
    const boxes = {
      map: [width * 0.3, height * 0.3, width * 0.4, height * 0.4],
      inset: [mx + mw - 52, my + mh - 42, 48, 38],
      legend: [mx + 4, my + 4, 55, 40],
      text: [width / 2 - 40, height / 2 - 5, 80, 10],
      scale: [mx + 4, my + mh - 10, 40, 6],
      north: [mx + mw - 12, my + 4, 8, 12],
      image: [width / 2 - 25, height / 2 - 20, 50, 40],
      credits: [mx, my + mh + 1, mw, 4],
    };
    const element = { id: newId(kind), kind, box: boxes[kind].map((value) => Math.round(value * 10) / 10),
      ...(needsMap ? { of } : {}) };
    if (kind === 'map') Object.assign(element, { view: { ...(main?.view ?? mapGround()) }, basemap: 'plain', overlays: ['relief'], layers: [], grid: 'none' });
    if (kind === 'text') Object.assign(element, { text: 'Text', size: 11, weight: 400, align: 'left' });
    if (kind === 'legend') Object.assign(element, { size: 8, border: true, fill: spec.theme.paper });
    if (kind === 'inset') Object.assign(element, { border: true, zoom: null });
    if (kind === 'scale') Object.assign(element, { fill: spec.theme.paper });
    if (kind === 'credits') Object.assign(element, { size: 5.5, align: 'right' });
    spec.elements.push(element);
    selected = element.id;
  }

  /** A label or an arrow, placed by a press on a map. */
  function placed({ map, at, to, page }) {
    const kind = placing?.kind;
    placing = null;
    if (kind === 'label') {
      const element = { id: newId('label'), kind: 'label', of: map.id, at: at.map((value) => Math.round(value * 1e6) / 1e6),
        box: [page[0] + 3, page[1] - 9, 28, 6], text: 'Label', size: 9, weight: 600, style: 'bubble' };
      element.box = labelBox(element);
      spec.elements.push(element);
      selected = element.id;
    } else if (kind === 'arrow') {
      const element = { id: newId('arrow'), kind: 'arrow', of: map.id, at, to, box: [0, 0, 1, 1], width: 1.2 };
      spec.elements.push(element);
      selected = element.id;
    }
  }

  function removeElement(element) {
    const dependants = element.kind === 'map' ? spec.elements.filter((item) => item.of === element.id) : [];
    spec.elements = spec.elements.filter((item) => item.id !== element.id && !dependants.includes(item));
    if (selected === element.id) selected = '';
  }
  function duplicate(element) {
    const copy = { ...JSON.parse(JSON.stringify(element)), id: newId(element.kind) };
    copy.box = [copy.box[0] + 4, copy.box[1] + 4, copy.box[2], copy.box[3]];
    spec.elements.push(copy);
    selected = copy.id;
  }
  function order(element, step) {
    const list = [...spec.elements];
    const at = list.indexOf(element);
    const to = Math.max(0, Math.min(list.length - 1, at + step));
    list.splice(at, 1);
    list.splice(to, 0, element);
    spec.elements = list;
  }
  function paper(page) {
    plate.spec = onPaper(plate.spec, page);
  }

  /** A label for every named feature of a layer the map shows, beside it, each moved by hand afterwards. */
  async function labelFeatures(map, row) {
    const live = views[map.id];
    if (!live) return;
    let collection;
    try { collection = await addedLayers.drawing(caseId, row.name); } catch { return; }
    const at = spec.time?.at ?? '￿';
    const added = [];
    for (const feature of collection.features ?? []) {
      const standing = isTracked(row) && hasHistory(feature) ? stateAt(feature, at) : feature;
      const name = String(standing?.properties?.name ?? '').trim();
      if (!standing || !name) continue;
      const point = anchor(standing.geometry);
      if (!point) continue;
      const [px, py] = project(live.view, live.frame, point);
      if (px < 0 || py < 0 || px > live.frame.width || py > live.frame.height) continue;
      const x = map.box[0] + px / PX_PER_MM;
      const y = map.box[1] + py / PX_PER_MM;
      const width = Math.min(60, Math.max(10, name.length * 1.7 + 3));
      added.push({ id: newId('label'), kind: 'label', of: map.id, at: point.map((value) => Math.round(value * 1e6) / 1e6),
        box: [x + 2, y - 7, width, 5], text: name, size: 7.5, weight: 600, style: 'plain' });
      if (added.length >= 40) break;
    }
    if (!added.length) { toast('No named feature of this layer is on the map', 'info'); return; }
    spec.elements.push(...added);
    toast(`${added.length} labels added; drag them where they read best`, 'ok', 4000);
  }

  function anchor(geometry) {
    const walk = (node) => (typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk));
    const points = walk(geometry?.coordinates);
    if (!points.length) return null;
    if (geometry.type === 'Point') return points[0];
    if (String(geometry.type).includes('Line')) return points[Math.floor(points.length / 2)];
    return [points.reduce((sum, [lon]) => sum + lon, 0) / points.length, points.reduce((sum, [, lat]) => sum + lat, 0) / points.length];
  }

  function keydown(event) {
    if (uiState.tool !== 'plate' || !plate) return;
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (typing) return;
    if (event.key === 'Escape' && placing) { placing = null; return; }
    const element = spec.elements.find((item) => item.id === selected);
    if (!element) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && !(element.kind === 'credits' && spec.elements.filter((item) => item.kind === 'credits').length < 2)) {
      event.preventDefault(); removeElement(element);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && element.kind !== 'map') {
      event.preventDefault(); duplicate(element);
    } else if (event.key.startsWith('Arrow') && element.kind !== 'arrow') {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      element.box = [element.box[0] + dx, element.box[1] + dy, element.box[2], element.box[3]];
    }
  }

  // -- what the page shows beside its maps --------------------------------------------

  /** The plate's tracked layers, on any of its maps. */
  const tracked = $derived(rows.filter((row) => isTracked(row) && elements.some((element) => element.kind === 'map'
    && element.layers?.some((entry) => entry.name === row.name))));
  const moments = $derived([...new Set(tracked.flatMap((row) => addedLayers.moments(row.name)))].sort());
  const time = $derived(exportTime ?? spec?.time ?? { at: null, trail: true, since: null, window: 7 });

  const KIND_WORDS = { point: 'marks', line: 'lines', area: 'areas' };

  /**
   * What a map's legend lists: each look its layers' features wear, as they stand on
   * the plate's day — a kind of mark in one colour, named after the colour when the
   * case names it ("Side A"), else after its group. Then the past, when it is drawn.
   */
  function legendFor(map) {
    const entries = [];
    for (const entry of map.layers ?? []) {
      const row = rows.find((item) => item.name === entry.name);
      if (!row) continue;
      const collection = addedLayers.collection(row.name);
      if (collection) {
        const at = isTracked(row) ? time.at ?? '￿' : null;
        const looks = new Map();
        for (const feature of collection.features ?? []) {
          const standing = at !== null && hasHistory(feature) ? stateAt(feature, at) : feature;
          const properties = standing?.properties;
          if (!properties || entry.hidden.includes(properties.category)) continue;
          const kind = kindOf(standing.geometry);
          const groupAt = row.categories.findIndex((group) => group.name === properties.category);
          const colour = String(properties.colour || categoryColour(row.categories[groupAt], Math.max(0, groupAt))).toLowerCase();
          const symbol = kind === 'point' ? properties.symbol || 'pin' : '';
          const status = kind === 'point' ? properties.status ?? '' : '';
          const key = [row.name, properties.category, kind, colour, symbol, status].join('/');
          if (!looks.has(key)) looks.set(key, { key, label: layerPalette.nameOf(colour) || properties.category || row.title, kind, colour, symbol, status });
        }
        const found = [...looks.values()].slice(0, 16);
        const said = new Map();
        for (const look of found) said.set(look.label, (said.get(look.label) ?? 0) + 1);
        entries.push(...found.map((look) => said.get(look.label) > 1 ? { ...look, label: `${look.label}, ${KIND_WORDS[look.kind]}` } : look));
        continue;
      }
      row.categories.forEach((group, index) => {
        if (entry.hidden.includes(group.name)) return;
        const kinds = group.kinds ?? [];
        entries.push({ key: `${row.name}/${group.name}`, label: group.name,
          kind: kinds.includes('point') ? 'point' : kinds.includes('line') ? 'line' : 'area',
          colour: group.colour || categoryColour(group, index), symbol: group.symbol || 'pin' });
      });
    }
    // the past, said only for what the map really draws of it
    const drawn = (map.layers ?? []).map((entry) => tracked.find((row) => row.name === entry.name))
      .filter(Boolean).map((row) => addedLayers.collection(row.name)).filter(Boolean)
      .flatMap((collection) => asOf(collection, time.at ?? null, { trail: time.trail !== false, since: time.since ?? null, window: time.window ?? 7 }).features);
    if (drawn.some((feature) => feature.properties.$new)) {
      entries.push({ key: '$new', label: `New on ${momentLabel(time.at)}`, kind: 'new', colour: NEW_COLOUR });
    }
    if (drawn.some((feature) => feature.properties.$trail)) {
      entries.push({ key: '$trail', label: time.at ? `Before ${momentLabel(time.at)}` : 'The state before', kind: 'trail', colour: spec.theme.ink });
    }
    const since = time.since === 'previous' ? 'the state before' : momentLabel(time.since);
    for (const change of ['gained', 'lost']) {
      if (drawn.some((feature) => feature.properties.$change === change)) {
        entries.push({ key: `${change}`, label: `${change === 'gained' ? 'Gained' : 'Lost'} since ${since}`, kind: change, colour: spec.theme.ink });
      }
    }
    return entries;
  }
  const legend = $derived(spec ? Object.fromEntries(elements.filter((element) => element.kind === 'map').map((map) => [map.id, legendFor(map)])) : {});
  const credits = $derived.by(() => {
    if (!spec) return {};
    const text = plateCredits(spec, { providers, rows, relief });
    return Object.fromEntries(elements.filter((element) => element.kind === 'map').map((map) => [map.id, text]));
  });
  const tokens = $derived({ date: time.at, caseName: caseState.current?.name ?? '', title: plate?.title ?? '' });

  // The pictures the page shows, loaded once each.
  $effect(() => {
    const wanted = elements.filter((element) => element.kind === 'image' && element.src).map((element) => element.src);
    untrack(() => {
      for (const src of wanted) {
        if (images.has(src) || !caseId) continue;
        const picture = new Image();
        picture.onload = () => { images = new Map(images).set(src, picture); };
        picture.src = fileUrl(caseId, src);
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

  // -- the plate's day -----------------------------------------------------------------

  let playTimer = null;
  function play() {
    if (playing) { playing = false; clearTimeout(playTimer); return; }
    if (moments.length < 2) return;
    playing = true;
    let index = Math.max(0, moments.indexOf(spec.time.at) + 1);
    if (index >= moments.length) index = 0;
    const step = () => {
      if (!playing || !plate) return;
      spec.time.at = moments[index];
      index += 1;
      if (index >= moments.length) { playing = false; return; }
      playTimer = setTimeout(step, 1100);
    };
    step();
  }

  // -- export --------------------------------------------------------------------------

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The page drawn at `scale` canvas pixels a millimetre, on the day `at` (undefined: the plate's). */
  async function render(scale, at, { quick = false } = {}) {
    if (at !== undefined) { exportTime = { ...spec.time, at }; await tick(); await wait(quick ? 0 : 250); }
    const maps = {};
    const ratio = quick ? Math.min(2, window.devicePixelRatio || 1) : scale / PX_PER_MM;
    for (const element of elements.filter((item) => item.kind === 'map' || item.kind === 'inset')) {
      const handle = handles.get(element.id);
      if (handle) maps[element.id] = await handle.snapshot(ratio);
    }
    return composePage(spec, scale, { views, legend, credits, images, markerImage, tokens: { ...tokens, date: (exportTime ?? spec.time).at }, maps,
      imperial: prefs.units === 'imperial' });
  }

  async function runExport({ format, quality, width, days, interval }) {
    const { width: widthMm, height: heightMm } = pageSize(spec.page);
    const name = plate.title;
    framing = ''; selected = '';
    try {
      let answer;
      if (format === 'png' || format === 'pdf') {
        progress = 'Drawing the page…';
        const canvas = await render(scaleFor(spec, QUALITIES[quality].dpi));
        progress = 'Writing…';
        answer = await postExport(caseId, { format, frames: [await canvasBlob(canvas)], widthMm, heightMm,
          filename: spec.time.at ? `${name} ${spec.time.at.replace('T', ' ').replace(':', 'h')}` : name });
      } else {
        const picked = days.slice(0, 120);
        const scale = format === 'sheet' ? scaleForWidth(spec, 900) : scaleForWidth(spec, width);
        const pages = [];
        for (const [index, day] of picked.entries()) {
          progress = `Drawing ${momentLabel(day)} (${index + 1} of ${picked.length})…`;
          pages.push(await render(scale, day));
        }
        progress = 'Writing…';
        if (format === 'sheet') {
          const sheet = evolutionSheet(pages, picked.map((day) => momentLabel(day)), spec.theme);
          answer = await postExport(caseId, { format: 'png', frames: [await canvasBlob(sheet)], widthMm, heightMm, filename: `${name} evolution` });
        } else {
          const frames = [];
          for (const page of pages) frames.push(await canvasBlob(page, 'image/jpeg', 0.9));
          answer = await postExport(caseId, { format, frames, widthMm, heightMm, interval, filename: name });
        }
      }
      toast(`${answer.file} written`, 'ok', 5200, { label: 'Show', onClick: () => revealPlates(caseId).catch((error) => toast(error.message, 'warn')) });
    } catch (error) {
      toast(error.message || 'The plate could not be exported', 'danger', 6000);
      throw error;
    } finally {
      exportTime = null;
      progress = '';
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

  const ICONS = { map: 'satellite', inset: 'compass', legend: 'list', text: 'text', label: 'pin', arrow: 'arrowRight',
    scale: 'ruler', north: 'compass', image: 'image', credits: 'info' };
  const ADD = ['map', 'inset', 'legend', 'text', 'label', 'arrow', 'scale', 'north', 'image', 'credits'];
  const describe = (element) => element.kind === 'text' || element.kind === 'label'
    ? (fillTokens(element.text, tokens) || KIND_LABELS[element.kind]).split('\n')[0] : KIND_LABELS[element.kind];
</script>

<svelte:window onkeydown={keydown} />

<div class="tool">
  {#if plate}
    <div class="tool-header">
      <button class="btn btn-ghost btn-sm" title="Back to the plates" onclick={close}><Icon name="chevronLeft" size={14} /></button>
      {#if plate.template}<span class="kind">Template</span>{/if}
      <input class="input title-input" bind:value={titleField} onblur={commitTitle} maxlength="200"
        onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Plate name" />
      {#if autosave.state.status === 'saving' || autosave.state.status === 'pending'}<span class="status">Saving…</span>
      {:else if autosave.state.status === 'saved'}<span class="status"><Icon name="check" size={12} /> Saved</span>
      {:else if autosave.state.status === 'error'}
        <span class="status error" title={autosave.state.error}><Icon name="alert" size={12} /> Not saved</span>
        <button class="btn btn-ghost btn-xs" onclick={() => autosave.flush()}>Retry</button>
      {/if}
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={15} /></button>
      <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={15} /></button>
      {#if !plate.template}
        <button class="btn btn-sm" onclick={() => (naming = { value: plate.title })} title="Keep this layout, without its data, to start other plates from">
          <Icon name="save" size={14} /> Keep as template</button>
        <button class="btn btn-primary btn-sm" onclick={() => (exporting = true)}><Icon name="download" size={14} /> Export</button>
      {:else}
        <button class="btn btn-primary btn-sm" onclick={async () => { await autosave.flush(); plate = null; uiState.tool = 'settings'; }}>
          <Icon name="check" size={14} /> Done</button>
      {/if}
    </div>

    <div class="work">
      <aside class="elements" aria-label="Elements">
        <h4>Add</h4>
        <div class="adds">
          {#each ADD as kind (kind)}
            <button type="button" class="add" class:on={placing?.kind === kind} onclick={() => add(kind)} title={`Add ${KIND_LABELS[kind].toLowerCase()}`}>
              <Icon name={ICONS[kind]} size={14} /><span>{KIND_LABELS[kind]}</span></button>
          {/each}
        </div>
        <h4>On the page</h4>
        <ul class="list">
          {#each [...elements].reverse() as element (element.id)}
            <li><button type="button" class:active={selected === element.id} onclick={() => (selected = element.id)}>
              <Icon name={ICONS[element.kind]} size={12} /><span>{describe(element)}</span></button></li>
          {/each}
        </ul>
      </aside>

      <div class="centre">
        <PlatePage spec={plate.spec} bind:selected bind:framing {placing} onplace={placed} caseId={caseId ?? ''} {rows} {providers} {relief}
          {time} bind:views {legend} {credits} {images} {markerImage} {tokens} {grounds} imperial={prefs.units === 'imperial'}
          onmap={(id, handle) => handles.set(id, handle)} />
        {#if moments.length && !plate.template}
          <div class="timebar">
            <button type="button" class="play" aria-label={playing ? 'Pause' : 'Play the changes'} title={playing ? 'Pause' : 'Play the changes'}
              disabled={moments.length < 2} onclick={play}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
            <div class="cursor"><LayerTimeCursor time={plate.spec.time} {moments} precision={tracked[0]?.track?.precision ?? 'day'}
              zone={tracked[0]?.track?.zone ?? 'UTC'} label="The plate's day" onchange={(patch) => Object.assign(plate.spec.time, patch)} /></div>
          </div>
        {/if}
      </div>

      <PlateInspector spec={plate.spec} {selected} caseId={caseId ?? ''} {rows} {grounds} {legend} {framing}
        onpaper={paper} onremove={removeElement} onduplicate={duplicate} onorder={order}
        onframe={(element) => (framing = framing === element.id ? '' : element.id)} onlabels={labelFeatures} />
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
              <button type="button" class="tile template" onclick={() => newPlate(template)}>
                <Icon name="plate" size={20} /><span>{template.name}</span></button>
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
  <FloatingMenu anchor={menu.anchor} align="end" width={180} label="Plate actions" onclose={() => (menu = null)}>
    <button type="button" class="fm-item" onclick={() => { const row = menu.row; menu = null; open(row.name); }}><Icon name="edit" size={14} /><span class="fm-grow">Open</span></button>
    <button type="button" class="fm-item danger" onclick={() => { const row = menu.row; menu = null; remove(row); }}><Icon name="trash" size={14} /><span class="fm-grow">Move to the Trash</span></button>
  </FloatingMenu>
{/if}

{#if exporting}
  <PlateExportDialog {moments} {progress} onexport={runExport} onclose={() => (exporting = false)} />
{/if}

{#if naming}
  <Modal title="Keep as a template" onclose={() => (naming = null)} width="360px">
    <p class="dialog-note">The layout, its paper and its colours, without the ground, the layers or the labels.</p>
    <form onsubmit={(event) => { event.preventDefault(); const name = naming.value.trim(); if (name) { naming = null; keepAsTemplate(name); } }}>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" aria-label="Template name" bind:value={naming.value} maxlength="120" autofocus />
      <div class="dialog-acts"><button type="button" class="btn" onclick={() => (naming = null)}>Cancel</button>
        <button class="btn btn-primary" disabled={!naming.value.trim()}>Keep</button></div>
    </form>
  </Modal>
{/if}

<style>
  .tool { display: flex; flex-direction: column; height: 100%; }
  .tool-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .title-input { width: 280px; }
  .kind { padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--text-1); font-size: 11px; font-weight: 600; }
  .status { display: flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); }
  .status.error { color: var(--danger); }
  .spacer { flex: 1; }
  .work { flex: 1; min-height: 0; display: flex; }
  .elements { width: 176px; flex: none; overflow-y: auto; padding: 10px; border-right: 1px solid var(--border); background: var(--bg-1); }
  h4 { margin: 4px 0 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .adds { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 14px; }
  .add { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 2px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: 10.5px; cursor: pointer; }
  .add:hover, .add.on { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  .list { list-style: none; margin: 0; padding: 0; }
  .list button { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; padding: 3px 6px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs); text-align: left; cursor: pointer; }
  .list button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list button:hover, .list button.active { background: var(--bg-3); color: var(--text-1); }
  .list button.active { box-shadow: inset 2px 0 var(--accent); }
  .centre { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .timebar { display: flex; align-items: center; gap: 10px; padding: 6px 14px 8px; border-top: 1px solid var(--border); background: var(--bg-1); }
  .cursor { flex: 1; min-width: 0; max-width: 720px; }
  .cursor :global(.cursor) { padding-left: 0; }
  .play { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: var(--accent-text); cursor: pointer; }
  .play:disabled { opacity: .4; cursor: default; }
  .start { flex: 1; min-height: 0; overflow: auto; }
  .start-col { max-width: 860px; margin: 0 auto; padding: 28px 20px; }
  .start-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .start-head h3 { margin: 0 0 4px; }
  .start-head p, .hint, .empty-note { margin: 0; color: var(--text-3); font-size: var(--fs-sm); }
  .hint { margin: 8px 0 18px; font-size: var(--fs-xs); }
  .start h4 { margin: 18px 0 8px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .tile { position: relative; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); overflow: hidden; }
  .tile.template { display: flex; align-items: center; gap: 8px; padding: 12px; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; text-align: left; }
  .tile:hover { border-color: var(--accent); }
  .open { display: flex; flex-direction: column; width: 100%; padding: 0; cursor: pointer; text-align: left; }
  .open img, .blank { display: grid; place-items: center; width: 100%; aspect-ratio: 1.414; object-fit: cover; background: var(--bg-2); color: var(--text-3); }
  .name { padding: 7px 9px; color: var(--text-1); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm);
    background: rgba(0, 0, 0, .55); color: #fff; cursor: pointer; }
  .dialog-note { margin: 0 0 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .dialog-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  form .input { width: 100%; }
</style>
