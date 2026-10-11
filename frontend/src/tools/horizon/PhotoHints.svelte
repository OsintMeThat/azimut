<script>
  /**
   * What the analyst knows about the photo, told to Fit: how zoomed it looks,
   * roughly which way it faces, how far it sees, and the points recognised in
   * it, each a point marked on the map pinned where it shows in the photo.
   * Each line is optional and starts at "don't know"; each narrows the search
   * the way a human would (lib/horizon/hints.js holds the words and what they
   * stand for).
   */
  import { AUTO_REACH, FACING_HALF, REACHES, reachText, ZOOMS } from '../../lib/horizon/hints.js';
  import { headingText } from '../../lib/horizon/geometry.js';
  import { ANCHORS_MAX } from './state/overlay.svelte.js';
  import { fmtCoords } from '../../lib/state.svelte.js';

  let {
    /** The overlay (state/overlay.svelte.js): its hints, and the reach the last Fit found. */
    overlay,
    /** Where the view looks now, which "roughly this way" takes. */
    heading = 0,
    /** The point marked on the map (`{ lat, lon }`), which can be pinned on the photo, or null. */
    marked = null,
    /** Asked to pin the marked point where it shows in the photo. */
    onpin = () => {},
  } = $props();

  const hints = $derived(overlay.hints);
  const lens = $derived(overlay.lens);
  const anchors = $derived(overlay.anchors ?? []);
  const isPhoto = $derived(overlay.source?.kind === 'image');
  const full = $derived(anchors.length >= ANCHORS_MAX && !anchors.some((a) => a.lat === marked?.lat && a.lon === marked?.lon));
</script>

<div class="hints">
  <div class="row">
    <span class="name" id="hz-hint-zoom">Zoom</span>
    {#if lens}
      <p class="said">The photo says {Math.round(lens.mm)} mm, {Math.round(lens.fov)}° across: Fit keeps it.</p>
    {:else}
      <div class="pills" role="radiogroup" aria-labelledby="hz-hint-zoom">
        {#each ZOOMS as zoom (zoom.id)}
          <button
            type="button"
            role="radio"
            class:on={hints.zoom === zoom.id}
            aria-checked={hints.zoom === zoom.id}
            title={zoom.title}
            onclick={() => overlay.setHints({ zoom: zoom.id })}>{zoom.label}</button
          >
        {/each}
      </div>
    {/if}
  </div>

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

  {#if isPhoto}
    <div class="row">
      <span class="name">Points you recognise</span>
      {#if anchors.length}
        <ol class="pinned">
          {#each anchors as anchor, index (index)}
            <li>
              <span class="number mono">{index + 1}</span>
              <span class="mono">{fmtCoords(anchor.lat, anchor.lon)}</span>
              <button type="button" class="unpin" title="Unpin it" aria-label="Unpin point {index + 1}" onclick={() => overlay.removeAnchor(index)}
                >×</button
              >
            </li>
          {/each}
        </ol>
      {/if}
      <div>
        <button
          type="button"
          class="btn btn-sm"
          disabled={!marked || full}
          title={full ? `${ANCHORS_MAX} points at most` : marked ? 'Then click where it shows in the photo' : 'Mark it on the map first'}
          onclick={onpin}>Pin the marked point on the photo</button
        >
      </div>
      <p class="said">
        {marked ? 'A summit, a mast, a building: click where it shows in the photo.' : 'Click it on the map first: a summit, a mast, a building.'}
      </p>
    </div>
  {/if}
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
  .pinned {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-xs);
  }
  .pinned li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-1);
  }
  .number {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--hz-mark);
    color: #14181d;
    font-size: 10px;
    font-weight: 700;
  }
  .unpin {
    margin-left: auto;
    padding: 0 6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-3);
    font: inherit;
    cursor: pointer;
  }
  .unpin:hover {
    color: var(--text-1);
    background: color-mix(in srgb, var(--text-1) 7%, transparent);
  }
</style>
