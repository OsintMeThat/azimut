/** The personal-layer editor. Each click is saved separately, in click order. */
export function createMyLayersState({ api, layers, caseId, notify, reloadCase,
  beginSession = (path) => api.post(`${path}/edit`, {}) }) {
  let dialog = $state(null);
  let exporting = $state(null);
  let editor = $state(null);
  let features = $state.raw([]);
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
  let generation = 0;
  let tail = Promise.resolve();
  /** What the feature panel edits, each field in the shape its input holds. */
  const formOf = (feature) => {
    if (!feature) return null;
    const properties = feature.properties;
    return { name: properties.name ?? '', description: properties.description ?? '',
      colour: properties.colour || '#0072b2', symbol: properties.symbol || 'pin', group: properties.group ?? '',
      date: properties.date ?? '', status: properties.status ?? '', bearing: properties.bearing ?? '',
      links: [...(properties.links ?? [])], provenance: properties.provenance ?? '' };
  };
  /** The fields an edit clears by sending nothing, as the backend's `CLEARABLE`. */
  const CLEARABLE = ['date', 'status', 'bearing', 'links', 'provenance'];
  /** What the panel changed on the selected feature, as the patch that saves it. */
  function formPatch() {
    if (!selected || !form) return {};
    const before = formOf(selected), patch = {};
    for (const [key, value] of Object.entries(form)) {
      if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
      if (key === 'links') {
        const links = value.map((link) => String(link).trim()).filter(Boolean);
        if (JSON.stringify(links) !== JSON.stringify(before.links)) patch.links = links.length ? links : null;
      } else if (key === 'bearing') patch.bearing = value === '' || value === null ? null : Number(value);
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
  const current = (owner, name, stamp) =>
    generation === stamp && caseId() === owner && editor?.name === name;

  function close() {
    generation += 1;
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
    features = [];
    groups = [];
    group = '';
    loading = false;
  }

  async function open(row) {
    close();
    const owner = caseId();
    if (!owner || !row?.editable) return;
    const stamp = generation;
    editor = { ...row, caseId: owner };
    loading = true;
    try {
      const answer = await beginSession(base(owner, row.name));
      if (!current(owner, row.name, stamp)) return;
      editor = { ...answer.layer, caseId: owner };
      details = detailsOf(editor);
      features = answer.document.features;
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
      features = answer.document.features;
      const available = new Set(features.map((feature) => feature.properties.key));
      selection = selection.filter((key) => available.has(key));
      const before = formOf(selected);
      selected = features.find((item) => item.properties.key === selected?.properties.key) ?? null;
      form = mergeDraft(form, before, formOf(selected));
      return;
    }
    if (!answer.marker) return;
    const key = answer.marker.properties.key;
    const at = features.findIndex((feature) => feature.properties.key === key);
    features = at < 0 ? [...features, answer.marker]
      : features.map((feature, index) => index === at ? answer.marker : feature);
    if (selected?.properties.key === key) {
      const before = formOf(selected);
      selected = answer.marker;
      form = mergeDraft(form, before, formOf(selected));
    }
  }

  function enqueue(run, after = null, context = null) {
    if ((!editor || loading) && !context) return Promise.resolve(null);
    const owner = context?.owner ?? editor.caseId;
    const name = context?.name ?? editor.name;
    const stamp = generation;
    pending += 1;
    const task = tail.then(async () => {
      try {
        const answer = await run(base(owner, name));
        settle(owner, name, stamp, answer);
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

  /** The toast that offers to take back an edit to several features at once. */
  function undoable(message, batch, owner, name) {
    if (!batch) { notify(message, 'ok', 2600); return; }
    notify(message, 'info', 7000, { label: 'Undo', onClick: () =>
      enqueue((path) => api.post(`${path}/selection/${batch}/restore`, {}), null, { owner, name }) });
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
    enqueue((path) => api.patch(`${path}/markers/${key}`, patch));
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

  function addPoint(point) {
    if (sketch && !loading && editor?.caseId === caseId()) {
      if (sketch.type === 'Point' || sketch.type === 'Selection') sketch.rings = [[[point.lon, point.lat]]];
      else if (sketch.rings.flat().length < 4095) sketch.rings[0].push([point.lon, point.lat]);
      return true;
    }
    if (!placing || !editor || loading || caseId() !== editor.caseId) return false;
    const body = { lat: point.lat, lon: point.lon, ...draft, ...(group ? { group } : {}) };
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
        ...fields, ...(target ? { group: target } : {}),
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

  async function finish(discard = false) {
    placing = false;
    const owner = editor?.caseId, name = editor?.name, token = checkpoint, stamp = generation;
    const answer = await enqueue((path) => api.post(`${path}/edit/finish`, {
      token, revision: current(owner, name, stamp) ? editor.edit_revision : '', discard,
    }));
    if (answer && current(owner, name, stamp)) close();
    return !!answer;
  }

  return {
    get dialog() { return dialog; },
    get exporting() { return exporting; },
    download(row) { exporting = { row, caseId: caseId() }; },
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
    get changed() { return !!editor?.edit_changed || !!sketch || !sameForm(form, formOf(selected)) || !sameForm(details, detailsOf(editor)); },
    get loading() { return loading; },
    get pending() { return pending; },
    get draft() { return draft; },
    get selected() { return selected; },
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
      return !!(await enqueue((path) => api.patch(`${path}/markers/${selected.properties.key}`, patch)));
    },
    async saveDetails() {
      const patch = detailsPatch();
      if (!Object.keys(patch).length) return false;
      if ('title' in patch && !patch.title) { notify('Give the layer a name', 'danger', 4000); return null; }
      return !!(await enqueue((path) => api.patch(`${path}/edit`, patch)));
    },
    /** Everything the panel and the map hold, saved, then the session closed. */
    async done() {
      if (sketch && !this.complete) return false;
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
    copy(row, feature) { copying = { row, feature, caseId: caseId() }; },
    cancelCopy() { copying = null; },
    addPoints,
    startShape(type) {
      if (!editor || loading) return;
      commitForm();
      placing = false; lassoing = false; selected = null; selection = []; form = null;
      sketch = { type, key: null, rings: [[]] };
    },
    editGeometry() {
      const shape = selected?.geometry;
      if (!shape || !['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(shape.type)) return;
      placing = false; lassoing = false;
      const coords = JSON.parse(JSON.stringify(shape.coordinates));
      const open = (ring) => ring.slice(0, -1);
      sketch = { type: shape.type, key: selected.properties.key,
        rings: shape.type === 'Point' ? [[coords]] : shape.type === 'LineString' ? [coords]
          : shape.type === 'MultiLineString' ? coords : shape.type === 'MultiPolygon' ? coords.flatMap((polygon) => polygon.map(open))
            : coords.map(open),
        ...(shape.type === 'MultiPolygon' ? { parts: coords.map((polygon) => polygon.length) } : {}) };
    },
    moveVertex(ring, index, point) { if (sketch) sketch.rings[ring][index] = [point.lon, point.lat]; },
    insertVertex(ring, index, point) {
      if (sketch && sketch.rings.flat().length < 4095) sketch.rings[ring].splice(index, 0, [point.lon, point.lat]);
    },
    removeVertex(ring, index) { if (sketch) sketch.rings[ring].splice(index, 1); },
    undoVertex() { if (sketch && !sketch.key) sketch.rings[0].pop(); },
    get complete() {
      const least = sketch?.type?.includes('Polygon') ? 3 : sketch?.type?.includes('LineString') ? 2 : 1;
      return !!sketch && sketch.rings.every((ring) => ring.length >= least);
    },
    async saveGeometry() {
      if (!sketch) return null;
      const before = sketch, shape = geometry(), key = sketch.key;
      const body = { geometry: shape, colour: draft.colour, ...(group ? { group } : {}) };
      const answer = await enqueue((path) => before.type === 'Selection' ? api.post(`${path}/selection`, {
        keys: before.keys, offset: [before.rings[0][0][0] - before.origin[0], before.rings[0][0][1] - before.origin[1]],
      }) : key ? api.patch(`${path}/markers/${key}`, { geometry: shape })
        : api.post(`${path}/shapes`, body));
      if (answer && sketch === before) sketch = null;
      return answer;
    },
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
      return enqueue((path) => api.post(`${path}/selection`, { keys, changes }));
    },
    removeSelection() {
      const keys = [...selection];
      const owner = editor?.caseId, name = editor?.name;
      return enqueue((path) => api.post(`${path}/selection`, { keys, remove: true }), (answer) => {
        undoable(keys.length === 1 ? 'Removed from layer' : `Removed ${keys.length} features from layer`, answer.batch, owner, name);
      });
    },
    /** Move features by a distance in degrees, as one edit the toast can undo. */
    moveFeatures(keys, offset) {
      const owner = editor?.caseId, name = editor?.name;
      return enqueue((path) => api.post(`${path}/selection`, { keys, offset }), (answer) => {
        const moved = keys.length - (answer.kept ?? 0);
        if (answer.kept && !moved) notify('Linked markers stay on the case item they follow', 'info', 4000);
        else undoable(answer.kept ? `Moved ${moved}; ${answer.kept} linked stay on their case item` : moved === 1 ? 'Moved' : `Moved ${moved} features`,
          answer.batch, owner, name);
      }).finally(() => { dragging = null; });
    },
    merge() {
      const keys = [...selection], owner = editor?.caseId, name = editor?.name;
      return enqueue((path) => api.post(`${path}/merge`, { keys }), (answer) => {
        chooseKeys([answer.key]);
        undoable(`Merged ${keys.length} features`, answer.batch, owner, name);
      });
    },
    split(key, at = null) {
      const owner = editor?.caseId, name = editor?.name;
      return enqueue((path) => api.post(`${path}/split`, { key, ...(at === null ? {} : { at }) }), (answer) => {
        sketch = null;
        chooseKeys(answer.keys);
        undoable(`Split into ${answer.keys.length}`, answer.batch, owner, name);
      });
    },
    unlink(key) { return enqueue((path) => api.patch(`${path}/markers/${key}`, { unlink: true })); },
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
    updateGroup(key, changes) {
      return enqueue((path) => api.patch(`${path}/groups/${key}`, changes));
    },
    removeGroup(key) {
      return enqueue((path) => api.del(`${path}/groups/${key}`));
    },
    reorderGroups(ids) { return enqueue((path) => api.post(`${path}/groups/order`, { ids })); },
    reorderFeatures(keys, group, before = null) {
      return enqueue((path) => api.post(`${path}/features/order`, { keys, group, before }));
    },
    updateDetails(changes) { return enqueue((path) => api.patch(`${path}/edit`, changes)); },
    toggleGroup(target) {
      return enqueue(async (path) => {
        const fresh = await api.get(`${path}/edit`);
        const name = fresh.groups.find((group) => group.id === target.id)?.name;
        if (!name) throw new Error('This group is no longer in the layer');
        const hidden = [...(fresh.layer.hidden ?? [])];
        const at = hidden.indexOf(name);
        if (at < 0) hidden.push(name); else hidden.splice(at, 1);
        await api.patch(path, { hidden });
        return api.get(`${path}/edit`);
      });
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
     * point: its name, note, day and the addresses its note cites come along.
     */
    async copyTo(row, groupId = null) {
      const job = copying;
      if (!job || !row) return null;
      const owner = job.caseId;
      const { geometry, properties = {} } = job.feature;
      const links = [...new Set(String(properties.description ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])].slice(0, 10);
      const fields = {
        name: properties.name ?? '', description: properties.description ?? '', provenance: 'external',
        ...(properties.date ? { date: properties.date } : {}), ...(links.length ? { links } : {}),
        ...(/^#[0-9a-f]{6}$/i.test(properties.colour ?? '') ? { colour: properties.colour } : {}),
        ...(groupId ? { group: groupId } : {}),
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
      return enqueue((path) => api.del(`${path}/markers/${key}`), () => {
        notify('Removed from layer', 'info', 7000, { label: 'Undo', onClick: async () => {
          await enqueue((path) => api.post(`${path}/markers/${key}/restore`, {}),
            () => notify('Restored', 'ok', 2200), { owner, name });
        } });
      }, { owner, name });
    },
    refresh() {
      return enqueue((path) => api.get(`${path}/edit`));
    },
    whenSaved() { return tail; },
  };
}
