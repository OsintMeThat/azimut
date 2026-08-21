<script>
  /**
   * One saved item, as it reads in the Saved tree and in the search modal.
   *
   * The row *is* the primary action: clicking it flies the map to the point, or
   * opens the source page for a screenshot of a site we cannot embed. The rest
   * of the actions stay out of the way until the row is hovered or focused, so
   * a long list scans as titles and coordinates rather than as rows of buttons.
   */
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';

  let {
    row,
    caseId,
    coords,
    fullscreen = false,
    dense = false,
    active = false,
    hovered = false,
    // set only by the folder view of the tree, where there is somewhere to drop
    draggable = false,
    ondragstart = () => {},
    onopen,
    onedit,
    ondelete,
    onproof,
    // Absent where a surface has no way to reload after the change; the accept
    // action then stays off the row rather than being offered and doing nothing.
    onaccept = null,
    onhover = () => {},
  } = $props();

  const GLYPH = { place: 'pin', capture: 'satellite', screenshot: 'screen', proof: 'proof' };

  const isPlace = $derived(row.kind === 'place');
  const isProof = $derived(row.kind === 'proof');
  // A proof borrows the point of the capture it composes, so `All` marks that
  // capture instead of stacking a second mark on it.
  const worked = $derived(row.proofs > 0 ? `${row.proofs} proof${row.proofs > 1 ? 's' : ''} built here` : null);
  const flyable = $derived(row.lat != null && row.lon != null);
  // a screenshot with no position can only be reopened where it came from
  const opensSource = $derived(!flyable && !!row.source_url);
  // one string, ellipsized as a whole: truncating bit by bit leaves stubs like
  // "· … ·" in a 300px panel
  const meta = $derived(
    [row.zoom != null ? `z${Math.round(row.zoom)}` : null, row.provider ?? row.site, row.imagery_date]
      .filter(Boolean)
      .join(' · ')
  );
  const blocked = $derived(fullscreen ? 'Exit fullscreen first. This leaves the map' : null);
  const proposed = $derived(row.status === 'suggested');
</script>

<div
  class="row"
  class:dense
  class:active
  class:hovered
  class:draggable
  data-saved-id={row.key ?? row.id}
  {draggable}
  ondragstart={draggable ? ondragstart : undefined}
  onmouseenter={() => onhover(row.key ?? row.id)}
  onmouseleave={() => onhover(null)}
  role="presentation"
>
  <button
    type="button"
    class="open"
    disabled={!flyable && !opensSource}
    title={opensSource
      ? `Open the source page (${row.site ?? 'external map'})`
      : flyable
        ? 'Fly the map to this point'
        : 'No coordinates recorded'}
    onclick={() => onopen(row)}
  >
    <span class="thumb">
      {#if row.thumbnail && caseId}
        <img src={fileUrl(caseId, row.thumbnail)} alt="" loading="lazy" decoding="async" />
      {:else}
        <Icon name={GLYPH[row.kind] ?? 'pin'} size={dense ? 16 : 14} />
      {/if}
      {#if row.thumbnail}
        <span class="badge"><Icon name={GLYPH[row.kind] ?? 'pin'} size={9} /></span>
      {/if}
      {#if worked}<span class="worked" role="img" aria-label={worked} title={worked}></span>{/if}
    </span>
    <span class="text">
      <!-- A proof arguing three points is three rows under one title. What the
           analyst called each point is what tells them apart. -->
      <span class="title">{row.title || 'Untitled'}{#if row.label}<span class="point">· {row.label}</span>{/if}</span>
      <span class="sub">
        <!-- a screenshot filed from a URL that carried no position has none:
             say so rather than printing 0°, 0° -->
        {#if flyable}<span class="mono">{coords(row)}</span>{:else}<span>No coordinates</span>{/if}
        {#if meta}<span class="bits">{meta}</span>{/if}
        <!-- a point a tool proposed: a file's own metadata, or a capture filed
             while the analyst was not accepting them on the spot -->
        {#if proposed}
          <span class="proposed" title="Proposed by a tool, waiting for you">suggested</span>
        {/if}
      </span>
      {#if row.notes}<span class="note">{row.notes}</span>{/if}
    </span>
  </button>

  <div class="actions">
    <!-- Accepting is offered where the point is read, not only in the sidebar:
         the analyst is looking at the map that decides whether the point is
         right, and sending them to another panel to say so is the trip this
         saves. -->
    {#if proposed && onaccept}
      <button class="act accept" title="Accept this point" onclick={() => onaccept(row)}>
        <Icon name="check" size={13} />
      </button>
    {/if}
    {#if isProof}
      <!-- a proof is edited and deleted in the composer that owns it; here it
           is a point on the map, and the one thing to do with it is open it -->
      <button
        class="act"
        disabled={fullscreen}
        title={blocked ?? 'Open in Geo Proof'}
        onclick={() => onproof(row)}
      ><Icon name="proof" size={13} /></button>
    {:else}
      {#if row.source_url}
        <a
          class="act"
          class:disabled={fullscreen}
          href={fullscreen ? undefined : row.source_url}
          target="_blank"
          rel="noreferrer"
          aria-disabled={fullscreen}
          title={blocked ?? `Open the source page (${row.site ?? 'external map'})`}
        ><Icon name="external" size={13} /></a>
      {/if}
      <button class="act" title="Edit title & note" onclick={() => onedit(row)}>
        <Icon name="note" size={13} />
      </button>
      {#if !isPlace}
        <button
          class="act"
          disabled={fullscreen}
          title={blocked ?? 'Send to Geo Proof'}
          onclick={() => onproof(row)}
        ><Icon name="proof" size={13} /></button>
      {/if}
      <button class="act danger" title="Delete" onclick={() => ondelete(row)}>
        <Icon name="trash" size={13} />
      </button>
    {/if}
  </div>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: stretch;
    border-radius: var(--r-sm);
  }
  .row:hover,
  .row.hovered {
    background: var(--bg-2);
  }
  .row.active {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .row.draggable {
    cursor: grab;
  }
  .open {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open:disabled {
    cursor: default;
  }
  /* one fixed frame for every kind, so titles and coordinates stay on a grid
     whether the item has an image or not */
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 40px;
    height: 28px;
    border-radius: 2px;
    background: var(--bg-3);
    color: var(--text-3);
    overflow: hidden;
  }
  .dense .thumb {
    width: 56px;
    height: 40px;
  }
  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .badge {
    position: absolute;
    right: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    padding: 1px 2px;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    border-top-left-radius: 2px;
  }
  /* one dot however many proofs: the row says "already worked", the popup
     says how many */
  .worked {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .title {
    font-size: var(--fs-sm);
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title .point { margin-left: 5px; color: var(--text-3); }
  .open:hover:not(:disabled) .title {
    color: var(--accent);
  }
  .sub {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    white-space: nowrap;
  }
  .bits {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bits::before {
    content: '·';
    margin-right: 6px;
    color: var(--border-strong);
  }
  .proposed {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: color-mix(in srgb, var(--accent) 85%, var(--text-2));
    font-size: 9px;
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* actions ride on top of the row's right edge: they cost no layout until
     they are wanted, and a 300px panel has none to spare */
  .actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 4px 0 16px;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(to right, transparent, var(--bg-2) 16px);
    border-radius: var(--r-sm);
  }
  .row:hover .actions,
  .row:focus-within .actions,
  .row.hovered .actions {
    opacity: 1;
    pointer-events: auto;
  }
  .row.active .actions {
    background: linear-gradient(to right, transparent, var(--bg-2) 16px);
  }
  .act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    cursor: pointer;
  }
  .act:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .act.danger:hover {
    color: var(--danger);
  }
  .act.accept {
    color: var(--accent);
  }
  .act.disabled,
  .act:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .act.disabled:hover,
  .act:disabled:hover {
    color: var(--text-3);
    background: none;
  }
</style>
