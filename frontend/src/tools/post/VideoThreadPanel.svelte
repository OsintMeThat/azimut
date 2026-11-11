<script>
  /**
   * A video thread's own column in the composer, above the mention and the source: the
   * video it posts and its places (with the proofs it leaves out, and why), the thread's
   * title (`#video`, the analyst's own words, empty unless they give some), the order
   * the posts go out in, the contact sheet while it is made, and, when the video is over
   * the platform's limit, what can go in its place: the clip a proof cut for its post
   * (Cut for the post, Geo Proof's Scene tab), else the video's link. Nothing is cut or
   * re-encoded here; a choice only changes what the video's post carries.
   */
  import Icon from '../../components/Icon.svelte';
  import { clipWords } from '../../lib/postClip.js';
  import { LEFT_WHY, ORDER_NAMES, ORDER_WORDS, ORDERS } from '../../lib/videoThread.js';

  let {
    /** The video's title as Media gives it, or its file name: which video this is. */
    title = '',
    /** The thread's title, `#video`: the analyst's, '' for none. */
    threadTitle = '',
    /** `(text)`: the thread's title typed. */
    ontitle,
    /** The places the thread posts, `{ name, label, clip }`, null while read. */
    places = null,
    /** The proofs it leaves out, `{ label, why }`. */
    left = [],
    /** How many places a thread could not hold. */
    cut = 0,
    order = 'recap',
    /** `(order)`: post in this order. */
    onorder,
    /** The contact sheet: '' when filed or not needed, 'making', or 'failed'. */
    sheet = '',
    /** Make the sheet again, after it failed. */
    onsheet,
    /** What is over the platform's limit, in words, or '' when the video fits. */
    over = '',
    /** The clip the video's post carries in its place, a case path, or null. */
    clip = null,
    /** Whether the video's post carries its link in its place. */
    link = false,
    /** The video's link, '' when it has none. */
    href = '',
    /** `(path)`: post this clip instead, or null for the whole video. */
    onclip,
    /** `(on)`: post the link instead, or the whole video again. */
    onlink,
  } = $props();

  const clips = $derived((places ?? []).filter((one) => one.clip?.path));
  const chosen = $derived(clips.find((one) => one.clip.path === clip) ?? null);
</script>

<div class="vt" data-testid="video-thread">
  <div class="vt-video">
    <span class="vt-icon"><Icon name="video" size={15} /></span>
    <span class="vt-words">
      <span class="vt-title" dir="auto">{title || 'Video'}</span>
      <span class="vt-said">
        {#if places === null}Reading its proofs…{:else}{places.length} {places.length === 1 ? 'place' : 'places'}{/if}
      </span>
    </span>
  </div>
  <label class="vt-field">
    <span class="label">Thread title</span>
    <input class="input" value={threadTitle} maxlength="200" placeholder="Optional, e.g. Convoy on the coast road"
      title="The thread's first line, #video in its texts. Left empty, its line drops"
      oninput={(event) => ontitle?.(event.currentTarget.value)} />
  </label>
  {#if left.length}
    <p class="vt-note" title={left.map((one) => `${one.label}: ${LEFT_WHY[one.why]}`).join('\n')}>
      Left out: {left.map((one) => `${one.label} (${LEFT_WHY[one.why].toLowerCase()})`).join(', ')}
    </p>
  {/if}
  {#if cut}
    <p class="vt-note warn">A thread holds 21 posts: the last {cut === 1 ? 'place is' : `${cut} places are`} left out.</p>
  {/if}

  <div class="vt-orders" role="radiogroup" aria-label="Order">
    <span class="label">Order</span>
    {#each ORDERS as one (one)}
      <button type="button" class="vt-order" class:on={order === one} role="radio" aria-checked={order === one}
        title={ORDER_WORDS[one]} onclick={() => order !== one && onorder?.(one)}>
        <span class="vt-order-name">{ORDER_NAMES[one]}</span>
        <span class="vt-order-words">{ORDER_WORDS[one]}</span>
      </button>
    {/each}
  </div>

  {#if sheet === 'making'}
    <p class="vt-note" role="status">Drawing the contact sheet…</p>
  {:else if sheet === 'failed'}
    <p class="vt-note warn" role="status">The contact sheet could not be made.
      <button type="button" class="vt-link" onclick={() => onsheet?.()}>Try again</button></p>
  {/if}

  {#if clip || link}
    <p class="vt-note" data-testid="video-instead">
      {#if chosen}The video's post carries the clip of {chosen.label} ({clipWords(chosen.clip)}).{:else if clip}The video's post carries a clip of it.{:else}The video's post carries its link.{/if}
      <button type="button" class="vt-link" onclick={() => (link ? onlink?.(false) : onclip?.(null))}>Post the whole video</button>
    </p>
  {:else if over}
    <div class="vt-over" data-testid="video-over" role="status">
      <p class="vt-over-head"><Icon name="alert" size={13} /> {over}</p>
      {#if clips.length}
        <p class="vt-over-said">Post the clip a place cut instead:</p>
        {#each clips as one (one.name)}
          <button type="button" class="btn btn-sm vt-choice" onclick={() => onclip?.(one.clip.path)}
            title={`The clip of ${one.label}, cut for its post`}>
            <Icon name="video" size={13} /> {one.label} · {clipWords(one.clip)}
          </button>
        {/each}
      {:else}
        <p class="vt-over-said">No place has a clip yet: Cut for the post, in Geo Proof's Scene tab, makes one.{href ? ' Or post its link:' : ''}</p>
        {#if href}
          <button type="button" class="btn btn-sm vt-choice" onclick={() => onlink?.(true)} title={href}>
            <Icon name="external" size={13} /> Post the link instead
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .vt { display: flex; flex-direction: column; gap: 10px; }
  .vt-video { display: flex; align-items: center; gap: 10px; }
  .vt-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .vt-words { display: flex; flex-direction: column; min-width: 0; }
  .vt-title { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .vt-said { color: var(--text-3); font-size: var(--fs-xs); }
  .vt-field { display: flex; flex-direction: column; gap: 4px; }
  .vt-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .vt-note.warn { color: var(--warn); }
  .vt-orders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .vt-orders .label { grid-column: 1 / -1; }
  .vt-order {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    text-align: left;
  }
  .vt-order:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); }
  .vt-order.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--bg-2)); }
  .vt-order:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .vt-order-name { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .vt-order-words { color: var(--text-3); font-size: 11px; line-height: 1.35; }
  .vt-over {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--warn) 8%, var(--bg-2));
  }
  .vt-over-head { display: flex; gap: 6px; margin: 0; color: var(--text-1); font-size: var(--fs-xs); line-height: 1.45; }
  .vt-over-head :global(svg) { flex: none; margin-top: 2px; color: var(--warn); }
  .vt-over-said { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .vt-choice { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vt-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
