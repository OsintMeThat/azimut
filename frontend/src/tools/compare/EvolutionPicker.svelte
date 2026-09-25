<script>
  /**
   * Which pictures an evolution plays, chosen by hand in the export dialog, each
   * row with its picture of the export's ground.
   *
   * Wayback lists the whole history of the crosshair at once, as the pictures
   * strip reads it, in the order the pictures were taken, and opens on A to B.
   * Sentinel-2 passes every few days since mid-2015, far more than one list
   * holds, so it is read a month at a time: the picker opens on A's month and
   * B's with both passes ticked, and the analyst pages or jumps to any month
   * back to 2015 to tick more. Ticks are kept across months.
   *
   * What is read is what the analyst opened: the Wayback walk is free, and each
   * Sentinel-2 month is one Copernicus request, as in the Sentinel-2 day picker.
   * A picture is a tile or two through the proxy, cached once read.
   */
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import Icon from '../../components/Icon.svelte';
  import { addMonths, isoDay, monthBounds, monthLabel, monthOf } from '../../lib/sentinel.js';
  import { THUMB, lookupPath, stripEntries, thumbTiles } from '../../lib/map/passStrip.js';
  import {
    MAX_EVOLUTION_FRAMES,
    SENTINEL2_FIRST_MONTH,
    allKeys,
    chosenEntries,
    defaultKeys,
    pickerMonth,
    pictureLabel,
    playOrder,
    rangeKeys,
    sideEntry,
    thinKeys,
  } from '../../lib/map/evolution.js';

  let {
    /** 'sentinel2' | 'esri-wayback' */
    archive,
    /** Both sides as a saved comparison keeps them, with the day each shows. */
    a,
    b,
    view,
    maxcc = 100,
    /** Tiles one picture takes at the export's frame, for the price. */
    perPicture = 0,
    /** The provider the pictures are drawn from, and the id each row's is asked as. */
    provider = null,
    variantFor = () => '',
    /** The ground a row's picture shows: `{ lat, lon, zoom, viewWidth }`. */
    thumbView = null,
    disabled = false,
    onchoose = () => {},
    onbilled = () => {},
  } = $props();

  const monthly = $derived(archive === 'sentinel2');
  const today = monthOf(isoDay(new Date()));

  // What each read answered: the whole history under 'all', or one answer per month.
  let answers = $state({});
  let readAt = $state(null);
  let busy = $state(false);
  let note = $state('');
  let picked = $state([]);
  let month = $state(today);
  let monthInput = $state(today);
  // The rows whose picture has arrived; the others shimmer until it does.
  let ready = $state({});

  const entries = $derived(monthly
    ? stripEntries(archive, { dates: Object.values(answers).flatMap((answer) => answer?.dates ?? []) }, { maxcc })
    : stripEntries(archive, answers.all ?? null, { maxcc }));
  const first = $derived(sideEntry(entries, archive, a));
  const last = $derived(sideEntry(entries, archive, b));
  const shown = $derived(monthly
    ? entries.filter((entry) => entry.date.startsWith(month))
    : playOrder(entries));
  const chosen = $derived(chosenEntries(entries, picked));
  const thumbs = $derived(thumbView ? thumbTiles(thumbView, provider) : []);
  const monthsRead = $derived(Object.keys(answers).length);
  const over = $derived(chosen.length > MAX_EVOLUTION_FRAMES);
  const moved = $derived(!!readAt && distance(readAt, view) > 1000);
  const read = $derived(monthly ? month in answers : 'all' in answers);

  $effect(() => {
    onchoose(chosen);
  });

  onMount(() => {
    void open();
  });

  function distance(from, to) {
    const dy = (to.lat - from.lat) * 111_320;
    const dx = (to.lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  }

  const dayOf = (side) => side?.sentinel?.date ?? '';

  /** Read what the picker opens on, and tick A to B, or A's pass and B's. */
  async function open() {
    answers = {};
    picked = [];
    note = '';
    readAt = { lat: view.lat, lon: view.lon, zoom: view.zoom };
    if (!monthly) {
      if (await ask('all')) picked = defaultKeys(entries, first, last);
      return;
    }
    const opening = [dayOf(a), dayOf(b)].filter(Boolean).map(monthOf);
    month = opening[0] ?? today;
    monthInput = month;
    for (const each of new Set(opening.length ? opening : [today])) {
      if (!(await ask(each))) return;
    }
    picked = [...new Set([first, last].filter(Boolean).map((entry) => entry.key))];
  }

  /** One read: the history, or one month of passes. False when it failed. */
  async function ask(which) {
    if (which in answers) return true;
    busy = true;
    note = '';
    const at = readAt ?? { lat: view.lat, lon: view.lon, zoom: view.zoom };
    try {
      const bounds = which === 'all' ? null : monthBounds(which);
      const window = bounds ? { start: bounds.from, end: bounds.to } : null;
      const reply = await api.get(lookupPath(archive, at, window));
      answers = { ...answers, [which]: reply };
      if (monthly) onbilled();
      return true;
    } catch (error) {
      note = `Could not read the pictures of this point: ${error.message}`;
      return false;
    } finally {
      busy = false;
    }
  }

  function goTo(next) {
    const held = pickerMonth(next, today);
    if (!held) return;
    month = held;
    monthInput = month;
    void ask(month);
  }

  function toggle(key) {
    picked = picked.includes(key) ? picked.filter((entry) => entry !== key) : [...picked, key];
  }

  /** The clearest usable pass of the month on screen, ticked beside what is. */
  function clearest() {
    const [best] = thinKeys(shown, shown.filter((entry) => entry.usable).map((entry) => entry.key), 'month');
    if (best && !picked.includes(best)) picked = [...picked, best];
  }

  const range = () => rangeKeys(entries, first, last);
  const PRESETS = [
    { label: 'A to B', keys: () => range() },
    { label: 'One a month', keys: () => thinKeys(entries, range(), 'month') },
    { label: 'One a year', keys: () => thinKeys(entries, range(), 'year') },
    { label: 'All', keys: () => allKeys(entries) },
  ];

  const tileUrl = (entry, tile) =>
    `/api/tiles/${encodeURIComponent(variantFor(entry))}/${tile.z}/${tile.x}/${tile.y}`;

  /** What a row adds under its date: a Wayback picture's release, a pass's cloud. */
  function detail(entry) {
    if (!entry.usable) return `${entry.note ? `${entry.note}, ` : ''}over the cloud ceiling`;
    if (!monthly) return entry.note === 'taken' && entry.released ? `release ${entry.released}` : '';
    return entry.note ?? '';
  }
</script>

<div class="evolution" aria-label="Pictures of the evolution">
  <div class="head">
    <span class="field-label">Pictures</span>
    <span class="count">{chosen.length} chosen</span>
    <span class="grow"></span>
    {#if moved}
      <button type="button" class="link" onclick={open} disabled={busy || disabled}>The map moved · read here</button>
    {/if}
  </div>

  {#if monthly}
    <div class="months">
      <button type="button" class="cmp-icon" aria-label="Previous month" title="Previous month"
        disabled={busy || disabled || month <= SENTINEL2_FIRST_MONTH} onclick={() => goTo(addMonths(month, -1))}>
        <Icon name="chevronLeft" size={14} />
      </button>
      <strong>{monthLabel(month)}</strong>
      <button type="button" class="cmp-icon" aria-label="Next month" title="Next month"
        disabled={busy || disabled || month >= today} onclick={() => goTo(addMonths(month, 1))}>
        <Icon name="chevronRight" size={14} />
      </button>
      <input class="input" type="month" aria-label="Go to a month" min={SENTINEL2_FIRST_MONTH} max={today}
        bind:value={monthInput} onchange={(event) => goTo(event.currentTarget.value)} disabled={busy || disabled} />
      <span class="grow"></span>
      {#if shown.length}
        <button type="button" class="btn btn-sm" onclick={clearest} {disabled}>Clearest of the month</button>
      {/if}
    </div>
  {:else if entries.length}
    <div class="presets">
      {#each PRESETS as preset (preset.label)}
        <button type="button" class="btn btn-sm" {disabled} onclick={() => (picked = preset.keys())}>{preset.label}</button>
      {/each}
    </div>
  {/if}

  {#if busy}
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <span>
        <strong>Loading the pictures…</strong>
        <small>{monthly
          ? `Asking Copernicus for the passes of ${monthLabel(month)}.`
          : 'Esri’s history of this point is read picture by picture, which takes a few seconds.'}</small>
      </span>
    </div>
    {#if !shown.length}
      <ol class="cards" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as ghost (ghost)}
          <li class="ghost"><span class="thumb" style:height={`${THUMB.height}px`}></span><span class="bar"></span></li>
        {/each}
      </ol>
    {/if}
  {:else if note}
    <p class="warn" role="alert">
      {note}
      <button type="button" class="link" onclick={() => (monthly ? ask(month) : open())}>Try again</button>
    </p>
  {:else if read && !shown.length}
    <p class="hint">{monthly ? 'No Sentinel-2 pass over this point that month.' : 'The archive holds no picture of this point.'}</p>
  {/if}

  {#if shown.length}
    <ol class="cards">
      {#each shown as entry (entry.key)}
        <li class:off={!entry.usable} class:picked={picked.includes(entry.key)}>
          <label>
            <span class="thumb" class:ready={ready[entry.key]}
              style:width={`${THUMB.width}px`} style:height={`${THUMB.height}px`}>
              {#each thumbs as tile (`${tile.z}/${tile.x}/${tile.y}`)}
                <img alt="" loading="lazy" src={tileUrl(entry, tile)} style:left={`${tile.left}px`}
                  style:top={`${tile.top}px`} style:width={`${tile.size}px`} style:height={`${tile.size}px`}
                  onload={() => (ready[entry.key] = true)} onerror={() => (ready[entry.key] = true)} />
              {/each}
            </span>
            <span class="line">
              <input type="checkbox" checked={picked.includes(entry.key)} {disabled}
                onchange={() => toggle(entry.key)} />
              <span class="mono">{pictureLabel(archive, entry)}</span>
              <span class="grow"></span>
              {#if first?.key === entry.key}<span class="tag">A</span>{/if}
              {#if last?.key === entry.key}<span class="tag">B</span>{/if}
            </span>
            {#if detail(entry)}<small>{detail(entry)}</small>{/if}
          </label>
        </li>
      {/each}
    </ol>
  {/if}

  {#if monthly && chosen.length}
    <ul class="chosen" aria-label="Chosen passes">
      {#each chosen as entry (entry.key)}
        <li>
          <button type="button" class="chip" onclick={() => goTo(monthOf(entry.date))} title="Show its month">{entry.date}</button>
          <button type="button" class="unpick" aria-label={`Untick ${entry.date}`} title="Untick" {disabled}
            onclick={() => toggle(entry.key)}><Icon name="x" size={11} /></button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if over}
    <p class="warn" role="alert">At most {MAX_EVOLUTION_FRAMES} pictures in one export. Untick some.</p>
  {:else if chosen.length < 2 && (read || monthsRead)}
    <p class="hint">Tick at least two pictures{monthly ? ', in this month or another' : ''}.</p>
  {:else if monthly && chosen.length}
    <p class="hint">
      {monthsRead} {monthsRead === 1 ? 'month' : 'months'} read, one Copernicus request each. The export takes up to
      {chosen.length * perPicture} more, a preview one to four; tiles already read are free.
    </p>
  {/if}
</div>

<style>
  .evolution { display: grid; gap: 7px; padding-top: 13px; border-top: 1px solid var(--border); }
  .head, .months, .presets { display: flex; align-items: center; gap: 6px; }
  .presets { flex-wrap: wrap; }
  .grow { flex: 1; }
  .count { color: var(--text-3); font-size: var(--fs-xs); }
  .field-label {
    color: var(--text-3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .months strong { min-width: 118px; text-align: center; font-size: var(--fs-sm); }
  .months input { width: 132px; padding: 3px 6px; font-size: var(--fs-xs); }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .link:disabled { color: var(--text-3); }
  .hint, .warn { margin: 0; font-size: var(--fs-xs); line-height: 1.4; }
  .hint { color: var(--text-3); }
  .warn { color: var(--warn, #e2a03f); }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 6px;
    max-height: 320px;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .cards label {
    display: grid;
    gap: 2px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .cards label:hover { background: var(--bg-2); }
  .cards li.picked label { border-color: var(--accent); }
  .line { display: flex; align-items: center; gap: 6px; }
  .cards small { color: var(--text-3); }
  .thumb {
    position: relative;
    display: block;
    overflow: hidden;
    border-radius: 3px;
    background: #14171d;
  }
  /* A picture on its way shimmers, so an empty box reads as loading. */
  .thumb:not(.ready) {
    background: linear-gradient(90deg, #14171d 30%, #232833 50%, #14171d 70%) 0 0 / 300% 100%;
    animation: shimmer 1.3s linear infinite;
  }
  /* A tile is drawn larger than the box and placed by its offset: the global
     img rule would shrink it to the box and push it out of view. */
  .thumb img { position: absolute; max-width: none; }
  .loading { display: flex; align-items: flex-start; gap: 9px; padding: 8px 10px; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-2); font-size: var(--fs-xs); }
  .loading strong, .loading small { display: block; }
  .loading strong { color: var(--text-1); }
  .loading small { margin-top: 2px; color: var(--text-3); line-height: 1.35; }
  .spinner {
    flex: none;
    width: 13px;
    height: 13px;
    margin-top: 1px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  .ghost { display: grid; gap: 6px; padding: 4px; }
  .ghost .bar { width: 70%; height: 9px; border-radius: 3px; background: var(--bg-2); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { to { background-position: -300% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .spinner, .thumb:not(.ready) { animation: none; }
  }
  li.off .thumb { opacity: 0.45; }
  li.off .mono { color: var(--text-3); }
  .tag {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--accent);
    color: #0b0d11;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 14px;
  }
  .chosen { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .chosen li {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: var(--fs-xs);
  }
  .chip { padding: 1px 4px 1px 8px; font-family: var(--font-mono, monospace); color: var(--text-2); }
  .chip:hover { color: var(--text-1); }
  .unpick { display: flex; padding: 3px 6px 3px 2px; color: var(--text-3); }
  .unpick:hover:not(:disabled) { color: var(--text-1); }
</style>
