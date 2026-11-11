<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { api, detailLine } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import { workFolder } from '../lib/folders.js';
  import {
    adjustDefaults, buildFrameOps, previewStyle, uid, videoSeed, VIDEO_ADJUST_IDS,
    hasVideoEdits, normalizeRightAngleRotation, rotationOps, sourceStem, frameSaveNames,
    needsRender, previewOps, isNeutral, sliderFilters,
  } from '../lib/inspect.js';
  import { captureMoment, frameDuration, preciseClock, seekInto, shownFrameTime } from '../lib/inspectPlayer.js';
  import { INSPECT_HELP } from '../lib/inspectHelp.js';
  import {
    editClock, isAbandoned, isStretch, isWholeVideo, liveScenes, markablePicture, momentBefore, momentKey, momentsClash, newScene,
    sameMoments, sameTime, sceneList, sceneMarks, sceneMoments, scenePassage, sceneStart, sceneTime, sceneTitle, sceneToEnd,
    setDraftTime, shortClock, snapToFrame, sortMoments, stretchFromShot, timeWords, timedBeside, toProve, wholeBarred,
    wholeDrafts, wholeTaker,
  } from '../lib/scenes.js';
  import {
    abandonProof, abandonScene, geolocateScene, geolocating, joinScenes, restoreProof, restoreScene, sceneEdit as sceneGiven,
    stopGeolocating, unjoinScenes,
  } from '../lib/geolocating.svelte.js';
  import { onEvent } from '../lib/events.js';
  import {
    collagesOfScene, collagesUnder, frameScenes, frameToCapture, frameUses, framesOfScene, pictureHandoff, proofHandoff,
    sceneFootage, scenesAt,
  } from '../lib/sceneFrames.js';
  import { createSceneOffer } from '../lib/sceneOffer.js';
  import { todoHintDue } from '../lib/sceneHints.js';
  import { SceneEdit } from '../lib/sceneEdit.svelte.js';
  import { retimed } from '../lib/sceneRetime.svelte.js';
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
  import MarkScene from './inspect/MarkScene.svelte';
  import SceneTab from './inspect/SceneTab.svelte';
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
    // Scenes kept on a video, or a picture's mark, not proved yet; proved ones are the proofs' own.
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
  // A picture marked whole, unless it is a frame of a video or an answer from the map.
  const markable = $derived(markablePicture(work.source));
  const hasScenes = $derived(isVideo || markable);

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
      if (res.kept?.length) keptTimes(res.kept);
    }
    workState.rev += 1;
  }

  /**
   * A video is one place or several, never both, and the server holds to it: a save that
   * made a scene with a time the whole video beside another scene about it, or beside
   * scenes holding passages, kept the time that scene had (`engine/geolocate.save_work`).
   * Only an Undo stepping back over such a change sends one. The work takes the time
   * back, so what is shown is what is kept, and says why.
   */
  function keptTimes(kept) {
    let said = null;
    for (const { id, start, end, more, why } of kept) {
      const draft = work.scenes.find((sc) => sc.id === id);
      if (!draft || Number.isFinite(draft.start)) continue;
      setDraftTime(draft, sceneMoments({ kind: 'draft', start, end, more }));
      said ??= { label: (draft.label ?? '').trim(), why };
    }
    if (!said) return;
    clipHistory.reset(clipSnapshot());
    const who = said.label ? `“${said.label}”` : 'Scene';
    const why = said.why === 'whole' ? 'another scene of this video is already about the whole video' : 'other scenes of this video already hold passages';
    toast(`${who} keeps its time: ${why}`, 'info', 8000);
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
      sceneOffer.withdraw();
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
    filters = sliderFilters(ops.filters);
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
        if (uiState.tool === 'inspect' && hasScenes && !opening) loadScenes(openRun);
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
    listedGeolocating = null;
    scenesRead = false;
    sceneFocus = null;
    openKey = null;
    folded = false;
    framesRendered = null;
    usedFrames = {};
    listedCollages = [];
    proofChooser = null;
    sceneOffer.reset();
    sceneEdit.close();
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

  /** The same file under another path too: renamed here, or moved elsewhere. */
  const sameFile = (a, b) => Boolean(a && b && (a.path === b.path || (a.entity_id && a.entity_id === b.entity_id)));

  async function open(item) {
    pickerOpen = false;
    await autosave.flush();
    if (heldUnsaved()) return;
    await ensureOps();
    // Another file opens on its Scenes tab, a video on the clip itself; the same one
    // reopened (renamed, cleared, restored) keeps the place it was looked at from.
    const another = !sameFile(work.source, item);
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
      if (another) landOnScenes(item);
      savedSignature = signature();
      clipHistory.reset(clipSnapshot());
      if (item.kind === 'video') loadOverview(run);
      loadScenes(run);
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
    work.scenes = (spec.scenes ?? []).map(draftOf);
    if (!isVideo && !work.frames.length) {
      seed();
      return;
    }
    work.activeFrameId = work.frames.some((f) => f.id === spec.activeFrameId)
      ? spec.activeFrameId
      : isVideo ? null : work.frames[0].id;
    framesRendered = renderFrames(run).finally(() => {
      if (run === openRun) framesRendered = null;
    });
  }

  // The previews of a reopened work while they are drawn, else null: a scene's proof
  // offers its frames by their pictures, so it waits for them.
  let framesRendered = null;

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

  // A scene sent from elsewhere (the pill, the To-do): its file opened on it, the
  // Scenes tab on its row, and with `proof` its Make the proof.
  $effect(() => {
    if (uiState.tool === 'inspect' && uiState.inspectScene && mediaList.length) {
      const wanted = uiState.inspectScene;
      uiState.inspectScene = null;
      untrack(() => openScene(wanted));
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
    captureFrame(captureMoment(shared.currentTime, shared.frameTime));
  }

  // A capture the analyst asked for (C, Capture frame, a shot's or a pick's capture):
  // a new frame in no scene of the clip offers to start one there, since S is easy
  // to miss (`lib/sceneOffer.js`). The frame Make the proof captures for its scene is
  // in it, and is not asked about.
  const sceneOffer = createSceneOffer();
  onDestroy(() => sceneOffer.withdraw());

  async function captureFrame(time) {
    const before = new Set(work.frames.map((f) => f.id));
    const frame = await capture(time);
    if (frame && !before.has(frame.id)) offerScene(frame);
  }

  // The analyst picks what the scene is: the whole video, the commonest answer for a
  // clip filmed in one place, or the instant just captured. Once a scene to geolocate
  // already says the whole video, the clip is one place and nothing more is asked; once
  // scenes hold passages of it, it is several, and the whole video is not offered.
  function offerScene(frame) {
    if (!isVideo || frame.time == null || scenesAt(frame.time, scenes, frameDur).length) return;
    if (work.scenes.some((sc) => sc.start == null)) return;
    const run = openRun;
    const at = frame.time;
    const keep = (stretch, said) => () => {
      if (run !== openRun || scenesAt(at, scenes, frameDur).length) return;
      keepScene(stretch, said);
    };
    const instant = { label: 'This instant', pick: keep({ start: at }, (scene) => `Scene kept at ${sceneTime(scene)}`) };
    const whole = { label: 'Whole video', pick: keep({ start: null, end: null }, () => 'Scene kept for the whole video') };
    sceneOffer.offer(`Frame captured at ${editClock(at)} · Add a scene`, wholeBarred(scenes) ? [instant] : [whole, instant]);
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
    // In the Scenes tab the player's keys still reach the frame, but a button there
    // answers its own Space and Enter.
    if (t.closest?.('[data-scene-panel]') && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (selected === 'video' || scenesShown)) {
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
      // S keeps a scene here, whichever row is open. Shift+S ends the open one.
      s: () => {
        if (e.repeat) return;
        if (e.shiftKey) endSceneHere();
        else addSceneHere();
      },
      // A time changed and not applied: Enter keeps it, Escape drops it. With none,
      // Escape folds the open row.
      ...(sceneEdit.changed ? { Enter: applySceneEdit, Escape: dropSceneEdit } : {}),
      ...(!sceneEdit.changed && scenesShown && openRow ? { Escape: foldScenes } : {}),
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
  // hidden while that proof is in the case, so deleting the proof gives it back. A
  // picture holds one mark about the whole of it, proved by any proof laying it out.
  let listedScenes = $state([]);
  let takenScenes = $state([]);
  // Whether the server's list was read for this file: until then a file with proofs
  // resting on it could pass for one with nothing marked.
  let scenesRead = $state(false);
  // The draft of this clip being geolocated, as the server read it with the list. The
  // app's own copy (`lib/geolocating.svelte.js`) is fresher once it has read the case:
  // the extension and other tabs move it, and it carries the captures gathered since.
  let listedGeolocating = $state(null);
  const heldHere = $derived(
    geolocating.caseId && geolocating.caseId === work.caseId
      ? geolocating.scene?.video === work.source?.path ? geolocating.scene : null
      : undefined,
  );
  const geolocatingId = $derived(heldHere === undefined ? listedGeolocating : heldHere?.id ?? null);
  const scenes = $derived(
    sceneList(listedScenes, work.scenes, takenScenes).map((sc) => {
      if (sc.kind !== 'draft' || sc.id !== geolocatingId) return sc;
      const fresh = heldHere?.id === sc.id ? heldHere : null;
      if (!fresh) return { ...sc, geolocating: true };
      return { ...sc, geolocating: true, captures: fresh.captures ?? sc.captures, captureCount: fresh.captureCount, state: fresh.state ?? sc.state };
    }),
  );
  // The row the Scenes tab brings into view and lights, `{ key, n }`.
  let sceneFocus = $state(null);
  // The proofs laying out each saved frame of the clip, by the frame's path.
  let usedFrames = $state({});
  // The collages cut from this clip alone, each with its pieces' instants (`GET /scenes`),
  // listed under the scenes they fall in and offered to their proofs as frames are.
  let listedCollages = $state([]);
  const collagesByScene = $derived(isVideo ? collagesUnder(scenes, listedCollages, frameDur) : new Map());

  /** A collage listed under a scene, opened in the Collage tool. */
  function openCollage(row) {
    uiState.openCollage = row.collage;
    uiState.tool = 'collage';
  }
  // What the strip marks on a frame: the scenes it falls in, and the proofs using it.
  const frameDots = $derived(isVideo ? frameScenes(work.frames, scenes, frameDur) : new Map());
  // What the clip gives each scene still to prove, by its key: the strip's frames and the
  // collages in it, counted off the strip in hand as the To-do counts them on the server.
  const footageByScene = $derived(
    isVideo
      ? new Map(scenes.filter((sc) => sc.kind === 'draft').map((sc) => [sc.key, sceneFootage(sc, work.frames, listedCollages, frameDur)]))
      : new Map(),
  );
  const frameUsed = $derived(isVideo ? frameUses(work.frames, usedFrames) : new Map());

  // The time of the open row (`lib/sceneEdit.svelte.js`). The bar draws it as its
  // fields read, with handles, before anything is kept.
  const sceneEdit = new SceneEdit(() => ({ duration: probeInfo?.duration ?? 0, fps: probeInfo?.fps ?? null }));
  const sceneMarksOnBar = $derived.by(() => {
    const held = sceneEdit.changed && scenes.find((sc) => sc.key === sceneEdit.key);
    if (!held) return sceneMarks(scenes);
    // a time being changed as its fields read: each moment that reads as a time, by its line
    const label = sceneTitle(held);
    const edited = sceneEdit.moments.flatMap((m, i) =>
      m.start == null ? [] : [{ key: momentKey(held, i), scene: held.key, start: m.start, end: isStretch(m) && m.passage ? m.end : null, color: held.color, label }],
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
    if (!path || !hasScenes) return;
    try {
      const res = await api.get(`/api/cases/${work.caseId}/scenes?video=${encodeURIComponent(path)}`);
      if (run !== openRun) return;
      listedScenes = res.scenes ?? [];
      takenScenes = res.taken ?? [];
      listedGeolocating = res.geolocating ?? null;
      usedFrames = res.used ?? {};
      listedCollages = res.collages ?? [];
      scenesRead = true;
      adoptGivenBack(listedScenes);
    } catch {
      // the list is a reading: without it the drafts still show, and a reopen asks again
    }
  }

  /**
   * A proof sent to the Trash gives its scene back to this work on the server
   * (`engine/scenes.give_back`). A draft the server lists that this tab never held,
   * neither now nor at its last save, is one of those: it joins the work here, or the
   * next save would write it out again.
   */
  function adoptGivenBack(listed) {
    const saved = savedSignature ? JSON.parse(savedSignature).scenes ?? [] : [];
    const known = new Set([...work.scenes, ...saved].map((sc) => sc.id));
    const given = listed.filter((sc) => sc.kind === 'draft' && !known.has(sc.id));
    if (!given.length) return;
    work.scenes = [...work.scenes, ...given.map(draftOf)];
    clipHistory.reset(clipSnapshot());
  }

  /** A scene still to prove as this work holds it, from the work saved or a row of the server's. */
  function draftOf({ id, start, end, label, more }) {
    return { id, start, end, label: label ?? '', ...(more?.length ? { more: more.map((m) => ({ start: m.start, end: m.end ?? null })) } : {}) };
  }

  // Coming back to Inspect reads the list again: a proof saved meanwhile joins it.
  $effect(() => {
    if (uiState.tool === 'inspect' && hasScenes && !opening) untrack(() => loadScenes(openRun));
  });

  // A scene of this clip given up or taken up again from the To-do beside it.
  $effect(() => {
    void sceneGiven.n;
    untrack(() => {
      if (sceneGiven.caseId !== work.caseId || sceneGiven.video !== work.source?.path) return;
      if (uiState.tool === 'inspect' && hasScenes && !opening) loadScenes(openRun);
    });
  });

  // A scene of this clip given a new time in the Collage tool (`lib/sceneRetime.svelte.js`):
  // the work takes it up, or its next save would write the old time back.
  $effect(() => {
    void retimed.n;
    untrack(() => {
      if (!retimed.n || retimed.caseId !== work.caseId || retimed.video !== work.source?.path) return;
      const draft = work.scenes.find((sc) => sc.id === retimed.draft);
      const now = sceneMoments({ kind: 'draft', ...retimed });
      if (!draft || sameMoments(sceneMoments({ kind: 'draft', ...draft }), now)) return;
      setDraftTime(draft, now);
      clipHistory.reset(clipSnapshot());
      if (sceneEdit.key === draft.id && !sceneEdit.changed) {
        const row = scenes.find((sc) => sc.key === draft.id);
        if (row) sceneEdit.begin(row);
      }
    });
  });

  // A scene of this clip gathered a capture, from the map or the extension, or its
  // geolocating started or ended: its row says so without waiting for a return here.
  onDestroy(
    onEvent('geolocating', (event) => {
      if (event.case_id !== work.caseId || event.video !== work.source?.path) return;
      if (uiState.tool === 'inspect' && hasScenes && !opening) loadScenes(openRun);
    }),
  );

  // A proof's time written elsewhere can land after the list was read on the way back
  // here: Geo Proof's save taking up a scene a moment after it was pressed, or another
  // window. The server says so, and the list is read again, once for a burst.
  let scenesTimer = null;
  onDestroy(
    onEvent('scenes', (event) => {
      if (event.case_id !== work.caseId || (event.video && event.video !== work.source?.path)) return;
      if (uiState.tool !== 'inspect' || !hasScenes || opening) return;
      clearTimeout(scenesTimer);
      const run = openRun;
      scenesTimer = setTimeout(() => {
        if (uiState.tool === 'inspect' && hasScenes && !opening) loadScenes(run);
      }, 300);
    }),
  );
  onDestroy(() => clearTimeout(scenesTimer));

  /**
   * Record the clip as it now stands, and say how to take this step back. The first
   * scene ever kept here (`kept`) asks the app to point once at the To-do, where it
   * waits too (`uiState.todoHint`).
   */
  function clipChanged(message, { kept = false, undoable = true } = {}) {
    const after = clipSnapshot();
    clipHistory.push(after);
    const run = openRun;
    const undo = {
      label: 'Undo',
      onClick: () => {
        if (run === openRun && clipSnapshot() === after) undoClip();
      },
    };
    if (kept && todoHintDue()) uiState.todoHint = true;
    toast(message, 'info', 6000, undoable ? undo : null);
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

  /** The Scenes tab on this scene, its row open as the last one touched. */
  function touchScene(key) {
    openKey = key;
    folded = false;
    landed = true;
    tabs[isVideo ? 'video' : 'frame'] = 'scenes';
  }

  /**
   * Keep a scene over `stretch`. A video is one place or several, never both: a time
   * marked on a clip whose one scene still to prove is about the whole video goes to
   * that scene instead (`wholeTaker`), and one marked while an older case holds two
   * about the whole video and nothing at a time asks for them to be joined first, since
   * either could take it.
   * The whole video kept while a scene is about it already answers that scene, and is
   * refused beside scenes holding passages.
   */
  function keepScene(stretch, message, { reveal = true } = {}) {
    if (!stretch) return null;
    const timed = Number.isFinite(stretch.start);
    if (isVideo && (timed ? twinsAsked() : wholeRefused())) return null;
    const whole = timed ? wholeTaker(scenes) : null;
    if (whole) return takeWhole(whole, stretch, { reveal });
    const scene = newScene(stretch);
    work.scenes.push(scene);
    frameInstants(sceneMoments({ kind: 'draft', ...scene }));
    sceneOffer.quiet();
    clipChanged(message(scene), { kept: true });
    if (reveal) touchScene(scene.id);
    return scene;
  }

  /**
   * The scene about the whole video takes this time, keeping its label, its captures and
   * its geolocating, and the toast's Undo makes it the whole video again. Taken beside
   * scenes at a time (`giveTime`) it has no Undo, which would make the video both again.
   */
  function takeWhole(whole, stretch, { reveal = true, undoable = true } = {}) {
    const draft = work.scenes.find((sc) => sc.id === whole.id);
    if (!draft) return null;
    const moments = [{ start: stretch.start, end: isStretch(stretch) ? stretch.end : null }];
    setDraftTime(draft, moments);
    frameInstants(moments);
    sceneOffer.quiet();
    const label = (draft.label ?? '').trim();
    clipChanged(`${label ? `“${label}”` : 'Scene'} now ${timeWords(moments)}, no longer the whole video`, { undoable });
    if (reveal) touchScene(draft.id);
    return draft;
  }

  /**
   * An older case's scene about the whole video beside scenes at a time: Give it a time
   * makes it the instant on screen, as the clip's one scene about the whole video takes
   * the instant S marks, its frame kept in the strip. Ctrl+Z starts from here.
   */
  function giveTime(pressed) {
    if (pressed?.kind !== 'draft' || !isVideo || !isWholeVideo(pressed)) return;
    if (takeWhole(pressed, { start: shownTime() }, { undoable: false })) clipHistory.reset(clipSnapshot());
  }

  /**
   * A time marked while an older case holds several scenes about the whole video and
   * nothing at a time, so that one of them would take it: none does, and the toast offers
   * to join them. Answers whether it asked.
   */
  function twinsAsked() {
    const twins = wholeDrafts(scenes);
    if (twins.length < 2 || timedBeside(scenes)) return false;
    toast(`${twins.length} scenes for the whole video: join them first`, 'warn', 8000, {
      label: 'Join them',
      onClick: () => joinWhole(wholeDrafts(scenes)),
    });
    return true;
  }

  /**
   * The whole video kept while a scene is about it already: that scene, brought into view.
   * Beside scenes holding passages, a toast says why it is not kept. Answers whether either was.
   */
  function wholeRefused() {
    const [standing] = wholeDrafts(scenes);
    if (standing) {
      touchScene(standing.key);
      sceneFocus = { key: standing.key, n: (sceneFocus?.n ?? 0) + 1 };
      return true;
    }
    if (!wholeBarred(scenes)) return false;
    toast(INSPECT_HELP.markWholeTimed, 'warn');
    return true;
  }

  /**
   * An instant always keeps its frame. One marked here (S, Mark to geolocate's press,
   * the instant the scene about the whole video takes, one added or moved on a scene's
   * open row) puts the frame at that time into the strip, as Capture frame does, unless
   * one within half a frame of it is there already. It is a work frame, filed to the
   * case once a proof uses it, as Make the proof files the frames it takes. An instant
   * the scene held before is left as it is, and a passage gets no frame.
   */
  function frameInstants(moments, before = []) {
    if (!isVideo) return;
    for (const m of moments) {
      if (m.end != null || !Number.isFinite(m.start)) continue;
      if (before.some((b) => b.end == null && sameTime(b.start, m.start))) continue;
      if (work.frames.some((f) => f.time != null && Math.abs(f.time - m.start) <= frameDur / 2)) continue;
      capture(m.start);
    }
  }

  /** A scene at the frame on screen (S, or Mark to geolocate). */
  function addSceneHere() {
    if (!isVideo) return;
    keepScene({ start: shownTime() }, (scene) => `Scene kept at ${sceneTime(scene)}`);
  }

  /** A scene about the whole video, with no timecode. */
  const keepWholeVideo = () => keepScene({ start: null, end: null }, () => 'Scene kept for the whole video');

  /** A picture marked to geolocate, the whole of it, once. */
  function markPicture() {
    if (!markable || work.scenes.length) return;
    keepScene({ start: null, end: null }, () => 'Picture marked to geolocate');
  }

  // Beside the shots it stays in Moments, where the next one is kept from.
  const keepShotScene = (index) =>
    keepScene(stretchFromShot(scan?.shots, index, probeInfo?.duration ?? 0), (scene) => `Shot kept as a scene, ${sceneTime(scene)}`, { reveal: false });

  /**
   * End a scene at the frame on screen (Shift+S, End here): the one named, else the row
   * open in the Scenes tab when it started before it, else the latest that did. Of a
   * scene holding several moments, the one in hand on its open row, else the latest
   * started before the frame. With none, the clip's one scene about the whole video
   * takes the passage from the clip's start to here (`takeWhole`).
   */
  function endSceneHere(id = null) {
    if (sceneEdit.changed && sceneEdit.result) applySceneEdit();
    const now = shownTime() + frameDur;
    const open = scenesShown && openRow?.kind === 'draft' && momentBefore(openRow, now) !== -1 ? openRow : null;
    const target = id ? work.scenes.find((sc) => sc.id === id) : open ?? sceneToEnd(scenes, now);
    const scene = target && work.scenes.find((sc) => sc.id === target.id);
    const moments = scene ? sceneMoments({ kind: 'draft', ...scene }) : [];
    if (!moments.length) {
      if (id || twinsAsked()) return;
      const whole = wholeTaker(scenes);
      if (whole) takeWhole(whole, { start: 0, end: now });
      return;
    }
    // the moment in hand on the open row, found by its start: Apply may have just put it in clip order
    const inHand = sceneEdit.key === scene.id ? sceneEdit.moments[sceneEdit.active]?.start : null;
    const held = moments.findIndex((m) => sameTime(m.start, inHand));
    const index = held !== -1 && moments[held].start < now ? held : momentBefore({ kind: 'draft', ...scene }, now);
    if (index === -1) {
      toast('Go past the start of the scene to end it here', 'warn');
      return;
    }
    const ended = moments.map((m, i) => (i === index ? { start: m.start, end: now } : m));
    if (momentsClash(ended)) {
      toast('That end runs into another passage of the scene', 'warn');
      return;
    }
    setDraftTime(scene, ended);
    clipChanged(`Scene ends at ${shortClock(now)}`);
    touchScene(scene.id);
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

  /** Go to where a scene starts. */
  function goToScene(scene) {
    const start = sceneStart(scene);
    if (start != null) seekFrame(start);
  }

  /** A row pressed in the Scenes tab: it opens, and the clip goes there. */
  function pickScene(scene) {
    touchScene(scene.key);
    goToScene(scene);
  }

  /** A pin pressed on the bar, or a band while the Scenes tab is shown, which has
   *  already moved the clip there. */
  function pressedOnBar(key) {
    if (!scenes.some((sc) => sc.key === key)) return;
    const there = scenesShown && openRow?.key === key;
    touchScene(key);
    if (!there) sceneFocus = { key, n: (sceneFocus?.n ?? 0) + 1 };
  }

  function foldScenes() {
    openKey = null;
    folded = true;
  }

  // -- geolocating a scene ----------------------------------------------------------
  // Geolocate is a scene's main act: the server holds it as the one being geolocated,
  // so every capture filed meanwhile is gathered for it, and Satellite opens with the
  // video as a reference window, the scene marked on its bar (`lib/geolocating`). The
  // work is written first, since the server can only geolocate a scene it holds.
  // Abandon and Restore are the server's too, and the list is read again after each.
  let sceneBusy = $state(false);

  async function heldWork() {
    await tick(); // a change made a moment ago reaches the autosave first
    await autosave.flush();
    if (autosave.unsaved) throw new Error('The work is not saved yet. Retry, then try again');
  }

  async function geolocate(pressed) {
    if (pressed?.kind !== 'draft' || !hasScenes || sceneBusy) return;
    const scene = settled(pressed);
    sceneBusy = true;
    const run = openRun;
    try {
      // pressed again on the scene in hand, Geolocate stops it, the captures kept
      if (scene.geolocating) {
        await stopGeolocating(work.caseId);
        if (run === openRun) loadScenes(run);
        return;
      }
      await heldWork();
      if (run !== openRun) return;
      await geolocateScene(work.caseId, { video: work.source.path, id: scene.id });
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
    } finally {
      sceneBusy = false;
    }
  }

  /** A row of the server's list put in place of the one it had, so the tab moves at once. */
  function heardRow(row) {
    if (!row?.id) return;
    const at = listedScenes.findIndex((sc) => sc.kind === 'draft' && sc.id === row.id);
    listedScenes = at === -1 ? [...listedScenes, row] : listedScenes.map((sc, i) => (i === at ? row : sc));
  }

  /**
   * A proof that states no place yet given up on, or taken up again: the word lives on
   * the proof, so the tab reads its rows again rather than patching one.
   */
  async function leaveProof(scene, reason, back = false) {
    const run = openRun;
    try {
      if (back) await restoreProof(work.caseId, scene.proof);
      else await abandonProof(work.caseId, scene.proof, reason);
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    }
    if (run !== openRun) return;
    if (back) sceneFocus = { key: scene.key, n: (sceneFocus?.n ?? 0) + 1 };
    loadScenes(run);
    if (!back) {
      toast('Proof abandoned', 'info', 6000, {
        label: 'Undo',
        onClick: () => {
          if (run === openRun) leaveProof(scene, '', true);
        },
      });
    }
  }

  async function abandon(scene, reason = '') {
    if (scene?.kind === 'proof' && hasScenes) return leaveProof(scene, reason);
    if (scene?.kind !== 'draft' || !hasScenes || sceneBusy) return;
    sceneBusy = true;
    const run = openRun;
    const caseId = work.caseId;
    const video = work.source.path;
    try {
      await heldWork();
      if (run !== openRun) return;
      heardRow(await abandonScene(caseId, video, scene.id, reason));
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    } finally {
      sceneBusy = false;
    }
    if (run !== openRun) return;
    loadScenes(run);
    toast('Scene abandoned', 'info', 6000, {
      label: 'Undo',
      onClick: () => {
        if (run === openRun) bringBack(scene);
      },
    });
  }

  async function bringBack(scene) {
    if (scene?.kind === 'proof' && hasScenes) return leaveProof(scene, '', true);
    if (scene?.kind !== 'draft' || !hasScenes) return;
    const run = openRun;
    try {
      heardRow(await restoreScene(work.caseId, work.source.path, scene.id));
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    }
    if (run !== openRun) return;
    sceneFocus = { key: scene.key ?? scene.id, n: (sceneFocus?.n ?? 0) + 1 };
    loadScenes(run);
  }

  // -- the same place --------------------------------------------------------------------
  // Same place as…: a scene still to prove joins another of the clip that shows the same
  // place (`POST /scenes/{draft}/join`), into one scene holding both moments, in the
  // colour its first moment gives it, its captures gathered. The server writes it in one
  // go, so the work is saved first and takes the answer up; the toast's Undo puts both
  // back as they were (`/unjoin`), while nothing has moved the joined scene since.

  async function joinScene(pressed, into) {
    if (pressed?.kind !== 'draft' || into?.kind !== 'draft' || !isVideo || sceneBusy) return;
    const scene = settled(pressed);
    sceneBusy = true;
    const run = openRun;
    const caseId = work.caseId;
    const video = work.source.path;
    let answer;
    try {
      await heldWork();
      if (run !== openRun) return;
      answer = await joinScenes(caseId, video, scene.id, into.id);
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    } finally {
      sceneBusy = false;
    }
    if (run !== openRun) return;
    const joined = answer.scene;
    tookScenes([draftOf(joined)], [scene.id]);
    listedScenes = listedScenes.filter((sc) => !(sc.kind === 'draft' && sc.id === scene.id));
    heardRow(joined);
    touchScene(joined.id);
    sceneFocus = { key: joined.id, n: (sceneFocus?.n ?? 0) + 1 };
    const moments = sceneMoments(joined);
    const said = joined.label ? `“${joined.label}” is now ${timeWords(moments)}` : `Scene now ${timeWords(moments)}`;
    toast(said, 'info', 6000, {
      label: 'Undo',
      onClick: () => {
        const now = work.scenes.find((sc) => sc.id === joined.id);
        // only while nothing has moved it since, its time or its label
        const same = now && now.label.trim() === joined.label && sameMoments(sceneMoments({ kind: 'draft', ...now }), moments);
        if (run === openRun && same) unjoinScene(answer.undo);
      },
    });
    loadScenes(run);
  }

  async function unjoinScene(undo) {
    const run = openRun;
    let answer;
    try {
      await heldWork();
      if (run !== openRun) return;
      answer = await unjoinScenes(work.caseId, work.source.path, undo);
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
      return;
    }
    if (run !== openRun) return;
    tookScenes(answer.scenes.map(draftOf), []);
    for (const row of answer.scenes) heardRow(row);
    loadScenes(run);
  }

  /**
   * An older case's scenes about the whole video, the same question asked more than once:
   * Join them makes them the first, one join after another as Same place as… joins two,
   * the labels after its own and the captures gathered. The toast's Undo parts them again,
   * the last join first, while nothing has moved the scene since.
   */
  async function joinWhole(twins) {
    const [into, ...rest] = twins ?? [];
    if (!into || !rest.length || !isVideo || sceneBusy) return;
    sceneBusy = true;
    const run = openRun;
    const caseId = work.caseId;
    const video = work.source.path;
    const undos = [];
    let joined = null;
    try {
      await heldWork();
      for (const one of rest) {
        if (run !== openRun) return;
        const answer = await joinScenes(caseId, video, one.id, into.id);
        undos.push(answer.undo);
        joined = answer.scene;
        tookScenes([draftOf(joined)], [one.id]);
        listedScenes = listedScenes.filter((sc) => !(sc.kind === 'draft' && sc.id === one.id));
        heardRow(joined);
      }
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
    } finally {
      sceneBusy = false;
    }
    if (run !== openRun || !joined) return;
    touchScene(joined.id);
    sceneFocus = { key: joined.id, n: (sceneFocus?.n ?? 0) + 1 };
    const label = joined.label;
    toast(label ? `Joined into “${label}”, about the whole video` : 'Joined into one scene about the whole video', 'info', 6000, {
      label: 'Undo',
      onClick: () => {
        const now = work.scenes.find((sc) => sc.id === joined.id);
        // only while nothing has moved it since, its time or its label
        const same = now && now.label.trim() === label && now.start == null;
        if (run === openRun && same) unjoinAll(undos);
      },
    });
    loadScenes(run);
  }

  /** Undo Join them: each join taken back, the last first. */
  async function unjoinAll(undos) {
    for (const undo of [...undos].reverse()) await unjoinScene(undo);
  }

  /**
   * The work as the server just wrote it: these scenes in place of the ones of the same
   * id, or beside them, and the `gone` ids out. What was saved reads the same, so no
   * save follows, and Ctrl+Z starts from here.
   */
  function tookScenes(scenes, gone) {
    const apply = (list) => {
      const held = list.filter((sc) => !gone.includes(sc.id));
      for (const scene of scenes) {
        const at = held.findIndex((sc) => sc.id === scene.id);
        if (at === -1) held.push(scene);
        else held[at] = scene;
      }
      return held;
    };
    work.scenes = apply(work.scenes);
    if (savedSignature) {
      const saved = JSON.parse(savedSignature);
      savedSignature = JSON.stringify({ ...saved, scenes: apply(saved.scenes ?? []).map(sceneRecord) });
    }
    clipHistory.reset(clipSnapshot());
  }

  /**
   * Open a scene asked for from elsewhere (`uiState.inspectScene`): its file, a video
   * on screen at the scene's start, the Scenes tab open on its row, and with `proof`
   * its Make the proof. `slide` names a proof instead of a scene still to prove: Geo
   * Proof's strip shows its slide where it happens.
   */
  async function openScene({ video, draft, proof = false, slide = null }) {
    const target = mediaList.find((m) => m.path === video);
    if (!target) {
      toast('That file is no longer in the case', 'warn');
      return;
    }
    if (work.source?.path !== video) {
      await open(target);
      if (work.source?.path !== video) return;
    }
    const run = openRun;
    await loadScenes(run);
    if (run !== openRun) return;
    if (isVideo && selected !== 'video') select('video');
    const scene = slide
      ? scenes.find((sc) => sc.kind === 'proof' && sc.proof === slide)
      : scenes.find((sc) => sc.kind === 'draft' && sc.id === draft);
    if (!scene) {
      toast(`That scene is no longer in this ${isVideo ? 'video' : 'picture'}`, 'warn');
      return;
    }
    touchScene(scene.key);
    goToScene(scene);
    sceneFocus = { key: scene.key, n: (sceneFocus?.n ?? 0) + 1 };
    if (proof && !isAbandoned(scene)) makeProof(scene);
  }

  function openSceneProof(scene) {
    if (!scene?.proof) return;
    uiState.openProof = scene.proof;
    uiState.tool = 'proof';
  }

  // -- the open row ---------------------------------------------------------------------
  // One row of the Scenes tab is open at a time: the last one touched. Landing in the
  // tab opens the one under the playhead instead, and with neither, the first still to
  // prove. Escape folds it, until the tab is landed in again. A picture's row has no
  // time to open.
  let openKey = $state(null);
  let folded = $state(false);
  const scenesShown = $derived(uiState.tool === 'inspect' && !opening && hasScenes && shownTab === 'scenes');
  const openRow = $derived.by(() => {
    if (!isVideo) return null;
    const live = liveScenes(scenes);
    return live.find((sc) => sc.key === openKey) ?? (folded ? null : live.find((sc) => sc.kind === 'draft') ?? null);
  });

  let landed = false;
  $effect(() => {
    const shown = scenesShown;
    untrack(() => {
      if (shown && !landed) {
        folded = false;
        const under = isVideo ? scenesAt(shownTime(), liveScenes(scenes), frameDur)[0] : null;
        if (under) openKey = under.key;
      }
      if (!shown) sceneFocus = null;
      landed = shown;
    });
  });

  // The editor stands on the open row while the tab shows it, which is what gives the
  // bar its handles. Leaving a row, or the tab, keeps a time that reads as one. A scene
  // whose time moved under it (applied, ended, undone) is read again.
  $effect(() => {
    const target = scenesShown ? openRow : null;
    untrack(() => {
      if (!target) {
        if (sceneEdit.scene) leaveSceneEdit();
        return;
      }
      if (sceneEdit.key !== target.key) {
        if (sceneEdit.scene) leaveSceneEdit();
        sceneEdit.begin(target);
      } else if (!sameMoments(sortMoments(sceneMoments(target)), sortMoments(sceneMoments(sceneEdit.scene)))) {
        sceneEdit.begin(target);
      }
    });
  });

  // -- a scene's time, changed --------------------------------------------------------
  // The open row shows its time as it stands (`lib/sceneEdit`). Nothing is kept until
  // Apply or Enter, and leaving the row keeps it too when it reads as one; Escape drops
  // it. A draft's new time joins the clip's history like any other change to it; a
  // proof's moments are written to the proof (`PUT /cases/{id}/proofs/{name}/scene`)
  // and its toast takes them back.

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
  // Another passage, of the scene's kind, from the frame on screen (`sceneEdit.another`)
  const addMoment = () => sceneEdit.another(frameNow());

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

  // A proof's time is on its way to the server: Apply waits for the answer.
  let applyingTime = false;

  async function applySceneEdit() {
    const scene = sceneEdit.scene;
    const time = sceneEdit.result;
    if (!scene || !time || !sceneEdit.changed || applyingTime) return;
    if (scene.kind === 'proof') {
      applyingTime = true;
      try {
        await timeProof(scene, time.moments);
      } finally {
        applyingTime = false;
      }
      return;
    }
    const draft = work.scenes.find((sc) => sc.id === scene.id);
    if (!draft) return;
    const before = sceneMoments({ kind: 'draft', ...draft });
    const moments = sceneMoments({ kind: 'draft', ...time });
    setDraftTime(draft, moments);
    frameInstants(moments, before);
    clipChanged(`Scene now ${timeWords(moments)}`);
  }

  /** A scene as it stands once a time changed on its open row is kept, when it reads as one. */
  function settled(scene) {
    if (sceneEdit.key === scene.key && sceneEdit.changed && sceneEdit.result) applySceneEdit();
    return scenes.find((sc) => sc.key === scene.key) ?? scene;
  }

  /** Back to what the open row's scene says. */
  function dropSceneEdit() {
    const held = sceneEdit.key && scenes.find((sc) => sc.key === sceneEdit.key);
    if (held) sceneEdit.begin(held);
    else sceneEdit.close();
  }

  /** Letting go of a row keeps a time that reads as one. */
  function leaveSceneEdit() {
    if (sceneEdit.result && sceneEdit.changed) applySceneEdit();
    sceneEdit.close();
  }

  /**
   * Write a proof's moments: none is the whole video, kept as said. `traced` takes it back
   * to its frames instead, the Undo of the first time a proof that stated none was given.
   */
  async function timeProof(scene, moments, undoable = true, { traced = false } = {}) {
    const run = openRun;
    const before = (scene.moments ?? []).map(({ start, end }) => ({ start, end: end ?? null }));
    const wasTraced = !scene.stated;
    let res;
    try {
      res = await api.put(`/api/cases/${work.caseId}/proofs/${encodeURIComponent(scene.proof)}/scene`, {
        moments,
        ...(traced ? { traced: true } : {}),
      });
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
        if (run === openRun && now && sameMoments(now.moments, res.moments)) {
          timeProof(now, before, false, { traced: wasTraced && !before.length });
        }
      },
    } : null);
    loadScenes(run);
  }

  // -- a scene's proof ------------------------------------------------------------------
  // Make the proof, on a scene to geolocate: its frames, all ticked, to start the
  // proof from (`lib/sceneFrames.js`). A scene holding none captures one, the sharpest
  // a scan found in it, else the one it starts on. Frames not in the case are saved
  // on the way, with their default names and the last folder, then Geo Proof opens a
  // proof of the scene on them (`uiState.proofScene`). A picture has no frames to
  // choose: its proof opens on the picture and the captures gathered for it.
  let proofChooser = $state(null); // { scene, ids, capture, captures, collages }
  let makingProof = $state(false);
  const chooserFrames = $derived(
    proofChooser ? proofChooser.ids.map((id) => work.frames.find((f) => f.id === id)).filter(Boolean) : [],
  );

  /** A capture the scene gathered, as the chooser shows it: its thumbnail and name. */
  function gathered(path) {
    const item = mediaList.find((m) => m.path === path);
    return {
      path,
      url: fileUrl(work.caseId, item?.thumbnail || path),
      title: item?.title || item?.filename || path.split('/').pop(),
    };
  }

  async function makeProof(pressed) {
    if (pressed?.kind !== 'draft' || !hasScenes || makingProof || isAbandoned(pressed)) return;
    const scene = settled(pressed);
    if (!isVideo) {
      uiState.proofScene = pictureHandoff(scene, work.source.path, scene.captures);
      uiState.tool = 'proof';
      return;
    }
    if (framesRendered) {
      const run = openRun;
      await framesRendered;
      if (run !== openRun || makingProof) return;
    }
    const frames = framesOfScene(scene, work.frames, frameDur);
    // a collage of the scene is offered by the picture it was last saved as
    const collages = collagesOfScene(scene, listedCollages.filter((c) => c.export), frameDur).map((c) => ({
      ...gathered(c.export), name: c.collage, title: c.title, start: c.start, current: c.current,
    }));
    proofChooser = {
      scene,
      ids: frames.map((f) => f.id),
      capture: frames.length || collages.length ? null : frameToCapture(scene, { scan, now: shownTime(), frame: frameDur }),
      captures: (scene.captures ?? []).map(gathered),
      collages,
    };
  }

  async function confirmProof(ids, capturePaths = [], collagePaths = []) {
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
      const collages = (chooser.collages ?? []).filter((c) => collagePaths.includes(c.path));
      if (!frames.length && !collages.length) return;
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
      if (!frames.every((f) => f.filed?.path)) throw new Error('A frame could not be saved to the case');
      // the frames and the collages in clip order, a collage at its first piece, then the captures as they came
      const panels = [
        ...frames.map((f) => ({ at: f.time, path: f.filed.path })),
        ...collages.map((c) => ({ at: c.start, path: c.path })),
      ].sort((a, b) => a.at - b.at).map((p) => p.path);
      proofChooser = null;
      uiState.proofScene = proofHandoff(chooser.scene, work.source.path, [...panels, ...capturePaths]);
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
  // video, Save to case on a frame. The tabs hold the rest, and keep their place while
  // the file stays open; another file opens on its Scenes tab (`landOnScenes`).
  const tabs = $state({ video: 'scenes', frame: 'adjust' });
  const panelHelpers = panelWidth({ key: 'azimut:inspectPanelW', min: 300, max: 560, def: 340, fraction: 0.4 });
  let panelW = $state(panelHelpers.loadWidth());
  const unfiledCount = $derived(work.frames.filter((f) => !filedIds.has(f.id) && !savingFrames.has(f.id) && f.url).length);
  const frameTouched = $derived(
    !!activeFrame && (!!activeFrame.crop || !!activeFrame.rotation || !isNeutral(filters, activeFrame.adjust))
  );
  // Scenes first where the file has any, Info last: what the file says is looked up,
  // and where its places stand is why it is open.
  const scenesTab = $derived({
    id: 'scenes', label: 'Scenes', title: INSPECT_HELP.tabScenes, count: liveScenes(scenes).length, todo: toProve(scenes) > 0,
  });
  const panelTabs = $derived(
    selected === 'video'
      ? [
          scenesTab,
          { id: 'adjust', label: 'Adjust', title: INSPECT_HELP.tabAdjust, dot: videoEdited },
          { id: 'moments', label: 'Moments', title: INSPECT_HELP.tabMoments, count: work.marks.length },
          { id: 'info', label: 'Info', title: INSPECT_HELP.tabInfo },
        ]
      : [
          ...(markable ? [scenesTab] : []),
          { id: 'adjust', label: 'Adjust', title: INSPECT_HELP.tabAdjust, dot: frameTouched },
          { id: 'analyze', label: 'Analyze', title: INSPECT_HELP.tabAnalyze, dot: !!overlay },
          { id: 'info', label: 'Info', title: INSPECT_HELP.tabInfo },
        ]
  );
  const mode = $derived(selected === 'video' ? 'video' : 'frame');
  // The tab in use, or Adjust where it does not exist: a frame of a video has no Scenes.
  const shownTab = $derived(panelTabs.some((t) => t.id === tabs[mode]) ? tabs[mode] : 'adjust');

  /**
   * A file opened lands on its Scenes tab, whatever tab the last one was left on: a
   * video on the clip rather than a frame of it, a picture on its own Scenes. A frame of
   * a video and a capture have none, and keep the tab they had.
   */
  function landOnScenes(item) {
    if (item.kind === 'video') {
      work.activeFrameId = null;
      tabs.video = 'scenes';
    } else if (markablePicture(item)) tabs.frame = 'scenes';
  }

  // -- one place or several -------------------------------------------------------------
  // A video with no live scene asks, in its Scenes tab, whether it is one place or several:
  // the whole video keeps one scene about all of it, several says how S marks them.

  /** Several places: a word on how S and Shift+S mark them as the video plays. */
  function severalPlaces() {
    toast('Press S where a place shows as the video plays, and Shift+S where it ends', 'info', 8000);
  }

  // Why Mark to geolocate's arrow does not offer the whole video: a scene says so, or
  // scenes hold passages of the clip, which makes it several places.
  const markWholeOff = $derived(
    { whole: INSPECT_HELP.markWholeTaken, timed: INSPECT_HELP.markWholeTimed }[wholeBarred(scenes)] ?? '',
  );

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
              onscene={pressedOnBar}
              bandsOpen={scenesShown}
            />
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
              <MarkScene
                wholeOff={markWholeOff}
                onmoment={addSceneHere}
                onwhole={keepWholeVideo}
              />
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
                class:on={shownTab === t.id}
                role="tab"
                aria-selected={shownTab === t.id}
                title={t.title}
                onclick={() => (tabs[mode] = t.id)}
              >
                {t.label}
                {#if t.count}<span class="count" class:todo={t.todo}>{t.count}</span>{:else if t.dot}<span class="dot"></span>{/if}
              </button>
            {/each}
          </div>

          <div class="tab-body" role="tabpanel" aria-label={panelTabs.find((t) => t.id === shownTab)?.label}>
            {#if shownTab === 'scenes'}
              <SceneTab
                {scenes}
                footage={footageByScene}
                collages={collagesByScene}
                onopencollage={openCollage}
                edit={sceneEdit}
                open={openRow?.key ?? null}
                focus={sceneFocus}
                picture={!isVideo}
                read={scenesRead}
                onwhole={keepWholeVideo}
                onseveral={severalPlaces}
                onopen={pickScene}
                onmark={markPicture}
                onplay={playScene}
                ongo={goToScene}
                ongeolocate={geolocate}
                onabandon={abandon}
                onrestore={bringBack}
                onlabel={labelScene}
                onend={endSceneHere}
                onremove={removeScene}
                onopenproof={openSceneProof}
                onmakeproof={makeProof}
                onhere={sceneHere}
                onkind={sceneKind}
                onnudge={nudgeScene}
                onaddmoment={addMoment}
                onjoin={joinScene}
                onjoinwhole={joinWhole}
                ongivetime={giveTime}
                onapply={applySceneEdit}
                oncancel={dropSceneEdit}
              />
            {:else if shownTab === 'info'}
              <InfoPanel caseId={work.caseId} source={work.source} probe={probeInfo} frame={selected === 'video' ? null : activeFrame} />
            {:else if selected === 'video' && shownTab === 'adjust'}
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
                oncapture={captureFrame}
                {scan}
                {scanning}
                progress={scanProgress}
                onscan={runScan}
                tiles={overview?.tiles ?? null}
                stripUrl={overview?.stripUrl ?? null}
              />
            {:else if shownTab === 'adjust'}
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
      captures={proofChooser.captures}
      collages={proofChooser.collages}
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
  /* some of them still to prove */
  .ptab .count.todo {
    background: var(--accent);
    color: var(--accent-text);
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
