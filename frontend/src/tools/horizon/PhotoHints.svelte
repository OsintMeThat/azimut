<script>
  /**
   * What the analyst knows about the photo, told to Fit: what kind of picture
   * it is when it may be a panorama, how zoomed it looks, roughly which way it
   * faces and how far it sees. Each line is optional and
   * starts at "don't know"; the zoom words may be ticked several at once when
   * unsure, none ticked being any lens. Each narrows the search the way a human would
   * (lib/horizon/hints.js holds the words and what they stand for).
   */
  import {
    ANY_WITHIN,
    AUTO_REACH,
    cleanZoom,
    FACING_HALF,
    PANORAMA_WITHIN,
    panoramaLikely,
    PICTURES,
    REACHES,
    reachText,
    toggleZoom,
    ZOOMS,
    zoomWithin,
  } from '../../lib/horizon/hints.js';
  import { headingText } from '../../lib/horizon/geometry.js';

  let {
    /** The overlay (state/overlay.svelte.js): its hints, and the reach the last Fit found. */
    overlay,
    /** Where the view looks now, which "roughly this way" takes. */
    heading = 0,
    /** Whether "which way it faces" is asked: not where no view looks yet. */
    facing = true,
    /** Whether these are Find's hints, which read a stitched collage frame by frame. */
    find = false,
  } = $props();
  const framed = $derived(overlay.framesRead ?? null);

  const hints = $derived(overlay.hints);
  const lens = $derived(overlay.lens);
  const panorama = $derived(hints.picture === 'panorama');
  /** A moment of the video as a clock: "0:12". */
  const clockOf = (seconds) => `${Math.floor((seconds ?? 0) / 60)}:${String(Math.floor((seconds ?? 0) % 60)).padStart(2, '0')}`;
  const ticked = $derived(cleanZoom(hints.zoom));
  // in degrees across this picture: a portrait frame sees a phone's zoom across its short side
  const lenses = $derived(zoomWithin(ticked, overlay.aspect));
</script>

<div class="hints">
  {#if overlay.panoramaOffered}
    <div class="row">
      <span class="name" id="hz-hint-picture">Picture</span>
      <div class="pills" role="radiogroup" aria-labelledby="hz-hint-picture">
        {#each PICTURES as picture (picture.id)}
          <button
            type="button"
            role="radio"
            class:on={hints.picture === picture.id}
            aria-checked={hints.picture === picture.id}
            title={picture.title}
            onclick={() => overlay.setHints({ picture: picture.id })}>{picture.label}</button
          >
        {/each}
      </div>
      {#if panorama && overlay.stitched}
        <p class="said">Stitched by Azimut from {overlay.stitched.collage}.</p>
      {:else if !panorama && panoramaLikely({ kind: overlay.source?.kind, aspect: overlay.aspect })}
        <p class="said">A phone’s panorama reads better as Panorama.</p>
      {/if}
    </div>
  {/if}

  <div class="row" data-guide={find ? 'find.zoom' : undefined}>
    <span class="name" id="hz-hint-zoom">{panorama ? 'Width' : 'Zoom'}</span>
    {#if framed && find}
      <p class="said">Find reads {framed.collage} frame by frame: {framed.frames} frames, {Math.round(framed.lens)}° across each, as the stitch says.</p>
    {:else if panorama}
      <p class="said">
        {#if lens}{Math.round(lens.fov)}° across: Fit keeps it.{:else}Fit tries {PANORAMA_WITHIN[0]}° to {PANORAMA_WITHIN[1]}° across.{/if}
      </p>
    {:else if lens?.measured}
      <p class="said">Measured on the video at {clockOf(lens.at)}: {Math.round(lens.fov)}° across. Fit keeps it, Find allows 5% either way.</p>
      <div class="acts">
        <button type="button" class="small" onclick={() => overlay.measureLens()}>Measure again here</button>
        <button type="button" class="small" onclick={() => overlay.forgetLens()}>Forget</button>
      </div>
    {:else if lens}
      <p class="said">The photo says {Math.round(lens.mm)} mm, {Math.round(lens.fov)}° across: Fit keeps it.</p>

    {:else}
      <div class="pills" role="group" aria-labelledby="hz-hint-zoom">
        {#each ZOOMS as word (word.id)}
          <button
            type="button"
            class:on={ticked.includes(word.id)}
            aria-pressed={ticked.includes(word.id)}
            title={word.title}
            onclick={() => overlay.setHints({ zoom: toggleZoom(ticked, word.id) })}>{word.label}</button
          >
        {/each}
      </div>
      <p class="said">
        {#if ticked.length}Fit tries {Math.round(lenses[0])}° to {Math.round(lenses[1])}° across.{:else}Any lens, {ANY_WITHIN[0]}° to {ANY_WITHIN[1]}°: tick one or several.{/if}
      </p>
      {#if overlay.source?.kind === 'video'}
        <div class="acts">
          <button
            type="button"
            class="small"
            disabled={overlay.measuring?.busy}
            title="Read the lens off the frames around this moment, where the camera pans"
            onclick={() => overlay.measureLens()}>{overlay.measuring?.busy ? 'Measuring…' : 'Measure from the video'}</button
          >
        </div>
        {#if overlay.measuring?.error}<p class="said bad">{overlay.measuring.error}</p>{/if}
      {/if}
    {/if}
  </div>

  {#if facing}
  <div class="row">
    <span class="name" id="hz-hint-facing">Facing</span>
    <div class="pills" role="radiogroup" aria-labelledby="hz-hint-facing">
      <button
        type="button"
        role="radio"
        class:on={!hints.facing}
        aria-checked={!hints.facing}
        title="Search the whole turn"
        onclick={() => overlay.setHints({ facing: null })}>Anywhere</button
      >
      <button
        type="button"
        role="radio"
        class:on={Boolean(hints.facing)}
        aria-checked={Boolean(hints.facing)}
        title="Search {FACING_HALF}° either side of where the view looks now"
        onclick={() => overlay.setHints({ facing: { heading } })}>Roughly this way</button
      >
    </div>
    {#if hints.facing}
      <p class="said">{headingText(hints.facing.heading, 60)}, give or take {FACING_HALF}°</p>
    {/if}
  </div>
  {/if}

  <div class="row">
    <span class="name" id="hz-hint-reach">Sees as far as</span>
    <div class="pills" role="radiogroup" aria-labelledby="hz-hint-reach">
      <button
        type="button"
        role="radio"
        class:on={hints.reach === 'auto'}
        aria-checked={hints.reach === 'auto'}
        title="Fit tries each distance up to {reachText(AUTO_REACH)} and keeps the one that matches"
        onclick={() => overlay.setHints({ reach: 'auto' })}>Auto</button
      >
      {#each REACHES as reach (reach)}
        <button
          type="button"
          role="radio"
          class:on={hints.reach === reach}
          aria-checked={hints.reach === reach}
          title="Ridges past {reachText(reach)} are hidden, as by haze"
          onclick={() => overlay.setHints({ reach })}>{reachText(reach)}</button
        >
      {/each}
      <button
        type="button"
        role="radio"
        class:on={hints.reach === 'all'}
        aria-checked={hints.reach === 'all'}
        title="Every ridge the terrain holds, however far"
        onclick={() => overlay.setHints({ reach: 'all' })}>Clear air</button
      >
    </div>
    {#if hints.reach === 'auto' && Number.isFinite(overlay.reachFound)}
      <p class="said">Fit found the skyline within {reachText(overlay.reachFound)}.</p>
    {/if}
  </div>

</div>

<style>
  /* wide enough for the seven distances on one line */
  .hints {
    display: grid;
    gap: 12px;
    width: 410px;
  }
  .row {
    display: grid;
    gap: 6px;
  }
  .name {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--text-1) 5%, transparent);
  }
  .pills button {
    height: 24px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .pills button:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
  .pills button.on {
    color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .pills button:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .said {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .said.bad {
    color: var(--danger);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .small {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .small:hover:not(:disabled) {
    color: var(--text-1);
  }
  .small:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
