<script>
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { clampTime, frameDuration, preciseClock, seekInto, shownFrameTime } from '../../lib/inspectPlayer.js';
  import { shortClock } from '../../lib/scenes.js';
  import { INSTANT_HOLD, playSegments, segmentAt } from '../../lib/proofScene.js';
  import { PROOF_SCENE_HELP } from '../../lib/proofSceneHelp.js';

  // The proof's video, in the Scene tab under its field: the clip played muted, at
  // its own shape, a thin bar of it with the scene's moments in the scene's colour
  // and the panels' frames as dots, a frame at a time, and the frame on screen added
  // to the proof as a panel.
  //
  // `request` is how the rest of the block points it somewhere: `{ at, play, n }`,
  // a new `n` each time. `at` shows that frame, paused; `play` runs through the
  // scene's moments over and over, each passage played and each instant held, or the
  // whole video from `from`, the first frame a panel was cut at. That loop never
  // starts by itself for someone who asked the system for less motion, and nothing
  // here ever plays sound unasked.
  //
  // The Collage tool shows it too, to change the moment its collage was marked over:
  // the dots are its pieces' frames, `help` says so, and with no `onaddframe` there is
  // no frame to add.
  let {
    caseId,
    video,
    // What the bar draws, `{ start, end }` each (an end of null is an instant), and
    // which of them is in hand while the time is being changed.
    moments = [],
    held = -1,
    color = 'var(--accent)',
    // The panels cut from this video: `{ panel, time }` each.
    frames = [],
    from = 0,
    request = null,
    // Whether its tab is shown: a hidden one stops, and keeps its frame.
    active = true,
    adding = false,
    help = PROOF_SCENE_HELP,
    onclip,
    onaddframe = null,
  } = $props();

  let root = $state(null);
  let el = $state(null);
  let bar = $state(null);
  let info = $state({ duration: 0, fps: null });
  let mediaDuration = $state(0);
  // The clip's own width over its height, once the browser knows it: a phone held
  // upright fills the tab's room rather than a sliver of a wide box.
  let ratio = $state(16 / 9);
  let current = $state(0);
  let presented = $state(null);
  let paused = $state(true);
  let muted = $state(true);
  // Running through the scene's moments: what the loop button shows, and what a
  // press anywhere else on the player stops.
  let looping = $state(false);
  // `settled` waits for the first frame drawn inside the segment just gone to, since
  // the browser can still report one from before the seek.
  let seq = { list: [], at: 0, settled: false };
  let holdTimer = null;

  const fps = $derived(info.fps);
  const frame = $derived(frameDuration(fps));
  const duration = $derived(info.duration || mediaDuration || 0);
  const shown = $derived(shownFrameTime(current, fps, presented));
  const at = (time) => (duration > 0 ? `${Math.min(100, Math.max(0, (time / duration) * 100))}%` : '0%');
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // What the clip is: its length and rate, read once per video. The block's time
  // editor reads them too, to keep a typed time inside the clip and on a frame.
  $effect(() => {
    const path = video;
    let live = true;
    info = { duration: 0, fps: null };
    api.get(`/api/cases/${caseId}/inspect/probe?path=${encodeURIComponent(path)}`)
      .then((probe) => {
        if (!live) return;
        info = { duration: Number(probe?.duration) || 0, fps: Number(probe?.fps) || null };
        onclip?.(info);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  // The frame the browser drew, so the clock and Add this frame name the very frame
  // on screen, and the loop leaves a passage at its last frame rather than a quarter
  // of a second past it.
  $effect(() => {
    const node = el;
    if (!node?.requestVideoFrameCallback) return;
    let handle = 0;
    const tick = (_now, meta) => {
      handle = node.requestVideoFrameCallback(tick);
      // paused, a report a frame or more from where the clip stands is the frame
      // drawn before the last seek, come late
      if (!node.paused || Math.abs(meta.mediaTime - node.currentTime) <= frame) presented = meta.mediaTime;
      reachedEnd(meta.mediaTime);
    };
    handle = node.requestVideoFrameCallback(tick);
    return () => node.cancelVideoFrameCallback?.(handle);
  });

  // Pointed somewhere by the block: a panel's frame, the scene's start, or the loop.
  let seen = 0;
  $effect(() => {
    const ask = request;
    if (!ask || ask.n === seen || !el) return;
    seen = ask.n;
    // brought into the side column's view, opened from the canvas or another tool
    root?.scrollIntoView?.({ block: 'nearest' });
    if (ask.play && !reduced()) {
      startLoop();
    } else {
      stop();
      const first = playSegments(moments, from)[0];
      seek(ask.at ?? first.start);
    }
  });

  $effect(() => () => clearTimeout(holdTimer));

  // The tab left: nothing plays where nobody sees it.
  $effect(() => {
    if (!active) untrack(stop);
  });

  /** Show the frame that starts at `time`, half a frame into it. */
  function seek(time) {
    if (!el) return;
    presented = null;
    el.currentTime = seekInto(clampTime(time, fps, duration), fps, duration);
    current = el.currentTime;
  }

  function stop() {
    looping = false;
    clearTimeout(holdTimer);
    el?.pause();
  }

  /** Run through the scene, from the moment the clip is in, else the first. */
  function startLoop() {
    seq = { list: playSegments(moments, from), at: 0 };
    seq.at = segmentAt(seq.list, shown);
    looping = true;
    go();
  }

  function go() {
    clearTimeout(holdTimer);
    const segment = seq.list[seq.at];
    if (!segment || !el) return;
    seq.settled = false;
    seek(segment.start);
    if (segment.kind === 'instant') {
      el.pause();
      holdTimer = setTimeout(next, INSTANT_HOLD * 1000);
    } else {
      el.play()?.catch?.(() => (looping = false));
    }
  }

  function next() {
    if (!looping) return;
    seq.at = (seq.at + 1) % seq.list.length;
    go();
  }

  function reachedEnd(time) {
    const segment = looping ? seq.list[seq.at] : null;
    if (segment?.kind !== 'passage') return;
    if (!seq.settled) {
      seq.settled = time >= segment.start - frame && time < segment.end;
      return;
    }
    if (time >= segment.end - frame / 2) next();
  }

  function onended() {
    if (looping) go(); // the whole video, again from its first panel's frame
  }

  function toggle() {
    if (!el) return;
    if (looping || !el.paused) {
      stop();
      return;
    }
    el.play()?.catch?.(() => {});
  }

  function toggleLoop() {
    if (looping) stop();
    else startLoop();
  }

  function step(direction, wholeSecond) {
    stop();
    seek(shown + direction * (wholeSecond ? 1 : frame));
  }

  /** The frame on screen, and the end of it: where a moment starts, and a passage ends. */
  export function frameNow() {
    return { start: shown, end: shown + frame };
  }

  /** Show the frame starting at `time`, paused. */
  export function show(time) {
    stop();
    seek(time);
  }

  // -- the bar ----------------------------------------------------------------------
  let dragging = false;

  function timeAtPointer(event) {
    const rect = bar.getBoundingClientRect();
    const x = Math.min(Math.max(0, event.clientX - rect.left), rect.width);
    return rect.width > 0 ? (x / rect.width) * duration : 0;
  }

  function pressBar(event) {
    if (!(duration > 0) || event.button !== 0) return;
    stop();
    dragging = true;
    bar.setPointerCapture?.(event.pointerId);
    seek(timeAtPointer(event));
  }

  function dragBar(event) {
    if (dragging) seek(timeAtPointer(event));
  }

  function releaseBar(event) {
    dragging = false;
    bar.releasePointerCapture?.(event.pointerId);
  }

  // The player's own keys, kept from the composer behind it, where Space pans the
  // page and the arrows move a picked mark.
  function onkeydown(event) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    const { key } = event;
    if (key === ' ' || key === 'k') toggle();
    else if (key === 'ArrowLeft' || key === ',') step(-1, event.shiftKey);
    else if (key === 'ArrowRight' || key === '.') step(1, event.shiftKey);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scene-player" bind:this={root} style:--scene={color} {onkeydown} data-testid="scene-player">
  <div class="screen" style:aspect-ratio={ratio}>
    <!-- svelte-ignore a11y_media_has_caption a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <video
      bind:this={el}
      src={fileUrl(caseId, video)}
      preload="auto"
      playsinline
      bind:muted
      bind:paused
      bind:currentTime={current}
      bind:duration={mediaDuration}
      {onended}
      onloadedmetadata={() => { if (el.videoWidth > 0 && el.videoHeight > 0) ratio = el.videoWidth / el.videoHeight; }}
      ontimeupdate={() => reachedEnd(el.currentTime)}
      onclick={toggle}
    ></video>
  </div>
  <div
    class="bar"
    bind:this={bar}
    role="slider"
    tabindex="0"
    aria-label="Video position"
    aria-valuemin="0"
    aria-valuemax={Math.round(duration * 1000) / 1000}
    aria-valuenow={Math.round(shown * 1000) / 1000}
    aria-valuetext={preciseClock(shown)}
    title={help.bar}
    onpointerdown={pressBar}
    onpointermove={dragBar}
    onpointerup={releaseBar}
    onpointercancel={releaseBar}
  >
    <span class="rail"></span>
    {#each moments as m, i (i)}
      {#if m.end != null && m.end > m.start}
        <span class="band" class:held={i === held} style:left={at(m.start)} style:width={`calc(${at(m.end)} - ${at(m.start)})`} data-testid="scene-band"></span>
      {:else}
        <span class="pin" class:held={i === held} style:left={at(m.start)} data-testid="scene-pin"></span>
      {/if}
    {/each}
    <span class="head" style:left={at(shown)}></span>
    {#each frames as f (f.panel)}
      <button
        class="dot"
        style:left={at(f.time)}
        title={help.panelFrame}
        aria-label={`Panel frame at ${preciseClock(f.time)}`}
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => show(f.time)}
      ></button>
    {/each}
  </div>
  <div class="controls">
    <button class="ctl" onclick={toggle} title={help.play} aria-label={looping || !paused ? 'Pause' : 'Play'}>
      <Icon name={looping || !paused ? 'pause' : 'play'} size={13} />
    </button>
    <button class="ctl" onclick={(e) => step(-1, e.shiftKey)} title={help.frameBack} aria-label="Back one frame">
      <Icon name="chevronLeft" size={13} />
    </button>
    <button class="ctl" onclick={(e) => step(1, e.shiftKey)} title={help.frameForward} aria-label="Forward one frame">
      <Icon name="chevronRight" size={13} />
    </button>
    <span class="clock mono" title={help.clock}>
      {preciseClock(shown)}{#if duration > 0}<span class="total">/ {shortClock(duration)}</span>{/if}
    </span>
    <button class="ctl" class:on={looping} onclick={toggleLoop} title={help.loop} aria-label="Loop the scene" aria-pressed={looping}>
      <Icon name="always" size={14} />
    </button>
    <button class="ctl" class:on={!muted} onclick={() => (muted = !muted)} title={help.mute} aria-label={muted ? 'Sound on' : 'Sound off'}>
      <Icon name={muted ? 'volumeOff' : 'volume'} size={13} />
    </button>
  </div>
  {#if onaddframe}
    <button class="btn btn-xs add-frame" disabled={adding} onclick={() => onaddframe(video, shown)} title={help.addFrame}>
      <Icon name="plus" size={11} /> {adding ? 'Adding…' : 'Add this frame'}
    </button>
  {/if}
</div>

<style>
  .scene-player {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  /* At the clip's own shape, up to the part of the window a player can take. */
  .screen {
    max-height: 45vh;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: #000;
  }
  .screen video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    cursor: pointer;
  }
  /* The clip in one thin line: its moments in the scene's colour, the panels' frames
     as dots on top, and where the player is. */
  .bar {
    position: relative;
    height: 14px;
    cursor: pointer;
    touch-action: none;
    border-radius: var(--r-sm);
  }
  .bar:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 5px;
    height: 4px;
    border-radius: 2px;
    background: var(--bg-3);
  }
  .band {
    position: absolute;
    top: 4px;
    height: 6px;
    min-width: 2px;
    border-radius: 2px;
    background: var(--scene);
    opacity: 0.85;
  }
  .pin {
    position: absolute;
    top: 1px;
    width: 3px;
    height: 12px;
    margin-left: -1.5px;
    border-radius: 1px;
    background: var(--scene);
  }
  .band.held,
  .pin.held {
    opacity: 1;
    box-shadow: 0 0 0 1px var(--text-1);
  }
  .head {
    position: absolute;
    top: 0;
    width: 2px;
    height: 14px;
    margin-left: -1px;
    background: var(--text-1);
    pointer-events: none;
  }
  .dot {
    position: absolute;
    top: 3px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    padding: 0;
    border-radius: 50%;
    background: var(--bg-0);
    box-shadow: inset 0 0 0 2px var(--text-1);
  }
  .dot:hover,
  .dot:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
    outline: none;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .ctl {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-2);
  }
  .ctl:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .ctl.on {
    color: var(--accent);
  }
  .clock {
    flex: 1;
    min-width: 0;
    padding: 0 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .total {
    margin-left: 0.35em;
    color: var(--text-3);
  }
  .add-frame {
    align-self: flex-start;
  }
</style>
