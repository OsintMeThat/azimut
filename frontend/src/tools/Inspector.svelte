<script>
  import { api } from '../lib/api.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    adjustDefaults, buildOps, previewStyle, isNeutral, uid, videoSeed, initialQuad, VIDEO_ADJUST_IDS,
    collageBounds, quadFromCropRect, cropImgStyle, cropAspect, styleText,
  } from '../lib/inspect.js';
  import { createHistory } from '../lib/history.js';
  import { IDENTITY, matrixCss, rotateAbout, isIdentity, matrixAngleDeg, pointerAngleDeg } from '../lib/frameRotate.js';
  import Icon from '../components/Icon.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import CropBox from './inspect/CropBox.svelte';
  import SelectionMenu from './inspect/SelectionMenu.svelte';
  import FrameMenu from './inspect/FrameMenu.svelte';
  import CollageCanvas from './inspect/CollageCanvas.svelte';
  import CollageMenu from './inspect/CollageMenu.svelte';
  import SaveGallery from './inspect/SaveGallery.svelte';
  import SaveMenu from './inspect/SaveMenu.svelte';
  import PieceCropModal from './inspect/PieceCropModal.svelte';

  // The Inspect tool is a *scratch workspace*. Opening a photo/video starts a
  // session; captured frames, per-frame adjustments, video tuning and a collage
  // layout all live here as plain data. Nothing becomes case media until the Save
  // tab commits it — the recipes are re-derived full-res on the backend then.
  const TAB_META = {
    selection: { label: 'Selection', icon: 'video' },
    frame: { label: 'Frame', icon: 'image' },
    collage: { label: 'Collage', icon: 'layers' },
    save: { label: 'Save', icon: 'save' },
  };

  let mediaList = $state([]);
  let loadedFor = $state(null);
  let filters = $state([]);
  let analyses = $state([]);
  let probeInfo = $state(null);

  let activeTab = $state('selection');
  let collageSelectedIds = $state([]);
  let cropPieceNode = $state(null);
  // Real (backend-composited) Save-tab thumbnails, keyed by collage id:
  // { sig, url } — regenerated only when a collage's layout actually changes.
  let collagePreviews = $state({});
  let saving = $state(false);
  const saveUi = $state({ selected: {}, folder: '' });
  // the saved session this workspace came from (if any) — re-saving overwrites it
  // in place instead of forking a new named session.
  let openedSession = $state(null);
  const sessionModal = $state({ open: false, mode: 'save', name: null, title: '', list: [], busy: false });
  let discardConfirm = $state(false);

  // A fresh, empty collage. A session can hold several — the Collage tab edits
  // one at a time (session.activeCollageId) and each is saved as its own PNG.
  function makeCollage(name) {
    return { id: uid('cl'), name, width: 1600, height: 800, background: '#12141c', transparent: true, nodes: [] };
  }

  // the live session (reset on source / case change)
  const _firstCollage = makeCollage('Collage 1');
  const session = $state({
    source: null,
    videoAdjust: {},
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
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commitCrop(); }
      return;
    }
    // Selection tab: ←/→ step one frame (Shift = 1s), ,/. mpv-style aliases
    if (activeTab !== 'selection' || session.source?.kind !== 'video') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepVideo(e.shiftKey ? -1 : -frameDur); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepVideo(e.shiftKey ? 1 : frameDur); }
    else if (e.key === ',') { e.preventDefault(); stepVideo(-frameDur); }
    else if (e.key === '.') { e.preventDefault(); stepVideo(frameDur); }
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

  const videoFilters = $derived(filters.filter((f) => VIDEO_ADJUST_IDS.includes(f.id)));
  const tabs = $derived(
    session.source?.kind === 'video' ? ['selection', 'frame', 'collage', 'save'] : ['frame', 'collage', 'save']
  );
  const activeFrame = $derived(session.frames.find((f) => f.id === session.activeFrameId) ?? null);
  const framePreview = $derived(activeFrame ? previewStyle(filters, activeFrame.adjust) : { filter: '', transform: '' });
  const videoPreview = $derived(previewStyle(videoFilters, session.videoAdjust));

  const savables = $derived.by(() => {
    const out = [];
    const cid = caseState.current?.id;
    if (session.source?.kind === 'video' && !isNeutral(videoFilters, session.videoAdjust)) {
      const t = session.source.thumbnail ? `/files/${cid}/${session.source.thumbnail}` : null;
      out.push({ key: 'video', kind: 'video', label: 'Video 1', thumb: t, saved: !!session.saved.video });
    }
    let imgN = 0;
    for (const fr of session.frames) {
      imgN += 1;
      out.push({
        key: `frame:${fr.id}`, kind: 'frame', frame: fr, thumb: fr.url,
        label: `Image ${imgN}`, filter: previewStyle(filters, fr.adjust).filter,
        saved: !!session.saved[`frame:${fr.id}`],
      });
    }
    let colN = 0;
    for (const cl of session.collages) {
      colN += 1;
      if (!cl.nodes.length) continue;
      out.push({
        key: `collage:${cl.id}`, kind: 'collage', label: cl.name || `Collage ${colN}`,
        thumb: null, collage: cl, preview: collagePreviews[cl.id]?.url ?? null,
        saved: !!session.saved[`collage:${cl.id}`],
      });
    }
    return out;
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
    // the Frame tab (never baked) — neither belongs in the slider pipeline.
    filters = ops.filters.filter((f) => f.id !== 'crop' && f.id !== 'rotate');
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
    caseState.rev;
    const list = caseState.current?.entities ?? [];
    if (
      openedSession &&
      !list.some((e) => e.attrs?.spec === `inspect/${openedSession.name}.json`)
    ) {
      openedSession = null;
      toast('The saved session was deleted — saving now files a new one', 'warn');
    }
    const path = session.source?.path;
    sourceGone = !!path && !list.some((e) => e.attrs?.path === path);
  });

  function mediaLabel(m) {
    const name = m.title || m.filename;
    return name.length > 60 ? name.slice(0, 57) + '…' : name;
  }

  function resetSession() {
    for (const fr of session.frames) if (fr.url?.startsWith('blob:')) URL.revokeObjectURL(fr.url);
    session.source = null;
    session.videoAdjust = {};
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
    openedSession = null;
    collageSelectedIds = [];
    shared.currentTime = 0;
    shared.cropMode = false;
    frameZoom = 1;
    framePan = { x: 0, y: 0 };
    frameRotMatrix = IDENTITY;
    rotating = false;
    frameAspect = null;
    cropEditing = false;
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
      const frame = makeFrame(item.path, null, `/files/${caseState.current.id}/${item.path}`);
      session.frames.push(frame);
      session.activeFrameId = frame.id;
      activeTab = 'frame';
    }
  }

  function makeFrame(path, time, url) {
    return {
      id: uid('fr'), path, time, url,
      adjust: adjustDefaults(filters), crop: null,
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
    try {
      const url = await renderUrl(session.source.path, time, []);
      const frame = makeFrame(session.source.path, time, url);
      // frames captured from a tuned video inherit those gear adjustments
      frame.adjust = videoSeed(filters, session.videoAdjust);
      session.frames.push(frame);
      session.activeFrameId = frame.id;
      toast('Frame added to tray. Not saved yet', 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Collage pieces are snapshots frozen at add-time: the modified image is baked
  // now and later frame edits never change it (deliberate — see SPEC).
  async function addToCollage(frame) {
    const cl = activeCollage;
    if (!cl) return;
    try {
      const ops = buildOps(filters, frame.adjust, frame.crop);
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

  // -- frame viewer: zoom / pan / straighten (Frame tab) -------------------
  // Reset the view whenever the active frame changes.
  $effect(() => {
    session.activeFrameId; // track
    frameZoom = 1;
    framePan = { x: 0, y: 0 };
    frameRotMatrix = IDENTITY;
    frameAspect = null;
    cropEditing = false;
    shared.cropMode = false;
  });

  // Enter crop editing (original + box); arm a fresh draw if there's no box yet.
  function beginCrop() {
    if (!activeFrame) return;
    cropEditing = true;
    if (!activeFrame.crop) shared.cropMode = true;
  }
  // Apply the crop → drop back to the committed preview of the cropped result.
  function commitCrop() {
    cropEditing = false;
    shared.cropMode = false;
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
    saving = true;
    try {
      const frameItems = chosen
        .filter((it) => it.kind === 'frame')
        .map((it) => ({
          path: it.frame.path,
          time: it.frame.time ?? null,
          ops: buildOps(filters, it.frame.adjust, it.frame.crop),
        }));
      if (frameItems.length) {
        await api.post(`/api/cases/${cid}/inspect/save-frames`, { items: frameItems, folder });
        for (const it of chosen) if (it.kind === 'frame') session.saved[it.key] = true;
      }
      if (chosen.some((it) => it.kind === 'video')) {
        await api.post(`/api/cases/${cid}/inspect/enhance-video`, {
          path: session.source.path, params: session.videoAdjust, folder,
        });
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
        await api.post(`/api/cases/${cid}/inspect/compose`, {
          width: b.width,
          height: b.height,
          background: null,
          nodes, folder,
        });
        session.saved[it.key] = true;
      }
      await reloadCase();
      await refresh();
      saveUi.selected = {};
      toast(`Saved ${chosen.length} item${chosen.length === 1 ? '' : 's'} to the case`, 'ok');
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
      activeFrameId: session.activeFrameId,
      frames: session.frames.map((f) => ({
        id: f.id, path: f.path, time: f.time, adjust: { ...f.adjust }, crop: f.crop, w: f.w, h: f.h,
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

  function openSaveDialog() {
    sessionModal.mode = 'save';
    sessionModal.name = openedSession?.name ?? null;
    sessionModal.title = openedSession?.title || session.source?.label || session.source?.filename || 'Inspect session';
    sessionModal.open = true;
  }

  async function openLoadDialog() {
    sessionModal.mode = 'open';
    sessionModal.busy = true;
    sessionModal.open = true;
    try {
      sessionModal.list = await api.get(`/api/cases/${caseState.current.id}/inspect/sessions`);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      sessionModal.busy = false;
    }
  }

  async function confirmSaveSession() {
    const title = sessionModal.title.trim();
    if (!title) return;
    sessionModal.busy = true;
    try {
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/sessions`, {
        name: sessionModal.name, title, spec: sessionSpec(),
      });
      openedSession = { name: res.name, title };
      await reloadCase();
      sessionModal.open = false;
      toast('Session saved. Reopen it from the sidebar', 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      sessionModal.busy = false;
    }
  }

  async function openSession(name) {
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
    for (const f of spec.frames ?? []) {
      try {
        const url = await renderUrl(f.path, f.time, []);
        session.frames.push({ ...f, url });
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
    activeTab = src.kind === 'video' ? 'selection' : 'frame';
    sessionModal.open = false;
    anchorCollageHistory();
  }

  function discardSession() {
    resetSession();
    discardConfirm = false;
  }

  async function deleteSession(name) {
    try {
      await api.del(`/api/cases/${caseState.current.id}/inspect/sessions/${name}`);
      sessionModal.list = sessionModal.list.filter((s) => s.name !== name);
      if (openedSession?.name === name) openedSession = null;
      await reloadCase();
    } catch (e) {
      toast(e.message, 'danger');
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="tool">
  <div class="tool-header">
    <h2>Inspect</h2>
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn btn-sm" onclick={openLoadDialog} title="Reopen a saved session">
        <Icon name="folderOpen" size={14} /> Open
      </button>
      {#if session.source}
        <button class="btn btn-sm" onclick={() => (discardConfirm = true)} title="Clear this workspace">
          <Icon name="reset" size={14} /> Discard
        </button>
      {/if}
      <button class="btn btn-sm" disabled={!session.source} onclick={openSaveDialog} title="Save this workspace">
        <Icon name="save" size={14} /> Save session
      </button>
    {/if}
    <select
      class="input source-select"
      value={session.source?.path ?? ''}
      onchange={(e) => {
        const m = mediaList.find((x) => x.path === e.target.value);
        if (m) select(m);
      }}
    >
      <option value="" disabled>Choose a media…</option>
      {#each mediaList as m (m.path)}
        <option value={m.path} title={m.title || m.filename}>{mediaLabel(m)}</option>
      {/each}
    </select>
  </div>

  {#if !caseState.current}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Open a case and add media to start inspecting.</p>
      <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
    </div>
  {:else if !session.source}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Choose a media above to open it.</p>
      {#if mediaList.length === 0}
        <button class="btn" onclick={() => (uiState.tool = 'media')}>Add media first</button>
      {/if}
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
          <div class="frame">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={videoEl}
              src={`/files/${caseState.current?.id}/${session.source.path}`}
              controls
              ontimeupdate={() => (shared.currentTime = videoEl?.currentTime ?? 0)}
              style:filter={videoPreview.filter}
              style:transform={videoPreview.transform}
            ></video>
          </div>
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
          <SaveGallery {savables} {saveUi} />
        {/if}
      </div>

      <aside class="panel">
        {#if activeTab === 'selection'}
          <SelectionMenu {probeInfo} {shared} {videoFilters} {session} {capture} />
        {:else if activeTab === 'frame'}
          <FrameMenu {session} {filters} {analyses} {activeFrame} {shared} {removeFrame} bind:cropAspect={frameAspect} bind:cropEditing {beginCrop} {commitCrop} setActive={(id) => (session.activeFrameId = id)} />
        {:else if activeTab === 'collage'}
          <CollageMenu {session} {filters} bind:selectedIds={collageSelectedIds} {addToCollage} {requestCrop} />
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
      message="The current workspace — captured frames, adjustments and collage layout — will be cleared."
      detail={openedSession ? 'This does not delete the saved session, only the unsaved changes in this workspace.' : 'Anything not saved yet will be lost.'}
      confirmLabel="Discard"
      tone="danger"
      icon="reset"
      onconfirm={discardSession}
      oncancel={() => (discardConfirm = false)}
    />
  {/if}

  {#if sessionModal.open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-back" onclick={() => (sessionModal.open = false)} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-head">
          <h3>{sessionModal.mode === 'save' ? 'Save session' : 'Open session'}</h3>
          <button class="btn btn-ghost btn-xs" onclick={() => (sessionModal.open = false)} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        {#if sessionModal.mode === 'save'}
          <p class="modal-hint">Persist the whole workspace (frames, adjustments, collages) to reopen later. Saving the session does not file any media.</p>
          <input
            class="input"
            placeholder="Session name"
            bind:value={sessionModal.title}
            onkeydown={(e) => e.key === 'Enter' && confirmSaveSession()}
          />
          <div class="modal-actions">
            <button class="btn btn-sm" onclick={() => (sessionModal.open = false)}>Cancel</button>
            <button class="btn btn-primary btn-sm" disabled={sessionModal.busy || !sessionModal.title.trim()} onclick={confirmSaveSession}>
              <Icon name="save" size={14} /> Save
            </button>
          </div>
        {:else}
          {#if sessionModal.busy}
            <p class="modal-hint">Loading…</p>
          {:else if sessionModal.list.length === 0}
            <p class="modal-hint">No saved sessions yet.</p>
          {:else}
            <div class="session-list">
              {#each sessionModal.list as s (s.name)}
                <div class="session-row">
                  <button class="session-open" onclick={() => openSession(s.name)}>
                    <span class="session-title">{s.title}</span>
                    <span class="session-meta">{s.frames} frame{s.frames === 1 ? '' : 's'} · {s.collage} collage piece{s.collage === 1 ? '' : 's'}</span>
                  </button>
                  <button class="btn btn-ghost btn-xs" onclick={() => deleteSession(s.name)} aria-label="Delete session">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              {/each}
            </div>
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
  .sub {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .spacer {
    flex: 1;
  }
  .source-select {
    max-width: 280px;
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
  .frame {
    position: relative;
    display: inline-block;
    line-height: 0;
    touch-action: none;
    box-shadow: var(--shadow-2);
  }
  .frame video {
    max-width: 100%;
    max-height: calc(100vh - var(--topbar-h) - 160px);
    display: block;
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
