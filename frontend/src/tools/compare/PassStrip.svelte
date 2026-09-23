<script>
  /**
   * Every dated picture of the point under the crosshair, and the bracket that
   * dates a change on them.
   *
   * It opens on the archive A and B share, lists what that archive holds for
   * the middle of the view from oldest to newest, and puts any row on either
   * side with one press. Narrowing starts from A (the thing absent) and B (the
   * thing there) and shows the middle picture on B, one question at a time,
   * until the two ends are neighbours. The pure part is `lib/map/passStrip.js`.
   *
   * The list costs one request for the Copernicus archives and none for Esri,
   * and is read only when the strip opens or the analyst asks again. Pictures
   * are asked for separately, at their price.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import Icon from '../../components/Icon.svelte';
  import { orbitMark } from '../../lib/radar.js';
  import {
    THUMB,
    answerProbe,
    between,
    bracketSentence,
    entryOf,
    lookupPath,
    lookupWindow,
    nextProbe,
    startBracket,
    stripEntries,
    thumbTiles,
    undoAnswer,
  } from '../../lib/map/passStrip.js';

  let {
    /** 'sentinel2' | 'sentinel1' | 'esri-wayback', the archive both sides show. */
    archive,
    /** Both sides as a saved comparison keeps them. */
    a,
    b,
    view,
    viewWidth = 1000,
    provider = null,
    maxcc = 100,
    /** The provider id a row's picture is drawn from. */
    variantFor,
    onassign = () => {},
    onbilled = () => {},
    onclose = () => {},
  } = $props();

  const NAMES = { sentinel2: 'Sentinel-2', sentinel1: 'Sentinel-1 radar', 'esri-wayback': 'Esri Wayback' };
  const metered = $derived(archive !== 'esri-wayback');

  let answer = $state(null);
  let busy = $state(false);
  let note = $state('');
  let readAt = $state(null);
  let pictures = $state(null); // the view the pictures were drawn for, or null
  let bracket = $state(null);
  let copied = $state(false);

  // Radar compares one track: the track is the pass on B, or on A.
  const track = $derived(archive === 'sentinel1' ? (b?.radar?.time || a?.radar?.time || '') : '');
  const entries = $derived(stripEntries(archive, answer, { maxcc, track }));
  const onA = $derived(entryOf(entries, archive, a));
  const onB = $derived(entryOf(entries, archive, b));
  const moved = $derived(!!readAt && distance(readAt, view) > 1000);
  const left = $derived(bracket ? between(entries, bracket).length : 0);
  const done = $derived(!!bracket && !bracket.probe && !left);
  const canNarrow = $derived(!bracket && !!startBracket(entries, onA, onB));
  const perPicture = $derived(pictures ? thumbTiles({ ...pictures }, provider).length : 0);
  const priced = $derived(thumbTiles({ ...view, viewWidth }, provider).length * entries.length);

  function distance(from, to) {
    const rad = Math.PI / 180;
    const dy = (to.lat - from.lat) * 111_320;
    const dx = (to.lon - from.lon) * 111_320 * Math.cos(from.lat * rad);
    return Math.hypot(dx, dy);
  }

  async function read() {
    busy = true;
    note = '';
    const at = { lat: view.lat, lon: view.lon, zoom: view.zoom };
    try {
      answer = await api.get(lookupPath(archive, at, lookupWindow(a, b)));
      readAt = at;
      bracket = null;
      pictures = null;
      if (metered) onbilled();
    } catch (error) {
      note = `Could not read the pictures of this point: ${error.message}`;
    } finally {
      busy = false;
    }
  }

  // Read once when the strip opens on an archive; after that only on request.
  let readFor = '';
  $effect(() => {
    const key = archive;
    if (key === readFor) return;
    readFor = key;
    untrack(() => void read());
  });

  function assign(letter, entry) {
    if (!entry.usable && archive === 'sentinel2') return;
    onassign(letter, entry);
  }

  function probe(next) {
    const row = nextProbe(entries, next);
    bracket = row ? { ...next, probe: row.key } : next;
    const before = entries.find((entry) => entry.key === bracket.before);
    const after = entries.find((entry) => entry.key === bracket.after);
    if (before) onassign('a', before);
    if (row) onassign('b', row);
    else if (after) onassign('b', after);
  }

  function narrow() {
    const start = startBracket(entries, onA, onB);
    if (start) probe(start);
  }

  function answerIt(verdict) {
    probe(answerProbe(bracket, verdict));
  }

  function undo() {
    probe(undoAnswer(bracket));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(bracketSentence(entries, bracket, NAMES[archive]));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  const label = (entry) => (entry.time ? `${entry.date} ${entry.time.slice(0, 5)}` : entry.date);
  const tileUrl = (entry, tile) => `/api/tiles/${variantFor(entry)}/${tile.z}/${tile.x}/${tile.y}`;
</script>

<section class="strip cmp-glass" aria-label="Pictures of this point">
  <header>
    <strong>{NAMES[archive]}</strong>
    <span class="hint">{entries.length ? `${entries.length} pictures of the crosshair, oldest first` : ''}</span>
    <span class="grow"></span>
    {#if moved}
      <button class="linkish" onclick={read}>The map moved · read here</button>
    {/if}
    {#if entries.length && !pictures}
      <button class="btn btn-sm" onclick={() => (pictures = { ...view, viewWidth })}
        title="Draw each picture of the view in the strip">
        Show pictures{metered ? ` · about ${priced} requests` : ''}
      </button>
    {:else if pictures}
      <button class="btn btn-sm" onclick={() => (pictures = null)}>Hide pictures</button>
    {/if}
    <button class="cmp-icon" onclick={onclose} aria-label="Close the pictures strip" title="Close"><Icon name="x" size={13} /></button>
  </header>

  {#if busy}
    <p class="hint">Reading the archive…</p>
  {:else if note}
    <p class="warn" role="alert">{note}</p>
  {:else if answer && !entries.length}
    <p class="hint">The archive holds no picture of this point in the window around A and B.</p>
  {/if}

  {#if entries.length}
    <ol class="row" class:big={!!pictures}>
      {#each entries as entry (entry.key)}
        {@const isA = onA?.key === entry.key}
        {@const isB = onB?.key === entry.key}
        {@const inside = bracket && between(entries, bracket).includes(entry)}
        <li class:off={!entry.usable} class:inside class:probe={bracket?.probe === entry.key}>
          <button class="card" disabled={!entry.usable && archive === 'sentinel2'}
            onclick={(event) => assign(event.altKey ? 'a' : 'b', entry)}
            title={entry.usable ? 'Show on B · Alt to show on A'
              : archive === 'sentinel1' ? 'Another track: it sees the ground from another angle'
              : 'Over the cloud ceiling'}>
            {#if pictures}
              <span class="thumb" style:width={`${THUMB.width}px`} style:height={`${THUMB.height}px`}>
                {#each thumbTiles(pictures, provider) as tile (`${tile.z}/${tile.x}/${tile.y}`)}
                  <img alt="" loading="lazy" src={tileUrl(entry, tile)} style:left={`${tile.left}px`}
                    style:top={`${tile.top}px`} style:width={`${tile.size}px`} style:height={`${tile.size}px`} />
                {/each}
              </span>
            {/if}
            <span class="when mono">{label(entry)} {orbitMark(entry.orbit)}</span>
            {#if entry.note && !entry.time}<span class="note">{entry.note}</span>{/if}
          </button>
          <span class="tags">
            {#if isA}<span class="tag a">A</span>{/if}
            {#if isB}<span class="tag b">B</span>{/if}
            {#if !isA}<button class="set" onclick={() => assign('a', entry)} aria-label={`Show ${label(entry)} on A`}>A</button>{/if}
          </span>
        </li>
      {/each}
    </ol>
    {#if pictures && perPicture > 1}
      <p class="hint">Each picture takes {perPicture} tiles here; they are cached once read.</p>
    {/if}
  {/if}

  {#if entries.length}
    <footer class="bracket">
      {#if !bracket}
        {#if canNarrow}
          <span class="hint">A shows it absent and B present? Narrow it down one picture at a time.</span>
          <button class="btn btn-sm btn-primary" onclick={narrow}>Date it</button>
        {:else}
          <span class="hint">Put a picture without it on A and one with it on B, A the older, to date when it appeared.</span>
        {/if}
      {:else if bracket.probe}
        <span class="question">Is it there on B, <strong class="mono">{label(entries.find((entry) => entry.key === bracket.probe))}</strong>?
          <span class="hint">{left} left to check</span></span>
        <button class="btn btn-sm" onclick={() => answerIt('there')}>It is there</button>
        <button class="btn btn-sm" onclick={() => answerIt('absent')}>Not yet</button>
        <button class="btn btn-sm" onclick={() => answerIt('unclear')} title="Cloud, a smear, or a look that settles nothing">Can’t tell</button>
        {#if bracket.history.length}<button class="linkish" onclick={undo}>Undo</button>{/if}
      {:else if done}
        <span class="question">{bracketSentence(entries, bracket, NAMES[archive])}</span>
        <button class="btn btn-sm" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        {#if bracket.history.length}<button class="linkish" onclick={undo}>Undo</button>{/if}
        <button class="linkish" onclick={() => (bracket = null)}>Done</button>
      {/if}
    </footer>
  {/if}
</section>

<style>
  .strip {
    display: grid;
    gap: 6px;
    margin: 6px 8px 0;
    padding: 6px 8px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
  }
  .grow { flex: 1; }
  .hint { color: var(--glass-muted, var(--text-3)); font-size: 10.5px; margin: 0; }
  .warn { color: var(--warn, #e2a03f); font-size: var(--fs-xs); margin: 0; }
  .row {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 2px 0 4px;
    overflow-x: auto;
    list-style: none;
  }
  li {
    position: relative;
    flex: 0 0 auto;
    display: grid;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
  }
  li.inside { border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  li.probe { border-color: var(--accent); }
  li.off { opacity: 0.45; }
  .card {
    display: grid;
    justify-items: start;
    gap: 2px;
    padding: 4px 22px 4px 6px;
    border-radius: var(--r-sm);
    color: var(--glass-ink, var(--text-1));
    font-size: 10.5px;
    text-align: left;
  }
  .card:hover:not(:disabled) { background: var(--glass-hover, var(--bg-3)); }
  .thumb {
    position: relative;
    display: block;
    overflow: hidden;
    border-radius: 3px;
    background: #14171d;
  }
  .thumb img { position: absolute; image-rendering: auto; }
  .note { color: var(--glass-muted, var(--text-3)); font-size: 10px; }
  .tags {
    position: absolute;
    top: 3px;
    right: 3px;
    display: flex;
    gap: 2px;
  }
  .tag, .set {
    min-width: 15px;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
  }
  .tag.a { background: var(--side-a, #38bdf8); color: #0b0d11; }
  .tag.b { background: var(--side-b, #f59e0b); color: #0b0d11; }
  .set { display: none; border: 1px solid var(--glass-line, var(--border)); color: var(--glass-muted, var(--text-3)); }
  li:hover .set { display: block; }
  .bracket {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
  }
  .question { color: var(--glass-ink, var(--text-1)); }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
