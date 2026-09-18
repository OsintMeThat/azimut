<script>
  /**
   * Which picture this surface is showing, in the surface's own corner.
   *
   * It used to be a native `<select>` in a bar at the foot of the tool, beside
   * Save place and Capture — which put a property of the image in the same box
   * as the acts that file things, and made the provider look like the tool's
   * rather than this map's. It is the surface's: two surfaces compared side by
   * side (SPEC v3) each show their own provider, and a chip in a shared bar
   * could not say which was which.
   *
   * The eco and usage pills ride with it for the same reason. They describe the
   * pixels being drawn here, and they are only ever true of one surface.
   */
  import Icon from '../../components/Icon.svelte';
  import SentinelPicker from './SentinelPicker.svelte';
  import WaybackPicker from './WaybackPicker.svelte';
  import { WAYBACK_ID } from '../../lib/wayback.js';
  import {
    SENTINEL_ID,
    cloudClass,
    cloudLabel,
    maxccLabel,
    monthGrid,
    monthLabel,
  } from '../../lib/sentinel.js';

  let {
    /** The shared catalogue and meter (state/imagery.svelte.js). */
    imagery,
    /** What this surface was asked to show. Changed from here. */
    providerId = $bindable(),
    /** This surface's Sentinel-2 choices, when that basemap is on it. */
    s2 = null,
    /** This surface's Wayback release, when that basemap is on it. */
    wayback = null,
    /** What it is actually showing — a billed base steps aside when paused. */
    shown,
    /** Open the Sentinel-2 picker from a dated chip, as Wayback's already is.
     *  Compare asks for it: its card has a layers button of its own. */
    dateChip = false,
  } = $props();

  let menuOpen = $state(false);
  let menuEl = $state();
  let s2MenuEl = $state();
  let wbMenuEl = $state();

  const asked = $derived(imagery.find(providerId));
  const isSentinel = $derived(asked?.id === SENTINEL_ID);
  const isWayback = $derived(asked?.id === WAYBACK_ID);
  const usagePill = $derived(imagery.pill(asked));

  function pick(provider) {
    if (provider.needs_key) return;
    providerId = provider.id;
    menuOpen = false;
  }

  // clicking outside either popover closes it
  $effect(() => {
    if (!menuOpen) return;
    const outside = (e) => {
      if (menuEl && !menuEl.contains(e.target)) menuOpen = false;
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });

  $effect(() => {
    if (!s2?.menuOpen) return;
    const outside = (e) => {
      if (s2MenuEl && !s2MenuEl.contains(e.target)) s2.menuOpen = false;
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });

  $effect(() => {
    if (!wayback?.menuOpen) return;
    const outside = (e) => {
      if (wbMenuEl && !wbMenuEl.contains(e.target)) wayback.menuOpen = false;
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });
</script>

<div class="chip-row">
  {#if usagePill}
    <span class="pill mono" title="Requests to this billed provider this month">{usagePill}</span>
  {/if}
  {#if shown.fallenBack}
    <span
      class="pill fallback"
      class:paused={shown.blocked}
      title={shown.blocked
        ? `${asked?.label} passed 90% of its monthly free tier. Free imagery is shown instead. Override in Settings to keep using it (billed).`
        : `Eco mode shows free imagery at low zoom. Zoom in for ${asked?.label} detail. Toggle in Settings.`}
    >
      <Icon name={shown.blocked ? 'alert' : 'leaf'} size={11} />
      {shown.blocked ? 'paused · free imagery' : 'eco · free imagery'}
    </span>
  {/if}
  {#if isSentinel && s2}
    <SentinelPicker
      bind:menuEl={s2MenuEl}
      {s2}
      {dateChip}
      {maxccLabel}
      {monthLabel}
      {monthGrid}
      {cloudClass}
      {cloudLabel}
    />
  {/if}
  {#if isWayback && wayback}
    <WaybackPicker bind:menuEl={wbMenuEl} wb={wayback} />
  {/if}
  <div class="chip-wrap" bind:this={menuEl}>
    <button
      class="chip"
      class:on={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
      title="Imagery provider"
      aria-label="Imagery provider"
      aria-haspopup="listbox"
      aria-expanded={menuOpen}
    >
      <Icon name="satellite" size={13} />
      <span class="name">{asked?.label ?? '—'}</span>
      <Icon name="more" size={12} />
    </button>
    {#if menuOpen}
      <ul class="menu card" role="listbox" aria-label="Imagery provider">
        {#each imagery.providers as provider (provider.id)}
          <li>
            <button
              role="option"
              aria-selected={provider.id === providerId}
              class="row"
              class:on={provider.id === providerId}
              disabled={provider.needs_key}
              onclick={() => pick(provider)}
              title={provider.needs_key ? 'Add this provider’s API key in Settings' : undefined}
            >
              <span class="tick">
                {#if provider.id === providerId}<Icon name="check" size={12} />{/if}
              </span>
              <!-- not `label`: that class is the app's form-label voice, in
                   small caps and letterspaced, and it turned every basemap name
                   into a heading three lines tall -->
              <span class="name">{provider.label}</span>
              {#if provider.needs_key}<span class="need">needs key</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .chip-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip-wrap {
    position: relative;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }
  .chip:hover,
  .chip.on {
    color: var(--accent);
  }
  .chip .name {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    /* the same layer as the date pickers beside it: lower, and Compare's
       annotation rail drew straight over the open list */
    z-index: 700;
    /* wide enough for the longest basemap name on one line: the list is read
       by shape as much as by word, and a wrapped row breaks the column */
    min-width: 244px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    margin: 0;
    list-style: none;
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: var(--radius-1);
    font-size: var(--fs-sm);
    color: var(--text-2);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .row:hover:not(:disabled) {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .row.on {
    color: var(--accent);
  }
  .row:disabled {
    color: var(--text-3);
    cursor: not-allowed;
  }
  /* one column, so the names line up whether or not a row is the live one */
  .tick {
    display: grid;
    place-items: center;
    width: 13px;
  }
  .row .name {
    flex: 1;
  }
  .need {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: 10px;
    color: var(--text-3);
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--r-sm, 4px);
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  .pill.fallback {
    color: var(--ok);
  }
  .pill.paused {
    color: var(--warn);
  }
</style>
