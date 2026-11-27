<script>
  // Sun & moon mode: the day's path drawn from one anchored point, with an hour
  // you can drag. Anchored beside the tool cluster like the measure panel, so it
  // can never end up under the engine's own controls.
  //
  // Dragging the hour costs nothing: the whole day arrived in one response at
  // ten-minute steps, so the slider reads an array. Only a new date asks the
  // backend again.
  //
  // A shadow is read only when Shadow is pressed: the foot of something, then
  // the tip of its shadow, and the panel says the hour and how tall it stands.
  // An hour pressed there puts the slider on it. A shadow no hour casts says
  // which way that day's shadows fall, and offers its ends the other way round.
  import Icon from '../../components/Icon.svelte';
  import MoonGlyph from '../../components/MoonGlyph.svelte';
  import DateField from '../../components/DateField.svelte';

  let {
    sky = null,
    loading = false,
    day = '',
    index = 0,
    anchor = null,
    placing = false,
    /** The shadow as the store says it (`sky.shadow`), or null while none is asked for. */
    shadow = null,
    ondate,
    onindex,
    onplace,
    onclose,
    /** Put a shadow down, or stop putting one down. */
    ontraceshadow,
    onclearshadow,
    /** The slider on the hour of the shadow's moment `i`. */
    onmoment,
    oncopyshadow,
    /** Read the shadow with its foot and its tip the other way round. */
    onswapshadow,
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
  data-guide="map.sky"
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
    <DateField
      day
      reading={false}
      label="Local date at the anchored point"
      value={day}
      onchange={(value) => value && ondate(value)}
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

  <div class="shadow">
    {#if !shadow}
      <button class="btn btn-sm" onclick={ontraceshadow} title="The hour from a shadow on the imagery, and how tall its caster stands" data-guide="map.shadow">
        <Icon name="sun" size={13} /> Read a shadow
      </button>
    {:else if shadow.step}
      <div class="tracing">
        <span class="pulse" aria-hidden="true"></span>
        <span>{shadow.step === 'foot' ? 'Click the foot of what casts it' : 'Click the tip of its shadow'}</span>
        <button class="btn btn-ghost btn-xs" onclick={ontraceshadow} title="Put no shadow down (Esc)">Cancel</button>
      </div>
    {:else}
      <div class="shadow-head">
        <span class="name">Shadow</span>
        {#if shadow.answered && shadow.moments.length}
          <button class="btn btn-ghost btn-xs icon" onclick={oncopyshadow} title="Copy what the shadow says, with where it was drawn" aria-label="Copy the shadow">
            <Icon name="copy" size={12} />
          </button>
        {/if}
        <button class="btn btn-ghost btn-xs icon" onclick={ontraceshadow} title="Draw it again" aria-label="Draw the shadow again">
          <Icon name="reset" size={12} />
        </button>
        <button class="btn btn-ghost btn-xs icon" onclick={onclearshadow} title="Take the shadow off the map" aria-label="Remove the shadow">
          <Icon name="x" size={12} />
        </button>
      </div>
      {#if shadow.busy}
        <p class="note">Reading the sun…</p>
      {:else if shadow.error}
        <p class="failed">{shadow.error}</p>
      {:else if shadow.answered && !shadow.moments.length}
        <p class="answer">No hour of {shadow.date} casts this shadow</p>
        {#if shadow.falls}<p class="note">{shadow.falls}</p>{/if}
        {#if shadow.swappable}
          <button class="btn btn-sm btn-primary" onclick={onswapshadow} title="Read it with the foot and the tip the other way round">
            <Icon name="swap" size={13} /> Swap the ends
          </button>
        {/if}
      {:else if shadow.answered}
        {#each shadow.moments as moment, i (i)}
          <button class="moment" onclick={() => onmoment(i)} title={`Set the hour to ${moment.clock}`}>
            <span class="mono when">{moment.clock}{moment.zone ? ` ${moment.zone}` : ''}</span>
            <span class="tall">about {moment.height} tall</span>
            <span class="dim">{moment.sun}</span>
          </button>
        {/each}
      {/if}
    {/if}
    {#if shadow?.noDay}
      <p class="note">The imagery has no day: the shadow is read on the date above.</p>
    {/if}
    {#if shadow?.traced}
      <p class="note">Assumes level ground seen from overhead.</p>
    {/if}
  </div>
</div>

<style>
  .sun-panel {
    /* placed by the rail's panel slot, like every other tool's settings; it no
       longer has to dodge a coordinates readout that used to float above it */
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
  .line :global(.date-field) {
    flex: 1;
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
  /* the shadow is read on demand, and the anchor moves to its foot */
  .shadow {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .shadow > .btn {
    align-self: flex-start;
  }
  .tracing,
  .shadow-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tracing span:not(.pulse),
  .shadow-head .name {
    margin-right: auto;
  }
  .tracing {
    color: var(--sky-sun);
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--sky-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .shadow-head .name {
    color: var(--text-2);
  }
  .moment {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 8px;
    padding: 5px 7px;
    border-radius: var(--r-md);
    background: rgba(255, 255, 255, 0.04);
    text-align: left;
    color: var(--text-1);
  }
  .moment:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .moment .when {
    font-weight: 700;
    color: var(--sky-sun);
  }
  .moment .dim {
    grid-column: 1 / -1;
    font-size: var(--fs-xs);
  }
  .answer {
    margin: 0;
    color: var(--text-1);
  }
  .failed {
    margin: 0;
    max-width: 220px;
    font-size: var(--fs-xs);
    color: var(--warn);
  }
</style>
