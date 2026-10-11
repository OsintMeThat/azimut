/** The personal-layer editor. Each click is saved separately, in click order. */
export function createMyLayersState({ api, layers, caseId, notify, reloadCase,
  beginSession = (path) => api.post(`${path}/edit`, {}) }) {
  let dialog = $state(null);
  let exporting = $state(null);
  let maps = $state(null);
  let legend = $state(null);
  let editor = $state(null);
  let features = $state.raw([]);
  let groups = $state([]);
  let group = $state('');
  let placing = $state(false);
  let sketch = $state(null);
  let checkpoint = $state(null);
  let pending = $state(0);
  let loading = $state(false);
  let selected = $state(null);
  let selection = $state([]);
  let anchor = null;
  let form = $state(null);
  let draft = $state({ name: '', colour: '#0072b2', symbol: 'pin' });
  let generation = 0;
  let tail = Promise.resolve();
  const formOf = (feature) => feature ? { name: feature.properties.name ?? '', description: feature.properties.description ?? '',
    colour: feature.properties.colour || '#0072b2', symbol: feature.properties.symbol || 'pin', group: feature.properties.group ?? '' } : null;
  const sameForm = (first, second) => JSON.stringify(first) === JSON.stringify(second);

  const base = (owner, name) => `/api/cases/${owner}/map-layers/${encodeURIComponent(name)}`;
  const current = (owner, name, stamp) =>
    generation === stamp && caseId() === owner && editor?.name === name;

  function close() {
    generation += 1;
    placing = false;
    sketch = null;
    checkpoint = null;
    editor = null;
    selected = null;
    selection = []; anchor = null;
    form = null;
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

  async function create(title, file = null) {
    const source = dialog?.source;
    const owner = caseId();
    const row = source
      ? await layers.copyEditable(source, title)
      : file ? await layers.importEditable(file, title) : await layers.createEditable(title);
    // Creating a first case is allowed; switching an existing case meanwhile is not.
    if (!row || (owner && owner !== caseId())) return;
    dialog = null;
    await open(row);
  }

  function settle(owner, name, stamp, answer) {
    if (caseId() === owner) layers.edited(owner, answer.layer);
    if (!current(owner, name, stamp)) return;
    editor = { ...answer.layer, caseId: owner };
    if (answer.groups) {
      groups = answer.groups;
      if (!groups.some((item) => item.id === group)) group = groups[0]?.id ?? '';
    }
    if (answer.document) {
      features = answer.document.features;
      const available = new Set(features.map((feature) => feature.properties.key));
      selection = selection.filter((key) => available.has(key));
      const clean = sameForm(form, formOf(selected));
      selected = features.find((item) => item.properties.key === selected?.properties.key) ?? null;
      if (!selected || clean) form = formOf(selected);
      return;
    }
    if (!answer.marker) return;
    const key = answer.marker.properties.key;
    const at = features.findIndex((feature) => feature.properties.key === key);
    features = at < 0 ? [...features, answer.marker]
      : features.map((feature, index) => index === at ? answer.marker : feature);
    if (selected?.properties.key === key) {
      const clean = sameForm(form, formOf(selected));
      selected = answer.marker;
      if (clean) form = formOf(selected);
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

  function geometry() {
    if (!sketch) return null;
    const rings = JSON.parse(JSON.stringify(sketch.rings));
    return { type: sketch.type, coordinates: sketch.type === 'Point' ? rings[0][0]
      : sketch.type === 'LineString' ? rings[0] : rings.map((ring) => [...ring, ring[0]]) };
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
    get maps() { return maps; },
    get legend() { return legend; },
    setLegend(view, owner = caseId()) { legend = view ? { view, caseId: owner } : null; },
    download(row) { exporting = { row, caseId: caseId() }; },
    cancelDownload() { exporting = null; },
    openMaps(name = '') { maps = { name, caseId: caseId() }; },
    closeMaps() { maps = null; },
    get editor() { return editor; },
    get features() { return features; },
    get groups() { return groups; },
    get group() { return group; },
    set group(value) { group = value; },
    get placing() { return placing; },
    get sketch() { return sketch; },
    get armed() { return placing || !!sketch; },
    get changed() { return !!editor?.edit_changed || !!sketch || !sameForm(form, formOf(selected)); },
    get loading() { return loading; },
    get pending() { return pending; },
    get draft() { return draft; },
    get selected() { return selected; },
    get selection() { return selection; },
    get form() { return form; },
    newLayer(source = null) { dialog = { source }; },
    cancelNew() { dialog = null; },
    create,
    open,
    close,
    finish,
    start() { if (editor && !loading) { selected = null; selection = []; form = null; sketch = null; placing = true; } },
    stop() { placing = false; sketch = null; },
    startShape(type) {
      if (!editor || loading) return;
      placing = false; selected = null; selection = []; form = null;
      sketch = { type, key: null, rings: [[]] };
    },
    editGeometry() {
      const shape = selected?.geometry;
      if (!shape || !['Point', 'LineString', 'Polygon'].includes(shape.type)) return;
      placing = false;
      const coords = JSON.parse(JSON.stringify(shape.coordinates));
      sketch = { type: shape.type, key: selected.properties.key, rings: shape.type === 'Point' ? [[coords]]
        : shape.type === 'LineString' ? [coords] : coords.map((ring) => ring.slice(0, -1)) };
    },
    moveVertex(ring, index, point) { if (sketch) sketch.rings[ring][index] = [point.lon, point.lat]; },
    insertVertex(ring, index, point) {
      if (sketch && sketch.rings.flat().length < 4095) sketch.rings[ring].splice(index, 0, [point.lon, point.lat]);
    },
    removeVertex(ring, index) { if (sketch) sketch.rings[ring].splice(index, 1); },
    undoVertex() { if (sketch && !sketch.key) sketch.rings[0].pop(); },
    get complete() {
      return !!sketch && sketch.rings.every((ring) => ring.length >= (sketch.type === 'Polygon' ? 3 : sketch.type === 'LineString' ? 2 : 1));
    },
    async saveGeometry() {
      if (!sketch) return null;
      const before = sketch, shape = geometry(), key = sketch.key;
      const body = { geometry: shape, name: draft.name, colour: draft.colour,
        description: '', ...(group ? { group } : {}) };
      const answer = await enqueue((path) => before.type === 'Selection' ? api.post(`${path}/selection`, {
        keys: before.keys, offset: [before.rings[0][0][0] - before.origin[0], before.rings[0][0][1] - before.origin[1]],
      }) : key ? api.patch(`${path}/markers/${key}`, { geometry: shape })
        : api.post(`${path}/shapes`, body));
      if (answer && sketch === before) sketch = null;
      return answer;
    },
    addPoint,
    select(key) {
      placing = false;
      sketch = null;
      selected = features.find((feature) => feature.properties.key === key) ?? null;
      selection = selected ? [key] : []; anchor = key;
      form = formOf(selected);
      if (selected?.properties.group) group = selected.properties.group;
    },
    toggleSelected(key, order, range = false) {
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
        notify(`Removed ${keys.length} features from layer`, 'info', 7000, { label: 'Undo', onClick: () =>
          enqueue((path) => api.post(`${path}/selection/${answer.batch}/restore`, {}), null, { owner, name }) });
      });
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
    updateGroup(key, changes) {
      return enqueue((path) => api.patch(`${path}/groups/${key}`, changes));
    },
    removeGroup(key) {
      return enqueue((path) => api.del(`${path}/groups/${key}`));
    },
    reorderGroups(ids) { return enqueue((path) => api.post(`${path}/groups/order`, { ids })); },
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
    addPlaces(ids) {
      const target = group;
      return enqueue((path) => api.post(`${path}/places`, { ids, ...(target ? { group: target } : {}) }));
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
