<script>
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { caseState, uiState, reloadCase, toast } from '../lib/state.svelte.js';
  import {
    adjustDefaults, buildFrameOps, previewStyle, uid, videoSeed, VIDEO_ADJUST_IDS,
    hasVideoEdits, normalizeRightAngleRotation, rotationOps, sourceStem, frameSaveNames,
  } from '../lib/inspect.js';
  import {
    workState, workSpec, isPristine, frameSignature, videoSignature, isFiled,
  } from '../lib/inspectWork.svelte.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { deletedToast } from '../lib/trash.js';
  import { openInReverseSearch } from '../lib/navigate.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import SourcePicker from '../components/SourcePicker.svelte';
  import FrameStrip from './inspect/FrameStrip.svelte';
  import FrameViewer from './inspect/FrameViewer.svelte';
  import FrameMenu from './inspect/FrameMenu.svelte';
  import VideoMenu from './inspect/VideoMenu.svelte';
  import VideoPlayer from './inspect/VideoPlayer.svelte';

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
  let saving = $state(null); // 'video', 'all' or a frame id while its save runs
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
    activeFrameId: null,
  });

  // Bumped whenever the open file changes, so a render or a capture that returns
  // afterwards can tell it belongs to a file no longer open.
  let openRun = 0;
  // Every preview blob this file made. A duplicated frame shares its original's,
  // so they are freed together when the file closes rather than one at a time.
  const blobs = new Set();

  const videoFilters = $derived(filters.filter((f) => VIDEO_ADJUST_IDS.includes(f.id)));
  const isVideo = $derived(work.source?.kind === 'video');
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
      refresh(id).then(recheckOpenFile);
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
    work.activeFrameId = null;
    savedSignature = null;
    probeInfo = null;
    shared.currentTime = 0;
    shared.cropMode = false;
    cropEditing = false;
    cropBefore = null;
    frameAspect = null;
  }

  async function open(item) {
    pickerOpen = false;
    await autosave.flush();
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
    } catch (e) {
      if (run === openRun) {
        toast(e.message, 'danger');
        closeFile();
      }
    } finally {
      if (run === openRun) opening = false;
    }
  }

  /** Back to the file list. Nothing is lost: what is pending is written first. */
  async function leave() {
    await autosave.flush();
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
      if (target) open(target);
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
  async function renderBlob(path, time, ops = []) {
    const res = await fetch(`/api/cases/${work.caseId}/inspect/render-preview`, {
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
    return res.blob();
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

  // -- frames -----------------------------------------------------------------------
  async function capture(time) {
    // Two round trips, long enough on a slow video to switch file in between. The
    // frame is evidence, so a late one is dropped rather than put in another file.
    const run = openRun;
    try {
      const sourceOps = rotationOps(videoRotation);
      const url = await renderUrl(work.source.path, time, sourceOps);
      const dim = await imageSize(url);
      if (run !== openRun) return;
      const frame = makeFrame(work.source.path, time);
      Object.assign(frame, { url, sourceOps, w: dim.w, h: dim.h });
      // frames cut from an adjusted clip start from its adjustments
      frame.adjust = videoSeed(filters, work.videoAdjust);
      work.frames.push(frame);
    } catch (e) {
      if (run === openRun) toast(e.message, 'danger');
    }
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
  // The bridge between the player and its panel: where the clip is, where to seek,
  // and whether the frame viewer is drawing a crop box.
  const shared = $state({ currentTime: 0, seekTo: null, cropMode: false });
  let videoEl = $state();
  const frameDur = $derived(probeInfo?.fps ? 1 / probeInfo.fps : 1 / 30);

  $effect(() => {
    if (shared.seekTo != null && videoEl) {
      videoEl.currentTime = shared.seekTo;
      shared.seekTo = null;
    }
  });

  function stepVideo(delta) {
    const duration = probeInfo?.duration ?? Infinity;
    shared.seekTo = Math.min(Math.max((shared.currentTime ?? 0) + delta, 0), duration);
  }

  function onWindowKeydown(e) {
    if (uiState.tool !== 'inspect' || !work.source || pickerOpen) return;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (e.ctrlKey || e.metaKey) return;
    if (activeFrame && cropEditing) {
      if (e.key === 'Enter') { e.preventDefault(); commitCrop(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelCrop(); }
      return;
    }
    // On the video: ←/→ step one frame (Shift = 1 s), with mpv's , and . as aliases.
    if (selected !== 'video') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepVideo(e.shiftKey ? -1 : -frameDur); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); stepVideo(e.shiftKey ? 1 : frameDur); }
    else if (e.key === ',') { e.preventDefault(); stepVideo(-frameDur); }
    else if (e.key === '.') { e.preventDefault(); stepVideo(frameDur); }
    else if (e.key === ' ' && videoEl) {
      e.preventDefault();
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    }
  }

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

  async function saveFrame(frame, { name, folder, note }) {
    saving = frame.id;
    saveFolder = folder ?? '';
    try {
      const saved = await saveFrames([frame], { folder, note, names: [name] });
      toast(`Saved “${name}” to the case${dupeNote(saved)}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = null;
    }
  }

  async function saveAllFrames() {
    const frames = work.frames.filter((f) => !filedIds.has(f.id) && f.url);
    if (!frames.length) return;
    saving = 'all';
    try {
      const saved = await saveFrames(frames, {
        folder: saveFolder || null, note: null, names: frames.map((f) => frameNames.get(f.id)),
      });
      toast(`Saved ${frames.length} frames to the case${dupeNote(saved)}`, 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      saving = null;
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

<svelte:window onkeydown={onWindowKeydown} {onpagehide} />

<div class="tool">
  {#if work.source}
    <div class="tool-header">
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
        <button class="btn btn-ghost btn-sm" onclick={() => (clearConfirm = true)} title="Send this file's frames and edits to the Trash">
          <Icon name="reset" size={14} /> Clear work
        </button>
      {/if}
      <button class="btn btn-sm" onclick={() => (pickerOpen = true)} title="Open another image or video">
        <Icon name="folderOpen" size={14} /> Change file
      </button>
      <button class="btn btn-ghost btn-sm" onclick={leave} title="Back to the file list" aria-label="Close file">
        <Icon name="x" size={15} />
      </button>
    </div>
  {/if}

  {#if !caseState.current}
    <div class="empty">
      <Icon name="inspect" size={40} />
      <p>Open a case and add media to start inspecting.</p>
      <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
    </div>
  {:else if !work.source}
    {#if inspectable.length === 0}
      <div class="empty">
        <Icon name="inspect" size={40} />
        <p>Add an image or a video to the case to inspect it.</p>
        <button class="btn" onclick={() => (uiState.tool = 'media')}>Go to Media Library</button>
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
              bind:video={videoEl}
              src={fileUrl(work.caseId, work.source.path)}
              filter={videoPreview.filter}
              transform={videoTransform}
              quarterTurn={Math.abs(videoRotation) === 90}
              duration={probeInfo?.duration ?? 0}
              currentTime={shared.currentTime}
              ontimeupdate={(time) => (shared.currentTime = time)}
            />
          {:else if activeFrame?.url}
            <FrameViewer
              frame={activeFrame}
              preview={framePreview}
              aspect={frameAspect}
              {cropEditing}
              bind:cropMode={shared.cropMode}
              onbegincrop={beginCrop}
              oncommitcrop={commitCrop}
            />
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
            removable={isVideo || work.frames.length > 1}
            savingAll={saving === 'all'}
            onselect={select}
            onremove={removeFrame}
            onsaveall={saveAllFrames}
          />
        {/if}
      </div>

      <aside class="panel">
        {#if opening}
          <p class="hint">Opening…</p>
        {:else if selected === 'video'}
          <VideoMenu
            {probeInfo} {shared} {videoFilters} {work} {capture}
            {videoEdited}
            videoSave={{
              defaultName: `${stemFor(work.source.path)} (enhanced)`,
              filedPath: videoFiled ? work.videoFiled.path : null,
              busy: saving === 'video',
              onsave: saveVideo,
            }}
            bind:folder={saveFolder}
          />
        {:else if activeFrame}
          {#key activeFrame.id}
            <FrameMenu
              frame={activeFrame} {filters} {analyses} {shared}
              bind:cropAspect={frameAspect} bind:cropEditing {beginCrop} {commitCrop}
              setRotation={setFrameRotation} {rotationBusy}
              reverse={reverseFrame}
              onduplicate={duplicateFrame}
              frameSave={{
                defaultName: frameNames.get(activeFrame.id),
                filedPath: filedIds.has(activeFrame.id) ? activeFrame.filed.path : null,
                busy: saving === activeFrame.id || saving === 'all',
                blocked: activeFrame.url ? '' : 'The frame is still rendering.',
                onsave: (opts) => saveFrame(activeFrame, opts),
              }}
              bind:folder={saveFolder}
            />
          {/key}
        {/if}
      </aside>
    </div>
  {/if}

  {#if pickerOpen && caseState.current}
    <Modal title="Open a file" width="720px" onclose={() => (pickerOpen = false)}>
      <SourcePicker media={inspectable} {works} caseId={caseState.current.id} current={work.source?.path} onpick={open} />
    </Modal>
  {/if}

  {#if clearConfirm}
    <ConfirmDialog
      title="Clear the work on this file?"
      message="Its frames and edits go to the Trash."
      detail="Media already saved to the case stays where it is."
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
  .hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    margin: 0;
  }
</style>
