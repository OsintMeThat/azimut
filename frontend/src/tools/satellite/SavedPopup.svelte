<script>
  /**
   * What a mark on the map holds, when you click it.
   *
   * One point can hold several saved items — the same place captured on three
   * dates, a place plus its crop. So this is always a list, even of one: the
   * answer to "what do I already have here?" reads the same whether it is one
   * item or five. Ordered by imagery date, so a stack reads as a timeline of
   * the ground rather than of your clicks.
   */
  import Icon from '../../components/Icon.svelte';
  import RelationList from '../../components/RelationList.svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { postTarget } from '../../lib/post.js';
  import { stackOrder } from '../../lib/savedMarkers.js';

  let {
    items = [],
    caseId,
    coords,
    fullscreen = false,
    onopen,
    onedit,
    onproof,
    onpost,
    onshowproofs,
    onentity, // a related entity was picked: leave for its own tool
    onrefresh, // a relation was settled: sync the other surfaces
  } = $props();

  const GLYPH = { place: 'pin', capture: 'satellite', screenshot: 'screen', proof: 'proof' };
  const KIND = { place: 'Place', capture: 'Capture', screenshot: 'Screenshot', proof: 'Proof' };

  const linkedPosts = (row) => Array.isArray(row.linked_posts) ? row.linked_posts : [];
  let expandedPostRows = $state([]);
  const rowKey = (row) => row.key ?? row.id;
  const postsExpanded = (row) => expandedPostRows.includes(rowKey(row));
  const visiblePosts = (row) =>
    postsExpanded(row) ? linkedPosts(row) : linkedPosts(row).slice(0, 2);
  const hiddenPostCount = (row) => Math.max(0, linkedPosts(row).length - 2);

  function expandPosts(event, row) {
    // Leaflet closes a popup when a click reaches the map. This control changes
    // only the popup's own contents, so keep the event inside the card.
    event.stopPropagation();
    if (!postsExpanded(row)) expandedPostRows = [...expandedPostRows, rowKey(row)];
  }

  /** What the dot on the mark meant. A proof borrows this capture's point, so
   *  it is named here rather than drawn as a second mark. */
  const worked = (row) =>
    row.proofs > 0 ? `${row.proofs} proof${row.proofs > 1 ? 's' : ''} here` : null;

  const ordered = $derived(stackOrder(items));
  const here = $derived(ordered[0]);

  const day = (stamp) => (stamp ? String(stamp).slice(0, 10) : null);


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
      relationsByRow = { ...relationsByRow, [rowKey(row)]: chain?.relations ?? [] };
    } catch (e) {
      // A read that failed is not an answer: caching it as an empty list would
      // have the card claim this point holds no relations. Fold the row back so
      // the count still says there are some, and a second click retries.
      openRows = openRows.filter((key) => key !== rowKey(row));
      toast(`Could not read the relations: ${e.message}`, 'danger', 5000);
    }
  }

  function showRelations(event, row) {
    // Leaflet decides whether a click was "on the map" by walking up from the
    // event target to find the popup container. This control replaces itself with
    // the loaded list, so by then the clicked button can already be detached from
    // the document — the walk finds nothing and the map closes the card under us.
    // Keeping the event inside the card is what makes that impossible.
    event?.stopPropagation();
    if (!relationsShown(row)) openRows = [...openRows, rowKey(row)];
    loadRelations(row);
  }

  async function relationSettled(row) {
    await loadRelations(row);
    await onrefresh?.();
  }

</script>

<div class="pop">
  <header>
    <span class="mono where">{coords(here)}</span>
    {#if ordered.length > 1}<span class="tally">{ordered.length} saved here</span>{/if}
  </header>

  <div class="stack" class:scrolls={ordered.length > 2}>
    {#each ordered as row (row.key ?? row.id)}
      {@const flyable = row.lat != null && row.lon != null}
      {@const rowPosts = linkedPosts(row)}
      <div class="entry">
        <button
          type="button"
          class="preview"
          disabled={!flyable && !row.source_url}
          title={flyable ? 'Fly the map here' : 'Open the source page'}
          onclick={() => onopen(row)}
        >
          {#if row.thumbnail && caseId}
            <img src={`/files/${caseId}/${row.thumbnail}`} alt="" loading="lazy" decoding="async" />
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
            {#if row.status === 'suggested'}
              <span class="proposed" title="Proposed from a file's own metadata">suggested</span>
            {/if}
          </p>
          <p class="meta">
            {#if row.imagery_date}<span>Imagery {row.imagery_date}</span>{/if}
            {#if day(row.fetched_at)}<span>Saved {day(row.fetched_at)}</span>{/if}
          </p>
          {#if worked(row)}
            <p class="worked">
              <span class="worked-dot"></span>
              <span>{worked(row)}</span>
              <button type="button" class="link" onclick={() => onshowproofs?.()}>
                Show proofs
              </button>
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
          {#if rowPosts.length}
            <section class="linked-posts">
              <p class="post-heading">
                <Icon name="post" size={11} />
                {rowPosts.length === 1 ? 'Linked post' : `Linked posts · ${rowPosts.length}`}
              </p>
              <div class="post-list" class:expanded={postsExpanded(row)}>
                {#each visiblePosts(row) as post (post.id)}
                  <button
                    type="button"
                    class="post-row"
                    title={`Open "${post.title}" in Geo Report`}
                    onclick={() => onpost?.(post)}
                  >
                    <span class="post-target">{postTarget(post.target).label}</span>
                    <span class="post-title">{post.title}</span>
                    <Icon name="chevronRight" size={11} />
                  </button>
                {/each}
                {#if !postsExpanded(row) && hiddenPostCount(row)}
                  <button type="button" class="more-posts" onclick={(event) => expandPosts(event, row)}>
                    + {hiddenPostCount(row)} more
                  </button>
                {/if}
              </div>
            </section>
          {/if}
          <p class="acts">
            {#if row.kind === 'proof'}
              <button type="button" class="link" onclick={() => onproof?.(row)}>
                Open in Geo Proof
              </button>
            {:else}
              <button type="button" class="link" onclick={() => onedit(row)}>Edit</button>
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
                href={fullscreen ? undefined : `/files/${caseId}/${row.path}`}
                target="_blank"
                rel="noreferrer"
                aria-disabled={fullscreen}
                title={fullscreen ? 'Exit fullscreen first. This leaves the map' : 'Open the full image'}
              >Full image <Icon name="external" size={10} /></a>
            {/if}
          </p>
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
  /* the mark's dot, named: the card is where "already worked" becomes a number
     and a way into the proofs view */
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
  .linked-posts,
  .relations {
    margin-top: 4px;
    padding-top: 5px;
    border-top: 1px solid var(--border);
  }
  .rel-heading,
  .post-heading {
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
  .post-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .post-list.expanded {
    max-height: 132px;
    overflow-y: auto;
  }
  .post-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 3px 4px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .post-row:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .post-target {
    min-width: 14px;
    padding: 0 3px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    color: var(--text-3);
    font-size: 9px;
    line-height: 14px;
    text-align: center;
  }
  .post-title {
    overflow: hidden;
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more-posts {
    align-self: flex-start;
    padding: 1px 4px;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more-posts:hover {
    text-decoration: underline;
  }
  .acts {
    display: flex;
    gap: 10px;
    margin: 4px 0 0;
  }
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
