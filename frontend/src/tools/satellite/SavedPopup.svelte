<script>
  /**
   * What a mark on the map holds, when you click it.
   *
   * One point can hold several saved items — the same place captured on three
   * dates, a place plus its crop. So this is always a list, even of one: the
   * answer to "what do I already have here?" reads the same whether it is one
   * item or five. Ordered by imagery date, so a stack reads as a timeline of
   * the ground rather than of your clicks.
   *
   * A located photo or video is read by looking at it, so the files on a point play
   * at the top of the card, one at a time with arrows for a stack, and the work
   * filed there is listed under them. Where the map has a panel for it, the file
   * is taken there to be read beside the imagery, at the moment it was playing.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import RelationList from '../../components/RelationList.svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { loadRelationTypes, relationAction } from '../../lib/relations.svelte.js';
  import { keptLabel, lookLabel, pairLabel, stackOrder } from '../../lib/savedMarkers.js';
  import { roadWords, step } from '../../lib/mediaViewer.js';
  import { placeColour } from '../../lib/mapMarkers.js';
  import LayerStylePalette from './LayerStylePalette.svelte';

  let {
    items = [],
    caseId,
    coords,
    fullscreen = false,
    onopen,
    onedit,
    ondelete,
    ontrace,
    onentity, // a related entity was picked: leave for its own tool
    onrefresh, // a relation was settled: sync the other surfaces
    // a place was given a colour: its mark is painted again at once. Absent on a
    // map that edits nothing, which offers no colour either.
    oncolour = null,
    // the files on this point, read in the panel beside the map: `(files, index,
    // start)`, `start` the moment a video was at. Absent where the map has no panel.
    onexpand = null,
    // a place picked up to be put down elsewhere: `(row, pointer)`, the pointer where
    // the press was. Absent on a map that moves nothing.
    onmove = null,
    // the card changed height once a file's shape was known: the map shows it whole again
    onresize = null,
  } = $props();

  const GLYPH = { place: 'pin', capture: 'satellite', screenshot: 'screen', comparison: 'compare', view: 'horizon' };
  const KIND = { place: 'Place', capture: 'Capture', screenshot: 'Screenshot', comparison: 'Comparison', view: 'Horizon view' };

  const rowKey = (row) => row.key ?? row.id;

  /** What the dot on the mark meant. A proof stands on the point it argues, so
   *  it is named here rather than drawn as a second mark. */
  const worked = (row) =>
    row.proofs > 0 ? `${row.proofs} proof${row.proofs > 1 ? 's' : ''} here` : null;

  /** How tightly this point is pinned, read-only: the shape is already drawn on the
   *  map behind this card, and editing it belongs to the details drawer. Two forms
   *  for one field is how they drift apart. */
  function spread(row) {
    if (row.kind === 'comparison') return row.footprint ? 'framed' : null;
    if (row.kind === 'view') return lookLabel(row) || null;
    if (row.footprint) return 'traced area';
    const m = Number(row.radius_m);
    if (!(m > 0)) return null;
    return m >= 1000 ? `±${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `±${Math.round(m)} m`;
  }

  const ordered = $derived(stackOrder(items));
  const here = $derived(ordered[0]);
  // the files standing here play at the top; the work filed here is listed under them
  const files = $derived(ordered.filter((row) => row.kind === 'media'));
  const work = $derived(ordered.filter((row) => row.kind !== 'media'));
  let fileIndex = $state(0);
  const file = $derived(files[Math.min(fileIndex, files.length - 1)] ?? null);
  const why = $derived(roadWords(file));
  let video = $state(null);

  /**
   * The stage takes the file's own shape once its size is known: a phone video
   * stands tall, up to `max`, rather than being cut to a strip of sky. Until then,
   * and for a file that never says, it is a landscape frame the card's width.
   */
  const STAGE = { width: 296, base: 166, min: 120, max: 320 };
  let shapes = $state({}); // file key → its height over its width
  const stageHeight = $derived.by(() => {
    const ratio = file ? shapes[rowKey(file)] : null;
    if (!ratio) return STAGE.base;
    return Math.round(Math.min(STAGE.max, Math.max(STAGE.min, STAGE.width * ratio)));
  });

  function measured(row, width, height) {
    if (!(width > 0 && height > 0) || shapes[rowKey(row)] === height / width) return;
    shapes = { ...shapes, [rowKey(row)]: height / width };
    tick().then(() => onresize?.());
  }

  /** The file on screen, taken to the panel at the moment it was playing. */
  function expand() {
    const start = video && file?.media_kind === 'video'
      ? { key: rowKey(file), time: video.currentTime, playing: !video.paused }
      : null;
    video?.pause();
    onexpand?.(files, Math.min(fileIndex, files.length - 1), start);
  }

  /** A place a proof states is moved in the proof, which keeps and prints its point. */
  const movedInProof = (row) => row.proofs > 0;

  const day = (stamp) => (stamp ? String(stamp).slice(0, 10) : null);
  loadRelationTypes();


  // Relations: the saved index carries the count, never the edges — it is loaded
  // whole on case open. The edges come from the bounded chain endpoint, per row,
  // and only for a row whose relations are on screen. A single mark opens them
  // straight away (clicking a place to see which photos claim it is the point of
  // the gesture); a stack waits to be asked, so five marks are not five fetches.
  //
  // Settling one reloads this row's edges, then asks the host to sync the rest —
  // confirming a proposed relation confirms its point, which the Suggestions list
  // shows too. The refreshed index cannot rebuild the layer under an open card
  // (SavedOverlay defers that), so the count reads the loaded list meanwhile.
  let openRows = $state([]);
  let relationsByRow = $state({});
  const relationCount = (row) =>
    relationsByRow[rowKey(row)]?.length ?? Number(row.relations ?? 0);
  const relationsShown = (row) => openRows.includes(rowKey(row));

  $effect(() => {
    const only = ordered.length === 1 ? ordered[0] : null;
    // guarded on "already open": this effect writes the state it reads, so
    // without it the row would be fetched a second time on the re-run
    if (!only || !relationCount(only) || relationsShown(only)) return;
    showRelations(null, only);
  });

  async function loadRelations(row) {
    if (!caseId || !row.id) return;
    try {
      const chain = await api.get(`/api/cases/${caseId}/entities/${row.id}/chain`);
      await loadRelationTypes();
      const ordinary = (chain?.relations ?? []).filter(
        (relation) => relationAction(relation.link.type) === 'relation'
      );
      relationsByRow = { ...relationsByRow, [rowKey(row)]: ordinary };
    } catch (e) {
      // A read that failed is not an answer: caching it as an empty list would
      // have the card claim this point holds no relations. Fold the row back so
      // the count still says there are some, and a second click retries.
      openRows = openRows.filter((key) => key !== rowKey(row));
      toast(`Could not read the relations: ${e.message}`, 'danger', 5000);
    }
  }

  function showRelations(event, row) {
    // Same, and one thing more: this control replaces itself with the loaded
    // list, so by the time the click is judged the button can already be gone
    // from the document. Stopping it here does not depend on the button still
    // being there to be found.
    // Keeping the event inside the card is what makes that impossible.
    event?.stopPropagation();
    if (!relationsShown(row)) openRows = [...openRows, rowKey(row)];
    loadRelations(row);
  }

  async function relationSettled(row) {
    await loadRelations(row);
    await onrefresh?.();
  }

  // A place's colour, picked from the palette a layer's style is (recent colours and
  // a code typed or pasted). The colour a place shows waits for no reload.
  let colouring = $state(null);
  let picked = $state({});
  const colourOf = (row) => placeColour(picked[rowKey(row)] ?? row.color);

  async function recolour(row, hex) {
    const colour = placeColour(hex);
    if (colour === colourOf(row) || !caseId || !row.id) return;
    const before = picked[rowKey(row)];
    picked = { ...picked, [rowKey(row)]: colour };
    try {
      await api.patch(`/api/cases/${caseId}/entities/${row.id}`, { attrs: { color: colour } });
      oncolour?.(row, colour);
      await onrefresh?.();
    } catch (e) {
      picked = { ...picked, [rowKey(row)]: before };
      toast(`Could not change the colour: ${e.message}`, 'danger', 5000);
    }
  }

</script>

<div class="pop">
  <header>
    <span class="mono where">{coords(here)}</span>
    {#if ordered.length > 1}<span class="tally">{ordered.length} saved here</span>{/if}
  </header>

  {#if file}
    <section class="file" aria-label="Located file">
      <!-- keyed on the file, so stepping away stops the video that was playing -->
      {#key rowKey(file)}
        {@const shown = file}
        <div class="stage" style:height="{stageHeight}px">
          {#if shown.media_kind === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={video}
              src={fileUrl(caseId, shown.path)}
              controls
              preload="metadata"
              onloadedmetadata={(event) => measured(shown, event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            ></video>
          {:else}
            <img
              src={fileUrl(caseId, shown.path)}
              alt={shown.title}
              decoding="async"
              onload={(event) => measured(shown, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            />
          {/if}
        </div>
      {/key}
      <div class="file-head">
        <span class="title file-title" title={file.title}>{file.title || 'Untitled'}</span>
        {#if files.length > 1}
          <span class="walk">
            <button type="button" class="icon-act" aria-label="Previous file" title="Previous file"
              onclick={() => (fileIndex = step(fileIndex, -1, files.length))}><Icon name="chevronLeft" size={13} /></button>
            <span class="count">{Math.min(fileIndex, files.length - 1) + 1} / {files.length}</span>
            <button type="button" class="icon-act" aria-label="Next file" title="Next file"
              onclick={() => (fileIndex = step(fileIndex, 1, files.length))}><Icon name="chevronRight" size={13} /></button>
          </span>
        {/if}
      </div>
      <p class="meta">
        <span class="kind">
          <Icon name={file.media_kind === 'video' ? 'video' : 'image'} size={10} />
          {file.media_kind === 'video' ? 'Video' : 'Image'}
        </span>
        {#if why}<span>{why}</span>{/if}
        {#if file.status === 'suggested'}
          <span class="proposed" title="Proposed by a tool, waiting for you">suggested</span>
        {/if}
      </p>
      <p class="acts">
        {#if onexpand}
          <button type="button" class="icon-act" aria-label="Play beside the map" title="Play beside the map" onclick={expand}>
            <Icon name="panelRight" size={13} />
          </button>
        {/if}
        <button
          type="button"
          class="link"
          class:off={fullscreen}
          disabled={fullscreen}
          title={fullscreen ? 'Exit fullscreen first. This leaves the map' : 'Open this file in Media'}
          onclick={() => onentity?.({ id: file.id, type: 'media', attrs: { path: file.path } })}
        >Open in Media</button>
      </p>
    </section>
  {/if}

  <div class="stack" class:scrolls={work.length > 2} class:under={file && work.length}>
    {#each work as row (row.key ?? row.id)}
      {@const flyable = row.lat != null && row.lon != null}
      <div class="entry">
        <button
          type="button"
          class="preview"
          disabled={!flyable && !row.source_url}
          title={flyable ? 'Fly the map here' : 'Open the source page'}
          onclick={() => onopen(row)}
        >
          {#if row.thumbnail && caseId}
            <img src={fileUrl(caseId, row.thumbnail)} alt="" loading="lazy" decoding="async" />
          {:else}
            <Icon name={GLYPH[row.kind] ?? 'pin'} size={20} />
          {/if}
        </button>
        <div class="body">
          <button type="button" class="title" onclick={() => onopen(row)}>
            {row.title || 'Untitled'}
          </button>
          <p class="meta">
            <span class="kind"><Icon name={GLYPH[row.kind] ?? 'pin'} size={10} /> {KIND[row.kind]}</span>
            {#if row.provider ?? row.site}<span>{row.provider ?? row.site}</span>{/if}
            {#if row.zoom != null}<span>z{Math.round(row.zoom)}</span>{/if}
            {#if spread(row)}
              <span title="How tightly this point is pinned">{spread(row)}</span>
            {/if}
            {#if row.status === 'suggested'}
              <span class="proposed" title="Proposed from a file's own metadata">suggested</span>
            {/if}
          </p>
          <p class="meta">
            {#if row.imagery_date}<span>Imagery {row.imagery_date}</span>{/if}
            {#if pairLabel(row)}<span title="The dates of pictures A and B">{pairLabel(row)}</span>{/if}
            {#if day(row.fetched_at)}<span>Saved {day(row.fetched_at)}</span>{/if}
          </p>
          {#if row.kept?.length}
            <section class="kept">
              <p class="rel-heading"><Icon name="image" size={11} /> {keptLabel(row)}</p>
              {#each row.kept as image (image.path)}
                <a
                  class="link"
                  class:off={fullscreen}
                  href={fullscreen ? undefined : fileUrl(caseId, image.path)}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={fullscreen}
                  title={fullscreen ? 'Exit fullscreen first. This leaves the map' : 'Open this image'}
                >{image.title || image.path}</a>
              {/each}
            </section>
          {/if}
          {#if worked(row)}
            <p class="worked">
              <span class="worked-dot"></span>
              <span>{worked(row)}</span>
            </p>
          {/if}
          {#if row.notes}<p class="note">{row.notes}</p>{/if}
          {#if relationCount(row)}
            <section class="relations">
              {#if relationsShown(row)}
                <p class="rel-heading">
                  <Icon name="link" size={11} />
                  {relationCount(row) === 1 ? 'Relation' : `Relations · ${relationCount(row)}`}
                </p>
                <RelationList
                  {caseId}
                  relations={relationsByRow[rowKey(row)] ?? []}
                  subjectType={row.kind === 'place' ? 'place' : 'capture'}
                  actionFilter="relation"
                  max={3}
                  onwalk={(entity) => onentity?.(entity)}
                  onchanged={() => relationSettled(row)}
                />
              {:else}
                <button type="button" class="link" onclick={(event) => showRelations(event, row)}>
                  <Icon name="link" size={11} />
                  {relationCount(row)} relation{relationCount(row) > 1 ? 's' : ''}
                </button>
              {/if}
            </section>
          {/if}
          <p class="acts">
            {#if row.kind === 'place' && onmove}
              <button
                type="button"
                class="icon-act"
                aria-label="Move place"
                title={movedInProof(row) ? 'A proof states this point: open it to move the point' : 'Pick this place up and put it down elsewhere'}
                onclick={(event) => onmove(row, { x: event.clientX, y: event.clientY })}
              ><Icon name="move" size={13} /></button>
            {/if}
            {#if row.kind === 'place' && ondelete}
              <button type="button" class="icon-act danger" title="Delete case place" aria-label="Delete case place" onclick={() => ondelete(row)}>
                <Icon name="trash" size={13} />
              </button>
            {/if}
            {#if onedit}
              {@const editLabel = row.kind === 'comparison' ? 'Open in Compare' : row.kind === 'view' ? 'Open in Horizon' : 'Edit'}
              <button type="button" class="icon-act" title={editLabel} aria-label={editLabel} onclick={() => onedit(row)}>
                <Icon name={row.kind === 'comparison' ? 'compare' : row.kind === 'view' ? 'horizon' : 'edit'} size={13} />
              </button>
            {/if}
            {#if row.kind === 'place' && oncolour}
              <button
                type="button"
                class="icon-act"
                class:on={colouring === rowKey(row)}
                aria-label="Place colour"
                aria-expanded={colouring === rowKey(row)}
                title="The colour of this place on the map"
                onclick={(event) => {
                  event.stopPropagation();
                  colouring = colouring === rowKey(row) ? null : rowKey(row);
                }}
              ><span class="colour-dot" style:background={colourOf(row)}></span></button>
            {/if}
            {#if row.kind === 'place' && ontrace}
              <button
                type="button"
                class="icon-act"
                aria-label={`${row.footprint ? 'Retrace' : 'Trace'} footprint`}
                onclick={() => ontrace(row)}
                title={row.footprint
                  ? 'Draw this shape again on the map'
                  : 'Draw the area this place really covers'}
              ><Icon name="polygon" size={13} /></button>
            {/if}
            {#if row.source_url}
              <a
                class="link"
                class:off={fullscreen}
                href={fullscreen ? undefined : row.source_url}
                target="_blank"
                rel="noreferrer"
                aria-disabled={fullscreen}
                title={fullscreen ? 'Exit fullscreen first. This leaves the map' : row.source_url}
              >Source <Icon name="external" size={10} /></a>
            {/if}
            {#if row.path}
              <a
                class="link"
                class:off={fullscreen}
                href={fullscreen ? undefined : fileUrl(caseId, row.path)}
                target="_blank"
                rel="noreferrer"
                aria-disabled={fullscreen}
                title={fullscreen ? 'Exit fullscreen first. This leaves the map' : 'Open the full image'}
              >Full image <Icon name="external" size={10} /></a>
            {/if}
          </p>
          {#if row.kind === 'place' && oncolour && colouring === rowKey(row)}
            <div class="colours">
              <LayerStylePalette label="Place" colour={colourOf(row)} point={false}
                onpick={({ colour }) => recolour(row, colour)} />
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .pop {
    width: 296px;
    font-family: var(--font-sans);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .where {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .tally {
    font-size: var(--fs-xs);
    color: var(--accent);
    white-space: nowrap;
  }
  .stack {
    display: flex;
    flex-direction: column;
  }
  .stack:empty {
    display: none;
  }
  /* the work filed on a point, under the file that plays there */
  .stack.under {
    border-top: 1px solid var(--border);
  }
  .file {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 0;
  }
  /* the picture whole, letterboxed, at the width of the card. Laid over the stage
     rather than sized by percentages, which a grid row of no set height never
     resolves: a tall video then took its own height and was cut to its middle */
  .stage {
    position: relative;
    border-radius: var(--r-sm);
    background: #000;
    overflow: hidden;
  }
  .stage video,
  .stage img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .file-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  }
  .file-title {
    flex: 1;
    min-width: 0;
    cursor: default;
  }
  .file-title:hover {
    color: var(--text-1);
  }
  .walk {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  /* two entries fit; past that the popup scrolls rather than growing off-map */
  .stack.scrolls {
    max-height: 260px;
    overflow-y: auto;
  }
  .entry {
    display: flex;
    gap: 9px;
    padding: 8px 0;
  }
  .entry + .entry {
    border-top: 1px solid var(--border);
  }
  .preview {
    display: grid;
    place-items: center;
    position: relative;
    flex: 0 0 auto;
    width: 72px;
    height: 52px;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-3);
    overflow: hidden;
    cursor: pointer;
  }
  .preview img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .preview:hover:not(:disabled) {
    box-shadow: 0 0 0 1px var(--accent);
  }
  .body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .title:hover {
    color: var(--accent);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .meta:empty {
    display: none;
  }
  /* the same dot separator the rest of the app uses between metadata bits */
  .meta > * + *::before {
    content: '·';
    margin-right: 7px;
    color: var(--border-strong);
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  /* the mark's dot, named: the card is where "already worked" becomes a number */
  .worked {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .worked-dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
  }
  .note {
    margin: 2px 0 0;
    font-size: var(--fs-xs);
    font-style: italic;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .proposed {
    padding: 0 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: color-mix(in srgb, var(--accent) 85%, var(--text-2));
    font-size: 9px;
  }
  /* the dot separator the meta line inserts between its bits would read as part
     of the chip, so this one stands on its own */
  .meta > .proposed::before {
    content: none;
  }
  .relations,
  .kept {
    margin-top: 4px;
    padding-top: 5px;
    border-top: 1px solid var(--border);
  }
  .kept {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .rel-heading {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 3px;
    color: var(--text-3);
    font-size: 9px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .acts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin: 4px 0 0;
  }
  .icon-act { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-2); cursor: pointer; }
  .icon-act:hover { color: var(--accent); background: var(--bg-3); }
  .icon-act.danger:hover { color: var(--danger); }
  .icon-act.on { background: var(--bg-3); }
  .colour-dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 1.5px #141414, 0 0 0 2.5px rgba(255, 255, 255, 0.35); }
  .colours { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--border); }
  .acts > .link { margin-left: 4px; }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    background: none;
    border: none;
    font-size: var(--fs-xs);
    color: var(--accent);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .link.off {
    color: var(--text-3);
    cursor: not-allowed;
    text-decoration: none;
  }
</style>
