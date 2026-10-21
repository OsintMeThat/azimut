<script>
  /**
   * Find's side, in two faces.
   *
   * **Prepare** numbers only the three steps a search cannot run without: the
   * skyline traced on the photo, the area drawn on the map, the search. Each
   * says where it stands in a line, and its number lights once it is done.
   * What narrows the search but is not needed (the alignments, what is known
   * about the photo and who took it) folds under Help the search, each part
   * saying its gist on its title line; the warnings about the lens and the
   * reach stay by the Search button. What is rarely changed folds under More
   * settings.
   *
   * **Result** is the search on show: when it was made and what it was asked
   * with, how far it has gone, then its verdict, how far its best place can be
   * trusted and why (lib/horizon/find.js `reliability`), and its places. Change and
   * search again goes back to Prepare, the setup still the search's. The
   * case's earlier searches are opened from the header's Open menu.
   */
  import Icon from '../../components/Icon.svelte';
  import PhotoHints from './PhotoHints.svelte';
  import {
    ALIGN_TOLERANCES,
    areaPoints,
    areaText,
    DIRECTIONS,
    facingText,
    groundText,
    GROUNDS,
    HEAT_RAMP,
    SUN_SIDES,
    reliability,
    searchedReach,
    searchedWhen,
    TRUST,
    standsText,
    UNCLEAR_HELP,
    VERDICTS,
    withGround,
  } from '../../lib/horizon/find.js';
  import { AUTO_REACH, cleanZoom, reachText, zoomText } from '../../lib/horizon/hints.js';
  import { headingText } from '../../lib/horizon/geometry.js';
  import { estimateText, SPACINGS, SPEEDS, VIEWS, WHO } from './state/find.svelte.js';
  import { farLabel } from '../../lib/horizon/traceMarks.js';
  import { marksSummary } from '../../lib/horizon/traceTools.js';
  import { reliefWords } from '../../lib/horizon/overlay.js';
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
    /** The place the map lights, by its index in the results, or -1. */
    lit = $bindable(-1),
  } = $props();

  let more = $state(false);
  let starting = $state(false);
  /** The parts of Help the search unfolded; an alignment being made unfolds its own. */
  const help = $state({ align: false, know: false });
  $effect(() => {
    if (find.pending) help.align = true;
  });

  // how large the search would be, asked again a moment after what it depends on changes
  let estimateTimer = null;
  $effect(() => {
    void [find.area, find.zones, find.settings, find.who, find.facing, find.stands, find.view, find.mirror, find.alignments.length, overlay.strokes, overlay.marks, overlay.hints, overlay.lens];
    clearTimeout(estimateTimer);
    estimateTimer = setTimeout(() => find.estimate(), 500);
    return () => clearTimeout(estimateTimer);
  });

  // how fine the heights are where the area lies, read once it is closed
  $effect(() => {
    void [find.area, find.drawing];
    find.readDetail();
  });

  // the headings the compass and the sun leave, read again a moment after either or the area changes
  let sectorsTimer = null;
  $effect(() => {
    void [find.area, find.drawing, find.facing, find.sun];
    clearTimeout(sectorsTimer);
    sectorsTimer = setTimeout(() => find.readSectors?.(), 500);
    return () => clearTimeout(sectorsTimer);
  });

  /** What the sun said, in a line: the headings it leaves, or why it says nothing. */
  const sunSaid = $derived.by(() => {
    const read = find.sectors;
    if (!find.sun?.sides?.length) return 'Tick where the sun stood against the camera, with the day.';
    if (!find.sun.date) return 'Give the day the photo was taken.';
    if (!read) return '';
    if (read.sun && !read.sun.up) return 'The sun was down then: it says nothing.';
    if (Array.isArray(read.sectors) && !read.sectors.length) return 'No heading agrees with both the sun and the directions ticked.';
    const width = (read.sectors ?? []).reduce((sum, [, half]) => sum + 2 * half, 0);
    return `Sun at ${Math.round(read.sun?.from ?? 0)}° to ${Math.round(read.sun?.to ?? 0)}° then: ${Math.round(width)}° of headings left, drawn on the map.`;
  });

  // the grid and the ground under it, read again a moment after the area, who or the ground ticked change
  let previewTimer = null;
  $effect(() => {
    void [find.area, find.zones, find.drawing, find.who, find.settings, find.stands, find.alignments.length, overlay.marks];
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => find.preview?.(), 600);
    return () => clearTimeout(previewTimer);
  });

  const search = $derived(find.search);
  const result = $derived(search?.status === 'done' ? search.result : null);
  const progress = $derived(search?.progress?.total ? Math.round((100 * search.progress.done) / search.progress.total) : 0);

  /** Back on Prepare while a search is on show; a search started or opened shows its Result. */
  let preparing = $state(false);
  let shownName = null;
  $effect(() => {
    const name = search?.name ?? null;
    if (name === shownName) return;
    shownName = name;
    preparing = false;
  });
  const resultFace = $derived(Boolean(search) && !preparing);

  /** What a search runs with, in a line: the lens, which way it faces, how far it reads, who took the photo. */
  function toldOf({ hints = {}, lens = null, panorama = false, who = 'ground', facing = [], stands = [], marks = null, looking = [], mirror = false, framed = null, sun = null }) {
    const zoom = cleanZoom(hints.zoom);
    const anyLens = !framed && !lens && !panorama && !zoom.length;
    const lensWords = framed
      ? `${framed.frames} frames of ${Math.round(framed.lens)}°`
      : lens
        ? `a ${Math.round(lens.fov)}° lens`
        : panorama
          ? 'a panorama'
          : anyLens
            ? 'any lens'
            : `zoom ${zoomText(zoom)}`;
    const way = facingText(facing);
    // a reach given is searched about that far: on to twice it, so the warning names the farther one
    const near = Number.isFinite(hints.reach) && searchedReach(hints.reach, AUTO_REACH) <= 10_000 ? searchedReach(hints.reach, AUTO_REACH) : null;
    // every line of the skyline said how far: the turn is read as far as they say, whatever the reach
    const said = marks?.far ?? [];
    const sky = [...new Set(marks?.lines ?? [])].filter((id) => !(marks?.inner ?? []).includes(id));
    const allSaid = said.length > 0 && sky.every((id) => said.some((one) => one.line === id));
    const span = said.length ? farLabel(said.flatMap((one) => one.bands)) : '';
    const reachWords = allSaid
      ? `lines ${span} away`
      : Number.isFinite(hints.reach)
        ? `ridges within about ${reachText(hints.reach)}`
        : hints.reach === 'all'
          ? 'every ridge'
          : `ridges within ${reachText(AUTO_REACH)}`;
    const ground = standsText(stands);
    const parts = [
      lensWords,
      ...(way ? [`facing ${way}`] : []),
      ...(sun?.date && sun?.sides?.length ? [`sun ${sun.sides.join(' or ')} on ${sun.date}`] : []),
      reachWords,
      (WHO[who] ?? WHO.ground).label.toLowerCase(),
      ...(ground ? [`on a ${ground}`] : []),
      ...VIEWS.filter((v) => looking.includes(v.id)).map((v) => v.label.toLowerCase()),
      ...(mirror ? ['mirrored too'] : []),
    ];
    return { line: parts.join(' · '), anyLens, near: allSaid ? null : near };
  }

  /** What the search will run with, said before it runs. */
  const told = $derived(
    toldOf({
      hints: overlay.hints ?? {},
      lens: overlay.lens,
      panorama: overlay.isPanorama,
      who: find.who.mode,
      facing: find.facing,
      stands: find.stands,
      marks: overlay.marks,
      looking: find.view ?? [],
      mirror: find.mirror,
      framed: overlay.framesRead ?? null,
      sun: find.sun,
    })
  );

  /** What the search on show was asked with, and when. */
  const asked = $derived.by(() => {
    const ask = search?.ask;
    if (!ask) return '';
    const area = areaText(areaPoints(ask.area));
    const aligned = ask.alignments?.length ? `${ask.alignments.length} ${ask.alignments.length === 1 ? 'alignment' : 'alignments'}` : '';
    const line = toldOf({ hints: ask.hints ?? {}, panorama: ask.hints?.picture === 'panorama', who: ask.who?.mode, facing: ask.facing ?? [], stands: ask.stands ?? [], marks: ask.photo?.marks ?? null, looking: ask.view ?? [], mirror: Boolean(ask.mirror), sun: ask.sun ?? null }).line;
    return [area, line, aligned].filter(Boolean).join(' · ');
  });

  /** How far the best place can be trusted, and what lowers it. */
  const trust = $derived(result ? reliability(result, { ask: search.ask, name: search.name, others: find.list }) : null);

  /** The compass as it is laid out: north at the top, any way in the middle. */
  const COMPASS = ['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'].map((id) => (id ? DIRECTIONS.find((d) => d.id === id) : null));

  /** The gist of each part of Help the search, said on its title line. */
  const alignGist = $derived(
    find.alignments.length
      ? `${find.alignments.length} ${find.alignments.length === 1 ? 'alignment' : 'alignments'}${find.meeting ? `, meeting within ${formatDistance(find.meeting.spread, units)}` : ''}`
      : 'None'
  );
  const knowGist = $derived(told.line[0].toUpperCase() + told.line.slice(1));

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
  const tracedText = $derived.by(() => {
    const marked = marksSummary(overlay.marks);
    return `${traced} ${traced === 1 ? 'line' : 'lines'} traced${marked ? `: ${marked}` : ''}`;
  });
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
  {#if resultFace}
    <section class="fs-result" aria-label="The search on show">
      <button type="button" class="fs-back" onclick={() => (preparing = true)} title="Back to the setup, still this search's">
        <Icon name="chevronLeft" size={13} />Prepare
      </button>
      <h3 class="fs-title">{search.title || 'Search'}</h3>
      <p class="fs-say quiet">{[searchedWhen(search.created_at), asked].filter(Boolean).join(' · ')}</p>
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
        {#if trust && result.places?.length}
          <div class="fs-trust {trust.level}">
            <p class="fs-say"><span class="fs-trust-word">{TRUST[trust.level]}</span>{trust.reasons.length ? '' : ': nothing speaks against the best place'}</p>
            {#if trust.reasons.length}
              <ul class="fs-reasons">
                {#each trust.reasons as reason (reason)}<li>{reason}</li>{/each}
              </ul>
            {/if}
            {#if trust.chance != null}
              <p class="fs-say quiet">Chance fits in this area reach about {Math.round(trust.chance * 100)}%.</p>
            {/if}
            {#if result.checked}
              <p class="fs-say quiet">Decoys of the trace explain at most {Math.round(Math.max(0, result.places[0]?.decoy ?? 0) * 100)}% at the best place.</p>
            {:else}
              <div class="fs-acts">
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={find.checking}
                  title="Try the places again with the trace mirrored and upside down: a real place explains its own trace far better"
                  onclick={() => find.check()}>{find.checking ? 'Checking…' : 'Check against decoys'}</button
                >
              </div>
            {/if}
          </div>
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
                    >{place.mirrored ? 'mirrored · ' : ''}{place.heading != null ? `facing ${headingText(place.heading, place.fov ?? 60)} · ` : ''}{place.fov != null
                      ? `${place.fov < 10 ? place.fov.toFixed(1) : Math.round(place.fov)}° lens · `
                      : ''}{Number.isFinite(place.reach) ? `ridges within ${reachText(place.reach)}` : ''}</small
                  >
                  {#if place.inner != null || place.pairs}
                    <small
                      >{place.inner != null ? `ridges in front ${Math.round(Math.max(0, place.inner) * 100)}% on the terrain` : ''}{place.inner !=
                        null && place.pairs
                        ? ' · '
                        : ''}{place.pairs ? `${place.pairs[0]} of ${place.pairs[1]} ${place.pairs[1] === 1 ? 'pair' : 'pairs'} in order` : ''}</small
                    >
                  {/if}
                  <small
                    >{place.lat.toFixed(4)}, {place.lon.toFixed(4)}{Number.isFinite(place.decoy) ? ` · decoys ${Math.round(place.decoy * 100)}%` : ''}{trust?.chance !=
                    null
                      ? ` · chance ${Math.round(trust.chance * 100)}%`
                      : ''}</small
                  >
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
      {:else if search.status === 'failed'}
        <p class="fs-say bad">{search.error || 'The search failed'}</p>
      {:else if search.status === 'cancelled'}
        <p class="fs-say">Stopped.</p>
      {/if}
      {#if !find.searching}
        <div class="fs-acts">
          <button type="button" class="btn btn-sm btn-primary" onclick={() => (preparing = true)}>Change and search again</button>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.closeSearch()}>Clear the results</button>
        </div>
      {/if}
    </section>
  {:else}
    <ol class="fs-steps">
      <li class="fs-step" class:done={traced > 0}>
        <h3><span class="fs-num">1</span>Skyline</h3>
        {#if !overlay.source}
          <p class="fs-say">Add the photo first.</p>
        {:else if traced}
          <p class="fs-say">{tracedText}. Rub out clouds, trees and buildings.</p>
          {#if !overlay.marks?.inner?.length}
            <p class="fs-say quiet">A ridge seen in front of farther land, not the sky? Draw it with the Ridge pen.</p>
          {/if}
        {:else}
          <p class="fs-say">Trace the skyline on the photo, or press Detect.</p>
        {/if}
        {#if overlay.source && find.detail}
          <p class="fs-say quiet">{reliefWords(find.detail)}</p>
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
        {:else if find.drawing === 'zone'}
          <p class="fs-say">
            {find.zoneDrawn?.out ? 'Click each corner of the zone to leave out.' : 'Click each corner of the zone to search more finely.'} Press the first one,
            or Enter, to close it.
          </p>
          <div class="fs-acts">
            <button type="button" class="btn btn-sm btn-primary" disabled={(find.zoneDrawn?.points.length ?? 0) < 3} onclick={() => find.closeArea()}
              >Done</button
            >
            <button type="button" class="btn btn-sm" onclick={() => find.zoneDrawn && find.removeZone(find.zoneDrawn.id)}>Cancel</button>
          </div>
        {:else if find.area.length >= 3}
          <p class="fs-say">{areaText(find.area)}</p>
          {#if find.areaProblem}<p class="fs-say bad">{find.areaProblem}</p>{/if}
          {#each find.zones ?? [] as zone, index (zone.id)}
            <div class="fs-zone" class:out={zone.out}>
              <span class="fs-zone-what">{zone.out ? 'Left out' : 'Finer'} · {areaText(zone.points)}</span>
              {#if !zone.out}
                <div class="fs-pills" role="group" aria-label="Grid of zone {index + 1}">
                  {#each SPACINGS as spacing (spacing)}
                    <button
                      type="button"
                      class:on={zone.spacing === spacing}
                      aria-pressed={zone.spacing === spacing}
                      title={spacing === 'auto' ? 'A third of the area’s grid' : `A point every ${spacing} m`}
                      onclick={() => find.setZoneSpacing(zone.id, spacing)}>{spacing === 'auto' ? 'Auto' : formatDistance(spacing, units)}</button
                    >
                  {/each}
                </div>
              {/if}
              {#if find.zoneProblem(zone)}<p class="fs-say bad">{find.zoneProblem(zone)}</p>{/if}
              <button type="button" class="fs-x" onclick={() => find.removeZone(zone.id)} title="Take this zone away" aria-label="Take zone {index + 1} away"
                ><Icon name="x" size={12} /></button
              >
            </div>
          {/each}
          <div class="fs-acts">
            <button type="button" class="btn btn-sm" onclick={() => find.drawArea()}>Draw again</button>
            <button type="button" class="btn btn-sm" onclick={() => find.drawZone({ out: false })} title="A zone searched on a finer grid of its own"
              ><Icon name="plus" size={13} />Finer zone</button
            >
            <button type="button" class="btn btn-sm" onclick={() => find.drawZone({ out: true })} title="A zone never searched: a lake, a place checked already"
              ><Icon name="minus" size={13} />Leave out</button
            >
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.clearArea()}>Clear</button>
          </div>
        {:else}
          <p class="fs-say">Where the photo may have been taken.</p>
          <div class="fs-acts">
            <button type="button" class="btn btn-sm btn-primary" onclick={() => find.drawArea()}><Icon name="polygon" size={13} />Draw the area</button>
          </div>
        {/if}
      </li>

      <li class="fs-step" class:done={Boolean(result)}>
        <h3><span class="fs-num">3</span>Search</h3>
        {#if find.searching}
          <p class="fs-say">A search is running.</p>
        {:else if find.searchProblem}
          <p class="fs-say">{find.searchProblem}.</p>
        {:else}
          <p class="fs-say">With {told.line}.</p>
          {#if find.estimated}
            <p class="fs-say">{estimateText(withGround(find.estimated, find.previewed))}</p>
          {/if}
        {/if}
        {#if told.near}
          <p class="fs-say warn">Ridges past {reachText(told.near)} are left out: a far skyline cannot be found.</p>
        {/if}
        {#if told.anyLens}
          <p class="fs-say warn">Any lens finds more chance fits: say the zoom if you can.</p>
        {/if}
        <div class="fs-acts">
          <button type="button" class="btn btn-sm btn-primary" disabled={Boolean(find.searchProblem) || starting || find.searching} onclick={start}
            ><Icon name="search" size={13} />Search</button
          >
          <button
            type="button"
            class="btn btn-sm"
            class:on={find.drawing === 'try'}
            aria-pressed={find.drawing === 'try'}
            disabled={Boolean(find.tryProblem)}
            title={find.tryProblem || 'Click a place on the map: the trace is tried from there, in a second or two'}
            onclick={() => (find.drawing === 'try' ? find.stopTrying() : find.startTrying())}><Icon name="crosshair" size={13} />Try a point</button
          >
          {#if search}
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => (preparing = false)}>Back to the result</button>
          {/if}
        </div>
      </li>
    </ol>

    {#if find.drawing === 'try' || find.tried}
      <section class="fs-tried" aria-label="The point tried">
        {#if find.drawing === 'try' && !find.tried}
          <p class="fs-say">Click a place on the map to try the trace from there. Esc to stop.</p>
        {:else if find.tried?.busy}
          <p class="fs-say" role="status">Reading the terrain from there…</p>
        {:else if find.tried?.error}
          <p class="fs-say bad">{find.tried.error}</p>
        {:else if find.tried?.place}
          {@const place = find.tried.place}
          <p class="fs-say strong">Tried here: explains {Math.round(Math.max(0, place.explained) * 100)}%</p>
          <p class="fs-say quiet">
            {place.mirrored ? 'mirrored · ' : ''}{place.heading != null ? `facing ${headingText(place.heading, place.fov ?? 60)} · ` : ''}{place.fov != null
              ? `${place.fov < 10 ? place.fov.toFixed(1) : Math.round(place.fov)}° lens · `
              : ''}{Number.isFinite(place.relief) ? `ridges about ${formatDistance(place.relief, units)} out · ` : ''}{place.lat.toFixed(4)}, {place.lon.toFixed(4)}
          </p>
          <div class="fs-acts">
            {#if place.heading != null}
              <button type="button" class="btn btn-sm" onclick={() => onplace({ ...place, frames: find.tried.frames })}>Look from here</button>
            {/if}
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => find.clearTried()}>Clear</button>
          </div>
          {#if find.drawing === 'try'}<p class="fs-say quiet">Click another place to try it too.</p>{/if}
        {/if}
      </section>
    {/if}

    <section class="fs-help" aria-label="Help the search">
      <h4 class="fs-help-head">Help the search <span class="fs-optional">optional</span></h4>
      <details class="fs-part" bind:open={help.align}>
        <summary>
          <span class="fs-part-title">Alignments</span>
          <span class="fs-gist">{alignGist}</span>
          <Icon name="chevronDown" size={13} />
        </summary>
        <div class="fs-part-body">
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
        </div>
      </details>

      <details class="fs-part" bind:open={help.know}>
        <summary>
          <span class="fs-part-title">What you know</span>
          <span class="fs-gist">{knowGist}</span>
          <Icon name="chevronDown" size={13} />
        </summary>
        <div class="fs-part-body">
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
          <div class="fs-row fs-facing-row">
            <span class="fs-name" id="find-facing">Facing</span>
            <div class="fs-facing">
              <div class="fs-compass" role="group" aria-labelledby="find-facing">
                {#each COMPASS as one, index (one?.id ?? `any-${index}`)}
                  {#if one}
                    <button
                      type="button"
                      class:on={find.facing.includes(one.id)}
                      aria-pressed={find.facing.includes(one.id)}
                      title="The photo faces about {one.heading}°, give or take 22.5°"
                      onclick={() => find.toggleFacing(one.id)}>{one.label}</button
                    >
                  {:else}
                    <button
                      type="button"
                      class="any"
                      class:on={!find.facing.length}
                      aria-pressed={!find.facing.length}
                      title="Search every heading"
                      onclick={() => find.clearFacing()}>Any</button
                    >
                  {/if}
                {/each}
              </div>
              <p class="fs-say quiet">
                {#if find.facing.length}Only headings {facingText(find.facing)} are searched, drawn on the map.{:else}Tick one or several if you know roughly.{/if}
              </p>
            </div>
          </div>
          <div class="fs-row fs-facing-row">
            <span class="fs-name" id="find-sun">Sun</span>
            <div class="fs-facing">
              <div class="fs-pills" role="group" aria-labelledby="find-sun">
                {#each SUN_SIDES as side (side.id)}
                  <button
                    type="button"
                    class:on={find.sun?.sides?.includes(side.id)}
                    aria-pressed={find.sun?.sides?.includes(side.id)}
                    title={side.title}
                    onclick={() => find.toggleSunSide(side.id)}>{side.label}</button
                  >
                {/each}
              </div>
              <div class="fs-sun-when">
                <input type="date" value={find.sun?.date ?? ''} aria-label="The day the photo was taken" onchange={(event) => find.setSun({ date: event.currentTarget.value })} />
                <input type="time" value={find.sun?.start ?? '06:00'} aria-label="From, local time there" onchange={(event) => find.setSun({ start: event.currentTarget.value })} />
                <span>to</span>
                <input type="time" value={find.sun?.end ?? '18:00'} aria-label="To, local time there" onchange={(event) => find.setSun({ end: event.currentTarget.value })} />
              </div>
              <p class="fs-say quiet" class:bad={sunSaid.startsWith('No heading')}>{sunSaid}</p>
            </div>
          </div>
          <div class="fs-row fs-facing-row">
            <span class="fs-name" id="find-stands">Eye on</span>
            <div class="fs-facing">
              <div class="fs-pills" role="group" aria-labelledby="find-stands">
                {#each GROUNDS as ground (ground.id)}
                  <button
                    type="button"
                    class:on={find.stands.includes(ground.id)}
                    aria-pressed={find.stands.includes(ground.id)}
                    title={ground.title}
                    onclick={() => find.toggleStand(ground.id)}><i class="fs-ground" style:background={ground.colour}></i>{ground.label}</button
                  >
                {/each}
              </div>
              <p class="fs-say quiet">
                {#if groundText(find.previewed, find.stands)}{groundText(find.previewed, find.stands)}{:else if find.stands.length}Read off the terrain once the area is drawn.{:else}Any ground: tick one or several if you know.{/if}
              </p>
            </div>
          </div>
          <div class="fs-row">
            <span class="fs-name" id="find-view">Camera</span>
            <div class="fs-pills" role="group" aria-labelledby="find-view">
              {#each VIEWS as one (one.id)}
                <button
                  type="button"
                  class:on={find.view?.includes(one.id)}
                  aria-pressed={find.view?.includes(one.id)}
                  title={one.title}
                  onclick={() => find.toggleView(one.id)}>{one.label}</button
                >
              {/each}
              <button
                type="button"
                class:on={find.mirror}
                aria-pressed={find.mirror}
                title="A selfie may be mirrored: the trace is searched as shot and mirrored, which takes twice as long"
                onclick={() => find.setMirror(!find.mirror)}>Selfie</button
              >
            </div>
          </div>
          {#if overlay.source}
            <PhotoHints {overlay} facing={false} find />
          {/if}
        </div>
      </details>
    </section>

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
          <span class="fs-name" id="find-speed">Speed</span>
          <div class="fs-pills" role="radiogroup" aria-labelledby="find-speed">
            {#each SPEEDS as one (one.id)}
              <button
                type="button"
                role="radio"
                class:on={(find.settings.speed ?? 'fast') === one.id}
                aria-checked={(find.settings.speed ?? 'fast') === one.id}
                title={one.title}
                onclick={() => find.setSettings({ speed: one.id })}>{one.label}</button
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
  {/if}
</div>

<style>
  /* no line inside may widen the column: a long gist ends in an ellipsis instead */
  .fs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
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
  /* the search on show */
  .fs-result {
    display: grid;
    gap: 8px;
  }
  .fs-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: start;
    padding: 2px 6px 2px 2px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .fs-back:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .fs-title {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  /* what narrows the search without being needed: each part folded, its gist on its title line */
  .fs-help {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .fs-help-head {
    margin: 0 0 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .fs-help-head .fs-optional {
    letter-spacing: 0;
    text-transform: none;
  }
  .fs-part summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    list-style: none;
    cursor: pointer;
  }
  .fs-part summary::-webkit-details-marker {
    display: none;
  }
  .fs-part summary:hover {
    background: color-mix(in srgb, var(--text-1) 5%, transparent);
  }
  .fs-part summary :global(svg) {
    flex: none;
    transform: rotate(-90deg);
    transition: transform 0.15s;
  }
  .fs-part[open] summary :global(svg) {
    transform: none;
  }
  .fs-part-title {
    flex: none;
    color: var(--text-1);
    font-weight: 600;
  }
  .fs-gist {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-xs);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fs-part-body {
    display: grid;
    gap: 7px;
    padding: 4px 4px 12px;
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
  .fs-part-body :global(.hints) {
    width: auto;
  }
  .fs-facing-row {
    align-items: start;
  }
  .fs-facing {
    display: grid;
    gap: 6px;
  }
  .fs-ground {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 5px;
    border-radius: 50%;
    vertical-align: 0;
  }
  .fs-compass {
    display: grid;
    grid-template-columns: repeat(3, 40px);
    gap: 3px;
  }
  .fs-compass button {
    height: 24px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .fs-compass button.any {
    color: var(--text-3);
  }
  .fs-compass button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .fs-compass button:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .fs-zone {
    position: relative;
    display: grid;
    gap: 5px;
    padding: 6px 26px 6px 8px;
    border-left: 3px solid #4dd6ff;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--text-1) 4%, transparent);
  }
  .fs-zone.out {
    border-left-color: #ff6b6b;
  }
  .fs-zone-what {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .fs-zone .fs-x {
    position: absolute;
    top: 4px;
    right: 4px;
  }
  .fs-sun-when {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .fs-sun-when input {
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .fs-tried {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-left: 3px solid #ff7ad9;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--text-1) 4%, transparent);
  }
  .fs-trust {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    border-left: 3px solid var(--border);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--text-1) 4%, transparent);
  }
  .fs-trust.solid {
    border-left-color: var(--ok);
  }
  .fs-trust.check {
    border-left-color: var(--warning, #e0a63a);
  }
  .fs-trust.weak {
    border-left-color: var(--danger);
  }
  .fs-trust-word {
    color: var(--text-1);
    font-weight: 600;
  }
  .fs-reasons {
    margin: 0;
    padding-left: 16px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.45;
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
</style>
