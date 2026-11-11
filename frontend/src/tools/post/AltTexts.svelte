<script>
  /**
   * The Alt text fields of one post's pictures, one compact row each: the picture, its
   * text, a counter against the platform's limit and Copy, for posting by hand.
   * Shown under a post's pictures while the post's Alt text box is on (lib/postAlt.js).
   */
  import Icon from '../../components/Icon.svelte';
  import { ALT_MAX, altLength, altLimit } from '../../lib/postAlt.js';

  let {
    paths = [],
    texts = {},
    target = 'x',
    href = () => null,
    thumbs = true,
    onedit = () => {},
    oncopy = () => {},
  } = $props();

  const limit = $derived(altLimit(target));
  const fileName = (path) => String(path ?? '').split('/').pop();

  /** One line until the text needs more, up to a few, then it scrolls. */
  function grow(node, _text) {
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight + 2, 96)}px`;
    };
    // measured once the text is in the box: a text set from outside lands after this runs
    const later = () => requestAnimationFrame(fit);
    later();
    return { update: later };
  }
</script>

<div class="alt-texts">
  {#each paths as path (path)}
    {@const text = texts[path] ?? ''}
    {@const used = altLength(target, text)}
    <div class="alt-row">
      {#if thumbs}
        <img class="alt-thumb" src={href(path)} alt="" loading="lazy" />
      {/if}
      <textarea class="textarea alt-input" rows="1" maxlength={ALT_MAX} dir="auto" placeholder="Alt text"
        aria-label={`Alt text for ${fileName(path)}`} title="What this picture shows, for a screen reader"
        value={text} oninput={(event) => onedit(path, event.currentTarget.value)} use:grow={text}></textarea>
      <span class="alt-count" class:over={used > limit.limit} title={`${limit.name} takes ${limit.limit} characters`}>{used}/{limit.limit}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => oncopy(text)} disabled={!text.trim()} title="Copy this alt text">
        <Icon name="copy" size={12} /> Copy
      </button>
    </div>
  {/each}
</div>

<style>
  .alt-texts {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .alt-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .alt-thumb {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  /* the app's field, one line high until it is given more */
  .alt-input {
    flex: 1;
    width: auto;
    min-width: 0;
    min-height: 28px;
    padding: 4px 8px;
    resize: none;
    overflow-y: auto;
    font-size: var(--fs-xs);
    line-height: 1.4;
  }
  .alt-count {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    color: var(--text-3);
  }
  .alt-count.over { color: var(--danger); font-weight: 700; }
</style>
