<script>
  import { barFraction, frameDuration, preciseClock, tileAt, tileScale, tileStyle, waveformBars } from '../../lib/inspectPlayer.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import { snapToFrame } from '../../lib/scenes.js';

  // The bar under the video: where the clip is, and what is known about it. The
  // scenes kept on it, a coloured band over a passage and a pin at an instant, the
  // frames cut from it, the marks set on it, the shots and the sharpest frames a
  // scan found, the loop, and the sound behind it all. Hovering shows the picture
  // at that point from the strip the server drew; a press near a marker lands on
  // it rather than a few pixels beside it.
  //
  // `onseek(time, exact)` hands the parent a time to show: `exact` is a frame's own
  // timestamp, which the parent seeks half a frame into.
  //
  // The scene whose time is open (`editing`: its key, start and end) has handles: its
  // pin, or a passage's two ends. Dragging one moves it by whole frames, catches on a
  // marker it passes close to, never crosses the other end, and shows the frame it
  // stands on; `onedit(which, time)` hands the time up. A press anywhere else still
  // moves through the clip.
  let {
    duration = 0,
    time = 0,
    frames = [],
    marks = [],
    shots = [],
    picks = [],
    scenes = [],
    loop = { a: null, b: null },
    tiles = null,
    stripUrl = null,
    waveform = null,
    editing = null,
    fps = null,
    onseek,
    onedit,
  } = $props();

  const SNAP_PX = 6;
  // The hover picture's bounds: a 16:9 tile at its own 160 × 90, a portrait one
  // shrunk to the same height rather than covering the video it previews.
  const PEEK = { w: 160, h: 96 };
  // How close to a handle a press takes it, a little wider than the handle drawn.
  const GRIP_PX = 8;

  let track = $state();
  let canvas = $state();
  let width = $state(0);
  let hover = $state(null); // { x, time, label }
  let dragging = $state(false);
  let grab = $state(null); // 'start' or 'end' while a handle is dragged
  let nearGrip = $state(false);

  const bars = $derived(waveformBars(waveform));
  const at = (t) => `${barFraction(t, duration) * 100}%`;

  // Everything a press may land on, nearest first when two are close.
  const targets = $derived([
    ...frames.map((f, i) => ({ time: f.time, label: `Frame ${i + 1}` })),
    ...marks.map((m) => ({ time: m.time, label: m.label || 'Mark' })),
    ...shots.map((s, i) => ({ time: s.start, label: `Shot ${i + 1}` })),
    ...picks.map((p) => ({ time: p.time, label: 'Sharp frame' })),
    ...scenes.map((s) => ({ time: s.start, label: s.label, key: s.key })),
  ].filter((t) => Number.isFinite(t.time)));
  // What a dragged handle catches on: the same, and where other scenes end, never
  // the scene being moved.
  const gripTargets = $derived(editing ? [
    ...targets,
    ...scenes.filter((s) => s.end != null).map((s) => ({ time: s.end, label: s.label, key: s.key })),
  ].filter((t) => t.key !== editing.key) : []);

  $effect(() => {
    if (!track) return;
    const update = () => (width = track.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => observer.disconnect();
  });

  // The sound, mirrored about the middle, one bar per pixel column or so.
  $effect(() => {
    if (!canvas || !width || !bars.length) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const h = canvas.clientHeight || 26;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, h);
    ctx.fillStyle = getComputedStyle(canvas).color;
    const step = width / bars.length;
    const mid = h / 2;
    for (let i = 0; i < bars.length; i += 1) {
      const half = Math.max(0.5, bars[i] * (mid - 1));
      ctx.fillRect(i * step, mid - half, Math.max(1, step - 0.5), half * 2);
    }
  });

  /** The marker within reach of `x` on a bar `w` pixels wide, if any. */
  function snapAt(x, w, among = targets) {
    if (!w || !(duration > 0)) return null;
    let best = null;
    for (const t of among) {
      const d = Math.abs((t.time / duration) * w - x);
      if (d <= SNAP_PX && (!best || d < best.d)) best = { ...t, d };
    }
    return best;
  }

  // The bar is measured at each press, so a resize never leaves a stale width behind.
  function point(clientX) {
    const rect = track.getBoundingClientRect();
    const w = rect.width;
    const x = Math.min(Math.max(0, clientX - rect.left), w);
    const snap = snapAt(x, w);
    if (snap) return { x: (snap.time / duration) * w, time: snap.time, label: snap.label, exact: true };
    return { x, time: w ? (x / w) * duration : 0, label: '', exact: false };
  }

  /** The handle within reach of `clientX`: the nearer end, or the one the press is past. */
  function gripAt(clientX) {
    if (!editing || !Number.isFinite(editing.start) || !(duration > 0)) return null;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    const px = (t) => (t / duration) * rect.width;
    const toStart = Math.abs(px(editing.start) - x);
    const toEnd = Number.isFinite(editing.end) ? Math.abs(px(editing.end) - x) : Infinity;
    if (Math.min(toStart, toEnd) > GRIP_PX) return null;
    if (toEnd < toStart || (toEnd === toStart && x >= px(editing.end))) return 'end';
    return 'start';
  }

  const gripLabel = (which) => (which === 'end' ? 'End' : Number.isFinite(editing?.end) ? 'Start' : 'Scene');

  /** Show the frame a handle stands on: the scene's first, or the last before its end. */
  function showGrip(which, time) {
    onseek?.(which === 'end' ? Math.max(0, time - frameDuration(fps)) : time, true);
  }

  function dragGrip(clientX) {
    const rect = track.getBoundingClientRect();
    const w = rect.width;
    const x = Math.min(Math.max(0, clientX - rect.left), w);
    const snap = snapAt(x, w, gripTargets);
    let time = snap ? snap.time : snapToFrame(w ? (x / w) * duration : 0, fps);
    const frame = frameDuration(fps);
    if (grab === 'end') time = Math.min(Math.max(time, editing.start + frame), duration);
    else time = Math.max(0, Math.min(time, Number.isFinite(editing.end) ? editing.end - frame : duration - frame));
    hover = { x: (time / duration) * w, time, label: snap ? `${gripLabel(grab)} · ${snap.label}` : gripLabel(grab), exact: true };
    onedit?.(grab, time);
    showGrip(grab, time);
  }

  function onpointerdown(e) {
    if (e.button !== 0 || !(duration > 0)) return;
    e.preventDefault();
    track.setPointerCapture?.(e.pointerId);
    const grip = gripAt(e.clientX);
    if (grip) {
      // Taken where it stands: it moves once the pointer does.
      grab = grip;
      showGrip(grip, grip === 'end' ? editing.end : editing.start);
      return;
    }
    dragging = true;
    const p = point(e.clientX);
    onseek?.(p.time, p.exact);
  }

  function onpointermove(e) {
    if (grab) {
      dragGrip(e.clientX);
      return;
    }
    nearGrip = gripAt(e.clientX) != null;
    const p = point(e.clientX);
    hover = p;
    if (dragging) onseek?.(p.time, p.exact);
  }

  function onpointerup(e) {
    dragging = false;
    grab = null;
    track.releasePointerCapture?.(e.pointerId);
  }

  const tile = $derived(hover ? tileAt(hover.time, tiles) : null);
  const hoverLeft = $derived.by(() => {
    if (!hover) return 0;
    const half = tiles ? (tiles.width * tileScale(tiles, PEEK)) / 2 : 40;
    return Math.min(Math.max(hover.x, half), Math.max(half, width - half));
  });
</script>

<div
  class="track"
  class:waved={bars.length > 0}
  class:resize={grab != null || (nearGrip && editing != null)}
  bind:this={track}
  role="slider"
  tabindex="0"
  aria-label="Video position"
  aria-valuemin="0"
  aria-valuemax={duration}
  aria-valuenow={time}
  aria-valuetext={preciseClock(time)}
  title={hover ? '' : editing ? INSPECT_HELP.barScene : INSPECT_HELP.bar}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  onpointerleave={() => {
    if (!grab) hover = null;
    nearGrip = false;
  }}
>
  {#if bars.length}<canvas class="wave" bind:this={canvas} aria-hidden="true"></canvas>{:else}<span class="rail"></span>{/if}
  {#each scenes as s (s.key)}
    {#if s.end != null}
      <span
        class="scene"
        class:held={s.key === editing?.key}
        data-testid="scene-band"
        style:left={at(s.start)}
        style:width={`${(barFraction(s.end, duration) - barFraction(s.start, duration)) * 100}%`}
        style:--scene={s.color}
      ></span>
    {:else}
      <span class="scene-pin" data-testid="scene-pin" style:left={at(s.start)} style:--scene={s.color}></span>
    {/if}
  {/each}
  <span class="played" style:width={at(time)}></span>
  {#if loop.a != null}
    <span
      class="loop"
      class:open={loop.b == null}
      style:left={at(loop.a)}
      style:width={loop.b != null ? `${(barFraction(loop.b, duration) - barFraction(loop.a, duration)) * 100}%` : '0'}
    ></span>
  {/if}
  {#each shots as s, i (i)}
    {#if i > 0}<span class="shot" style:left={at(s.start)}></span>{/if}
  {/each}
  {#each picks as p (p.time)}
    <span class="pick" style:left={at(p.time)}></span>
  {/each}
  {#each marks as m (m.id)}
    <span class="mark" style:left={at(m.time)}></span>
  {/each}
  {#each frames as f (f.id)}
    <span class="frame" style:left={at(f.time)}></span>
  {/each}
  <span class="head" style:left={at(time)}></span>
  {#if editing && Number.isFinite(editing.start)}
    <span class="grip" class:on={grab === 'start'} data-testid="scene-grip-start" style:left={at(editing.start)} style:--scene={editing.color}></span>
    {#if Number.isFinite(editing.end)}
      <span class="grip" class:on={grab === 'end'} data-testid="scene-grip-end" style:left={at(editing.end)} style:--scene={editing.color}></span>
    {/if}
  {/if}
  {#if hover}
    <span class="hair" style:left={`${hover.x}px`}></span>
    <div class="peek" style:left={`${hoverLeft}px`}>
      {#if tile}<span class="thumb" style={tileStyle(tile, tiles, stripUrl, PEEK)}></span>{/if}
      <span class="peek-time mono">{preciseClock(hover.time)}{hover.label ? ` · ${hover.label}` : ''}</span>
    </div>
  {/if}
</div>

<style>
  .track {
    position: relative;
    height: 18px;
    cursor: pointer;
    touch-action: none;
    border-radius: var(--r-sm);
    outline-offset: 2px;
    color: var(--text-3);
  }
  .track.waved {
    height: 30px;
    background: var(--bg-0);
  }
  .wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.55;
  }
  .rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
    background: var(--bg-2);
  }
  .played {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--accent-soft);
    border-radius: var(--r-sm) 0 0 var(--r-sm);
    pointer-events: none;
  }
  .loop {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 2px solid var(--accent);
    border-right: 2px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
  }
  .loop.open {
    border-right: 0;
  }
  /* A scene: a tinted stretch under everything else, edged in its own colour. */
  .scene {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 2px;
    background: color-mix(in srgb, var(--scene) 22%, transparent);
    border-bottom: 3px solid var(--scene);
    pointer-events: none;
  }
  /* An instant: a thin line in the scene's colour, footed like a band. */
  .scene-pin {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--scene);
    pointer-events: none;
  }
  .scene-pin::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: -3px;
    width: 8px;
    height: 3px;
    border-radius: 1px;
    background: var(--scene);
  }
  /* The scene whose time is open stands out from the rest. */
  .scene.held {
    background: color-mix(in srgb, var(--scene) 38%, transparent);
  }
  .track.resize {
    cursor: ew-resize;
  }
  /* A handle: a bar in the scene's colour, standing proud of the track. */
  .grip {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 6px;
    margin-left: -3px;
    border-radius: 3px;
    background: var(--scene, var(--accent));
    box-shadow: 0 0 0 1.5px var(--bg-1);
    pointer-events: none;
    z-index: 2;
  }
  .grip.on {
    box-shadow: 0 0 0 1.5px var(--bg-1), 0 0 0 3px var(--scene, var(--accent));
  }
  .shot {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--text-2);
    opacity: 0.6;
    pointer-events: none;
  }
  .pick,
  .mark,
  .frame {
    position: absolute;
    width: 7px;
    height: 7px;
    margin-left: -3.5px;
    border-radius: 50%;
    pointer-events: none;
  }
  .pick {
    bottom: 1px;
    width: 5px;
    height: 5px;
    margin-left: -2.5px;
    background: var(--text-2);
  }
  .mark {
    top: 1px;
    border-radius: 1px;
    transform: rotate(45deg);
    background: var(--info, #6aa7e8);
  }
  .frame {
    top: 1px;
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--bg-1);
  }
  .head {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
  }
  .hair {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--text-1);
    opacity: 0.5;
    pointer-events: none;
  }
  .peek {
    position: absolute;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 3px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
    pointer-events: none;
    z-index: 3;
    white-space: nowrap;
  }
  .thumb {
    display: block;
    border-radius: 2px;
    background-color: #000;
  }
  .peek-time {
    font-size: var(--fs-xs);
    color: var(--text-1);
    padding: 0 3px;
  }
</style>
