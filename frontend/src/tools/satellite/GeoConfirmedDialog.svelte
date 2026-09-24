<script>
  /**
   * One GeoConfirmed conflict, over a window of days and optionally the view,
   * added as a layer.
   *
   * Opening this is the act that asks GeoConfirmed anything: the conflict list is
   * read now, through the backend, and not when the add dialog before it opened.
   * The layer itself is fetched by the backend on Add (`engine/geoconfirmed.py`),
   * in GeoConfirmed's own icons, which arrive inside the export.
   */
  import { onMount } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import DayPicker from '../../components/DayPicker.svelte';
  import {
    ALL,
    DEFAULT_CONFLICT,
    DEFAULT_SPAN,
    RANGE,
    WINDOWS,
    areaOf,
    layerRequest,
  } from '../../lib/map/geoconfirmed.js';

  let {
    busy = false,
    /** `() => Promise<conflict[]>`, the list GeoConfirmed publishes. */
    load,
    /** `() => bounds | null`, the map's view at the moment of asking. */
    view,
    onclose,
    onadd,
  } = $props();

  let conflicts = $state([]);
  let reading = $state(true);
  let failed = $state('');

  let conflict = $state('');
  let span = $state(DEFAULT_SPAN);
  let start = $state('');
  let end = $state('');
  let limited = $state(false);

  const today = new Date().toISOString().slice(0, 10);
  const chosen = $derived(conflicts.find((entry) => entry.conflict === conflict));

  async function fetchList() {
    reading = true;
    failed = '';
    try {
      const list = await load();
      conflicts = Array.isArray(list) ? list : [];
      const preferred = conflicts.find((entry) => entry.conflict === DEFAULT_CONFLICT);
      if (!conflicts.some((entry) => entry.conflict === conflict)) {
        conflict = (preferred ?? conflicts[0])?.conflict ?? '';
      }
    } catch (error) {
      failed = error?.message || 'GeoConfirmed could not be reached.';
    } finally {
      reading = false;
    }
  }

  onMount(fetchList);

  const viewable = $derived(limited ? areaOf(view?.()) !== null : true);

  function submit() {
    const body = layerRequest({
      conflict,
      span,
      start,
      end,
      limited,
      bounds: limited ? view?.() : null,
    });
    if (body) onadd?.(body);
  }

  const ready = $derived(
    Boolean(conflict) && (span !== RANGE || Boolean(start)) && viewable && !busy
  );
</script>

<Modal title="GeoConfirmed" {onclose} width="460px">
  <p class="lead">
    Events GeoConfirmed's volunteers geolocated, each with its sources, drawn here
    and kept out of the case graph.
  </p>

  {#if reading}
    <p class="note">Reading GeoConfirmed's conflicts…</p>
  {:else if failed}
    <p class="note error">{failed}</p>
    <button class="btn" onclick={fetchList}>Try again</button>
  {:else}
    <section>
      <h4>Conflict</h4>
      <select class="input" bind:value={conflict} aria-label="Conflict">
        {#each conflicts as entry (entry.conflict)}
          <option value={entry.conflict}>{entry.name}</option>
        {/each}
      </select>
    </section>

    <section>
      <h4>Dates</h4>
      <div class="chips">
        {#each WINDOWS as entry (entry.span)}
          <button
            type="button"
            class="chip"
            class:on={span === entry.span}
            aria-pressed={span === entry.span}
            onclick={() => (span = entry.span)}
          >{entry.label}</button>
        {/each}
        <button
          type="button"
          class="chip"
          class:on={span === RANGE}
          aria-pressed={span === RANGE}
          onclick={() => (span = RANGE)}
        >Dates…</button>
      </div>
      {#if span === RANGE}
        <div class="range">
          <div class="date">
            <span>From</span>
            <DayPicker
              value={start}
              min={chosen?.start || ''}
              max={end || today}
              label="First day"
              placeholder="Pick a day"
              onpick={(day) => (start = day)}
            />
          </div>
          <div class="date">
            <span>To</span>
            <DayPicker
              value={end}
              min={start}
              max={today}
              label="Last day; blank reads up to the day of each refresh"
              placeholder="Today"
              clearable
              onpick={(day) => (end = day)}
            />
          </div>
        </div>
      {/if}
    </section>

    <section>
      <label class="tick">
        <input type="checkbox" bind:checked={limited} />
        <span>Only the area in view</span>
      </label>
      {#if limited && !viewable}
        <p class="note error">This view crosses the antimeridian; zoom in first.</p>
      {/if}
    </section>

    <button class="btn btn-primary" disabled={!ready} onclick={submit}>
      {busy ? 'Reading…' : 'Add'}
    </button>
    <p class="note">
      {span === ALL
        ? 'Read from geoconfirmed.org now and when you press Refresh.'
        : 'Read from geoconfirmed.org now, when you press Refresh, and the first time you switch it on after opening Azimut.'}
      Undated sites start hidden.
    </p>
  {/if}
</Modal>

<style>
  .lead {
    margin: 0 0 14px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  section {
    margin-bottom: 12px;
  }
  h4 {
    margin: 0 0 8px;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .input {
    width: 100%;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .range {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .date {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .date > span {
    flex: none;
    width: 36px;
    padding-top: 6px;
  }
  .tick {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .note {
    margin: 8px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .note.error {
    color: var(--warn, #ffcc66);
  }
</style>
