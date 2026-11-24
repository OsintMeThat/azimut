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
   * A video thread's template is several posts, listed top to bottom in the order they
   * go out (`data.order`, `lib/threadOrder.js`): the recap (`body`), the video's post and
   * each place's (`posts`), each written in its own row with the tokens it can fill. A
   * row moves by its handle or its arrows; the recap and the first place on its own can
   * be left out and put back; All in one is the one post. The whole sample thread of
   * three places is previewed beside it.
   */
  import {
    TWEET_TOKENS, DEFAULT_TWEET_BODY, POST_TARGETS, buildTweet1,
    fixMisspelledToken, misspelledTokens, postCharacterCount, postKind, postStarters,
    postTemplateKind, tokensForKind,
  } from '../lib/post.js';
  import {
    blockName, blockWords, isAllInOne, moveBlock, OPTIONAL_BLOCKS, ORDER_PRESETS, withBlock, withoutBlock,
  } from '../lib/threadOrder.js';
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

  // the text a token goes into: the first post's (`body`, a video thread's recap), or
  // the video's or the places' in a video thread; each one's field once shown
  let active = $state('body');
  const textEls = $state({});

  const kind = $derived(postTemplateKind(data));
  const tokens = $derived(tokensForKind(kind));
  const starters = $derived(postStarters(kind));
  const video = $derived(kind === 'video');

  /** A text of the template: the first post's (`body`), or a video thread's video or places'. */
  const textOf = (role) => (role === 'body' ? data.body ?? '' : data.posts?.find((one) => one.role === role)?.body ?? '');
  function setText(role, text) {
    if (role === 'body') {
      data.body = text;
      return;
    }
    const one = data.posts.find((p) => p.role === role);
    if (one) one.body = text;
  }

  // -- a video thread's posts, top to bottom -------------------------------------------
  const allInOne = $derived(video && isAllInOne(data.order));
  /** The text a block's post is written with: the recap's (`body`), the video's or the places'. */
  const roleOf = (block) => (block === 'recap' || block === 'all' ? 'body' : block === 'video' ? 'video' : 'place');
  // The first place on its own and the other places share one text, written on the higher of the two.
  const placesOn = $derived(video ? data.order.find((block) => block === 'first' || block === 'places') : null);
  const writtenOn = (block) => roleOf(block) !== 'place' || block === placesOn;
  // the texts on screen, so a token never goes into one that is not
  const shownRoles = $derived(video ? data.order.filter(writtenOn).map(roleOf) : ['body']);

  const setOrder = (order) => (data.order = order);
  // All in one put back as a thread goes back to the order it was before
  let beforeAll = null;
  function setAllInOne(on) {
    if (on) {
      beforeAll = [...data.order];
      setOrder([...ORDER_PRESETS.all]);
    } else {
      setOrder(beforeAll ?? [...ORDER_PRESETS.recap]);
    }
  }

  // Dragging a post by its head. A press is armed first and becomes a drag a few pixels
  // later, so its arrows still press; the release is heard at the window, wherever it lands.
  let armed = null;
  let dragging = $state(-1); // the row carried
  let over = $state(-1); // the row it would land on
  function headDown(event, index) {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    armed = { index, x: event.clientX, y: event.clientY };
  }
  function dragMove(event) {
    if (!armed || Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 4) return;
    dragging = armed.index;
    over = armed.index;
    armed = null;
  }
  function rowEnter(index) {
    if (dragging >= 0) over = index;
  }
  function endDrag() {
    if (dragging >= 0 && over >= 0 && over !== dragging) setOrder(moveBlock(data.order, dragging, over));
    armed = null;
    dragging = -1;
    over = -1;
  }

  /** A start: its layout, and for a video thread its order and the text of each post. */
  function applyStarter(starter) {
    data.body = starter.body;
    if (!video) return;
    beforeAll = null;
    setOrder([...starter.order]);
    data.posts = starter.posts.map((one) => ({ ...one }));
  }

  // Insert a token at the caret (or over the selection), keeping focus so the
  // analyst can keep typing/inserting without reaching for the mouse. A word that looks
  // like a token and is not one goes out as plain text, so each field names it, with
  // the one click that mends it (`textField`).
  function insertToken(tag) {
    const role = shownRoles.includes(active) ? active : shownRoles[0] ?? 'body';
    const el = textEls[role];
    const text = textOf(role);
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + tag + text.slice(end);
    setText(role, next);
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
        const count = postCharacterCount(target.id, bidiSafe(post.text, target.id));
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
      const count = postCharacterCount(target.id, bidiSafe(built, target.id));
      return { ...target, count, over: count > target.limit };
    })
  );
</script>

{#snippet startFrom()}
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
{/snippet}

{#snippet tokenBar()}
  <div class="tokens">
    {#each tokens as tok (tok.tag)}
      <button type="button" class="tok" title={`Insert ${tok.tag}`}
        onclick={() => insertToken(tok.tag)}>{tok.tag}</button>
    {/each}
  </div>
{/snippet}

<!-- one text of the template, with the tokens it misspells and the press that mends each -->
{#snippet textField(role, rows)}
  <textarea class="body" {rows} data-role={role === 'body' && video ? 'recap' : role} bind:this={textEls[role]}
    value={textOf(role)} oninput={(event) => setText(role, event.currentTarget.value)}
    onfocus={() => (active = role)}></textarea>
  {#each misspelledTokens(textOf(role)) as word (word.written)}
    <p class="misspelled" role="status">
      <span><code>{word.written}</code> is not a token. Did you mean <code>{word.meant}</code>?</span>
      <button type="button" class="btn btn-sm"
        onclick={() => setText(role, fixMisspelledToken(textOf(role), word.written, word.meant))}
      >Fix</button>
    </p>
  {/each}
{/snippet}

<svelte:window onpointermove={dragMove} onpointerup={endDrag} onpointercancel={endDrag} />

<div class="post-editor">
  <div class="pe-grid">
    <div class="pe-fields">
      <p class="pe-kind"><Icon name={postKind(kind).icon} size={13} /> {postKind(kind).label}</p>
      <label class="fld">
        <span>Mention</span>
        <input type="text" placeholder="@GeoConfirmed" maxlength="280" bind:value={data.mention} />
      </label>

      {#if video}
        <fieldset class="fld" data-thread-posts>
          <span>Posts in order</span>
          <p class="hint">{allInOne
            ? 'One post holds the places and their pictures. A token with no value drops its line.'
            : 'The thread goes out top to bottom: drag a post or use its arrows to move it. A token with no value drops its line.'}</p>
          {@render startFrom()}
          {@render tokenBar()}
          <ol class="blocks">
            {#each data.order as block, i (block)}
              {@const name = blockName(block, data.order)}
              <li class="block" data-block={block} class:dragging={dragging === i}
                class:landing={dragging >= 0 && over === i && dragging !== i} class:from-below={dragging > i}
                onpointerenter={() => rowEnter(i)}>
                <div class="block-head" class:still={allInOne} onpointerdown={(event) => !allInOne && headDown(event, i)}
                  title={allInOne ? undefined : 'Drag to move it'}>
                  {#if !allInOne}<span class="grip" aria-hidden="true"><Icon name="grip" size={14} stroke={3.4} /></span>{/if}
                  <span class="block-num">{i + 1}</span>
                  <span class="block-said">
                    <span class="block-name">{name}</span>
                    <span class="block-words">{blockWords(block, data.order)}</span>
                  </span>
                  {#if !allInOne}
                    <span class="block-acts">
                      <button type="button" class="mv" title="Move up" aria-label={`Move ${name} up`} disabled={i === 0}
                        onclick={() => setOrder(moveBlock(data.order, i, i - 1))}><Icon name="chevronUp" size={13} /></button>
                      <button type="button" class="mv" title="Move down" aria-label={`Move ${name} down`} disabled={i === data.order.length - 1}
                        onclick={() => setOrder(moveBlock(data.order, i, i + 1))}><Icon name="chevronDown" size={13} /></button>
                      {#if OPTIONAL_BLOCKS.includes(block)}
                        <button type="button" class="mv" title="Leave it out" aria-label={`Leave ${name} out`}
                          onclick={() => setOrder(withoutBlock(data.order, block))}><Icon name="x" size={12} /></button>
                      {/if}
                    </span>
                  {/if}
                </div>
                {#if writtenOn(block)}
                  {@render textField(roleOf(block), roleOf(block) === 'body' ? 5 : 4)}
                {:else}
                  <p class="hint same">Same text as {blockName(placesOn, data.order)}.</p>
                {/if}
              </li>
            {/each}
          </ol>
          <div class="block-adds">
            {#if !allInOne}
              {#each OPTIONAL_BLOCKS.filter((block) => !data.order.includes(block)) as block (block)}
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => setOrder(withBlock(data.order, block))}>
                  <Icon name="plus" /> {block === 'recap' ? 'Recap' : 'First place on its own'}
                </button>
              {/each}
            {/if}
            <label class="chk all-in-one" title="Every place and its picture in a single post">
              <input type="checkbox" checked={allInOne} onchange={(event) => setAllInOne(event.currentTarget.checked)} />
              All in one post
            </label>
          </div>
        </fieldset>
      {:else}
        <fieldset class="fld">
          <span>First post layout</span>
          <p class="hint">Arrange the tokens in the order you want, add line breaks and your own text. A token with no value drops its line.</p>
          {@render startFrom()}
          {@render tokenBar()}
          {@render textField('body', 9)}
        </fieldset>
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
  /* a video thread's posts, top to bottom: a head to carry each, its text under it */
  .blocks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .block {
    display: flex; flex-direction: column; gap: 6px; padding: 7px 8px 8px;
    border: 1px solid var(--border); border-radius: 8px; background: var(--bg-1);
  }
  .block-head {
    display: flex; align-items: center; gap: 7px; cursor: grab; user-select: none; touch-action: none;
  }
  .block-head.still { cursor: default; }
  .grip { display: flex; margin-left: -2px; color: var(--text-3); flex-shrink: 0; }
  .block-head:hover .grip { color: var(--text-1); }
  .block-num {
    display: grid; place-items: center; width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent); font: 700 10px var(--font-mono, monospace);
  }
  .block-said { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex: 1; }
  .block-name { font-size: 12px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
  .block-words { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .block-acts { display: flex; gap: 2px; flex-shrink: 0; }
  .mv {
    display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
    border: 0; border-radius: 5px; background: none; color: var(--text-3); cursor: pointer;
  }
  .mv:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .mv:disabled { opacity: 0.3; cursor: default; }
  .same { font-style: italic; }
  /* the post carried fades, and a rule marks the gap it would drop into, on the side it comes from */
  .block.dragging { opacity: 0.45; }
  .block.landing { box-shadow: 0 2px 0 var(--accent); }
  .block.landing.from-below { box-shadow: 0 -2px 0 var(--accent); }
  .block-adds { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .all-in-one { margin-left: auto; font-size: 12px; }
  .thread-preview { max-height: 70vh; overflow-y: auto; gap: 10px; }
  .pv-post { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
  .pv-post:first-of-type { border-top: 0; padding-top: 0; }
  .pv-num { font-size: 11px; color: var(--text-2); font-weight: 600; }
</style>
