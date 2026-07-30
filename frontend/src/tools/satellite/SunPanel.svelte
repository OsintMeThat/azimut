<script>
  // Sun & moon mode: the day's path drawn from one anchored point, with an hour
  // you can drag. Anchored beside the tool cluster like the measure panel, so it
  // can never end up under Leaflet's own controls.
  //
  // Dragging the hour costs nothing: the whole day arrived in one response at
  // ten-minute steps, so the slider reads an array. Only a new date asks the
  // backend again.
  import Icon from '../../components/Icon.svelte';
  import MoonGlyph from '../../components/MoonGlyph.svelte';

  let {
    sky = null,
    loading = false,
    day = '',
    index = 0,
    anchor = null,
    placing = false,
    ondate,
    onindex,
    onplace,
    onclose,
  } = $props();

  const curve = $derived(sky?.curve ?? null);
  const last = $derived(curve ? curve.minutes.length - 1 : 0);
  const at = $derived(curve?.clock?.[index] ?? '--:--');
  const bodies = $derived(
    curve
      ? [
          {
            key: 'sun',
            label: 'Sun',
            colour: 'var(--sky-sun)',
            azimuth: curve.sun_azimuth[index],
            altitude: curve.sun_altitude[index],
          },
          {
            key: 'moon',
            label: 'Moon',
            colour: 'var(--sky-moon)',
            azimuth: curve.moon_azimuth[index],
            altitude: curve.moon_altitude[index],
          },
        ]
      : [],
  );
  const round = (value) => Math.round(value);

  // Draggable, because the panel sits over the very imagery it is describing.
  // Only the grip starts a drag: the date field and the hour slider need their
  // own pointer events. Kept inside the map, so it cannot be lost off an edge.
  let panelEl;
  let offset = $state({ x: 0, y: 0 });
  let drag = null;

  function startDrag(event) {
    event.preventDefault();
    drag = { x: event.clientX, y: event.clientY, from: { ...offset } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDrag(event) {
    if (!drag) return;
    const wanted = {
      x: drag.from.x + (event.clientX - drag.x),
      y: drag.from.y + (event.clientY - drag.y),
    };
    const map = panelEl?.closest('.map-wrap')?.getBoundingClientRect();
    const box = panelEl?.getBoundingClientRect();
    if (map && box) {
      // where the panel would sit with no offset at all
      const restX = box.left - offset.x;
      const restY = box.top - offset.y;
      wanted.x = Math.min(
        Math.max(wanted.x, map.left + 8 - restX),
        map.right - 8 - box.width - restX,
      );
      wanted.y = Math.min(
        Math.max(wanted.y, map.top + 8 - restY),
        map.bottom - 8 - box.height - restY,
      );
    }
    offset = wanted;
  }

  function endDrag(event) {
    drag = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
</script>

<div
  class="sun-panel card"
  class:loading
  bind:this={panelEl}
  style="transform: translate({offset.x}px, {offset.y}px)"
>
  <div class="line">
    <button
      class="grip"
      onpointerdown={startDrag}
      onpointermove={onDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      title="Drag to move this panel"
      aria-label="Move panel"
    ><Icon name="grip" size={14} /></button>
    <input
      class="input input-sm"
      type="date"
      value={day}
      onchange={(e) => ondate(e.currentTarget.value)}
      title="Local date at the anchored point"
    />
    <span class="zone">{sky?.zone?.abbreviation ?? ''}</span>
    <button class="btn btn-ghost btn-sm" onclick={onclose} title="Close (Esc)">
      <Icon name="x" size={13} />
    </button>
  </div>

  <div class="scrub">
    <input
      type="range"
      min="0"
      max={last}
      value={index}
      disabled={!curve}
      oninput={(e) => onindex(Number(e.currentTarget.value))}
      aria-label="Time of day"
    />
    <span class="now mono">{at}</span>
  </div>

  {#each bodies as body (body.key)}
    <div class="body">
      <span class="swatch" style="background: {body.colour}"></span>
      <span class="name">{body.label}</span>
      <span class="mono">az {round(body.azimuth)}°</span>
      <span class="mono dim">alt {round(body.altitude)}°</span>
      {#if body.altitude < 0}<span class="down">down</span>{/if}
    </div>
  {/each}

  {#if sky}
    <div class="body">
      <MoonGlyph
        illuminated={sky.moon.illuminated}
        phaseAngle={sky.moon.phase_angle}
        waxing={sky.moon.waxing}
        size={13}
      />
      <span class="phase">{sky.moon.phase}, {Math.round(sky.moon.illuminated * 100)}% lit</span>
    </div>
  {/if}

  <div class="anchor">
    <span class="mono dim">
      {anchor ? `${anchor.lat.toFixed(4)}, ${anchor.lon.toFixed(4)}` : 'no point'}
    </span>
    <button class="btn btn-sm" class:on={placing} onclick={onplace}>
      {placing ? 'Click the map' : 'Move'}
    </button>
  </div>
  <p class="note">The path is drawn from this point, so panning the map leaves it alone.</p>
</div>

<style>
  .sun-panel {
    position: absolute;
    /* beside the cluster, but below the band the centred coordinates readout
       occupies: on a narrow map the two would otherwise cross */
    top: 46px;
    left: calc(100% + 8px);
    width: max-content;
    min-width: 234px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    transition: opacity 120ms var(--ease);
  }
  .sun-panel.loading {
    opacity: 0.65;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grip {
    display: grid;
    place-items: center;
    padding: 2px;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
  }
  .grip:hover {
    color: var(--text-1);
  }
  .grip:active {
    cursor: grabbing;
  }
  .line .input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .zone {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .scrub {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .scrub input {
    flex: 1;
    accent-color: var(--accent);
  }
  .now {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--accent);
  }
  .body {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-sm);
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .body .name {
    width: 38px;
    color: var(--text-2);
  }
  .dim {
    color: var(--text-3);
  }
  .down {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .phase {
    color: var(--text-2);
  }
  .anchor {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .anchor .btn.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .note {
    margin: 0;
    max-width: 220px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
