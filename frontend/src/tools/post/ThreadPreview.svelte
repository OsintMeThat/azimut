<script module>
  // The shape each picture turned out to have, kept while the app runs, so a preview
  // opened again frames a picture right away rather than move once it loads.
  const SHAPES_KEPT = 300;
  const shapes = new Map();
</script>

<script>
  /**
   * Write or Preview, over the thread's column, and the preview itself: the thread as it
   * goes out on the platform picked, post by post, in Azimut's own look. Each post says
   * its final text (tokens filled, lines kept, links as the site shows them, mentions and
   * hashtags coloured as it colours them), its pictures framed as it frames one to four
   * (a video's poster, an ALT mark on a picture that has its text), its count against the
   * limit with what runs past it marked, and a line joins it to the next.
   *
   * Light by design: it reads only what the composer hands it (`posts`, as the extension
   * would get them), draws only while it is shown, on thumbnails rather than files, and
   * asks nothing of the network. A recap map still to make shows the composer's small
   * preview of it (`recap`), never a map made for the occasion.
   */
  import Icon from '../../components/Icon.svelte';
  import { prefs } from '../../lib/state.svelte.js';
  import {
    DEFAULT_RATIO, gridFrame, postPictures, previewAuthor, previewText, replyHandle, singleFrame, threadWords,
  } from './threadPreview.js';

  let {
    /** Whether the preview stands in for the posts being written. */
    open = $bindable(false),
    /** The posts as they go out (`lib/post.js` `handoffThread`): `{ text, files, alt? }`. */
    posts = [],
    target = 'x',
    caseId = '',
    /** The case's media by path (`GET /media`), for each file's thumbnail and kind. */
    media = null,
    /** The case's proofs (`GET /proofs`), for a proof picture's thumbnail. */
    proofs = null,
    /** A recap map still to make, on the first post: its preview's address, '' while drawn, null for none. */
    recap = null,
    /** The source post the thread replies under, `{ site, url }`, or null. */
    reply = null,
    /** How many files past four on a post stay behind. */
    dropped = 0,
  } = $props();

  const sky = $derived(target === 'bluesky');
  const author = $derived(previewAuthor(prefs.signatureHandle));
  const readings = $derived(posts.map((post, i) => {
    const pictures = postPictures(post.files, { caseId, media, proofs, alt: post.alt });
    if (i === 0 && recap !== null) pictures.unshift({ path: '', video: false, src: recap || null, alt: '', later: true });
    return { ...previewText(target, post.text), pictures };
  }));
  const overPosts = $derived(readings.filter((post) => post.over > 0).length);
  const replyTo = $derived(reply ? replyHandle(reply) || 'the source post' : '');

  // a picture's own shape, once its thumbnail says it
  let learnt = $state({});
  const shapeOf = (picture) => (picture.later ? DEFAULT_RATIO : learnt[picture.src] ?? shapes.get(picture.src) ?? DEFAULT_RATIO);
  function learn(src, img) {
    if (!src || !img.naturalWidth || !img.naturalHeight) return;
    const shape = img.naturalWidth / img.naturalHeight;
    if (Math.abs((learnt[src] ?? shapes.get(src) ?? DEFAULT_RATIO) - shape) < 0.01) return;
    if (shapes.size >= SHAPES_KEPT) shapes.delete(shapes.keys().next().value);
    shapes.set(src, shape);
    learnt[src] = shape;
  }
  /** Reads a picture's shape once it is decoded, a picture the browser held already included. */
  function shaped(img, src) {
    let current = src;
    const read = () => learn(current, img);
    img.addEventListener('load', read);
    if (img.complete) read();
    return {
      update(next) { current = next; },
      destroy() { img.removeEventListener('load', read); },
    };
  }

  /** Arrows, Home and End move between the two tabs, as the app's other tab bars do. */
  function key(event) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    open = event.key === 'Home' ? false : event.key === 'End' ? true : !open;
    event.currentTarget.querySelectorAll('[role="tab"]')[open ? 1 : 0]?.focus();
  }
</script>

<div class="tp-bar">
  <div class="tp-tabs" role="tablist" aria-label="The thread" tabindex="-1" onkeydown={key}>
    <button type="button" class="tp-tab" class:on={!open} role="tab" aria-selected={!open} tabindex={open ? -1 : 0}
      title="Write the posts" onclick={() => (open = false)}>
      <Icon name="edit" size={13} /> Write
    </button>
    <button type="button" class="tp-tab" class:on={open} role="tab" aria-selected={open} tabindex={open ? 0 : -1}
      title="See the thread as it will go out" onclick={() => (open = true)} data-testid="thread-preview-tab">
      <Icon name="eye" size={13} /> Preview
    </button>
  </div>
  {#if open && readings.length}
    <span class="tp-sum" data-testid="thread-preview-sum">
      {threadWords(readings.length)}{#if overPosts}{' · '}<span class="tp-sum-over">{overPosts} too long</span>{/if}
    </span>
  {/if}
</div>

{#if open}
  <div class="tp-thread" class:sky role="tabpanel" aria-label="Preview" data-testid="thread-preview">
    {#if !readings.length}
      <div class="empty tp-empty">
        <Icon name="eye" size={22} />
        <h3>Nothing to post yet</h3>
        <p>The thread shows here once a post has words or a picture.</p>
      </div>
    {:else}
      {#each readings as post, i}
        {@const one = post.pictures.length === 1 ? singleFrame(target, shapeOf(post.pictures[0])) : null}
        <article class="tp-post" class:linked={i < readings.length - 1} data-testid="preview-post">
          <div class="tp-side" aria-hidden="true">
            <span class="tp-avatar">{#if author.initial}{author.initial}{:else}<Icon name="user" size={15} />{/if}</span>
          </div>
          <div class="tp-main">
            <div class="tp-head">
              <span class="tp-name">{author.name}</span>
              <span class="tp-count" class:over={post.over > 0}
                title={post.over > 0 ? `${post.over} over the limit` : `${sky ? 'Bluesky' : 'X'} takes ${post.limit} characters`}
              >{post.count}/{post.limit}</span>
            </div>
            {#if i === 0 && replyTo}
              <p class="tp-reply">Replying to <span class="tp-link">{replyTo}</span></p>
            {/if}
            {#if post.parts.length}
              <!-- one line in the source: the text keeps its own spaces and breaks -->
              <div class="tp-text" dir="auto">{#each post.parts as part}{#if part.over}<mark class="tp-over">{#if part.kind === 'text'}{part.text}{:else}<span class="tp-link" title={part.href}>{part.text}</span>{/if}</mark>{:else if part.kind === 'text'}{part.text}{:else}<span class="tp-link" title={part.href}>{part.text}</span>{/if}{/each}</div>
            {/if}
            {#if post.pictures.length}
              <div class="tp-media n{post.pictures.length}" class:solo={!!one}
                style:aspect-ratio={one ? one.frame : gridFrame(target, post.pictures.length)} data-testid="preview-media">
                {#each post.pictures as picture, p (picture.later ? 'later' : `${p}:${picture.path}`)}
                  <div class="tp-pic" class:video={picture.video} class:later={picture.later}
                    style:aspect-ratio={one && sky ? one.picture : null}>
                    {#if picture.src}
                      <img src={picture.src} alt={picture.alt} loading="lazy" decoding="async" use:shaped={picture.later ? '' : picture.src} />
                    {:else if picture.later}
                      <span class="tp-ground"><Icon name="satellite" size={20} /></span>
                    {/if}
                    {#if picture.video}<span class="tp-play" role="img" aria-label="Video"><Icon name="play" size={16} /></span>{/if}
                    {#if picture.alt}<span class="tp-alt" title={picture.alt}>ALT</span>{/if}
                  </div>
                {/each}
              </div>
              {#if post.pictures[0].later}
                <!-- under the picture, where it hides no pin, scale or credit of the map -->
                <p class="tp-later" title="Drawn whole and filed in Media when the thread goes out">The map is made when you publish.</p>
              {/if}
            {/if}
          </div>
        </article>
      {/each}
    {/if}
  </div>
  {#if dropped}
    <p class="tp-note">{dropped} {dropped === 1 ? 'file stays' : 'files stay'} behind: a post takes four.</p>
  {/if}
{/if}

<style>
  /* Write and Preview, as the app's other tab bars read */
  .tp-bar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: -4px;
    border-bottom: 1px solid var(--border);
  }
  .tp-tabs { display: flex; gap: 2px; }
  .tp-tabs:focus { outline: none; }
  .tp-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -1px;
    padding: 6px 9px 7px;
    border-bottom: 2px solid transparent;
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .tp-tab:hover { color: var(--text-1); }
  .tp-tab.on { color: var(--text-1); border-bottom-color: var(--accent); }
  .tp-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--r-sm); }
  .tp-sum {
    min-width: 0;
    padding-bottom: 8px;
    overflow: hidden;
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-sum-over { color: var(--danger); }

  /* the thread, one card, a post under the other */
  .tp-thread {
    max-width: 600px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
  }
  .tp-empty { padding: 36px 20px; }
  .tp-post {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    column-gap: 11px;
    padding: 14px 16px 0;
  }
  .tp-post:last-child .tp-main { padding-bottom: 16px; }
  .tp-side { position: relative; }
  .tp-avatar {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-3);
    color: var(--text-2);
    font-size: var(--fs-md);
    font-weight: 600;
    user-select: none;
  }
  /* the line from a post to the next */
  .tp-post.linked .tp-side::after {
    content: '';
    position: absolute;
    top: 42px;
    bottom: -8px;
    left: 17px;
    width: 2px;
    border-radius: 1px;
    background: var(--border-strong);
  }
  .tp-main { min-width: 0; padding-bottom: 14px; }
  .tp-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-height: 20px;
  }
  .tp-name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-count {
    margin-left: auto;
    flex: none;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .tp-count.over {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--danger-soft);
    color: var(--danger);
    font-weight: 600;
  }
  .tp-reply { margin: 1px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .tp-text {
    margin-top: 3px;
    color: var(--text-1);
    font-size: var(--fs-md);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .tp-link { color: var(--info); }
  /* what runs past the limit: plain to read, softly marked */
  .tp-over {
    border-radius: 2px;
    background: var(--danger-soft);
    color: inherit;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--danger) 55%, transparent);
  }

  /* pictures, framed as the site frames one to four */
  .tp-media {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 2px;
    width: 100%;
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .tp-media.n2 { grid-template-rows: 1fr; }
  .tp-media.n3 .tp-pic:first-child { grid-row: span 2; }
  .tp-media.solo { display: flex; }
  .sky .tp-media { gap: 4px; border: 0; border-radius: 8px; }
  .tp-pic {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-3);
  }
  .tp-media.solo .tp-pic { flex: 1 1 auto; height: 100%; }
  /* Bluesky keeps one picture whole, its own shape, at the left of its frame */
  .sky .tp-media.solo .tp-pic { flex: 0 1 auto; max-width: 100%; border-radius: 8px; }
  .tp-pic img { width: 100%; height: 100%; object-fit: cover; }
  .tp-pic.video { background: #0d0d0d; }
  .tp-ground {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #2b3138;
    color: rgba(255, 255, 255, 0.55);
  }
  .tp-play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    padding-left: 2px;
    border: 2px solid rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
  }
  .tp-alt {
    position: absolute;
    bottom: 7px;
    left: 7px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.5;
    cursor: help;
  }
  .tp-later { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .tp-note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
</style>
