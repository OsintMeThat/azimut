/** The personal-layer editor. Each click is saved separately, in click order. */
export function createMyLayersState({ api, layers, caseId, notify, reloadCase }) {
  let dialog = $state(null);
  let editor = $state(null);
  let features = $state.raw([]);
  let placing = $state(false);
  let pending = $state(0);
  let loading = $state(false);
  let selected = $state(null);
  let draft = $state({ name: '', colour: '#0072b2', symbol: 'pin' });
  let generation = 0;
  let tail = Promise.resolve();

  const base = (owner, name) => `/api/cases/${owner}/map-layers/${encodeURIComponent(name)}`;
  const current = (owner, name, stamp) =>
    generation === stamp && caseId() === owner && editor?.name === name;

  function close() {
    generation += 1;
    placing = false;
    editor = null;
    selected = null;
    features = [];
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
      const answer = await api.get(`${base(owner, row.name)}/edit`);
      if (!current(owner, row.name, stamp)) return;
      editor = { ...answer.layer, caseId: owner };
      features = answer.document.features;
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
    const key = answer.marker.properties.key;
    const at = features.findIndex((feature) => feature.properties.key === key);
    features = at < 0 ? [...features, answer.marker]
      : features.map((feature, index) => index === at ? answer.marker : feature);
    if (selected?.properties.key === key) selected = answer.marker;
  }

  function enqueue(run, after = null) {
    if (!editor || loading) return Promise.resolve(null);
    const owner = editor.caseId;
    const name = editor.name;
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
    if (!placing || !editor || loading || caseId() !== editor.caseId) return false;
    const body = { lat: point.lat, lon: point.lon, ...draft };
    enqueue((path) => api.post(`${path}/markers`, body));
    return true;
  }

  return {
    get dialog() { return dialog; },
    get editor() { return editor; },
    get features() { return features; },
    get placing() { return placing; },
    get loading() { return loading; },
    get pending() { return pending; },
    get draft() { return draft; },
    get selected() { return selected; },
    newLayer(source = null) { dialog = { source }; },
    cancelNew() { dialog = null; },
    create,
    open,
    close,
    start() { if (editor && !loading) { selected = null; placing = true; } },
    stop() { placing = false; },
    addPoint,
    select(key) {
      placing = false;
      selected = features.find((feature) => feature.properties.key === key) ?? null;
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
    whenSaved() { return tail; },
  };
}
