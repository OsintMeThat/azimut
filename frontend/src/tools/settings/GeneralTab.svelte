<script>
  /**
   * How every tool prints a coordinate, a distance and an area, plus the map's
   * opening position and what saving a proof does with its point.
   *
   * Preferences save on change and the server answers with the canonical value,
   * so nothing here keeps a draft the rest of the app cannot see.
   */
  import { formatDistance, formatArea } from '../../lib/measure.js';

  let {
    prefs,
    home,
    coordSample,
    savePrefs,
    saveHome,
    proofPlaceAuto = $bindable(),
  } = $props();

  const COORD_CHOICES = [
    { id: 'dd', label: 'Decimal' },
    { id: 'dms', label: 'DMS' },
    { id: 'mgrs', label: 'MGRS' },
  ];
  const UNIT_CHOICES = [
    { id: 'metric', label: 'Metric' },
    { id: 'imperial', label: 'Imperial' },
  ];
</script>

<section class="group">
  <h3>Coordinates</h3>
  <div class="row">
    <div class="row-label">
      <span>Format</span>
      <span class="row-hint">How every tool prints a latitude/longitude.</span>
    </div>
    <div class="seg" role="group" aria-label="Coordinate format">
      {#each COORD_CHOICES as c (c.id)}
        <button
          class="seg-btn"
          class:on={prefs.coordFormat === c.id}
          onclick={() => savePrefs({ coord_format: c.id })}
        >{c.label}</button>
      {/each}
    </div>
  </div>
  <p class="sample mono">{coordSample}</p>
  <p class="note">
    Changes display only; case data stays in decimal degrees.
  </p>
</section>

<section class="group">
  <h3>Measurements</h3>
  <div class="row">
    <div class="row-label">
      <span>Units</span>
      <span class="row-hint">The Satellite ruler, area and readouts.</span>
    </div>
    <div class="seg" role="group" aria-label="Units">
      {#each UNIT_CHOICES as c (c.id)}
        <button
          class="seg-btn"
          class:on={prefs.units === c.id}
          onclick={() => savePrefs({ units: c.id })}
        >{c.label}</button>
      {/each}
    </div>
  </div>
  <p class="sample mono">
    {formatDistance(1234, prefs.units)} · {formatArea(52000, prefs.units)}
  </p>
</section>

<section class="group">
  <h3>Satellite home view</h3>
  <p class="intro">
    Default opening position for Satellite; case navigation still takes priority.
  </p>
  <div class="grid-3">
    <label class="field">
      <span>Latitude</span>
      <input class="input mono" bind:value={home.lat} onchange={saveHome} inputmode="decimal" spellcheck="false" />
    </label>
    <label class="field">
      <span>Longitude</span>
      <input class="input mono" bind:value={home.lon} onchange={saveHome} inputmode="decimal" spellcheck="false" />
    </label>
    <label class="field">
      <span>Zoom</span>
      <input class="input mono" bind:value={home.zoom} onchange={saveHome} type="number" min="1" max="21" />
    </label>
  </div>
</section>

<section class="group">
  <h3>Proofs</h3>
  <p class="intro">
    Saving a proof turns the coordinates it carries into a place on the map, and
    says the proof shows it.
  </p>
  <div class="row">
    <div class="row-label">
      <span>Save the point without asking</span>
      <span class="row-hint">
        Off, the composer asks each time. A point already saved is never asked about.
      </span>
    </div>
    <input
      type="checkbox"
      bind:checked={proofPlaceAuto}
      onchange={() => savePrefs({ proof_place_auto: proofPlaceAuto })}
      aria-label="Save a proof's point without asking"
    />
  </div>
</section>

<style>
  .sample {
    color: var(--text-2);
    font-size: var(--fs-sm);
    padding: 6px 9px;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    border: 1px solid var(--border);
    display: inline-block;
    margin-top: 4px;
  }


  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 90px;
    gap: 10px;
  }
</style>
