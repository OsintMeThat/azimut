<script>
  /**
   * The Horizon tab's inspector, under its map: what was read off the view,
   * then the settings as a sheet, a name on the left and its control on the
   * right, in groups a first-time user can scan.
   *
   * - **Readings** sit first and keep their place: the marked point (in sight
   *   or hidden, by how much) and the ground clicked in the view, each beside
   *   the mark the map and the view draw for it. Each holds its room while
   *   empty and says there how to fill it, so nothing under them moves when a
   *   click reads something.
   * - **Photo**, while one is laid over the view: what its file says of its
   *   lens, place and time, each offered with the act that applies it and
   *   never applied unasked, the lens's curve, and the strokes traced on it.
   * - **Viewpoint**: where the eye stands, who stands there, and how high.
   * - **Lens**: how wide it sees, and whether the frame is a photo or the
   *   panorama strip.
   * - **On the view**: summit names, and the sun and moon with their time.
   * - **More settings**, closed: tilt and roll (the view's own gestures set
   *   them), how far the air lets the eye see and from how near the ground is
   *   drawn, the ridge lines' density.
   *
   * A folded group says its gist on its title line, so the sheet still reads
   * with every group closed. Every number has two small arrows for the fine
   * step a wheel notch overshoots (NumberField). While a laid photo is locked
   * to the terrain, whatever would part them (where the eye stands, its
   * height, the lens, tilt and roll, the photo's curve) holds still, and the
   * sheet says why. The heading is written in one place only, the
   * caret under the view. Progress is said once, in the header; what failed is
   * said here, beside the thing it concerns, with a way to try again.
   */
  import Icon from '../../components/Icon.svelte';
  import DateField from '../../components/DateField.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import NumberField from './NumberField.svelte';
  import { copyText } from '../../lib/clipboard.js';
  import { fmtCoords } from '../../lib/state.svelte.js';
  import { focal35FromFov, fovFromFocal35 } from '../../lib/horizon/camera.js';
  import { HEIGHT_LIMITS, MODE_LABELS, MODES, visibilityAt, visibilityStep, VISIBILITY_STEPS } from '../../lib/horizon/view.js';
  import { formatDistance, formatHeight } from '../../lib/measure.js';
  import { bandsGradient, clockOf, minuteOf, skyLines, sunBands } from '../../lib/horizon/sky.js';
  import { targetReading } from '../../lib/horizon/readings.js';
  import { distanceBetween } from '../../lib/horizon/geometry.js';
  import { BEND_MAX, isZoned, localClock } from '../../lib/horizon/overlay.js';
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

  const HEIGHT_LABELS = { ground: 'Eye height', drone: 'Height', aircraft: 'Altitude' };
  /** What a height is measured from, said after its field where the name alone would not. */
  const HEIGHT_FROM = { ground: '', drone: 'above the ground', aircraft: 'above sea level' };
  /** One press of a height's arrows: a hand's breadth for a person, more for what flies. */
  const HEIGHT_STEPS = { ground: 0.1, drone: 1, aircraft: 10 };
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
  /** A laid photo held to the terrain: whatever would part them holds still. */
  const locked = $derived(Boolean(photo && overlay.locked));
  const LOCKED_TITLE = 'Photo and terrain move together: move one alone to change this';
  const lens = $derived(photo ? overlay.lens : null);
  const lensOff = $derived(Boolean(lens) && Math.abs(lens.fov - camera.fov) > 0.05);
  const fileWord = $derived(photo?.kind === 'video' ? 'video' : 'photo');
  /** The lens's curve undone, said as a number with its kind. */
  const bendText = $derived(
    !overlay?.bend ? 'None' : `${overlay.bend < 0 ? 'Barrel' : 'Pincushion'} ${Math.abs(overlay.bend).toFixed(2)}`
  );
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
      // the app asks again by itself, so this one only says so
      view.peaksOn &&
        !view.peaksError &&
        view.peaksFailed && {
          id: 'peaks-missing',
          text: 'OpenFreeMap did not answer for some summits. Asking again shortly.',
          retry: () => view.retryPeaks(),
          quiet: true,
        },
      view.ground === 'imagery' &&
        view.imageryError && { id: 'imagery', text: view.imageryError, retry: () => view.retryImagery() },
      view.skyOn && view.skyError && { id: 'sky', text: view.skyError, retry: () => view.retrySky() },
      view.nearOn && view.nearError && { id: 'near', text: view.nearError, retry: () => view.retryNear() },
    ].filter(Boolean)
  );
  // -- the groups, and what a folded one says on its title line ---------------------

  const opened = $state({ photo: true, viewpoint: true, lens: true, view: true, more: false });

  const viewpointGist = $derived(observer ? `${MODE_LABELS[observer.mode]} · ${observer.height} m` : '');
  const lensGist = $derived(
    camera.projection === 'panorama' ? `Panorama · ${Math.round(camera.fov)}°` : `${Math.round(camera.fov)}° · ${focal} mm`
  );
  const onViewGist = $derived([view.peaksOn && 'Summits', view.skyOn && `Sun ${view.skyTime}`].filter(Boolean).join(' · ') || 'Nothing');
  const moreGist = $derived(
    [(camera.tilt || camera.roll) && 'Leaning', view.visibility && seeing, view.near && `Hidden under ${formatDistance(view.near, units)}`]
      .filter(Boolean)
      .join(' · ')
  );
</script>

{#snippet group(id, title, gist, body, frozen = false)}
  <details class="hz-group" bind:open={opened[id]}>
    <summary>
      <span class="group-title">{title}</span>
      {#if !opened[id] && gist}<span class="gist">{gist}</span>{/if}
      <span class="chev" aria-hidden="true"><Icon name="chevronDown" size={13} /></span>
    </summary>
    <fieldset class="sheet" disabled={frozen} title={frozen ? LOCKED_TITLE : undefined}>
      {@render body()}
    </fieldset>
  </details>
{/snippet}

<div class="horizon-panel">
  {#if observer}
    <section class="readings" aria-label="Readings">
      <div class="reading marked">
        <div class="top">
          <span
            class="glyph pin"
            class:seen={reading && view.target.visible}
            class:hidden={reading && !view.target.visible}
            aria-hidden="true"
          ></span>
          <h4>Marked point</h4>
          {#if view.target && !view.target.busy}
            <span class="acts">
              {#if view.target.error}
                <button type="button" class="btn btn-sm" onclick={() => view.retryTarget()}>Try again</button>
              {:else}
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={locked}
                  title={locked ? LOCKED_TITLE : undefined}
                  onclick={() => onturn({ azimuth: view.target.azimuth, elevation: view.target.angle })}>Turn to it</button
                >
              {/if}
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => view.clearTarget()}>Clear</button>
            </span>
          {/if}
        </div>
        <div class="body">
          {#if !view.target}
            <p class="empty-line">Click the map to mark a point.</p>
          {:else if view.target.busy}
            <p class="fact">Reading the line of sight…</p>
          {:else if view.target.error}
            <p class="fact warn">{view.target.error}</p>
          {:else if reading}
            <p class="verdict" class:seen={view.target.visible} class:hidden={!view.target.visible}>{reading.verdict}</p>
            <p class="fact">{reading.where}</p>
            {#if reading.margin}<p class="fact">{reading.margin}</p>{/if}
          {/if}
        </div>
      </div>
      <div class="reading pointed">
        <div class="top">
          <span class="glyph crosshair" class:off={!view.pointed} aria-hidden="true">
            <svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="3.5" /><path d="M-6.5 0h3M3.5 0h3M0 -6.5v3M0 3.5v3" /></svg>
          </span>
          <h4>Clicked in the view</h4>
          {#if view.pointed}
            <span class="acts">
              <button
                type="button"
                class="btn btn-sm"
                disabled={locked}
                title={locked ? LOCKED_TITLE : undefined}
                onclick={() => view.standAt(view.pointed)}>Stand here</button
              >
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => view.point(null)}>Clear</button>
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

  {#if locked}
    <p class="locked-note"><Icon name="lock" size={12} />Photo and terrain move together. Move one alone to change the match.</p>
  {/if}

  {#each problems as problem (problem.id)}
    <p class="problem" class:quiet={problem.quiet} role={problem.quiet ? 'status' : 'alert'}>
      <span>{problem.text}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick={problem.retry}>Try again</button>
    </p>
  {/each}

  {#if observer && photo}
    {#snippet photoBody()}
      <span class="key">File</span>
      <span class="value file" title={photo.name}>
        <span class="file-name">{photo.name}</span>
        {#if overlay.size.width}<span class="mono size">{overlay.size.width} × {overlay.size.height}</span>{/if}
      </span>
      <span class="key">Lens</span>
      {#if lens}
        <span class="value with-act">
          <span>{Math.round(lens.mm)} mm → {lens.fov.toFixed(1)}°</span>
          {#if lensOff}
            <button
              type="button"
              class="btn btn-sm"
              disabled={locked}
              onclick={() => overlay.useLens()}
              title={locked ? LOCKED_TITLE : 'Set the lens to the one the file says'}>Use</button
            >
          {/if}
        </span>
      {:else}
        <span class="value quiet">{overlay.busy ? 'Reading the file…' : `Not in the ${fileWord}`}</span>
      {/if}
      <span class="key">Distortion</span>
      <span class="value slide">
        <input
          type="range"
          min={-BEND_MAX}
          max={BEND_MAX}
          step="0.005"
          value={overlay.bend}
          disabled={locked}
          oninput={(event) => overlay.setBend(event.currentTarget.value)}
          ondblclick={() => overlay.setBend(0)}
          aria-label="Lens distortion"
          aria-valuetext={bendText}
          title="Straightens the curve a wide lens gives the edges; double-click for none"
        />
        <span class="end mono">{bendText}</span>
      </span>
      {#if placed}
        <span class="key">Place</span>
        <span class="value with-act">
          <span>{placedAway < 30 ? 'This viewpoint' : `${formatDistance(placedAway, units)} away`}</span>
          {#if placedAway >= 30}
            <button
              type="button"
              class="btn btn-sm"
              disabled={locked}
              onclick={() => view.standAt(placed)}
              title={locked ? LOCKED_TITLE : 'Stand where the file says it was taken'}>Stand there</button
            >
          {/if}
        </span>
      {/if}
      {#if taken}
        <span class="key">Taken</span>
        <span class="value with-act">
          <span>{takenText(taken)}</span>
          <button
            type="button"
            class="btn btn-sm"
            onclick={setSun}
            title={isZoned(taken) ? 'Put the sun and moon at this time, on the place’s clock' : 'Put the sun and moon at this time, read as the local time there'}
            >Set the sun</button
          >
        </span>
      {/if}
      {#if overlay.strokes.length}
        <span class="key">Trace</span>
        <span class="value with-act">
          <span>{overlay.strokes.length === 1 ? 'One stroke' : `${overlay.strokes.length} strokes`}</span>
          <span class="acts">
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => overlay.undoStroke()} title="Take the last change to the trace back (Ctrl+Z)">Undo</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => overlay.clearTrace()}>Clear</button>
          </span>
        </span>
      {/if}
      <p class="hint wide">{lens ? 'The lens is the file’s.' : 'No lens in the file: match it by eye or with Fit to trace.'} Alt+wheel on the view sets the height.</p>
    {/snippet}
    {@render group('photo', photo.kind === 'video' ? 'Video' : 'Photo', photo.name, photoBody)}
  {/if}

  {#if observer}
    {#snippet viewpointBody()}
      <span class="key">Position</span>
      <span class="value">
        <button type="button" class="coords mono" onclick={() => copyText(fmtCoords(observer.lat, observer.lon))} title="Copy coordinates">
          {fmtCoords(observer.lat, observer.lon)}
          <Icon name="copy" size={11} />
        </button>
      </span>
      <span class="key">Who</span>
      <span class="value">
        <span class="seg" role="group" aria-label="Who is looking">
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
        </span>
      </span>
      <label class="key" for="hz-height">{HEIGHT_LABELS[observer.mode]}</label>
      <span class="value">
        <NumberField
          id="hz-height"
          label={HEIGHT_LABELS[observer.mode]}
          value={observer.height}
          unit="m"
          step={HEIGHT_STEPS[observer.mode]}
          min={HEIGHT_LIMITS[observer.mode][0]}
          max={HEIGHT_LIMITS[observer.mode][1]}
          disabled={locked}
          onchange={(height) => view.setHeight(height)}
        />
        {#if HEIGHT_FROM[observer.mode]}<span class="hint">{HEIGHT_FROM[observer.mode]}</span>{/if}
      </span>
      {#if altitude}
        <span class="key">Ground</span>
        <span class="value">{formatHeight(altitude.ground, units)} above sea level</span>
      {/if}
      {#if onmove}
        <span class="wide line">
          <button type="button" class="btn btn-sm" onclick={onmove}>Move the viewpoint</button>
          <span class="hint">or drag the orange dot</span>
        </span>
      {/if}
    {/snippet}
    {@render group('viewpoint', 'Viewpoint', viewpointGist, viewpointBody, locked)}

    {#snippet lensBody()}
      <span class="key">Width</span>
      <span class="value pair">
        <NumberField
          label="Field of view in degrees"
          value={Number(camera.fov.toFixed(1))}
          unit="°"
          step={0.1}
          min={1}
          max={camera.projection === 'panorama' ? 360 : 150}
          disabled={locked}
          onchange={(fov) => view.look({ fov: fov ?? camera.fov })}
        />
        {#if camera.projection === 'camera'}
          <NumberField
            label="Focal length, 35 mm equivalent"
            title="Focal length, 35 mm equivalent"
            value={focal}
            unit="mm"
            step={1}
            min={5}
            disabled={locked}
            onchange={(mm) => {
              if (mm > 0) view.look({ fov: fovFromFocal35(mm, aspect) });
            }}
          />
        {/if}
      </span>
      <!-- a photo is a rectilinear frame: while one is laid there is no other to pick -->
      {#if !photo}
        <span class="key">Frame</span>
        <span class="value">
          <span class="seg" role="group" aria-label="Frame">
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
          </span>
        </span>
      {/if}
    {/snippet}
    {@render group('lens', 'Lens', lensGist, lensBody, locked)}

    {#snippet onViewBody()}
      <label class="check wide" title="Names from OpenStreetMap via OpenFreeMap, read once this is on">
        <input type="checkbox" checked={view.peaksOn} onchange={(event) => view.showPeaks(event.currentTarget.checked)} />
        <span>Summit names</span>
        <span class="source">OpenStreetMap</span>
      </label>
      <label class="check wide">
        <input type="checkbox" checked={view.skyOn} onchange={(event) => view.showSky(event.currentTarget.checked)} />
        <span>Sun and moon paths</span>
      </label>
      {#if view.skyOn}
        <span class="key">Day</span>
        <span class="value day">
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
        </span>
        {#if calendarOpen}
          <div class="wide">
            <MonthGrid
              value={view.skyDate}
              label="Day at the viewpoint"
              onpick={(day) => {
                if (day) view.setSkyDate(day);
                calendarOpen = false;
              }}
            />
          </div>
        {/if}
        <span class="key">Time</span>
        <span class="value scrub">
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
        </span>
        <span class="key">Shadows</span>
        <span class="value slide">
          <span class="end">Light</span>
          <input
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
        </span>
        {#each skyLines(view.sky) as line (line)}
          <p class="fact wide">{line}</p>
        {/each}
      {/if}
    {/snippet}
    {@render group('view', 'On the view', onViewGist, onViewBody)}

    {#snippet moreBody()}
      <span class="key">Tilt</span>
      <span class="value pair">
        <NumberField
          label="Tilt"
          value={Number(camera.tilt.toFixed(1))}
          unit="°"
          step={0.1}
          min={-89}
          max={89}
          disabled={locked}
          onchange={(tilt) => view.look({ tilt: tilt ?? camera.tilt })}
        />
        <span class="key inline">Roll</span>
        <NumberField
          label="Roll"
          value={Number(camera.roll.toFixed(1))}
          unit="°"
          step={0.1}
          min={-180}
          max={180}
          disabled={locked}
          onchange={(roll) => view.look({ roll: roll ?? camera.roll })}
        />
      </span>
      <span class="wide">
        <button
          type="button"
          class="btn btn-ghost btn-sm level"
          disabled={locked || (!camera.tilt && !camera.roll)}
          onclick={() => view.look({ tilt: 0, roll: 0 })}>Level the view</button
        >
      </span>
      <span class="key">Visibility</span>
      <span class="value slide">
        <input
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
      </span>
      <label class="key" for="hz-near" title="Leave out the ground closer than this, such as a wall or a slope in front of the eye">Hide nearer than</label>
      <span class="value">
        <NumberField id="hz-near" label="Hide nearer than" value={view.near} unit="m" step={10} min={0} onchange={(near) => view.setNearLimit(near ?? 0)} />
      </span>
      {#if view.lines}
        <span class="key">Ridge lines</span>
        <span class="value slide">
          <span class="end">Fewer</span>
          <input
            type="range"
            min="0"
            max={RIDGE_STEPS.length - 1}
            step="1"
            value={view.ridges}
            oninput={(event) => view.setRidges(event.currentTarget.value)}
            aria-label="How many ridge lines"
          />
          <span class="end">More</span>
        </span>
      {/if}
    {/snippet}
    {@render group('more', 'More settings', moreGist, moreBody)}
  {/if}
</div>

<style>
  .horizon-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px 16px;
    font-size: var(--fs-xs);
    color: var(--text-1);
  }

  /* -- the readings: a card, each row beside the mark the map and the view draw -- */
  .readings {
    display: flex;
    flex-direction: column;
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .reading {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px 9px;
  }
  .reading + .reading {
    border-top: 1px solid var(--border);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }
  h4 {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .top .acts {
    margin-left: auto;
  }
  /* the lines sit under the name, clear of the glyph */
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 22px;
  }
  .glyph {
    display: grid;
    flex: none;
    place-items: center;
    width: 14px;
    height: 14px;
  }
  .glyph.pin::before {
    content: '';
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 11px solid var(--text-3);
  }
  .glyph.pin.seen::before {
    border-top-color: var(--hz-seen, var(--ok));
  }
  .glyph.pin.hidden::before {
    border-top-color: var(--hz-hidden, var(--danger));
  }
  .glyph.crosshair svg {
    fill: none;
    stroke: var(--hz-mark, var(--accent));
    stroke-width: 1.5;
  }
  .glyph.crosshair.off svg {
    stroke: var(--text-3);
  }
  .empty-line {
    margin: 0;
    line-height: 16px;
    color: var(--text-3);
  }
  .verdict {
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 18px;
  }
  /* the same two colours as the pin on the map and the mark in the view */
  .verdict.seen {
    color: var(--hz-seen, var(--ok));
  }
  .verdict.hidden {
    color: var(--hz-hidden, var(--danger));
  }
  .acts {
    display: flex;
    gap: 4px;
  }
  .locked-note {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--text-1);
  }
  .locked-note :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .sheet:disabled {
    opacity: 0.6;
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
  }
  .problem.quiet {
    background: var(--bg-2);
    color: var(--text-2);
  }

  /* -- a group: its title, its gist while folded, a chevron on the right -------- */
  .hz-group {
    border-top: 1px solid var(--border);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .group-title {
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .gist {
    min-width: 0;
    overflow: hidden;
    color: var(--text-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    display: grid;
    place-items: center;
    margin-left: auto;
    color: var(--text-3);
    transition: transform 120ms ease;
  }
  details:not([open]) .chev {
    transform: rotate(-90deg);
  }
  summary:hover .group-title,
  summary:hover .chev {
    color: var(--text-1);
  }
  summary:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent);
    border-radius: var(--r-sm);
  }

  /* -- the sheet: a name on the left, its control on the right --------------------- */
  .sheet {
    min-width: 0;
    margin: 0;
    border: 0;
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    align-items: center;
    gap: 9px 12px;
    padding: 2px 0 14px;
  }
  .key {
    color: var(--text-2);
    line-height: 1.25;
  }
  .key.inline {
    margin-left: 6px;
  }
  .value {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 26px;
  }
  .value.quiet {
    color: var(--text-3);
  }
  .value.with-act {
    justify-content: space-between;
  }
  .value.pair {
    gap: 6px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .file {
    gap: 8px;
  }
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    flex: none;
    color: var(--text-3);
  }
  .hint {
    margin: 0;
    color: var(--text-3);
  }
  .fact {
    margin: 0;
    color: var(--text-2);
    line-height: 16px;
  }
  .fact.warn {
    color: var(--danger);
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

  .slide input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }
  .end {
    flex: none;
    color: var(--text-3);
  }
  .level {
    padding-left: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    color: var(--text-1);
    cursor: pointer;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .source {
    color: var(--text-3);
  }
  .day :global(.date-field) {
    flex: 1;
    min-width: 0;
  }
  .pick {
    display: grid;
    place-items: center;
    padding: 0 7px;
    align-self: stretch;
  }
  .pick.on {
    color: var(--accent);
    border-color: var(--accent);
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
    flex: none;
    color: var(--text-1);
    font-weight: 600;
    text-align: right;
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .seg button {
    min-height: 24px;
    padding: 0 9px;
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
