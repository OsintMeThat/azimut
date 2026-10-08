<script>
  /**
   * How the view is drawn, on the view itself: the ground (shaded relief,
   * satellite imagery, or plain), and the ridge lines over it. With satellite
   * imagery, which release of it.
   *
   * The lines are their own switch because Phase 5 lays them alone over a
   * photo; plain ground has nothing else to show, so picking it turns them on.
   *
   * With satellite imagery, Sentinel-2 can be laid on the ground near the eye,
   * from the analyst's Copernicus quota, Esri beyond: what that costs is said
   * beside the switch before anything is asked. Without a Copernicus key the
   * switch stays, locked, and says how to get one.
   */
  import Icon from '../../components/Icon.svelte';
  import { DRAPE_PROVIDER, NEAR_REACHES, waybackSource } from './state/horizon.svelte.js';

  let {
    /** The tab's view state (state/horizon.svelte.js). */
    view,
    /** Whether a Copernicus key is set, so Sentinel-2 can be laid near. */
    copernicus = false,
    /** Asked to show how to set Copernicus up. */
    onsetup = () => {},
    /** The box these controls cover, reported out so summit names keep clear of it. */
    width = $bindable(0),
    height = $bindable(0),
  } = $props();

  const GROUNDS = [
    { id: 'relief', label: 'Relief', title: 'The ground shaded by its slope' },
    { id: 'imagery', label: 'Satellite', title: 'The ground in Esri satellite imagery' },
    { id: 'plain', label: 'Plain', title: 'Dark ground, for the ridge lines alone' },
  ];

  // what Sentinel-2 near would cost, worked out (for free) whenever the eye or the ground changes
  $effect(() => {
    void view.placed;
    if (copernicus && view.ground === 'imagery' && view.placed) view.askEstimate();
  });

  const cost = $derived.by(() => {
    const estimate = view.nearEstimate;
    if (!estimate) return '';
    if (!estimate.requests) return view.nearOn ? 'Laid from tiles on disk' : 'Already on disk: no request';
    const what = `${estimate.requests} Sentinel Hub ${estimate.requests === 1 ? 'request' : 'requests'}`;
    return view.nearOn ? `${what} to lay` : `About ${what}`;
  });

  async function pickImagery(event) {
    const value = event.currentTarget.value;
    if (value === 'older') {
      event.currentTarget.value = view.drapeSource;
      await view.loadReleases();
      return;
    }
    view.setDrapeSource(value);
  }
</script>

<div class="picture hz-control" bind:clientWidth={width} bind:clientHeight={height}>
  <div class="row">
    <div class="seg" role="group" aria-label="Ground drawn as">
      {#each GROUNDS as ground (ground.id)}
        <button
          type="button"
          class:on={view.ground === ground.id}
          aria-pressed={view.ground === ground.id}
          title={ground.title}
          onclick={() => view.setGround(ground.id)}>{ground.label}</button
        >
      {/each}
    </div>
    <!-- a switch, not a fourth ground: it says so with its own box and tick -->
    <button
      type="button"
      class="toggle"
      class:on={view.lines}
      aria-pressed={view.lines}
      title="Outline every ridge, coloured by distance"
      onclick={() => view.setLines(!view.lines)}
    >
      <span class="box" aria-hidden="true">
        {#if view.lines}<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.2 4 7.6 8.6 2.4" /></svg>{/if}
      </span>Ridge lines
    </button>
  </div>
  {#if view.ground === 'imagery'}
    <div class="row">
      <select
        class="release"
        value={view.drapeSource}
        onchange={pickImagery}
        aria-label="Which imagery"
        title="The latest imagery, or a dated release from Esri's archive"
      >
        <option value={DRAPE_PROVIDER}>Latest imagery</option>
        {#each view.releases as release (release.release)}
          <option value={waybackSource(release.release)}>{release.date}</option>
        {/each}
        {#if !view.releases.length}
          <option value="older">{view.releasesBusy ? 'Reading the archive…' : 'Older releases…'}</option>
        {/if}
      </select>
    </div>
    <div class="row">
      {#if copernicus}
        <button
          type="button"
          class="toggle"
          class:on={view.nearOn}
          aria-pressed={view.nearOn}
          title="Sentinel-2 on the ground nearer than this, from your Copernicus quota; Esri beyond"
          onclick={() => view.setNear(!view.nearOn)}
        >
          <span class="box" aria-hidden="true">
            {#if view.nearOn}<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.2 4 7.6 8.6 2.4" /></svg>{/if}
          </span>Sentinel-2 nearer than
        </button>
        <select
          class="release"
          value={view.nearReach}
          onchange={(event) => view.setNearReach(Number(event.currentTarget.value))}
          aria-label="How far Sentinel-2 is laid"
        >
          {#each NEAR_REACHES as metres (metres)}
            <option value={metres}>{metres / 1000} km</option>
          {/each}
        </select>
      {:else}
        <button type="button" class="toggle locked" onclick={onsetup} title="Needs a free Copernicus key: see how">
          <Icon name="lock" size={12} />Sentinel-2 near the eye
        </button>
      {/if}
    </div>
    {#if copernicus && (cost || view.nearOn)}
      <div class="row">
        {#if view.nearOn && view.nearPasses.length}
          <select
            class="release"
            value={view.nearDate}
            onchange={(event) => view.setNearDate(event.currentTarget.value)}
            aria-label="Which Sentinel-2 pass"
            title="The newest pass under 30% cloud, or another one"
          >
            {#each view.nearPasses as pass (pass.date)}
              <option value={pass.date}>{pass.date}{Number.isFinite(pass.cloud) ? ` · ${Math.round(pass.cloud)}% cloud` : ''}</option>
            {/each}
          </select>
        {/if}
        {#if cost}<span class="cost">{cost}</span>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .picture {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .seg,
  .toggle,
  .release {
    height: 28px;
    border-radius: var(--r-md);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    font-size: var(--fs-xs);
  }
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
  }
  .seg button,
  .toggle {
    padding: 0 10px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border-radius: var(--r-md);
  }
  .box {
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .box svg {
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .toggle.on .box {
    background: var(--accent);
    box-shadow: none;
  }
  .seg button:hover,
  .toggle:hover {
    color: var(--text-1);
  }
  .seg button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
  /* on, the switch keeps its glass and only its box and words turn amber,
     so it never reads as a fourth ground pressed beside the first three */
  .toggle.on {
    color: var(--accent);
  }
  .seg button:focus-visible,
  .toggle:focus-visible,
  .release:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .toggle.locked {
    color: var(--text-3);
    gap: 6px;
  }
  .cost {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--r-md);
    background: var(--hz-glass);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .release {
    max-width: 180px;
    padding: 0 8px;
    border: none;
    color: var(--text-1);
    cursor: pointer;
  }
</style>
