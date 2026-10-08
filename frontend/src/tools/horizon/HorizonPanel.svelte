<script>
  /**
   * The Horizon tab's inspector, under its map: what was read off the view,
   * then the settings in four groups a first-time user can scan.
   *
   * - **Readings** sit first and keep their place: the marked point (in sight
   *   or hidden, by how much) and the ground clicked in the view. Each holds its
   *   room while empty and says there how to fill it, so nothing under them
   *   moves when a click reads something.
   * - **Viewpoint**: where the eye stands and how high.
   * - **Lens**: how wide it sees, and whether the frame is a photo or the
   *   panorama strip.
   * - **On the view**: summit names, and the sun and moon with their time.
   * - **More settings**, closed: tilt and roll (the view's own gestures set
   *   them), how far the air lets the eye see and from how near the ground is
   *   drawn, the ridge lines' density.
   * - **Photo**, while one is laid over the view: what its file says of its
   *   lens, place and time, each offered with the act that applies it and
   *   never applied unasked, and the strokes traced on it.
   *
   * The heading is written in one place only, the caret under the view.
   * Progress is said once, in the header; what failed is said here, beside
   * the thing it concerns, with a way to try again.
   */
  import Icon from '../../components/Icon.svelte';
  import DateField from '../../components/DateField.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import { copyText } from '../../lib/clipboard.js';
  import { fmtCoords } from '../../lib/state.svelte.js';
  import { focal35FromFov, fovFromFocal35 } from '../../lib/horizon/camera.js';
  import { HEIGHT_LIMITS, MODE_LABELS, MODES, visibilityAt, visibilityStep, VISIBILITY_STEPS } from '../../lib/horizon/view.js';
  import { formatDistance, formatHeight } from '../../lib/measure.js';
  import { bandsGradient, clockOf, minuteOf, skyLines, sunBands } from '../../lib/horizon/sky.js';
  import { targetReading } from '../../lib/horizon/readings.js';
  import { distanceBetween } from '../../lib/horizon/geometry.js';
  import { isZoned, localClock } from '../../lib/horizon/overlay.js';
  import { RIDGE_STEPS } from './state/horizon.svelte.js';

  let {
    view,
    units = 'metric',
    /** Width over height of the frame, for the 35 mm equivalent. */
    aspect = 4 / 3,
    /** Back to the large map, to stand somewhere else; null while already there. */
    onmove = null,
    /** Face a direction: `{ azimuth, elevation }`. */
    onturn = () => {},
    /** A photo or a video laid over the view (state/overlay.svelte.js), or null. */
    overlay = null,
  } = $props();

  const observer = $derived(view.observer);
  /** The month grid under the day field, open while a day is being picked. */
  let calendarOpen = $state(false);
  const camera = $derived(view.camera);
  const altitude = $derived(view.panorama?.observer);
  const focal = $derived(Math.round(focal35FromFov(camera.fov, aspect)));

  function number(event) {
    const value = Number(event.currentTarget.value);
    return event.currentTarget.value !== '' && Number.isFinite(value) ? value : null;
  }

  const HEIGHT_LABELS = { ground: 'Eye height', drone: 'Height above ground', aircraft: 'Altitude above sea' };
  const MODE_HINTS = {
    ground: 'A person standing on the ground',
    drone: 'A drone over the ground under it',
    aircraft: 'An aircraft at an altitude above the sea',
  };

  /**
   * How wide the strip opens: as much of the turn as fits with the picture's
   * band filling the frame's height, at real scale. The wheel widens it to the
   * whole turn.
   */
  function stripFov() {
    const band = view.panorama ? view.panorama.elevation.step * (view.panorama.elevation.count - 1) : 40;
    return Math.max(60, Math.min(360, band * aspect));
  }

  /** The middle of the picture's band, where the strip is centred. */
  function bandMiddle() {
    const elevation = view.panorama?.elevation;
    return elevation ? elevation.top - (elevation.step * (elevation.count - 1)) / 2 : 0;
  }

  // the sun's day painted along the time slider
  const minute = $derived(minuteOf(view.skyTime) ?? 720);
  const zone = $derived(view.sky?.zone?.abbreviation ?? '');
  const track = $derived(
    bandsGradient(sunBands(view.sky), {
      clear: 'var(--sky-sun)',
      hidden: 'color-mix(in srgb, var(--sky-sun) 35%, var(--bg-2))',
      down: 'var(--bg-3)',
    })
  );

  /** The visibility as the slider says it: clear air, or how far. */
  const seeing = $derived.by(() => {
    const metres = view.visibility;
    if (!metres) return 'Clear';
    return metres < 10_000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 1000)} km`;
  });

  const reading = $derived(view.target && !view.target.busy && !view.target.error ? targetReading(view.target, units) : null);

  // -- what the photo says ---------------------------------------------------------

  const photo = $derived(overlay?.source ?? null);
  const lens = $derived(photo ? overlay.lens : null);
  const lensOff = $derived(Boolean(lens) && Math.abs(lens.fov - camera.fov) > 0.05);
  const fileWord = $derived(photo?.kind === 'video' ? 'video' : 'photo');
  const placed = $derived(photo && overlay.facts.gps && observer ? overlay.facts.gps : null);
  const placedAway = $derived(placed ? distanceBetween(observer, placed) : 0);
  const taken = $derived(photo ? overlay.facts.taken_at ?? '' : '');
  /** A day and minute the photo says, waiting for the place's zone to be read on its clock. */
  let takenWaiting = $state('');

  /** "12 Jun 2024, 14:31", as the photo's time is said back. */
  function takenText(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
    if (!match) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}, ${match[4]}:${match[5]}${isZoned(iso) ? ' UTC' : ''}`;
  }

  /** The sun and moon at the moment the photo says, on the place's clock. */
  function setSun() {
    const clock = localClock(taken, view.sky?.zone?.name);
    if (clock) {
      view.setSkyDate(clock.date);
      view.showSky(true);
      view.setSkyTime(clock.time);
      return;
    }
    // a time with a zone needs the place's: the sky's answer brings it
    takenWaiting = taken;
    view.showSky(true);
  }

  $effect(() => {
    const zone = view.sky?.zone?.name;
    if (!takenWaiting || !zone) return;
    const clock = localClock(takenWaiting, zone);
    takenWaiting = '';
    if (!clock) return;
    view.setSkyDate(clock.date);
    view.setSkyTime(clock.time);
  });

  /** Whatever beside the picture failed, each with its own way to try again. */
  const problems = $derived(
    [
      view.peaksOn && view.peaksError && { id: 'peaks', text: view.peaksError, retry: () => view.retryPeaks() },
      view.peaksOn &&
        !view.peaksError &&
        view.peaksFailed && {
          id: 'peaks-busy',
          text: 'OpenStreetMap is busy: some summits are not named yet.',
          retry: () => view.retryPeaks(),
        },
      view.ground === 'imagery' && view.drapeError && { id: 'drape', text: view.drapeError, retry: () => view.retryDrape() },
      view.skyOn && view.skyError && { id: 'sky', text: view.skyError, retry: () => view.retrySky() },
      view.skyOn && view.shadowError && { id: 'shadow', text: view.shadowError, retry: () => view.retryShadow() },
      view.fullDetail && view.fullError && { id: 'full', text: view.fullError, retry: () => view.retryFull() },
      view.nearOn && view.nearError && { id: 'near', text: view.nearError, retry: () => view.retryNear() },
    ].filter(Boolean)
  );
</script>

<div class="horizon-panel">
  {#if observer}
    <section class="readings" aria-label="Readings">
      <div class="reading">
        <div class="head">
          <h4>Marked point</h4>
          {#if view.target && !view.target.busy}
            <span class="acts">
              {#if view.target.error}
                <button type="button" class="btn btn-sm" onclick={() => view.retryTarget()}>Try again</button>
              {:else}
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() => onturn({ azimuth: view.target.azimuth, elevation: view.target.angle })}>Turn to it</button
                >
              {/if}
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => view.clearTarget()}>Clear</button>
            </span>
          {/if}
        </div>
        <div class="body marked">
          {#if !view.target}
            <p class="empty-line">Click the map to mark a point.</p>
          {:else if view.target.busy}
            <p class="fact">Reading the line of sight…</p>
          {:else if view.target.error}
            <p class="fact warn">{view.target.error}</p>
          {:else if reading}
            <p class="verdict" class:seen={view.target.visible} class:hidden={!view.target.visible}>
              <span class="dot" aria-hidden="true"></span>{reading.verdict}
            </p>
            <p class="fact">{reading.where}</p>
            {#if reading.margin}<p class="fact">{reading.margin}</p>{/if}
          {/if}
        </div>
      </div>
      <div class="reading">
        <div class="head">
          <h4>Clicked in the view</h4>
          {#if view.pointed}
            <span class="acts">
              <button type="button" class="btn btn-sm" onclick={() => view.standAt(view.pointed)}>Stand here</button>
            </span>
          {/if}
        </div>
        <div class="body">
          {#if view.pointed}
            <p class="fact">
              <button type="button" class="coords mono" onclick={() => copyText(fmtCoords(view.pointed.lat, view.pointed.lon))} title="Copy coordinates">
                {fmtCoords(view.pointed.lat, view.pointed.lon)}
                <Icon name="copy" size={11} />
              </button>
              · {formatDistance(view.pointed.distance, units)} away
            </p>
          {:else}
            <p class="empty-line">Click the view to read the ground there.</p>
          {/if}
        </div>
      </div>
    </section>
  {/if}

  {#each problems as problem (problem.id)}
    <p class="problem" role="alert">
      <span>{problem.text}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick={problem.retry}>Try again</button>
    </p>
  {/each}

  {#if observer && photo}
    <details class="hz-group photo" open>
      <summary>{photo.kind === 'video' ? 'Video' : 'Photo'}</summary>
      <p class="fact file" title={photo.name}>
        <span class="file-name">{photo.name}</span>
        {#if overlay.size.width}<span class="mono size">{overlay.size.width} × {overlay.size.height}</span>{/if}
      </p>
      {#if lens}
        <div class="line">
          <p class="fact">Lens from the {fileWord}: {Math.round(lens.mm)} mm → {lens.fov.toFixed(1)}°</p>
          {#if lensOff}
            <button type="button" class="btn btn-sm" onclick={() => overlay.useLens()} title="Set the lens to the one the file says">Use</button>
          {/if}
        </div>
      {:else if !overlay.busy}
        <p class="fact">The {fileWord} does not say its lens: match it by eye or with Fit to trace.</p>
      {/if}
      {#if placed}
        <div class="line">
          <p class="fact">{placedAway < 30 ? 'Its metadata places it at this viewpoint' : `Its metadata places it ${formatDistance(placedAway, units)} away`}</p>
          {#if placedAway >= 30}
            <button type="button" class="btn btn-sm" onclick={() => view.standAt(placed)} title="Stand where the file says it was taken">Stand there</button>
          {/if}
        </div>
      {/if}
      {#if taken}
        <div class="line">
          <p class="fact">Its metadata says {takenText(taken)}</p>
          <button
            type="button"
            class="btn btn-sm"
            onclick={setSun}
            title={isZoned(taken) ? 'Put the sun and moon at this time, on the place’s clock' : 'Put the sun and moon at this time, read as the local time there'}
            >Set the sun</button
          >
        </div>
      {/if}
      {#if overlay.strokes.length}
        <div class="line">
          <p class="fact">{overlay.strokes.length === 1 ? 'One stroke' : `${overlay.strokes.length} strokes`} along the skyline</p>
          <span class="acts">
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => overlay.undoStroke()} title="Take the last stroke back (Ctrl+Z)">Undo</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => overlay.clearTrace()}>Clear</button>
          </span>
        </div>
      {/if}
      <p class="hint">Height: Alt+wheel on the view</p>
    </details>
  {/if}

  {#if observer}
    <details class="hz-group" open>
      <summary>Viewpoint</summary>
      <button type="button" class="coords mono" onclick={() => copyText(fmtCoords(observer.lat, observer.lon))} title="Copy coordinates">
        {fmtCoords(observer.lat, observer.lon)}
        <Icon name="copy" size={11} />
      </button>
      {#if onmove}
        <div class="line packed">
          <button type="button" class="btn btn-sm" onclick={onmove}>Move the viewpoint</button>
          <span class="hint">or drag the orange dot</span>
        </div>
      {/if}
      <div class="seg" role="group" aria-label="Who is looking">
        {#each MODES as mode (mode)}
          <button
            type="button"
            class:on={observer.mode === mode}
            aria-pressed={observer.mode === mode}
            onclick={() => view.setMode(mode)}
            title={MODE_HINTS[mode]}
          >
            {MODE_LABELS[mode]}
          </button>
        {/each}
      </div>
      <label class="field">
        <span class="name">{HEIGHT_LABELS[observer.mode]}</span>
        <input
          class="input mono"
          type="number"
          min={HEIGHT_LIMITS[observer.mode][0]}
          max={HEIGHT_LIMITS[observer.mode][1]}
          step="any"
          value={observer.height}
          onchange={(event) => view.setHeight(number(event))}
        />
        <span class="unit">m</span>
      </label>
      {#if altitude}
        <p class="fact">Ground {formatHeight(altitude.ground, units)} above sea level</p>
      {/if}
    </details>

    <details class="hz-group" open>
      <summary>Lens</summary>
      <div class="line packed">
        <label class="field">
          <input
            class="input mono"
            type="number"
            step="any"
            min="1"
            max={camera.projection === 'panorama' ? 360 : 150}
            value={Number(camera.fov.toFixed(1))}
            onchange={(event) => view.look({ fov: number(event) ?? camera.fov })}
            aria-label="Field of view in degrees"
          />
          <span class="unit">° wide</span>
        </label>
        {#if camera.projection === 'camera'}
          <span class="hint">or</span>
          <label class="field">
            <input
              class="input mono"
              type="number"
              step="any"
              min="5"
              value={focal}
              onchange={(event) => {
                const mm = number(event);
                if (mm > 0) view.look({ fov: fovFromFocal35(mm, aspect) });
              }}
              aria-label="Focal length, 35 mm equivalent"
            />
            <span class="unit">mm equiv.</span>
          </label>
        {/if}
      </div>
      <!-- a photo is a rectilinear frame: while one is laid there is no other to pick -->
      {#if !photo}
        <div class="field">
          <span class="name">Frame</span>
          <div class="seg" role="group" aria-label="Frame">
            <button
              type="button"
              class:on={camera.projection === 'camera'}
              aria-pressed={camera.projection === 'camera'}
              onclick={() => view.look({ projection: 'camera', fov: Math.min(camera.fov, 120) })}
              title="Straight lines stay straight, as in a photo">Photo</button
            >
            <button
              type="button"
              class:on={camera.projection === 'panorama'}
              aria-pressed={camera.projection === 'panorama'}
              onclick={() => view.look({ projection: 'panorama', fov: stripFov(), tilt: bandMiddle() })}
              title="The whole turn as one strip">Panorama</button
            >
          </div>
        </div>
      {/if}
    </details>

    <details class="hz-group" open>
      <summary>On the view</summary>
      <label class="check" title="Names read from OpenStreetMap once this is on">
        <input type="checkbox" checked={view.peaksOn} onchange={(event) => view.showPeaks(event.currentTarget.checked)} />
        <span>Summit names (OpenStreetMap)</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={view.skyOn} onchange={(event) => view.showSky(event.currentTarget.checked)} />
        <span>Sun and moon paths</span>
      </label>
      {#if view.skyOn}
        <div class="sky">
          <div class="line day">
            <DateField
              day
              reading={false}
              label="Day at the viewpoint"
              value={view.skyDate}
              onchange={(value) => value && view.setSkyDate(value)}
            />
            <button
              type="button"
              class="btn btn-sm pick"
              class:on={calendarOpen}
              aria-expanded={calendarOpen}
              aria-label="Pick the day on a calendar"
              title="Pick the day on a calendar"
              onclick={() => (calendarOpen = !calendarOpen)}><Icon name="calendar" size={14} /></button
            >
          </div>
          {#if calendarOpen}
            <MonthGrid
              value={view.skyDate}
              label="Day at the viewpoint"
              onpick={(day) => {
                if (day) view.setSkyDate(day);
                calendarOpen = false;
              }}
            />
          {/if}
          <div class="scrub">
            <input
              type="range"
              min="0"
              max="1435"
              step="5"
              value={minute}
              style:--track={track}
              oninput={(event) => view.setSkyTime(clockOf(Number(event.currentTarget.value)))}
              aria-label="Time of day at the viewpoint"
              aria-valuetext="{view.skyTime} {zone}"
            />
            <span class="now mono">{view.skyTime}{zone ? ` ${zone}` : ''}</span>
          </div>
          <div class="field">
            <span class="name">Shadows</span>
            <span class="end">Light</span>
            <input
              class="density"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={view.shadowDepth}
              oninput={(event) => view.setShadowDepth(event.currentTarget.value)}
              aria-label="How dark the shadows are"
              title="How much light the shadows keep"
            />
            <span class="end">Dark</span>
          </div>
          {#each skyLines(view.sky) as line (line)}
            <p class="fact">{line}</p>
          {/each}
        </div>
      {/if}
    </details>

    <details class="hz-group">
      <summary>More settings</summary>
      <div class="line">
        <label class="field">
          <span class="name short">Tilt</span>
          <input class="input mono" type="number" step="any" min="-89" max="89" value={Number(camera.tilt.toFixed(1))}
            onchange={(event) => view.look({ tilt: number(event) ?? camera.tilt })} />
          <span class="unit">°</span>
        </label>
        <label class="field">
          <span class="name short">Roll</span>
          <input class="input mono" type="number" step="any" min="-180" max="180" value={Number(camera.roll.toFixed(1))}
            onchange={(event) => view.look({ roll: number(event) ?? camera.roll })} />
          <span class="unit">°</span>
        </label>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm level"
        disabled={!camera.tilt && !camera.roll}
        onclick={() => view.look({ tilt: 0, roll: 0 })}>Level the view</button
      >
      <div class="field">
        <span class="name">Visibility</span>
        <input
          class="density"
          type="range"
          min="0"
          max={VISIBILITY_STEPS}
          step="1"
          value={visibilityStep(view.visibility)}
          oninput={(event) => view.setVisibility(visibilityAt(Number(event.currentTarget.value)))}
          aria-label="Visibility"
          aria-valuetext={seeing}
          title="How far the air lets the eye see: farther ground fades into haze"
        />
        <span class="end mono">{seeing}</span>
      </div>
      <label class="field">
        <span class="name">Hide ground closer than</span>
        <input class="input mono" type="number" min="0" step="any" value={view.near}
          onchange={(event) => view.setNear(number(event) ?? 0)} />
        <span class="unit">m</span>
      </label>
      {#if view.lines}
        <div class="field">
          <span class="name">Ridge lines</span>
          <span class="end">Fewer</span>
          <input
            class="density"
            type="range"
            min="0"
            max={RIDGE_STEPS.length - 1}
            step="1"
            value={view.ridges}
            oninput={(event) => view.setRidges(event.currentTarget.value)}
            aria-label="How many ridge lines"
          />
          <span class="end">More</span>
        </div>
      {/if}
    </details>
  {/if}
</div>

<style>
  .horizon-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    font-size: var(--fs-sm);
  }
  h4,
  summary {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  summary {
    cursor: pointer;
    padding: 2px 0;
  }
  summary:hover {
    color: var(--text-2);
  }
  summary:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent);
    border-radius: var(--r-sm);
  }
  /* a <details> lays its children out as blocks: the rhythm is margins, not a flex gap */
  .hz-group {
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .hz-group > * + * {
    margin-top: 8px;
  }
  .hz-group > .seg,
  .hz-group > .level {
    display: flex;
    width: max-content;
  }
  .readings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .reading .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
  }
  .reading .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 18px;
  }
  /* a verdict, where it is, by how much: its room is kept while nothing is marked */
  .reading .body.marked {
    min-height: 54px;
  }
  .empty-line {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .verdict .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .verdict.seen .dot {
    background: var(--ok);
  }
  .verdict.hidden .dot {
    background: var(--danger);
  }
  .acts {
    display: flex;
    gap: 4px;
  }
  .problem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--r-md);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--fs-xs);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .line.packed {
    justify-content: flex-start;
    gap: 10px;
  }
  .line > .fact {
    margin: 0;
  }
  .photo .file {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    color: var(--text-1);
  }
  .photo .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .photo .size {
    flex: none;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .coords {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-1);
    cursor: pointer;
  }
  .coords:hover {
    color: var(--accent);
  }
  .fact {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fact.warn {
    color: var(--danger);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .field .name {
    min-width: 0;
  }
  .field input.input {
    width: 70px;
    padding: 2px 6px;
    font-size: var(--fs-xs);
  }
  .unit,
  .end {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .density {
    width: 120px;
    accent-color: var(--accent);
  }
  .level {
    align-self: flex-start;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .sky {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 22px;
  }
  .sky :global(.date-field) {
    flex: 1;
  }
  .line.day {
    flex-wrap: nowrap;
    gap: 6px;
  }
  .pick {
    display: grid;
    place-items: center;
    padding: 0 7px;
  }
  .pick.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .scrub {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .scrub input {
    flex: 1;
    min-width: 0;
    height: 18px;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }
  /* the track is the day: clear sun, sun behind the ridges, night */
  .scrub input::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: var(--track, var(--bg-3));
  }
  .scrub input::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: var(--track, var(--bg-3));
  }
  .scrub input::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--text-1);
    box-shadow: 0 0 0 2px var(--bg-1);
  }
  .scrub input::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 50%;
    background: var(--text-1);
    box-shadow: 0 0 0 2px var(--bg-1);
  }
  .scrub input:focus-visible {
    outline: none;
  }
  .scrub input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .now {
    min-width: 82px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-align: right;
  }
  .seg {
    display: inline-flex;
    align-self: flex-start;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .seg button {
    min-height: 26px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--text-1);
  }
  .seg button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .seg button:focus-visible,
  .coords:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
</style>
