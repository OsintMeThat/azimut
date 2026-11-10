<script>
  /**
   * Where Post opens with no post open, in place of the composer, in the manner of Geo
   * Proof's home: **New post** and a search that finds a draft by name and opens it, then
   * three parts. **In progress**, the drafts not gone out yet or changed since, each with
   * its platform and how many posts it holds; **Ready to post**, the proofs no draft names
   * yet and the videos whose slides wait, one press starting the right post; and
   * **Posted**, the latest to go out, with their link (`postHome.js`). Every post card
   * wears its state as a pill, and its ⋯ or a right-click opens and deletes it.
   *
   * The composer decides when this shows: a case holding no draft and no proof keeps the
   * composer as it always was. Both lists arrive from the composer, null while read.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { timeAgo } from '../../lib/analysisViews.js';
  import { slideTag } from '../../lib/proofList.js';
  import { sceneColorAt } from '../../lib/scenes.js';
  import { postKind, STARTABLE_POST_KINDS } from '../../lib/post.js';
  import {
    draftLine, draftPicture, draftPill, findDrafts, homeDrafts, readyToPost, recentDrafts, shortLink,
  } from './postHome.js';

  let {
    caseId = '',
    /** The case's drafts as `GET /drafts` lists them, newest first, or null before the first read. */
    drafts = null,
    /** The case's proofs as `GET /proofs` lists them, or null before the first read. */
    proofs = null,
    /** The case's media by path (`kind`, `thumbnail`), for the pictures of posts that carry no proof. */
    media = new Map(),
    onnew,
    /** `(draft)`: open this draft. */
    onopen,
    /** The Open list, every draft. */
    onall,
    /** `(row)`: start a Geolocation post of this proof. */
    onproof,
    /** `(draft)`: ask to delete this post (the composer holds the dialog). */
    ondelete,
  } = $props();

  let query = $state('');

  const loading = $derived(drafts === null || proofs === null);
  const parts = $derived(homeDrafts(drafts ?? []));
  const recent = $derived(recentDrafts(parts.progress));
  const posted = $derived(recentDrafts(parts.posted));
  const found = $derived(findDrafts(drafts ?? [], query).slice(0, 8));
  const ready = $derived(readyToPost(proofs ?? [], drafts ?? []));
  const threads = STARTABLE_POST_KINDS.includes('video');

  function find(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (found[0]) onopen?.(found[0]);
  }

  const picture = (draft) => draftPicture(draft, proofs, media);

  // A card's ⋯, under it or at the pointer for a right-click.
  let menu = $state(null); // { draft, anchor?, at? }
  function openMenu(draft, anchor) {
    menu = menu?.draft === draft ? null : { draft, anchor };
  }
  function context(event, draft) {
    event.preventDefault();
    menu = { draft, at: { x: event.clientX, y: event.clientY } };
  }
  function act(what) {
    const { draft } = menu;
    menu = null;
    if (what === 'open') onopen?.(draft);
    else if (what === 'delete') ondelete?.(draft);
  }
</script>

{#snippet draftPic(draft)}
  {@const pic = picture(draft)}
  {#if pic}
    <img src={fileUrl(caseId, pic)} alt="" loading="lazy" decoding="async" />
  {:else}
    <Icon name={postKind(draft.kind).icon} size={24} />
  {/if}
{/snippet}

{#snippet postCard(draft)}
  {@const pill = draftPill(draft)}
  <div class="ph-card post-card" role="presentation" oncontextmenu={(event) => context(event, draft)}>
    <button type="button" class="ph-open" onclick={() => onopen?.(draft)} title={`Open ${draft.title}`}>
      <span class="ph-pic">
        {@render draftPic(draft)}
        <span class="ph-pill {pill.state}">{pill.label}</span>
      </span>
      <span class="ph-card-words">
        <span class="ph-title" dir="auto">{draft.title}</span>
        <span class="ph-said"><span class="ph-line">{draftLine(draft)}</span><span class="ph-when">{timeAgo(pill.state === 'posted' ? draft.posted?.at ?? draft.updated_at : draft.updated_at)}</span></span>
      </span>
    </button>
    {#if draft.posted?.url}
      <a class="ph-out" href={draft.posted.url} target="_blank" rel="noreferrer" title="Open the post">
        <Icon name="external" size={11} /><span>{shortLink(draft.posted.url)}</span>
      </a>
    {/if}
    <button type="button" class="ph-more" aria-label={`More for ${draft.title}`} title="Open or delete this post" aria-haspopup="menu"
      aria-expanded={menu?.draft === draft} onclick={(event) => openMenu(draft, event.currentTarget)}>
      <Icon name="more" size={13} stroke={2.6} />
    </button>
  </div>
{/snippet}

<div class="ph" data-testid="post-home">
  <div class="ph-col">
    <div class="ph-start">
      <button type="button" class="btn btn-primary ph-new" onclick={() => onnew?.()}><Icon name="plus" size={14} /> New post</button>
      <label class="ph-find">
        <Icon name="search" size={15} />
        <input bind:value={query} onkeydown={find} placeholder="Find a draft by name…" aria-label="Find a draft by name" />
        {#if query}
          <button type="button" class="ph-clear" aria-label="Clear search" title="Clear search" onclick={() => (query = '')}><Icon name="x" size={12} /></button>
        {/if}
      </label>
    </div>

    {#if query.trim()}
      <div class="ph-found" role="group" aria-label="Drafts found">
        {#each found as draft, i (draft.name)}
          <button type="button" class="ph-hit" class:first={i === 0} onclick={() => onopen?.(draft)}
            title={i === 0 ? `Open ${draft.title} (Enter)` : `Open ${draft.title}`}>
            <span class="ph-hit-pic">{@render draftPic(draft)}</span>
            <span class="ph-hit-title" dir="auto">{draft.title}</span>
            <span class="ph-pill flat {draftPill(draft).state}">{draftPill(draft).label}</span>
            <span class="ph-said">{draftLine(draft)}</span>
            <span class="ph-when">{timeAgo(draft.updated_at)}</span>
          </button>
        {:else}
          <p class="ph-none">No draft by that name.</p>
        {/each}
      </div>
    {:else}
      {#if recent.length}
        <div class="ph-head">
          <h4>In progress</h4>
          {#if parts.progress.length > recent.length}
            <button type="button" class="ph-link" onclick={() => onall?.()}>All {parts.progress.length} in progress</button>
          {/if}
        </div>
        <div class="ph-cards" data-part="progress">
          {#each recent as draft (draft.name)}{@render postCard(draft)}{/each}
        </div>
      {:else if loading}
        <div class="ph-head"><h4>In progress</h4></div>
        <div class="ph-cards" aria-busy="true">
          {#each [0, 1, 2] as n (n)}<span class="ph-card ghost"><span class="ph-pic"></span><span class="ph-card-words"><span class="ph-bar"></span></span></span>{/each}
        </div>
      {/if}

      {#if ready.photos.length || ready.videos.length}
        <div class="ph-head">
          <h4>Ready to post</h4>
          <span class="ph-count">No post yet</span>
        </div>
        {#if ready.photos.length}
          <div class="ph-cards">
            {#each ready.photos as row (row.name)}
              <button type="button" class="ph-card" onclick={() => onproof?.(row)} title={`Write the geolocation post of ${row.title}`}>
                <span class="ph-pic">
                  {#if row.thumb || row.png}<img src={fileUrl(caseId, row.thumb ?? row.png)} alt="" loading="lazy" decoding="async" />{:else}<Icon name="proof" size={26} />{/if}
                </span>
                <span class="ph-card-words">
                  <span class="ph-title" dir="auto">{row.title}</span>
                  <span class="ph-said"><span class="ph-line"><Icon name="crosshair" size={11} /> Geolocation</span><span class="ph-when">{timeAgo(row.updated_at)}</span></span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
        {#if ready.videos.length}
          <div class="ph-videos">
            {#each ready.videos as series (series.video)}
              <div class="ph-video">
                <div class="ph-video-head">
                  <span class="ph-video-icon"><Icon name="video" size={15} /></span>
                  <h5 dir="auto">{series.title}</h5>
                  <span class="ph-count">{series.count} {series.count === 1 ? 'slide' : 'slides'}</span>
                  <button type="button" class="btn btn-sm ph-series" disabled={!threads}
                    title={threads ? `Post the slides of ${series.title} as one thread` : 'The video thread comes in the next update'}>
                    <Icon name="video" size={13} /> Video thread
                    {#if !threads}<span class="ph-soon">Coming next</span>{/if}
                  </button>
                </div>
                {#if series.slides.length}
                  <div class="ph-chips">
                    {#each series.slides as row (row.name)}
                      {@const tag = slideTag(row, { short: true })}
                      <button type="button" class="ph-chip" style:--scene={sceneColorAt(row.order)} onclick={() => onproof?.(row)}
                        title={`Write the geolocation post of ${row.title}`}>
                        <span class="ph-chip-pic">{#if row.thumb || row.png}<img src={fileUrl(caseId, row.thumb ?? row.png)} alt="" loading="lazy" decoding="async" />{/if}</span>
                        <span class="ph-dot" aria-hidden="true"></span>
                        <span class="ph-chip-name" dir="auto">{row.title}</span>
                        {#if tag?.where}<span class="ph-chip-time">{tag.where}</span>{/if}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      {#if posted.length}
        <div class="ph-head">
          <h4>Posted</h4>
          {#if parts.posted.length > posted.length}
            <button type="button" class="ph-link" onclick={() => onall?.()}>All {parts.posted.length} posted</button>
          {:else}
            <span class="ph-count">The latest first</span>
          {/if}
        </div>
        <div class="ph-cards" data-part="posted">
          {#each posted as draft (draft.name)}{@render postCard(draft)}{/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if menu}
  {@const draft = menu.draft}
  <FloatingMenu anchor={menu.anchor ?? null} at={menu.at ?? null} width={220} label={draft.title} onclose={() => (menu = null)}>
    <p class="fm-head" dir="auto">{draft.title}</p>
    <button type="button" class="fm-item" onclick={() => act('open')}><Icon name="folderOpen" size={14} /><span class="fm-grow">Open</span></button>
    {#if draft.posted?.url}
      <a class="fm-item" href={draft.posted.url} target="_blank" rel="noreferrer" onclick={() => (menu = null)}>
        <Icon name="external" size={14} /><span class="fm-grow">See the post</span></a>
    {/if}
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" title="Send it to the Trash, from where it can be restored" onclick={() => act('delete')}>
      <Icon name="trash" size={14} /><span class="fm-grow">Delete…</span></button>
  </FloatingMenu>
{/if}

<style>
  .ph {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.07) 1px, transparent 0) 0 0 / 22px 22px,
      var(--bg-0);
  }
  .ph-col { max-width: 1060px; margin: 0 auto; padding: 26px 28px 44px; }

  .ph-start { display: flex; align-items: center; gap: 14px; }
  .ph-new { flex: none; height: 36px; padding: 0 16px; font-size: var(--fs-sm); }
  .ph-find {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 520px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    color: var(--text-3);
  }
  .ph-find:focus-within { border-color: var(--accent); }
  .ph-find input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-1); font: inherit; font-size: var(--fs-sm); }
  .ph-clear { display: flex; color: var(--text-3); }
  .ph-clear:hover { color: var(--text-1); }

  .ph-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 24px 0 10px; }
  h4 { margin: 0; color: var(--text-3); font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; }
  .ph-count { color: var(--text-3); font-size: var(--fs-xs); }
  .ph-link { color: var(--text-2); font-size: var(--fs-xs); }
  .ph-link:hover { color: var(--accent); }

  .ph-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(186px, 1fr)); gap: 12px; }
  .ph-cards + .ph-videos { margin-top: 12px; }
  .ph-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    text-align: left;
    transition: border-color 0.14s var(--ease), transform 0.14s var(--ease), box-shadow 0.14s var(--ease);
  }
  .ph-card:not(.ghost):hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-2); }
  .ph-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* a post card: the press that opens it, its link once posted, and its ⋯ */
  .post-card { position: relative; }
  .ph-open { display: flex; flex-direction: column; min-width: 0; padding: 0; text-align: left; }
  .ph-open:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-lg); }
  .ph-more {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--bg-0) 72%, transparent);
    color: var(--text-1);
    opacity: 0;
    transition: opacity 0.12s var(--ease);
  }
  .post-card:hover .ph-more, .ph-more:focus-visible, .ph-more[aria-expanded='true'] { opacity: 1; }
  .ph-more:hover { background: var(--bg-3); }
  @media (hover: none) { .ph-more { opacity: 1; } }
  .ph-out {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin: -3px 10px 9px;
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .ph-out span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ph-out:hover { color: var(--accent); }
  .ph-out :global(svg) { flex: none; }
  .ph-pic { position: relative; }
  .ph-pill {
    position: absolute;
    top: 7px;
    left: 7px;
    max-width: calc(100% - 44px);
    overflow: hidden;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-0) 82%, transparent);
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-shadow: 0 0 0 1px var(--border);
  }
  .ph-pill.flat { position: static; flex: none; box-shadow: none; background: var(--bg-3); }
  .ph-pill.opened { background: color-mix(in srgb, var(--accent) 22%, var(--bg-0)); color: var(--accent); box-shadow: none; }
  .ph-pill.posted { background: color-mix(in srgb, var(--ok) 22%, var(--bg-0)); color: var(--ok); box-shadow: none; }
  .ph-pill.changed { background: color-mix(in srgb, var(--warn) 24%, var(--bg-0)); color: var(--warn); box-shadow: none; }
  .ph-pic {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-0) 70%, #000);
    color: var(--text-3);
  }
  .ph-pic img { width: 100%; height: 100%; object-fit: contain; }
  .ph-card-words { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px 9px; min-width: 0; }
  .ph-title { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-said { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .ph-line { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ph-when { flex: none; color: var(--text-3); font-size: var(--fs-xs); margin-left: auto; }
  .ghost .ph-pic { background: var(--bg-2); }
  .ph-bar { width: 60%; height: 10px; border-radius: 3px; background: var(--bg-3); }
  .ghost { animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: 0.55; } }
  @media (prefers-reduced-motion: reduce) { .ghost { animation: none; } }

  .ph-videos { display: flex; flex-direction: column; gap: 10px; }
  .ph-video {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
  }
  .ph-video-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .ph-video-icon { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
  h5 { margin: 0; min-width: 0; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .ph-series { margin-left: auto; flex: none; gap: 6px; }
  .ph-soon {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 600;
  }
  .ph-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ph-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    height: 30px;
    padding: 0 10px 0 3px;
    border: 1px solid color-mix(in srgb, var(--scene) 45%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--scene) 9%, var(--bg-1));
    color: var(--text-1);
    font-size: var(--fs-xs);
    transition: background-color 0.12s var(--ease), border-color 0.12s var(--ease);
  }
  .ph-chip:hover { border-color: var(--scene); background: color-mix(in srgb, var(--scene) 18%, var(--bg-1)); }
  .ph-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ph-chip-pic { flex: none; width: 36px; height: 22px; overflow: hidden; border-radius: 999px; background: var(--bg-3); }
  .ph-chip-pic img { width: 100%; height: 100%; object-fit: cover; }
  .ph-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--scene, var(--accent)); }
  .ph-chip-name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-chip-time { flex: none; color: var(--text-2); font-variant-numeric: tabular-nums; }

  .ph-found { display: flex; flex-direction: column; gap: 4px; margin-top: 16px; max-width: 680px; }
  .ph-hit {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px 6px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    text-align: left;
  }
  .ph-hit:hover, .ph-hit.first { border-color: var(--accent); }
  .ph-hit-pic { display: grid; place-items: center; flex: none; width: 64px; height: 40px; overflow: hidden; border-radius: var(--r-sm); background: var(--bg-3); color: var(--text-3); }
  .ph-hit-pic img { width: 100%; height: 100%; object-fit: cover; }
  .ph-hit-title { min-width: 0; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-none { margin: 10px 4px; color: var(--text-3); font-size: var(--fs-sm); }
</style>
