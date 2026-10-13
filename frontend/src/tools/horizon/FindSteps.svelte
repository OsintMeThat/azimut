<script>
  /**
   * The steps of Find, in the order the work goes: the skyline traced on the
   * photo, the area drawn on the map, the alignments that narrow it (optional),
   * what is known about the photo and who took it, then the search. Each step
   * says where it stands in a line; what is rarely changed folds under More
   * settings.
   */
  import Icon from '../../components/Icon.svelte';
  import PhotoHints from './PhotoHints.svelte';
  import { ALIGN_TOLERANCES, areaText, HEAT_RAMP, UNCLEAR_HELP, VERDICTS } from '../../lib/horizon/find.js';
  import { AUTO_REACH, reachText, ZOOMS } from '../../lib/horizon/hints.js';
  import { headingText } from '../../lib/horizon/geometry.js';
  import { durationText, SPACINGS, WHO } from './state/find.svelte.js';
  import { formatDistance } from '../../lib/measure.js';

  let {
    /** The finder (state/find.svelte.js). */
    find,
    /** The photo and its trace (state/overlay.svelte.js). */
    overlay,
    units = 'metric',
    /** Asked to stand at a place, `{ lat, lon }`. */
    onstand = () => {},
    /** Asked to start the search (a case is made first when none is open). */
    onsearch = () => {},
    /** Asked to look from a place the search found, `{ lat, lon, heading, fov, tilt, roll, reach, height }`. */
    onplace = () => {},
    /** Asked to open a search the case keeps, by name. */
    onopensearch = () => {},
    /** Asked to delete one, by name. */
    onremovesearch = () => {},
    /** The place the map lights, by its index in the results, or -1. */
    lit = $bindable(-1),
  } = $props();

  let more = $state(false);
  let starting = $state(false);

  // how large the search would be, asked again a moment after what it depends on changes
  let estimateTimer = null;
  $effect(() => {
    void [find.area, find.settings, find.who, find.alignments.length, overlay.strokes, overlay.hints, overlay.lens];
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(() => find.estimate(), 500);
    return () => clearTimeout(estimateTimer);
  });

  const search = $derived(find.search);
  const result = $derived(search?.status === 'done' ? search.result : null);
  const progress = $derived(search?.progress?.total ? Math.round((100 * search.progress.done) / search.progress.total) : 0);
  const earlier = $derived(find.list.filter((row) => row.name !== search?.name));

  /** What the search will run with, said before it runs: the lens, how far it reads, who took the photo. */
  const told = $derived.by(() => {
    const hints = overlay.hints ?? {};
    const lens = overlay.lens;
    const anyLens = !lens && !overlay.isPanorama && (hints.zoom ?? 'any') === 'any';
    const zoom = ZOOMS.find((z) => z.id === hints.zoom);
    const lensWords = lens ? `a ${Math.round(lens.fov)}° lens` : overlay.isPanorama ? 'a panorama' : anyLens ? 'any lens' : `${zoom.label.toLowerCase()} lenses`;
    const near = Number.isFinite(hints.reach) && hints.reach <= 10_000 ? hints.reach : null;
    const reachWords = Number.isFinite(hints.reach)
      ? `ridges within ${reachText(hints.reach)}`
      : hints.reach === 'all'
        ? 'every ridge'
        : `ridges within ${reachText(AUTO_REACH)}`;
    return { line: `${lensWords} · ${reachWords} · ${WHO[find.who.mode].label.toLowerCase()}`, anyLens, near };
  });

  /** Time left as this machine has gone so far: "3 min", "40 s". */
  function leftText(seconds) {
    if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toFixed(1)} h`;
  }

  async function start() {
    starting = true;
    try {
      await onsearch();
    } finally {
      starting = false;
    }
  }

  const traced = $derived(overlay.strokes.length);
  const ALIGN_TOTAL = 4;
  const whoRange = $derived(find.who.mode === 'aircraft' ? 'above the sea' : 'above the ground');

  function heightsOf(one, end, value) {
    find.setTops(one.id, true, { ...one.heights, [end]: Number(value) });
  }

  function touchLine(one) {
    const touch = one.touch;
    if (!touch) return '';
    if (touch.busy) return 'Reading the terrain along the line…';
    if (touch.error) return touch.error;
    if (!touch.fits?.length) return find.who.mode === 'ground'
      ? 'No place on this line stands at eye height: check the tops and their heights'
      : 'No stretch of this line stays within those heights';
    return '';
  }
</script>

<div class="fs">
  <ol class="fs-steps">
    <li class="fs-step" class:done={traced > 0}>
      <h3><span class="fs-num">1</span>Skyline</h3>
      {#if !overlay.source}
        <p class="fs-say">Add the photo first.</p>
      {:else if traced}
        <p class="fs-say">{traced} {traced === 1 ? 'line' : 'lines'} traced. Rub out clouds, trees and buildings.</p>
      {:else}
        <p class="fs-say">Trace the skyline on the photo, or press Detect.</p>
      {/if}
    </li>

    <li class="fs-step" class:done={find.area.length >= 3 && !find.areaProblem && find.drawing !== 'area'}>
      <h3><span class="fs-num">2</span>Area</h3>
      {#if find.drawing === 'area'}
        <p class="fs-say">Click each corner on the map. Press the first one, or Enter, to close it.</p>
        <div class="fs-acts">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={find.area.length < 3}
            onclick={() => find.closeArea()}>Done</button
          >
          <button type="button" class="btn btn-sm" onclick={() => find.clearArea()}>Cancel</button>
        </div>
      {:else if find.area.length >= 3}
        <p class="fs-say">{areaText(find.area)}</p>
        {#if find.areaProblem}<p class="fs-say bad">{find.areaProblem}</p>{/if}
        <div class="fs-acts">
          <button type="button" class="btn btn-sm" onclick={() => find.drawArea()}>Draw again</button>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.clearArea()}>Clear</button>
        </div>
      {:else}
        <p class="fs-say">Where the photo may have been taken.</p>
        <div class="fs-acts">
          <button type="button" class="btn btn-sm btn-primary" onclick={() => find.drawArea()}><Icon name="polygon" size={13} />Draw the area</button>
        </div>
      {/if}
    </li>

    <li class="fs-step" class:done={find.alignments.length > 0}>
      <h3><span class="fs-num">3</span>Alignments <span class="fs-optional">optional</span></h3>
      <p class="fs-say">Two things standing one behind the other in the photo: the camera is on their line.</p>
      {#each find.alignments as one, index (one.id)}
        <div class="fs-align" style:--align={one.colour}>
          <div class="fs-align-head">
            <span class="fs-swatch">{index + 1}</span>
            <span class="fs-align-what">
              {#if Math.abs(one.offset) < 0.05}Lined up{:else}{Math.abs(one.offset).toFixed(1)}° apart in the photo{/if}
            </span>
            <button type="button" class="fs-x" onclick={() => find.removeAlignment(one.id)} title="Take this alignment away" aria-label="Take alignment {index + 1} away"
              ><Icon name="x" size={12} /></button
            >
          </div>
          {#if !one.offsetKnown}
            <p class="fs-say quiet">The two stand apart across a photo of unknown lens: read as lined up.</p>
          {/if}
          <label class="fs-check">
            <input type="checkbox" checked={one.tops} onchange={(event) => find.setTops(one.id, event.currentTarget.checked)} />
            The top of the near one touches the far one
          </label>
          {#if one.tops}
            <div class="fs-heights">
              <label>Near top <input type="number" min="0" max="1000" step="1" value={one.heights.near} onchange={(event) => heightsOf(one, 'near', event.currentTarget.value)} /> m</label>
              <label>Far top <input type="number" min="0" max="1000" step="1" value={one.heights.far} onchange={(event) => heightsOf(one, 'far', event.currentTarget.value)} /> m</label>
            </div>
            <p class="fs-say quiet">Over the ground; 0 is a summit or a ridge, read as the highest ground near the click.</p>
            {#if touchLine(one)}
              <p class="fs-say" class:bad={one.touch?.error}>{touchLine(one)}</p>
            {/if}
            {#each one.touch?.fits ?? [] as fit, n (n)}
              <div class="fs-fit">
                {#if fit.at}
                  <span>Eye at {fit.at.eye} m, {formatDistance(fit.at.distance, units)} behind the near one</span>
                  <button type="button" class="btn btn-sm" onclick={() => onstand(fit.at)}>Stand here</button>
                {:else}
                  <span>{formatDistance(fit.from.distance, units)} to {formatDistance(fit.to.distance, units)} behind it, {fit.to.eye} to {fit.from.eye} m up</span>
                  <button type="button" class="btn btn-sm" onclick={() => onstand(fit.from)}>Stand here</button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
      {#if find.pending}
        <div class="fs-guide" role="status">
          <span><strong>{find.pending.step + 1} of {ALIGN_TOTAL}</strong> · {find.step?.text}</span>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.cancelAlignment()}>Cancel</button>
        </div>
      {:else}
        <div class="fs-acts">
          <button type="button" class="btn btn-sm" disabled={!overlay.source} onclick={() => find.startAlignment()}
            ><Icon name="plus" size={13} />Add an alignment</button
          >
        </div>
      {/if}
      {#if find.meeting}
        <div class="fs-fit meet">
          <span>The lines meet within {formatDistance(find.meeting.spread, units)}</span>
          <button type="button" class="btn btn-sm btn-primary" onclick={() => onstand(find.meeting.at)}>Stand here</button>
        </div>
      {/if}
    </li>

    <li class="fs-step">
      <h3><span class="fs-num">4</span>What you know</h3>
      <div class="fs-row">
        <span class="fs-name" id="find-who">Taken</span>
        <div class="fs-pills" role="radiogroup" aria-labelledby="find-who">
          {#each Object.entries(WHO) as [mode, one] (mode)}
            <button type="button" role="radio" class:on={find.who.mode === mode} aria-checked={find.who.mode === mode} onclick={() => find.setWho({ mode })}
              >{one.label}</button
            >
          {/each}
        </div>
      </div>
      {#if find.who.mode !== 'ground'}
        <div class="fs-row">
          <span class="fs-name">Height</span>
          <span class="fs-range">
            <input type="number" min="1" max="15000" step="10" value={find.who.low} aria-label="Lowest" onchange={(event) => find.setWho({ low: Number(event.currentTarget.value) })} />
            to
            <input type="number" min="1" max="15000" step="10" value={find.who.high} aria-label="Highest" onchange={(event) => find.setWho({ high: Number(event.currentTarget.value) })} />
            m {whoRange}
          </span>
        </div>
      {/if}
      {#if overlay.source}
        <PhotoHints {overlay} facing={false} />
      {/if}
    </li>

    <li class="fs-step" class:done={Boolean(result)}>
      <h3><span class="fs-num">5</span>Search</h3>
      {#if find.searching}
        <p class="fs-say" role="status">
          {search.status === 'queued' ? 'Waiting its turn…' : `Searching: ${search.progress?.done ?? 0} of ${search.progress?.total || '…'} points`}{Number.isFinite(
            search.progress?.left
          ) && search.progress.left > 0
            ? `, ${leftText(search.progress.left)} left`
            : ''}
        </p>
        <div class="fs-bar" aria-hidden="true"><span style:width="{progress}%"></span></div>
        <div class="fs-acts">
          <button type="button" class="btn btn-sm" onclick={() => find.stop()}>Stop</button>
        </div>
        <p class="fs-say quiet">It runs in the app: you can leave Find and come back.</p>
      {:else if result}
        <p class="fs-say strong">{VERDICTS[result.verdict] ?? ''}</p>
        {#if result.verdict === 'unclear'}
          <p class="fs-say">{UNCLEAR_HELP}</p>
        {/if}
        <ol class="fs-places">
          {#each result.places as place, index (index)}
            <li>
              <button
                type="button"
                class="fs-place"
                class:on={lit === index}
                onmouseenter={() => (lit = index)}
                onmouseleave={() => (lit = -1)}
                onfocus={() => (lit = index)}
                onblur={() => (lit = -1)}
                onclick={() => onplace(place)}
                title="Look from here, the photo laid as the search found it"
              >
                <span class="fs-rank">{index + 1}</span>
                <span class="fs-place-text">
                  <strong>explains {Math.round(Math.max(0, place.explained) * 100)}%</strong>
                  <small
                    >{place.heading != null ? `facing ${headingText(place.heading, place.fov ?? 60)} · ` : ''}{place.fov != null
                      ? `${place.fov < 10 ? place.fov.toFixed(1) : Math.round(place.fov)}° lens · `
                      : ''}{Number.isFinite(place.reach) ? `ridges within ${reachText(place.reach)}` : ''}</small
                  >
                  <small>{place.lat.toFixed(4)}, {place.lon.toFixed(4)}</small>
                </span>
                <Icon name="chevronRight" size={13} />
              </button>
            </li>
          {/each}
        </ol>
        <div class="fs-legend" aria-hidden="true">
          <span>Explains less</span>
          <span class="fs-ramp">{#each HEAT_RAMP as step (step)}<i style:background={step}></i>{/each}</span>
          <span>more</span>
        </div>
        <p class="fs-say quiet">A score, not a probability: far ridges look alike over wide ground.</p>
        <div class="fs-acts">
          <button type="button" class="btn btn-sm" disabled={Boolean(find.searchProblem) || starting} onclick={start}>Search again</button>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.closeSearch()}>Clear the results</button>
        </div>
      {:else}
        {#if search?.status === 'failed'}
          <p class="fs-say bad">{search.error || 'The search failed'}</p>
        {:else if search?.status === 'cancelled'}
          <p class="fs-say">Stopped.</p>
        {/if}
        {#if find.searchProblem}
          <p class="fs-say">{find.searchProblem}.</p>
        {:else}
          <p class="fs-say">With {told.line}.</p>
          {#if told.near}
            <p class="fs-say warn">Ridges past {reachText(told.near)} are left out: a far skyline cannot be found.</p>
          {/if}
          {#if told.anyLens}
            <p class="fs-say warn">Any lens finds more chance fits: say the zoom if you can.</p>
          {/if}
          {#if find.estimated}
            <p class="fs-say">{find.estimated.points} points, {durationText(find.estimated.points, find.estimated.step)}.</p>
          {/if}
        {/if}
        <div class="fs-acts">
          <button type="button" class="btn btn-sm btn-primary" disabled={Boolean(find.searchProblem) || starting} onclick={start}
            ><Icon name="search" size={13} />Search</button
          >
        </div>
      {/if}
      {#if earlier.length}
        <div class="fs-earlier">
          <span class="fs-name">Earlier searches</span>
          {#each earlier as row (row.name)}
            <div class="fs-earlier-row">
              <button type="button" class="fs-link" onclick={() => onopensearch(row.name)} title="Open this search, its area and its map">
                {row.title}
                <small>{row.status === 'done' ? (row.best ? `best ${Math.round(row.best.explained * 100)}%` : 'nothing found') : row.status}</small>
              </button>
              <button type="button" class="fs-x" onclick={() => onremovesearch(row.name)} title="Delete this search" aria-label="Delete {row.title}"
                ><Icon name="trash" size={12} /></button
              >
            </div>
          {/each}
        </div>
      {/if}
    </li>
  </ol>

  <div class="fs-more">
    <button type="button" class="fs-fold" aria-expanded={more} onclick={() => (more = !more)}>
      <Icon name={more ? 'chevronDown' : 'chevronRight'} size={13} />More settings
    </button>
    {#if more}
      <div class="fs-row">
        <span class="fs-name" id="find-spacing">Grid</span>
        <div class="fs-pills" role="radiogroup" aria-labelledby="find-spacing">
          {#each SPACINGS as spacing (spacing)}
            <button
              type="button"
              role="radio"
              class:on={find.settings.spacing === spacing}
              aria-checked={find.settings.spacing === spacing}
              title={spacing === 'auto' ? 'As fine as the area allows' : `A point every ${spacing} m`}
              onclick={() => find.setSettings({ spacing })}>{spacing === 'auto' ? 'Auto' : formatDistance(spacing, units)}</button
            >
          {/each}
        </div>
      </div>
      <div class="fs-row">
        <span class="fs-name" id="find-tolerance">Line width</span>
        <div class="fs-pills" role="radiogroup" aria-labelledby="find-tolerance">
          {#each ALIGN_TOLERANCES as tolerance (tolerance)}
            <button
              type="button"
              role="radio"
              class:on={find.settings.tolerance === tolerance}
              aria-checked={find.settings.tolerance === tolerance}
              title="An alignment's camera stands within {tolerance}° of its line"
              onclick={() => find.setSettings({ tolerance })}>±{tolerance}°</button
            >
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .fs {
    display: grid;
    gap: 14px;
    padding: 14px;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .fs-steps {
    display: grid;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fs-step {
    display: grid;
    gap: 7px;
  }
  .fs-step h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .fs-num {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 11px;
  }
  .fs-step.done .fs-num {
    background: var(--accent);
    color: var(--accent-text);
  }
  .fs-optional {
    color: var(--text-3);
    font-weight: 400;
    font-size: var(--fs-xs);
  }
  .fs-say {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .fs-say.quiet {
    color: var(--text-3);
  }
  .fs-say.bad {
    color: var(--danger);
  }
  .fs-say.warn {
    color: var(--warning, #e0a63a);
  }
  .fs-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fs-align {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-left: 3px solid var(--align);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .fs-align-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .fs-swatch {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--align);
    color: #0b0d10;
    font-size: 11px;
    font-weight: 700;
  }
  .fs-align-what {
    flex: 1;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .fs-x:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .fs-check {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-heights {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-heights input,
  .fs-range input {
    width: 64px;
  }
  .fs-fit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .fs-fit.meet {
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
  }
  .fs-guide {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .fs-row {
    display: grid;
    grid-template-columns: 76px 1fr;
    align-items: center;
    gap: 8px;
  }
  .fs-name {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .fs-pills button {
    height: 26px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .fs-pills button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .fs-range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-more {
    display: grid;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .fs-fold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-self: start;
    border: none;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .fs-step :global(.hints) {
    width: auto;
  }
  .fs-say.strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .fs-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--bg-2);
    overflow: hidden;
  }
  .fs-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.4s;
  }
  .fs-places {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fs-place {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fs-place:hover,
  .fs-place.on {
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
    color: var(--text-1);
  }
  .fs-rank {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fde725;
    color: #0b0d10;
    font-size: 11px;
    font-weight: 700;
  }
  .fs-place-text {
    flex: 1;
    display: grid;
  }
  .fs-place-text strong {
    color: var(--text-1);
    font-weight: 600;
    font-size: var(--fs-xs);
  }
  .fs-place-text small {
    color: var(--text-3);
  }
  .fs-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-3);
    font-size: 11px;
  }
  .fs-ramp {
    display: flex;
  }
  .fs-ramp i {
    width: 14px;
    height: 8px;
  }
  .fs-earlier {
    display: grid;
    gap: 4px;
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .fs-earlier-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fs-link {
    flex: 1;
    display: grid;
    padding: 4px 6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .fs-link:hover {
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .fs-link small {
    color: var(--text-3);
  }
</style>
