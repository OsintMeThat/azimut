<script>
  /**
   * Where Post opens with no post open, in place of the composer, in the manner of Geo
   * Proof's home: **New post** and a search that finds a draft by name and opens it;
   * **Drafts**, the last ones saved, each with its platform and how many posts it holds;
   * and **Ready to post**, the proofs no draft names yet and the videos whose slides wait,
   * one press starting the right post (`postHome.js` says what has a post yet).
   *
   * The composer decides when this shows: a case holding no draft and no proof keeps the
   * composer as it always was. Both lists arrive from the composer, null while read.
   */
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { timeAgo } from '../../lib/analysisViews.js';
  import { slideTag } from '../../lib/proofList.js';
  import { sceneColorAt } from '../../lib/scenes.js';
  import { postKind, STARTABLE_POST_KINDS } from '../../lib/post.js';
  import { draftLine, draftPicture, findDrafts, readyToPost, recentDrafts } from './postHome.js';

  let {
    caseId = '',
    /** The case's drafts as `GET /drafts` lists them, newest first, or null before the first read. */
    drafts = null,
    /** The case's proofs as `GET /proofs` lists them, or null before the first read. */
    proofs = null,
    onnew,
    /** `(draft)`: open this draft. */
    onopen,
    /** The Open list, every draft. */
    onall,
    /** `(row)`: start a Geolocation post of this proof. */
    onproof,
  } = $props();

  let query = $state('');

  const loading = $derived(drafts === null || proofs === null);
  const recent = $derived(recentDrafts(drafts ?? []));
  const found = $derived(findDrafts(drafts ?? [], query).slice(0, 8));
  const ready = $derived(readyToPost(proofs ?? [], drafts ?? []));
  const threads = STARTABLE_POST_KINDS.includes('video');

  function find(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (found[0]) onopen?.(found[0]);
  }

  const picture = (draft) => draftPicture(draft, proofs);
</script>

{#snippet draftPic(draft)}
  {@const pic = picture(draft)}
  {#if pic}
    <img src={fileUrl(caseId, pic)} alt="" loading="lazy" decoding="async" />
  {:else}
    <Icon name={postKind(draft.kind).icon} size={24} />
  {/if}
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
          <h4>Drafts</h4>
          {#if (drafts?.length ?? 0) > recent.length}
            <button type="button" class="ph-link" onclick={() => onall?.()}>All {drafts.length} drafts</button>
          {/if}
        </div>
        <div class="ph-cards">
          {#each recent as draft (draft.name)}
            <button type="button" class="ph-card" onclick={() => onopen?.(draft)} title={`Open ${draft.title}`}>
              <span class="ph-pic">{@render draftPic(draft)}</span>
              <span class="ph-card-words">
                <span class="ph-title" dir="auto">{draft.title}</span>
                <span class="ph-said"><span class="ph-line">{draftLine(draft)}</span><span class="ph-when">{timeAgo(draft.updated_at)}</span></span>
              </span>
            </button>
          {/each}
        </div>
      {:else if loading}
        <div class="ph-head"><h4>Drafts</h4></div>
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
    {/if}
  </div>
</div>

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
