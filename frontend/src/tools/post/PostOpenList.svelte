<script>
  /**
   * Post's Open: every post of the case, in the manner of Geo Proof's Open proof. Each
   * row shows its picture, its name, its kind, its platform, where it stands and when it
   * was last saved; a search and a filter by kind and by state narrow it once it holds
   * more than one of either (`postHome.js` `postFacets`, `filterPosts`). A press opens a
   * post, a posted one's buttons copy its link and open it, and the bin asks to delete it,
   * the composer holding the dialog.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import { copyText } from '../../lib/clipboard.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { postKind, postTarget } from '../../lib/post.js';
  import { byListedDate, draftPicture, draftPill, filterPosts, labelledDrafts, listedWhen, postFacets } from './postHome.js';

  let {
    caseId = '',
    /** `GET /drafts` as it lists them, newest first. */
    drafts = [],
    /** True while the list is read, so the dialog stands on the press. */
    loading = false,
    proofs = null,
    media = new Map(),
    /** `(draft)`: open it. */
    onopen,
    /** `(draft)`: ask to delete it. */
    ondelete,
    onclose,
  } = $props();

  let query = $state('');
  let kind = $state('');
  let state = $state('');

  const facets = $derived(postFacets(drafts));
  // each with its label, its name or where and when it is about (`postLabel`)
  const labelled = $derived(labelledDrafts(drafts, proofs ?? []));
  // newest first by the day a post went out, else its last change (`listedWhen`)
  const shown = $derived(byListedDate(filterPosts(labelled, { query, kind, state })));
  // a filter whose last post went (a delete) lets go, rather than show nothing
  $effect(() => {
    if (kind && !facets.kinds.some((one) => one.id === kind)) kind = '';
    if (state && !facets.states.some((one) => one.id === state)) state = '';
  });
  const narrowing = $derived(drafts.length > 1);
  // a posted row's link buttons keep their place on every row, so the pills line up
  const links = $derived(shown.some((draft) => draft.posted?.url));
</script>

<Modal title="Open a post" width="640px" {onclose}>
  {#if !drafts.length && loading}
    <p class="ol-note" aria-busy="true">Reading the posts…</p>
  {:else if !drafts.length}
    <div class="empty"><p>No posts in this case yet.</p></div>
  {:else}
    {#if narrowing}
      <div class="ol-filters">
        <SearchInput bind:value={query} placeholder="Search by name or place, or paste a post's link…" width="100%" />
        {#if facets.kinds.length > 1}
          <select class="input" aria-label="Kind" title="Only the posts of one kind" value={kind} onchange={(event) => (kind = event.currentTarget.value)}>
            <option value="">Every kind</option>
            {#each facets.kinds as one (one.id)}<option value={one.id}>{one.label} · {one.count}</option>{/each}
          </select>
        {/if}
        {#if facets.states.length > 1}
          <select class="input" aria-label="State" title="Only the posts that stand there" value={state} onchange={(event) => (state = event.currentTarget.value)}>
            <option value="">Every state</option>
            {#each facets.states as one (one.id)}<option value={one.id}>{one.label} · {one.count}</option>{/each}
          </select>
        {/if}
      </div>
    {/if}
    {#if !shown.length}
      <p class="ol-note">No post matches.</p>
    {:else}
      <div class="ol-rows">
        {#each shown as draft (draft.name)}
          {@const picture = draftPicture(draft, proofs, media)}
          {@const pill = draftPill(draft)}
          <div class="ol-row">
            <button type="button" class="ol-open" onclick={() => onopen?.(draft)} title={`Open ${draft.label}`}>
              <span class="ol-pic dark-surface">
                {#if picture}
                  <img src={fileUrl(caseId, picture)} alt="" loading="lazy" decoding="async" />
                {:else}
                  <Icon name={postKind(draft.kind).icon} size={18} />
                {/if}
              </span>
              <span class="ol-words">
                <span class="ol-title" dir="auto">{draft.label}</span>
                <span class="ol-sub">{postKind(draft.kind).label} · {postTarget(draft.target).label} · {String(listedWhen(draft)).slice(0, 10)}</span>
              </span>
              <span class="ol-pill {pill.state}">{pill.label}</span>
            </button>
            {#if draft.posted?.url}
              <button type="button" class="btn btn-ghost btn-sm ol-act" aria-label={`Copy the link of ${draft.label}`} title="Copy the post's link"
                onclick={() => copyText(draft.posted.url, { said: 'Link copied' })}>
                <Icon name="copy" size={13} />
              </button>
              <a class="btn btn-ghost btn-sm ol-act" href={draft.posted.url} target="_blank" rel="noreferrer"
                aria-label={`Open the post of ${draft.label}`} title="Open the post">
                <Icon name="external" size={13} />
              </a>
            {:else if links}
              <span class="ol-act" aria-hidden="true"></span>
              <span class="ol-act" aria-hidden="true"></span>
            {/if}
            <button type="button" class="btn btn-ghost btn-sm ol-act ol-del" aria-label={`Delete ${draft.label}`} title="Delete this post"
              onclick={() => ondelete?.(draft)}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</Modal>

<style>
  .ol-note { margin: 4px 0; color: var(--text-3); font-size: var(--fs-sm); }
  .ol-filters { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .ol-filters :global(.search-box) { flex: 1; min-width: 0; }
  .ol-filters select { flex: none; width: auto; max-width: 190px; }
  .ol-rows { display: flex; flex-direction: column; gap: 6px; max-height: min(60vh, 520px); overflow-y: auto; }
  .ol-row { display: flex; align-items: center; gap: 4px; }
  .ol-open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 6px 10px 6px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    text-align: left;
  }
  .ol-open:hover { border-color: var(--accent); }
  .ol-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ol-pic {
    display: grid;
    place-items: center;
    flex: none;
    width: 72px;
    height: 45px;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--bg-0) 70%, #000);
    color: var(--text-3);
  }
  /* a picture as Post's and Geo Proof's homes show it: whole, on dark in both themes */
  .ol-pic img { width: 100%; height: 100%; object-fit: contain; }
  .ol-words { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
  .ol-title { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ol-sub { overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .ol-pill {
    flex: none;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 650;
    white-space: nowrap;
  }
  .ol-pill.posted { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
  .ol-pill.changed { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
  .ol-act { flex: none; justify-content: center; width: 28px; padding-inline: 0; color: var(--text-2); }
  a.ol-act { text-decoration: none; }
  .ol-del { color: var(--danger); }
</style>
