<script>
  /**
   * What a plate goes out as: one page (a PNG or a PDF of the paper size), or the
   * page through its days (a GIF, an MP4, or a sheet of them side by side), which
   * is offered once the plate draws a layer followed over time.
   */
  import Modal from '../../components/Modal.svelte';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import { QUALITIES, WIDTHS } from '../../lib/plate/exportPlate.js';

  let {
    /** The moments the plate's tracked layers change at, sorted; empty when it has none. */
    moments = [],
    /** `({ format, quality, width, days, interval })`, resolving when the file is written. */
    onexport,
    /** What the export is doing now, said under its buttons. */
    progress = '',
    onclose,
  } = $props();

  const FORMATS = [
    ['png', 'PNG', 'One picture of the page.'],
    ['pdf', 'PDF', 'The page at its paper size, to print.'],
    ['mp4', 'MP4', 'The page through its days, a video.'],
    ['gif', 'GIF', 'The same, as a looping picture.'],
    ['sheet', 'Evolution sheet', 'Its days side by side, on one picture.'],
  ];
  let format = $state('png');
  let quality = $state('print');
  let width = $state(1920);
  let interval = $state(900);
  let first = $state('');
  let last = $state('');
  let busy = $state(false);
  $effect(() => { if (!first && moments.length) { first = moments[0]; last = moments.at(-1); } });
  const played = $derived(['mp4', 'gif', 'sheet'].includes(format));
  const days = $derived(moments.filter((moment) => (!first || moment >= first) && (!last || moment <= last)));
  const ready = $derived(!played || days.length >= 2);

  async function run() {
    busy = true;
    try {
      await onexport({ format, quality, width, days: played ? days : null, interval });
      onclose();
    } catch {
      // the tool said what went wrong; the dialog stays for another try
    } finally { busy = false; }
  }
</script>

<Modal title="Export the plate" onclose={() => { if (!busy) onclose(); }} width="420px">
  <div class="formats" role="radiogroup" aria-label="Format">
    {#each FORMATS as [id, name, detail] (id)}
      {@const off = id !== 'png' && id !== 'pdf' && moments.length < 2}
      <label class:off class:on={format === id}>
        <input type="radio" bind:group={format} value={id} disabled={off} />
        <strong>{name}</strong><span>{off ? 'Needs a layer followed over time on the plate.' : detail}</span>
      </label>
    {/each}
  </div>

  {#if format === 'png' || format === 'pdf'}
    <div class="row">
      <span>Resolution</span>
      <div class="segments" role="group" aria-label="Resolution">
        {#each Object.entries(QUALITIES) as [id, entry] (id)}
          <button type="button" aria-pressed={quality === id} onclick={() => (quality = id)}>{entry.label} · {entry.dpi} dpi</button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="row">
      <span>Days</span>
      <span class="days">
        <select aria-label="First day" value={first} onchange={(event) => (first = event.currentTarget.value)}>
          {#each moments as moment (moment)}<option value={moment}>{momentLabel(moment)}</option>{/each}</select>
        to
        <select aria-label="Last day" value={last} onchange={(event) => (last = event.currentTarget.value)}>
          {#each moments as moment (moment)}<option value={moment}>{momentLabel(moment)}</option>{/each}</select>
      </span>
    </div>
    <p class="note">{days.length} {days.length === 1 ? 'change' : 'changes'}, one picture each{days.length > 120 ? '; at most 120 go in' : ''}.</p>
    {#if format !== 'sheet'}
      <div class="row">
        <span>Width</span>
        <div class="segments" role="group" aria-label="Width">
          {#each WIDTHS as value (value)}<button type="button" aria-pressed={width === value} onclick={() => (width = value)}>{value} px</button>{/each}
        </div>
      </div>
      <div class="row">
        <span>Each day</span>
        <label class="interval"><input type="range" min="300" max="3000" step="100" bind:value={interval} /> {(interval / 1000).toFixed(1)} s</label>
      </div>
    {/if}
  {/if}

  <p class="note">Written to the folder saved for views, like the analysis plates.</p>
  {#if progress}<p class="progress" role="status">{progress}</p>{/if}
  <div class="acts">
    <button class="btn" disabled={busy} onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !ready} onclick={run}>{busy ? 'Exporting…' : 'Export'}</button>
  </div>
</Modal>

<style>
  .formats { display: grid; gap: 5px; margin-bottom: 12px; }
  .formats label { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 2px 8px; padding: 7px 9px;
    border: 1px solid var(--border); border-radius: var(--r-sm); cursor: pointer; }
  .formats label.on { border-color: var(--accent); background: var(--accent-soft); }
  .formats label.off { opacity: .55; cursor: default; }
  .formats input { grid-row: span 2; }
  .formats strong { font-size: var(--fs-sm); }
  .formats span { color: var(--text-3); font-size: 11px; }
  .row { display: grid; grid-template-columns: 80px 1fr; align-items: center; gap: 8px; margin: 8px 0; font-size: var(--fs-xs); }
  .row > span:first-child { color: var(--text-3); }
  .days { display: flex; align-items: center; gap: 6px; }
  .days select { flex: 1; min-width: 0; height: 26px; font-size: var(--fs-xs); }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
  .segments button { flex: 1; padding: 5px 4px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .interval { display: flex; align-items: center; gap: 8px; }
  .interval input { flex: 1; }
  .note { margin: 6px 0; color: var(--text-3); font-size: 11px; }
  .progress { margin: 6px 0; color: var(--accent); font-size: 11px; }
  .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
