<script>
  /**
   * What a plate goes out as: one page (a PNG at a print resolution or a width in
   * pixels, see-through when asked, a PDF of the paper size, or the picture copied),
   * or the page through its days (a GIF, an MP4, or a sheet of them side by side),
   * which is offered once the plate draws a layer followed over time or holds
   * steps. Each day is followed by its steps, and an MP4 runs their clips. A
   * preview of the page and the file's name come first, so nothing goes out unseen.
   */
  import { timecode } from '../../lib/plate/clip.js';
  import Modal from '../../components/Modal.svelte';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import { QUALITIES, WIDTHS } from '../../lib/plate/exportPlate.js';

  let {
    /** The moments the plate's tracked layers change at, sorted; empty when it has none. */
    moments = [],
    /** The plate holds steps, so it plays even on one day. */
    stepped = false,
    /** `(days, interval)`: how long the played plate runs, in seconds. */
    runtime = null,
    /** `({ format, quality, width, days, interval, filename, pixels, transparent })`, resolving when the file is written. */
    onexport,
    /** The picture of the page copied to the clipboard. */
    oncopy = null,
    /** What the export is doing now, said under its buttons. */
    progress = '',
    /** The file's name, before it is changed here. */
    name = 'Map plate',
    /** A small picture of the page, once drawn. */
    preview = '',
    /** The paper is see-through in a PNG, as the page asks. */
    transparent = false,
    onclose,
  } = $props();

  const FORMATS = [
    ['png', 'PNG', 'One picture of the page.'],
    ['pdf', 'PDF', 'The page at its paper size, to print.'],
    ['mp4', 'MP4', 'The page through its days, a video.'],
    ['gif', 'GIF', 'The same, as a looping picture.'],
    ['sheet', 'Evolution sheet', 'Its days side by side, on one picture.'],
  ];
  /** Widths a PNG is often asked at, for a post rather than a print. */
  const PIXELS = [[0, 'By resolution'], [1080, '1080 px'], [1600, '1600 px'], [2048, '2048 px'], [3840, '3840 px']];
  let format = $state('png');
  let quality = $state('print');
  let pixels = $state(0);
  let see = $state(false);
  let width = $state(1920);
  let interval = $state(900);
  let first = $state('');
  let last = $state('');
  let busy = $state(false);
  let filename = $state('');
  let copied = $state('');
  $effect(() => { if (!filename) filename = name; });
  $effect(() => { see = transparent; });
  $effect(() => { if (!first && moments.length) { first = moments[0]; last = moments.at(-1); } });
  const played = $derived(['mp4', 'gif', 'sheet'].includes(format));
  const days = $derived(moments.filter((moment) => (!first || moment >= first) && (!last || moment <= last)));
  /** A played plate goes through two days at least, or through its steps. */
  const playsOn = (id) => (id === 'sheet' ? moments.length >= 2 : moments.length >= 2 || stepped);
  const ready = $derived((!played || (format === 'sheet' ? days.length >= 2 : days.length >= 2 || stepped)) && filename.trim().length > 0);
  const seconds = $derived(played && format !== 'sheet' && runtime ? runtime(days, interval) : 0);

  async function run() {
    busy = true;
    try {
      await onexport({ format, quality, width, days: played ? days : null, interval, filename: filename.trim(),
        pixels: format === 'png' ? pixels : 0, transparent: format === 'png' && see });
      onclose();
    } catch {
      // the tool said what went wrong; the dialog stays for another try
    } finally { busy = false; }
  }
  async function copy() {
    busy = true;
    try { await oncopy?.(); copied = 'Copied'; } catch { copied = ''; } finally { busy = false; }
  }
</script>

<Modal title="Export the plate" onclose={() => { if (!busy) onclose(); }} width="460px">
  <div class="head">
    {#if preview}<img class="preview" src={preview} alt="The page as it will be exported" />{:else}<span class="preview blank">Drawing…</span>{/if}
    <label class="name">File name<input class="input" aria-label="File name" maxlength="120" bind:value={filename} /></label>
  </div>
  <div class="formats" role="radiogroup" aria-label="Format">
    {#each FORMATS as [id, label, detail] (id)}
      {@const off = id !== 'png' && id !== 'pdf' && !playsOn(id)}
      <label class:off class:on={format === id}>
        <input type="radio" bind:group={format} value={id} disabled={off} />
        <strong>{label}</strong><span>{off ? (id === 'sheet' ? 'Needs a layer followed over time on the plate.' : 'Needs a layer followed over time, or steps.') : detail}</span>
      </label>
    {/each}
  </div>

  {#if format === 'png' || format === 'pdf'}
    {#if format === 'png'}
      <div class="row">
        <span>Size</span>
        <select aria-label="Picture width" value={String(pixels)} onchange={(event) => (pixels = Number(event.currentTarget.value))}>
          {#each PIXELS as [value, label] (value)}<option value={String(value)}>{label}</option>{/each}</select>
      </div>
    {/if}
    {#if format === 'pdf' || !pixels}
      <div class="row">
        <span>Resolution</span>
        <div class="segments" role="group" aria-label="Resolution">
          {#each Object.entries(QUALITIES) as [id, entry] (id)}
            <button type="button" aria-pressed={quality === id} onclick={() => (quality = id)}>{entry.label} · {entry.dpi} dpi</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if format === 'png'}
      <label class="check"><input type="checkbox" bind:checked={see} /> See-through paper</label>
    {/if}
  {:else}
    {#if moments.length >= 2}
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
      <p class="note">{days.length} {days.length === 1 ? 'change' : 'changes'}, one picture each{days.length > 120 ? '; at most 120 go in' : ''}{stepped && format !== 'sheet' ? ', each followed by its steps' : ''}. The legend lists what any of them draws, so it stays still.</p>
    {:else}
      <p class="note">The page, then each of its steps.</p>
    {/if}
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
      {#if stepped && seconds}
        <p class="note">Runs {timecode(seconds)}{format === 'gif' ? '; a GIF shows each clip by its first frame' : seconds > 300 ? '; a long video takes a while to make' : ''}.</p>
      {/if}
    {/if}
  {/if}

  <p class="note">Written to the folder saved for views, like the analysis plates.</p>
  {#if progress}<p class="progress" role="status">{progress}</p>{/if}
  <div class="acts">
    {#if oncopy && format === 'png'}<button class="btn" disabled={busy} onclick={copy}>{copied || 'Copy image'}</button>{/if}
    <span class="grow"></span>
    <button class="btn" disabled={busy} onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !ready} onclick={run}>{busy ? 'Exporting…' : 'Export'}</button>
  </div>
</Modal>

<style>
  .head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
  .preview { flex: none; width: 140px; max-height: 120px; object-fit: contain; border: 1px solid var(--border); border-radius: var(--r-sm); background: #fff; }
  .preview.blank { display: grid; place-items: center; height: 90px; color: var(--text-3); font-size: 11px; background: var(--bg-2); }
  .name { display: grid; gap: 4px; flex: 1; color: var(--text-3); font-size: var(--fs-xs); }
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
  .row select { height: 26px; font-size: var(--fs-xs); }
  .check { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: var(--fs-xs); cursor: pointer; }
  .days { display: flex; align-items: center; gap: 6px; }
  .days select { flex: 1; min-width: 0; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
  .segments button { flex: 1; padding: 5px 4px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .interval { display: flex; align-items: center; gap: 8px; }
  .interval input { flex: 1; }
  .note { margin: 6px 0; color: var(--text-3); font-size: 11px; }
  .progress { margin: 6px 0; color: var(--accent); font-size: 11px; }
  .acts { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .grow { flex: 1; }
</style>
