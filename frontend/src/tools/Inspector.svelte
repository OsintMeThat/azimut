<script>
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { fetchAllEntities, lookupEntity } from '../lib/catalog.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    adjustDefaults, buildFrameOps, previewStyle, uid, videoSeed, initialQuad, VIDEO_ADJUST_IDS,
    collageBounds, quadFromCropRect, cropImgStyle, cropAspect, styleText, hasVideoEdits,
    normalizeRightAngleRotation, rotationOps, sourceStem, frameSaveNames, autoSaveNames, saveNameOf,
  } from '../lib/inspect.js';
  import {
    isDefaultName, nextName, savedSlugs, savedTitles, savedTitle, slugify, specAttr, specPath,
  } from '../lib/naming.js';
  import { createHistory } from '../lib/history.js';
  import { deletedToast } from '../lib/trash.js';
  import { IDENTITY, matrixCss, rotateAbout, isIdentity, matrixAngleDeg, pointerAngleDeg } from '../lib/frameRotate.js';
  import Icon from '../components/Icon.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import CropBox from './inspect/CropBox.svelte';
  import SelectionMenu from './inspect/SelectionMenu.svelte';
  import FrameMenu from './inspect/FrameMenu.svelte';
  import CollageCanvas from './inspect/CollageCanvas.svelte';
  import CollageMenu from './inspect/CollageMenu.svelte';
  import SaveGallery from './inspect/SaveGallery.svelte';
  import SaveMenu from './inspect/SaveMenu.svelte';
  import PieceCropModal from './inspect/PieceCropModal.svelte';
  import VideoPlayer from './inspect/VideoPlayer.svelte';

  // Inspect keeps edits in session state until the Save tab renders them at full
  // resolution and commits selected outputs to the case.
  const TAB_META = {
    selection: { label: 'Selection', icon: 'video' },
    frame: { label: 'Frame', icon: 'image' },
    collage: { label: 'Collage', icon: 'layers' },
    save: { label: 'Save', icon: 'save' },
  };
  const SOURCE_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Images' },
    { id: 'video', label: 'Video' },
    { id: 'capture', label: 'Captures' },
    { id: 'frame', label: 'Frames' },
    { id: 'collage', label: 'Collages' },
  ];

  let mediaList = $state([]);
  let sourceQuery = $state('');
  let sourceFilter = $state('all');
  let sourceModalOpen = $state(false);
  let sourceBrowserOpen = $state(false);
  let sourceBrowsePath = $state('');
  let sourceBrowseSelection = $state(null);
  let openSourceAfterDiscard = $state(false);
  const inspectableMedia = $derived(mediaList.filter((m) => m.kind === 'image' || m.kind === 'video'));
  const filteredSourceMedia = $derived(
    sourceFilter === 'all' ? inspectableMedia : inspectableMedia.filter((m) => sourceCategory(m) === sourceFilter)
  );
  const pickableMedia = $derived(
    sourceQuery.trim() ? filteredSourceMedia.filter((m) => matchesSourceName(m, sourceQuery)) : filteredSourceMedia
  );
  const sourceBrowserEntries = $derived(
    filteredSourceMedia.map((m) => ({ ...m, id: m.path, attrs: { folder: m.folder ?? '' } }))
  );
  let loadedFor = $state(null);
  let filters = $state([]);
  let analyses = $state([]);
  let probeInfo = $state(null);

  let activeTab = $state('selection');
  let collageSelectedIds = $state([]);
  let cropPieceNode = $state(null);
  // Backend-composited Save thumbnails keyed by collage id: { sig, url }.
  let collagePreviews = $state({});
  let saving = $state(false);
  // Keep names outside the derived `savables` list so slider changes preserve input.
  const saveUi = $state({ selected: {}, folder: '', names: {}, touched: {}, baseName: '', note: '' });
  // The header name controls the session filename; `openedSession` stores its slug.
  let sessionName = $state('');
  let openedSession = $state(null);
  const sessionModal = $state({ open: false, list: [], busy: false });
  let sessionQuery = $state('');
  let sessionBrowserOpen = $state(false);
  let sessionBrowsePath = $state('');
  let sessionBrowseSelection = $state(null);
  const visibleSessions = $derived(
    sessionQuery.trim() ? sessionModal.list.filter((s) => matchesSessionQuery(s, sessionQuery)) : sessionModal.list
  );
  const sessionBrowserEntries = $derived(
    sessionModal.list.map((s) => ({ ...s, id: s.name, attrs: { folder: s.folder ?? '' } }))
  );
  let discardConfirm = $state(false);
  // Loading can be slow because each frame and collage node is rendered in sequence.
  let sessionLoading = $state(false);

  // A session can hold several collages and edits one at a time.
  function makeCollage(name) {
    return { id: uid('cl'), name, width: 1600, height: 800, background: '#12141c', transparent: true, nodes: [] };
  }

  // the live session (reset on source / case change)
  const _firstCollage = makeCollage('Collage 1');
  // Bumped every time the session is cleared, so work started against the old
  // one can tell it is stale (`resetSession`, `capture`).
  let sessionRun = 0;
  const session = $state({
    source: null,
    videoAdjust: {},
    videoRotation: 0,
    frames: [],
    activeFrameId: null,
    collages: [_firstCollage],
    activeCollageId: _firstCollage.id,
    saved: {},
  });

  const activeCollage = $derived(
    session.collages.find((c) => c.id === session.activeCollageId) ?? session.collages[0] ?? null
  );

  // ---- collage undo / redo --------------------------------------------------
  // Snapshot history over the collages (quads, pieces, crops). A drag mutates
  // node.quad continuously; the debounced capture collapses it into one entry.
  const collageHistory = createHistory();
  let collageCanUndo = $state(false);
  let collageCanRedo = $state(false);
  let collageHistBusy = false; // plain (untracked): suppresses capture while restoring
  let collageHistTimer = null;

  const collageSnapshot = () => JSON.stringify(session.collages);

  function syncCollageHist() {
    collageCanUndo = collageHistory.canUndo;
    collageCanRedo = collageHistory.canRedo;
  }

  function anchorCollageHistory() {
    clearTimeout(collageHistTimer);
    collageHistory.reset(collageSnapshot());
    syncCollageHist();
  }

  $effect(() => {
    const json = collageSnapshot(); // reads every collage field → tracked
    if (collageHistBusy) return;
    clearTimeout(collageHistTimer);
    collageHistTimer = setTimeout(() => {
      collageHistory.push(json);
      syncCollageHist();
    }, 350);
  });

  function applyCollageSnapshot(json) {
    collageHistBusy = true;
    session.collages = JSON.parse(json);
    if (!session.collages.some((c) => c.id === session.activeCollageId)) {
      session.activeCollageId = session.collages[0]?.id ?? null;
    }
    collageSelectedIds = [];
    // outlast the capture debounce so the restore itself is not re-recorded
    setTimeout(() => (collageHistBusy = false), 400);
  }

  function undoCollage() {
    const json = collageHistory.undo();
    if (json != null) applyCollageSnapshot(json);
    syncCollageHist();
  }

  function redoCollage() {
    const json = collageHistory.redo();
    if (json != null) applyCollageSnapshot(json);
    syncCollageHist();
  }

  // ---- keyboard: collage undo + frame-accurate video stepping ----------------
  const frameDur = $derived(probeInfo?.fps ? 1 / probeInfo.fps : 1 / 30);

  function stepVideo(delta) {
    const duration = probeInfo?.duration ?? Infinity;
    shared.seekTo = Math.min(Math.max((shared.currentTime ?? 0) + delta, 0), duration);
  }

  function toggleVideoPlayback() {
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play().catch(() => {});
    else videoEl.pause();
  }

  function onWindowKeydown(e) {
    if (uiState.tool !== 'inspect') return;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (e.ctrlKey || e.metaKey) {
      if (activeTab !== 'collage') return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redoCollage() : undoCollage(); }
      else if (k === 'y') { e.preventDefault(); redoCollage(); }
      return;
    }
    // Frame tab: Enter applies the crop (→ committed preview), Esc leaves editing.
    if (activeTab === 'frame' && cropEditing) {
      if (e.key === 'Enter') { e.preventDefault(); commitCrop(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelCrop(); }
      return;
    }
    // Selection tab: ←/→ step one frame (Shift = 1s), ,/. mpv-style aliases
    if (activeTab !== 'selection' || session.source?.kind !== 'video') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepVideo(e.shiftKey ? -1 : -frameDur); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepVideo(e.shiftKey ? 1 : frameDur); }
    else if (e.key === ',') { e.preventDefault(); stepVideo(-frameDur); }
    else if (e.key === '.') { e.preventDefault(); stepVideo(frameDur); }
    else if (e.key === ' ') { e.preventDefault(); toggleVideoPlayback(); }
  }

  // keep-alive: tools stay mounted when another tab is shown — silence the video
  $effect(() => {
    if (uiState.tool !== 'inspect') videoEl?.pause();
  });

  // viewer bridge (video seek + crop overlay), mirrors the old shared object
  const shared = $state({ currentTime: 0, seekTo: null, cropMode: false });
  let videoEl = $state();
  // Frame-tab viewer: wheel-zoom toward the pointer, left-drag pans, middle-drag
  // turns the view (Google-Earth style, around the grabbed point). Zoom/pan/
  // rotate are *view only* — never saved — so turning just helps read the frame.
  // The rotation is an affine matrix in the stage's own space (see frameRotate.js);
  // `frameAspect` is the crop aspect lock, shared with the right-panel controls.
  let frameZoom = $state(1);
  let framePan = $state({ x: 0, y: 0 });
  let frameRotMatrix = $state(IDENTITY); // accumulated view rotation (stage-local)
  let rotating = $state(false); // a middle-drag turn is in progress
  let rotatePivot = $state({ x: 0, y: 0 }); // target indicator, viewport-local px
  let frameStageEl = $state(); // rotated stage (image + crop overlay)
  let frameZoomEl = $state(); // zoom/pan layer — reference box for screen→local
  let frameViewportEl = $state(); // outer viewport — reference box for the indicator
  let frameAspect = $state(null);
  // Crop has two modes: *editing* (original image + draggable box) and, once
  // applied (Enter / Apply), a committed *preview* showing the cropped result.
  // Re-opening crop (button or double-click) goes back to editing the original.
  let cropEditing = $state(false);
  let cropBefore = null; // the crop editing opened on — what Escape puts back
  let frameOrientationBusy = $state(false);

  const videoFilters = $derived(filters.filter((f) => VIDEO_ADJUST_IDS.includes(f.id)));
  const tabs = $derived(
    session.source?.kind === 'video' ? ['selection', 'frame', 'collage', 'save'] : ['frame', 'save']
  );
  const activeFrame = $derived(session.frames.find((f) => f.id === session.activeFrameId) ?? null);
  const framePreview = $derived(activeFrame ? previewStyle(filters, activeFrame.adjust) : { filter: '', transform: '' });
  const videoPreview = $derived(previewStyle(videoFilters, session.videoAdjust));
  const videoRotation = $derived(normalizeRightAngleRotation(session.videoRotation));
  const videoQuarterTurn = $derived(Math.abs(videoRotation) === 90);
  const videoPreviewTransform = $derived(
    [videoPreview.transform, videoRotation ? `rotate(${videoRotation}deg)` : ''].filter(Boolean).join(' ')
  );

  // A frame carries the path it was cut from and nothing else, so the title has
  // to be looked back up: without this, every frame of a downloaded video is named
  // after the download's filename instead of what the analyst called it.
  const titleByPath = $derived(new Map(mediaList.map((m) => [m.path, m.title])));
  const stemFor = (path, item = null) =>
    sourceStem({ ...item, path, title: titleByPath.get(path) ?? item?.title });

  const savables = $derived.by(() => {
    const out = [];
    const cid = caseState.current?.id;
    const stem = stemFor(session.source?.path, session.source);
    if (session.source?.kind === 'video' && hasVideoEdits(videoFilters, session.videoAdjust, videoRotation)) {
      const t = session.source.thumbnail ? fileUrl(cid, session.source.thumbnail) : null;
      out.push({
        key: 'video', kind: 'video', defaultName: `${stem} (enhanced)`, thumb: t,
        filter: videoPreview.filter, transform: videoPreviewTransform,
        saved: !!session.saved.video,
      });
    }
    // Named as a set, not one by one: a frame only needs sub-second digits when
    // another frame in the tray lands in the same second.
    const frameNames = frameSaveNames(
      session.frames.map((fr) => ({ stem: stemFor(fr.path), time: fr.time })),
    );
    for (const [i, fr] of session.frames.entries()) {
      out.push({
        key: `frame:${fr.id}`, kind: 'frame', frame: fr, thumb: fr.url,
        defaultName: frameNames[i],
        filter: previewStyle(filters, fr.adjust).filter,
        saved: !!session.saved[`frame:${fr.id}`],
      });
    }
    let colN = 0;
    for (const cl of session.collages) {
      colN += 1;
      if (!cl.nodes.length) continue;
      out.push({
        key: `collage:${cl.id}`, kind: 'collage', defaultName: cl.name || `Collage ${colN}`,
        thumb: null, collage: cl, preview: collagePreviews[cl.id]?.url ?? null,
        saved: !!session.saved[`collage:${cl.id}`],
      });
    }
    return out;
  });

  // Every field carries real, editable text — never a placeholder to guess at.
  // Fields the user has not touched follow the base name; the ones they typed in
  // are theirs and stay put.
  //
  // A collage keeps its name in the session (session.collages[].name), not in
  // saveUi — that is the one name the Collage tab and the Save tab share, so a
  // rename in either place shows up in the other.
  const saveName = (it) => (it.kind === 'collage' ? (it.collage.name ?? '') : (saveUi.names[it.key] ?? ''));
  function setSaveName(it, value) {
    if (it.kind === 'collage') it.collage.name = value;
    else saveUi.names[it.key] = value;
    saveUi.touched[it.key] = true;
    saveUi.selected[it.key] = true;
  }

  $effect(() => {
    const auto = autoSaveNames(savables, saveUi.baseName);
    savables.forEach((it, i) => {
      if (saveUi.touched[it.key]) return;
      if (it.kind === 'collage') it.collage.name = auto[i];
      else saveUi.names[it.key] = auto[i];
    });
  });

  // -- lifecycle ------------------------------------------------------------
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // refetch when media changes elsewhere (e.g. Media Library upload/delete)
    if (id !== loadedFor) {
      loadedFor = id;
      mediaList = [];
      resetSession();
      if (id) refresh(id);
    } else if (id) {
      refresh(id);
    }
  });

  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.inspectPath && mediaList.length) {
      const target = mediaList.find((m) => m.path === uiState.inspectPath);
      uiState.inspectPath = null;
      if (target) select(target);
    }
  });

  // reopen a saved session from the sidebar (like proofs/posts)
  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.openInspect && mediaList.length) {
      const name = uiState.openInspect;
      uiState.openInspect = null;
      openSession(name);
    }
  });

  $effect(() => {
    if (shared.seekTo != null && videoEl) {
      videoEl.currentTime = shared.seekTo;
      shared.seekTo = null;
    }
  });

  async function ensureOps() {
    if (filters.length) return;
    const ops = await api.get('/api/inspect/ops');
    // `crop` is driven by the interactive box; `rotate` is a view-only tilt in
    // the Frame tab (never baked); `remap` is solved by auto-stitch — none of the
    // three belongs in the slider pipeline.
    const solved = ['crop', 'rotate', 'remap'];
    filters = ops.filters.filter((f) => !solved.includes(f.id));
    analyses = ops.analyses;
  }

  async function refresh(id = caseState.current?.id) {
    if (!id) return;
    mediaList = await api.get(`/api/cases/${id}/media`);
  }

  // A delete anywhere else in the app lands here: this workspace may be sitting
  // on a subject, or on a saved session, that no longer exists.
  //
  // The saved session is the dangerous half — a session cannot outlive its
  // subject, so deleting the subject deletes the session (ONTOLOGY §3). Left
  // bound, the next Save would silently write the deleted session back. Drop the
  // binding instead: Save then files a new one, deliberately.
  let sourceGone = $state(false);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-check after a delete elsewhere
    const sessionName = openedSession?.name;
    const path = session.source?.path;
    if (!id) {
      sourceGone = false;
      return;
    }
    let live = true;
    (async () => {
      if (sessionName) {
        const bound = await lookupEntity(id, specAttr('session'), specPath('session', sessionName));
        if (live && !bound && openedSession?.name === sessionName) {
          openedSession = null;
          toast('The saved session was deleted. Saving now creates a new one', 'warn');
        }
      }
      if (path) {
        const ent = await lookupEntity(id, 'path', path);
        if (live) sourceGone = !ent;
      } else if (live) {
        sourceGone = false;
      }
    })();
    return () => {
      live = false;
    };
  });

  // Every saved session in this case, read off the filed entities: the slugs to
  // catch a name already taken, the names so a fresh session reads apart.
  let sessionEntities = $state([]);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // refresh after a save or a delete anywhere else
    if (!id) {
      sessionEntities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id, { types: ['inspect-session'] })
      .then((list) => {
        if (!live) return;
        sessionEntities = list;
        // The name was assigned before the case's sessions were known. Renumber
        // it now rather than letting a fresh workspace collide on its first save.
        if (!openedSession && isDefaultName(sessionName, 'session')) {
          sessionName = nextName('session', savedTitles(sessionEntities, 'session'));
        }
      })
      .catch(() => { if (live) sessionEntities = []; });
    return () => { live = false; };
  });

  const takenSlugs = () => savedSlugs(sessionEntities, 'session');

  function openSourceDialog() {
    sourceQuery = '';
    sourceFilter = 'all';
    sourceBrowserOpen = false;
    sourceBrowsePath = '';
    sourceBrowseSelection = null;
    sourceModalOpen = true;
  }

  function matchesSourceName(item, query) {
    return matchesTerms(item.title || item.filename || '', query);
  }

  function sourceCategory(item) {
    const source = item.source ?? {};
    if (source.type === 'satellite' || source.type === 'screenshot') return 'capture';
    if (source.op === 'collage') return 'collage';
    if (source.op === 'frame' || source.op === 'adjust') return 'frame';
    return item.kind;
  }

  function matchesSessionQuery(session, query) {
    return matchesTerms([session.title, session.name, session.source].filter(Boolean).join('\n'), query);
  }

  function openSourceBrowser() {
    sourceQuery = '';
    sourceBrowsePath = '';
    sourceBrowseSelection = null;
    sourceBrowserOpen = true;
  }

  function toggleSourceBrowser() {
    if (sourceBrowserOpen) {
      sourceBrowserOpen = false;
      return;
    }
    openSourceBrowser();
  }

  function setSourceFilter(filter) {
    sourceFilter = filter;
    sourceBrowsePath = '';
    sourceBrowseSelection = null;
  }

  function openSourceFolder(path) {
    sourceBrowsePath = path;
    sourceBrowseSelection = null;
  }

  function confirmSourceBrowser() {
    const item = sourceBrowserEntries.find((m) => m.path === sourceBrowseSelection);
    if (item) selectNewSource(item);
  }

  function selectSourceBrowser(item, confirm = false) {
    sourceBrowseSelection = item.path;
    if (confirm) selectNewSource(item);
  }

  function openSessionBrowser() {
    sessionBrowsePath = '';
    sessionBrowseSelection = null;
    sessionBrowserOpen = true;
  }

  function toggleSessionBrowser() {
    if (sessionBrowserOpen) {
      sessionBrowserOpen = false;
      return;
    }
    openSessionBrowser();
  }

  function openSessionFolder(path) {
    sessionBrowsePath = path;
    sessionBrowseSelection = null;
  }

  function confirmSessionBrowser() {
    if (sessionBrowseSelection) openSession(sessionBrowseSelection);
  }

  function selectSessionBrowser(session, confirm = false) {
    sessionBrowseSelection = session.name;
    if (confirm) openSession(session.name);
  }

  function startNewSession() {
    if (session.source) {
      openSourceAfterDiscard = true;
      discardConfirm = true;
      return;
    }
    openSourceDialog();
  }

  function resetSession() {
    // Everything still in flight against the session being cleared belongs to a
    // document that no longer exists. `session` is one object mutated in place,
    // so a pending render has no way to notice on its own (see `capture`).
    sessionRun += 1;
    for (const fr of session.frames) if (fr.url?.startsWith('blob:')) URL.revokeObjectURL(fr.url);
    session.source = null;
    session.videoAdjust = {};
    session.videoRotation = 0;
    session.frames = [];
    session.activeFrameId = null;
    const c0 = makeCollage('Collage 1');
    session.collages = [c0];
    session.activeCollageId = c0.id;
    for (const p of Object.values(collagePreviews)) if (p?.url) URL.revokeObjectURL(p.url);
    collagePreviews = {};
    session.saved = {};
    saveUi.selected = {};
    saveUi.folder = '';
    saveUi.names = {};
    saveUi.touched = {};
    saveUi.baseName = '';
    saveUi.note = '';
    openedSession = null;
    sessionName = nextName('session', savedTitles(sessionEntities, 'session'));
    savedSignature = null;
    collageSelectedIds = [];
    shared.currentTime = 0;
    shared.cropMode = false;
    frameZoom = 1;
    framePan = { x: 0, y: 0 };
    frameRotMatrix = IDENTITY;
    rotating = false;
    frameAspect = null;
    cropEditing = false;
    cropBefore = null;
    anchorCollageHistory();
  }

  async function select(item) {
    await ensureOps();
    resetSession();
    session.source = item;
    try {
      probeInfo = await api.get(
        `/api/cases/${caseState.current.id}/inspect/probe?path=${encodeURIComponent(item.path)}`
      );
    } catch {
      probeInfo = { kind: item.kind };
    }
    if (item.kind === 'video') {
      session.videoAdjust = adjustDefaults(videoFilters);
      activeTab = 'selection';
    } else {
      const frame = makeFrame(item.path, null, fileUrl(caseState.current.id, item.path));
      session.frames.push(frame);
      session.activeFrameId = frame.id;
      activeTab = 'frame';
    }
  }

  async function selectNewSource(item) {
    sourceModalOpen = false;
    await select(item);
  }

  function makeFrame(path, time, url) {
    return {
      id: uid('fr'), path, time, url,
      adjust: adjustDefaults(filters), crop: null, sourceOps: [], rotation: 0,
      w: probeInfo?.width, h: probeInfo?.height,
    };
  }

  // Render a recipe (video frame / image + ops) to a blob URL, no filing.
  async function renderUrl(path, time, ops = []) {
    const res = await fetch(`/api/cases/${caseState.current.id}/inspect/render-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, time: time ?? null, ops }),
    });
    if (!res.ok) {
      let detail = 'render failed';
      try {
        detail = (await res.json()).detail;
      } catch {
        /* non-json */
      }
      throw new Error(detail);
    }
    return URL.createObjectURL(await res.blob());
  }

  function imageSize(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: probeInfo?.width || 320, h: probeInfo?.height || 240 });
      im.src = url;
    });
  }

  // -- true-to-export collage thumbnails (Save tab) -------------------------
  // The Save picker shows the *actual* composited PNG (backend warp), not the
  // CSS approximation. Signature = the pieces' recipes+quads, so we only re-render
  // when a layout really changed.
  const collageSig = (cl) => JSON.stringify(cl.nodes.map((n) => [n.save, n.quad]));

  async function buildCollagePreview(cl, sig, cid) {
    try {
      const b = collageBounds(cl.nodes);
      const nodes = cl.nodes.map((n) => ({
        src: n.save, quad: n.quad.map(([x, y]) => [x - b.minX, y - b.minY]),
      }));
      const res = await fetch(`/api/cases/${cid}/inspect/compose-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: b.width, height: b.height, background: null, nodes }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const prev = collagePreviews[cl.id];
      if (prev?.url) URL.revokeObjectURL(prev.url);
      collagePreviews[cl.id] = { sig, url };
    } catch {
      /* leave the CSS fallback in place */
    }
  }

  $effect(() => {
    if (activeTab !== 'save') return;
    const cid = caseState.current?.id;
    if (!cid) return;
    for (const cl of session.collages) {
      if (!cl.nodes.length) continue;
      const sig = collageSig(cl);
      if (collagePreviews[cl.id]?.sig === sig) continue;
      buildCollagePreview(cl, sig, cid);
    }
  });

  // -- frame capture (Selection) -------------------------------------------
  async function capture(time) {
    // The render and the measurement below are two round trips, and a slow video
    // leaves room to discard the session or pick another source in between. The
    // frame that lands is evidence, so a stale one must be dropped rather than
    // pushed into whatever document is open by then.
    const run = sessionRun;
    try {
      const sourceOps = rotationOps(videoRotation);
      const url = await renderUrl(session.source.path, time, sourceOps);
      const frame = makeFrame(session.source.path, time, url);
      const dim = await imageSize(url);
      if (run !== sessionRun) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      frame.sourceOps = sourceOps;
      frame.w = dim.w;
      frame.h = dim.h;
      // frames captured from a tuned video inherit those gear adjustments
      frame.adjust = videoSeed(filters, session.videoAdjust);
      session.frames.push(frame);
      session.activeFrameId = frame.id;
      toast('Frame added to tray. Not saved yet', 'ok');
    } catch (e) {
      if (run === sessionRun) toast(e.message, 'danger');
    }
  }

  // Collage pieces are snapshots frozen at add-time: the modified image is baked
  // now and later frame edits never change it (deliberate — see SPEC).
  async function addToCollage(frame) {
    const cl = activeCollage;
    if (!cl) return;
    try {
      const ops = buildFrameOps(filters, frame);
      const url = await renderUrl(frame.path, frame.time, ops);
      const dim = await imageSize(url);
      const count = cl.nodes.length;
      const off = 30 + (count % 4) * 40;
      const quad = initialQuad(dim.w, dim.h, cl.width * 0.5, off, off);
      const node = {
        id: uid('nd'), frameId: frame.id, url, baseUrl: url, w: dim.w, h: dim.h,
        frameOps: ops, crop: null,
        save: { path: frame.path, time: frame.time ?? null, ops }, quad,
      };
      cl.nodes.push(node);
      collageSelectedIds = [node.id];
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Re-render a collage piece with (or without) its crop, applied before the
  // warp. Keeps baseUrl (uncropped snapshot) so the crop editor never compounds.
  async function applyNodeCrop(node, crop) {
    try {
      const frameOps = node.frameOps ?? node.save?.ops ?? [];
      const ops = crop ? [...frameOps, { op: 'crop', params: crop }] : [...frameOps];
      const url = await renderUrl(node.save.path, node.save.time, ops);
      const dim = await imageSize(url);
      // Reshape the quad so the cropped image keeps correct proportions and
      // stays in place. Derive the *full-image* quad from the current one (a
      // crop stored on the node is relative to the base image, so re-cropping
      // never compounds), then re-project the new crop rectangle onto it.
      const prev = node.crop;
      const baseQuad = prev
        ? quadFromCropRect(node.quad, { x: -prev.x / prev.w, y: -prev.y / prev.h, w: 1 / prev.w, h: 1 / prev.h })
        : node.quad;
      node.quad = crop ? quadFromCropRect(baseQuad, crop) : baseQuad.map(([x, y]) => [x, y]);
      // the previous blob URL stays alive: an undo may restore a snapshot that
      // still points at it (bounded leak, reclaimed on session reset/reload)
      node.url = url;
      node.w = dim.w;
      node.h = dim.h;
      node.crop = crop;
      node.save = { ...node.save, ops };
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Re-derive a collage piece's pixels for a new op pipeline — auto-stitch's
  // panorama modes bake their warp into the recipe, so the piece the analyst sees
  // is the piece the backend will export. A crop rect is relative to the piece's
  // own snapshot, and that snapshot has just changed underneath it, so the
  // re-derived piece starts crop-free: whatever it was showing is now baked in.
  async function renderPiece(node, ops) {
    const url = await renderUrl(node.save.path, node.save.time, ops);
    const dim = await imageSize(url);
    node.url = url;
    node.baseUrl = url;
    node.w = dim.w;
    node.h = dim.h;
    node.frameOps = ops;
    node.crop = null;
    node.save = { ...node.save, ops };
  }

  // Open the piece crop editor, or clear the crop directly (clear=true).
  function requestCrop(node, clear = false) {
    if (clear) {
      applyNodeCrop(node, null);
    } else {
      cropPieceNode = node;
    }
  }

  function removeFrame(id) {
    const fr = session.frames.find((f) => f.id === id);
    if (fr?.url?.startsWith('blob:')) URL.revokeObjectURL(fr.url);
    session.frames = session.frames.filter((f) => f.id !== id);
    // collage pieces are independent snapshots — they stay.
    delete session.saved[`frame:${id}`];
    if (session.activeFrameId === id) session.activeFrameId = session.frames[0]?.id ?? null;
  }

  async function setFrameRotation(angle) {
    const frame = activeFrame;
    if (!frame || frameOrientationBusy) return;
    const rotation = normalizeRightAngleRotation(angle);
    frameOrientationBusy = true;
    try {
      const url = await renderUrl(frame.path, frame.time, [
        ...(frame.sourceOps ?? []),
        ...rotationOps(rotation),
      ]);
      const dim = await imageSize(url);
      if (!session.frames.includes(frame)) {
        URL.revokeObjectURL(url);
        return;
      }
      const oldUrl = frame.url;
      frame.url = url;
      frame.rotation = rotation;
      frame.w = dim.w;
      frame.h = dim.h;
      if (oldUrl?.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      frameOrientationBusy = false;
    }
  }

  // -- frame viewer: zoom / pan / straighten (Frame tab) -------------------
  // Reset the view whenever the active frame changes.
  $effect(() => {
    session.activeFrameId; // track
    frameZoom = 1;
    framePan = { x: 0, y: 0 };
    frameRotMatrix = IDENTITY;
    frameAspect = null;
    cropEditing = false;
    cropBefore = null;
    shared.cropMode = false;
  });

  // Enter crop editing (original + box); arm a fresh draw if there's no box yet.
  function beginCrop() {
    if (!activeFrame) return;
    cropBefore = activeFrame.crop ? { ...activeFrame.crop } : null;
    cropEditing = true;
    if (!activeFrame.crop) shared.cropMode = true;
  }
  // Apply the crop → drop back to the committed preview of the cropped result.
  function commitCrop() {
    cropEditing = false;
    shared.cropMode = false;
    cropBefore = null;
  }
  // Escape leaves crop editing the way it found it: the box drawn since
  // `beginCrop` is dropped rather than applied. Escape committing was the one
  // key in the tool that made a change the analyst was backing out of.
  function cancelCrop() {
    if (activeFrame) activeFrame.crop = cropBefore;
    cropEditing = false;
    shared.cropMode = false;
    cropBefore = null;
  }

  // Wheel zooms toward the pointer (never below the fitted size); at 1× the pan
  // snaps back to centre so the image can't drift off.
  function frameWheel(e) {
    if (!activeFrame) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const cX = r.width / 2;
    const cY = r.height / 2;
    const old = frameZoom;
    const next = Math.min(Math.max(old * (e.deltaY > 0 ? 0.9 : 1.1), 1), 8);
    if (next === 1) {
      frameZoom = 1;
      framePan = { x: 0, y: 0 };
      return;
    }
    // keep the point under the pointer fixed (transform-origin is the centre)
    const ratio = next / old;
    framePan = {
      x: px - (px - (cX + framePan.x)) * ratio - cX,
      y: py - (py - (cY + framePan.y)) * ratio - cY,
    };
    frameZoom = next;
  }

  function resetFrameView() {
    frameZoom = 1;
    framePan = { x: 0, y: 0 };
    frameRotMatrix = IDENTITY;
  }

  const frameViewDirty = $derived(
    frameZoom !== 1 || framePan.x !== 0 || framePan.y !== 0 || !isIdentity(frameRotMatrix)
  );
  const frameAngle = $derived(Math.round(matrixAngleDeg(frameRotMatrix)));

  // Middle-drag turns the *view* (never saved), Google-Earth style: a stylised
  // target marks the exact point you grabbed and the image spins around it as you
  // move the mouse — the turn follows the angle the cursor sweeps about that
  // pivot. The rotation is kept as a matrix in the stage's own space, so it
  // composes on top of any prior zoom / pan / rotate: every new grab pivots from
  // wherever you click, with no jump, no matter what the view already looks like.
  const ROTATE_DEADZONE = 8; // px to move off the pivot before a spoke is fixed
  function frameRotateStart(e) {
    if (!activeFrame || !frameStageEl || !frameZoomEl || !frameViewportEl) return;
    // The zoom/pan layer carries only translate + scale (no rotation), so its
    // on-screen box gives a clean screen→local map — read it live so the pivot is
    // correct whatever the current zoom/pan is. offsetLeft/Top place the stage's
    // origin (its transform-origin, 0 0) within that layer, unaffected by rotation.
    const layer = frameZoomEl.getBoundingClientRect();
    const vp = frameViewportEl.getBoundingClientRect();
    const px = (e.clientX - layer.left) / frameZoom - frameStageEl.offsetLeft;
    const py = (e.clientY - layer.top) / frameZoom - frameStageEl.offsetTop;
    const base = frameRotMatrix; // freeze the accumulated rotation for this gesture
    const pivotX = e.clientX;
    const pivotY = e.clientY;
    rotatePivot = { x: e.clientX - vp.left, y: e.clientY - vp.top };
    rotating = true;
    let startAngle = null; // the reference spoke, fixed once the cursor leaves the deadzone
    const move = (ev) => {
      if (startAngle === null) {
        if (Math.hypot(ev.clientX - pivotX, ev.clientY - pivotY) < ROTATE_DEADZONE) return;
        startAngle = pointerAngleDeg(pivotX, pivotY, ev.clientX, ev.clientY);
        return;
      }
      const delta = pointerAngleDeg(pivotX, pivotY, ev.clientX, ev.clientY) - startAngle;
      frameRotMatrix = rotateAbout(base, px, py, delta);
    };
    const up = () => {
      rotating = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Kill the browser's middle-click auto-scroll so a turn doesn't also pan-scroll.
  function frameMouseDown(e) {
    if (e.button === 1) e.preventDefault();
  }

  // Left-drag on the image pans the view.
  function framePanStart(e) {
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = framePan.x;
    const oy = framePan.y;
    const move = (ev) => {
      framePan = { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function frameViewportDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      if (!cropEditing) frameRotateStart(e); // keep the crop box un-rotated
      return;
    }
    if (e.button !== 0 || shared.cropMode || cropEditing) return; // crop box owns drags
    e.preventDefault(); // stop the browser's native image-drag ghost
    framePanStart(e);
  }

  // -- save (the only gate that files entities) ----------------------------
  async function saveSelected() {
    const cid = caseState.current.id;
    const folder = saveUi.folder?.trim() || null;
    const chosen = savables.filter((it) => saveUi.selected[it.key]);
    if (!chosen.length) return;
    const note = saveUi.note?.trim() || null;
    const nameOf = (item) => saveNameOf(item, saveName(item));
    // A save can land on media the case already holds (re-saving an unchanged
    // collage is the common one). The name still applies, but the toast has to
    // say no new file appeared, or the count looks wrong in the library.
    let dupes = 0;
    saving = true;
    try {
      const frameItems = chosen
        .filter((it) => it.kind === 'frame')
        .map((it) => ({
          path: it.frame.path,
          time: it.frame.time ?? null,
          ops: buildFrameOps(filters, it.frame),
          label: nameOf(it),
        }));
      if (frameItems.length) {
        const res = await api.post(`/api/cases/${cid}/inspect/save-frames`, {
          items: frameItems, folder, notes: note,
        });
        dupes += (res?.saved ?? []).filter((r) => r.duplicate).length;
        for (const it of chosen) if (it.kind === 'frame') session.saved[it.key] = true;
      }
      const videoItem = chosen.find((it) => it.kind === 'video');
      if (videoItem) {
        const res = await api.post(`/api/cases/${cid}/inspect/enhance-video`, {
          path: session.source.path, params: session.videoAdjust, rotation: videoRotation, folder,
          label: nameOf(videoItem), notes: note,
        });
        if (res?.duplicate) dupes += 1;
        session.saved.video = true;
      }
      for (const it of chosen.filter((c) => c.kind === 'collage')) {
        // A collage is always a transparent PNG of just the pieces, trimmed to
        // their bounds — the export size follows the layout, not a manual value.
        const cl = it.collage;
        const b = collageBounds(cl.nodes);
        const nodes = cl.nodes.map((n) => ({
          src: n.save, // frozen snapshot recipe (path/time/ops)
          quad: n.quad.map(([x, y]) => [x - b.minX, y - b.minY]),
        }));
        const res = await api.post(`/api/cases/${cid}/inspect/compose`, {
          width: b.width,
          height: b.height,
          background: null,
          nodes, folder,
          label: nameOf(it), notes: note,
        });
        if (res?.duplicate) dupes += 1;
        session.saved[it.key] = true;
      }
      await reloadCase();
      await refresh();
      saveUi.selected = {};
      saveUi.names = {};
      saveUi.touched = {};
      const dupeNote = dupes
        ? `. ${dupes} matched existing media and ${dupes === 1 ? 'was' : 'were'} renamed`
        : '';
      toast(`Saved ${chosen.length} item${chosen.length === 1 ? '' : 's'} to the case${dupeNote}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = false;
    }
  }

  // -- saveable sessions (persist the whole workspace, reopen later) --------
  function sessionSpec() {
    return {
      source: { path: session.source.path, kind: session.source.kind },
      videoAdjust: { ...session.videoAdjust },
      videoRotation,
      activeFrameId: session.activeFrameId,
      frames: session.frames.map((f) => ({
        id: f.id, path: f.path, time: f.time, adjust: { ...f.adjust }, crop: f.crop,
        sourceOps: f.sourceOps ?? [], rotation: normalizeRightAngleRotation(f.rotation),
        w: f.w, h: f.h,
      })),
      activeCollageId: session.activeCollageId,
      collages: session.collages.map((cl) => ({
        id: cl.id, name: cl.name, width: cl.width, height: cl.height,
        background: cl.background, transparent: cl.transparent,
        nodes: cl.nodes.map((n) => ({
          id: n.id, frameId: n.frameId, save: n.save, w: n.w, h: n.h, quad: n.quad,
          frameOps: n.frameOps ?? n.save.ops, crop: n.crop ?? null,
        })),
      })),
    };
  }

  // The "unsaved" badge compares what a save would write against what the last
  // one wrote. Deriving it costs one stringify per change, which beats setting a
  // dirty flag at each of the dozens of places that mutate the workspace — and
  // it can't drift out of step with them.
  let savedSignature = $state(null);
  const signature = () => JSON.stringify([sessionName.trim(), sessionSpec()]);
  const sessionDirty = $derived(session.source ? signature() !== savedSignature : false);

  async function openLoadDialog() {
    sessionModal.busy = true;
    sessionQuery = '';
    sessionBrowserOpen = false;
    sessionBrowsePath = '';
    sessionBrowseSelection = null;
    sessionModal.open = true;
    try {
      const sessions = await api.get(`/api/cases/${caseState.current.id}/inspect/sessions`);
      try {
        const entities = await fetchAllEntities(caseState.current.id, { types: ['inspect-session'] });
        const folders = new Map(
          entities.map((entity) => [
            (entity.attrs?.spec ?? '').replace(/^inspect\//, '').replace(/\.json$/, ''),
            entity.attrs?.folder ?? '',
          ])
        );
        sessionModal.list = sessions.map((session) => ({ ...session, folder: folders.get(session.name) ?? '' }));
      } catch {
        sessionModal.list = sessions;
      }
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      sessionModal.busy = false;
    }
  }

  // Saving writes under the name in the header. When that name is free the
  // backend just renames the bound session onto it; when another session holds
  // it, only an unbound workspace may take it, and only after this asks.
  let overwritePrompt = $state(null);
  let savingSession = $state(false);

  async function saveSession() {
    const title = sessionName.trim();
    if (!title || savingSession || !session.source) return;
    const slug = slugify(title, 'session');
    if (!openedSession && takenSlugs().has(slug)) {
      overwritePrompt = { slug };
      return;
    }
    return performSessionSave();
  }

  async function performSessionSave() {
    const title = sessionName.trim();
    savingSession = true;
    try {
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/sessions`, {
        rename_from: openedSession?.name ?? null, title, spec: sessionSpec(),
      });
      sessionName = res.title;
      openedSession = { name: res.name, title: res.title };
      savedSignature = signature();
      await reloadCase();
      toast('Session saved. Reopen it from the sidebar', 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      savingSession = false;
      overwritePrompt = null;
    }
  }

  async function openSession(name) {
    sessionLoading = true;
    sessionModal.open = false;
    try {
      await ensureOps();
      if (!mediaList.length) await refresh();
      let spec;
      try {
        spec = await api.get(`/api/cases/${caseState.current.id}/inspect/sessions/${name}`);
      } catch (e) {
        toast(e.message, 'danger');
        return;
      }
      resetSession();
      const src = mediaList.find((m) => m.path === spec.source.path) ?? spec.source;
      session.source = src;
      try {
        probeInfo = await api.get(
          `/api/cases/${caseState.current.id}/inspect/probe?path=${encodeURIComponent(src.path)}`
        );
      } catch {
        probeInfo = { kind: src.kind };
      }
      session.videoAdjust = spec.videoAdjust ?? adjustDefaults(videoFilters);
      session.videoRotation = normalizeRightAngleRotation(spec.videoRotation);
      for (const f of spec.frames ?? []) {
        try {
          const sourceOps = f.sourceOps ?? [];
          const rotation = normalizeRightAngleRotation(f.rotation);
          const url = await renderUrl(f.path, f.time, [...sourceOps, ...rotationOps(rotation)]);
          session.frames.push({ ...f, sourceOps, rotation, url });
        } catch {
          /* skip a frame whose source is gone */
        }
      }
      session.activeFrameId = spec.activeFrameId ?? session.frames[0]?.id ?? null;
      // Back-compat: older sessions stored a single `collage`; newer ones an array.
      const specCollages = spec.collages ?? (spec.collage ? [spec.collage] : []);
      const collages = [];
      for (const sc of specCollages) {
        const nodes = [];
        for (const n of sc.nodes ?? []) {
          try {
            // frameOps = the snapshot without the collage crop; baseUrl feeds the
            // crop editor, url is the (possibly cropped) piece shown on the canvas.
            const frameOps = n.frameOps ?? n.save.ops ?? [];
            const crop = n.crop ?? null;
            const baseUrl = await renderUrl(n.save.path, n.save.time, frameOps);
            const url = crop ? await renderUrl(n.save.path, n.save.time, n.save.ops) : baseUrl;
            nodes.push({ ...n, frameOps, crop, baseUrl, url });
          } catch {
            /* skip a node whose source is gone */
          }
        }
        collages.push({
          id: sc.id ?? uid('cl'),
          name: sc.name ?? `Collage ${collages.length + 1}`,
          width: sc.width ?? 1600,
          height: sc.height ?? 800,
          background: sc.background ?? '#12141c',
          transparent: sc.transparent ?? false,
          nodes,
        });
      }
      if (!collages.length) collages.push(makeCollage('Collage 1'));
      session.collages = collages;
      session.activeCollageId =
        collages.find((c) => c.id === spec.activeCollageId)?.id ?? collages[0].id;
      openedSession = { name, title: spec.title || name };
      sessionName = openedSession.title;
      savedSignature = signature();
      activeTab = src.kind === 'video' ? 'selection' : 'frame';
      anchorCollageHistory();
    } finally {
      sessionLoading = false;
    }
  }

  function discardSession() {
    resetSession();
    discardConfirm = false;
    if (openSourceAfterDiscard) {
      openSourceAfterDiscard = false;
      openSourceDialog();
    }
  }

  function cancelDiscard() {
    discardConfirm = false;
    openSourceAfterDiscard = false;
  }

  async function deleteSession(name) {
    try {
      const caseId = caseState.current.id;
      const session = sessionModal.list.find((item) => item.name === name);
      const result = await api.del(`/api/cases/${caseId}/inspect/sessions/${name}`);
      sessionModal.list = sessionModal.list.filter((s) => s.name !== name);
      if (openedSession?.name === name) openedSession = null;
      await reloadCase();
      deletedToast(caseId, result, session?.title ?? name);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="tool">
  <div class="tool-header">
    <h2>Inspect</h2>
    {#if session.source}
      <input class="input title-input" bind:value={sessionName} maxlength="200" aria-label="Session name" />
      {#if sessionDirty}<span class="badge">unsaved</span>{/if}
    {/if}
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn btn-sm" onclick={openLoadDialog} title="Reopen a saved session">
        <Icon name="folderOpen" size={14} /> Open session
      </button>
      <button class="btn btn-sm" onclick={startNewSession} title="Start from case media">
        <Icon name="plus" size={14} /> New session
      </button>
      {#if session.source}
        <button class="btn btn-sm" onclick={() => (discardConfirm = true)} title="Clear this workspace">
          <Icon name="reset" size={14} /> Discard
        </button>
      {/if}
      <button
        class="btn btn-ok btn-sm"
        disabled={!session.source || savingSession || !sessionName.trim()}
        onclick={saveSession}
        title="Save this workspace under its name"
      >
        <Icon name="save" size={14} /> {savingSession ? 'Saving…' : 'Save session'}
      </button>
    {/if}
  </div>

  {#if !caseState.current}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Open a case and add media to start inspecting.</p>
      <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
    </div>
  {:else if sessionLoading}
    <div class="empty">
      <span class="spinner"></span>
      <p>Loading session…</p>
    </div>
  {:else if !session.source}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <h3>Start a session</h3>
      <p>Start a session to choose media.</p>
      <button class="btn" onclick={startNewSession}>
        <Icon name="plus" size={15} /> New session
      </button>
    </div>
  {:else}
    {#if sourceGone}
      <!-- The subject was deleted out from under this workspace. Everything
           already captured stays on screen and can still be saved; only what
           needs to re-read the original is out of reach. -->
      <div class="gone-banner">
        <Icon name="alert" size={14} />
        <span>
          <strong>{session.source.filename ?? session.source.path}</strong> was deleted from the
          case. What you already captured is still here, but new frames and re-renders can't be
          made from it.
        </span>
      </div>
    {/if}
    <div class="tabbar">
      {#each tabs as t (t)}
        <button class="tab" class:active={activeTab === t} onclick={() => (activeTab = t)}>
          <Icon name={TAB_META[t].icon} size={15} /> {TAB_META[t].label}
        </button>
      {/each}
      {#if activeTab === 'collage'}
        <div class="tab-spacer"></div>
        <button class="btn btn-ghost btn-sm" title="Undo (Ctrl+Z)" disabled={!collageCanUndo} onclick={undoCollage}>
          <Icon name="undo" size={15} />
        </button>
        <button class="btn btn-ghost btn-sm" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!collageCanRedo} onclick={redoCollage}>
          <Icon name="redo" size={15} />
        </button>
      {/if}
    </div>

    <div class="workspace">
      <div class="viewer" class:pad={activeTab !== 'collage' && activeTab !== 'save'}>
        {#if activeTab === 'selection'}
          <VideoPlayer
            bind:video={videoEl}
            src={fileUrl(caseState.current?.id, session.source.path)}
            filter={videoPreview.filter}
            transform={videoPreviewTransform}
            quarterTurn={videoQuarterTurn}
            duration={probeInfo?.duration ?? 0}
            currentTime={shared.currentTime}
            ontimeupdate={(time) => (shared.currentTime = time)}
          />
        {:else if activeTab === 'frame'}
          {#if activeFrame}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="frame-viewport"
              class:cropping={shared.cropMode}
              class:pannable={!shared.cropMode && !cropEditing}
              class:rotating
              bind:this={frameViewportEl}
              onwheel={frameWheel}
              onmousedown={frameMouseDown}
              onpointerdown={frameViewportDown}
              onauxclick={(e) => e.preventDefault()}
              ondblclick={beginCrop}
            >
              <div
                class="zoom-layer"
                bind:this={frameZoomEl}
                style:transform={`translate(${framePan.x}px, ${framePan.y}px) scale(${frameZoom})`}
              >
                <!-- View-only rotation pivots around the grabbed point; never saved. -->
                <div
                  class="img-stage"
                  bind:this={frameStageEl}
                  style:transform={matrixCss(frameRotMatrix)}
                  style:transform-origin="0 0"
                >
                  {#if activeFrame.crop && !cropEditing}
                    <!-- committed crop: show the cropped region -->
                    <div class="crop-view" style:--ar={cropAspect(activeFrame.crop, activeFrame.w, activeFrame.h) ?? 1}>
                      <img
                        src={activeFrame.url}
                        alt="frame"
                        draggable="false"
                        style={styleText(cropImgStyle(activeFrame.crop))}
                        style:filter={framePreview.filter}
                        style:transform={framePreview.transform}
                      />
                    </div>
                  {:else}
                    <img src={activeFrame.url} alt="frame" draggable="false" style:filter={framePreview.filter} style:transform={framePreview.transform} />
                    <CropBox
                      bind:crop={activeFrame.crop}
                      bind:draw={shared.cropMode}
                      aspect={frameAspect}
                      natW={activeFrame.w}
                      natH={activeFrame.h}
                    />
                  {/if}
                </div>
              </div>
              {#if rotating}
                <!-- "target" pivot marker: sits at the grabbed point, fixed on
                     screen while the image turns around it -->
                <div class="rotate-pivot" style:left={`${rotatePivot.x}px`} style:top={`${rotatePivot.y}px`} aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 40 40">
                    <circle class="ring" cx="20" cy="20" r="15" />
                    <circle class="dot" cx="20" cy="20" r="1.5" />
                  </svg>
                </div>
              {/if}
              <div class="view-ctl">
                {#if cropEditing}
                  <span class="zoom-hint">drag to crop · Enter applies · Esc cancels</span>
                  <button class="btn btn-sm" onclick={commitCrop} title="Apply the crop (Enter)">
                    <Icon name="check" size={14} /> Apply
                  </button>
                {:else if frameViewDirty}
                  {#if frameZoom !== 1}<span class="zoom-val">{Math.round(frameZoom * 100)}%</span>{/if}
                  {#if frameAngle !== 0}<span class="zoom-val">{frameAngle}°</span>{/if}
                  <button class="btn btn-ghost btn-sm" onclick={resetFrameView} title="Reset zoom / pan / rotation">
                    <Icon name="eye" size={14} /> Fit
                  </button>
                {:else}
                  <span class="zoom-hint">scroll zoom · drag pan · middle-drag turns · double-click crop</span>
                {/if}
              </div>
            </div>
          {:else}
            <div class="hint-mid">
              <Icon name="image" size={34} />
              <p>No frame selected. Capture frames in the Selection tab.</p>
            </div>
          {/if}
        {:else if activeTab === 'collage'}
          <CollageCanvas collage={activeCollage} bind:selectedIds={collageSelectedIds} {requestCrop} />
        {:else if activeTab === 'save'}
          <SaveGallery {savables} {saveUi} {saveName} {setSaveName} />
        {/if}
      </div>

      <aside class="panel">
        {#if activeTab === 'selection'}
          <SelectionMenu {probeInfo} {shared} {videoFilters} {session} {capture} />
        {:else if activeTab === 'frame'}
          <FrameMenu
            {session} {filters} {analyses} {activeFrame} {shared} {removeFrame}
            bind:cropAspect={frameAspect} bind:cropEditing {beginCrop} {commitCrop}
            setRotation={setFrameRotation} rotationBusy={frameOrientationBusy}
            setActive={(id) => (session.activeFrameId = id)}
          />
        {:else if activeTab === 'collage'}
          <CollageMenu
            {session} {filters} bind:selectedIds={collageSelectedIds}
            {addToCollage} {requestCrop} {renderPiece}
            onRename={(cl) => (saveUi.touched[`collage:${cl.id}`] = true)}
          />
        {:else if activeTab === 'save'}
          <SaveMenu {savables} {saveUi} {saving} save={saveSelected} />
        {/if}
      </aside>
    </div>
  {/if}

  {#if cropPieceNode}
    <PieceCropModal
      node={cropPieceNode}
      onapply={(crop) => { applyNodeCrop(cropPieceNode, crop); cropPieceNode = null; }}
      onclose={() => (cropPieceNode = null)}
    />
  {/if}

  {#if discardConfirm}
    <ConfirmDialog
      title="Discard this session?"
      message="This clears the current workspace."
      detail={openedSession ? 'This does not delete the saved session, only the unsaved changes in this workspace.' : 'Anything not saved yet will be lost.'}
      confirmLabel="Discard"
      tone="danger"
      icon="reset"
      onconfirm={discardSession}
      oncancel={cancelDiscard}
    />
  {/if}

  {#if overwritePrompt}
    <ConfirmDialog
      title="Overwrite this session?"
      message={`“${savedTitle(sessionEntities, 'session', overwritePrompt.slug)}” is already saved in this case.`}
      detail="Saving replaces its workspace. Rename this session to keep both."
      confirmLabel="Overwrite"
      tone="danger"
      icon="check"
      onconfirm={performSessionSave}
      oncancel={() => (overwritePrompt = null)}
    />
  {/if}

  {#if sourceModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-back" onclick={() => (sourceModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="modal source-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-session-title" tabindex="-1">
        <div class="modal-head">
          <h3 id="new-session-title">New session</h3>
          <button class="btn btn-ghost btn-xs" onclick={() => (sourceModalOpen = false)} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div class="picker-search">
          <SearchInput bind:value={sourceQuery} placeholder="Search names…" width="100%" />
          <button class="btn btn-ghost btn-sm browse-btn" title="Browse folders" onclick={toggleSourceBrowser}>…</button>
        </div>

        {#if inspectableMedia.length === 0}
          <p class="modal-hint">Add an image or video to start an Inspect session.</p>
          <div class="modal-actions">
            <button class="btn btn-sm" onclick={() => (sourceModalOpen = false)}>Cancel</button>
            <button class="btn btn-primary btn-sm" onclick={() => { sourceModalOpen = false; uiState.tool = 'media'; }}>
              Go to Media Library
            </button>
          </div>
        {:else}
          <div class="source-filters" aria-label="Media type">
            {#each SOURCE_FILTERS as filter (filter.id)}
              <button
                class="btn btn-ghost btn-sm"
                class:active={sourceFilter === filter.id}
                aria-pressed={sourceFilter === filter.id}
                onclick={() => setSourceFilter(filter.id)}
              >
                {filter.label}
              </button>
            {/each}
          </div>

          {#if sourceBrowserOpen}
          <FolderBrowser
            entries={sourceBrowserEntries}
            path={sourceBrowsePath}
            rootLabel="Case media"
            selectedId={sourceBrowseSelection}
            matches={(m) => matchesSourceName(m, sourceQuery)}
            emptyText="This folder has no matching media."
            icon={(m) => (m.kind === 'video' ? 'video' : 'image')}
            label={(m) => m.title || m.filename}
            onnavigate={openSourceFolder}
            onselect={(m) => selectSourceBrowser(m)}
            onconfirm={(m) => selectSourceBrowser(m, true)}
          />
          <div class="modal-actions">
            <button class="btn btn-primary btn-sm" disabled={!sourceBrowseSelection} onclick={confirmSourceBrowser}>Open selected</button>
          </div>
          {:else}
          {#if pickableMedia.length === 0}
            <p class="modal-hint">No media matches this filter.</p>
          {:else}
            <div class="source-list">
              {#each pickableMedia as m (m.path)}
                <button class="source-open" onclick={() => selectNewSource(m)}>
                  <div class="source-thumb">
                    {#if m.thumbnail}
                      <img src={fileUrl(caseState.current.id, m.thumbnail)} alt="" loading="lazy" />
                    {:else}
                      <Icon name={m.kind === 'video' ? 'video' : 'image'} size={22} />
                    {/if}
                  </div>
                  <span class="source-copy">
                    <span class="source-title">{m.title || m.filename}</span>
                    <span class="source-meta">
                      {sourceCategory(m)}{m.folder ? ` · ${m.folder}` : ''}
                    </span>
                  </span>
                </button>
              {/each}
            </div>
          {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if sessionModal.open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-back" onclick={() => (sessionModal.open = false)} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-head">
          <h3>Open session</h3>
          <button class="btn btn-ghost btn-xs" onclick={() => (sessionModal.open = false)} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        {#if sessionBrowserOpen}
          <div class="picker-search">
            <SearchInput bind:value={sessionQuery} placeholder="Search sessions…" width="100%" />
            <button class="btn btn-ghost btn-sm browse-btn" title="Show session list" onclick={toggleSessionBrowser}>…</button>
          </div>
          <FolderBrowser
            entries={sessionBrowserEntries}
            path={sessionBrowsePath}
            rootLabel="Sessions"
            selectedId={sessionBrowseSelection}
            matches={(s) => matchesSessionQuery(s, sessionQuery)}
            emptyText="This folder has no matching sessions."
            icon={() => 'inspect'}
            label={(s) => s.title}
            onnavigate={openSessionFolder}
            onselect={(s) => selectSessionBrowser(s)}
            onconfirm={(s) => selectSessionBrowser(s, true)}
          />
          <div class="modal-actions">
            <button class="btn btn-primary btn-sm" disabled={!sessionBrowseSelection} onclick={confirmSessionBrowser}>Open selected</button>
          </div>
        {:else}
          {#if sessionModal.busy}
            <p class="modal-hint">Loading…</p>
          {:else}
            {#if sessionModal.list.length > 6}
              <div class="picker-search">
                <SearchInput bind:value={sessionQuery} placeholder="Search sessions…" width="100%" />
                <button class="btn btn-ghost btn-sm browse-btn" title="Browse folders" onclick={toggleSessionBrowser}>…</button>
              </div>
            {/if}
            {#if sessionModal.list.length === 0}
              <p class="modal-hint">No saved sessions yet.</p>
            {:else if visibleSessions.length === 0}
              <p class="modal-hint">No sessions match this search.</p>
            {:else}
              <div class="session-list">
                {#each visibleSessions as s (s.name)}
                  <div class="session-row">
                    <button class="session-open" disabled={sessionLoading} onclick={() => openSession(s.name)}>
                      <span class="session-title">{s.title}</span>
                      <span class="session-meta">{s.frames} frame{s.frames === 1 ? '' : 's'} · {s.collage} collage piece{s.collage === 1 ? '' : 's'}</span>
                    </button>
                    <button class="btn btn-ghost btn-xs" disabled={sessionLoading} onclick={() => deleteSession(s.name)} aria-label="Delete session">
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tool {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .tool-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  h2 {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .spacer {
    flex: 1;
  }
  .empty,
  .hint-mid {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-3);
    text-align: center;
  }
  .hint-mid p {
    max-width: 260px;
    font-size: var(--fs-sm);
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .gone-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    font-size: var(--fs-xs);
    line-height: 1.45;
    color: color-mix(in srgb, var(--danger, #e5484d) 80%, var(--text-2));
    background: color-mix(in srgb, var(--danger, #e5484d) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--danger, #e5484d) 22%, transparent);
  }
  .gone-banner :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .tabbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tab-spacer {
    flex: 1;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-3);
  }
  .tab:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .tab.active {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .workspace {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .viewer {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    overflow: auto;
  }
  .viewer.pad {
    padding: 18px;
  }
  /* Frame tab: a zoom/pan/rotate surface with the crop overlay on top. */
  .frame-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    touch-action: none;
  }
  .frame-viewport.pannable {
    cursor: grab;
  }
  .frame-viewport.cropping {
    cursor: crosshair;
  }
  .frame-viewport.rotating {
    cursor: grabbing;
  }
  /* Sober pivot mark (Google-Earth style): a faint translucent ring + dot. */
  .rotate-pivot {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 5;
    color: #fff;
  }
  .rotate-pivot svg {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55));
  }
  .rotate-pivot .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    opacity: 0.5;
  }
  .rotate-pivot .dot {
    fill: currentColor;
    opacity: 0.8;
  }
  .zoom-layer {
    position: relative;
    transform-origin: center center;
    display: inline-block;
    line-height: 0;
  }
  .img-stage {
    position: relative;
    display: inline-block;
    line-height: 0;
  }
  .img-stage > img {
    max-width: 100%;
    max-height: calc(100vh - var(--topbar-h) - 200px);
    display: block;
  }
  .crop-view {
    position: relative;
    overflow: hidden;
    aspect-ratio: var(--ar);
    height: calc(100vh - var(--topbar-h) - 220px);
    max-width: 100%;
    line-height: 0;
  }
  .crop-view img {
    display: block;
  }
  .view-ctl {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--r-md);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
  }
  .zoom-val {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .zoom-hint {
    font-size: 11px;
    color: var(--text-3);
    user-select: none;
  }
  .panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
  .modal-back {
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .modal {
    width: 420px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    overflow: auto;
    background: var(--bg-1);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg, 12px);
    box-shadow: var(--shadow-2);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .source-modal {
    width: 560px;
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal-head h3 {
    font-size: var(--fs-md);
    font-weight: 700;
  }
  .modal-hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin: 0;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .source-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: min(52vh, 480px);
    overflow: auto;
  }
  .source-filters {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .picker-search {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .picker-search :global(.search-box) {
    flex: 1;
  }
  .browse-btn {
    min-width: 30px;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .source-filters .active {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .source-open {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }
  .source-open:hover {
    border-color: var(--accent);
    background: var(--bg-3);
  }
  .source-thumb {
    display: grid;
    place-items: center;
    width: 48px;
    height: 40px;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-3);
  }
  .source-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .source-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .source-title,
  .source-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-title {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .source-meta {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .session-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .session-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .session-open {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }
  .session-open:hover {
    border-color: var(--accent);
  }
  .session-open:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .session-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .session-meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
