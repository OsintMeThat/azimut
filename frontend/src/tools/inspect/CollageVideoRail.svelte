<script>
  import { untrack } from 'svelte';
  import { api, detailLine } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import {
    VIDEO_ADJUST_IDS, adjustDefaults, buildFrameOps, normalizeRightAngleRotation, previewStyle, rotationOps, videoSeed,
  } from '../../lib/inspect.js';
  import { captureMoment, frameDuration, frameIndex, seekInto, shownFrameTime } from '../../lib/inspectPlayer.js';
  import { workState } from '../../lib/inspectWork.svelte.js';
  import { sceneList, sceneMarks } from '../../lib/scenes.js';
  import { COLLAGE_RAIL_HELP } from '../../lib/inspectHelp.js';
  import { toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import VideoPlayer from './VideoPlayer.svelte';

  // Collage's video: the clip its pieces come from, in Inspect's player and bar, under the
  // canvas or, for a clip filmed upright, beside it. Add frame lays the frame on screen on
  // the collage, as Inspect cut it when it did there (its crop and its light kept), else as
  // the clip shows with Inspect's turn and light. Panorama takes the A–B loop as the stretch
  // of a pan: the server picks its frames (`/inspect/panorama-frames`) and Collage stitches
  // them. Each piece cut from the clip is a dot on the bar, ringed while it is in hand; a
  // dot reached paused, by a press or a step, takes its piece in hand, and a piece taken in
  // hand on the canvas brings the clip to its frame.
  //
  // `video` is `{ path, title }`; `pieces` the collage's pieces cut from it, `{ id, time }`;
  // `selected` the one in hand, if it is one of them. `onadd({ frameId, save, blob })` puts
  // a frame on the collage, `onpanorama({ path, start, end, ops })` makes the panorama and
  // `busy` says what it is doing; `onpick(id)` takes a piece in hand. `upright` tells the
  // parent the clip stands taller than wide, `size` is the rail's height, or its width
  // beside the canvas, and `folded` keeps only its title.
  let {
    caseId, video, filters = [], pieces = [], selected = null, busy = '', side = 'bottom',
    upright = $bindable(false), size = $bindable(260), folded = $bindable(false),
    onadd, onpanorama, onpick,
  } = $props();

  let probe = $state(null);
  let spec = $state(null); // the clip's work in Inspect: its light, its turn, its frames, its scenes
  let listing = $state(null); // { scenes, taken }, the scenes the server lists for the clip
  let overview = $state(null); // { tiles, waveform, stripUrl }
  let scan = $state(null); // { frames, shots }, a scan Inspect ran on the clip
  let shared = $state({ currentTime: 0, frameTime: null, seekTo: null, cropMode: false });
  let loop = $state({ a: null, b: null });
  let videoEl = $state(null);
  let player = $state(null);
  let root = $state(null);
  let adding = $state(false);
  let runs = 0;
  // Whether the hand has been in the rail since the clip opened: until then the frame it
  // opens on takes no piece in hand.
  let touched = false;

  const path = $derived(video?.path ?? null);
  const fps = $derived(probe?.fps ?? null);
  const duration = $derived(probe?.duration ?? 0);
  const rotation = $derived(normalizeRightAngleRotation(spec?.videoRotation));
  const videoFilters = $derived(filters.filter((f) => VIDEO_ADJUST_IDS.includes(f.id)));
  const videoAdjust = $derived({ ...adjustDefaults(videoFilters), ...(spec?.videoAdjust ?? {}) });
  const preview = $derived(previewStyle(videoFilters, videoAdjust));
  const transform = $derived([preview.transform, rotation ? `rotate(${rotation}deg)` : ''].filter(Boolean).join(' '));
  // a frame of the clip as Inspect shows it: its turn, and the light set on the video
  const clipOps = $derived(buildFrameOps(filters, { sourceOps: rotationOps(rotation), adjust: videoSeed(filters, videoAdjust) }));

  const sameFrame = (a, b) => frameIndex(a, fps) === frameIndex(b, fps);
  // the frames Inspect cut from the clip, with their own crop and light
  const cutFrames = $derived((spec?.frames ?? []).filter((f) => f.time != null));
  const dots = $derived(
    [...pieces].sort((x, y) => x.time - y.time).map((p) => ({ id: p.id, time: p.time, label: 'On the collage', on: p.id === selected })),
  );
  const cutMarks = $derived(
    cutFrames
      .filter((f) => !pieces.some((p) => sameFrame(p.time, f.time)))
      .map((f) => ({ id: f.id, time: f.time, label: 'Cut in Inspect' })),
  );
  const scenes = $derived(
    listing
      ? sceneList(
          listing.scenes,
          (spec?.scenes ?? []).map(({ id, start, end, label, more }) => ({ id, start, end, label, more })),
          listing.taken,
        )
      : [],
  );
  const marks = $derived(sceneMarks(scenes));

  // A stretch to stitch: both ends of the loop set, at least two frames apart.
  const stretch = $derived(
    loop.a != null && loop.b != null && loop.b - loop.a >= 2 * frameDuration(fps) ? { start: loop.a, end: loop.b } : null,
  );

  // -- reading the clip ---------------------------------------------------------------
  $effect(() => {
    const at = path;
    untrack(() => load(at));
  });

  // A frame cut in Inspect since, or a scene kept there, shows on the bar.
  $effect(() => {
    workState.rev;
    untrack(() => readWork(runs));
  });

  async function readWork(run) {
    if (!caseId || !path) return;
    const q = encodeURIComponent(path);
    try {
      const [work, listed] = await Promise.all([
        api.get(`/api/cases/${caseId}/inspect/work?path=${q}`).then((r) => r.work),
        api.get(`/api/cases/${caseId}/scenes?video=${q}`).catch(() => null),
      ]);
      if (run !== runs) return;
      spec = work?.spec ?? null;
      listing = listed ? { scenes: listed.scenes ?? [], taken: listed.taken ?? [] } : null;
    } catch {
      // a clip nothing was done to in Inspect plays as it is
      if (run === runs) spec = null;
    }
  }

  async function load(at) {
    const run = ++runs;
    touched = false;
    probe = spec = listing = overview = scan = null;
    loop = { a: null, b: null };
    shared = { currentTime: 0, frameTime: null, seekTo: null, cropMode: false };
    if (!caseId || !at) return;
    const q = encodeURIComponent(at);
    const [probed] = await Promise.all([
      api.get(`/api/cases/${caseId}/inspect/probe?path=${q}`).catch(() => null),
      readWork(run),
    ]);
    if (run !== runs) return;
    probe = probed;
    loadOverview(run, at);
  }

  async function pollJob(jobId) {
    for (;;) {
      const job = await api.get(`/api/jobs/${jobId}`);
      if (job.status === 'done') return job.result;
      if (job.status === 'error') throw new Error(job.error);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // The hover strip and the waveform, as Inspect draws them, and a scan it ran.
  async function loadOverview(run, at) {
    try {
      const res = await api.post(`/api/cases/${caseId}/inspect/overview`, { path: at });
      if (run !== runs) return;
      if (res?.scan) scan = res.scan;
      const found = res?.overview ?? (res?.job_id ? await pollJob(res.job_id) : null);
      if (run !== runs || !found) return;
      overview = {
        tiles: found.tiles ?? null,
        waveform: found.waveform ?? null,
        stripUrl: found.tiles ? `/api/cases/${caseId}/inspect/overview/strip?path=${encodeURIComponent(at)}` : null,
      };
    } catch {
      // without ffmpeg the bar is plainer
    }
  }

  // Taller than wide once turned, as the clip shows: the rail goes beside the canvas.
  $effect(() => {
    const w = Number(probe?.width) || 0;
    const h = Number(probe?.height) || 0;
    const turned = Math.abs(rotation) === 90;
    upright = w > 0 && h > 0 && (turned ? w : h) > (turned ? h : w) * 1.05;
  });

  // -- pieces and the bar ----------------------------------------------------------------
  const shown = $derived(shownFrameTime(shared.currentTime, fps, shared.frameTime));

  // A piece taken in hand elsewhere brings the clip to its frame, unless it plays.
  $effect(() => {
    const id = selected;
    void probe; // and once the clip is read, for the piece in hand as it opens
    void videoEl;
    untrack(() => {
      const piece = pieces.find((p) => p.id === id);
      if (!piece || !videoEl || !videoEl.paused || sameFrame(piece.time, shown)) return;
      shared.seekTo = seekInto(piece.time, fps, duration);
    });
  });

  // The clip stopped on a piece's frame, by a press on its dot or a step, takes it in hand.
  $effect(() => {
    const at = shown;
    untrack(() => {
      if (!touched || !videoEl?.paused) return;
      const piece = pieces.find((p) => sameFrame(p.time, at));
      if (piece && piece.id !== selected) onpick?.(piece.id);
    });
  });

  // A press on a scene's band takes its passage as the A–B loop.
  function pressedScene(key) {
    const passages = marks.filter((m) => m.scene === key && m.end != null);
    const at = passages.find((m) => m.start <= shared.currentTime && shared.currentTime <= m.end) ?? passages[0];
    if (at) loop = { a: at.start, b: at.end };
  }

  async function addHere() {
    if (!path || adding) return;
    adding = true;
    const run = runs;
    try {
      const at = captureMoment(shared.currentTime, shared.frameTime);
      // a frame Inspect cut here comes as it was cut
      const cut = cutFrames.find((f) => sameFrame(f.time, at)) ?? null;
      const ops = cut ? buildFrameOps(filters, cut) : clipOps;
      const res = await fetch(`/api/cases/${caseId}/inspect/render-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, time: cut ? cut.time : at, ops, snap: !cut }),
      });
      if (!res.ok) {
        let detail = 'The frame could not be read';
        try {
          detail = detailLine((await res.json()).detail) || detail;
        } catch {
          /* not json */
        }
        throw new Error(detail);
      }
      const named = Number(res.headers.get('X-Frame-Time'));
      const time = cut ? cut.time : res.headers.has('X-Frame-Time') && Number.isFinite(named) ? named : at;
      const blob = await res.blob();
      if (run !== runs) return;
      await onadd?.({ frameId: cut?.id ?? null, save: { path, time, ops }, blob });
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      adding = false;
    }
  }

  function panorama() {
    if (!stretch || busy) return;
    onpanorama?.({ path, start: stretch.start, end: stretch.end, ops: clipOps });
  }

  // -- keys and size ----------------------------------------------------------------------
  // The rail answers the player's keys while the hand is in it, and keeps them from the
  // canvas, whose arrows move the piece in hand.
  function onkeydown(e) {
    touched = true;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const acts = {
      ' ': () => player?.togglePlay(),
      ArrowLeft: () => (e.shiftKey ? player?.stepBy(-1) : player?.stepFrames(-1)),
      ArrowRight: () => (e.shiftKey ? player?.stepBy(1) : player?.stepFrames(1)),
      j: () => player?.slower(),
      l: () => player?.faster(),
      c: () => addHere(),
      '+': () => player?.zoomBar(1),
      '=': () => player?.zoomBar(1),
      '-': () => player?.zoomBar(-1),
    };
    const act = acts[key];
    if (!act || (t.tagName === 'BUTTON' && (key === ' ' || key === 'Enter'))) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }

  function onpointerdown(e) {
    touched = true;
    if (!e.target.closest?.('button, input, [tabindex="0"]')) root?.focus({ preventScroll: true });
  }

  const MIN = 150;
  function grab(e) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const from = side === 'left' ? e.clientX : e.clientY;
    const start = size;
    const room = side === 'left' ? window.innerWidth * 0.55 : window.innerHeight * 0.7;
    const move = (ev) => {
      const by = side === 'left' ? ev.clientX - from : from - ev.clientY;
      size = Math.round(Math.min(Math.max(MIN, start + by), Math.max(MIN, room)));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
</script>

{#snippet actions()}
  <span class="rail-acts" role="group" aria-label="Collage">
    <button class="btn btn-sm" disabled={adding || !!busy} onclick={addHere} title={COLLAGE_RAIL_HELP.add}>
      <Icon name="plus" size={13} /> Add frame
    </button>
    <button
      class="btn btn-sm btn-primary"
      disabled={!stretch || !!busy}
      onclick={panorama}
      title={stretch ? COLLAGE_RAIL_HELP.panorama : COLLAGE_RAIL_HELP.panoramaFirst}
      data-guide="collage.panorama"
    >
      <Icon name={busy ? 'clock' : 'hash'} size={13} /> {busy || 'Panorama'}
    </button>
  </span>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section
  class="rail {side}"
  class:folded
  bind:this={root}
  tabindex="-1"
  aria-label="Video"
  data-testid="collage-rail"
  data-guide="collage.rail"
  style:height={!folded && side === 'bottom' ? `${size}px` : null}
  style:width={!folded && side === 'left' ? `${size}px` : null}
  {onkeydown}
  {onpointerdown}
>
  {#if !folded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="grip" onpointerdown={grab} title={COLLAGE_RAIL_HELP.resize} aria-hidden="true"></span>
  {/if}
  <header class="rail-head">
    <Icon name="video" size={13} />
    <span class="rail-title" title={video?.title}>{video?.title}</span>
    <button
      class="btn btn-ghost btn-xs"
      onclick={() => (folded = !folded)}
      aria-label={folded ? 'Show the video' : 'Fold the video'}
      title={folded ? COLLAGE_RAIL_HELP.unfold : COLLAGE_RAIL_HELP.fold}
    >
      <Icon name={folded ? 'chevronUp' : 'chevronDown'} size={14} />
    </button>
  </header>
  {#if !folded && path}
    <div class="rail-player">
      <VideoPlayer
        bind:this={player}
        bind:video={videoEl}
        bind:shared
        bind:loop
        src={fileUrl(caseId, path)}
        filter={preview.filter}
        {transform}
        quarterTurn={Math.abs(rotation) === 90}
        {duration}
        {fps}
        frames={dots}
        marks={cutMarks}
        shots={scan?.shots ?? []}
        picks={scan?.frames ?? []}
        scenes={marks}
        tiles={overview?.tiles ?? null}
        stripUrl={overview?.stripUrl ?? null}
        waveform={overview?.waveform ?? null}
        onscene={pressedScene}
        keys={COLLAGE_RAIL_HELP.keys}
        {actions}
      />
    </div>
  {/if}
</section>

<style>
  .rail {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-1);
    outline: none;
  }
  .rail.bottom {
    border-top: 1px solid var(--border);
  }
  .rail.left {
    border-right: 1px solid var(--border);
  }
  .rail.folded {
    height: auto;
    border-top: 1px solid var(--border);
    border-right: none;
  }
  .rail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 10px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .rail-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
  .rail-player {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .rail-acts {
    display: inline-flex;
    gap: 6px;
    margin-left: 6px;
  }
  /* The edge toward the canvas drags the rail larger or smaller. */
  .grip {
    position: absolute;
    z-index: 2;
    touch-action: none;
  }
  .bottom .grip {
    left: 0;
    right: 0;
    top: -3px;
    height: 7px;
    cursor: ns-resize;
  }
  .left .grip {
    top: 0;
    bottom: 0;
    right: -3px;
    width: 7px;
    cursor: ew-resize;
  }
  .grip:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
</style>
