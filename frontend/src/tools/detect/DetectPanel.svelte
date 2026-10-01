<script>
  /**
   * Detect's column: the case's routines and single passes, one detection's own
   * page, the step-by-step build of a new one, the review of what a run found,
   * and the library of what detections can look for.
   *
   * It opens on the list because that is what an analyst comes back to. Runs
   * are queued in the case and keep going whichever tool is open; the top bar
   * follows them (lib/detectRuns.svelte.js) and this list reads the same rows.
   * Opening the panel reads local state only. Starting a run is what fetches
   * imagery.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { ensureCase, reloadCase, toast } from '../../lib/state.svelte.js';
  import { detectRuns, refreshRuns } from '../../lib/detectRuns.svelte.js';
  import { clone, zoneRing } from '../../lib/map/analyzers.js';
  import { passBefore } from '../../lib/map/detectWhen.js';
  import { candidatePair } from '../../lib/map/detectReview.js';
  import { recipeCapability } from '../../lib/map/analyzerRules.js';
  import { containsPoint } from '../../lib/measure.js';
  import { detectionsWithRuns, isActive, plural } from '../../lib/map/detections.js';
  import AnalyzerLibrary from './AnalyzerLibrary.svelte';
  import DetectDetection from './DetectDetection.svelte';
  import DetectHome from './DetectHome.svelte';
  import DetectReview from './DetectReview.svelte';
  import DetectWizard from './DetectWizard.svelte';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import AreaDates from './AreaDates.svelte';
  import AreasPanel from './AreasPanel.svelte';

  let {
    caseId,
    collapsed = $bindable(false),
    dockWidth = 380,
    maxDockWidth = () => 720,
    onwidth = () => {},
    onwidthend = () => {},
    /** Whether Detect holds the whole screen, and the way in and out of it. */
    fullscreen = false,
    onfullscreen = () => {},
    manual = $bindable(null),
    zones = $bindable([]),
    drawing = $bindable('select'),
    selectedZone = $bindable(null),
    layers = $bindable([]),
    showZones = $bindable(true),
    /** The candidate the review is on, so the map can ring the same one. */
    selectedResult = $bindable(null),
    /** The review's eye and blink (DetectReview), which only a review holds. */
    bare = $bindable(false),
    blinking = $bindable(false),
    /** Whether a run's results are open, which holds the map on them. */
    reviewing = $bindable(false),
    /** The run being reviewed; the map isolates its overlay without changing saved visibility. */
    focusedRunId = $bindable(null),
    /** Every watched area of the case, for the map to draw while the list is up. */
    areaGroups = $bindable([]),
    /** The areas the pointer is on, drawn heavier on the map. */
    highlight = $bindable([]),
    /** A saved item to open (`runs-<id>`, `followups-<id>`, `zones-<id>`). */
    opening = null,
    onopened = () => {},
    onfocus = () => {},
    /** Frame a set of areas on the map, so opening a routine shows all of it.
     *  `{ landing: true }` marks the once-per-case framing on arrival. */
    onframe = () => {},
    onusecurrentview = () => {},
    /** Put a Copernicus pass on the map, so the picture matches the work. */
    onshow = () => {},
    onleavepass = () => {},
    /** The passes the candidate under review was read between, or null. */
    onpair = () => {},
    /** The bench the map draws while an analyzer of your own is built (AnalyzerBuilder). */
    builder = $bindable(null),
    /** The map's view, for the builder to look up passes on. */
    viewBounds = () => null,
    /** The Copernicus layers on offer and a way to frame a place, which the builder uses. */
    passLayers = [],
    onfly = () => {},
  } = $props();

  const TITLES = { new: 'New detection', review: 'Results', library: 'Analyzers' };
  let resizing = $state(false);
  let stopResize = () => {};
  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    stopResize();
    resizing = true;
    const startX = event.clientX;
    const startWidth = dockWidth;
    const move = (next) => onwidth(startWidth + startX - next.clientX);
    const end = () => { stopResize(); onwidthend(); };
    stopResize = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      resizing = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
  function resizeKey(event) {
    const next = event.key === 'ArrowLeft' ? dockWidth + 20
      : event.key === 'ArrowRight' ? dockWidth - 20
      : event.key === 'Home' ? 300 : event.key === 'End' ? maxDockWidth() : null;
    if (next === null) return;
    event.preventDefault();
    onwidth(next);
    onwidthend();
  }
  $effect(() => () => stopResize());

  let catalogue = $state(null);
  let lists = $state({ zones: [], followups: [], areas: [] });
  let hiddenAreas = $state([]);
  let launch = $state(null);
  let repeatRequest = $state(null);
  let repeatQueue = $state([]);
  let selectedArea = $state(null);
  /** 'home', 'detection', 'new', 'review' or 'library'. */
  let view = $state('home');
  let tab = $state('routines');
  let picking = $state(false);
  let newActionEl = $state(null);
  // Pointerdown in the capture phase, so a press on the map still closes it.
  $effect(() => {
    if (!picking) return;
    const outside = (event) => {
      if (newActionEl && !newActionEl.contains(event.target)) picking = false;
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });
  /** The wizard's starting point while one is open; a new object mounts a fresh one. */
  let draft = $state(null);
  /** Where the library goes back to, and where the review returns to. */
  let libraryFrom = $state('home');
  let offer = $state(null);
  /** The routine being looked at: its saved body and what it has found. */
  let detectionId = $state(null);
  let detail = $state(null);
  let findings = $state([]);
  let current = $state(null);
  let candidateId = $state(null);
  let busy = $state(false);
  let error = $state('');
  /** Undefined until the first case is seen, so mounting is not a case switch. */
  let loadedCase;
  /** Whether this case's areas have framed the map once. */
  let framed = false;
  let generation = 0;

  const base = (id = caseId) => `/api/cases/${id}/analysis`;
  const runs = $derived(detectRuns.caseId === caseId ? detectRuns.rows : []);
  const routines = $derived(detectionsWithRuns(lists.followups, runs));
  const detection = $derived(routines.find((row) => row.id === detectionId) ?? null);
  /** What a recipe's method can do; an analyzer of your own answers from its rules. */
  const capabilityOf = (recipe) => recipeCapability(recipe, catalogue?.methods ?? []);
  const launchOrderInvalid = (item) => !capabilityOf(item.recipe).single && item.area_dates.some((pair) =>
    !passBefore(item.date_rule === 'latest_previous' && item.lastPasses[pair.area_id] || pair.a,
      pair.b, capabilityOf(item.recipe).sensor === 'sentinel1'));
  const pending = $derived(isActive(current));
  let library = $state(null);
  const kindTitle = $derived(draft?.kind === 'routine' ? (draft.followupId ? 'Edit routine' : 'New routine') : 'New pass');

  $effect(() => { selectedResult = view === 'review' ? candidateId : null; });
  $effect(() => { reviewing = view === 'review'; });
  $effect(() => { focusedRunId = view === 'review' ? current?.id ?? null : null; });
  $effect(() => {
    if (view === 'review') return;
    bare = false;
    blinking = false;
  });
  // The map draws every watched area while the list is up, and only the open
  // detection's or run's ground once one is open: what is on screen is what is
  // in hand. One drawing either way, in the area's own colour, so the same
  // ground is never outlined twice in two colours.
  const openZones = $derived(
    view === 'detection' ? detail?.zones ?? [] : view === 'review' ? current?.input?.zones ?? [] : null
  );
  $effect(() => {
    if (!showZones) { areaGroups = []; return; }
    if (openZones) {
      areaGroups = openZones.map((zone) => ({
        id: zone.id, title: zone.name,
        colour: lists.areas.find((area) => area.id === zone.id)?.colour || '#38bdf8',
        zones: [zone],
      }));
      return;
    }
    areaGroups = lists.areas.filter((area) => !hiddenAreas.includes(area.id)).map((area) => ({
      id: area.id, title: area.name, colour: area.colour, zones: [areaZone(area)],
    }));
  });

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  async function loadCatalogue() {
    catalogue = await api.get('/api/compare/analyzers');
  }

  async function refresh(id = caseId) {
    if (!id) return;
    const epoch = generation;
    // Reading groups can promote drawings from older area sets into shared areas.
    const groups = await api.get(`${base(id)}/zones`);
    const [followups, areas] = await Promise.all([
      api.get(`${base(id)}/followups`), api.get(`${base(id)}/areas`),
    ]);
    if (epoch !== generation) return;
    lists = { zones: groups, followups, areas };
    // Opening Detect on a case that already watches ground should show that
    // ground, not the home view it has nothing to do with. Once per case: after
    // that the camera is the analyst's.
    if (!framed && areas.length) {
      framed = true;
      onframe(areas.map(areaZone), { landing: true });
    }
  }

  const areaZone = (area) => ({ id: area.id, name: area.name, kind: 'polygon',
    points: area.geometry.coordinates[0].slice(0, -1) });

  onMount(() => {
    let alive = true;
    loadCatalogue().catch((e) => { if (alive) error = e.message; });
    return () => { alive = false; generation++; };
  });

  // Another case is other work: its areas, drafts and result layers are not
  // this one's. Mounting is not a switch, so re-entering Detect keeps its place.
  $effect(() => {
    const id = caseId;
    if (id === loadedCase) return;
    const switching = loadedCase !== undefined;
    loadedCase = id; generation++;
    untrack(() => {
      current = null; candidateId = null; draft = null;
      detectionId = null; detail = null; findings = [];
      if (switching) {
        layers = []; zones = []; selectedZone = null; drawing = 'select'; view = 'home';
      }
      lists = { zones: [], followups: [], areas: [] };
      framed = false;
      hiddenAreas = []; launch = null; repeatRequest = null; repeatQueue = []; manual = null;
      onleavepass();
      if (id) {
        void refresh(id).catch((e) => (error = e.message));
        void refreshRuns(id).catch((e) => (error = e.message));
      }
    });
  });

  // Saved work is local and visible on landing, including runs made by routines.
  $effect(() => {
    const ready = runs.filter((run) => run.status === 'ready').map((run) => run.id);
    const epoch = generation;
    untrack(() => {
      for (const id of ready.filter((id) => !layers.some((layer) => layer.id === id))) {
        void api.get(`${base()}/runs/${id}`).then((run) => {
          if (epoch === generation && run?.input && !layers.some((layer) => layer.id === id)) {
            layers = [...layers, { ...run, visible: true }];
          }
        }).catch((e) => (error = e.message));
      }
    });
  });

  // A routine's chosen colour paints all of its saved overlays, including
  // earlier runs. Their recorded imagery and results remain as they were.
  $effect(() => {
    const colours = new Map(lists.followups.map((item) => [item.id, item.colour]));
    const updated = layers.map((layer) => {
      const colour = colours.get(layer.input?.followup_id) || layer.display_colour || null;
      return layer.displayColour === colour ? layer : { ...layer, displayColour: colour };
    });
    if (updated.some((layer, index) => layer !== layers[index])) layers = updated;
  });

  // A run under review that is still working is read again until it settles.
  $effect(() => {
    if (!pending || !caseId) return;
    const id = current.id;
    const owner = caseId;
    const epoch = generation;
    let stopped = false;
    let timer;
    async function poll() {
      try {
        const run = await api.get(`${base(owner)}/runs/${id}`);
        if (stopped || epoch !== generation) return;
        acceptRun(run);
        if (isActive(run)) timer = setTimeout(poll, 900);
      } catch (e) { if (!stopped) error = e.message; }
    }
    timer = setTimeout(poll, 900);
    return () => { stopped = true; clearTimeout(timer); };
  });

  $effect(() => {
    // Analyzers belong to every case, so one opens with no case at all.
    if (!opening || (!caseId && !opening.startsWith('analyzer:'))) return;
    const match = /^(areas|zones|followups|runs)-([a-f0-9]{12})$/.exec(opening);
    // An analyzer kept from elsewhere (Compare's Difference) opens in the library.
    const analyzer = /^analyzer:(custom-[a-f0-9]{12})$/.exec(opening);
    untrack(() => {
      onopened();
      if (match) void act(() => openItem(match[1], match[2]));
      else if (analyzer) void act(() => openAnalyzer(analyzer[1]));
    });
  });

  function acceptRun(run) {
    current = run;
    if (run.status === 'ready') {
      const old = layers.find((r) => r.id === run.id);
      layers = [...layers.filter((r) => r.id !== run.id), { ...clone(run), visible: old?.visible ?? true }];
      if (!run.results.some((r) => r.id === candidateId)) candidateId = run.results[0]?.id ?? null;
    }
  }

  function goHome() {
    picking = false;
    manual = null;
    onleavepass();
    view = 'home';
    draft = null;
    launch = null;
    detectionId = null; detail = null; findings = [];
    zones = []; selectedZone = null; drawing = 'select';
  }

  function startWizard(seed) {
    manual = null;
    onleavepass();
    offer = null;
    launch = null;
    draft = seed;
    selectedZone = null; drawing = 'select';
    view = 'new';
  }

  /** A run saved against Wayback names no Copernicus day, so the map keeps its own. */
  const day = (source) => (['sentinel2', 'sentinel1'].includes(source?.provider) && source.date ? source : null);

  async function openDetection(id) {
    const epoch = generation;
    const [body, found] = await Promise.all([
      api.get(`${base()}/followups/${id}`), api.get(`${base()}/followups/${id}/findings`),
    ]);
    if (epoch !== generation) return;
    detectionId = id; detail = body; findings = found;
    zones = [];
    draft = null;
    view = 'detection';
    onleavepass();
    onframe(body.zones ?? []);
  }

  async function openRun(id, resultId = null) {
    manual = null;
    const epoch = generation;
    const run = await api.get(`${base()}/runs/${id}`);
    if (epoch !== generation) return;
    draft = null;
    candidateId = resultId;
    acceptRun(run);
    if (resultId) candidateId = resultId;
    zones = [];
    // The pass the candidate was read on, not the end of the run's window: a
    // click on the map reopens the run, and the review already showing that
    // candidate would not put its own pass back.
    const candidate = run.results?.find((row) => row.id === resultId);
    const shown = day(candidatePair(candidate, run).b);
    if (shown) onshow(shown);
    libraryFrom = detectionId && run.input.followup_id === detectionId ? 'detection' : 'home';
    view = 'review';
    tab = 'saved';
  }

  async function editDetection(id) {
    const epoch = generation;
    const [body, lastPasses] = await Promise.all([
      api.get(`${base()}/followups/${id}`), api.get(`${base()}/followups/${id}/last-passes`),
    ]);
    if (epoch !== generation) return;
    zones = clone(body.zones);
    startWizard({ body, followupId: id, kind: 'routine', lastPasses });
  }

  async function openItem(kind, id) {
    collapsed = false;
    if (kind === 'areas') { openTab('areas'); return; }
    if (kind === 'runs') return openRun(id);
    if (kind === 'followups') return openDetection(id);
    const group = await api.get(`${base()}/zones/${id}`);
    if (group.pending_review?.length) { openTab('areas'); return; }
    if (group.area_ids) {
      if (group.area_ids.length > 32) { openTab('areas'); return; }
      const shared = await api.get(`${base()}/areas`);
      zones = group.area_ids.map((areaId) => shared.find((area) => area.id === areaId))
        .filter(Boolean).map(areaZone);
    } else {
      zones = clone(group.zones ?? []);
    }
    startWizard({ kind: 'once' });
  }

  function newDetection(kind) {
    collapsed = false; picking = false;
    zones = [];
    startWizard({ kind });
  }

  function editRun() {
    if (!current) return;
    const watch = current.input?.followup_id;
    if (watch && lists.followups.some((row) => row.id === watch)) return act(() => editDetection(watch));
    zones = clone(current.input.zones);
    startWizard({ kind: 'once', body: { ...clone(current.input), followup_id: null }, fromRun: true });
  }

  async function openAnalyzer(id) {
    collapsed = false;
    await loadCatalogue();
    libraryFrom = 'home';
    view = 'library';
    await tick();
    library?.openEntry(id);
  }

  function openLibrary() {
    libraryFrom = view === 'new' ? 'new' : view === 'detection' ? 'detection' : 'home';
    view = 'library';
  }

  function back() {
    if (launch) { launch = null; onleavepass(); return; }
    if (view === 'library') {
      view = libraryFrom === 'new' && draft ? 'new' : libraryFrom === 'detection' && detection ? 'detection' : 'home';
      return;
    }
    if (view === 'review' && libraryFrom === 'detection' && detection) {
      void act(() => openDetection(detection.id));
      return;
    }
    if (view === 'new' && draft?.followupId && detection) {
      void act(() => openDetection(detection.id));
      return;
    }
    goHome();
  }

  /**
   * Save, run, or both, as the last step asked. A routine runs through its own
   * route, so the run belongs to it and gathers on its page; a single pass is
   * a run and nothing else.
   */
  async function submit({ input, followupId, kind, run }) {
    const owner = await ensureCase();
    let runStatus = run ? 'queued' : '';
    if (kind === 'routine') {
      const saved = followupId
        ? await api.put(`${base(owner.id)}/followups/${followupId}`, input)
        : await api.post(`${base(owner.id)}/followups`, input);
      if (run) {
        const started = await api.post(`${base(owner.id)}/followups/${saved.id}/run`, {});
        runStatus = started.status ?? 'queued';
        if (runStatus === 'failed' || runStatus === 'no_new_imagery')
          toast(started.message || 'No new eligible pass for these areas', runStatus === 'failed' ? 'danger' : 'info');
        if (started.duplicates) repeatRequest = started;
        if (runStatus === 'queued') {
          const skipped = started.area_runs?.map((row) => row.message).filter((message) => message?.includes('Skipped '));
          if (skipped?.length) toast(skipped.join(' '), 'info', 7000);
        }
      }
      draft = null;
      await Promise.all([refresh(owner.id), refreshRuns(owner.id)]);
      await reloadCase();
      await openDetection(saved.id);
    } else {
      const started = await api.post(`${base(owner.id)}/runs`, input);
      if (!started.id) { error = started.message || 'No area could be checked'; return; }
      if (started.duplicates) { repeatRequest = started; return; }
      draft = null;
      await Promise.all([refresh(owner.id), refreshRuns(owner.id)]);
      await reloadCase();
      await openRun(started.id);
    }
    if (!run || runStatus === 'queued') toast(run ? 'Detection started. Carry on elsewhere; the top bar follows it.' : 'Routine saved', 'ok', 5000);
  }

  async function runDetection(item, pass = {}) {
    const started = await api.post(`${base()}/followups/${item.id}/run`, pass);
    if (started.status === 'failed') { error = started.message || 'No area could be checked'; return; }
    if (started.status === 'no_new_imagery') {
      toast(started.message || 'No new eligible pass for these areas', 'info');
      launch = null; onleavepass();
    } else if (started.duplicates) repeatRequest = started;
    else {
      const count = started.area_runs?.filter((row) => row.status === 'pending').length ?? item.zones.length;
      toast(`${plural(count, 'area')} queued`, 'ok');
      launch = null; onleavepass();
    }
    const skippedCloud = started.area_runs?.map((row) => row.message).filter((message) => message?.includes('Skipped '));
    if (started.status !== 'no_new_imagery' && skippedCloud?.length) toast(skippedCloud.join(' '), 'info', 7000);
    await refreshRuns(caseId);
  }

  async function prepareLaunch(item) {
    const [body, lastPasses] = await Promise.all([
      api.get(`${base()}/followups/${item.id}`), api.get(`${base()}/followups/${item.id}/last-passes`),
    ]);
    launch = { ...body, lastPasses: lastPasses ?? {}, area_dates: (body.area_dates ?? body.zones.map((zone) => ({
      area_id: zone.id, a: body.a, b: body.b, date_rule: body.date_rule,
    }))).map((pair) => ({ ...pair, b: { ...pair.b, date: '' } })) };
  }

  async function repeat() {
    const started = await api.post(`${base()}/runs`, { ...repeatRequest.input, run_anyway: true });
    nextRepeat(); launch = null;
    await refreshRuns(caseId);
    await openRun(started.id);
  }

  async function exportLayer(kind, id) {
    await api.post(`${base()}/${kind}/${id}/export`, {});
    await reloadCase();
    toast('Snapshot saved in SAT layers', 'ok');
  }

  async function changeRoutineColour(group, colour) {
    await api.patch(`${base()}/followups/${group.id}/colour`, { colour });
    await refresh();
    await reloadCase();
  }

  async function changeRunColour(run, colour) {
    await api.patch(`${base()}/runs/${run.id}/colour`, { colour });
    layers = layers.map((layer) => layer.id === run.id
      ? { ...layer, display_colour: colour, displayColour: colour } : layer);
    if (current?.id === run.id) current = { ...current, display_colour: colour };
    await refreshRuns(caseId);
  }

  function nextRepeat() {
    repeatRequest = repeatQueue[0] ?? null;
    repeatQueue = repeatQueue.slice(1);
  }

  /** Every routine not already working, queued one behind the other. */
  async function runAll() {
    const problems = [];
    let started = 0;
    let current = 0;
    for (const item of routines.filter((entry) => !entry.active)) {
      try {
        const response = await api.post(`${base()}/followups/${item.id}/run`, {});
        if (response.status === 'no_new_imagery') current++;
        else if (response.status === 'failed') problems.push(`${item.title}: ${response.message}`);
        else if (response.duplicates) repeatQueue = [...repeatQueue, response];
        else started++;
      } catch (e) {
        problems.push(`${item.title}: ${e.message}`);
      }
    }
    await refreshRuns(caseId);
    if (started) toast(`${plural(started, 'routine')} queued`, 'ok');
    if (current) toast(`${plural(current, 'routine')} already up to date`, 'info');
    if (!repeatRequest && repeatQueue.length) nextRepeat();
    if (problems.length) error = problems.join(' · ');
  }

  async function cancelRun(run) {
    const answer = await api.post(`${base()}/runs/${run.id}/cancel`, {});
    if (current?.id === run.id) acceptRun(answer);
    await refreshRuns(caseId);
  }

  async function removeItem(kind, row) {
    await api.del(`${base()}/${kind}/${row.id}`);
    if (kind === 'runs') {
      layers = layers.filter((r) => r.id !== row.id);
      if (current?.id === row.id) current = null;
    }
    if (kind === 'followups' && detectionId === row.id) goHome();
    await Promise.all([refresh(), refreshRuns(caseId)]);
    await reloadCase();
    toast('Moved to Trash', 'ok');
  }

  /** A verdict changes what a routine is holding, so its page hears about it. */
  async function afterVerdict(run) {
    acceptRun(run);
    if (!detectionId) return;
    findings = await api.get(`${base()}/followups/${detectionId}/findings`);
  }

  export async function addManual(geometry) {
    if (!manual || !current) return;
    await addCandidate(manual.areaId, geometry);
  }

  /** Record a candidate the detector missed, on one of the open run's areas. */
  export async function addCandidate(areaId, geometry) {
    if (!current) return;
    collapsed = false;
    await act(async () => {
      const row = await api.post(`${base()}/runs/${current.id}/results`, { area_id: areaId, geometry });
      acceptRun({ ...current, results: [...current.results, row], count: current.count + 1 });
      candidateId = row.id; manual = null;
      await refreshRuns(caseId);
    });
  }

  /**
   * The area of the open run a point falls in, if the run read it: where a
   * right-click can add a candidate. Null when no finished run is under review.
   */
  export function candidateAreaAt({ lat, lon }) {
    if (view !== 'review' || current?.status !== 'ready') return null;
    const read = (zone) => !current.area_runs
      || current.area_runs.some((pair) => pair.area_id === zone.id && pair.status === 'ready');
    const inside = (zone) => containsPoint(zoneRing(zone).map(([x, y]) => ({ lat: y, lon: x })), { lat, lon });
    return current.input.zones.find((zone) => read(zone) && inside(zone))?.id ?? null;
  }

  /** A candidate picked on the map opens its review. */
  export function pick(runId, resultId) {
    collapsed = false;
    void act(() => openRun(runId, resultId));
  }

  /** Shared areas have their own page, independent of the routines using them. */
  export function openArea(id) {
    selectedArea = id;
    openTab('areas');
  }

  function openTab(next) {
    collapsed = false; tab = next; goHome();
  }
</script>

<aside class="cmp-dock" class:collapsed class:resizing class:compact={dockWidth <= 340} aria-label="Detect"
  style:flex-basis={collapsed ? undefined : `${dockWidth}px`}>
  {#if !collapsed}
    <button type="button" class="dock-resizer" aria-label="Resize Detect panel"
      title="Drag to resize; double-click to reset"
      onpointerdown={startResize} onkeydown={resizeKey}
      ondblclick={() => { onwidth(380); onwidthend(); }}></button>
  {/if}
  <div class="dock-chrome" class:rail={collapsed}>
    <header class="dock-heading">
      {#if !collapsed}<strong>Detect</strong>{/if}
      <button class="cmp-icon" aria-label={collapsed ? 'Expand Detect panel' : 'Collapse Detect panel'}
        title="Toggle Detect panel (])" onclick={() => (collapsed = !collapsed)}>
        <Icon name={collapsed ? 'chevronLeft' : 'chevronRight'} size={16} />
      </button>
      {#if !collapsed}
        <button class="cmp-icon" aria-label="Analyzers" title="Edit analyzers"
          onclick={openLibrary}><Icon name="sliders" size={15} /></button>
        <button class="cmp-icon" class:on={fullscreen} aria-pressed={fullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          onclick={onfullscreen}><Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} /></button>
      {/if}
    </header>
    <nav class="dock-tabs" class:rail={collapsed} aria-label="Detect sections">
      {#each [['routines', 'Routines', 'clock'], ['saved', 'Saved', 'bookmark'], ['areas', 'Areas', 'polygon']] as [id, label, icon]}
        <button class="section-tab" class:on={tab === id && view === 'home'} aria-label={label} aria-pressed={tab === id && view === 'home'}
          title={label} onclick={() => openTab(id)}><Icon name={icon} size={15} />{#if !collapsed}{label}{/if}</button>
      {/each}
    </nav>
    {#if collapsed}
      <div class="rail-tools">
        <button class="cmp-icon" aria-label="Analyzers" title="Edit analyzers"
          onclick={openLibrary}><Icon name="sliders" size={15} /></button>
        <button class="cmp-icon" class:on={fullscreen} aria-pressed={fullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          onclick={onfullscreen}><Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} /></button>
      </div>
    {/if}
  </div>
  <div class="dock-content" hidden={collapsed}>
  <div class="new-action" class:quiet={view !== 'home' || !!launch} bind:this={newActionEl}>
    <button class="btn btn-primary create-trigger" aria-expanded={picking}
      onclick={() => (picking = !picking)}>
      <Icon name="plus" size={15} /> <span>New detection</span>
      <Icon name={picking ? 'chevronUp' : 'chevronDown'} size={14} />
    </button>
    {#if picking}
      <!-- The kind is the first question because it changes every one after
           it, so each says in a line what it commits you to. -->
      <div class="new-menu cmp-glass" role="group" aria-label="New detection">
        <button class="kind" aria-label="New one pass" onclick={() => newDetection('once')}>
          <span class="kind-copy"><strong>One pass</strong><small>Choose dates for one sweep.</small></span>
        </button>
        <button class="kind" aria-label="New routine" onclick={() => newDetection('routine')}>
          <span class="kind-copy"><strong>Routine</strong><small>Watch the same areas over time.</small></span>
        </button>
      </div>
    {/if}
  </div>
  {#if launch || view !== 'home'}
    <header>
      <button class="cmp-icon" aria-label="Back" title="Back" onclick={back}>
        <Icon name="chevronLeft" size={15} />
      </button>
      <strong>{launch ? `Run ${launch.title}` : view === 'new' ? kindTitle : view === 'detection' ? 'Routine' : TITLES[view]}</strong>
    </header>
  {/if}


  {#if launch}
    <div class="cmp-dock-body launch-body">
      <AreaDates zones={launch.zones} bind:pairs={launch.area_dates} single={!!capabilityOf(launch.recipe).single}
        routine previous={launch.date_rule === 'latest_previous'} lastPasses={launch.lastPasses}
        sensor={capabilityOf(launch.recipe).sensor} {onshow} />
      {#if error}<p class="warn" role="alert">{error}</p>{/if}
      <button class="btn btn-primary" disabled={busy || launchOrderInvalid(launch)}
        onclick={() => act(() => runDetection(launch, { area_dates: clone(launch.area_dates) }))}>
        Check for new passes
      </button>
    </div>
  {:else if !catalogue}
    <div class="cmp-dock-body">
      {#if error}<p class="warn" role="alert">{error}</p>{/if}
      <p class="hint">Reading the local analyzer library…</p>
    </div>
  {:else}
    {#if draft}
      <!-- Kept while the library is open over it, so a detection half made
           survives a detour to make the analyzer it needs. -->
      <div class="pane" hidden={view !== 'new'}>
        {#key draft}
          <DetectWizard {caseId} {catalogue} areaGroups={lists.zones} areas={lists.areas} seed={draft} {offer} {busy} failure={error}
            onopenareas={() => openTab('areas')}
            bind:zones bind:drawing bind:selectedZone bind:showZones
            {onfocus} {onusecurrentview} {onshow} onlibrary={openLibrary}
            onareas={(id) => refresh(id)} onsubmit={(request) => act(() => submit(request))} />
        {/key}
      </div>
    {/if}

    {#if view === 'home'}
      <div class="cmp-dock-body">
        {#if error}<p class="warn" role="alert">{error}</p>{/if}
        {#if tab === 'areas'}
          <AreasPanel {caseId} areas={lists.areas} groups={lists.zones} {selectedArea} routines={lists.followups} bind:hidden={hiddenAreas} bind:zones bind:drawing bind:selectedZone
            onrefresh={() => refresh()} {onusecurrentview} {onframe} />
        {:else}
        <DetectHome {tab} {routines} passes={runs} methods={catalogue.methods} {busy} bind:layers
          onnew={newDetection}
          onrun={(item) => act(() => prepareLaunch(item))} onrunall={() => act(runAll)}
          oncancel={(run) => act(() => cancelRun(run))}
          onopen={(item) => act(() => openDetection(item.id))}
          onopenrun={(run) => act(() => openRun(run.id))}
          oncolour={(group, colour) => act(() => changeRoutineColour(group, colour))}
          onruncolour={(run, colour) => act(() => changeRunColour(run, colour))}
          ondelete={(kind, row) => act(() => removeItem(kind, row))}
          {onframe} onexport={(kind, id) => act(() => exportLayer(kind, id))}
          onhover={(id) => {
            const hovered = lists.followups.find((row) => row.id === id);
            highlight = hovered ? (hovered.zones ?? []).map((zone) => zone.id) : [];
          }} />
        {/if}
      </div>
    {:else if view === 'detection'}
      <div class="cmp-dock-body-host">
        {#if error}<p class="warn dock-error" role="alert">{error}</p>{/if}
        {#if detection}
          <DetectDetection {detection} {detail} {findings} methods={catalogue.methods} {busy}
            onrun={() => act(() => prepareLaunch(detection))}
            onexport={() => act(() => exportLayer('followups', detection.id))}
            oncancel={(run) => act(() => cancelRun(run))}
            onedit={() => act(() => editDetection(detection.id))}
            ondelete={() => act(() => removeItem('followups', detection))}
            onopenrun={(run) => act(() => openRun(run.id))}
            onopenfinding={(row) => act(async () => {
              onfocus(row.coordinates);
              await openRun(row.run_id, row.id);
            })} />
        {:else}
          <div class="cmp-dock-body"><p class="hint">This routine is gone.</p></div>
        {/if}
      </div>
    {:else if view === 'review'}
      <div class="cmp-dock-body-host">
        {#if error}<p class="warn" role="alert">{error}</p>{/if}
        {#if current}
          <DetectReview {caseId} run={current} methods={catalogue.methods} active={!collapsed} bind:candidateId
            bind:bare bind:blinking {onpair}
            onaccept={afterVerdict} {onfocus} {onshow} onedit={editRun}
            onadd={(areaId, kind) => {
              manual = { areaId, kind };
              const pair = current.area_runs?.find((pair) => pair.area_id === areaId);
              if (pair) onshow(pair.b);
              onframe(current.input.zones.filter((zone) => zone.id === areaId));
            }}
            onexport={() => act(() => exportLayer('runs', current.id))} />
        {:else}
          <p class="hint">Open a run from the list.</p>
        {/if}
      </div>
    {:else if view === 'library'}
      <AnalyzerLibrary bind:this={library} {catalogue} onchanged={loadCatalogue} bind:builder {viewBounds}
        layers={passLayers} {onfly}
        onsaved={(recipe) => { if (draft) offer = recipe.id; }} />
    {/if}
  {/if}
  </div>
</aside>

{#if repeatRequest}
  <Modal title="Already run between these dates" width="560px" onclose={nextRepeat}>
    {#each repeatRequest.duplicates as match (`${match.run_id}-${match.area_id}`)}
      <p>{match.area_name} · {match.a.date} → {match.b.date} · see run {match.title}</p>
      <button class="btn btn-sm" onclick={() => { nextRepeat(); launch = null; void act(() => openRun(match.run_id)); }}>Open</button>
    {/each}
    <button class="btn btn-primary" disabled={busy} onclick={() => act(repeat)}>Run anyway</button>
  </Modal>
{/if}

<style>
  .cmp-dock { position: relative; min-width: 300px; max-width: 720px; }
  .cmp-dock.collapsed { flex: 0 0 42px; width: 42px; min-width: 42px; }
  .dock-resizer { position: absolute; z-index: 10; top: 0; bottom: 0; left: -4px; width: 8px;
    padding: 0; border: 0; background: transparent; cursor: col-resize; touch-action: none; }
  .dock-resizer:hover, .dock-resizer:focus-visible, .resizing .dock-resizer {
    background: var(--accent-soft); outline: 1px solid var(--accent); }
  .dock-content { display: flex; flex: 1; flex-direction: column; min-height: 0; }
  .dock-content[hidden] { display: none; }
  .dock-content > header { display: flex; align-items: center; gap: 7px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .dock-content > header strong { flex: 1; font-size: var(--fs-sm); }
  .dock-chrome { flex: 0 0 auto; border-bottom: 1px solid var(--border); }
  .dock-heading { display: flex; align-items: center; gap: 3px; min-height: 42px; padding: 5px 8px 3px 13px; }
  .dock-heading strong { flex: 1; min-width: 0; font-size: var(--fs-md); font-weight: 650; }
  .dock-tabs { display: flex; align-items: center; gap: 0; padding: 0 8px; }
  .section-tab { display: flex; flex: 1; align-items: center; justify-content: center; gap: 6px;
    min-width: 0; min-height: 38px; padding: 6px 4px 8px; border-bottom: 2px solid transparent;
    font-size: var(--fs-xs); font-weight: 600; color: var(--text-2); }
  .compact .section-tab { gap: 0; font-size: 0; }
  .section-tab:hover { color: var(--text-1); background: var(--bg-2); }
  .section-tab.on { color: var(--text-1); border-bottom-color: var(--accent); }
  .dock-chrome.rail { display: flex; flex: 1; flex-direction: column; width: 42px; }
  .rail .dock-heading { justify-content: center; min-height: 40px; padding: 5px; }
  .rail .dock-tabs { flex-direction: column; gap: 2px; padding: 0 5px; }
  .rail .section-tab { flex: 0 0 32px; width: 32px; min-height: 32px; padding: 5px;
    border-bottom: 0; border-left: 2px solid transparent; }
  .rail .section-tab.on { border-left-color: var(--accent); }
  .rail-tools { display: grid; gap: 2px; margin-top: auto; padding: 7px 5px; border-top: 1px solid var(--border); }
  .new-action { position: relative; padding: 11px 12px; border-bottom: 1px solid var(--border); }
  .new-action > button { width: 100%; }
  .create-trigger { display: flex; align-items: center; justify-content: flex-start; gap: 7px; min-height: 36px; padding: 7px 11px; font-weight: 650; }
  .create-trigger span { flex: 1; text-align: left; }
  .quiet .create-trigger { border: 1px solid var(--border); color: var(--text-1); background: var(--bg-2); }
  .quiet .create-trigger:hover { background: var(--bg-3); }
  .new-menu { position: absolute; top: calc(100% + 2px); left: 12px; right: 12px; z-index: 700;
    display: grid; padding: 5px 9px; border: 1px solid var(--border-strong);
    border-radius: var(--r-sm); background: var(--bg-1); box-shadow: var(--shadow-2); }
  .kind { min-width: 0; padding: 10px 7px; text-align: left; }
  .kind + .kind { border-top: 1px solid var(--border); }
  .kind:hover, .kind:focus-visible { background: var(--bg-2); }
  .kind:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .kind-copy { display: grid; gap: 2px; min-width: 0; }
  .kind strong { color: var(--text-1); font-size: var(--fs-sm); }
  .kind small { color: var(--text-2); font-size: var(--fs-xs); line-height: 1.4; }
  .pane { display: contents; }
  .pane[hidden] { display: none; }
  .cmp-dock-body-host { display: contents; }
  .dock-error { padding: 10px 12px 0; }
</style>
