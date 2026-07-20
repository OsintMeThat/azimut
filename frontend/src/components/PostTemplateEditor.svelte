<script>
  /**
   * Editor for one post-thread template. The thread structure is a token body:
   * the analyst arranges tokens (#place, #coordinates, …) in the order and line
   * layout they want, mixes in literal text, and a live preview fills them with
   * sample values. Plus the default mention, the media-tweet flag and any
   * boilerplate extra tweets. Content-free.
   *
   * `data` is the template blob (bindable); the parent owns save/delete.
   */
  import { TWEET_TOKENS, DEFAULT_TWEET_BODY, buildTweet1 } from '../lib/post.js';
  import Icon from './Icon.svelte';

  let { data = $bindable() } = $props();

  // guarantee the shape (a hand-edited or legacy blob may omit fields)
  if (typeof data.body !== 'string' || !data.body) data.body = DEFAULT_TWEET_BODY;
  if (!Array.isArray(data.extraTweets)) data.extraTweets = [];

  let bodyEl = $state(null);

  // Insert a token at the caret (or over the selection), keeping focus so the
  // analyst can keep typing/inserting without reaching for the mouse.
  function insertToken(tag) {
    const el = bodyEl;
    const text = data.body ?? '';
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    data.body = text.slice(0, start) + tag + text.slice(end);
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = start + tag.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function addExtra() {
    data.extraTweets.push({ text: '' });
  }
  function removeExtra(i) {
    data.extraTweets.splice(i, 1);
  }

  // Live preview of the first tweet with placeholder facts + the template's own
  // mention, so the effect of the token layout reads without leaving Settings.
  const SAMPLE = Object.fromEntries(TWEET_TOKENS.map((t) => [t.tag.slice(1), t.sample]));
  const preview = $derived(
    buildTweet1(data.body, {
      place: SAMPLE.place,
      plusCode: SAMPLE.pluscode,
      description: SAMPLE.description,
      lat: 48.85,
      lon: 2.35,
      mention: data.mention || SAMPLE.mention,
      source: SAMPLE.source,
    }) || '(empty post)'
  );
</script>

<div class="post-editor">
  <div class="pe-grid">
    <div class="pe-fields">
      <label class="fld">
        <span>Mention</span>
        <input type="text" placeholder="@GeoConfirmed" maxlength="64" bind:value={data.mention} />
      </label>

      <fieldset class="fld">
        <span>First post layout</span>
        <p class="hint">Arrange the tokens in the order you want, add line breaks and
          your own text. A token with no value drops its line.</p>
        <div class="tokens">
          {#each TWEET_TOKENS as tok}
            <button type="button" class="tok" title={`Insert ${tok.tag}`}
              onclick={() => insertToken(tok.tag)}>{tok.tag}</button>
          {/each}
        </div>
        <textarea class="body" rows="9" bind:this={bodyEl} bind:value={data.body}></textarea>
      </fieldset>

      <label class="chk">
        <input type="checkbox" bind:checked={data.mediaEnabled} /> Include a media post
      </label>

      <fieldset class="fld">
        <span>Boilerplate extra posts</span>
        {#each data.extraTweets as tw, i (i)}
          <div class="extra-row">
            <textarea rows="2" placeholder="Extra post text" bind:value={tw.text}></textarea>
            <button type="button" class="btn btn-ghost btn-sm" title="Remove"
              onclick={() => removeExtra(i)}><Icon name="trash" /></button>
          </div>
        {/each}
        <button type="button" class="btn btn-ghost btn-sm" onclick={addExtra}>
          <Icon name="plus" /> Add post
        </button>
      </fieldset>
    </div>

    <div class="pe-preview">
      <span class="pv-label">First post preview</span>
      <pre>{preview}</pre>
    </div>
  </div>
</div>

<style>
  .pe-grid { display: grid; grid-template-columns: 1fr 240px; gap: 16px; align-items: start; }
  .pe-fields { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .fld { display: flex; flex-direction: column; gap: 6px; border: 0; margin: 0; padding: 0; }
  .fld > span { font-size: 12px; color: var(--text-2); font-weight: 600; }
  .hint { margin: 0; font-size: 11px; color: var(--text-3); line-height: 1.4; }
  .fld input[type='text'], .extra-row textarea, .body {
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-1); padding: 6px 8px; font: inherit; width: 100%; resize: vertical;
  }
  .body { font: 12px/1.5 var(--font-mono, monospace); }
  .tokens { display: flex; flex-wrap: wrap; gap: 5px; }
  .tok {
    padding: 3px 8px; border: 1px solid var(--border); border-radius: 999px;
    background: var(--bg-2); color: var(--accent); font: 11px var(--font-mono, monospace);
    cursor: pointer;
  }
  .tok:hover { background: var(--bg-3); }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
  .extra-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; }
  .pe-preview {
    border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    display: flex; flex-direction: column; gap: 6px; background: var(--bg-1);
    position: sticky; top: 0;
  }
  .pv-label { font-size: 11px; color: var(--text-3); font-weight: 600; }
  .pe-preview pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font: 12px/1.4 system-ui, sans-serif; color: var(--text-1);
  }
</style>
