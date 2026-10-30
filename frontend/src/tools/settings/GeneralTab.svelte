<script>
  /**
   * How every tool prints a coordinate, a distance and an area, plus where the
   * maps open, how much the 3D views draw on this computer, what saving a proof
   * does with its point, and how Reverse Search reaches an engine.
   *
   * Preferences save on change and the server answers with the canonical value,
   * so nothing here keeps a draft the rest of the app cannot see.
   */
  import { formatDistance, formatArea } from '../../lib/measure.js';
  import { QUALITIES_3D, qualityOf } from '../../lib/quality3d.js';

  let {
    prefs,
    home,
    coordSample,
    savePrefs,
    saveHome,
    proofPlaceAuto = $bindable(),
    reversePrefill = $bindable(),
    mapSync = $bindable(),
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

<section class="group" data-guide="settings.coordinates">
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

<section class="group" data-guide="settings.units">
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

<section class="group" data-guide="settings.home-view">
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

<section class="group" data-guide="settings.map-tabs">
  <h3>Map tabs</h3>
  <div class="row">
    <div class="row-label">
      <span>Share one view</span>
      <span class="row-hint">
        Satellite, Compare, Detect and Horizon show the same place. Horizon's eye
        moves only when you place it, and a Detect review stays where it is.
      </span>
    </div>
    <input
      type="checkbox"
      bind:checked={mapSync}
      onchange={() => savePrefs({ map_sync: mapSync })}
      aria-label="Share one view across the map tabs"
    />
  </div>
</section>

<section class="group" data-guide="settings.quality-3d">
  <h3>3D views</h3>
  <div class="row">
    <div class="row-label">
      <span title="How much the 3D globe and Horizon draw on this computer; the globe takes it the next time 3D opens">Quality</span>
      <span class="row-hint">For a slow computer. Captures and plates stay at full quality.</span>
    </div>
    <div class="seg" role="group" aria-label="3D quality">
      {#each QUALITIES_3D as q (q.id)}
        <button
          class="seg-btn"
          class:on={qualityOf(prefs.quality3d) === q.id}
          title={q.title}
          onclick={() => savePrefs({ quality_3d: q.id })}
        >{q.label}</button>
      {/each}
    </div>
  </div>
</section>

<section class="group" data-guide="settings.proofs">
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

<section class="group" data-guide="settings.reverse">
  <h3>Reverse search</h3>
  <div class="row">
    <div class="row-label">
      <span>Let the extension open the engine with the image</span>
      <span class="row-hint">
        The engine gets the picture instead of you pasting or dragging it, so it
        searches straight away. Needs the capture extension; without it, the
        buttons copy or save the image as usual.
      </span>
    </div>
    <input
      type="checkbox"
      bind:checked={reversePrefill}
      onchange={() => savePrefs({ reverse_prefill: reversePrefill })}
      aria-label="Let the extension open the engine with the image"
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
