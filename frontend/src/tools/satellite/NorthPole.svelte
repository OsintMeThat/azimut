<script>
  /**
   * Below the North Pole (lib/globe/northPole.js reads the view).
   *
   * Past 85.05° north the 3D globe draws nothing, and through that hole it shows its
   * own inside. Looked into from above, a small lamp and two eyes show at the centre
   * of the Earth. Brought to fill most of the screen, it takes the view: the
   * camera falls into it faster and faster, the lamp goes out, the dark closes in from
   * the edges, a tunnel runs down the Earth's axis while the depth is counted to its
   * centre, and at the bottom a lamp clicks on over two eyes. Climbing back out (its
   * button, Escape, the wheel) sets the camera back over the Arctic. The camera is
   * always placed with its ground given (the sea, 0 m), so no height is asked for.
   *
   * It only lays things over the globe: nothing is written to the case, nothing goes
   * on the network, and a capture of the globe never holds any of it. The hole takes
   * the view once per approach; it can again after the view has left it.
   */
  import { onDestroy, untrack } from 'svelte';
  import { portal } from '../../lib/fullscreen.js';
  import {
    DEPTH_KM,
    fallDepth,
    diveEase,
    fallSpeed,
    hintStrength,
    holeOnScreen,
    poleStage,
    rearmed,
  } from '../../lib/globe/northPole.js';

  /** The globe's façade, and how tall it draws the relief (its points' metres scale by it). */
  let { engine, exaggeration = 1 } = $props();

  /** ms of each part of the way down. */
  const DIVE_MS = 1250;
  const FALL_MS = 2800;
  const LEAVE_MS = 420;

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let host = $state();
  let hole = $state.raw(null);
  /** none · hint (the eyes) · dive (the dark closing in) · fall · bottom · leaving */
  let stage = $state('none');
  let rect = $state.raw(null);
  /** The dive's own darkening, 0 to 1: the edges first, then the whole view. */
  let dusk = $state(0);
  /** The lamp and the eyes during the dive, 1 until they go out. */
  let lit = $state(1);
  let depth = $state(0);
  let tunnel = $state();
  let climb = $state();
  let armed = true;
  let timers = [];
  let frame = 0;

  const open = $derived(stage === 'dive' || stage === 'fall' || stage === 'bottom' || stage === 'leaving');
  const strength = $derived(
    stage === 'hint' && hole ? hintStrength(hole.reach) : stage === 'dive' && hole ? lit : 0
  );
  /** One unit of the eyes' drawing: the rim's radius is 55 of them. */
  const unit = $derived(hole && Number.isFinite(hole.radius) ? hole.radius / 55 : 1);

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function read() {
    if (open || !host) return;
    hole = holeOnScreen(engine, host.clientWidth, host.clientHeight, exaggeration);
    if (!armed && rearmed(hole)) armed = true;
    const next = poleStage(hole);
    if (next === 'dive' && armed) dive();
    else stage = next === 'dive' ? 'hint' : next;
  }

  /** The camera falls into the hole, gathering speed, while the dark closes in. */
  function dive() {
    armed = false;
    stage = 'dive';
    rect = host.getBoundingClientRect();
    dusk = 0;
    lit = 1;
    if (reduced()) {
      dusk = 1;
      later(fall, 260);
      return;
    }
    const from = engine.camera?.() ?? { lat: 86, lon: 0, bearing: 0, pitch: 0 };
    const zoom = engine.exactZoom?.() ?? from.zoom ?? 4;
    const start = performance.now();
    const step = (now) => {
      if (stage !== 'dive') return;
      const t = Math.min(1, (now - start) / DIVE_MS);
      const e = diveEase(t);
      engine.setCamera?.({
        lat: from.lat + (89.95 - from.lat) * e,
        lon: from.lon,
        zoom: zoom + 3 * e,
        bearing: from.bearing,
        pitch: from.pitch * (1 - e),
        elevation: 0,
      });
      hole = holeOnScreen(engine, host.clientWidth, host.clientHeight, exaggeration) ?? hole;
      lit = 1 - Math.min(1, Math.max(0, (t - 0.35) / 0.15));
      dusk = t;
      if (t < 1) frame = requestAnimationFrame(step);
      else fall();
    };
    frame = requestAnimationFrame(step);
  }

  function fall() {
    if (stage !== 'dive') return;
    stage = 'fall';
    if (reduced()) {
      depth = DEPTH_KM;
      stage = 'bottom';
      return;
    }
    const rings = Array.from({ length: 14 }, (_, i) => 1 + i);
    const start = performance.now();
    let last = start;
    const step = (now) => {
      if (stage !== 'fall') return;
      const t = Math.min(1, (now - start) / FALL_MS);
      depth = fallDepth(t);
      drawTunnel(rings, fallSpeed(t), (now - last) / 1000, t);
      last = now;
      if (t < 1) frame = requestAnimationFrame(step);
      else stage = 'bottom';
    };
    frame = requestAnimationFrame(step);
  }

  /** The Earth's axis seen from inside: rings coming at the eye and meridians meeting far below. */
  function drawTunnel(rings, speed, dt, t) {
    const canvas = tunnel;
    if (!canvas || !rect) return;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== Math.round(w * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const reach = Math.min(w, h) * 0.3;
    const far = rings.length;
    for (let i = 0; i < rings.length; i += 1) {
      rings[i] -= speed * dt * 9;
      if (rings[i] < 0.22) rings[i] += far;
    }
    const twist = t * 0.9;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(150, 185, 205, ${0.08 * (0.3 + speed)})`;
    for (let m = 0; m < 24; m += 1) {
      const a = twist + (m / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * reach / far, cy + Math.sin(a) * reach / far);
      ctx.lineTo(cx + Math.cos(a) * w * 1.5, cy + Math.sin(a) * w * 1.5);
      ctx.stroke();
    }
    for (const z of rings) {
      const fade = Math.min(1, (far - z) / (far * 0.6)) * Math.min(1, (z - 0.22) / 0.5);
      const alpha = 0.5 * fade * (0.25 + 0.75 * speed);
      if (alpha <= 0.01) continue;
      ctx.strokeStyle = `rgba(150, 185, 205, ${alpha})`;
      ctx.lineWidth = Math.max(1, 2.4 / z);
      ctx.beginPath();
      ctx.arc(cx, cy, reach / z, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function climbOut() {
    if (!open || stage === 'leaving') return;
    cancelAnimationFrame(frame);
    stage = 'leaving';
    const camera = engine.camera?.();
    // back over the Arctic, high enough that the hole is a small dark spot again
    engine.setCamera?.({ lat: 72, lon: camera?.lon ?? 0, zoom: 3, bearing: 0, pitch: 0, elevation: 0 });
    later(() => {
      stage = 'none';
      rect = null;
      depth = 0;
      dusk = 0;
      read();
    }, reduced() ? 0 : LEAVE_MS);
  }

  /** Gone without a word: the tool was hidden or the 3D view closed under it. */
  function vanish() {
    cancelAnimationFrame(frame);
    for (const t of timers) clearTimeout(t);
    timers = [];
    stage = 'none';
    rect = null;
  }

  $effect(() => {
    if (!engine || !host) return;
    const offs = [engine.on('view-move', read), engine.on('view-settled', read)];
    const sizes =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (open && !host.clientWidth) vanish();
            else if (open) rect = host.getBoundingClientRect();
            else read();
          });
    sizes?.observe(host);
    untrack(read);
    return () => {
      for (const off of offs) off?.();
      sizes?.disconnect();
    };
  });

  $effect(() => {
    if (!open) return;
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      climbOut();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  $effect(() => {
    if (stage === 'bottom') later(() => climb?.focus({ preventScroll: true }), reduced() ? 0 : 1900);
  });

  /** The wheel over the dark climbs out, and never reaches the map under it. */
  function wheelOut(node) {
    const onwheel = (event) => {
      event.preventDefault();
      if (event.deltaY > 0 && stage !== 'dive') climbOut();
    };
    node.addEventListener('wheel', onwheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', onwheel) };
  }

  onDestroy(vanish);

  const km = (value) => `${value > 0 ? '−' : ''}${Math.round(value).toLocaleString('en-US').replace(/,/g, ' ')} km`;
</script>

<!-- the lamp and the eyes at the centre of the Earth, seen through the hole -->
<div class="np-host" bind:this={host} aria-hidden="true">
  {#if strength > 0 && hole}
    <svg
      class="np-hint"
      style:left={`${hole.core.x}px`}
      style:top={`${hole.core.y}px`}
      style:opacity={strength}
      width={unit * 20}
      height={unit * 20}
      viewBox="-10 -10 20 20"
    >
      <circle cx="0" cy="-4.8" r="4" fill="url(#np-lamp)" />
      <circle cx="0" cy="-4.8" r="0.8" fill="#fff6dc" />
      <circle class="np-blink" cx="-3.6" cy="0" r="1.15" fill="#fff" />
      <circle class="np-blink" cx="3.6" cy="0" r="1.15" fill="#fff" />
      <defs>
        <radialGradient id="np-lamp"><stop offset="0" stop-color="#fff1c7" stop-opacity="0.7" /><stop offset="1" stop-color="#fff1c7" stop-opacity="0" /></radialGradient>
      </defs>
    </svg>
  {/if}
</div>

{#if open && rect}
  <!-- dark-surface: the card keeps the dark theme's tokens in the light one -->
  <div
    class="np-abyss dark-surface"
    class:dark={stage !== 'dive'}
    class:leaving={stage === 'leaving'}
    style:left={`${rect.left}px`}
    style:top={`${rect.top}px`}
    style:width={`${rect.width}px`}
    style:height={`${rect.height}px`}
    use:portal
    use:wheelOut
  >
    {#if stage === 'dive'}
      <!-- the dark closing in: the edges first, then everything -->
      <div class="np-vignette" style:opacity={Math.min(1, dusk * 1.6)}></div>
      <div class="np-veil" style:opacity={Math.max(0, (dusk - 0.55) / 0.45) ** 1.5}></div>
    {/if}
    {#if stage === 'fall' || stage === 'bottom' || stage === 'leaving'}
      <canvas class="np-tunnel" class:still={stage !== 'fall'} bind:this={tunnel} aria-hidden="true"></canvas>
      <div class="np-depth" aria-hidden="true">
        Alt <b class="neg">{km(depth)}</b>{#if stage !== 'fall'}{' · '}<b>centre of the Earth</b>{/if}
      </div>
    {/if}
    {#if stage === 'bottom' || stage === 'leaving'}
      <!-- all there is to see: a lamp and two eyes -->
      <svg class="np-who" viewBox="0 0 240 300" aria-hidden="true">
        <defs>
          <radialGradient id="np-glow"><stop offset="0" stop-color="#fff1c7" stop-opacity="0.55" /><stop offset="0.4" stop-color="#ffd98a" stop-opacity="0.16" /><stop offset="1" stop-color="#ffd98a" stop-opacity="0" /></radialGradient>
        </defs>
        <rect x="109" y="43.5" width="22" height="15" rx="5" fill="#12161b" />
        <g class="np-lamp">
          <circle class="np-glare" cx="120" cy="51" r="38" fill="url(#np-glow)" />
          <circle cx="120" cy="51" r="4.6" fill="#fff6dc" />
          <g class="np-gaze">
            <g class="np-wink"><circle cx="101" cy="95" r="7.4" fill="#0b0f14" /><circle cx="103.7" cy="92.2" r="2.4" fill="#fff" /></g>
            <g class="np-wink"><circle cx="139" cy="95" r="7.4" fill="#0b0f14" /><circle cx="141.7" cy="92.2" r="2.4" fill="#fff" /></g>
          </g>
        </g>
      </svg>
      <div class="np-card" role="dialog" aria-label="The bottom of the hole">
        <h2>Uhh…</h2>
        <p>If you came all the way down here to geolocate something, we're f*cked.</p>
        <button class="btn" type="button" bind:this={climb} onclick={climbOut}>Climb back out</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .np-host {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .np-hint {
    position: absolute;
    transform: translate(-50%, -50%);
    overflow: visible;
  }
  .np-blink {
    transform-box: fill-box;
    transform-origin: center;
    animation: np-blink 3.4s infinite;
  }
  @keyframes np-blink {
    0%, 92%, 100% { transform: scaleY(1); }
    95% { transform: scaleY(0.1); }
  }

  /* Over the map's tools (500 and up) and under the app's menus (1250). */
  .np-abyss {
    position: fixed;
    z-index: 1150;
    overflow: hidden;
    cursor: default;
    background: transparent;
    transition: background 500ms ease, opacity var(--motion-move, 220ms) ease;
  }
  .np-abyss.dark {
    background: radial-gradient(ellipse at 50% 40%, #0b131a 0%, #060a0e 45%, #020304 80%);
  }
  .np-abyss.leaving {
    opacity: 0;
    transition: opacity 420ms ease;
  }
  .np-vignette,
  .np-veil {
    position: absolute;
    inset: 0;
  }
  .np-vignette {
    background: radial-gradient(ellipse at 50% 50%, rgba(2, 4, 6, 0) 28%, rgba(2, 4, 6, 0.92) 78%);
  }
  .np-veil {
    background: radial-gradient(ellipse at 50% 40%, #0b131a 0%, #060a0e 45%, #020304 80%);
  }
  .np-tunnel {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transition: opacity 700ms ease;
  }
  .np-tunnel.still {
    opacity: 0;
  }
  .np-depth {
    position: absolute;
    left: 10px;
    top: 10px;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    background: rgba(21, 21, 21, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.09);
    font: 11px var(--font-mono);
    color: #9f9f9f;
  }
  .np-depth b {
    color: #e3e3e3;
    font-weight: 500;
  }
  .np-depth .neg {
    color: #ef90bb;
  }

  .np-who {
    position: absolute;
    left: 50%;
    top: 6%;
    width: min(42vh, 40%);
    transform: translateX(-50%);
  }
  .np-lamp {
    opacity: 0;
    animation: np-lamp-on 900ms linear 900ms both;
  }
  @keyframes np-lamp-on {
    0%, 40% { opacity: 0; }
    44% { opacity: 1; }
    50% { opacity: 0.15; }
    58%, 100% { opacity: 1; }
  }
  /* an 8 s loop: it looks down and aside, then up at you, the lamp in your face */
  .np-glare {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0.35;
    animation: np-glare 8s ease-in-out 2s infinite;
  }
  @keyframes np-glare {
    0%, 55%, 92%, 100% { opacity: 0.35; transform: none; }
    62%, 85% { opacity: 1; transform: scale(2.1); }
  }
  .np-gaze {
    transform: translate(-2.6px, 2.4px);
    animation: np-gaze 8s ease-in-out 2s infinite;
  }
  @keyframes np-gaze {
    0%, 55%, 92%, 100% { transform: translate(-2.6px, 2.4px); }
    60%, 87% { transform: none; }
  }
  .np-wink {
    transform-box: fill-box;
    transform-origin: center;
    animation: np-wink 8s 2s infinite;
  }
  @keyframes np-wink {
    0%, 28%, 32%, 63%, 67%, 100% { transform: scaleY(1); }
    30%, 65% { transform: scaleY(0.08); }
  }

  .np-card {
    position: absolute;
    left: 50%;
    bottom: 24px;
    width: min(400px, calc(100% - 32px));
    padding: 14px 16px;
    transform: translate(-50%, 0);
    background: #1c1c1c;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--r-lg);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color: #e3e3e3;
    animation: np-card-in 260ms var(--ease-out, ease-out) 1900ms both;
  }
  @keyframes np-card-in {
    from { opacity: 0; transform: translate(-50%, 10px); }
  }
  .np-card h2 {
    margin: 0 0 6px;
    font-size: var(--fs-lg);
  }
  .np-card p {
    margin: 0 0 12px;
    font-size: var(--fs-md);
    line-height: 1.45;
  }

  @media (prefers-reduced-motion: reduce) {
    .np-blink,
    .np-glare,
    .np-gaze,
    .np-wink {
      animation: none;
    }
    .np-lamp {
      animation: none;
      opacity: 1;
    }
    .np-card {
      animation-delay: 0ms;
    }
  }
</style>
