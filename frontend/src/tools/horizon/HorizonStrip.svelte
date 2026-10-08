<script>
  /**
   * The whole turn over the view, north at the left edge (lib/horizon/strip.js).
   *
   * However narrow the lens, this says where it points: the skyline of the full
   * turn, the lens's field as a bracket, the marked point, and the sun and moon
   * while their paths are on. Drag the bracket to turn; a press elsewhere faces
   * that way and can be dragged on from there.
   */
  import { rayFor } from '../../lib/horizon/camera.js';
  import { windOf } from '../../lib/horizon/geometry.js';
  import { wrap360 } from '../../lib/horizon/panorama.js';
  import {
    fieldSpans,
    silhouette,
    STRIP_HEIGHT,
    stripAzimuth,
    stripScale,
    stripX,
    stripY,
  } from '../../lib/horizon/strip.js';

  let {
    /** The tab's view state (state/horizon.svelte.js). */
    view,
    /** The view's frame, which says how much of the turn the lens takes in. */
    frame = { width: 0, height: 0 },
    /** Where the sun and the moon stand at the chosen time, `{ sun, moon }`, or null. */
    bodies = null,
  } = $props();

  let width = $state(0);
  let hover = $state(null);
  let press = null;

  const shape = $derived(width ? silhouette(view.panorama, width) : null);

  /** The lens's field across the strip: the directions at the frame's two edges. */
  const field = $derived.by(() => {
    if (!width || !frame.width) return [];
    const camera = { ...view.camera, width: frame.width, height: frame.height };
    if (camera.projection === 'panorama' && camera.fov >= 360) return [];
    const left = rayFor(camera, 0, frame.height / 2).azimuth;
    const right = rayFor(camera, frame.width, frame.height / 2).azimuth;
    const span = camera.projection === 'panorama' ? camera.fov : wrap360(right - left);
    return fieldSpans(left, span, width);
  });

  const LETTERS = [
    { azimuth: 90, label: 'E' },
    { azimuth: 180, label: 'S' },
    { azimuth: 270, label: 'W' },
  ];

  const marked = $derived.by(() => {
    const target = view.target;
    if (!width || !target || target.busy || target.error) return null;
    return { x: stripX(target.azimuth, width), seen: target.visible };
  });

  /** A body in the strip, pinned to the top edge when it stands higher than the strip shows. */
  function body(at) {
    if (!at || !width || at.altitude < -3) return null;
    return { x: stripX(at.azimuth, width), y: Math.max(4, stripY(at.altitude, width)) };
  }
  const sun = $derived(body(bodies?.sun));
  const moon = $derived(body(bodies?.moon));

  // -- turning from the strip ----------------------------------------------------

  const local = (event) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  const onField = (x) => field.some((span) => x >= span.x - 4 && x <= span.x + span.width + 4);

  function onPointerDown(event) {
    if (event.button !== 0 || !view.panorama || !width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = local(event);
    // a press off the bracket faces that way first, then drags like the bracket
    if (!onField(x)) view.look({ heading: stripAzimuth(x, width) });
    press = { x, heading: view.camera.heading };
  }

  function onPointerMove(event) {
    const x = local(event);
    hover = { x, azimuth: stripAzimuth(x, width) };
    if (!press) return;
    view.look({ heading: press.heading + (x - press.x) / stripScale(width) });
  }

  function onPointerUp() {
    press = null;
  }

  function onKey(event) {
    const step = event.shiftKey ? 10 : 1;
    const turn = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }[event.key];
    if (turn == null) return;
    event.preventDefault();
    view.look({ heading: view.camera.heading + turn });
  }

  const tag = $derived(hover ? `${Math.round(hover.azimuth) % 360}° ${windOf(hover.azimuth)}` : '');
</script>

<div
  class="hz-strip"
  bind:clientWidth={width}
  role="slider"
  tabindex="0"
  aria-label="Heading on the whole turn"
  aria-valuemin="0"
  aria-valuemax="360"
  aria-valuenow={Math.round(view.camera.heading)}
  aria-valuetext="{Math.round(view.camera.heading)}° {windOf(view.camera.heading)}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={() => (hover = null)}
  onkeydown={onKey}
>
  {#if width}
    <svg {width} height={STRIP_HEIGHT} aria-hidden="true">
      {#if shape}
        <path class="land" d={shape.fill} />
        <path class="skyline" d={shape.line} />
      {/if}
      {#each field as span, index (index)}
        <rect class="field" x={span.x} y="2" width={Math.max(2, span.width)} height={STRIP_HEIGHT - 4} rx="3" />
      {/each}
      {#each [0, 45, 90, 135, 180, 225, 270, 315, 360] as azimuth (azimuth)}
        <line class="wind-tick" x1={(azimuth / 360) * width} x2={(azimuth / 360) * width} y1={STRIP_HEIGHT - 3} y2={STRIP_HEIGHT} />
      {/each}
      <text class="letter north" x="3" y="11">N</text>
      <text class="letter north" x={width - 3} y="11" text-anchor="end">N</text>
      {#each LETTERS as letter (letter.label)}
        <text class="letter" x={stripX(letter.azimuth, width)} y="11" text-anchor="middle">{letter.label}</text>
      {/each}
      {#if marked}
        <path class="marked" class:hidden={!marked.seen} d="M{marked.x} 7 l-3.5 -6 h7 Z" />
      {/if}
      {#if moon}<circle class="moon" cx={moon.x} cy={moon.y} r="2.5" />{/if}
      {#if sun}<circle class="sun" cx={sun.x} cy={sun.y} r="3" />{/if}
      {#if hover}
        <line class="hairline" x1={hover.x} x2={hover.x} y1="0" y2={STRIP_HEIGHT} />
      {/if}
    </svg>
    {#if hover}
      <span class="tag mono" style:left="{Math.min(width - 60, Math.max(4, hover.x + 6))}px">{tag}</span>
    {/if}
  {/if}
</div>

<style>
  .hz-strip {
    position: relative;
    flex: 0 0 32px;
    height: 32px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    cursor: ew-resize;
    outline: none;
    touch-action: none;
    user-select: none;
    overflow: hidden;
  }
  .hz-strip:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  svg {
    display: block;
  }
  .land {
    fill: color-mix(in srgb, var(--text-1) 20%, transparent);
  }
  .skyline {
    fill: none;
    stroke: color-mix(in srgb, var(--text-1) 55%, transparent);
    stroke-width: 1;
  }
  .field {
    fill: var(--accent-soft);
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .wind-tick {
    stroke: color-mix(in srgb, var(--text-1) 45%, transparent);
  }
  .letter {
    fill: var(--text-2);
    font-family: var(--font-mono);
    font-size: 10px;
    paint-order: stroke;
    stroke: var(--bg-1);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
  .letter.north {
    fill: var(--text-1);
    font-weight: 700;
  }
  .marked {
    fill: var(--hz-seen);
    stroke: var(--bg-0);
    stroke-width: 1;
  }
  .marked.hidden {
    fill: var(--hz-hidden);
  }
  .sun {
    fill: var(--hz-sun);
  }
  .moon {
    fill: var(--hz-moon);
  }
  .hairline {
    stroke: var(--text-2);
    stroke-width: 1;
  }
  .tag {
    position: absolute;
    top: 8px;
    padding: 0 5px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    font-size: 10px;
    line-height: 16px;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
