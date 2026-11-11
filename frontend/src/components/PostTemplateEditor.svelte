<script>
  /**
   * Editor for one post-thread template. The thread structure is a token body:
   * the analyst arranges tokens (#place, #coordinates, …) in the order and line
   * layout they want, mixes in literal text, and a live preview fills them with
   * sample values or with the post open in the composer, and counts each
   * platform's limit. Plus the default mention, the media-tweet flag and any
   * boilerplate extra tweets. Content-free.
   *
   * `data` is the template blob (bindable); the parent owns save/delete. `fresh`
   * marks a new template, which offers starting layouts to begin from.
   *
   * A template is for one kind of post (`data.kind`, none for a geolocation), chosen
   * when it is made: its tokens, its starts and its sample follow that kind, and a
   * geolocation also says whether its posts reply under their source by default.
   *
   * A video thread's template is several posts: its order, its recap (`body`), the
   * video's post and each place's (`posts`), each written with the tokens it can fill
   * and previewed as a whole sample thread of three places.
   */
  import {
    TWEET_TOKENS, DEFAULT_TWEET_BODY, POST_TARGETS, buildTweet1,
    fixMisspelledToken, misspelledTokens, postCharacterCount, postKind, postStarters,
    postTemplateKind, tokensForKind,
  } from '../lib/post.js';
  import { ORDER_NAMES, ORDER_WORDS, ORDERS } from '../lib/videoThread.js';
  import { layoutPosts, threadPostLabel, videoLayout, videoPosts } from '../lib/videoPost.js';
  import { postDraftState } from '../lib/state.svelte.js';
  import { bidiSafe } from '../lib/bidi.js';
  import Icon from './Icon.svelte';

  let { data = $bindable(), fresh = false } = $props();

  // guarantee the shape (a hand-edited or legacy blob may omit fields)
  if (typeof data.body !== 'string' || !data.body) data.body = DEFAULT_TWEET_BODY;
  if (!Array.isArray(data.extraTweets)) data.extraTweets = [];
  // a video thread says its order and the text of each of its posts
  if (postTemplateKind(data) === 'video') {
    const layout = videoLayout(data);
    data.order = layout.order;
    data.posts = layoutPosts(layout);
  }

  let bodyEl = $state(null);
  // the text a token goes into: the recap, or one of a video thread's other posts
  let active = $state('body');
  const roleEls = $state({});

  const kind = $derived(postTemplateKind(data));
  const tokens = $derived(tokensForKind(kind));
  const starters = $derived(postStarters(kind));
  const video = $derived(kind === 'video');

  /** A video thread's text for a kind of post. */
  const roleText = (role) => data.posts?.find((one) => one.role === role)?.body ?? '';
  function setRoleText(role, text) {
    const one = data.posts.find((p) => p.role === role);
    if (one) one.body = text;
  }

  /** A start: its layout, and for a video thread its order and the text of each post. */
  function applyStarter(starter) {
    data.body = starter.body;
    if (!video) return;
    data.order = starter.order;
    data.posts = starter.posts.map((one) => ({ ...one }));
  }

  // Insert a token at the caret (or over the selection), keeping focus so the
  // analyst can keep typing/inserting without reaching for the mouse.
  function insertToken(tag) {
    const role = video && active !== 'body' ? active : null;
    const el = role ? roleEls[role] : bodyEl;
    const text = role ? roleText(role) : data.body ?? '';
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + tag + text.slice(end);
    if (role) setRoleText(role, next);
    else data.body = next;
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = start + tag.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  // Written only when it says yes, so a template that never replies keeps its shape.
  function setReply(on) {
    if (on) data.reply = true;
    else delete data.reply;
  }

  function addExtra() {
    data.extraTweets.push({ text: '' });
  }
  function removeExtra(i) {
    data.extraTweets.splice(i, 1);
  }

  // A word that looks like a token and is not one goes out as plain text, so it
  // is named here, with the one click that mends it.
  const misspelled = $derived(misspelledTokens(data.body));

  // A video thread previews whole, on three places: a passage, an instant, the whole video.
  const SAMPLE_VIDEO = { path: 'media/sample.mp4', title: TWEET_TOKENS.find((t) => t.tag === '#video').sample };
  const sampleRow = (name, title, description, coords) => ({
    name, title, png: `proofs/${name}.png`,
    row: { description, points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }] },
  });
  const SAMPLE_SLIDES = [
    { ...sampleRow('bridge', 'Road bridge', 'The convoy crosses the road bridge', '48.850000, 2.350000'), moments: [{ start: 0, end: 7 }] },
    { ...sampleRow('gate', 'Port gate', '', '48.860000, 2.360000'), moments: [{ start: 15, end: null }] },
    { ...sampleRow('village', 'Hilltop village', '', '48.870000, 2.370000'), moments: [] },
  ];
  const threadPreview = $derived(video
    ? videoPosts({
      video: SAMPLE_VIDEO,
      slides: SAMPLE_SLIDES,
      layout: videoLayout(data),
      common: { mention: data.mention, source: TWEET_TOKENS.find((t) => t.tag === '#source').sample },
      sheet: 'media/sample-sheet.jpg',
      extra: data.extraTweets,
    }).posts.map((post) => ({
      ...post,
      label: threadPostLabel(post, new Map(SAMPLE_SLIDES.map((one) => [one.name, one.title]))),
      counts: Object.values(POST_TARGETS).map((target) => {
        const count = postCharacterCount(target.id, bidiSafe(post.text));
        return { ...target, count, over: count > target.limit };
      }),
    }))
    : []);

  // Live preview of the first tweet, so the effect of the token layout reads
  // without leaving Settings. It fills the tokens with placeholder facts of the
  // template's kind, or with the post open in the composer when it is of that kind.
  // The template's own mention wins either way: applying the template is what sets it.
  const SAMPLE = Object.fromEntries(TWEET_TOKENS.map((t) => [t.tag.slice(1), t.sample]));
  const GEOLOCATION_SAMPLE = {
    place: SAMPLE.place,
    plusCode: SAMPLE.pluscode,
    description: SAMPLE.description,
    lat: 48.85,
    lon: 2.35,
    source: SAMPLE.source,
    date: SAMPLE.date,
    video: SAMPLE.video,
    timecode: SAMPLE.timecode,
    credits: SAMPLE.credits,
  };
  const SAMPLES = {
    geolocation: GEOLOCATION_SAMPLE,
    video: { ...GEOLOCATION_SAMPLE, scenes: SAMPLE.scenes },
    plate: {
      description: 'Front line around Kupiansk, 1 to 30 October',
      date: '2025-10-01 → 2025-10-30',
      credits: SAMPLE.credits,
    },
    compare: {
      description: 'Burn scars north of the depot, before and after',
      date: '2025-03-02 → 2025-03-14',
      credits: SAMPLE.credits,
    },
    free: {
      description: 'Smoke over the port at dusk, seen from three angles',
      source: SAMPLE.source,
      date: SAMPLE.date,
      credits: SAMPLE.credits,
    },
  };
  const SAMPLE_FIELDS = $derived(SAMPLES[kind]);
  let previewWith = $state('sample'); // 'sample' | 'open'
  // the post in the composer, when it is one this template could shape
  const openFields = $derived(postDraftState.fields && (postDraftState.fields.kind ?? 'geolocation') === kind
    ? postDraftState.fields
    : null);
  // The composer can be emptied while this is open, which takes its post away.
  const useOpen = $derived(previewWith === 'open' && !!openFields);
  const built = $derived(
    buildTweet1(data.body, { ...(useOpen ? openFields : SAMPLE_FIELDS), mention: data.mention })
  );
  const preview = $derived(built || '(empty post)');
  // What is copied is the bidi-safe text, so that is what each platform counts.
  const counts = $derived(
    Object.values(POST_TARGETS).map((target) => {
      const count = postCharacterCount(target.id, bidiSafe(built));
      return { ...target, count, over: count > target.limit };
    })
  );
</script>

<div class="post-editor">
  <div class="pe-grid">
    <div class="pe-fields">
      <p class="pe-kind"><Icon name={postKind(kind).icon} size={13} /> {postKind(kind).label}</p>
      <label class="fld">
        <span>Mention</span>
        <input type="text" placeholder="@GeoConfirmed" maxlength="280" bind:value={data.mention} />
      </label>

      {#if video}
        <label class="fld">
          <span>Order</span>
          <select class="order" value={data.order} onchange={(event) => (data.order = event.currentTarget.value)}
            title="The order the thread's posts go out in">
            {#each ORDERS as order (order)}<option value={order}>{ORDER_NAMES[order]}</option>{/each}
          </select>
          <p class="hint">{ORDER_WORDS[data.order]}.</p>
        </label>
      {/if}

      <fieldset class="fld">
        <span>{video ? 'Recap post' : 'First post layout'}</span>
        <p class="hint">{video
          ? 'Names every place: the first post of Recap first, the only post of All in one. A token with no value drops its line.'
          : 'Arrange the tokens in the order you want, add line breaks and your own text. A token with no value drops its line.'}</p>
        {#if fresh && starters.length}
          <div class="starters" role="group" aria-label="Start from">
            <span class="starters-label">Start from</span>
            {#each starters as starter (starter.id)}
              <button type="button" class="tok starter" onclick={() => applyStarter(starter)}>
                {starter.label}
              </button>
            {/each}
          </div>
        {/if}
        <div class="tokens">
          {#each tokens as tok (tok.tag)}
            <button type="button" class="tok" title={`Insert ${tok.tag}`}
              onclick={() => insertToken(tok.tag)}>{tok.tag}</button>
          {/each}
        </div>
        <textarea class="body" rows={video ? 5 : 9} bind:this={bodyEl} bind:value={data.body} onfocus={() => (active = 'body')}></textarea>
        {#each misspelled as word (word.written)}
          <p class="misspelled" role="status">
            <span><code>{word.written}</code> is not a token. Did you mean <code>{word.meant}</code>?</span>
            <button type="button" class="btn btn-sm"
              onclick={() => (data.body = fixMisspelledToken(data.body, word.written, word.meant))}
            >Fix</button>
          </p>
        {/each}
      </fieldset>

      {#if video}
        {#each [['video', 'Video post', 'The post that carries the video, or its link.'], ['place', 'Each place', 'One post per place, with its proof’s picture.']] as [role, label, hint] (role)}
          <fieldset class="fld" data-role={role}>
            <span>{label}</span>
            <p class="hint">{hint}</p>
            <textarea class="body" rows="4" bind:this={roleEls[role]} value={roleText(role)}
              oninput={(event) => setRoleText(role, event.currentTarget.value)} onfocus={() => (active = role)}></textarea>
            {#each misspelledTokens(roleText(role)) as word (word.written)}
              <p class="misspelled" role="status">
                <span><code>{word.written}</code> is not a token. Did you mean <code>{word.meant}</code>?</span>
                <button type="button" class="btn btn-sm"
                  onclick={() => setRoleText(role, fixMisspelledToken(roleText(role), word.written, word.meant))}
                >Fix</button>
              </p>
            {/each}
          </fieldset>
        {/each}
      {:else}
        <label class="chk">
          <input type="checkbox" bind:checked={data.mediaEnabled} /> Include a media post
        </label>
      {/if}

      {#if kind === 'geolocation'}
        <label class="chk reply" title="A post whose source is an X or Bluesky post goes out under it, without its link">
          <input type="checkbox" checked={data.reply === true} onchange={(event) => setReply(event.currentTarget.checked)} />
          Reply under the source by default
        </label>
      {/if}

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

    {#if video}
      <div class="pe-preview thread-preview">
        <span class="pv-label">Thread preview, three sample places</span>
        {#each threadPreview as post, i (post.key)}
          <div class="pv-post">
            <span class="pv-num">{i + 1} · {post.label}</span>
            <pre>{post.text || '(no text)'}</pre>
            <p class="counters">{#each post.counts as count, j (count.id)}{#if j}<span aria-hidden="true">{' · '}</span>{/if}<span class="counter" class:over={count.over}>{count.label} {count.count}/{count.limitLabel}</span>{/each}</p>
          </div>
        {/each}
      </div>
    {:else}
    <div class="pe-preview">
      <span class="pv-label">First post preview</span>
      <div class="pv-switch" role="group" aria-label="Preview with">
        <button type="button" class="pv-opt" class:on={!useOpen} aria-pressed={!useOpen}
          onclick={() => (previewWith = 'sample')}>Sample</button>
        <button type="button" class="pv-opt" class:on={useOpen} aria-pressed={useOpen}
          disabled={!openFields}
          title={openFields ? 'Fill it with the post open in the composer'
            : postDraftState.fields ? 'The post open in the composer is another kind' : 'No post is open in the composer'}
          onclick={() => (previewWith = 'open')}>Open post</button>
      </div>
      <pre>{preview}</pre>
      <!-- one line of markup, so no stray whitespace lands between the counts -->
      <p class="counters">{#each counts as count, i (count.id)}{#if i}<span aria-hidden="true">{' · '}</span>{/if}<span class="counter" class:over={count.over}>{count.label} {count.count}/{count.limitLabel}</span>{/each}</p>
    </div>
    {/if}
  </div>
</div>

<style>
  .pe-grid { display: grid; grid-template-columns: 1fr 240px; gap: 16px; align-items: start; }
  .pe-fields { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .pe-kind {
    display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; margin: 0;
    padding: 2px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
    font-size: 11px; font-weight: 600;
  }
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
  .starters { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .starters-label { font-size: 11px; color: var(--text-3); margin-right: 2px; }
  .starter { color: var(--text-1); font-family: inherit; }
  .misspelled {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 0; font-size: 12px; color: var(--warn, #d8a03d); line-height: 1.4;
  }
  .misspelled code { font: 11px var(--font-mono, monospace); }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
  .extra-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; }
  .pe-preview {
    border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    display: flex; flex-direction: column; gap: 6px; background: var(--bg-1);
    position: sticky; top: 0;
  }
  .pv-label { font-size: 11px; color: var(--text-3); font-weight: 600; }
  .pv-switch {
    display: flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    align-self: flex-start;
  }
  .pv-opt {
    padding: 3px 10px; background: var(--bg-2); color: var(--text-2); font-size: 11px;
    border: 0; border-left: 1px solid var(--border); cursor: pointer;
  }
  .pv-opt:first-child { border-left: 0; }
  .pv-opt:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .pv-opt.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .pv-opt:disabled { opacity: 0.45; cursor: not-allowed; }
  .counters { margin: 0; font-size: 11px; color: var(--text-3); }
  .counter { font: 700 11px var(--font-mono, monospace); color: var(--ok); }
  .counter.over { color: var(--danger); }
  .pe-preview pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font: 12px/1.4 system-ui, sans-serif; color: var(--text-1);
  }
  .order {
    background: var(--bg-2); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text-1); padding: 5px 8px; font: inherit; align-self: flex-start;
  }
  .thread-preview { max-height: 70vh; overflow-y: auto; gap: 10px; }
  .pv-post { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
  .pv-post:first-of-type { border-top: 0; padding-top: 0; }
  .pv-num { font-size: 11px; color: var(--text-2); font-weight: 600; }
</style>
