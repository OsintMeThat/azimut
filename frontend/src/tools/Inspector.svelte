<script>
  import { onDestroy, untrack } from 'svelte';
  import { api, detailLine } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import { workFolder } from '../lib/folders.js';
  import {
    adjustDefaults, buildFrameOps, previewStyle, uid, videoSeed, VIDEO_ADJUST_IDS,
    hasVideoEdits, normalizeRightAngleRotation, rotationOps, sourceStem, frameSaveNames,
    needsRender, previewOps, isNeutral,
  } from '../lib/inspect.js';
  import { captureMoment, frameDuration, preciseClock, seekInto, shownFrameTime } from '../lib/inspectPlayer.js';
  import { INSPECT_HELP } from '../lib/inspectHelp.js';
  import {
    isStretch, momentKey, newScene, sameMoments, sceneList, sceneMarks, scenePassage, sceneStart, sceneTime,
    sceneTitle, sceneToEnd, snapToFrame, stretchFromShot, timeWords,
  } from '../lib/scenes.js';
  import { frameScenes, frameToCapture, frameUses, framesOfScene, proofHandoff } from '../lib/sceneFrames.js';
  import { SceneEdit } from '../lib/sceneEdit.svelte.js';
  import { panelWidth } from '../lib/panelWidth.js';
  import {
    workState, workSpec, isPristine, frameSignature, videoSignature, isFiled, markRecord, sceneRecord,
  } from '../lib/inspectWork.svelte.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { createHistory } from '../lib/history.js';
  import { deletedToast } from '../lib/trash.js';
  import { openInHorizon, openInReverseSearch } from '../lib/navigate.js';
  import { offerNote, offerPuts, withdrawNote } from '../lib/noteHere.svelte.js';
  import { lookupEntity } from '../lib/catalog.js';
  import PutInNote from '../components/PutInNote.svelte';
  import { frameOffer } from './inspect/frameNote.js';
  import { takeSeek } from './inspect/handoff.js';
  import Icon from '../components/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import SourcePicker from '../components/SourcePicker.svelte';
  import PanelEdge from '../components/PanelEdge.svelte';
  import FrameStrip from './inspect/FrameStrip.svelte';
  import FrameViewer from './inspect/FrameViewer.svelte';
  import FrameAdjust from './inspect/FrameAdjust.svelte';
  import FrameAnalyze from './inspect/FrameAnalyze.svelte';
  import InfoPanel from './inspect/InfoPanel.svelte';
  import MomentsPanel from './inspect/MomentsPanel.svelte';
  import SceneButton from './inspect/SceneButton.svelte';
  import ScenePanel from './inspect/ScenePanel.svelte';
  import ProofFrames from './inspect/ProofFrames.svelte';
  import SaveToCase from './inspect/SaveToCase.svelte';
  import VideoAdjust from './inspect/VideoAdjust.svelte';
  import VideoPlayer from './inspect/VideoPlayer.svelte';
  import NoCase from '../components/NoCase.svelte';

  // Inspect works on one file at a time: a video to cut frames from, or an image
  // to read closely. What is done to it is its work, one per file, kept as it is
  // made (engine/inspectwork.py): opening the file again is how it is reopened.
  // Nothing reaches the Media Library until Save to case files an output.

  let mediaList = $state([]);
  let works = $state([]);
  let loadedFor = $state(null);
  let filters = $state([]);
  let analyses = $state([]);
  let probeInfo = $state(null);
  let pickerOpen = $state(false);
  let opening = $state(false);
  let clearConfirm = $state(false);
  let saving = $state(null); // 'video' or 'all' while its save runs
  let savingFrames = $state(new Set()); // ids of the frames being filed, each on its own
  let saveFolder = $state(''); // where the last save went, offered for the next

  const inspectable = $derived(mediaList.filter((m) => m.kind === 'image' || m.kind === 'video'));
  const mediaPaths = $derived(new Set(mediaList.map((m) => m.path)));
  const titleByPath = $derived(new Map(mediaList.map((m) => [m.path, m.title])));

  // The open file's work. `caseId` is captured with it, so a save still pending
  // when the case changes lands in the case it was made in.
  const work = $state({
    caseId: null,
    source: null,
    name: null,
    videoAdjust: {},
    videoRotation: 0,
    videoFiled: null,
    frames: [],
    marks: [],
    // Scenes kept on a video and not proved yet; proved ones are the proofs' own.
    scenes: [],
    activeFrameId: null,
  });

  // What is kept on the clip, scenes and marks, goes back with Ctrl+Z and forward
  // with Ctrl+Shift+Z, and every toast about it offers Undo while nothing has moved
  // since (`lib/history.js`).
  const clipHistory = createHistory(80);
  const clipSnapshot = () =>
    JSON.stringify({ scenes: work.scenes.map(sceneRecord), marks: work.marks.map(markRecord) });

  // Bumped whenever the open file changes, so a render or a capture that returns
  // afterwards can tell it belongs to a file no longer open.
  let openRun = 0;
  // Every preview blob this file made. A duplicated frame shares its original's,
  // so they are freed together when the file closes rather than one at a time.
  const blobs = new Set();

  const videoFilters = $derived(filters.filter((f) => VIDEO_ADJUST_IDS.includes(f.id)));
  const isVideo = $derived(work.source?.kind === 'video');

  // The file open here is what the topbar's Add event seats.
  $effect(() => {
    const s = work.source;
    offerNote(
      'inspect',
      s?.entity_id
        ? { id: s.entity_id, label: s.title ?? s.filename, type: 'media', attrs: { path: s.path, kind: s.kind } }
        : null,
    );
  });
  onDestroy(() => withdrawNote('inspect'));
  const activeFrame = $derived(work.frames.find((f) => f.id === work.activeFrameId) ?? null);
  const selected = $derived(activeFrame ? activeFrame.id : isVideo ? 'video' : null);
  const framePreview = $derived(activeFrame ? previewStyle(filters, activeFrame.adjust) : { filter: '', transform: '' });
  const videoPreview = $derived(previewStyle(videoFilters, work.videoAdjust));
  const videoRotation = $derived(normalizeRightAngleRotation(work.videoRotation));
  const videoTransform = $derived(
    [videoPreview.transform, videoRotation ? `rotate(${videoRotation}deg)` : ''].filter(Boolean).join(' ')
  );
  const videoEdited = $derived(isVideo && hasVideoEdits(videoFilters, work.videoAdjust, videoRotation));

  // A frame carries only the path it was cut from, so the title is looked back up:
  // without it every frame of a download is named after the download's filename.
  const stemFor = (path) => sourceStem({ path, title: titleByPath.get(path) ?? work.source?.title });
  const frameNames = $derived.by(() => {
    const names = frameSaveNames(work.frames.map((f) => ({ stem: stemFor(f.path), time: f.time })));
    return new Map(work.frames.map((f, i) => [f.id, names[i]]));
  });
  const filedIds = $derived(
    new Set(work.frames.filter((f) => isFiled(f.filed, frameSignature(filters, f), mediaPaths)).map((f) => f.id))
  );
  const videoFiled = $derived(
    isFiled(work.videoFiled, videoSignature(videoFilters, work.videoAdjust, videoRotation), mediaPaths)
  );

  // -- saving as it is made ---------------------------------------------------
  let savedSignature = $state(null);
  const signature = () => JSON.stringify(workSpec(work));
  const pristine = $derived(!work.source || isPristine(work, filters, videoFilters));

  async function writeWork(opts) {
    if (!work.source || opening) return;
    const sig = signature();
    if (sig === savedSignature) return;
    // Looking at a file files nothing; the first real change is what does.
    if (!work.name && isPristine(work, filters, videoFilters)) return;
    const path = work.source.path;
    const res = await api.put(`/api/cases/${work.caseId}/inspect/work`, { path, spec: JSON.parse(sig) }, opts);
    if (work.source?.path === path) {
      const first = !work.name;
      work.name = res.name;
      savedSignature = sig;
      if (first) reloadCase(); // the sidebar lists the work it just filed
    }
    workState.rev += 1;
  }

  const autosave = createAutosave({ write: () => writeWork() });

  $effect(() => {
    const sig = signature();
    if (!work.source || opening || sig === savedSignature) return;
    autosave.schedule();
  });

  // Leaving the tool, or the page, is a moment to write rather than wait.
  $effect(() => {
    if (uiState.tool !== 'inspect') {
      autosave.flush();
      videoEl?.pause();
    }
  });
  $effect(() => () => autosave.flush());

  function onpagehide() {
    if (autosave.pending) writeWork({ keepalive: true }).catch(() => {});
  }

  const status = $derived.by(() => {
    if (!work.source || (!work.name && pristine)) return '';
    if (autosave.state.status === 'error') return 'error';
    if (autosave.state.status === 'pending' || autosave.state.status === 'saving') return 'saving';
    return 'saved';
  });

  // -- the case -----------------------------------------------------------------
  async function ensureOps() {
    if (filters.length) return;
    const ops = await api.get('/api/inspect/ops');
    // `crop` is the interactive box, `rotate` a view-only turn and `remap` what
    // auto-stitch solves: none of the three belongs in the slider pipeline.
    const solved = ['crop', 'rotate', 'remap'];
    filters = ops.filters.filter((f) => !solved.includes(f.id));
    analyses = ops.analyses;
  }

  async function refreshWorks(id = caseState.current?.id) {
    if (!id) return;
    try {
      works = await api.get(`/api/cases/${id}/inspect/works`);
    } catch {
      works = [];
    }
  }

  async function refresh(id = caseState.current?.id) {
    if (!id) return;
    mediaList = await api.get(`/api/cases/${id}/media`);
    await refreshWorks(id);
  }

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // a delete, an import or a restore elsewhere
    if (id !== loadedFor) {
      loadedFor = id;
      mediaList = [];
      works = [];
      // A save still pending goes to the case it was made in, then the file closes.
      autosave.flush().finally(() => {
        if (work.caseId && work.caseId !== caseState.current?.id) closeFile();
      });
      if (id) refresh(id);
    } else if (id) {
      // a proof deleted or restored meanwhile hides or gives back the scene it took up
      refresh(id).then(recheckOpenFile).then(() => {
        if (uiState.tool === 'inspect' && isVideo && !opening) loadScenes(openRun);
      });
    }
  });

  /**
   * Whatever changed elsewhere may concern the open file. A renamed one is followed
   * to its new path. A deleted file takes its work with it, so there is nothing
   * left to keep open. A restore may have brought back the work of a file shown
   * here with nothing done to it yet, and that work is what should be on screen
   * rather than be written over.
   */
  async function recheckOpenFile() {
    if (!work.source || opening) return;
    if (!mediaPaths.has(work.source.path)) {
      // Renamed elsewhere: the same file under a new path, with its work moved along.
      const moved = work.source.entity_id && mediaList.find((m) => m.entity_id === work.source.entity_id);
      if (moved) {
        open(moved);
        return;
      }
      autosave.cancel();
      toast(`“${work.source.title || work.source.filename}” was deleted from the case`, 'warn');
      closeFile();
      return;
    }
    if (!work.name && pristine && works.some((w) => w.source === work.source.path)) {
      open(work.source);
    }
  }

  // -- opening a file -----------------------------------------------------------
  function closeFile() {
    openRun += 1;
    for (const url of blobs) URL.revokeObjectURL(url);
    blobs.clear();
    work.caseId = null;
    work.source = null;
    work.name = null;
    work.videoAdjust = {};
    work.videoRotation = 0;
    work.videoFiled = null;
    work.frames = [];
    work.marks = [];
    work.scenes = [];
    work.activeFrameId = null;
    savedSignature = null;
    listedScenes = [];
    takenScenes = [];
    usedFrames = {};
    proofChooser = null;
    sceneEdit.close();
    scenesOpen = false;
    clipHistory.reset(clipSnapshot());
    probeInfo = null;
    shared.currentTime = 0;
    shared.frameTime = null;
    shared.seekTo = null;
    shared.cropMode = false;
    cropEditing = false;
    cropBefore = null;
    frameAspect = null;
    overview = null;
    scan = null;
    scanning = false;
    analysis = null;
    dropRendered();
    holdOriginal = false;
    focusMarkId = null;
  }

  /** A work whose save failed is held open, where the header says so and offers Retry,
   *  rather than dropped by whatever was about to replace it. */
  function heldUnsaved() {
    if (!autosave.unsaved) return false;
    toast('The work could not be saved, so it stays open', 'warn');
    return true;
  }

  async function open(item) {
    pickerOpen = false;
    await autosave.flush();
    if (heldUnsaved()) return;
    await ensureOps();
    closeFile();
    const run = openRun;
    const caseId = caseState.current?.id;
    opening = true;
    work.caseId = caseId;
    work.source = item;
    try {
      const [probe, saved] = await Promise.all([
        api.get(`/api/cases/${caseId}/inspect/probe?path=${encodeURIComponent(item.path)}`).catch(() => ({ kind: item.kind })),
        api.get(`/api/cases/${caseId}/inspect/work?path=${encodeURIComponent(item.path)}`).then((r) => r.work),
      ]);
      if (run !== openRun) return;
      probeInfo = probe;
      if (saved) restore(saved, run);
      else seed();
      savedSignature = signature();
      clipHistory.reset(clipSnapshot());
      if (item.kind === 'video') {
        loadOverview(run);
        loadScenes(run);
      }
    } catch (e) {
      if (run === openRun) {
        toast(e.message, 'danger');
        closeFile();
      }
    } finally {
      if (run === openRun) opening = false;
    }
  }

  /** Back to the file list. Nothing is lost: what is pending is written first, and a
   *  work that cannot be saved stays open. */
  async function leave() {
    await autosave.flush();
    if (heldUnsaved()) return;
    closeFile();
    refreshWorks();
  }

  // -- renaming the file -----------------------------------------------------------
  // The field follows the file's name, and goes back to it when the one typed is
  // blank or abandoned with Escape. A rename moves the file on disk, and the work
  // with it, so the file is reopened under its new path.
  const fileLabel = $derived(work.source ? work.source.title || work.source.filename : '');
  let nameField = $state('');
  let renaming = $state(false);
  $effect(() => {
    nameField = fileLabel;
  });

  async function commitName() {
    const source = work.source;
    const typed = nameField.trim();
    if (!source || renaming || !typed || typed === fileLabel) {
      nameField = fileLabel;
      return;
    }
    renaming = true;
    try {
      await autosave.flush();
      if (autosave.state.status === 'error') throw new Error('The work is not saved yet. Retry, then rename the file');
      const at = shared.currentTime;
      const renamed = await api.patch(`/api/cases/${work.caseId}/media`, { path: source.path, title: typed });
      await open({ ...source, ...renamed });
      if (at) shared.seekTo = at;
      reloadCase();
    } catch (e) {
      nameField = fileLabel;
      toast(e.message, 'danger');
    } finally {
      renaming = false;
    }
  }

  function nameKey(e) {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') {
      nameField = fileLabel;
      e.currentTarget.blur();
    }
  }

  /** A file with nothing done to it: a video waits for frames, an image is its own. */
  function seed() {
    work.videoAdjust = adjustDefaults(videoFilters);
    if (!isVideo) {
      const frame = makeFrame(work.source.path, null);
      frame.url = fileUrl(work.caseId, work.source.path);
      work.frames = [frame];
      work.activeFrameId = frame.id;
    }
  }

  function restore(saved, run) {
    const spec = saved.spec;
    work.name = saved.name;
    work.videoAdjust = { ...adjustDefaults(videoFilters), ...(spec.videoAdjust ?? {}) };
    work.videoRotation = normalizeRightAngleRotation(spec.videoRotation);
    work.videoFiled = spec.videoFiled ?? null;
    work.frames = (spec.frames ?? []).map((f) => ({ ...f, adjust: { ...adjustDefaults(filters), ...(f.adjust ?? {}) }, url: null }));
    work.marks = (spec.marks ?? []).map((m) => ({ id: m.id, time: m.time, label: m.label ?? '' }));
    work.scenes = (spec.scenes ?? []).map((sc) => ({ id: sc.id, start: sc.start, end: sc.end, label: sc.label ?? '' }));
    if (!isVideo && !work.frames.length) {
      seed();
      return;
    }
    work.activeFrameId = work.frames.some((f) => f.id === spec.activeFrameId)
      ? spec.activeFrameId
      : isVideo ? null : work.frames[0].id;
    renderFrames(run);
  }

  /** Previews for a reopened work, a few at a time so the strip fills in as they land. */
  async function renderFrames(run) {
    const queue = [...work.frames];
    const next = async () => {
      while (queue.length) {
        const frame = queue.shift();
        try {
          const url = await frameUrl(frame);
          if (run !== openRun) return;
          frame.url = url;
          if (!frame.w || !frame.h) Object.assign(frame, await imageSize(url));
        } catch {
          if (run === openRun) frame.missing = true;
        }
      }
    };
    await Promise.all([next(), next(), next()]);
  }

  /** The pixels a frame is edited over: its source, turned. Adjust and crop are previewed on top. */
  function frameUrl(frame) {
    const ops = [...(frame.sourceOps ?? []), ...rotationOps(frame.rotation)];
    if (frame.time == null && !ops.length) return Promise.resolve(fileUrl(work.caseId, frame.path));
    return renderUrl(frame.path, frame.time, ops);
  }

  function makeFrame(path, time) {
    return {
      id: uid('fr'), path, time, url: null,
      adjust: adjustDefaults(filters), crop: null, sourceOps: [], rotation: 0,
      w: probeInfo?.width, h: probeInfo?.height, filed: null,
    };
  }

  // Handoffs: a file sent from the Media Library or Reverse Search, and a work
  // reopened from the sidebar, which is reopened on its file.
  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.inspectPath && mediaList.length) {
      const target = mediaList.find((m) => m.path === uiState.inspectPath);
      uiState.inspectPath = null;
      // a frame in a note opens its video at the instant it was cut (frame.opener.js)
      if (target) {
        open(target).then(() => {
          const time = takeSeek(target.path);
          if (time != null && work.source?.path === target.path) shared.seekTo = time;
        });
      }
    }
  });

  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.openInspect && mediaList.length) {
      const name = uiState.openInspect;
      uiState.openInspect = null;
      api.get(`/api/cases/${caseState.current.id}/inspect/works/${encodeURIComponent(name)}`)
        .then((saved) => {
          const target = mediaList.find((m) => m.path === saved.spec?.source?.path);
          if (target) open(target);
        })
        .catch((e) => toast(e.message, 'warn'));
    }
  });

  // -- rendering ------------------------------------------------------------------
  async function renderBlob(path, time, ops = [], format = 'png') {
    return (await renderResponse(path, time, ops, { format })).blob();
  }

  /**
   * One render. `snap` asks the server for the frame a player shows at `time`, and
   * the answer names that frame's own timestamp in `X-Frame-Time`.
   */
  async function renderResponse(path, time, ops = [], { format = 'png', snap = false } = {}) {
    const res = await fetch(`/api/cases/${work.caseId}/inspect/render-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, time: time ?? null, ops, format, ...(snap ? { snap: true } : {}) }),
    });
    if (!res.ok) {
      let detail = 'render failed';
      try {
        detail = detailLine((await res.json()).detail) || detail;
      } catch {
        /* non-json */
      }
      throw new Error(detail);
    }
    return res;
  }

  async function renderUrl(path, time, ops = []) {
    const url = URL.createObjectURL(await renderBlob(path, time, ops));
    blobs.add(url);
    return url;
  }

  function imageSize(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: probeInfo?.width || 320, h: probeInfo?.height || 240 });
      im.src = url;
    });
  }

  /**
   * Hand a frame to Reverse Search as it reads here, turned, adjusted and cropped,
   * without filing it. The crop is usually the subject, and an engine matches a
   * subject better than the whole picture it sits in.
   */
  async function reverseFrame(frame) {
    try {
      const blob = await renderBlob(frame.path, frame.time, buildFrameOps(filters, frame));
      const name = work.source?.title || work.source?.filename || frame.path.split('/').pop();
      openInReverseSearch({ blob, label: frame.time != null ? `${name} · t=${frame.time.toFixed(2)}s` : name });
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  /**
   * Lay a frame over the Horizon view, as filmed: the file itself at the
   * frame's moment, not its crop, so the lens is still the camera's.
   */
  function horizonFrame(frame) {
    const video = frame.time != null;
    openInHorizon({
      path: frame.path,
      kind: video ? 'video' : 'image',
      title: work.source?.title || work.source?.filename,
      ...(video ? { time: frame.time } : {}),
    });
  }

  // -- frames -----------------------------------------------------------------------
  /**
   * Cut the frame a player shows at `time`. The server names it by its own
   * timestamp, which is the time the frame keeps (`snap`). It joins the strip at
   * once and its picture follows, so captures can be taken as fast as the key is
   * pressed. Taking the frame a second time only points at it. Answers with the
   * frame in the strip, or nothing when none could be cut.
   */
  async function capture(time) {
    const sourceOps = rotationOps(videoRotation);
    const twinOf = (t, except = null) => work.frames.find((f) => f !== except && f.time != null && Math.abs(f.time - t) < 1e-4 && JSON.stringify(f.sourceOps ?? []) === JSON.stringify(sourceOps));
    const already = (twin) => toast(`This frame is already in the strip, at ${preciseClock(twin.time)}`, 'info', 2500);
    const twin = twinOf(time);
    if (twin) {
      already(twin);
      return twin;
    }
    // Two round trips, long enough on a slow video to switch file in between. The
    // frame is evidence, so a late one is dropped rather than put in another file.
    const run = openRun;
    const frame = makeFrame(work.source.path, time);
    frame.sourceOps = sourceOps;
    // frames cut from an adjusted clip start from its adjustments
    frame.adjust = videoSeed(filters, work.videoAdjust);
    work.frames.push(frame);
    const placed = work.frames[work.frames.length - 1];
    try {
      const res = await renderResponse(work.source.path, time, sourceOps, { snap: true });
      const named = Number(res.headers.get('X-Frame-Time'));
      const blob = await res.blob();
      if (run !== openRun) return;
      if (Number.isFinite(named) && res.headers.has('X-Frame-Time')) {
        const twin = twinOf(named, placed);
        if (twin) {
          // removed from the strip while it rendered, it is already gone
          const index = work.frames.indexOf(placed);
          if (index !== -1) work.frames.splice(index, 1);
          already(twin);
          return twin;
        }
        placed.time = named;
      }
      const url = URL.createObjectURL(blob);
      blobs.add(url);
      placed.url = url;
      const dim = await imageSize(url);
      if (run !== openRun) return;
      Object.assign(placed, { w: dim.w, h: dim.h });
      return placed;
    } catch (e) {
      if (run !== openRun) return;
      const index = work.frames.indexOf(placed);
      if (index !== -1) work.frames.splice(index, 1);
      toast(e.message, 'danger');
    }
  }

  /** The frame on screen, by the timestamp of the frame the browser drew. */
  const shownTime = () => shownFrameTime(shared.currentTime, probeInfo?.fps, shared.frameTime);

  function captureNow() {
    if (!isVideo) return;
    capture(captureMoment(shared.currentTime, shared.frameTime));
  }

  function select(id) {
    cropEditing = false;
    cropBefore = null;
    shared.cropMode = false;
    work.activeFrameId = id === 'video' ? null : id;
  }

  function removeFrame(id) {
    const index = work.frames.findIndex((f) => f.id === id);
    if (index === -1) return;
    const [frame] = work.frames.splice(index, 1);
    if (work.activeFrameId === id) {
      const neighbour = work.frames[Math.min(index, work.frames.length - 1)];
      work.activeFrameId = neighbour?.id ?? null;
    }
    const run = openRun;
    toast('Frame removed', 'info', 6000, {
      label: 'Undo',
      onClick: () => {
        if (run !== openRun || work.frames.some((f) => f.id === frame.id)) return;
        work.frames.splice(Math.min(index, work.frames.length), 0, frame);
        work.activeFrameId = frame.id;
      },
    });
  }

  function duplicateFrame(frame) {
    const index = work.frames.findIndex((f) => f.id === frame.id);
    const copy = {
      ...$state.snapshot(frame),
      id: uid('fr'),
      adjust: { ...frame.adjust },
      filed: null,
    };
    work.frames.splice(index + 1, 0, copy);
    select(copy.id);
  }

  let rotationBusy = $state(false);
  async function setFrameRotation(angle) {
    const frame = activeFrame;
    if (!frame || rotationBusy) return;
    const rotation = normalizeRightAngleRotation(angle);
    rotationBusy = true;
    try {
      const url = await frameUrl({ ...frame, rotation });
      const dim = await imageSize(url);
      if (!work.frames.includes(frame)) return;
      Object.assign(frame, { url, rotation, w: dim.w, h: dim.h });
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      rotationBusy = false;
    }
  }

  // -- crop: editing shows the original with a box; applying shows the result ------
  let cropEditing = $state(false);
  let cropBefore = null; // the crop editing opened on, which Escape puts back
  let frameAspect = $state(null);

  function beginCrop() {
    if (!activeFrame) return;
    cropBefore = activeFrame.crop ? { ...activeFrame.crop } : null;
    cropEditing = true;
    if (!activeFrame.crop) shared.cropMode = true;
  }
  function commitCrop() {
    cropEditing = false;
    shared.cropMode = false;
    cropBefore = null;
  }
  // Escape leaves crop editing the way it found it: a box drawn since beginCrop is
  // dropped rather than applied.
  function cancelCrop() {
    if (activeFrame) activeFrame.crop = cropBefore;
    commitCrop();
  }

  // -- video --------------------------------------------------------------------------
  // The bridge between the player and its panel: where the clip is, the timestamp
  // of the frame on screen, where to seek, and whether the frame viewer is drawing
  // a crop box.
  let shared = $state({ currentTime: 0, frameTime: null, seekTo: null, cropMode: false });
  let videoEl = $state();
  let player = $state();
  let holdOriginal = $state(false);
  const frameDur = $derived(frameDuration(probeInfo?.fps));

  /** Show the frame starting at `time`, from the panel or the strip. */
  function seekFrame(time) {
    videoEl?.pause();
    shared.seekTo = seekInto(time, probeInfo?.fps, probeInfo?.duration ?? 0);
  }

  // Keys on the open file. On the video: Space or K plays, ←/→ step one frame
  // (Shift a second, with mpv's , and . as aliases), J and L slow and speed it, + and
  // - zoom the bar's time, C captures, M marks. Holding O shows the picture without
  // its adjustments.
  function onWindowKeydown(e) {
    if (uiState.tool !== 'inspect' || !work.source || pickerOpen || clearConfirm || proofChooser) return;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (t.closest?.('[role="dialog"], [role="alertdialog"]')) return;
    // In the scenes drawer the player's keys still reach the frame, but a button
    // there answers its own Space and Enter.
    if (t.closest?.('[data-scene-panel]') && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && selected === 'video') {
      const k = e.key.toLowerCase();
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey);
      if ((k === 'z' && !e.shiftKey) || redo) {
        e.preventDefault();
        if (redo) redoClip();
        else undoClip();
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'o') {
      e.preventDefault();
      holdOriginal = true;
      return;
    }
    if (activeFrame && cropEditing) {
      if (key === 'Enter') { e.preventDefault(); commitCrop(); }
      else if (key === 'Escape') { e.preventDefault(); cancelCrop(); }
      return;
    }
    if (selected !== 'video' || !player) return;
    const actions = {
      ArrowLeft: () => player.stepBy(e.shiftKey ? -1 : -frameDur),
      ArrowRight: () => player.stepBy(e.shiftKey ? 1 : frameDur),
      ',': () => player.stepBy(-frameDur),
      '.': () => player.stepBy(frameDur),
      ' ': () => player.togglePlay(),
      k: () => player.togglePlay(),
      j: () => player.slower(),
      l: () => player.faster(),
      // the bar's time, zoomed about the playhead; = is + without Shift on many layouts
      '+': () => player.zoomBar(1),
      '=': () => player.zoomBar(1),
      '-': () => player.zoomBar(-1),
      c: () => !e.repeat && captureNow(),
      m: () => !e.repeat && addMark(),
      // While a scene's time is open, S and Shift+S move the start and end of the
      // moment in hand instead.
      s: () => {
        if (e.repeat) return;
        if (sceneEdit.scene) sceneHere(e.shiftKey ? 'end' : 'start');
        else if (e.shiftKey) endSceneHere();
        else addSceneHere();
      },
      ...(sceneEdit.scene ? { Enter: applySceneEdit } : {}),
      // Escape lets go of the time being changed first, then closes the drawer.
      ...(sceneEdit.scene ? { Escape: () => sceneEdit.close() } : scenesOpen ? { Escape: closeScenes } : {}),
    };
    const act = actions[key];
    if (!act) return;
    e.preventDefault();
    act();
  }

  function onWindowKeyup(e) {
    if (e.key.toLowerCase() === 'o') holdOriginal = false;
  }

  // -- what the server read off the clip ------------------------------------------------
  // The hover strip and the waveform come on their own once a video opens: one
  // keyframe-only decode and one audio decode, kept in the case's thumbnail cache.
  // The scan reads every frame, so it waits to be asked; what it found comes back
  // with the overview the next time the clip opens.
  let overview = $state(null); // { tiles, waveform, stripUrl }
  let scan = $state(null); // { frames, shots }
  let scanning = $state(false);
  let scanProgress = $state(null);

  async function pollJob(jobId, onprogress) {
    for (;;) {
      const job = await api.get(`/api/jobs/${jobId}`);
      if (job.status === 'done') return job.result;
      if (job.status === 'error') throw new Error(job.error);
      onprogress?.(job.progress?.percent ?? null);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function loadOverview(run) {
    const caseId = work.caseId;
    const path = work.source.path;
    try {
      const res = await api.post(`/api/cases/${caseId}/inspect/overview`, { path });
      if (run !== openRun) return;
      if (res?.scan) scan = res.scan;
      const found = res?.overview ?? (res?.job_id ? await pollJob(res.job_id) : null);
      if (run !== openRun || !found) return;
      overview = {
        tiles: found.tiles ?? null,
        waveform: found.waveform ?? null,
        stripUrl: found.tiles
          ? `/api/cases/${caseId}/inspect/overview/strip?path=${encodeURIComponent(path)}`
          : null,
      };
    } catch {
      // without ffmpeg, or on a file it cannot read, the bar is simply plainer
    }
  }

  async function runScan() {
    if (!isVideo || scanning) return;
    const run = openRun;
    scanning = true;
    scanProgress = null;
    try {
      const { job_id } = await api.post(`/api/cases/${work.caseId}/inspect/suggest`, { path: work.source.path, count: 12 });
      const result = await pollJob(job_id, (p) => {
        if (run === openRun) scanProgress = p;
      });
      if (run === openRun) scan = { frames: result.frames ?? [], shots: result.shots ?? [] };
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
    } finally {
      if (run === openRun) scanning = false;
    }
  }

  // -- scenes -------------------------------------------------------------------------
  // Where in the clip each geolocation happens (`lib/scenes.js`): an instant, or a
  // passage once it has an end. The proofs resting on the clip come from the server;
  // the drafts are this work's own. A draft a proof has taken up stays in the work,
  // hidden while that proof is in the case, so deleting the proof gives it back.
  let listedScenes = $state([]);
  let takenScenes = $state([]);
  const scenes = $derived(sceneList(listedScenes, work.scenes, takenScenes));
  // The proofs laying out each saved frame of the clip, by the frame's path.
  let usedFrames = $state({});
  // What the strip marks on a frame: the scenes it falls in, and the proofs using it.
  const frameDots = $derived(isVideo ? frameScenes(work.frames, scenes, frameDur) : new Map());
  const frameUsed = $derived(isVideo ? frameUses(work.frames, usedFrames) : new Map());

  // The scene whose time is open (`lib/sceneEdit.svelte.js`). The bar draws it as
  // its fields read, with handles, before anything is kept.
  const sceneEdit = new SceneEdit(() => ({ duration: probeInfo?.duration ?? 0, fps: probeInfo?.fps ?? null }));
  // The drawer beside the video that lists them. Closed whenever a file opens, and
  // never remembered.
  let scenesOpen = $state(false);
  const sceneMarksOnBar = $derived.by(() => {
    const held = sceneEdit.scene && scenes.find((sc) => sc.key === sceneEdit.key);
    if (!held) return sceneMarks(scenes);
    // the scene in hand as its fields read: each moment that reads as a time, by its line
    const label = sceneTitle(held);
    const edited = sceneEdit.moments.flatMap((m, i) =>
      m.start == null ? [] : [{ key: momentKey(held, i), start: m.start, end: isStretch(m) && m.passage ? m.end : null, color: held.color, label }],
    );
    return [...sceneMarks(scenes.filter((sc) => sc.key !== held.key)), ...edited];
  });
  const sceneOnBar = $derived.by(() => {
    const held = sceneEdit.scene && scenes.find((sc) => sc.key === sceneEdit.key);
    return held && sceneEdit.start != null
      ? { key: sceneEdit.activeKey, start: sceneEdit.start, end: sceneEdit.end, color: held.color }
      : null;
  });
  // A scene that leaves the list (removed, undone, its proof gone) takes its time with it.
  $effect(() => {
    if (sceneEdit.key && !scenes.some((sc) => sc.key === sceneEdit.key)) sceneEdit.close();
  });

  async function loadScenes(run) {
    const path = work.source?.path;
    if (!path || !isVideo) return;
    try {
      const res = await api.get(`/api/cases/${work.caseId}/scenes?video=${encodeURIComponent(path)}`);
      if (run !== openRun) return;
      listedScenes = res.scenes ?? [];
      takenScenes = res.taken ?? [];
      usedFrames = res.used ?? {};
    } catch {
      // the list is a reading: without it the drafts still show, and a reopen asks again
    }
  }

  // Coming back to Inspect reads the list again: a proof saved meanwhile joins it.
  $effect(() => {
    if (uiState.tool === 'inspect' && isVideo && !opening) untrack(() => loadScenes(openRun));
  });

  /** Record the clip as it now stands, and say how to take this step back. */
  function clipChanged(message) {
    const after = clipSnapshot();
    clipHistory.push(after);
    const run = openRun;
    toast(message, 'info', 6000, {
      label: 'Undo',
      onClick: () => {
        if (run === openRun && clipSnapshot() === after) undoClip();
      },
    });
  }

  function restoreClip(snapshot) {
    if (!snapshot) return false;
    const state = JSON.parse(snapshot);
    work.scenes = state.scenes;
    work.marks = state.marks;
    return true;
  }
  const undoClip = () => restoreClip(clipHistory.undo());
  const redoClip = () => restoreClip(clipHistory.redo());

  function keepScene(stretch, message) {
    if (!stretch) return null;
    const scene = newScene(stretch);
    work.scenes.push(scene);
    clipChanged(message(scene));
    return scene;
  }

  /** A scene at the frame on screen (S). */
  function addSceneHere() {
    if (!isVideo) return;
    keepScene({ start: shownTime() }, (scene) => `Scene kept at ${sceneTime(scene)}`);
  }

  const keepShotScene = (index) =>
    keepScene(stretchFromShot(scan?.shots, index, probeInfo?.duration ?? 0), (scene) => `Shot kept as a scene, ${sceneTime(scene)}`);

  /** End a scene at the frame on screen: the one named, else the latest started before it (Shift+S). */
  function endSceneHere(id = null) {
    const now = shownTime() + frameDur;
    const target = id ? work.scenes.find((sc) => sc.id === id) : sceneToEnd(scenes, now);
    const scene = target && work.scenes.find((sc) => sc.id === target.id);
    if (!scene || scene.start == null) return;
    if (!(now > scene.start)) {
      toast('Go past the start of the scene to end it here', 'warn');
      return;
    }
    scene.end = now;
    clipChanged(`Scene ends at ${sceneTime(scene).split('–')[1]}`);
  }

  function playScene(scene) {
    const loop = scenePassage(scene);
    if (loop) {
      player?.playStretch(loop.start, loop.end);
      return;
    }
    const start = sceneStart(scene);
    if (start != null) seekFrame(start);
  }

  function labelScene(id, label) {
    const scene = work.scenes.find((sc) => sc.id === id);
    if (scene) scene.label = label;
  }

  function removeScene(id) {
    const index = work.scenes.findIndex((sc) => sc.id === id);
    if (index === -1) return;
    work.scenes.splice(index, 1);
    clipChanged('Scene removed');
  }

  function openSceneProof(scene) {
    if (!scene?.proof) return;
    uiState.openProof = scene.proof;
    uiState.tool = 'proof';
  }

  // -- a scene's time, changed --------------------------------------------------------
  // Pressing a scene's time in the drawer goes there and opens it (`lib/sceneEdit`).
  // Apply or Enter keeps it, and so does closing the drawer or opening another time
  // when it reads as one. A draft's new time joins the clip's history like any other
  // change to it; a proof's moments are written to the proof
  // (`PUT /cases/{id}/proofs/{name}/scene`) and its toast takes them back.

  function toggleScenes() {
    if (scenesOpen) closeScenes();
    else scenesOpen = true;
  }

  function closeScenes() {
    leaveSceneEdit();
    scenesOpen = false;
  }

  function editSceneTime(scene) {
    const again = sceneEdit.key === scene.key;
    leaveSceneEdit();
    // its time pressed again folds it, kept like closing the drawer
    if (again) return;
    const start = sceneStart(scene);
    if (start != null) seekFrame(start);
    sceneEdit.begin(scene);
  }

  /** The frame on screen, and the end of it: where a new moment starts, and a passage ends. */
  const frameNow = () => ({ start: shownTime(), end: shownTime() + frameDur });

  /**
   * The frame on screen as a moment's start, or the end of it as its end (S, Shift+S).
   * A scene about the whole video gets a moment there.
   */
  function sceneHere(which, index = sceneEdit.active) {
    if (sceneEdit.whole) sceneEdit.setKind('instant', frameNow());
    sceneEdit.activate(index);
    if (which === 'end') sceneEdit.setEnd(frameNow().end);
    else sceneEdit.setStart(frameNow().start);
  }

  const sceneKind = (kind) => sceneEdit.setKind(kind, frameNow());
  const addMoment = () => sceneEdit.add(frameNow().start);

  /** Move one end of a moment a frame, or a second, and show the frame it lands on. */
  function nudgeScene(which, direction, wholeSecond, index = sceneEdit.active) {
    sceneEdit.activate(index);
    const from = which === 'end' ? sceneEdit.end : sceneEdit.start;
    if (from == null) return;
    const time = Math.max(0, snapToFrame(from + direction * (wholeSecond ? 1 : frameDur), probeInfo?.fps));
    if (which === 'end') {
      if (!(time > (sceneEdit.start ?? 0))) return;
      sceneEdit.setEnd(time);
      seekFrame(time - frameDur);
    } else {
      sceneEdit.setStart(time);
      seekFrame(time);
    }
  }

  /** Where a handle dragged on the bar put the start or the end of the moment in hand. */
  function dragScene(which, time) {
    if (which === 'end') sceneEdit.setEnd(time);
    else sceneEdit.setStart(time);
  }

  async function applySceneEdit() {
    const scene = sceneEdit.scene;
    const time = sceneEdit.result;
    if (!scene || !time) return;
    const changed = sceneEdit.changed;
    sceneEdit.close();
    if (!changed) return;
    if (scene.kind === 'proof') {
      await timeProof(scene, time.moments);
      return;
    }
    const draft = work.scenes.find((sc) => sc.id === scene.id);
    if (!draft) return;
    draft.start = time.start;
    draft.end = time.end;
    clipChanged(`Scene now ${timeWords(time.start == null ? [] : [time])}`);
  }

  /** Letting go of a time by closing the drawer or opening another keeps it when it reads as one. */
  function leaveSceneEdit() {
    if (sceneEdit.result && sceneEdit.changed) applySceneEdit();
    else sceneEdit.close();
  }

  async function timeProof(scene, moments, undoable = true) {
    const run = openRun;
    const before = (scene.moments ?? []).map(({ start, end }) => ({ start, end: end ?? null }));
    let res;
    try {
      res = await api.put(`/api/cases/${work.caseId}/proofs/${encodeURIComponent(scene.proof)}/scene`, { moments });
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    }
    if (run !== openRun) return;
    const ours = (sc) => sc.kind === 'proof' && sc.proof === scene.proof;
    listedScenes = listedScenes.map((sc) =>
      ours(sc) ? { ...sc, moments: res.moments, at: res.at, stated: res.stated } : sc,
    );
    toast(`“${scene.title || scene.proof}” is now ${timeWords(res.moments)}`, 'info', 6000, undoable ? {
      label: 'Undo',
      onClick: () => {
        const now = listedScenes.find(ours);
        // only while nothing has moved it since
        if (run === openRun && now && sameMoments(now.moments, res.moments)) timeProof(now, before, false);
      },
    } : null);
    loadScenes(run);
  }

  // -- a scene's proof ------------------------------------------------------------------
  // Make the proof, on a scene to geolocate: its frames, all ticked, to start the
  // proof from (`lib/sceneFrames.js`). A scene holding none captures one, the sharpest
  // a scan found in it, else the one it starts on. Frames not in the case are saved
  // on the way, with their default names and the last folder, then Geo Proof opens a
  // proof of the scene on them (`uiState.proofScene`).
  let proofChooser = $state(null); // { scene, ids, capture }
  let makingProof = $state(false);
  const chooserFrames = $derived(
    proofChooser ? proofChooser.ids.map((id) => work.frames.find((f) => f.id === id)).filter(Boolean) : [],
  );

  function makeProof(scene) {
    if (scene?.kind !== 'draft' || !isVideo || makingProof) return;
    const frames = framesOfScene(scene, work.frames, frameDur);
    proofChooser = {
      scene,
      ids: frames.map((f) => f.id),
      capture: frames.length ? null : frameToCapture(scene, { scan, now: shownTime(), frame: frameDur }),
    };
  }

  async function confirmProof(ids) {
    const chooser = proofChooser;
    if (!chooser || makingProof) return;
    const run = openRun;
    makingProof = true;
    try {
      let frames = work.frames.filter((f) => ids.includes(f.id)).sort((a, b) => a.time - b.time);
      if (chooser.capture) {
        const cut = await capture(chooser.capture.time);
        if (!cut || run !== openRun) return;
        frames = [cut];
      }
      if (!frames.length) return;
      if (frames.some((f) => savingFrames.has(f.id))) throw new Error('A frame is being saved. Try again in a moment');
      const unsaved = frames.filter((f) => !filedIds.has(f.id));
      if (unsaved.length) {
        markSaving(unsaved, true);
        try {
          await saveFrames(unsaved, { folder: lastFolder(), note: null, names: unsaved.map((f) => frameNames.get(f.id)) });
        } finally {
          markSaving(unsaved, false);
        }
      }
      if (run !== openRun) return;
      const panels = frames.map((f) => f.filed?.path);
      if (!panels.every(Boolean)) throw new Error('A frame could not be saved to the case');
      proofChooser = null;
      uiState.proofScene = proofHandoff(chooser.scene, work.source.path, panels);
      uiState.tool = 'proof';
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
    } finally {
      makingProof = false;
    }
  }

  // -- marks --------------------------------------------------------------------------
  let focusMarkId = $state(null);

  function addMark() {
    if (!isVideo) return;
    const mark = { id: uid('mk'), time: shownTime(), label: '' };
    work.marks.push(mark);
    clipHistory.push(clipSnapshot());
    focusMarkId = mark.id;
    tabs.video = 'moments';
  }

  function removeMark(id) {
    const index = work.marks.findIndex((m) => m.id === id);
    if (index === -1) return;
    work.marks.splice(index, 1);
    clipChanged('Mark removed');
  }

  // -- a frame's adjusted picture, when CSS cannot show it --------------------------------
  // Brightness, contrast and the like preview in the browser. Sharpness, gamma, local
  // contrast and denoise have no CSS twin, so once one is set the server renders the
  // frame as it will save, a moment after the sliders stop.
  let rendered = $state(null); // { frameId, key, url }
  let renderTimer = null;
  const renderKey = $derived(
    activeFrame?.url && needsRender(filters, activeFrame.adjust) ? JSON.stringify(previewOps(filters, activeFrame)) : null
  );
  const frameSrc = $derived(renderKey && rendered?.frameId === activeFrame?.id ? rendered.url : null);
  const renderPending = $derived(!!renderKey && rendered?.key !== renderKey);

  function dropRendered() {
    clearTimeout(renderTimer);
    if (rendered?.url) URL.revokeObjectURL(rendered.url);
    rendered = null;
  }

  $effect(() => {
    const key = renderKey;
    const frame = activeFrame;
    clearTimeout(renderTimer);
    if (!key || !frame || (rendered?.frameId === frame.id && rendered.key === key)) return;
    const run = openRun;
    renderTimer = setTimeout(async () => {
      try {
        const blob = await renderBlob(frame.path, frame.time, previewOps(filters, frame), 'jpeg');
        if (run !== openRun || renderKey !== key) return;
        const url = URL.createObjectURL(blob);
        if (rendered?.url) URL.revokeObjectURL(rendered.url);
        rendered = { frameId: frame.id, key, url };
      } catch {
        // the CSS preview stays, and Save to case still renders it in full
      }
    }, 250);
  });

  // -- readings on a frame ------------------------------------------------------------
  let analysis = $state(null); // { id, frameId, signature, kind, url, rows, text, note, shown, opacity }
  let analysisRunning = $state(null);
  const frameAnalysis = $derived(analysis && analysis.frameId === activeFrame?.id ? analysis : null);
  const analysisCurrent = $derived(!!frameAnalysis && frameAnalysis.signature === frameSignature(filters, activeFrame));
  const overlay = $derived(
    analysisCurrent && frameAnalysis.kind === 'image' && frameAnalysis.shown
      ? { url: frameAnalysis.url, opacity: frameAnalysis.opacity }
      : null
  );

  async function runAnalysis(name) {
    const frame = activeFrame;
    if (!frame || analysisRunning) return;
    analysisRunning = name;
    const run = openRun;
    try {
      const res = await api.post(`/api/cases/${work.caseId}/inspect/analyze`, {
        path: frame.path, name, time: frame.time ?? null, ops: buildFrameOps(filters, frame),
      });
      if (run !== openRun) return;
      analysis = {
        id: name, frameId: frame.id, signature: frameSignature(filters, frame), kind: res.kind,
        url: res.data_url ?? null, rows: res.rows ?? null, text: res.text ?? null, note: res.note ?? '',
        shown: true, opacity: 0.85,
      };
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      analysisRunning = null;
    }
  }

  // -- the panel ----------------------------------------------------------------------
  // The one press every visit needs stays pinned above the tabs: Capture frame on the
  // video, Save to case on a frame. The tabs hold the rest, and keep their place for
  // the session.
  const tabs = $state({ video: 'info', frame: 'adjust' });
  const panelHelpers = panelWidth({ key: 'azimut:inspectPanelW', min: 300, max: 560, def: 340, fraction: 0.4 });
  let panelW = $state(panelHelpers.loadWidth());
  const unfiledCount = $derived(work.frames.filter((f) => !filedIds.has(f.id) && !savingFrames.has(f.id) && f.url).length);
  const frameTouched = $derived(
    !!activeFrame && (!!activeFrame.crop || !!activeFrame.rotation || !isNeutral(filters, activeFrame.adjust))
  );
  const panelTabs = $derived(
    selected === 'video'
      ? [
          { id: 'info', label: 'Info', title: INSPECT_HELP.tabInfo },
          { id: 'adjust', label: 'Adjust', title: INSPECT_HELP.tabAdjust, dot: videoEdited },
          { id: 'moments', label: 'Moments', title: INSPECT_HELP.tabMoments, count: work.marks.length },
        ]
      : [
          { id: 'info', label: 'Info', title: INSPECT_HELP.tabInfo },
          { id: 'adjust', label: 'Adjust', title: INSPECT_HELP.tabAdjust, dot: frameTouched },
          { id: 'analyze', label: 'Analyze', title: INSPECT_HELP.tabAnalyze, dot: !!overlay },
        ]
  );
  const mode = $derived(selected === 'video' ? 'video' : 'frame');

  // -- save to case: the one step that files media ------------------------------------
  function dupeNote(results) {
    const dupes = results.filter((r) => r?.duplicate).length;
    if (!dupes) return '';
    return dupes === 1 ? '. It matched media already in the case, which was renamed' : `. ${dupes} matched media already in the case and were renamed`;
  }

  async function afterFiling() {
    await reloadCase();
    await refresh();
  }

  async function saveFrames(frames, { folder, note, names }) {
    const cid = work.caseId;
    const items = frames.map((f, i) => ({
      path: f.path, time: f.time ?? null, ops: buildFrameOps(filters, f), label: names[i],
    }));
    const res = await api.post(`/api/cases/${cid}/inspect/save-frames`, { items, folder, notes: note });
    const saved = res?.saved ?? [];
    frames.forEach((f, i) => {
      const path = saved[i]?.item?.path;
      if (path) f.filed = { path, signature: frameSignature(filters, f) };
    });
    await afterFiling();
    return saved;
  }

  // Several saves can run at once (the strip saves a frame in one press), so each
  // frame is marked busy on its own and a save-all leaves out those already going.
  function markSaving(frames, busy) {
    const ids = new Set(savingFrames);
    for (const f of frames) busy ? ids.add(f.id) : ids.delete(f.id);
    savingFrames = ids;
  }

  // as in SaveToCase: Unfiled has to be sent when the work folder filed the frame
  const lastFolder = () => saveFolder || (workFolder() ? '' : null);

  async function saveFrame(frame, { name, folder, note }) {
    saveFolder = folder ?? '';
    markSaving([frame], true);
    try {
      const saved = await saveFrames([frame], { folder, note, names: [name] });
      toast(`Saved “${name}” to the case${dupeNote(saved)}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      markSaving([frame], false);
    }
  }

  /** The strip's save press: the default name and the last folder, nothing asked. */
  function quickSaveFrame(id) {
    const frame = work.frames.find((f) => f.id === id);
    if (!frame?.url || savingFrames.has(id) || filedIds.has(id)) return;
    saveFrame(frame, { name: frameNames.get(id), folder: lastFolder(), note: null });
  }

  async function saveAllFrames() {
    const frames = work.frames.filter((f) => !filedIds.has(f.id) && f.url && !savingFrames.has(f.id));
    if (!frames.length) return;
    saving = 'all';
    markSaving(frames, true);
    try {
      const saved = await saveFrames(frames, {
        folder: lastFolder(), note: null, names: frames.map((f) => frameNames.get(f.id)),
      });
      toast(`Saved ${frames.length} frames to the case${dupeNote(saved)}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = null;
      markSaving(frames, false);
    }
  }

  async function saveVideo({ name, folder, note }) {
    saving = 'video';
    saveFolder = folder ?? '';
    const signatureNow = videoSignature(videoFilters, work.videoAdjust, videoRotation);
    try {
      const res = await api.post(`/api/cases/${work.caseId}/inspect/enhance-video`, {
        path: work.source.path, params: work.videoAdjust, rotation: videoRotation, folder,
        label: name, notes: note,
      });
      if (res?.item?.path) work.videoFiled = { path: res.item.path, signature: signatureNow };
      await afterFiling();
      toast(`Saved “${name}” to the case${dupeNote([res])}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = null;
    }
  }

  // -- into the note pinned beside ------------------------------------------------------
  // "This frame" cites the frame as a case file: already saved and unchanged, it is
  // cited as it is; otherwise Save to case files it first, with the default name and
  // the last folder, as the strip's one-press save does.
  async function fileForNote(frame) {
    if (filedIds.has(frame.id)) {
      const entity = await lookupEntity(work.caseId, 'path', frame.filed.path);
      if (entity) return { entity, fresh: false };
    }
    if (!frame.url) throw new Error('The frame is still rendering');
    if (savingFrames.has(frame.id)) throw new Error('The frame is being saved. Try again in a moment');
    markSaving([frame], true);
    try {
      const [saved] = await saveFrames([frame], { folder: lastFolder(), note: null, names: [frameNames.get(frame.id)] });
      // A frame that matched media already in the case was not filed for the note.
      return { entity: saved?.entity ?? null, fresh: !saved?.duplicate };
    } finally {
      markSaving([frame], false);
    }
  }

  const noteFrame = frameOffer({
    frame: () => activeFrame,
    name: (frame) => frameNames.get(frame.id),
    file: fileForNote,
  });
  offerPuts('inspect', () => (activeFrame ? [noteFrame] : []));

  // -- clearing -------------------------------------------------------------------------
  async function clearWork() {
    clearConfirm = false;
    autosave.cancel();
    const source = work.source;
    const caseId = work.caseId;
    if (work.name) {
      try {
        const result = await api.del(`/api/cases/${caseId}/inspect/work?path=${encodeURIComponent(source.path)}`);
        deletedToast(caseId, result, work.name);
      } catch (e) {
        toast(e.message, 'danger');
        return;
      }
    }
    await open(source);
    // Collage offers this work's frames, and the sidebar lists the work itself.
    workState.rev += 1;
    reloadCase();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onkeyup={onWindowKeyup} onblur={() => (holdOriginal = false)} {onpagehide} />

<div class="tool">
  {#if work.source}
    <div class="tool-header">
      <BackButton label="Files" title="Back to the file list" onclick={leave} />
      <span class="file">
        <Icon name={isVideo ? 'video' : 'image'} size={14} />
        <input
          class="input file-name"
          dir="auto"
          bind:value={nameField}
          onblur={commitName}
          onkeydown={nameKey}
          disabled={renaming}
          maxlength="200"
          aria-label="File name"
          title="Rename the file"
        />
      </span>
      {#if status === 'saving'}
        <span class="status">Saving…</span>
      {:else if status === 'saved'}
        <span class="status"><Icon name="check" size={12} /> Saved</span>
      {:else if status === 'error'}
        <span class="status error" title={autosave.state.error}><Icon name="alert" size={12} /> Not saved</span>
        <button class="btn btn-ghost btn-xs" onclick={() => autosave.flush()}>Retry</button>
      {/if}
      <div class="spacer"></div>
      {#if work.name || !pristine}
        <button class="btn btn-ghost btn-sm" data-guide="inspect.file" onclick={() => (clearConfirm = true)} title="Send this file's frames and edits to the Trash">
          <Icon name="reset" size={14} /> Clear work
        </button>
      {/if}
      <button class="btn btn-sm" data-guide="inspect.file" onclick={() => (pickerOpen = true)} title="Open another image or video">
        <Icon name="folderOpen" size={14} /> Change file
      </button>
    </div>
  {/if}

  {#if !caseState.current}
    <NoCase icon="inspect" what="inspect its pictures and videos" />
  {:else if !work.source}
    {#if inspectable.length === 0}
      <div class="empty">
        <Icon name="inspect" size={40} />
        <p>Add an image or a video to the case to inspect it.</p>
        <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media</button>
      </div>
    {:else}
      <div class="start">
        <div class="start-col">
          <div class="start-head">
            <h3>Open a file</h3>
            <p>Frames and edits are kept with the file, so opening it again picks up where you left off.</p>
          </div>
          <SourcePicker media={inspectable} {works} caseId={caseState.current.id} onpick={open} />
        </div>
      </div>
    {/if}
  {:else}
    <div class="workspace">
      <div class="stage">
        <div class="viewer" class:pad={selected !== 'video'}>
          {#if opening}
            <span class="spinner" aria-label="Opening"></span>
          {:else if selected === 'video'}
            <VideoPlayer
              bind:this={player}
              bind:video={videoEl}
              src={fileUrl(work.caseId, work.source.path)}
              filter={videoPreview.filter}
              transform={videoTransform}
              quarterTurn={Math.abs(videoRotation) === 90}
              duration={probeInfo?.duration ?? 0}
              fps={probeInfo?.fps ?? null}
              bind:shared
              frames={work.frames.filter((f) => f.time != null)}
              marks={work.marks}
              shots={scan?.shots ?? []}
              picks={scan?.frames ?? []}
              scenes={sceneMarksOnBar}
              tiles={overview?.tiles ?? null}
              stripUrl={overview?.stripUrl ?? null}
              waveform={overview?.waveform ?? null}
              original={holdOriginal}
              oncapture={captureNow}
              editing={sceneOnBar}
              onedit={dragScene}
            >
              {#snippet tools()}
                <SceneButton {scenes} open={scenesOpen} onclick={toggleScenes} />
              {/snippet}
              {#snippet side()}
                {#if scenesOpen}
                  <ScenePanel
                    {scenes}
                    edit={sceneEdit}
                    onadd={addSceneHere}
                    onplay={playScene}
                    onlabel={labelScene}
                    onend={endSceneHere}
                    onremove={removeScene}
                    onopenproof={openSceneProof}
                    onmakeproof={makeProof}
                    onedit={editSceneTime}
                    onhere={sceneHere}
                    onkind={sceneKind}
                    onnudge={nudgeScene}
                    onaddmoment={addMoment}
                    onapply={applySceneEdit}
                    oncancel={() => sceneEdit.close()}
                    onleave={leaveSceneEdit}
                    onclose={closeScenes}
                  />
                {/if}
              {/snippet}
            </VideoPlayer>
          {:else if activeFrame?.url}
            <FrameViewer
              frame={activeFrame}
              preview={framePreview}
              src={frameSrc}
              original={holdOriginal}
              {overlay}
              aspect={frameAspect}
              {cropEditing}
              bind:cropMode={shared.cropMode}
              onbegincrop={beginCrop}
              oncommitcrop={commitCrop}
            />
            {#if renderPending}<span class="rendering" aria-live="polite"><span class="spinner small"></span> Rendering…</span>{/if}
          {:else if activeFrame?.missing}
            <div class="hint-mid">
              <Icon name="alert" size={30} />
              <p>This frame could not be rendered from its file.</p>
            </div>
          {:else}
            <span class="spinner" aria-label="Rendering"></span>
          {/if}
        </div>
        {#if !opening && (isVideo || work.frames.length > 1)}
          <FrameStrip
            source={work.source}
            sourceThumb={work.source.thumbnail ? fileUrl(work.caseId, work.source.thumbnail) : null}
            frames={work.frames}
            {selected}
            {filters}
            {filedIds}
            busyIds={savingFrames}
            removable={isVideo || work.frames.length > 1}
            savingAll={saving === 'all'}
            onselect={select}
            onremove={removeFrame}
            onsave={quickSaveFrame}
            onsaveall={saveAllFrames}
            dots={frameDots}
            uses={frameUsed}
          />
        {/if}
      </div>

      <aside class="panel" style:width={`${panelW}px`} data-guide="inspect.panel">
        <PanelEdge bind:width={panelW} helpers={panelHelpers} side="left" label={INSPECT_HELP.resize} />
        {#if opening}
          <p class="hint">Opening…</p>
        {:else if selected === 'video' || activeFrame}
          <div class="pinned">
            {#if selected === 'video'}
              <button class="btn btn-primary capture" data-guide="inspect.capture" onclick={captureNow} title={INSPECT_HELP.capture}>
                <Icon name="camera" size={16} />
                <span>Capture frame</span>
                <span class="at mono">{preciseClock(shownFrameTime(shared.currentTime, probeInfo?.fps, shared.frameTime))}</span>
                <kbd>C</kbd>
              </button>
              <button class="btn btn-sm scene-here" data-guide="inspect.scene" onclick={addSceneHere} title={INSPECT_HELP.sceneHere}>
                <Icon name="pin" size={13} />
                <span>Scene here</span>
                {#if scenes.length}<span class="scene-count">{scenes.length} in this video</span>{/if}
                <kbd>S</kbd>
              </button>
              {#if unfiledCount}
                <button class="btn btn-sm save-frames" data-guide="inspect.save" disabled={saving === 'all'} onclick={saveAllFrames} title={INSPECT_HELP.saveAll}>
                  <Icon name="save" size={13} />
                  {saving === 'all' ? 'Saving…' : unfiledCount === 1 ? 'Save the frame to the case' : `Save ${unfiledCount} frames to the case`}
                </button>
              {/if}
            {:else}
              {#key activeFrame.id}
                <SaveToCase
                  defaultName={frameNames.get(activeFrame.id)}
                  filedPath={filedIds.has(activeFrame.id) ? activeFrame.filed.path : null}
                  busy={savingFrames.has(activeFrame.id)}
                  blocked={activeFrame.url ? '' : 'The frame is still rendering.'}
                  bind:folder={saveFolder}
                  onsave={(opts) => saveFrame(activeFrame, opts)}
                >
                  <PutInNote offer={noteFrame} class="btn btn-sm" role="button" />
                </SaveToCase>
              {/key}
            {/if}
          </div>

          <div class="ptabs" role="tablist" aria-label="Panel" data-guide="inspect.tabs">
            {#each panelTabs as t (t.id)}
              <button
                class="ptab"
                class:on={tabs[mode] === t.id}
                role="tab"
                aria-selected={tabs[mode] === t.id}
                title={t.title}
                onclick={() => (tabs[mode] = t.id)}
              >
                {t.label}
                {#if t.count}<span class="count">{t.count}</span>{:else if t.dot}<span class="dot"></span>{/if}
              </button>
            {/each}
          </div>

          <div class="tab-body" role="tabpanel">
            {#if tabs[mode] === 'info'}
              <InfoPanel caseId={work.caseId} source={work.source} probe={probeInfo} frame={selected === 'video' ? null : activeFrame} />
            {:else if selected === 'video' && tabs.video === 'adjust'}
              <VideoAdjust
                {videoFilters} {work}
                video={videoEl}
                filter={holdOriginal ? '' : videoPreview.filter}
                tick={shared.frameTime ?? shared.currentTime}
                {videoEdited}
                onhold={(on) => (holdOriginal = on)}
                videoSave={{
                  defaultName: `${stemFor(work.source.path)} (enhanced)`,
                  filedPath: videoFiled ? work.videoFiled.path : null,
                  busy: saving === 'video',
                  onsave: saveVideo,
                }}
                bind:folder={saveFolder}
              />
            {:else if selected === 'video'}
              <MomentsPanel
                duration={probeInfo?.duration ?? 0}
                onkeepshot={keepShotScene}
                bind:marks={work.marks}
                focusId={focusMarkId}
                onaddmark={addMark}
                onremovemark={removeMark}
                onseek={seekFrame}
                oncapture={capture}
                {scan}
                {scanning}
                progress={scanProgress}
                onscan={runScan}
                tiles={overview?.tiles ?? null}
                stripUrl={overview?.stripUrl ?? null}
              />
            {:else if tabs.frame === 'adjust'}
              {#key activeFrame.id}
                <FrameAdjust
                  frame={activeFrame} {filters} {shared}
                  shown={{ url: frameSrc ?? activeFrame.url, filter: frameSrc ? '' : framePreview.filter }}
                  bind:cropAspect={frameAspect} bind:cropEditing {beginCrop} {commitCrop}
                  setRotation={setFrameRotation} {rotationBusy}
                  onduplicate={duplicateFrame}
                  onhold={(on) => (holdOriginal = on)}
                />
              {/key}
            {:else}
              <FrameAnalyze
                frame={activeFrame}
                {analyses}
                analysis={frameAnalysis}
                current={analysisCurrent}
                running={analysisRunning}
                onrun={runAnalysis}
                reverse={reverseFrame}
                horizon={horizonFrame}
              />
            {/if}
          </div>
        {/if}
      </aside>
    </div>
  {/if}

  {#if pickerOpen && caseState.current}
    <Modal title="Open a file" width="720px" onclose={() => (pickerOpen = false)}>
      <SourcePicker media={inspectable} {works} caseId={caseState.current.id} current={work.source?.path} onpick={open} />
    </Modal>
  {/if}

  {#if proofChooser}
    <ProofFrames
      scene={proofChooser.scene}
      frames={chooserFrames}
      {filters}
      {filedIds}
      capture={proofChooser.capture}
      busy={makingProof}
      onconfirm={confirmProof}
      oncancel={() => (proofChooser = null)}
    />
  {/if}

  {#if clearConfirm}
    <ConfirmDialog
      title="Clear the work on this file?"
      message="Its frames and edits go to the Trash."
      detail="Media already saved to the case stays where it is."
      impact={work.name ? { caseId: work.caseId, named: [{ tool: 'inspect', name: work.source?.path }] } : null}
      confirmLabel="Clear work"
      tone="danger"
      icon="reset"
      onconfirm={clearWork}
      oncancel={() => (clearConfirm = false)}
    />
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
    align-items: center;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 420px;
    min-width: 0;
    color: var(--text-2);
  }
  .file-name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .status.error {
    color: var(--danger);
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
  /* The whole panel scrolls and the column sits centred in it, so the wheel works
     over the margins and the scrollbar stays on the edge. */
  .start {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .start-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .start-head h3 {
    font-size: var(--fs-md);
    font-weight: 700;
    margin: 0 0 4px;
  }
  .start-head p {
    margin: 0;
    color: var(--text-3);
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
  .workspace {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .stage {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .viewer {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    overflow: auto;
  }
  .viewer.pad {
    padding: 18px;
  }
  .rendering {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: var(--r-sm);
    background: rgba(22, 22, 22, 0.85);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .spinner.small {
    width: 11px;
    height: 11px;
    border-width: 2px;
  }
  .panel {
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .panel > .hint {
    padding: 14px;
  }
  /* The press every visit needs, above the tabs, never scrolled away. */
  .pinned {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--border);
  }
  .capture {
    width: 100%;
    justify-content: center;
    gap: 8px;
    min-height: 36px;
  }
  .capture .at {
    font-size: var(--fs-xs);
    opacity: 0.75;
  }
  .capture kbd {
    padding: 0 5px;
    border-radius: 3px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-family: var(--font-mono);
    opacity: 0.7;
  }
  .save-frames {
    width: 100%;
    justify-content: center;
  }
  .scene-here {
    width: 100%;
    justify-content: center;
    gap: 6px;
  }
  .scene-count {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .scene-here kbd {
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-family: var(--font-mono);
    opacity: 0.6;
  }
  .ptabs {
    flex-shrink: 0;
    display: flex;
    gap: 2px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
  }
  .ptab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 9px 10px 8px;
    border-bottom: 2px solid transparent;
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 600;
    background: none;
  }
  .ptab:hover {
    color: var(--text-1);
  }
  .ptab.on {
    color: var(--text-1);
    border-bottom-color: var(--accent);
  }
  .ptab .count {
    padding: 0 5px;
    border-radius: 8px;
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
  }
  .ptab .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .tab-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin: 0;
  }
</style>
