import { moments as momentsOf, seenAt } from '../../../lib/map/layerHistory.js';
import { attribution } from '../../../lib/map/addedLayers.js';

/** How many edits the editor can take back, per layer session. */
export const HISTORY = 100;
/** The group fields an undo puts back. */
const GROUP_FIELDS = ['name', 'mode', 'colour', 'symbol', 'size', 'stroke', 'labels', 'events', 'line_dash', 'line_arrow', 'area_fill', 'fill_opacity'];

/**
 * What an edit changed, as the two ways back across it: `undo` puts the features
 * as they were and drops the ones it made, `redo` the reverse, and each group whose
 * settings it changed gets them back. Null when it changed nothing.
 */
export function difference(beforeFeatures, afterFeatures, beforeGroups = [], afterGroups = []) {
  const before = new Map(beforeFeatures.map((feature) => [feature.properties.key, feature]));
  const after = new Map(afterFeatures.map((feature) => [feature.properties.key, feature]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const undo = { put: [], drop: [] };
  const redo = { put: [], drop: [] };
  for (const [key, feature] of before) {
    const now = after.get(key);
    if (!now) { undo.put.push(feature); redo.drop.push(key); }
    else if (!same(feature, now)) { undo.put.push(feature); redo.put.push(now); }
  }
  for (const [key, feature] of after) if (!before.has(key)) { undo.drop.push(key); redo.put.push(feature); }
  const groups = [];
  const was = new Map(beforeGroups.map((group) => [group.id, group]));
  for (const group of afterGroups) {
    const old = was.get(group.id);
    if (!old) continue;
    const back = {};
    const forth = {};
    for (const field of GROUP_FIELDS) {
      if (same(old[field] ?? null, group[field] ?? null)) continue;
      back[field] = old[field] ?? (typeof group[field] === 'boolean' ? false : null);
      forth[field] = group[field] ?? (typeof old[field] === 'boolean' ? false : null);
    }
    if (Object.keys(back).length) groups.push({ id: group.id, back, forth });
  }
  if (!undo.put.length && !undo.drop.length && !groups.length) return null;
  return { undo, redo, groups };
}

/** The personal-layer editor. Each click is saved separately, in click order. */
export function createMyLayersState({ api, layers, caseId, notify, reloadCase,
  beginSession = (path) => api.post(`${path}/edit`, {}) }) {
  let dialog = $state(null);
  let exporting = $state(null);
  let editor = $state(null);
  /** The features as the layer holds them, their latest shapes and their histories. */
  let stored = $state.raw([]);
  let groups = $state([]);
  let group = $state('');
  let placing = $state(false);
  // The map's selection tool drawing a free shape round what it should pick.
  let lassoing = $state(false);
  // Features being dragged on the map: the layer draws them here, not where they were.
  let dragging = $state(null);
  // The paste box and the case picker, opened from the map's edit bar.
  let pasting = $state(null);
  let linking = $state(false);
  // A feature of another layer on its way into one of the analyst's.
  let copying = $state(null);
  let sketch = $state(null);
  let checkpoint = $state(null);
  let pending = $state(0);
  let loading = $state(false);
  let selected = $state(null);
  let selection = $state([]);
  let anchor = null;
  let form = $state(null);
  let details = $state(null);
  // The style the next markers are added in, set from the map's edit bar.
  let draft = $state({ colour: '#0072b2', symbol: 'pin' });
  // On a tracked layer read at a moment: does an edit start a state there
  // ('new') or correct the one in force then ('fix')?
  let timeMode = $state('new');
  /** The edits that can be taken back, newest last, and the ones taken back, to redo. */
  let past = $state.raw([]);
  let ahead = $state.raw([]);
  /** A line or an area drawn by dragging the pointer rather than corner by corner. */
  let freehand = $state(false);
  /**
   * The features as the editor shows and edits them: on a tracked layer read at a
   * moment, each in the shape and status it had then, its history kept, and the ones
   * not there yet or any more marked `$absent`. Otherwise as the layer holds them.
   */
  const features = $derived(seenAt(stored, editor?.track?.on ? layers.time?.(editor.name)?.at ?? null : null));
  /** The moments the layer changes at, read from the features the editor holds rather than
   *  from a map's drawing of it, which a layer switched off never has and each save drops. */
  const stateMoments = $derived(momentsOf({ features: stored }));
  /** The selected feature as it stands now, so a moved cursor reshapes what is picked. */
  const picked = () => (selected ? features.find((feature) => feature.properties.key === selected.properties.key) ?? selected : null);
  let generation = 0;
  let tail = Promise.resolve();
  /** What the feature panel edits, each field in the shape its input holds. */
  const formOf = (feature) => {
    if (!feature) return null;
    const properties = feature.properties;
    return { name: properties.name ?? '', description: properties.description ?? '',
      colour: properties.colour || '#0072b2', symbol: properties.symbol || 'pin', group: properties.group ?? '',
      date: properties.date ?? '', status: properties.status ?? '', bearing: properties.bearing ?? '',
      links: [...(properties.links ?? [])], provenance: properties.provenance ?? '',
      confidence: properties.confidence ?? '', credit: properties.credit ?? '',
      ...Object.fromEntries(STYLE.map((field) => [field, properties[field] ?? ''])) };
  };
  /** How a feature is drawn beyond its colour and icon (`layerediting.STYLE_FIELDS`). */
  const STYLE = ['line_width', 'line_dash', 'line_arrow', 'area_fill', 'fill_opacity', 'marker_size', 'label', 'label_size'];
  const NUMBERS = ['line_width', 'fill_opacity', 'marker_size', 'label_size'];
  /** The fields an edit clears by sending nothing, as the backend's `CLEARABLE`. */
  const CLEARABLE = ['date', 'status', 'bearing', 'links', 'provenance', 'confidence', 'credit', ...STYLE];
  /** What the panel changed on the selected feature, as the patch that saves it. */
  function formPatch() {
    if (!selected || !form) return {};
    const before = formOf(picked()), patch = {};
    for (const [key, value] of Object.entries(form)) {
      if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
      if (key === 'links') {
        const links = value.map((link) => String(link).trim()).filter(Boolean);
        if (JSON.stringify(links) !== JSON.stringify(before.links)) patch.links = links.length ? links : null;
      } else if (key === 'bearing' || NUMBERS.includes(key)) patch[key] = value === '' || value === null ? null : Number(value);
      else patch[key] = CLEARABLE.includes(key) && value === '' ? null : value;
    }
    return patch;
  }
  function detailsPatch() {
    if (!details || !editor) return {};
    return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, String(value).trim()])
      .filter(([key, value]) => value !== (editor[key] ?? '')));
  }
  const sameForm = (first, second) => JSON.stringify(first) === JSON.stringify(second);
  const detailsOf = (row) => row ? { title: row.title ?? '', description: row.description ?? '' } : null;
  const mergeDraft = (draft, before, after) => after ? Object.fromEntries(Object.entries(after).map(([key, value]) =>
    [key, !draft || draft[key] === before?.[key] ? value : draft[key]])) : null;

  const base = (owner, name) => `/api/cases/${owner}/map-layers/${encodeURIComponent(name)}`;
  /** The moment the layer is read at while it is tracked, else null: what an edit is dated to. */
  const cursor = () => editor?.track?.on ? layers.time?.(editor.name)?.at ?? null : null;
  /** What dates an edit to existing features: nothing at now, else the cursor and the mode. */
  const stamp = () => {
    const at = cursor();
    return at === null ? {} : { at, ...(timeMode === 'fix' ? { fix: true } : {}) };
  };
  /** What dates a new feature: it appears at the cursor. */
  const birth = () => {
    const at = cursor();
    return at === null ? {} : { at };
  };
  const current = (owner, name, stamp) =>
    generation === stamp && caseId() === owner && editor?.name === name;

  function close() {
    generation += 1;
    past = []; ahead = [];
    placing = false;
    lassoing = false;
    dragging = null;
    pasting = null;
    linking = false;
    sketch = null;
    checkpoint = null;
    editor = null;
    selected = null;
    selection = []; anchor = null;
    form = null;
    details = null;
    stored = [];
    groups = [];
    group = '';
    loading = false;
  }

  async function open(row) {
    close();
    const owner = caseId();
    if (!owner || !row?.editable) return;
    // the editor opens on now, wherever a state pressed earlier left the cursor:
    // an edit dates a change only once the analyst moves it here
    layers.setTime?.(row.name, { at: null });
    const stamp = generation;
    editor = { ...row, caseId: owner };
    loading = true;
    try {
      const answer = await beginSession(base(owner, row.name));
      if (!current(owner, row.name, stamp)) return;
      editor = { ...answer.layer, caseId: owner };
      details = detailsOf(editor);
      stored = answer.document.features;
      groups = answer.groups ?? [];
      group = groups[0]?.id ?? '';
      checkpoint = answer.checkpoint;
      const live = layers.rows.find((item) => item.name === row.name);
      if (live && !live.enabled) await layers.toggle(owner, live);
    } catch (error) {
      if (!current(owner, row.name, stamp)) return;
      close();
      notify(error.message, 'danger');
    } finally {
      if (current(owner, row.name, stamp)) loading = false;
    }
  }

  async function create(title, file = null, description = '') {
    const source = dialog?.source;
    const owner = caseId();
    const row = source
      ? await layers.copyEditable(source, title, description)
      : file ? await layers.importEditable(file, title, description) : await layers.createEditable(title, description);
    // Creating a first case is allowed; switching an existing case meanwhile is not.
    if (!row || (owner && owner !== caseId())) return;
    dialog = null;
    await open(row);
  }

  function settle(owner, name, stamp, answer) {
    if (caseId() === owner) layers.edited(owner, answer.layer);
    if (!current(owner, name, stamp)) return;
    const beforeDetails = detailsOf(editor);
    editor = { ...answer.layer, caseId: owner };
    details = mergeDraft(details, beforeDetails, detailsOf(editor));
    if (answer.groups) {
      groups = answer.groups;
      if (!groups.some((item) => item.id === group)) group = groups[0]?.id ?? '';
    }
    if (answer.document) {
      stored = answer.document.features;
      const available = new Set(features.map((feature) => feature.properties.key));
      selection = selection.filter((key) => available.has(key));
      const before = formOf(selected);
      selected = features.find((item) => item.properties.key === selected?.properties.key) ?? null;
      form = mergeDraft(form, before, formOf(selected));
      return;
    }
    if (!answer.marker) return;
    const key = answer.marker.properties.key;
    const at = stored.findIndex((feature) => feature.properties.key === key);
    stored = at < 0 ? [...stored, answer.marker]
      : stored.map((feature, index) => index === at ? answer.marker : feature);
    if (selected?.properties.key === key) {
      const before = formOf(selected);
      selected = features.find((feature) => feature.properties.key === key) ?? answer.marker;
      form = mergeDraft(form, before, formOf(selected));
    }
  }

  /**
   * Run one edit after the ones before it. Unless `record` is off, what it changed is
   * kept so Ctrl+Z takes it back (`difference`); `label` says what it was in the toast
   * an undo raises.
   */
  function enqueue(run, after = null, context = null, { record = true, label = '' } = {}) {
    if ((!editor || loading) && !context) return Promise.resolve(null);
    const owner = context?.owner ?? editor.caseId;
    const name = context?.name ?? editor.name;
    const stamp = generation;
    pending += 1;
    const task = tail.then(async () => {
      const keep = record && current(owner, name, stamp);
      const before = keep ? { features: stored, groups: JSON.parse(JSON.stringify(groups)) } : null;
      try {
        const answer = await run(base(owner, name));
        settle(owner, name, stamp, answer);
        if (keep && current(owner, name, stamp)) {
          const change = difference(before.features, stored, before.groups, groups);
          if (change) { past = [...past.slice(-(HISTORY - 1)), { ...change, label }]; ahead = []; }
        }
        if (after && caseId() === owner) await after(answer);
        return answer;
      } catch (error) {
        notify(error.message, 'danger', 5000);
        return null;
      } finally {
        pending -= 1;
      }
    });
    tail = task.then(() => {});
    return task;
  }

  /** The toast after an edit that changes several features at once, its Undo taking that edit back. */
  function undoable(message) {
    const entry = past.at(-1);
    notify(message, 'info', 7000, entry ? { label: 'Undo', onClick: () => (past.at(-1) === entry ? stepBack()
      : notify('Newer edits came after it; Ctrl+Z takes them back first', 'info', 3500)) } : undefined);
  }

  /** Put the layer back across one recorded edit, `way` being its undo or its redo half. */
  function across(entry, way) {
    const change = entry[way];
    const fields = way === 'undo' ? 'back' : 'forth';
    let chain = Promise.resolve(true);
    if (change.put.length || change.drop.length) chain = enqueue((path) => api.post(`${path}/revert`, change), null, null, { record: false }).then(Boolean);
    for (const group of entry.groups) {
      chain = chain.then((ok) => ok && enqueue((path) => api.patch(`${path}/groups/${group.id}`, group[fields]), null, null, { record: false }).then(Boolean));
    }
    return chain;
  }

  /** Take back the last edit; its redo is kept until a new edit is made. */
  async function stepBack() {
    const entry = past.at(-1);
    if (!entry) return false;
    past = past.slice(0, -1);
    if (await across(entry, 'undo')) { ahead = [...ahead, entry]; notify(entry.label ? `Undone: ${entry.label}` : 'Undone', 'ok', 1600); }
    return true;
  }
  async function stepForward() {
    const entry = ahead.at(-1);
    if (!entry) return false;
    ahead = ahead.slice(0, -1);
    if (await across(entry, 'redo')) { past = [...past, entry]; notify(entry.label ? `Redone: ${entry.label}` : 'Redone', 'ok', 1600); }
    return true;
  }

  /**
   * The sheet saves as it is filled, but a name still being typed is only in the
   * form: it is saved before the selection moves on, so picking another feature
   * never drops it.
   */
  function commitForm() {
    const patch = formPatch();
    if (!selected || !Object.keys(patch).length) return;
    const key = selected.properties.key;
    enqueue((path) => api.patch(`${path}/markers/${key}`, { ...patch, ...stamp() }));
  }

  function chooseKeys(keys, add = false) {
    commitForm();
    placing = false; sketch = null;
    const next = add ? [...new Set([...selection, ...keys])] : [...new Set(keys)];
    selection = next; anchor = next.at(-1) ?? null;
    selected = next.length === 1 ? features.find((feature) => feature.properties.key === next[0]) ?? null : null;
    form = formOf(selected);
    if (selected?.properties.group) group = selected.properties.group;
  }

  /**
   * The shape being drawn keeps its own history, apart from the layer's: each corner
   * added, moved, put in or taken out is one step Ctrl+Z takes back and Ctrl+Shift+Z
   * makes again, until the shape is saved or dropped.
   */
  function sketchStep() {
    if (!sketch) return;
    sketch.past = [...(sketch.past ?? []).slice(-199), JSON.stringify(sketch.rings)];
    sketch.ahead = [];
  }
  function undoSketch() {
    if (!sketch?.past?.length) return false;
    sketch.ahead = [...(sketch.ahead ?? []), JSON.stringify(sketch.rings)];
    sketch.rings = JSON.parse(sketch.past.at(-1));
    sketch.past = sketch.past.slice(0, -1);
    if (sketch.shape) sketch.anchor = null;
    return true;
  }
  function redoSketch() {
    if (!sketch?.ahead?.length) return false;
    sketch.past = [...(sketch.past ?? []), JSON.stringify(sketch.rings)];
    sketch.rings = JSON.parse(sketch.ahead.at(-1));
    sketch.ahead = sketch.ahead.slice(0, -1);
    return true;
  }

  function addPoint(point) {
    if (sketch && !loading && editor?.caseId === caseId()) {
      // a second press on the first one draws nothing: the shape waits for one further out
      const closing = sketch.shape && sketch.anchor ? shapeRing(sketch.shape, sketch.anchor, [point.lon, point.lat]) : null;
      if (closing && !encloses(closing)) return true;
      if (!sketch.shape || sketch.anchor) sketchStep();
      if (sketch.shape) {
        // a circle or a box: the first press fixes its centre or corner, the second closes it
        if (!sketch.anchor) { sketch.anchor = [point.lon, point.lat]; sketch.rings = [[]]; return true; }
        sketch.rings = [closing];
        sketch.anchor = null;
        saveGeometry();
        return true;
      }
      if (sketch.type === 'Point' || sketch.type === 'Selection') sketch.rings = [[[point.lon, point.lat]]];
      else if (sketch.rings.flat().length < 4095) {
        // a line being reshaped grows from the end it was asked to, its last by default
        if (sketch.extend === 'start') sketch.rings[0].unshift([point.lon, point.lat]);
        else sketch.rings[0].push([point.lon, point.lat]);
      }
      return true;
    }
    if (!placing || !editor || loading || caseId() !== editor.caseId) return false;
    const body = { lat: point.lat, lon: point.lon, ...draft, ...(group ? { group } : {}), ...birth() };
    enqueue((path) => api.post(`${path}/markers`, body));
    return true;
  }

  /** Several markers at once, from a paste: the draft's style, the text's fields. */
  async function addPoints(points, fields = {}) {
    if (!editor || loading || !points.length) return null;
    const owner = editor.caseId, name = editor.name, target = group;
    let last = null;
    for (const point of points) {
      last = await enqueue((path) => api.post(`${path}/markers`, {
        lat: point.lat, lon: point.lon, ...draft, ...(point.name ? { name: point.name } : {}),
        ...fields, ...(target ? { group: target } : {}), ...birth(),
      }));
      if (!last || !current(owner, name, generation)) return null;
    }
    return last;
  }

  function geometry() {
    if (!sketch) return null;
    const rings = JSON.parse(JSON.stringify(sketch.rings));
    const close = (ring) => [...ring, ring[0]];
    if (sketch.type === 'Point') return { type: 'Point', coordinates: rings[0][0] };
    if (sketch.type === 'LineString') return { type: 'LineString', coordinates: rings[0] };
    if (sketch.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: rings };
    if (sketch.type === 'MultiPolygon') {
      let at = 0;
      return { type: 'MultiPolygon', coordinates: sketch.parts.map((count) => rings.slice(at, at += count).map(close)) };
    }
    return { type: 'Polygon', coordinates: rings.map(close) };
  }

  async function saveGeometry() {
    if (!sketch) return null;
    const before = sketch, shape = geometry(), key = sketch.key;
    const body = { geometry: shape, colour: draft.colour, ...(group ? { group } : {}), ...birth() };
    const label = before.type === 'Selection' ? 'move' : key ? 'reshape' : before.shape === 'circle' ? 'circle' : before.shape === 'rect' ? 'box'
      : before.type.includes('Polygon') ? 'area' : 'line';
    const answer = await enqueue((path) => before.type === 'Selection' ? api.post(`${path}/selection`, {
      keys: before.keys, offset: [before.rings[0][0][0] - before.origin[0], before.rings[0][0][1] - before.origin[1]], ...stamp(),
    }) : key ? api.patch(`${path}/markers/${key}`, { geometry: shape, ...stamp() })
      : api.post(`${path}/shapes`, body), null, null, { label });
    if (answer && sketch === before) sketch = null;
    return answer;
  }

  async function finish(discard = false) {
    placing = false;
    const owner = editor?.caseId, name = editor?.name, token = checkpoint, stamp = generation;
    const answer = await enqueue((path) => api.post(`${path}/edit/finish`, {
      token, revision: current(owner, name, stamp) ? editor.edit_revision : '', discard,
    }), null, null, { record: false });
    if (answer && current(owner, name, stamp)) close();
    return !!answer;
  }

  return {
    get dialog() { return dialog; },
    get exporting() { return exporting; },
    download(row) { exporting = { row, caseId: caseId() }; },
    /** The same dialog, on the file a My Maps is sent. */
    sendToMyMaps(row) { exporting = { row, caseId: caseId(), mode: 'mymaps' }; },
    cancelDownload() { exporting = null; },
    get editor() { return editor; },
    get features() { return features; },
    get groups() { return groups; },
    get group() { return group; },
    set group(value) { group = value; },
    get placing() { return placing; },
    get lassoing() { return lassoing; },
    get dragging() { return dragging; },
    get pasting() { return pasting; },
    get linking() { return linking; },
    get copying() { return copying; },
    get sketch() { return sketch; },
    get armed() { return placing || !!sketch || lassoing; },
    /** Whether an edit can be taken back, or one taken back made again. */
    get canUndo() { return past.length > 0; },
    get canRedo() { return ahead.length > 0; },
    get freehand() { return freehand; },
    set freehand(value) { freehand = !!value; },
    get changed() { return !!editor?.edit_changed || !!sketch || !sameForm(form, formOf(picked())) || !sameForm(details, detailsOf(editor)); },
    get loading() { return loading; },
    get pending() { return pending; },
    get draft() { return draft; },
    /** 'new' or 'fix': what an edit at the cursor does to a tracked feature. */
    get timeMode() { return timeMode; },
    set timeMode(value) { timeMode = value === 'fix' ? 'fix' : 'new'; },
    /** The moment the tracked layer being edited is read at, or null for now. */
    get cursor() { return cursor(); },
    /** The moments the layer being edited changes at, sorted: the ticks of its cursor. */
    get moments() { return stateMoments; },
    get selected() { return picked(); },
    get selection() { return selection; },
    get form() { return form; },
    get details() { return details; },
    /** Whether the panel holds an edit to the selected feature or to the layer not yet saved. */
    get formChanged() { return Object.keys(formPatch()).length > 0; },
    get detailsChanged() { return Object.keys(detailsPatch()).length > 0; },
    /** Save the selected feature's panel; false when there was nothing or it failed. */
    async saveForm() {
      const patch = formPatch();
      if (!selected || !Object.keys(patch).length) return false;
      return !!(await enqueue((path) => api.patch(`${path}/markers/${selected.properties.key}`, { ...patch, ...stamp() })));
    },
    async saveDetails() {
      const patch = detailsPatch();
      if (!Object.keys(patch).length) return false;
      if ('title' in patch && !patch.title) { notify('Give the layer a name', 'danger', 4000); return null; }
      return !!(await enqueue((path) => api.patch(`${path}/edit`, patch)));
    },
    /** Everything the panel and the map hold, saved, then the session closed. */
    async done() {
      // a drawing tool armed with nothing drawn yet holds no work: Done puts it down
      if (sketch && !sketch.key && !sketch.anchor && !sketch.rings.flat().length) sketch = null;
      if (sketch && !this.complete) { notify('Finish the shape, or Esc to drop it', 'danger', 4000); return false; }
      if (sketch && !(await this.saveGeometry())) return false;
      if (Object.keys(formPatch()).length && !(await this.saveForm())) return false;
      if (Object.keys(detailsPatch()).length && !(await this.saveDetails())) return false;
      return finish();
    },
    newLayer(source = null) { dialog = { source }; },
    cancelNew() { dialog = null; },
    create,
    open,
    close,
    finish,
    start() { if (editor && !loading) { commitForm(); selected = null; selection = []; form = null; sketch = null; lassoing = false; placing = true; } },
    stop() { placing = false; sketch = null; lassoing = false; },
    /** Arm the free selection shape: the next drag on the map picks what it encloses. */
    lasso() { if (editor && !loading) { commitForm(); placing = false; sketch = null; lassoing = true; } },
    chooseKeys(keys, add = false) { lassoing = false; chooseKeys(keys, add); },
    drag(keys, offset = null) { dragging = keys?.length && editor ? { name: editor.name, keys, offset } : null; },
    openPaste(text = '') { if (editor) { placing = false; sketch = null; lassoing = false; pasting = { text }; } },
    closePaste() { pasting = null; },
    openLinking() { if (editor) { placing = false; sketch = null; lassoing = false; linking = true; } },
    closeLinking() { linking = false; },
    /** Put a source layer's feature in one of the analyst's layers, from the menu opened on `anchor`. */
    copy(row, feature, anchor = null) { copying = { row, feature, anchor, caseId: caseId() }; },
    cancelCopy() { copying = null; },
    addPoints,
    startShape(type) {
      if (!editor || loading) return;
      commitForm();
      placing = false; lassoing = false; selected = null; selection = []; form = null;
      // a circle and a box are areas drawn with two presses
      if (type === 'Circle' || type === 'Rectangle') sketch = { type: 'Polygon', key: null, rings: [[]], shape: type === 'Circle' ? 'circle' : 'rect', anchor: null };
      else sketch = { type, key: null, rings: [[]] };
    },
    /** While a circle or a box is drawn, the shape it would take with its second press here. */
    preview(point) {
      if (sketch?.shape && sketch.anchor) sketch.rings = [shapeRing(sketch.shape, sketch.anchor, [point.lon, point.lat])];
    },
    /** A line being reshaped grows from its other end. */
    extendFrom(end) { if (sketch?.key && sketch.type === 'LineString') sketch.extend = end === 'start' ? 'start' : 'end'; },
    /** A whole run of points at once, the way a freehand stroke lays them, thinned to what the eye sees. */
    addStroke(points) {
      if (!sketch || sketch.key || sketch.shape || !points.length) return;
      sketchStep();
      const room = 4095 - sketch.rings.flat().length;
      sketch.rings[0].push(...points.slice(0, Math.max(0, room)).map((point) => [point.lon, point.lat]));
    },
    editGeometry() {
      const shape = picked()?.geometry;
      if (!shape || !['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(shape.type)) return;
      placing = false; lassoing = false;
      const coords = JSON.parse(JSON.stringify(shape.coordinates));
      const open = (ring) => ring.slice(0, -1);
      sketch = { type: shape.type, key: picked().properties.key,
        rings: shape.type === 'Point' ? [[coords]] : shape.type === 'LineString' ? [coords]
          : shape.type === 'MultiLineString' ? coords : shape.type === 'MultiPolygon' ? coords.flatMap((polygon) => polygon.map(open))
            : coords.map(open),
        ...(shape.type === 'MultiPolygon' ? { parts: coords.map((polygon) => polygon.length) } : {}) };
    },
    moveVertex(ring, index, point) { if (sketch) sketch.rings[ring][index] = [point.lon, point.lat]; },
    /** A corner is about to be dragged (or nudged): the shape as it was is one step back. */
    beginVertexMove() { sketchStep(); },
    insertVertex(ring, index, point) {
      sketchStep();
      if (sketch && sketch.rings.flat().length < 4095) sketch.rings[ring].splice(index, 0, [point.lon, point.lat]);
    },
    removeVertex(ring, index) { if (sketch) { sketchStep(); sketch.rings[ring].splice(index, 1); } },
    /** Take the last corner of a new shape off (Backspace), itself a step Ctrl+Z puts back. */
    undoVertex() { if (sketch && !sketch.key && !sketch.shape && sketch.rings[0].length) { sketchStep(); sketch.rings[0].pop(); } },
    /** Take back, or make again, the last change to the shape being drawn; false when there is none. */
    undoSketch,
    redoSketch,
    get canUndoSketch() { return !!sketch?.past?.length; },
    get canRedoSketch() { return !!sketch?.ahead?.length; },
    get complete() {
      // a circle or a box is whole once its first press is down and the pointer has drawn it out
      if (sketch?.shape) return !!sketch.anchor && encloses(sketch.rings[0] ?? []);
      const least = sketch?.type?.includes('Polygon') ? 3 : sketch?.type?.includes('LineString') ? 2 : 1;
      return !!sketch && sketch.rings.every((ring) => ring.length >= least);
    },
    saveGeometry,
    addPoint,
    select(key) {
      commitForm();
      placing = false; lassoing = false;
      sketch = null;
      selected = features.find((feature) => feature.properties.key === key) ?? null;
      selection = selected ? [key] : []; anchor = key;
      form = formOf(selected);
      if (selected?.properties.group) group = selected.properties.group;
    },
    toggleSelected(key, order, range = false) {
      commitForm();
      placing = false; sketch = null;
      const keys = new Set(selection);
      if (range && anchor && order.includes(anchor)) {
        const first = order.indexOf(anchor), last = order.indexOf(key);
        order.slice(Math.min(first, last), Math.max(first, last) + 1).forEach((key) => keys.add(key));
      } else { if (keys.has(key)) keys.delete(key); else keys.add(key); anchor = key; }
      selection = [...keys];
      selected = selection.length === 1 ? features.find((feature) => feature.properties.key === selection[0]) : null;
      form = formOf(selected);
    },
    selectGroup(id) {
      commitForm();
      placing = false; sketch = null; selected = null; form = null;
      selection = features.filter((feature) => feature.properties.group === id).map((feature) => feature.properties.key);
    },
    moveSelection() {
      if (!selection.length) return;
      const keys = new Set(selection), before = JSON.parse(JSON.stringify(features.filter((feature) => keys.has(feature.properties.key))));
      const walk = (node) => typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk);
      const points = before.flatMap((feature) => walk(feature.geometry.coordinates));
      const origin = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
      placing = false; sketch = { type: 'Selection', key: 'selection', keys: [...selection], before, origin, rings: [[origin.slice()]] };
    },
    updateSelection(changes) {
      const keys = [...selection];
      return enqueue((path) => api.post(`${path}/selection`, { keys, changes, ...stamp() }), null, null, { label: 'change' });
    },
    removeSelection() {
      const keys = [...selection];
      return enqueue((path) => api.post(`${path}/selection`, { keys, remove: true }), () => {
        undoable(keys.length === 1 ? 'Removed from layer' : `Removed ${keys.length} features from layer`);
      }, null, { label: 'removal' });
    },
    /** Move features by a distance in degrees, as one edit the toast can undo. */
    moveFeatures(keys, offset) {
      return enqueue((path) => api.post(`${path}/selection`, { keys, offset, ...stamp() }), (answer) => {
        const moved = keys.length - (answer.kept ?? 0);
        if (answer.kept && !moved) notify('Linked markers stay on the case item they follow', 'info', 4000);
        else undoable(answer.kept ? `Moved ${moved}; ${answer.kept} linked stay on their case item` : moved === 1 ? 'Moved' : `Moved ${moved} features`);
      }, null, { label: 'move' }).finally(() => { dragging = null; });
    },
    merge() {
      const keys = [...selection];
      return enqueue((path) => api.post(`${path}/merge`, { keys }), (answer) => {
        chooseKeys([answer.key]);
        undoable(`Merged ${keys.length} features`);
      }, null, { label: 'merge' });
    },
    split(key, at = null) {
      return enqueue((path) => api.post(`${path}/split`, { key, ...(at === null ? {} : { at }) }), (answer) => {
        sketch = null;
        chooseKeys(answer.keys);
        undoable(`Split into ${answer.keys.length}`);
      }, null, { label: 'split' });
    },
    unlink(key) { return enqueue((path) => api.patch(`${path}/markers/${key}`, { unlink: true })); },
    /** Say the feature is no longer there from the cursor on. */
    markGone(key) {
      const at = cursor();
      if (at === null) return Promise.resolve(null);
      return enqueue((path) => api.patch(`${path}/markers/${key}`, { at, gone: true }));
    },
    /** Take one state out of a feature's history, by the moment it was written at. */
    dropState(key, at) {
      return enqueue((path) => api.patch(`${path}/markers/${key}`, { at, drop_state: true }));
    },
    /** Switch time tracking on or off, or change its precision or its clock. */
    setTrack(changes) {
      return enqueue((path) => api.patch(`${path}/edit`, { track: changes }), null, null, { record: false });
    },
    /** Keep (or forget, with '') the My Maps this layer is sent to. */
    setMyMaps(address) {
      return enqueue((path) => api.patch(`${path}/edit`, { mymaps: address }), null, null, { record: false });
    },
    update(key, changes) {
      return enqueue((path) => api.patch(`${path}/markers/${key}`, changes));
    },
    promote(key) {
      return enqueue((path) => api.post(`${path}/markers/${key}/place`, {}), async (answer) => {
        await reloadCase();
        notify(`Saved “${answer.place.label}” as a case place`, 'ok');
      });
    },
    addGroup(name) {
      return enqueue((path) => api.post(`${path}/groups`, { name }), (answer) => {
        if (editor?.name === answer.layer.name) group = answer.group.id;
      });
    },
    /**
     * Change a group. One that gives all its features one style restyles every one of
     * them, so the toast says how many, with an Undo.
     */
    updateGroup(key, changes) {
      const target = groups.find((item) => item.id === key);
      const many = target?.mode === 'uniform' && ['colour', 'symbol'].some((field) => field in changes)
        ? features.filter((feature) => feature.properties.group === key).length : 0;
      return enqueue((path) => api.patch(`${path}/groups/${key}`, changes), () => {
        if (many > 1) undoable(`Restyled the ${many} features of ${target.name}`);
      }, null, { label: 'group' });
    },
    removeGroup(key) {
      return enqueue((path) => api.del(`${path}/groups/${key}`));
    },
    reorderGroups(ids) { return enqueue((path) => api.post(`${path}/groups/order`, { ids }), null, null, { record: false }); },
    reorderFeatures(keys, group, before = null) {
      return enqueue((path) => api.post(`${path}/features/order`, { keys, group, before }), null, null, { label: 'group change' });
    },
    updateDetails(changes) { return enqueue((path) => api.patch(`${path}/edit`, changes), null, null, { record: false }); },
    /** Show or hide a group, read off the layer as the queue reaches it, in one write. */
    toggleGroup(target) {
      return enqueue(async (path) => {
        const name = groups.find((group) => group.id === target.id)?.name;
        if (!name) throw new Error('This group is no longer in the layer');
        const hidden = [...(editor?.hidden ?? [])];
        const at = hidden.indexOf(name);
        if (at < 0) hidden.push(name); else hidden.splice(at, 1);
        await api.patch(path, { hidden });
        return api.get(`${path}/edit`);
      }, null, null, { record: false });
    },
    /** Markers that follow case items, each picked at one of its points. */
    addLinks(items) {
      const target = group;
      return enqueue((path) => api.post(`${path}/links`, { items, ...(target ? { group: target } : {}) }), (answer) => {
        notify(answer.added ? `Added ${answer.added} from the case` : 'Already in this layer', answer.added ? 'ok' : 'info', 2600);
      });
    },
    /**
     * Copy `copying`'s feature into one of the analyst's layers, as an external
     * point: its name, note, day and the addresses its note cites come along, in
     * `style` (`{ symbol, colour }`) when one was picked.
     */
    async copyTo(row, groupId = null, style = null, status = '') {
      const job = copying;
      if (!job || !row) return null;
      const owner = job.caseId;
      const { geometry, properties = {} } = job.feature;
      const links = [...new Set(String(properties.description ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])].slice(0, 10);
      // what somebody else drew keeps their credit wherever it is drawn, a plate's credits first
      const credit = properties.credit || (job.row && !job.row.editable ? attribution(job.row) : '');
      const fields = {
        name: properties.name ?? '', description: properties.description ?? '', provenance: 'external',
        ...(credit ? { credit } : {}),
        ...(properties.date ? { date: properties.date } : {}), ...(links.length ? { links } : {}),
        ...(/^#[0-9a-f]{6}$/i.test(properties.colour ?? '') ? { colour: properties.colour } : {}),
        ...(groupId ? { group: groupId } : {}), ...(style ?? {}), ...(status ? { status } : {}),
      };
      const point = geometry?.type === 'Point';
      const send = (path) => point
        ? api.post(`${path}/markers`, { lat: geometry.coordinates[1], lon: geometry.coordinates[0], ...fields })
        : api.post(`${path}/shapes`, { geometry, ...fields });
      const answer = editor?.name === row.name && editor?.caseId === owner
        ? await enqueue(send)
        : await send(base(owner, row.name)).then((answer) => { layers.edited(owner, answer.layer); return answer; },
          (error) => { notify(error.message, 'danger', 5000); return null; });
      if (answer) { copying = null; notify(`Copied to ${row.title}`, 'ok', 2600); }
      return answer;
    },
    remove(key, row = null) {
      const owner = row ? caseId() : editor?.caseId;
      const name = row?.name ?? editor?.name;
      if (!owner || !name) return Promise.resolve(null);
      const editing = editor?.caseId === owner && editor?.name === name;
      return enqueue((path) => api.del(`${path}/markers/${key}`), () => {
        if (editing) { undoable('Removed from layer'); return; }
        // the layer is not open in the editor, so its history does not hold this: the marker's own restore does
        notify('Removed from layer', 'info', 7000, { label: 'Undo', onClick: () => enqueue((path) => api.post(`${path}/markers/${key}/restore`, {}),
          () => notify('Restored', 'ok', 1800), { owner, name }, { record: false }) });
      }, { owner, name }, { label: 'removal' });
    },
    refresh() {
      return enqueue((path) => api.get(`${path}/edit`), null, null, { record: false });
    },
    whenSaved() { return tail; },
    /** Take back the last edit, whatever it was; false when there is none. */
    undo() {
      if (!past.length) return false;
      stepBack();
      return true;
    },
    /** A group's features whose name says nothing a reader can use: none, or a numbered default. */
    unnamed(groupId) {
      return features.filter((feature) => feature.properties.group === groupId && !feature.properties.$absent
        && GENERIC_NAME.test(String(feature.properties.name ?? '').trim()));
    },
    /**
     * Name features after the place each stands in, asked of the app's reverse geocoder
     * one at a time (it keeps Nominatim's pace), then written in one edit, which one
     * undo takes back. `progress(done)` follows it, `stopped()` ends it early.
     */
    async nameAfterPlaces(keys, progress = () => {}, stopped = () => false) {
      if (!editor) return 0;
      const owner = editor.caseId, name = editor.name, stamp = generation;
      const named = new Map();
      let done = 0;
      for (const key of keys.slice(0, 500)) {
        if (stopped() || !current(owner, name, stamp)) break;
        const feature = stored.find((one) => one.properties.key === key);
        const point = feature ? centreOf(feature.geometry) : null;
        if (point) {
          try {
            const answer = await api.get(`/api/geo/reverse?lat=${point[1]}&lon=${point[0]}`);
            const place = placeName(answer?.address);
            if (place) named.set(key, place);
          } catch { /* a point the geocoder cannot name keeps its own */ }
        }
        done += 1;
        progress(done);
      }
      if (!named.size || !current(owner, name, stamp)) return 0;
      const put = stored.filter((one) => named.has(one.properties.key))
        .map((one) => ({ ...one, properties: { ...one.properties, name: named.get(one.properties.key) } }));
      await enqueue((path) => api.post(`${path}/revert`, { put, drop: [] }), () => undoable(`Named ${named.size} after their place`), null, { label: 'names' });
      return named.size;
    },
    /** Make the last edit taken back again; false when there is none. */
    redo() {
      if (!ahead.length) return false;
      stepForward();
      return true;
    },
  };
}

/** Whether a ring drawn for a circle or a box holds an area: three corners apart, not a point or a line. */
const encloses = (ring) => new Set(ring.map(([lon, lat]) => `${lon},${lat}`)).size >= 3;

/**
 * A circle or a box on the ground, from its centre or one corner (`anchor`) to the
 * point of the second press, as an open ring of `[lon, lat]` (the layer closes it).
 */
export function shapeRing(shape, [lon0, lat0], [lon1, lat1]) {
  if (shape === 'rect') return [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1]];
  const rad = Math.PI / 180;
  const R = 6378137;
  const s = Math.sin(((lat1 - lat0) * rad) / 2) ** 2 + Math.cos(lat0 * rad) * Math.cos(lat1 * rad) * Math.sin(((lon1 - lon0) * rad) / 2) ** 2;
  const d = (2 * R * Math.asin(Math.min(1, Math.sqrt(s)))) / R;
  return Array.from({ length: 64 }, (_, index) => {
    const theta = (index / 64) * 2 * Math.PI;
    const lat = Math.asin(Math.sin(lat0 * rad) * Math.cos(d) + Math.cos(lat0 * rad) * Math.sin(d) * Math.cos(theta));
    const lon = lon0 * rad + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(lat0 * rad), Math.cos(d) - Math.sin(lat0 * rad) * Math.sin(lat));
    return [Math.round((((lon / rad) + 540) % 360 - 180) * 1e7) / 1e7, Math.round((lat / rad) * 1e7) / 1e7];
  });
}

/** A name that says nothing: empty, or the numbered default an import or a tool gave it. */
export const GENERIC_NAME = /^((point|marker|placemark|line|ligne|area|zone|polygon|polygone|shape|feature|unnamed( feature)?)\s*\d*)?$/i;

/** The place an address names, nearest first: a village or a town before its district. */
export function placeName(address = {}) {
  return address?.village || address?.town || address?.city || address?.hamlet || address?.suburb || address?.municipality
    || address?.county || address?.state_district || address?.state || '';
}

/** A point standing for a geometry: itself, a line's middle corner, an area's average corner. */
export function centreOf(geometry) {
  const walk = (node) => (typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk));
  const points = walk(geometry?.coordinates);
  if (!points.length) return null;
  if (geometry.type === 'Point') return points[0];
  if (String(geometry.type).includes('Line')) return points[Math.floor(points.length / 2)];
  return [points.reduce((sum, [lon]) => sum + lon, 0) / points.length, points.reduce((sum, [, lat]) => sum + lat, 0) / points.length];
}
