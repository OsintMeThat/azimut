<script>
  /**
   * Where Geo Proof opens with no proof open, in place of the canvas: a large **New proof**
   * and a search that finds a proof by name and opens it; **Continue**, the last proofs
   * saved as large thumbnails, a proof of a video tagged `clip.mp4 · 2/4` in its scene's
   * colour; and **To prove**, only when the case has scenes still to prove, one card per
   * video with its scenes as chips. A chip starts Make the proof.
   *
   * A case holding no proof and no scene shows the button and one sentence. What it
   * shows is read once as the home comes up (`GET /proofs`) and the scene queue the app
   * already keeps, so it opens on what it held last while that read runs.
   */
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { timeAgo } from '../../lib/analysisViews.js';
  import { findProofs, recentProofs, slideTag } from '../../lib/proofList.js';
  import { captureCount, queueColor, queueName, queueState, queueTime, waitingWords } from '../../lib/sceneQueue.js';

  let {
    caseId = '',
    /** The saved proofs, newest first, as `GET /proofs` lists them, or null before the first read. */
    proofs = null,
    /** The files holding scenes still to prove, the abandoned left out (`openScenes`). */
    files = [],
    /** The scene being geolocated now, `{ video, id }`, or null. */
    live = null,
    /** A case file's thumbnail path, or null: a video's, for its card. */
    thumbOf = () => null,
    onnew,
    /** `(entry)`: open this proof. */
    onopen,
    /** The Open proof list, every proof with its folders. */
    onall,
    /** `(file, scene)`: Make the proof of this scene. */
    onscene,
  } = $props();

  let query = $state('');

  const recent = $derived(recentProofs(proofs ?? []));
  const found = $derived(findProofs(proofs ?? [], query).slice(0, 8));
  const empty = $derived(proofs !== null && !proofs.length && !files.length);
  const waiting = $derived(files.reduce((n, file) => n + file.scenes.length, 0));

  function find(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (found[0]) onopen?.(found[0]);
  }

  const sceneTip = (scene) => {
    const n = captureCount(scene);
    return `Make the proof of ${queueName(scene)}${n ? `, ${n === 1 ? '1 capture' : `${n} captures`} gathered` : ''}`;
  };
</script>

{#snippet tag(entry, short)}
  {@const said = slideTag(entry, { short })}
  {#if said}<span class="ph-tag" style:--scene={said.color}><span class="ph-dot" aria-hidden="true"></span>{said.text}</span>{/if}
{/snippet}

<div class="ph" data-testid="proof-home">
  {#if empty}
    <div class="ph-empty">
      <span class="ph-mark" aria-hidden="true"><Icon name="proof" size={34} /></span>
      <p>A proof lays pictures side by side and marks where they match.</p>
      <button type="button" class="btn btn-primary ph-new" onclick={() => onnew?.()}><Icon name="plus" size={17} /> New proof</button>
    </div>
  {:else}
    <div class="ph-col">
      <div class="ph-start">
        <button type="button" class="btn btn-primary ph-new" onclick={() => onnew?.()}><Icon name="plus" size={17} /> New proof</button>
        <label class="ph-find">
          <Icon name="search" size={15} />
          <input bind:value={query} onkeydown={find} placeholder="Find a proof by name…" aria-label="Find a proof by name" />
          {#if query}
            <button type="button" class="ph-clear" aria-label="Clear search" title="Clear search" onclick={() => (query = '')}><Icon name="x" size={12} /></button>
          {/if}
        </label>
      </div>

      {#if query.trim()}
        <div class="ph-found" role="group" aria-label="Proofs found">
          {#each found as entry, i (entry.name)}
            <button type="button" class="ph-hit" class:first={i === 0} onclick={() => onopen?.(entry)}
              title={i === 0 ? `Open ${entry.title} (Enter)` : `Open ${entry.title}`}>
              <span class="ph-hit-pic">{#if entry.thumb || entry.png}<img src={fileUrl(caseId, entry.thumb ?? entry.png)} alt="" loading="lazy" decoding="async" />{/if}</span>
              <span class="ph-hit-title" dir="auto">{entry.title}</span>
              {@render tag(entry, false)}
              <span class="ph-when">{timeAgo(entry.updated_at)}</span>
            </button>
          {:else}
            <p class="ph-none">No proof by that name.</p>
          {/each}
        </div>
      {:else}
        {#if recent.length}
          <div class="ph-head">
            <h4>Continue</h4>
            {#if (proofs?.length ?? 0) > recent.length}
              <button type="button" class="ph-link" onclick={() => onall?.()}>All {proofs.length} proofs</button>
            {/if}
          </div>
          <div class="ph-cards">
            {#each recent as entry (entry.name)}
              <button type="button" class="ph-card" onclick={() => onopen?.(entry)} title={`Open ${entry.title}`}>
                <span class="ph-pic">
                  {#if entry.thumb || entry.png}
                    <img src={fileUrl(caseId, entry.thumb ?? entry.png)} alt="" loading="lazy" decoding="async" />
                  {:else}
                    <Icon name="proof" size={26} />
                  {/if}
                </span>
                <span class="ph-card-words">
                  <span class="ph-title" dir="auto">{entry.title}</span>
                  <span class="ph-said">{@render tag(entry, true)}<span class="ph-when">{timeAgo(entry.updated_at)}</span></span>
                </span>
              </button>
            {/each}
          </div>
        {:else if proofs === null}
          <div class="ph-head"><h4>Continue</h4></div>
          <div class="ph-cards" aria-busy="true">
            {#each [0, 1, 2] as n (n)}<span class="ph-card ghost"><span class="ph-pic"></span><span class="ph-card-words"><span class="ph-bar"></span></span></span>{/each}
          </div>
        {/if}

        {#if files.length}
          <div class="ph-head">
            <h4>To prove</h4>
            <span class="ph-count">{waitingWords(waiting)}</span>
          </div>
          <div class="ph-videos">
            {#each files as file (file.video)}
              {@const thumb = thumbOf(file.video)}
              <div class="ph-video">
                <span class="ph-video-pic">
                  {#if thumb}<img src={fileUrl(caseId, thumb)} alt="" loading="lazy" decoding="async" />{:else}<Icon name={file.kind === 'image' ? 'image' : 'video'} size={20} />{/if}
                </span>
                <div class="ph-video-words">
                  <h5 dir="auto">{file.title}</h5>
                  <div class="ph-chips">
                    {#each file.scenes as scene (scene.id)}
                      {@const now = live?.video === file.video && live?.id === scene.id}
                      <button type="button" class="ph-chip" class:live={now} style:--scene={queueColor(scene)} title={sceneTip(scene)}
                        onclick={() => onscene?.(file, scene)}>
                        <span class="ph-dot" aria-hidden="true"></span>
                        <span class="ph-chip-name" dir="auto">{queueName(scene)}</span>
                        {#if scene.label}<span class="ph-chip-time">{queueTime(scene)}</span>{/if}
                        <span class="ph-chip-state">{queueState(scene, now)}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ph {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    z-index: 2;
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.07) 1px, transparent 0) 0 0 / 22px 22px,
      var(--bg-0);
  }
  .ph-col { max-width: 1060px; margin: 0 auto; padding: 34px 28px 48px; }

  .ph-start { display: flex; align-items: center; gap: 14px; }
  .ph-new { flex: none; height: 44px; padding: 0 22px; border-radius: var(--r-lg); font-size: var(--fs-md); box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 22%, transparent); }
  .ph-find {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 520px;
    height: 44px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    color: var(--text-3);
  }
  .ph-find:focus-within { border-color: var(--accent); }
  .ph-find input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-1); font: inherit; font-size: var(--fs-md); }
  .ph-clear { display: flex; color: var(--text-3); }
  .ph-clear:hover { color: var(--text-1); }

  .ph-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 30px 0 10px; }
  h4 { margin: 0; color: var(--text-3); font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; }
  .ph-count { color: var(--text-3); font-size: var(--fs-xs); }
  .ph-link { color: var(--text-2); font-size: var(--fs-xs); }
  .ph-link:hover { color: var(--accent); }

  .ph-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
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
  .ph-card-words { display: flex; flex-direction: column; gap: 5px; padding: 10px 12px 11px; min-width: 0; }
  .ph-title { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-said { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .ph-when { flex: none; color: var(--text-3); font-size: var(--fs-xs); margin-left: auto; }
  .ph-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 1px 7px 1px 6px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--scene) 16%, transparent);
    color: color-mix(in srgb, var(--scene) 70%, var(--text-1));
    font-size: 10.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ph-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--scene, var(--accent)); }
  .ghost .ph-pic { background: var(--bg-2); }
  .ph-bar { width: 60%; height: 10px; border-radius: 3px; background: var(--bg-3); }
  .ghost { animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: 0.55; } }
  @media (prefers-reduced-motion: reduce) { .ghost { animation: none; } }

  .ph-videos { display: flex; flex-direction: column; gap: 10px; }
  .ph-video {
    display: flex;
    gap: 14px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
  }
  .ph-video-pic {
    flex: none;
    display: grid;
    place-items: center;
    width: 132px;
    height: 76px;
    overflow: hidden;
    border-radius: var(--r-md);
    background: var(--bg-3);
    color: var(--text-3);
  }
  .ph-video-pic img { width: 100%; height: 100%; object-fit: cover; }
  .ph-video-words { flex: 1; min-width: 0; }
  h5 { margin: 2px 0 9px; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .ph-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ph-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    height: 28px;
    padding: 0 10px 0 9px;
    border: 1px solid color-mix(in srgb, var(--scene) 45%, var(--border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--scene) 9%, var(--bg-1));
    color: var(--text-1);
    font-size: var(--fs-xs);
    transition: background-color 0.12s var(--ease), border-color 0.12s var(--ease);
  }
  .ph-chip:hover { border-color: var(--scene); background: color-mix(in srgb, var(--scene) 18%, var(--bg-1)); }
  .ph-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ph-chip-name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-chip-time { flex: none; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .ph-chip-state { flex: none; color: var(--text-3); }
  .ph-chip.live .ph-dot { animation: beat 1.6s ease-out infinite; }
  @keyframes beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--scene) 70%, transparent); } 80%, 100% { box-shadow: 0 0 0 6px transparent; } }
  @media (prefers-reduced-motion: reduce) { .ph-chip.live .ph-dot { animation: none; } }

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
  .ph-hit-pic { flex: none; width: 64px; height: 40px; overflow: hidden; border-radius: var(--r-sm); background: var(--bg-3); }
  .ph-hit-pic img { width: 100%; height: 100%; object-fit: cover; }
  .ph-hit-title { min-width: 0; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ph-none { margin: 10px 4px; color: var(--text-3); font-size: var(--fs-sm); }

  .ph-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 100%;
    padding: 40px 24px;
    text-align: center;
  }
  .ph-mark {
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    margin-bottom: 6px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .ph-empty p { max-width: 380px; margin: 0 0 14px; color: var(--text-2); font-size: var(--fs-md); }
</style>
